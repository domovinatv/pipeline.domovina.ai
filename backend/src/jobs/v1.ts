import { Hono } from 'hono';
import type { ApiKeyRow, Env } from '../types';
import {
  addApiKeyCredits,
  consumeApiKeyCredits,
  createImportedJob,
  createJob,
  enqueueMagisteriumJob,
  findActiveJobByYoutubeId,
  findJobByYoutubeIdForKey,
  getApiKeyByHash,
  getJob,
  listJobs,
  prioritizeJob,
  touchApiKey,
} from '../db';
import { MAGISTERIUM_LANGS } from '../types';
import { extractSourceRef, fetchOEmbed, sha256Hex } from '../util';
import { buildPipelineReport, isPublishedOnDomovina, reconcilePublishedJobs } from '../pipeline';

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
    tier?: string;
  };
  const ref = await extractSourceRef(body.url || body.youtube_id || '');
  if (!ref) return c.json({ error: 'Neispravan YouTube/X URL/ID' }, 400);
  const youtubeId = ref.id;
  // Tier: 'priority' = Modal instant (3 kredita), inače standard (1 kredit, noćni Colab bulk).
  const priority = body.tier === 'priority' ? 1 : 0;
  const cost = priority ? 3 : 1;

  // Dedup: već aktivan job za isti video → vrati ga, NE naplaćuj.
  const existing = await findActiveJobByYoutubeId(c.env.DB, youtubeId);
  if (existing) return c.json({ job: existing, deduped: true, credits_remaining: key.credits });

  // Već objavljeno na domovina.ai (CDN artefakt članka postoji) → NE naplaćuj i
  // ne queueaj ponovnu obradu. Umjesto pukog "prolaznog" odgovora, uveze epizodu
  // kao gotov (done) 'import' red u listu OVOG ključa: korisnik je vidi u svom
  // dashboardu, s oznakom da je objavljena ranije (izvan njegovih kredita).
  const cdnBase = c.env.CDN_BASE || 'https://cdn.domovina.ai';
  if (await isPublishedOnDomovina(cdnBase, youtubeId)) {
    const siteBase = (c.env.SITE_BASE || 'https://domovina.ai').replace(/\/$/, '');
    const detailUrl = `${siteBase}/v/${youtubeId}`;
    // Idempotentno: ako ovaj ključ već ima red za ovaj video, vrati ga (bez duplikata).
    let job = await findJobByYoutubeIdForKey(c.env.DB, youtubeId, key.id);
    if (!job) {
      const meta = ref.source === 'youtube' ? await fetchOEmbed(youtubeId) : null;
      job = await createImportedJob(c.env.DB, {
        youtubeId,
        youtubeUrl: ref.url,
        sourcePlatform: ref.source,
        sourceUrl: ref.url,
        title: body.title || meta?.title || null,
        channel: meta?.channel ?? null,
        apiKeyId: key.id,
        detailUrl,
      });
    }
    return c.json({
      already_published: true,
      imported: true,
      job,
      youtube_id: youtubeId,
      detail_url: detailUrl,
      credits_remaining: key.credits,
    });
  }

  // Naplata: atomski rezerviraj `cost` kredita (1 standard / 3 prioritet). Bez → 402.
  if (!(await consumeApiKeyCredits(c.env.DB, key.id, cost))) {
    return c.json({ error: 'Nema dovoljno kredita', credits_remaining: key.credits, required: cost }, 402);
  }
  const priceCents = Number(c.env.PRICE_CENTS ?? '0') || 0;
  // oEmbed radi samo za YouTube; za X bridge backfilla naslov/kanal iz info.json.
  const meta = ref.source === 'youtube' ? await fetchOEmbed(youtubeId) : null;
  const job = await createJob(c.env.DB, {
    youtubeId,
    youtubeUrl: ref.url,
    sourcePlatform: ref.source,
    sourceUrl: ref.url,
    title: body.title || meta?.title || null,
    channel: meta?.channel ?? null,
    source: ref.source === 'x' ? 'x-api' : 'api',
    apiKeyId: key.id,
    priceCents,
    priority,
    creditCost: cost,
  });
  return c.json({ job, tier: priority ? 'priority' : 'standard', credits_remaining: key.credits - cost }, 201);
});

// "Forsiraj sada": digni vlastiti queued standard job na prioritet. Naplati razliku (3−1=2).
publicApi.post('/jobs/:id/prioritize', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  if (job.priority) return c.json({ job, already_priority: true, credits_remaining: key.credits });
  if (job.state !== 'queued') {
    return c.json({ error: 'Job je već krenuo u obradu — ne može se forsirati.' }, 409);
  }
  const UPGRADE_COST = 2; // razlika prioritet(3) − standard(1)
  if (!(await consumeApiKeyCredits(c.env.DB, key.id, UPGRADE_COST))) {
    return c.json({ error: 'Nema dovoljno kredita', credits_remaining: key.credits, required: UPGRADE_COST }, 402);
  }
  const ok = await prioritizeJob(c.env.DB, job.id, key.id, 3);
  if (!ok) {
    // Job je promijenio stanje između čitanja i UPDATE-a → vrati kredite (best-effort).
    await addApiKeyCredits(c.env.DB, key.id, UPGRADE_COST);
    return c.json({ error: 'Job više nije u queued stanju.' }, 409);
  }
  const updated = await getJob(c.env.DB, job.id);
  return c.json({ job: updated, prioritized: true, credits_remaining: key.credits - UPGRADE_COST });
});

// One-click Magisterium (re)obrada za vlastiti GOTOV video (HR ili EN overlay).
// Ubaci zahtjev u magisterium_jobs → bridge poller (Mac Mini) headless pokrene MCP
// runbook i uploada artefakt na CDN. Idempotentno (unique aktivni po video+lang).
// Ne troši kredite (Magisterium je dio pune obrade; EN je opt-in overlay).
publicApi.post('/jobs/:id/magisterium', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  if (job.state !== 'done') {
    return c.json({ error: 'Magisterium se pokreće tek kad je video gotov (done).' }, 409);
  }
  const body = (await c.req.json().catch(() => ({}))) as { lang?: string };
  const lang = body.lang === 'en' ? 'en' : 'hr';
  if (!MAGISTERIUM_LANGS.includes(lang as never)) {
    return c.json({ error: `lang '${lang}' nije podržan` }, 400);
  }
  const { row, deduped } = await enqueueMagisteriumJob(c.env.DB, {
    youtubeId: job.youtube_id,
    lang,
    source: 'dashboard',
  });
  return c.json({ magisterium: row, deduped });
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
  // Self-heal: ne-terminalni jobovi već live na CDN-u → 'done' (status ne laže).
  await reconcilePublishedJobs(
    c.env.DB,
    c.env.CDN_BASE || 'https://cdn.domovina.ai',
    c.env.SITE_BASE || 'https://domovina.ai',
    jobs,
  );
  return c.json({ jobs, credits_remaining: key.credits });
});
