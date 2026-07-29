import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env } from '../types';
import {
  addApiKeyCredits,
  countByState,
  countDiscoveredByState,
  countJobs,
  createApiKey,
  createJob,
  deleteApiKey,
  deleteJob,
  enqueueMagisteriumJob,
  findActiveJobByYoutubeId,
  getDiscovered,
  getJob,
  getTokenUsage,
  listApiKeys,
  listDiscovered,
  listDiscoveredBatches,
  listJobs,
  markDiscoveredPromoted,
  prioritizeJob,
  restoreJob,
  setApiKeyEnabled,
  setDiscoveredState,
  setJobLlmModel,
  setJobMagisterium,
  setJobMagisteriumModel,
  softDeleteJob,
  updateJob,
} from '../db';
import type { DiscoveredRow } from '../types';
import { parseArticleModel, parseMagisteriumModel } from '../types';
import { extractSourceRef, fetchOEmbed } from '../util';
import { buildPipelineReport, isPublishedOnDomovina, reconcilePublishedJobs } from '../pipeline';
import {
  layout,
  renderAlreadyPublishedPage,
  renderDiscoveredPage,
  renderJobFilesPage,
  renderJobsPage,
  renderKeysPage,
} from './views';

export const admin = new Hono<{ Bindings: Env }>();

// Basic Auth gate na cijelo /admin stablo. Bez postavljenih secreta → 503 (safe default).
admin.use('*', async (c, next) => {
  if (!c.env.ADMIN_USER || !c.env.ADMIN_PASS) {
    return c.text('Admin nije konfiguriran (postavi ADMIN_USER + ADMIN_PASS secrete).', 503);
  }
  const mw = basicAuth({
    username: c.env.ADMIN_USER,
    password: c.env.ADMIN_PASS,
    realm: 'DOMOVINA Pipeline admin',
  });
  return mw(c, next);
});

admin.get('/', (c) => c.html(renderJobsPage()));

// Forma "dodaj u queue".
admin.post('/jobs', async (c) => {
  const form = await c.req.parseBody();
  const raw = String(form.url ?? '').trim();
  const title = String(form.title ?? '').trim() || null;
  const force = String(form.force ?? '') === '1'; // "svejedno dodaj" iz potvrdne stranice
  const priority = String(form.priority ?? '') === '1' ? 1 : 0; // admin prioritet (besplatno)
  // Magisterium checkbox: `mag_present` hidden polje označava da forma nosi checkbox (unchecked
  // checkbox ne šalje ništa). Bez tog polja (stari/programatski POST) → default UKLJUČENO.
  const withMagisterium = String(form.mag_present ?? '') === '1' ? String(form.with_magisterium ?? '') === '1' : true;
  // Izbor modela: nepoznata/izostavljena vrijednost → default (vertex / opus), nikad smeće u bazi.
  const article = parseArticleModel(String(form.article_model ?? ''));
  const magModel = parseMagisteriumModel(String(form.magisterium_model ?? ''));
  const ref = await extractSourceRef(raw);
  if (!ref) {
    return c.html(
      layout(
        'DOMOVINA Pipeline — greška',
        `<h1>Neispravan unos</h1><p>Ne mogu prepoznati YouTube ni X (Twitter) URL iz: <span class="mono">${raw.replace(/</g, '&lt;')}</span></p><p><a href="/admin">← natrag</a></p>`,
      ),
      400,
    );
  }
  const youtubeId = ref.id;
  // Dedup 1: već postoji aktivan job za isti video u NAŠEM queueu.
  const existing = await findActiveJobByYoutubeId(c.env.DB, youtubeId);
  if (existing) return c.redirect('/admin', 303);

  // Dedup 2: epizoda je već objavljena na domovina.ai (CDN artefakt članka postoji),
  // iako kod nas nema joba. Čest slučaj: video je prošao glavni pipeline pa se
  // ad-hoc ponovno doda. Ne queueaj tiho duplikat — pokaži potvrdu s linkom i
  // "svejedno dodaj" opcijom (force=1) za slučaj namjerne ponovne obrade.
  if (!force) {
    const cdnBase = c.env.CDN_BASE || 'https://cdn.domovina.ai';
    if (await isPublishedOnDomovina(cdnBase, youtubeId)) {
      return c.html(
        renderAlreadyPublishedPage({
          youtubeId,
          siteBase: c.env.SITE_BASE || 'https://domovina.ai',
          rawUrl: raw,
          title,
          withMagisterium,
          articleModel: String(form.article_model ?? ''),
          magisteriumModel: String(form.magisterium_model ?? ''),
          source: ref.source,
        }),
      );
    }
  }

  // oEmbed radi samo za YouTube; za X bridge backfilla naslov/kanal iz info.json.
  const meta = ref.source === 'youtube' ? await fetchOEmbed(youtubeId) : null;
  await createJob(c.env.DB, {
    youtubeId,
    youtubeUrl: ref.url,
    sourcePlatform: ref.source,
    sourceUrl: ref.url,
    title: title || meta?.title || null,
    channel: meta?.channel ?? null,
    source: ref.source === 'x' ? 'x-admin' : 'admin',
    priceCents: 0,
    priority,
    creditCost: priority ? 3 : 1,
    withMagisterium,
    llmBackend: article?.backend,
    llmModel: article?.model,
    magisteriumModel: magModel,
  });
  return c.redirect('/admin', 303);
});

// Admin akcije po jobu (poziva ih tablica preko fetch-a; Basic Auth se nasljeđuje).
//   delete   — soft-delete (reverzibilno; redak ostaje strikethrough u listi)
//   restore  — poništi soft-delete (vrati job u izvorno stanje)
//   purge    — TRAJNO obriši redak iz baze (nepovratno; iza confirm-a u UI-u)
//   skip     — state=skipped (nikad se ne claima)
//   postpone — state=postponed (drži izvan queuea)
//   requeue  — vrati u queued (iz skipped/postponed/failed), očisti grešku
// Live listing SVIH CDN artefakata jednog videa (data/{id}/ + images/{id}/) direktno
// iz R2 bindinga — ne iz curated liste ključeva, pa pokazuje i buduće/neočekivane
// datoteke. Javni bucket nema directory listing, ovo je jedini potpun pogled.
admin.get('/jobs/:id/files', async (c) => {
  if (!c.env.CDN_BUCKET) {
    return c.text('CDN_BUCKET R2 binding nije konfiguriran (vidi wrangler.toml [[r2_buckets]]).', 503);
  }
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job) return c.text('Job ne postoji.', 404);
  const cdnBase = (c.env.CDN_BASE || 'https://cdn.domovina.ai').replace(/\/$/, '');
  // Dvije CDN zone istog videa (layout: vidi memory/docs — data = JSON/SRT/media,
  // images = thumbnaili/screenshotovi/OG). Listamo s cursor petljom jer screenshotova
  // + OG sličica zna biti preko default page sizea.
  const zones: { label: string; prefix: string }[] = [
    { label: 'Podaci (data/)', prefix: `data/${job.youtube_id}/` },
    { label: 'Slike (images/)', prefix: `images/${job.youtube_id}/` },
  ];
  const groups = [];
  for (const zone of zones) {
    const files: { key: string; size: number; uploaded: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await c.env.CDN_BUCKET.list({ prefix: zone.prefix, cursor, limit: 1000 });
      for (const o of page.objects) {
        files.push({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    files.sort((a, b) => a.key.localeCompare(b.key));
    groups.push({ ...zone, files });
  }
  return c.html(
    renderJobFilesPage({
      jobId: job.id,
      youtubeId: job.youtube_id,
      title: job.title,
      cdnBase,
      groups,
    })
  );
});

//   mag-on/mag-off       — uključi/isključi Magisterium namjeru za ovaj video
//   magisterium-hr/-en   — one-click: ubaci zahtjev za Magisterium (re)obradu (bridge poller ga pokrene)
admin.post('/jobs/:id/:action', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action');
  switch (action) {
    case 'delete':
      await softDeleteJob(c.env.DB, id);
      break;
    case 'restore':
      await restoreJob(c.env.DB, id);
      break;
    case 'purge':
      await deleteJob(c.env.DB, id);
      break;
    case 'skip':
      await updateJob(c.env.DB, id, { state: 'skipped' });
      break;
    case 'postpone':
      await updateJob(c.env.DB, id, { state: 'postponed' });
      break;
    case 'requeue':
      await updateJob(c.env.DB, id, { state: 'queued', error: null });
      break;
    case 'prioritize':
      // Admin digne queued job na prioritet (besplatno; naplata je samo na dashboard putu).
      // Radi i za jobove predane preko API ključa — admin "sponzorira" instant obradu.
      await prioritizeJob(c.env.DB, id, null, 3);
      break;
    case 'mag-on':
      await setJobMagisterium(c.env.DB, id, true);
      break;
    case 'mag-off':
      await setJobMagisterium(c.env.DB, id, false);
      break;
    case 'llm-model': {
      // Promjena backenda/modela koraka 7+8 (select u retku; samo dok job nije obrađen).
      const body = (await c.req.json().catch(() => ({}))) as { value?: string };
      const article = parseArticleModel(body.value);
      if (!article) return c.json({ error: `nepoznat model: ${body.value}` }, 400);
      await setJobLlmModel(c.env.DB, id, article.backend, article.model);
      break;
    }
    case 'mag-model': {
      // Promjena modela Magisterium runbooka. Vrijedi za SLJEDEĆI zahtjev — već queued/running
      // zahtjev nosi model koji je razriješen u trenutku enqueuea i ne mijenja se retroaktivno.
      const body = (await c.req.json().catch(() => ({}))) as { value?: string };
      const model = parseMagisteriumModel(body.value);
      if (!model) return c.json({ error: `nepoznat model: ${body.value}` }, 400);
      await setJobMagisteriumModel(c.env.DB, id, model);
      break;
    }
    case 'magisterium-hr':
    case 'magisterium-en': {
      const job = await getJob(c.env.DB, id);
      if (!job) return c.json({ error: 'not found' }, 404);
      const lang = action === 'magisterium-en' ? 'en' : 'hr';
      const { row, deduped } = await enqueueMagisteriumJob(c.env.DB, {
        youtubeId: job.youtube_id,
        lang,
        source: 'admin',
        model: job.magisterium_model, // namjera s joba; NULL → poller uzme svoj default
      });
      return c.json({ ok: true, magisterium: row, deduped });
    }
    default:
      return c.json({ error: `nepoznata akcija: ${action}` }, 400);
  }
  return c.json({ ok: true });
});

// ───────────────────────── Otkriveni videi (dnevne podliste) ─────────────────────────
// Zaseban queue od queuea obrade: ovdje su videi koje je nightly SAM povukao. Nitko ih
// ne obrađuje dok admin ne klikne "⚡ Prioritet" — tek tada nastane pravi `jobs` redak.

admin.get('/discovered', (c) => c.html(renderDiscoveredPage()));

// Promote = jedan klik → puna prioritetna obrada. Stvori `jobs` redak s priority=1 (isti
// tier kao ⚡ u queueu), pa ga prioritetni poller na Macu pokupi u sljedećem ticku i
// odvrti puni single-video pipeline (Modal transkripcija → članak → R2 → auto-reuse u kanal).
async function promoteDiscovered(
  env: Env,
  row: DiscoveredRow,
  models: { articleModel?: string; magisteriumModel?: string } = {},
): Promise<{ ok: boolean; jobId?: string; deduped?: boolean; reason?: string }> {
  if (row.state !== 'new') return { ok: false, reason: `već ${row.state}` };
  // Beamly audio-only (sintetički ID) nema pravi YouTube izvor — yt-dlp bi pao. Ne nudi se
  // u UI-u, ali API put gardiramo i ovdje.
  if (!row.promotable) return { ok: false, reason: 'nema YouTube izvor (beamly audio-only)' };

  // Dedup: ako za ovaj video već postoji aktivan job (npr. ručno dodan u queue), veži se
  // na njega umjesto da stvoriš drugi — dva joba za isti video utrkivala bi se na artefaktima.
  const existing = await findActiveJobByYoutubeId(env.DB, row.youtube_id);
  if (existing) {
    await markDiscoveredPromoted(env.DB, row.id, existing.id);
    return { ok: true, jobId: existing.id, deduped: true };
  }

  const article = parseArticleModel(models.articleModel);
  const job = await createJob(env.DB, {
    youtubeId: row.youtube_id,
    youtubeUrl: row.youtube_url,
    sourcePlatform: 'youtube',
    sourceUrl: row.youtube_url,
    title: row.title,
    channel: row.channel,
    source: 'discovered', // odakle je došao — nightly otkriće, ne ručni unos ni API
    priceCents: 0,
    priority: 1,
    creditCost: 3,
    withMagisterium: true,
    llmBackend: article?.backend,
    llmModel: article?.model,
    magisteriumModel: parseMagisteriumModel(models.magisteriumModel),
  });
  await markDiscoveredPromoted(env.DB, row.id, job.id);
  return { ok: true, jobId: job.id };
}

admin.post('/discovered/:id/:action', async (c) => {
  const row = await getDiscovered(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  switch (c.req.param('action')) {
    case 'promote': {
      // Modeli dolaze iz selecta u zaglavlju stranice (vrijedi za sve klikove na njoj).
      const body = (await c.req.json().catch(() => ({}))) as {
        article_model?: string;
        magisterium_model?: string;
      };
      const res = await promoteDiscovered(c.env, row, {
        articleModel: body.article_model,
        magisteriumModel: body.magisterium_model,
      });
      return res.ok ? c.json(res) : c.json({ error: res.reason }, 409);
    }
    case 'dismiss':
      await setDiscoveredState(c.env.DB, row.id, 'dismissed');
      break;
    case 'restore':
      await setDiscoveredState(c.env.DB, row.id, 'new');
      break;
    default:
      return c.json({ error: `nepoznata akcija: ${c.req.param('action')}` }, 400);
  }
  return c.json({ ok: true });
});

// "Pošalji cijelu podlistu" — promovira sve 'new' videe jednog dana. Iza confirm-a u UI-u
// jer N klikova × Modal run nije besplatno; zato i vraća točan broj poslanih.
admin.post('/discovered/batch/:date/promote', async (c) => {
  const batchDate = c.req.param('date');
  const body = (await c.req.json().catch(() => ({}))) as {
    article_model?: string;
    magisterium_model?: string;
  };
  const models = { articleModel: body.article_model, magisteriumModel: body.magisterium_model };
  const rows = await listDiscovered(c.env.DB, { batchDate, state: 'new', limit: 500 });
  let promoted = 0;
  const skipped: string[] = [];
  for (const row of rows) {
    const res = await promoteDiscovered(c.env, row, models);
    if (res.ok) promoted++;
    else skipped.push(row.youtube_id);
  }
  return c.json({ ok: true, promoted, skipped });
});

// JSON za auto-refresh: podliste (dnevni sažetci) + reci, grupirano na klijentu.
admin.get('/api/discovered', async (c) => {
  const state = c.req.query('state') || undefined;
  const [batches, rows, counts] = await Promise.all([
    listDiscoveredBatches(c.env.DB, 30),
    listDiscovered(c.env.DB, { state, limit: Number(c.req.query('limit') ?? 300) }),
    countDiscoveredByState(c.env.DB),
  ]);
  return c.json({ batches, discovered: rows, counts });
});

// ───────────────────────── API ključevi (server-rendered) ─────────────────────────
admin.get('/keys', async (c) => {
  const keys = await listApiKeys(c.env.DB);
  return c.html(renderKeysPage(keys));
});

// Kreiraj ključ → re-renderaj stranicu sa sirovim ključem prikazanim JEDNOM (flash).
admin.post('/keys', async (c) => {
  const form = await c.req.parseBody();
  const name = String(form.name ?? '').trim() || 'bez imena';
  const credits = Math.max(0, parseInt(String(form.credits ?? '0'), 10) || 0);
  const { row, rawKey } = await createApiKey(c.env.DB, name, credits);
  const keys = await listApiKeys(c.env.DB);
  return c.html(renderKeysPage(keys, { rawKey, name: row.name }));
});

// Akcije po ključu: credits (+/− ručno), enable/disable, delete.
admin.post('/keys/:id/:action', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action');
  switch (action) {
    case 'credits': {
      const form = await c.req.parseBody().catch(() => ({}));
      const amount = parseInt(String((form as Record<string, unknown>).amount ?? '0'), 10) || 0;
      await addApiKeyCredits(c.env.DB, id, amount);
      break;
    }
    case 'enable':
      await setApiKeyEnabled(c.env.DB, id, true);
      break;
    case 'disable':
      await setApiKeyEnabled(c.env.DB, id, false);
      break;
    case 'delete':
      await deleteApiKey(c.env.DB, id);
      break;
    default:
      return c.text(`nepoznata akcija: ${action}`, 400);
  }
  return c.redirect('/admin/keys', 303);
});

// JSON za client-side auto-refresh tablice (paginirano + filter + search).
admin.get('/api/jobs', async (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);
  const state = c.req.query('state') || undefined;
  const q = c.req.query('q') || undefined;
  const jobs = await listJobs(c.env.DB, { limit, offset, state, q });
  // Self-heal prije brojanja: ne-terminalni jobovi čiji je članak već live → 'done'
  // (da status pill ne laže; counts ispod tada odražavaju izliječeno stanje).
  await reconcilePublishedJobs(
    c.env.DB,
    c.env.CDN_BASE || 'https://cdn.domovina.ai',
    c.env.SITE_BASE || 'https://domovina.ai',
    jobs,
  );
  const [counts, total] = await Promise.all([
    countByState(c.env.DB), // globalni brojevi po stanju (jeftin GROUP BY) — za stats trake/filter
    countJobs(c.env.DB, { state, q }), // total za trenutni filter → pager
  ]);
  return c.json({ counts, jobs, total, limit, offset });
});

// Granularni pipeline status za jedan job: probe CDN artefakte i vrati po-korak
// stanje (done/pending/skipped). Puni expandable "koraci" prikaz u tablici.
admin.get('/api/jobs/:id/pipeline', async (c) => {
  const job = await getJob(c.env.DB, c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  const cdnBase = c.env.CDN_BASE || 'https://cdn.domovina.ai';
  // Tokeni dolaze iz D1 (nightly ih puni iz Claude Code sesija), a ne iz CDN probe-a — zato
  // se pripajaju ovdje, a buildPipelineReport ostaje čist "što je na CDN-u" izvještaj.
  const [report, tokens] = await Promise.all([
    buildPipelineReport(cdnBase, job, c.env.SITE_BASE || 'https://domovina.ai'),
    getTokenUsage(c.env.DB, job.youtube_id),
  ]);
  return c.json({ ...report, tokens });
});
