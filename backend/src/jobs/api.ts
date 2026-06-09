import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import type { Env } from '../types';
import { BRIDGE_SETTABLE } from '../types';
import {
  claimJobs,
  createJob,
  findActiveJobByYoutubeId,
  getJob,
  listJobs,
  updateJob,
} from '../db';
import { extractYouTubeId, fetchOEmbed, watchUrl } from '../util';

export const jobsApi = new Hono<{ Bindings: Env }>();

// Sve /api/jobs/* iza Bearer INGEST_KEY (lokalni bridge + budući programatski klijenti).
jobsApi.use('*', async (c, next) => {
  if (!c.env.INGEST_KEY) return c.json({ error: 'INGEST_KEY nije konfiguriran' }, 503);
  const mw = bearerAuth({ token: c.env.INGEST_KEY });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono generic kvirk (Bindings env)
  return mw(c as any, next);
});

// Enqueue (programatski). Admin koristi /admin/jobs formu umjesto ovoga.
jobsApi.post('/', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    url?: string;
    youtube_id?: string;
    title?: string;
  };
  const youtubeId = extractYouTubeId(body.url || body.youtube_id || '');
  if (!youtubeId) return c.json({ error: 'Neispravan YouTube URL/ID' }, 400);
  const existing = await findActiveJobByYoutubeId(c.env.DB, youtubeId);
  if (existing) return c.json({ job: existing, deduped: true });
  const priceCents = Number(c.env.PRICE_CENTS ?? '0') || 0;
  const meta = await fetchOEmbed(youtubeId); // public → naslov+kanal; unlisted → null (bridge backfilla)
  const job = await createJob(c.env.DB, {
    youtubeId,
    youtubeUrl: watchUrl(youtubeId),
    title: body.title || meta?.title || null,
    channel: meta?.channel ?? null,
    source: 'api',
    priceCents,
  });
  return c.json({ job }, 201);
});

// Lista (opcijski ?state=transcribing,processing&limit=N).
jobsApi.get('/', async (c) => {
  const jobs = await listJobs(c.env.DB, {
    state: c.req.query('state') ?? undefined,
    limit: Number(c.req.query('limit') ?? 100),
  });
  return c.json({ jobs });
});

// Bridge claim: pokupi do `max` queued → 'fetching', vrati ih.
jobsApi.post('/claim', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { max?: number };
  const jobs = await claimJobs(c.env.DB, body.max ?? 5);
  return c.json({ jobs });
});

jobsApi.get('/:id', async (c) => {
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json({ job });
});

// Bridge javlja napredak: state / detail_url / error + metapodaci iz info.json.
jobsApi.patch('/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    state?: string;
    detail_url?: string | null;
    error?: string | null;
    title?: string | null;
    channel?: string | null;
    duration_seconds?: number | null;
  };
  if (body.state && !BRIDGE_SETTABLE.includes(body.state as never)) {
    return c.json({ error: `state '${body.state}' nije dozvoljen` }, 400);
  }
  const job = await updateJob(c.env.DB, c.req.param('id'), {
    state: body.state as never,
    detailUrl: body.detail_url,
    error: body.error,
    title: body.title,
    channel: body.channel,
    durationSeconds: body.duration_seconds,
  });
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json({ job });
});
