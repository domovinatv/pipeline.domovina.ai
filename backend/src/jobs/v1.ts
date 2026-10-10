import { Hono } from 'hono';
import type { ApiKeyRow, Env } from '../types';
import {
  addApiKeyCredits,
  consumeApiKeyCredits,
  countByState,
  countJobs,
  createImportedJob,
  createJob,
  enqueueMagisteriumJob,
  findActiveJobByYoutubeId,
  findJobByYoutubeIdForKey,
  getApiKeyByHash,
  getJob,
  getTokenUsage,
  listJobs,
  prioritizeJob,
  setJobLlmModel,
  setJobMagisteriumModel,
  touchApiKey,
} from '../db';
import type { JobRow } from '../types';
import {
  DEFAULT_TRANSCRIPTION,
  MAGISTERIUM_LANGS,
  STANDARD_COST,
  TRANSCRIPTION_NONE,
  parseArticleModel,
  parseMagisteriumModel,
  parseTranscription,
  priorityCost,
  reprocessRedoArticle,
} from '../types';
import { cleanTitle, extractSourceRef, fetchOEmbed, sha256Hex } from '../util';
import { buildPipelineReport, isPublishedOnDomovina, listCdnFiles, reconcilePublishedJobs } from '../pipeline';

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

// Izbori modela iz JSON bodyja (enqueue i ponovna obrada). Izostavljeno → default
// (createJob: Claude Opus, Magisterium uključen s Opusom); nepoznato → greška.
function parseChoices(body: { article_model?: string; with_magisterium?: unknown; magisterium_model?: string }):
  | { error: string }
  | {
      article: ReturnType<typeof parseArticleModel>;
      magisteriumModel: ReturnType<typeof parseMagisteriumModel>;
      withMagisterium: boolean;
    } {
  const article = body.article_model == null ? null : parseArticleModel(body.article_model);
  if (body.article_model != null && !article) return { error: `nepoznat article_model: ${body.article_model}` };
  const magisteriumModel = body.magisterium_model == null ? null : parseMagisteriumModel(body.magisterium_model);
  if (body.magisterium_model != null && !magisteriumModel) {
    return { error: `nepoznat magisterium_model: ${body.magisterium_model}` };
  }
  return { article, magisteriumModel, withMagisterium: body.with_magisterium !== false };
}

// Enqueue videa. Dedup ne troši kredit; novi job rezervira 1 kredit (402 ako nema).
publicApi.post('/jobs', async (c) => {
  const key = c.get('apiKey');
  const body = (await c.req.json().catch(() => ({}))) as {
    url?: string;
    youtube_id?: string;
    title?: string;
    tier?: string;
    transcription?: string; // 'speechmatics' (default, kao nightly) | 'canary'
    article_model?: string; // vrijednost iz ARTICLE_MODELS (default 'claude:opus')
    with_magisterium?: boolean; // default true
    magisterium_model?: string; // 'opus' (default) | 'sonnet' | 'haiku'
  };
  const ref = await extractSourceRef(body.url || body.youtube_id || '');
  if (!ref) return c.json({ error: 'Neispravan YouTube/X URL/ID' }, 400);
  const youtubeId = ref.id;
  // Tier: 'priority' = Modal instant (5 kredita sa Speechmatics, 3 samo Canary), inače
  // standard (1 kredit, noćni bulk). Nepoznata vrijednost bilo kojeg izbora → 400, ne tihi default.
  const priority = body.tier === 'priority' ? 1 : 0;
  const choice = parseChoices(body);
  if ('error' in choice) return c.json({ error: choice.error }, 400);
  const transcription = body.transcription == null ? DEFAULT_TRANSCRIPTION : parseTranscription(body.transcription);
  if (!transcription) return c.json({ error: "transcription mora biti 'speechmatics' ili 'canary'" }, 400);
  const cost = priority ? priorityCost(transcription) : STANDARD_COST;
  const title = cleanTitle(body.title ?? '', body.url || body.youtube_id || '');

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
        title: title || meta?.title || null,
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
    title: title || meta?.title || null,
    channel: meta?.channel ?? null,
    source: ref.source === 'x' ? 'x-api' : 'api',
    apiKeyId: key.id,
    priceCents,
    priority,
    creditCost: cost,
    transcription,
    withMagisterium: choice.withMagisterium,
    llmBackend: choice.article?.backend,
    llmModel: choice.article?.model,
    magisteriumModel: choice.magisteriumModel,
  });
  return c.json(
    { job, tier: priority ? 'priority' : 'standard', transcription, credits_remaining: key.credits - cost },
    201,
  );
});

// "Forsiraj sada": digni vlastiti queued standard job na prioritet. Naplati razliku
// prioritet − standard (5−1=4 sa Speechmatics, 3−1=2 samo Canary).
publicApi.post('/jobs/:id/prioritize', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  if (job.priority) return c.json({ job, already_priority: true, credits_remaining: key.credits });
  if (job.state !== 'queued') {
    return c.json({ error: 'Job je već krenuo u obradu — ne može se forsirati.' }, 409);
  }
  const target = priorityCost(job.transcription);
  const UPGRADE_COST = target - job.credit_cost;
  if (!(await consumeApiKeyCredits(c.env.DB, key.id, UPGRADE_COST))) {
    return c.json({ error: 'Nema dovoljno kredita', credits_remaining: key.credits, required: UPGRADE_COST }, 402);
  }
  const ok = await prioritizeJob(c.env.DB, job.id, key.id, target);
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
    model: job.magisterium_model, // namjera s joba; NULL → poller uzme svoj default (Opus)
  });
  return c.json({ magisterium: row, deduped });
});

// Promjena modela na vlastitom jobu (select u retku dashboarda), isto kao admin:
//   llm-model — koraci 7+8; samo dok članak još nije generiran (done/failed → 409)
//   mag-model — Magisterium runbook; vrijedi za SLJEDEĆI zahtjev
publicApi.post('/jobs/:id/:kind{llm-model|mag-model}', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { value?: string };
  if (c.req.param('kind') === 'llm-model') {
    if (job.state === 'done' || job.state === 'failed') {
      return c.json({ error: 'Članak je već generiran — za novi pokreni ponovnu obradu.' }, 409);
    }
    const article = parseArticleModel(body.value);
    if (!article) return c.json({ error: `nepoznat model: ${body.value}` }, 400);
    await setJobLlmModel(c.env.DB, job.id, article.backend, article.model);
  } else {
    const model = parseMagisteriumModel(body.value);
    if (!model) return c.json({ error: `nepoznat model: ${body.value}` }, 400);
    await setJobMagisteriumModel(c.env.DB, job.id, model);
  }
  return c.json({ ok: true, job: await getJob(c.env.DB, job.id) });
});

// Ponovna obrada vlastitog GOTOVOG videa — isti izbori kao admin „🔁 Ponovna obrada"
// (prijepis / članak / Magisterium). Uvijek prioritetni put (samo on poštuje izbore po
// videu), pa košta kao prioritetni job s odabranom transkripcijom.
// Uvezeni redovi ('import') nisu korisnikova obrada nego tuđa objavljena epizoda — njih
// ponovno obrađuje samo admin, jer bridge prepiše CDN te epizode za sve posjetitelje.
publicApi.post('/jobs/:id/reprocess', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  if (job.source === 'import') {
    return c.json({ error: 'Uvezenu epizodu (objavljenu izvan tvojih kredita) ponovno obrađuje samo administrator.' }, 403);
  }
  if (job.state !== 'done') return c.json({ error: 'Ponovna obrada je moguća tek kad je video gotov (done).' }, 409);
  const body = (await c.req.json().catch(() => ({}))) as {
    transcription?: string; // 'none' | 'speechmatics' (default) | 'canary'
    article_mode?: string; // 'new' (default) | 'keep' — 'keep' samo uz transcription='none'
    article_model?: string;
    with_magisterium?: boolean;
    magisterium_model?: string;
  };
  const transcription = body.transcription == null ? DEFAULT_TRANSCRIPTION : parseTranscription(body.transcription, true);
  if (!transcription) return c.json({ error: "transcription mora biti 'none', 'speechmatics' ili 'canary'" }, 400);
  const choice = parseChoices(body);
  if ('error' in choice) return c.json({ error: choice.error }, 400);
  const redoArticle = reprocessRedoArticle(transcription, body.article_mode);
  if (transcription === TRANSCRIPTION_NONE && !redoArticle && !choice.withMagisterium) {
    return c.json({ error: 'Ništa nije odabrano — izaberi barem prijepis, članak ili Magisterium.' }, 400);
  }
  // Dva aktivna joba za isti video utrkivala bi se na artefaktima.
  const active = await findActiveJobByYoutubeId(c.env.DB, job.youtube_id);
  if (active) return c.json({ error: 'Za ovaj video već postoji aktivna obrada.', job: active }, 409);
  const cost = priorityCost(transcription);
  if (!(await consumeApiKeyCredits(c.env.DB, key.id, cost))) {
    return c.json({ error: 'Nema dovoljno kredita', credits_remaining: key.credits, required: cost }, 402);
  }
  const created = await createJob(c.env.DB, {
    youtubeId: job.youtube_id,
    youtubeUrl: job.youtube_url,
    sourcePlatform: job.source_platform,
    sourceUrl: job.source_url,
    title: job.title,
    channel: job.channel,
    source: job.source_platform === 'x' ? 'x-api' : 'api',
    apiKeyId: key.id,
    priceCents: Number(c.env.PRICE_CENTS ?? '0') || 0,
    priority: 1,
    creditCost: cost,
    withMagisterium: choice.withMagisterium,
    llmBackend: choice.article?.backend,
    llmModel: choice.article?.model,
    magisteriumModel: choice.magisteriumModel,
    transcription,
    reprocess: true,
    redoArticle,
  });
  return c.json({ job: created, reprocess: true, credits_remaining: key.credits - cost }, 201);
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
  const [report, tokens] = await Promise.all([
    buildPipelineReport(cdnBase, job, c.env.SITE_BASE || 'https://domovina.ai'),
    getTokenUsage(c.env.DB, job.youtube_id),
  ]);
  return c.json({ ...report, tokens });
});

// Live listing CDN datoteka vlastitog joba (isti izvor kao admin /admin/jobs/:id/files,
// ali scope-an na ključ). "📁 datoteke" prikaz u korisničkom /dashboard-u.
publicApi.get('/jobs/:id/files', async (c) => {
  const key = c.get('apiKey');
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job || job.api_key_id !== key.id) return c.json({ error: 'not found' }, 404);
  if (!c.env.CDN_BUCKET) {
    return c.json({ error: 'CDN_BUCKET R2 binding nije konfiguriran' }, 503);
  }
  const cdnBase = (c.env.CDN_BASE || 'https://cdn.domovina.ai').replace(/\/$/, '');
  const groups = await listCdnFiles(c.env.CDN_BUCKET, job.youtube_id);
  return c.json({ cdn_base: cdnBase, groups });
});

// Lista vlastitih jobova.
publicApi.get('/jobs', async (c) => {
  const key = c.get('apiKey');
  // Paginacija + filter + search kao /admin/api/jobs, ali uvijek scope-ano na ključ.
  const filter = { apiKeyId: key.id, state: c.req.query('state') || undefined, q: c.req.query('q') || undefined };
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);
  const jobs: JobRow[] = await listJobs(c.env.DB, { ...filter, limit, offset });
  // Self-heal: ne-terminalni jobovi već live na CDN-u → 'done' (status ne laže).
  await reconcilePublishedJobs(
    c.env.DB,
    c.env.CDN_BASE || 'https://cdn.domovina.ai',
    c.env.SITE_BASE || 'https://domovina.ai',
    jobs,
  );
  const [counts, total] = await Promise.all([countByState(c.env.DB, key.id), countJobs(c.env.DB, filter)]);
  return c.json({ jobs, counts, total, limit, offset, credits_remaining: key.credits });
});
