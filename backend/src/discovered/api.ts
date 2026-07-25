import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import type { Env } from '../types';
import { DISCOVERED_STAGES } from '../types';
import { listDiscovered, listDiscoveredBatches, upsertDiscovered } from '../db';
import { extractYouTubeId, watchUrl } from '../util';

export const discoveredApi = new Hono<{ Bindings: Env }>();

// Iza Bearer INGEST_KEY — piše ga isključivo nightly bridge (report_discovered.js).
discoveredApi.use('*', async (c, next) => {
  if (!c.env.INGEST_KEY) return c.json({ error: 'INGEST_KEY nije konfiguriran' }, 503);
  const mw = bearerAuth({ token: c.env.INGEST_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono generic kvirk (Bindings env)
  return mw(c as any, next);
});

interface IncomingItem {
  youtube_id?: string;
  youtube_url?: string;
  title?: string | null;
  channel?: string | null;
  channel_dir?: string | null;
  duration_seconds?: number | null;
  published_at?: string | null;
  batch_date?: string;
  stage?: string;
  promotable?: boolean;
  source_platform?: string;
}

const BATCH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Batch ingest iz nightlyja. Idempotentno: postojeći video se NE duplicira — osvježi mu se
// samo `stage` (napredak na disku), pa ista podlista svake noći pokazuje živo stanje.
// Vraća koliko je STVARNO novih (to nightly ispiše u log kao "N novih videa").
discoveredApi.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { items?: IncomingItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return c.json({ inserted: 0, updated: 0, skipped: 0, items: [] });
  if (items.length > 500) return c.json({ error: 'najviše 500 stavki po zahtjevu' }, 400);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const insertedIds: string[] = [];

  for (const it of items) {
    // ID mora biti [A-Za-z0-9_-]{11}. Beamly sintetički ID-evi zadovoljavaju isti oblik
    // (namjerno — cijeli pipeline ih tretira kao `_yt_<id>`), pa prolaze i oni.
    const raw = String(it.youtube_id ?? '').trim();
    const id = /^[A-Za-z0-9_-]{11}$/.test(raw) ? raw : extractYouTubeId(raw);
    if (!id) {
      skipped++;
      continue;
    }
    const batchDate =
      it.batch_date && BATCH_DATE_RE.test(it.batch_date)
        ? it.batch_date
        : new Date().toISOString().slice(0, 10);
    const stage =
      it.stage && (DISCOVERED_STAGES as readonly string[]).includes(it.stage) ? it.stage : 'fetched';
    const res = await upsertDiscovered(c.env.DB, {
      youtubeId: id,
      youtubeUrl: it.youtube_url || watchUrl(id),
      title: it.title ?? null,
      channel: it.channel ?? null,
      channelDir: it.channel_dir ?? null,
      durationSeconds: Number.isFinite(it.duration_seconds) ? Number(it.duration_seconds) : null,
      publishedAt: it.published_at ?? null,
      batchDate,
      stage,
      promotable: it.promotable !== false,
      sourcePlatform: it.source_platform === 'beamly' ? 'beamly' : 'youtube',
    });
    if (res.inserted) {
      inserted++;
      insertedIds.push(id);
    } else {
      updated++;
    }
  }
  return c.json({ inserted, updated, skipped, items: insertedIds });
});

// Čitanje (dijagnostika iz terminala / budući konzumenti).
discoveredApi.get('/', async (c) => {
  const rows = await listDiscovered(c.env.DB, {
    state: c.req.query('state') ?? undefined,
    batchDate: c.req.query('batch_date') ?? undefined,
    limit: Number(c.req.query('limit') ?? 100),
  });
  return c.json({ discovered: rows });
});

discoveredApi.get('/batches', async (c) => {
  const batches = await listDiscoveredBatches(c.env.DB, Number(c.req.query('limit') ?? 30));
  return c.json({ batches });
});
