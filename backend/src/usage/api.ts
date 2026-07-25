import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import type { Env } from '../types';
import { listTokenUsage, replaceTokenUsage } from '../db';

export const usageApi = new Hono<{ Bindings: Env }>();

// Iza Bearer INGEST_KEY — piše ga isključivo nightly bridge (report_token_usage.js).
usageApi.use('*', async (c, next) => {
  if (!c.env.INGEST_KEY) return c.json({ error: 'INGEST_KEY nije konfiguriran' }, 503);
  const mw = bearerAuth({ token: c.env.INGEST_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono generic kvirk (Bindings env)
  return mw(c as any, next);
});

interface IncomingUsage {
  youtube_id?: string;
  runs?: number;
  input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  models?: string | null;
  first_at?: number | null;
  last_at?: number | null;
}

const num = (v: unknown) => (Number.isFinite(v) ? Math.max(0, Math.round(Number(v))) : 0);

// Batch upsert potrošnje tokena. Skener šalje PUNE zbrojeve po videu (ne delte), pa se
// redak zamjenjuje — vidi replaceTokenUsage.
usageApi.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { items?: IncomingUsage[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 500) return c.json({ error: 'najviše 500 stavki po zahtjevu' }, 400);

  let written = 0;
  let skipped = 0;
  for (const it of items) {
    const id = String(it.youtube_id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
      skipped++;
      continue;
    }
    await replaceTokenUsage(c.env.DB, {
      youtubeId: id,
      runs: num(it.runs),
      inputTokens: num(it.input_tokens),
      cacheCreationTokens: num(it.cache_creation_tokens),
      cacheReadTokens: num(it.cache_read_tokens),
      outputTokens: num(it.output_tokens),
      models: it.models ?? null,
      firstAt: Number.isFinite(it.first_at) ? Number(it.first_at) : null,
      lastAt: Number.isFinite(it.last_at) ? Number(it.last_at) : null,
    });
    written++;
  }
  return c.json({ written, skipped });
});

usageApi.get('/', async (c) => {
  const rows = await listTokenUsage(c.env.DB, Number(c.req.query('limit') ?? 100));
  const totals = rows.reduce(
    (a, r) => {
      a.runs += r.runs;
      a.input_tokens += r.input_tokens;
      a.cache_creation_tokens += r.cache_creation_tokens;
      a.cache_read_tokens += r.cache_read_tokens;
      a.output_tokens += r.output_tokens;
      return a;
    },
    { runs: 0, input_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, output_tokens: 0 },
  );
  return c.json({ usage: rows, totals, videos: rows.length });
});
