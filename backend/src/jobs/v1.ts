import { Hono } from 'hono';
import type { ApiKeyRow, Env } from '../types';
import {
  consumeApiKeyCredit,
  createJob,
  findActiveJobByYoutubeId,
  getApiKeyByHash,
  getJob,
  listJobs,
  touchApiKey,
} from '../db';
import { extractYouTubeId, fetchOEmbed, sha256Hex, watchUrl } from '../util';
import { buildPipelineReport, isPublishedOnDomovina } from '../pipeline';

// Javni programatski API (SaaS klijenti). Auth = per-key Bearer (≠ bridge INGEST_KEY).
// Enqueue je gejtan na kredite: 1 kredit = 1 obrađeni video. Krediti se zasad pune
// ručno kroz admin; kasnije ih puni pay.domovina.ai nakon kupnje.
export const publicApi = new Hono<{ Bindings: Env; Variables: { apiKey: ApiKeyRow } }>();

// Auth: izvuci Bearer, hashiraj, nađi omogućen ključ. Inače 401.
publicApi.use('*', async (c, next) => {
  const auth = c.req.header('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return c.json({ error: 'Nedostaje Bearer API ključ' }, 401);
  const key = await getApiKeyByHash(c.env.DB, await sha256Hex(m[1].trim()));
  if (!key) return c.json({ error: 'Neispravan ili onemogućen API ključ' }, 401);
  c.set('apiKey', key);
  await touchApiKey(c.env.DB, key.id);
  await next();
});

// Enqueue videa. Dedup ne troši kredit; novi job rezervira 1 kredit (402 ako nema).
publicApi.post('/jobs', async (c) => {
  const key = c.get('apiKey');
  const body = (await c.req.json().catch(() => ({}))) as {
    url?: string;
    youtube_id?: string;
    title?: string;
  };
  const youtubeId = extractYouTubeId(body.url || body.youtube_id || '');
  if (!youtubeId) return c.json({ error: 'Neispravan YouTube URL/ID' }, 400);

  // Dedup: već aktivan job za isti video → vrati ga, NE naplaćuj.
  const existing = await findActiveJobByYoutubeId(c.env.DB, youtubeId);
  if (existing) return c.json({ job: existing, deduped: true, credits_remaining: key.credits });

  // Već objavljeno na domovina.ai (CDN artefakt članka postoji) → NE naplaćuj i
  // ne queueaj ponovnu obradu; javi klijentu da je epizoda već dostupna.
  const cdnBase = c.env.CDN_BASE || 'https://cdn.domovina.ai';
  if (await isPublishedOnDomovina(cdnBase, youtubeId)) {
    const siteBase = (c.env.SITE_BASE || 'https://domovina.ai').replace(/\/$/, '');
    return c.json({
      already_published: true,
      youtube_id: youtubeId,
      detail_url: `${siteBase}/v/${youtubeId}`,
      credits_remaining: key.credits,
    });
  }

  // Naplata: atomski rezerviraj 1 kredit. Bez kredita → 402 Payment Required.
  if (!(await consumeApiKeyCredit(c.env.DB, key.id))) {
    return c.json({ error: 'Nema dovoljno kredita', credits_remaining: 0 }, 402);
  }
  const priceCents = Number(c.env.PRICE_CENTS ?? '0') || 0;
  const meta = await fetchOEmbed(youtubeId); // public/unlisted → naslov+kanal; bridge backfilla ostalo
  const job = await createJob(c.env.DB, {
    youtubeId,
    youtubeUrl: watchUrl(youtubeId),
    title: body.title || meta?.title || null,
    channel: meta?.channel ?? null,
    source: 'api',
    apiKeyId: key.id,
    priceCents,
  });
  return c.json({ job, credits_remaining: key.credits - 1 }, 201);
});

// Status vlastitog joba (ključ vidi samo svoje jobove).
publicApi.get('/jobs/:id', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  return c.json({ job });
});

// Granularni pipeline status vlastitog joba (isti izvještaj kao admin, ali scope-an
// na ključ). Puni per-korak prikaz u korisničkom /dashboard-u.
publicApi.get('/jobs/:id/pipeline', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  const cdnBase = c.env.CDN_BASE || 'https://cdn.domovina.ai';
  const report = await buildPipelineReport(cdnBase, job, c.env.SITE_BASE || 'https://domovina.ai');
  return c.json(report);
});

// Lista vlastitih jobova.
publicApi.get('/jobs', async (c) => {
  const key = c.get('apiKey');
  const jobs = await listJobs(c.env.DB, {
    apiKeyId: key.id,
    limit: Number(c.req.query('limit') ?? 50),
  });
  return c.json({ jobs, credits_remaining: key.credits });
});
