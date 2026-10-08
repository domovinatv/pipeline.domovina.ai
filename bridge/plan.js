/**
 * plan.js — prevodi prioritetni job (izbori iz admina / API-ja) u ono što priority_poller.js
 * pokreće u fetch.domovina.tv. Čista funkcija bez I/O-a, da je mapiranje izbor → zastavice
 * pokriveno testom (plan.test.js) — poller samo izvršava plan.
 *
 * Modovi:
 *   pipeline     — run_pipeline.sh --unlisted-url … (fetch + transkripcija + članak + upload).
 *                  transcription='speechmatics' dodaje --with-speechmatics --gemini-refine-promote
 *                  (kao nightly); Modal Canary ostaje uključen NAMJERNO (drugi, neovisan transkript).
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
 *   • run_pipeline.sh --reprocess-article <id>  (vidi article-only gore)
 * Dok fetch strana nema ove zastavice, plan vrati `error` i job odmah ide u failed — PRIJE
 * ikakvog plaćenog koraka, umjesto da run prođe i tiho ostavi stari CDN.
 */
const LLM_BACKENDS = ['vertex', 'cli', 'claude', 'agy'];

/**
 * @param {object} job   red iz /api/jobs/claim
 * @param {{replace: boolean, reprocessArticle: boolean}} caps  što fetch strana podržava
 * @returns {{mode: 'pipeline'|'article-only'|'none', args: string[], env: object,
 *            reuseArgs: string[]|null, error: string|null}}
 */
function planFor(job, caps) {
  const isX = typeof job.source === 'string' && job.source.startsWith('x');
  // Nepoznat/izostavljen backend → 'vertex' (dosadašnje ponašanje).
  const backend = LLM_BACKENDS.includes(job.llm_backend) ? job.llm_backend : 'vertex';
  const backendArgs = backend !== 'vertex' ? ['--gemini-backend', backend] : [];
  // CLAUDE_MODEL čitaju summarize_gemini.js i generate_article_gemini.js (env > gemini.conf >
  // 'opus'). Postavlja se SAMO za claude backend — inače je varijabla no-op, ali bi zbunjivala.
  const env = backend === 'claude' && job.llm_model ? { CLAUDE_MODEL: job.llm_model } : {};
  const reprocess = job.reprocess === 1;
  const transcription = job.transcription || 'canary';
  const plan = { mode: 'pipeline', args: [], env, reuseArgs: null, error: null };

  if (reprocess && transcription === 'none') {
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
    // Kao nightly: Speechmatics kostur (2.7) + Gemini sluh (2.8) popuni kanonski
    // .wav.canary.diarized.srt → pyannote (6) se preskoči, a 9.87 napravi words.json.
    // Fetch strana scope-a 2.7/2.8 na --modal-only video, bez prozora svježine.
    ...(transcription === 'speechmatics' ? ['--with-speechmatics', '--gemini-refine-promote'] : []),
  ];
  // Auto-reuse u channel dir (best-effort za nove videe; za ponovnu obradu OBAVEZAN prepis).
  plan.reuseArgs = ['--video-id', job.youtube_id, ...(reprocess ? ['--replace'] : [])];
  return plan;
}

module.exports = { planFor, LLM_BACKENDS };
