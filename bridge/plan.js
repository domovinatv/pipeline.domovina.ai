/**
 * plan.js — prevodi prioritetni job (izbori iz admina / API-ja) u ono što priority_poller.js
 * pokreće u fetch.domovina.tv. Čista funkcija bez I/O-a, da je mapiranje izbor → zastavice
 * pokriveno testom (plan.test.js) — poller samo izvršava plan.
 *
 * Modovi:
 *   pipeline     — run_pipeline.sh --unlisted-url … (fetch + transkripcija + članak + upload).
 *                  Transkripcija (vidi transcriptionFlow niže) — DEFAULT je isti tok kao nightly
 *                  od 24.10.2026.: --with-soniox --with-pyannote-ai --gemini-refine-promote uz env
 *                  GEMINI_REFINE_SKELETON=auto. Modal Canary (2.6) i lokalni pyannote (6) ostaju
 *                  uključeni NAMJERNO — osigurač kad cloud tok ne promovira prijepis.
 *                  transcription='canary' = samo Modal Canary + pyannote (jeftino).
 *   article-only — ponovna obrada bez novog prijepisa: run_pipeline.sh --reprocess-article <id>
 *                  (fetch strana nađe epizodu, regenerira 7+8 nad POSTOJEĆIM prijepisom i
 *                  prisilno uploada article/summary/outline s purgeom).
 *   none         — ponovna obrada samo Magisteriuma: nema runa; job ide ravno u done, a cron
 *                  auto-enqueue ubaci Magisterium s force=1.
 *
 * Ugovor prema fetch.domovina.tv (gradi se iz sesije u TOM repou, pravilo #1 njegovog CLAUDE.md):
 *   • auto_reuse_adhoc.js --video-id <id> --replace
 *       kanal već ima obradu → kopiraj _unlisted artefakte pod PRAVIM channel basenameom,
 *       stare preimenuj u .bak (nikad delete), reindex, pa prisilno uploadaj diarized.srt +
 *       words.json + article/summary/outline s purgeom — SRT i words.json na CDN-u nikad iz
 *       različitih prolaza. Bez --replace ponašanje ostaje no-op kao danas.
 *   • run_pipeline.sh --reprocess  (uz --modal-only): PRIJE runa skloni stare izvedene
 *       fajlove iz _unlisted (inače 2.8 ne promovira novi prijepis jer stari postoji, a 7+8
 *       preskoče postojeći članak), a nakon KORAKA 12 prisilno prepiše immutable CDN ključeve.
 *   • run_pipeline.sh --reprocess-article <id>  (vidi article-only gore)
 * Dok fetch strana nema ove zastavice, plan vrati `error` i job odmah ide u failed — PRIJE
 * ikakvog plaćenog koraka, umjesto da run prođe i tiho ostavi stari CDN.
 */
const LLM_BACKENDS = ['vertex', 'cli', 'claude', 'agy'];

// ─── Transkripcija ───
// `jobs.transcription` dolazi iz Workera (backend/src/types.ts TRANSCRIPTIONS):
// 'soniox' (default u adminu i /api/v1) | 'canary' | 'none' (samo ponovna obrada).
// 'soniox' = cloud tok kao nightly od 24.10.2026.: Soniox tekst (2.7b) + pyannoteAI govornici
// (2.7c) + Gemini sluh nad tim kosturom (2.8, promote). Speechmatics nije izbačen — 2.7b ga
// sam zove kao fallback kad Soniox padne ili nema kredita, a 2.8 `auto` tada uzme
// speechmatics_pyannote kostur. 'speechmatics' je zastarjela vrijednost (stari D1 reci, koji
// mogu još čekati u redu) i ide istim cloud tokom.
// Sve osim eksplicitnog 'canary' ide cloud tokom: jeftini put mora biti izričit izbor,
// a izostavljena vrijednost = default kao nightly.
// 28.10.2026.: bez Gemini sluha i Speechmaticsa, isto kao nightly — 2.8 samo promovira
// Soniox+pyannoteAI kostur (fetch.domovina.tv docs/2026-10-28-bez-gemini-sluha-i-speechmaticsa.md).
const CLOUD_FLOW_ARGS = ['--with-soniox', '--with-pyannote-ai', '--gemini-refine-promote', '--no-gemini-ear', '--no-speechmatics'];
// run_pipeline.sh čita kostur za 2.8 iz env-a (default 'speechmatics' = stari put); 'auto'
// po epizodi uzme prvi postojeći: soniox_pyannote → speechmatics_pyannote → speechmatics.
// Env, ne CLI zastavica: točno ovako ga zove nightly (automatic/nightly_pipeline.sh), a
// planer ionako vraća env koji poller spoji preko process.env.
const CLOUD_FLOW_ENV = { GEMINI_REFINE_SKELETON: 'auto' };

/** @returns {'cloud'|'canary'|'none'}  cloud = Soniox + pyannoteAI + Gemini sluh (default) */
function transcriptionFlow(job) {
  if (job.transcription === 'none') return 'none';
  if (job.transcription === 'canary') return 'canary';
  return 'cloud';
}

const FLOW_LABELS = {
  cloud: 'Soniox + pyannoteAI + Gemini sluh (+ Modal Canary osigurač)',
  canary: 'Modal Canary + pyannote',
  none: 'bez novog prijepisa',
};

/**
 * @param {object} job   red iz /api/jobs/claim
 * @param {{replace: boolean, reprocess: boolean, reprocessArticle: boolean}} caps  što fetch strana podržava
 * @returns {{mode: 'pipeline'|'article-only'|'none', args: string[], env: object,
 *            reuseArgs: string[]|null, error: string|null}}
 */
function planFor(job, caps) {
  const isX = typeof job.source === 'string' && job.source.startsWith('x');
  // Nepoznat/izostavljen backend → 'vertex' = bez zastavice, pa run_pipeline.sh ide na svoj
  // default (claude). Sam Vertex je DEPRECATED od 29.10.2026. i skripte ga odbijaju.
  const backend = LLM_BACKENDS.includes(job.llm_backend) ? job.llm_backend : 'vertex';
  const backendArgs = backend !== 'vertex' ? ['--gemini-backend', backend] : [];
  // CLAUDE_MODEL čitaju summarize_gemini.js i generate_article_gemini.js (env > gemini.conf >
  // 'opus'). Postavlja se SAMO za claude backend — inače je varijabla no-op, ali bi zbunjivala.
  const env = backend === 'claude' && job.llm_model ? { CLAUDE_MODEL: job.llm_model } : {};
  const reprocess = job.reprocess === 1;
  const flow = transcriptionFlow(job);
  const plan = { mode: 'pipeline', args: [], env, reuseArgs: null, error: null };

  if (reprocess && flow === 'none') {
    if (job.redo_article === 0) return { ...plan, mode: 'none' };
    if (!caps.reprocessArticle) {
      return {
        ...plan,
        mode: 'article-only',
        error: 'fetch.domovina.tv još nema run_pipeline.sh --reprocess-article (ponovna obrada samo članka) — nije ništa pokrenuto',
      };
    }
    return { ...plan, mode: 'article-only', args: ['--reprocess-article', job.youtube_id, ...backendArgs] };
  }

  if (reprocess && !caps.replace) {
    return {
      ...plan,
      error: 'fetch.domovina.tv još nema auto_reuse_adhoc.js --replace (prepis channel dira + CDN-a) — nije ništa pokrenuto',
    };
  }
  if (reprocess && !caps.reprocess) {
    return {
      ...plan,
      error: 'fetch.domovina.tv još nema run_pipeline.sh --reprocess (sklanjanje stare obrade + prisilni CDN prepis) — nije ništa pokrenuto',
    };
  }

  plan.args = [
    '--unlisted-url', job.youtube_url,
    ...(job.title ? ['--unlisted-title', job.title] : []),
    // Backend upisuje source='x-admin'/'x-api' za X postove i minta 11-znakovni youtube_id
    // (sintetički), pa ga eksplicitno prosljeđujemo fetch.js-u (ne izvodi se iz X URL-a).
    ...(isX ? ['--unlisted-id', job.youtube_id, '--unlisted-source', 'x'] : []),
    '--with-modal-transcribe', '--modal-only', job.youtube_id,
    '--with-local-canary-diarize', '--with-r2-upload',
    // Prosljeđuj samo kad NIJE default — nightly/backfill pozivi ostaju bit-identični.
    ...backendArgs,
    // Kao nightly: Soniox (2.7b) + pyannoteAI (2.7c) kostur, Gemini sluh (2.8) popuni
    // kanonski .wav.canary.diarized.srt → pyannote (6) se preskoči, a 9.87 napravi words.json.
    // Fetch strana scope-a 2.7b/2.7c/2.8 na --modal-only video (PRIORITY_SCOPE_ARGS), bez
    // prozora svježine — ad-hoc video smije biti star godinama.
    ...(flow === 'cloud' ? CLOUD_FLOW_ARGS : []),
    // Ponovna obrada: fetch strana skloni staru _unlisted obradu prije runa i nakon
    // KORAKA 12 prisilno prepiše diarized.srt + words.json (+ članak, epub) na CDN-u.
    ...(reprocess ? ['--reprocess'] : []),
  ];
  if (flow === 'cloud') plan.env = { ...plan.env, ...CLOUD_FLOW_ENV };
  // Auto-reuse u channel dir (best-effort za nove videe; za ponovnu obradu OBAVEZAN prepis).
  plan.reuseArgs = ['--video-id', job.youtube_id, ...(reprocess ? ['--replace'] : [])];
  return plan;
}

module.exports = { planFor, transcriptionFlow, FLOW_LABELS, LLM_BACKENDS, CLOUD_FLOW_ARGS, CLOUD_FLOW_ENV };
