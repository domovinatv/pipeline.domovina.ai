import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import type { Env } from '../types';
import {
  claimMagisteriumJobs,
  enqueueMagisteriumJob,
  getMagisteriumJob,
  listMagisteriumJobs,
  updateMagisteriumJob,
} from '../db';

export const magisteriumApi = new Hono<{ Bindings: Env }>();

// Sve /api/magisterium/* iza Bearer INGEST_KEY (lokalni bridge poller na Mac Miniju).
magisteriumApi.use('*', async (c, next) => {
  if (!c.env.INGEST_KEY) return c.json({ error: 'INGEST_KEY nije konfiguriran' }, 503);
  const mw = bearerAuth({ token: c.env.INGEST_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono generic kvirk (Bindings env)
  return mw(c as any, next);
});

// Enqueue zahtjeva (programatski/bridge). Admin koristi gumbe u /admin listi.
magisteriumApi.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { youtube_id?: string; lang?: string };
  if (!body.youtube_id) return c.json({ error: 'youtube_id nedostaje' }, 400);
  const { row, deduped } = await enqueueMagisteriumJob(c.env.DB, {
    youtubeId: body.youtube_id,
    lang: body.lang,
    source: 'admin',
  });
  return c.json({ job: row, deduped }, deduped ? 200 : 201);
});

// Lista zahtjeva (opcijski ?state=queued|running|done|failed).
magisteriumApi.get('/', async (c) => {
  const jobs = await listMagisteriumJobs(c.env.DB, {
    state: c.req.query('state') ?? undefined,
    limit: Number(c.req.query('limit') ?? 100),
  });
  return c.json({ jobs });
});

// Bridge poller: pokupi do `max` queued zahtjeva → 'running', vrati ih.
magisteriumApi.post('/claim', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { max?: number };
  const jobs = await claimMagisteriumJobs(c.env.DB, body.max ?? 3);
  return c.json({ jobs });
});

magisteriumApi.get('/:id', async (c) => {
  const job = await getMagisteriumJob(c.env.DB, c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json({ job });
});

// Bridge poller javlja ishod: state='done' (verificirano na CDN-u) ili 'failed' (+error).
magisteriumApi.patch('/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { state?: string; error?: string | null };
  if (body.state && !['queued', 'running', 'done', 'failed'].includes(body.state)) {
    return c.json({ error: `state '${body.state}' nije dozvoljen` }, 400);
  }
  const job = await updateMagisteriumJob(c.env.DB, c.req.param('id'), {
    state: body.state,
    error: body.error,
  });
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json({ job });
});
