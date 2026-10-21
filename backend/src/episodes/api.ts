import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import type { Env } from '../types';
import { EPISODE_STEP_VALUES, EPISODE_TRANSCRIPTS } from '../types';
import { type EpisodeInput, listEpisodes, upsertEpisodes } from '../db';

export const episodesApi = new Hono<{ Bindings: Env }>();

// Iza Bearer INGEST_KEY — piše ga isključivo bridge (report_inventory.js na Mac Miniju).
episodesApi.use('*', async (c, next) => {
  if (!c.env.INGEST_KEY) return c.json({ error: 'INGEST_KEY nije konfiguriran' }, 503);
  const mw = bearerAuth({ token: c.env.INGEST_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono generic kvirk (Bindings env)
  return mw(c as any, next);
});

const STEP_COLS = [
  'fetch', 'diarized', 'summary', 'article', 'rag', 'screenshots', 'epub', 'words',
  'magisterium_hr', 'magisterium_en', 'article_en',
] as const;

const str = (v: unknown, max = 500): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

// Normaliziraj jednu stavku s diska. Nepoznata vrijednost koraka → 'missing' (nikad smeće u
// bazi); neispravan ID ili kanal → stavka se preskače.
export function normalizeEpisode(it: Record<string, unknown>): EpisodeInput | null {
  const id = String(it.youtube_id ?? '').trim();
  const channelDir = str(it.channel_dir, 120);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id) || !channelDir) return null;
  const step = (v: unknown) =>
    typeof v === 'string' && (EPISODE_STEP_VALUES as readonly string[]).includes(v) ? v : 'missing';
  const upload = str(it.upload_date, 8);
  const ymd = str(it.article_date, 10);
  const out = {
    youtube_id: id,
    channel_dir: channelDir,
    channel: str(it.channel, 200),
    title: str(it.title),
    upload_date: upload && /^\d{8}$/.test(upload) ? upload : null,
    duration_seconds: Number.isFinite(it.duration_seconds) ? Math.round(Number(it.duration_seconds)) : null,
    audio_only: it.audio_only ? 1 : 0,
    transcript:
      typeof it.transcript === 'string' && (EPISODE_TRANSCRIPTS as readonly string[]).includes(it.transcript)
        ? it.transcript
        : 'none',
    article_model: str(it.article_model, 80),
    article_date: ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null,
    article_sections: Number.isFinite(it.article_sections) ? Math.max(0, Math.round(Number(it.article_sections))) : null,
  } as EpisodeInput;
  for (const k of STEP_COLS) out[k] = step(it[k]);
  return out;
}

// Batch ingest iz nightlyja / pollera. Vraća koliko je redaka stvarno promijenjeno (novi ili
// drukčije stanje) — nepromijenjeni se ne pišu (sig u db.upsertEpisodes).
episodesApi.post('/inventory', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { items?: Record<string, unknown>[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 500) return c.json({ error: 'najviše 500 stavki po zahtjevu' }, 400);
  const rows: EpisodeInput[] = [];
  let skipped = 0;
  for (const it of items) {
    const n = it && typeof it === 'object' ? normalizeEpisode(it) : null;
    if (n) rows.push(n);
    else skipped++;
  }
  const changed = await upsertEpisodes(c.env.DB, rows);
  return c.json({ received: items.length, changed, skipped });
});

// Čitanje (dijagnostika iz terminala).
episodesApi.get('/', async (c) => {
  const rows = await listEpisodes(c.env.DB, {
    channel: c.req.query('channel') || undefined,
    missing: c.req.query('missing') || undefined,
    q: c.req.query('q') || undefined,
    limit: Number(c.req.query('limit') ?? 50),
    offset: Number(c.req.query('offset') ?? 0),
  });
  return c.json({ episodes: rows });
});
