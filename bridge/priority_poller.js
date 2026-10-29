#!/usr/bin/env node
/**
 * priority_poller.js — prioritetni fast-path poller (Mac Mini).
 *
 * Za razliku od claim_and_dispatch.js (KORAK 0 noćnog runa, samo download → transcribing,
 * pa Colab bulk transkribira), ovaj poller cilja SAMO prioritetne jobove i za svaki odmah
 * pokreće PUNI single-video pipeline s Modal transkripcijom → domovina.ai članak za ~10-15 min.
 *
 * Trči često (launchd StartInterval preko automatic/priority_pipeline.sh, uz flock da ne
 * kolidira s noćnim bulkom). Po jobu:
 *   claim (priority:true) → run_pipeline.sh --unlisted-url ... --with-modal-transcribe
 *   --modal-only <id> --with-local-canary-diarize --with-r2-upload
 *   [--with-soniox --with-pyannote-ai --gemini-refine-promote + env GEMINI_REFINE_SKELETON=auto]
 *   (default, kao nightly od 24.10.2026.; samo transcription='canary' ide bez toga — plan.js)
 *   → uspjeh (info.json u _unlisted) → PATCH transcribing; neuspjeh → PATCH failed.
 * Wrapper nakon toga pokrene reconcile.js koji gotove flipne u done + detail_url.
 *
 * Env (isti kao bridge):
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno — Bearer za /api/jobs/*)
 *   FETCH_REPO                 (default sibling ../fetch.domovina.tv)
 *   PRIORITY_MAX               (default 3 — koliko prioritetnih po ticku)
 *   PRIORITY_DAILY_MAX         (default 30 — koliko prioritetnih po lokalnom danu, ukupno)
 *   PRIORITY_BUDGET_FILE       (default ~/.cache/domovina-pipeline/priority_budget.json)
 *
 * Dnevni budžet je zadnja kočnica za novac (Soniox/pyannoteAI/Speechmatics/Modal/LLM): drži se LOKALNO, pa
 * vrijedi i kad je Worker/baza kompromitirana (incident 14.10. — kroz admin bypass moglo se
 * ubaciti 10 000 prioritetnih jobova). Kad je potrošen, poller ne claima ništa do ponoći;
 * jobovi čekaju u queued. Svjesno više za danas: PRIORITY_DAILY_MAX u plistu ili obriši fajl.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const INGEST_KEY = process.env.PIPELINE_QUEUE_INGEST_KEY;
const FETCH_REPO = process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');
const PRIORITY_MAX = parseInt(process.env.PRIORITY_MAX || '3', 10);
const PRIORITY_DAILY_MAX = parseInt(process.env.PRIORITY_DAILY_MAX || '30', 10);
const BUDGET_FILE =
  process.env.PRIORITY_BUDGET_FILE ||
  path.join(require('os').homedir(), '.cache', 'domovina-pipeline', 'priority_budget.json');
const UNLISTED_DIR = path.join(FETCH_REPO, 'storage', 'output', '_unlisted');
const RUN_PIPELINE = path.join(FETCH_REPO, 'run_pipeline.sh');
const SITE_BASE = process.env.SITE_BASE || 'https://domovina.ai';
// Mapiranje izbora joba → zastavice (i whitelist backenda) živi u plan.js, pokriven testom.
const { planFor, transcriptionFlow, FLOW_LABELS } = require('./plan');

if (!INGEST_KEY) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem prioritetni poller.');
  process.exit(0); // soft: launchd tick ne smije "pasti"
}

// spawnSync run_pipeline.sh blokira event loop 10+ min; keep-alive socket koji je server u
// međuvremenu zatvorio undici iskoristi za prvi sljedeći PATCH → "fetch failed", iznimka
// izađe iz petlje i ostali claimani jobovi tick-a vise u 'fetching' do sweepa (19.10.).
// Retry samo za idempotentne pozive; POST /claim bi ponovnim slanjem claimao još jobova.
async function api(method, pathname, body) {
  const tries = method === 'POST' ? 1 : 3;
  let res;
  for (let i = 1; ; i++) {
    try {
      res = await fetch(PIPELINE_QUEUE_BASE + pathname, {
        method,
        headers: { authorization: 'Bearer ' + INGEST_KEY, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      break;
    } catch (e) {
      if (i >= tries) throw e;
      console.error(`  ↻ ${method} ${pathname}: ${e.message} (${e.cause?.code || '?'}) — pokušaj ${i + 1}/${tries}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${await res.text()}`);
  return res.json();
}

// Sadrži li izvor fetch skripte zadani token (feature detection ugovora iz plan.js).
function sourceHas(file, token) {
  try {
    return fs.readFileSync(file, 'utf-8').includes(token);
  } catch {
    return false;
  }
}

function downloaded(youtubeId) {
  try {
    return fs
      .readdirSync(UNLISTED_DIR)
      .some((f) => f.includes('_yt_' + youtubeId) && f.endsWith('.info.json'));
  } catch {
    return false;
  }
}

// Ograda Claude prozora (fetch.domovina.tv lib/claude_window.js) odgađa korake 7+8 bez
// greške: run prođe, ali članka nema. Ako ga nema, pitaj istog arbitra zašto — razlog ide u
// admin (badge + gumb „▶ Članak ipak sada"). null = nije odgođen (članak postoji, ograda je
// bila ugašena ili arbitar sada pušta, pa je uzrok nešto drugo).
function llmDeferred(youtubeId, env) {
  if (env.CLAUDE_WINDOW_GUARD !== '1') return null;
  try {
    const hasArticle = fs
      .readdirSync(UNLISTED_DIR)
      .some((f) => f.includes('_yt_' + youtubeId) && f.endsWith('.article.json'));
    if (hasArticle) return null;
  } catch {
    return null;
  }
  const r = spawnSync(process.env.CLAUDE_WINDOW_BIN || 'claude-window', ['check'], { encoding: 'utf-8' });
  if (r.status !== 10) return null;
  return (r.stderr || '').replace(/^claude-window:\s*/, '').trim() || 'ograda Claude prozora';
}

function readMeta(youtubeId) {
  try {
    const f = fs
      .readdirSync(UNLISTED_DIR)
      .find((x) => x.includes('_yt_' + youtubeId) && x.endsWith('.info.json'));
    if (!f) return null;
    const j = JSON.parse(fs.readFileSync(path.join(UNLISTED_DIR, f), 'utf-8'));
    return {
      title: j.title || j.fulltitle || null,
      channel: j.channel || j.uploader || null,
      duration_seconds: Number.isFinite(j.duration) ? Math.round(j.duration) : null,
    };
  } catch {
    return null;
  }
}

// Lokalni datum (Mac Mini), ne UTC — "dan" kako ga vidi vlasnik.
// Osvježi redak u inventaru epizoda (/admin/episodes) za jedan video — bez čekanja nightlyja.
// Best-effort: report_inventory.js sam soft-exita, a greška ovdje ne smije srušiti tick.
function reportInventory(youtubeId) {
  try {
    spawnSync('node', [path.join(__dirname, 'report_inventory.js'), '--video-id', youtubeId], { stdio: 'inherit' });
  } catch (e) {
    console.log(`  ⚠️ inventar nije osvježen: ${e.message}`);
  }
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readBudget() {
  try {
    const b = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf-8'));
    if (b.date === today() && Number.isFinite(b.claimed)) return b;
  } catch {}
  return { date: today(), claimed: 0 };
}

function writeBudget(b) {
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  const tmp = BUDGET_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(b));
  fs.renameSync(tmp, BUDGET_FILE);
}

(async () => {
  const budget = readBudget();
  const left = PRIORITY_DAILY_MAX - budget.claimed;
  if (left <= 0) {
    // Jednom dnevno glasno u log (tick je svakih 90 s), inače tiho.
    if (!budget.warned) {
      console.error(`⛔ priority_budget_exhausted: ${budget.claimed}/${PRIORITY_DAILY_MAX} prioritetnih danas — ne claimam do ponoći.`);
      writeBudget({ ...budget, warned: true });
    }
    return;
  }
  const { jobs } = await api('POST', '/api/jobs/claim', { max: Math.min(PRIORITY_MAX, left), priority: true });
  // Broji se claim, ne uspjeh: i neuspjeli run je mogao potrošiti plaćene korake.
  if (jobs.length) writeBudget({ ...budget, claimed: budget.claimed + jobs.length });
  if (!jobs.length) {
    console.log('📭 Nema prioritetnih jobova.');
    return;
  }
  console.log(`⚡ Claimano ${jobs.length} PRIORITETNIH jobova (danas ${budget.claimed + jobs.length}/${PRIORITY_DAILY_MAX}).`);
  // Što fetch strana podržava (ugovor u plan.js). Čita se iz izvora, jer je fetch repo
  // radno stablo (bez verzija) — provjera PRIJE claimanog runa, ne nakon plaćenih koraka.
  const caps = {
    replace: sourceHas(path.join(FETCH_REPO, 'auto_reuse_adhoc.js'), '"--replace"'),
    reprocess: sourceHas(RUN_PIPELINE, '"--reprocess"'),
    reprocessArticle: sourceHas(RUN_PIPELINE, '"--reprocess-article"'),
  };
  for (const job of jobs) {
    console.log(`\n→ ⚡ ${job.youtube_id} (${job.id})${job.reprocess ? ' 🔁 ponovna obrada' : ''}`);
    const plan = planFor(job, caps);
    if (plan.error) {
      await api('PATCH', `/api/jobs/${job.id}`, { state: 'failed', error: plan.error });
      console.log(`  ❌ ${plan.error}`);
      continue;
    }
    // NB: ne diramo ANTHROPIC_API_KEY; ako je postavljen, run_pipeline.sh već upozori da bi
    // claude CLI mogao naplaćivati per-token umjesto da koristi pretplatu.
    const env = { ...process.env, ...plan.env };
    if (job.llm_backend && job.llm_backend !== 'vertex') {
      console.log(`  🤖 koraci 7+8: ${job.llm_backend}${plan.env.CLAUDE_MODEL ? ' (CLAUDE_MODEL=' + plan.env.CLAUDE_MODEL + ')' : ''}`);
    }

    if (plan.mode === 'none') {
      // Samo Magisterium iznova: nema runa. done → cron auto-enqueue (force=1).
      await api('PATCH', `/api/jobs/${job.id}`, { state: 'done', detail_url: `${SITE_BASE}/v/${job.youtube_id}` });
      console.log('  ✅ ništa za pokrenuti (samo Magisterium) → done; Magisterium ide kroz cron s force');
      continue;
    }

    if (plan.mode === 'article-only') {
      console.log('  📝 samo novi članak nad postojećim prijepisom');
      const r = spawnSync(RUN_PIPELINE, plan.args, { cwd: FETCH_REPO, stdio: 'inherit', env });
      // done stiže kroz reconcile kad NOVI article.json bude na CDN-u (isFreshFor).
      const deferred = r.status === 0 ? llmDeferred(job.youtube_id, env) : null;
      if (deferred) console.log(`  ⏸️  koraci 7+8 odgođeni: ${deferred}`);
      await api('PATCH', `/api/jobs/${job.id}`, r.status === 0
        ? { state: 'processing', llm_deferred: deferred }
        : { state: 'failed', error: `run_pipeline.sh --reprocess-article izašao s ${r.status}` });
      continue;
    }

    console.log(`  🎙 transkripcija: ${FLOW_LABELS[transcriptionFlow(job)]}`);
    spawnSync(RUN_PIPELINE, plan.args, { cwd: FETCH_REPO, stdio: 'inherit', env });

    // Ne vjeruj exit kodu (run_pipeline je set -e-toleran, non-fatalni koraci); provjeri disk.
    if (!downloaded(job.youtube_id)) {
      await api('PATCH', `/api/jobs/${job.id}`, {
        state: 'failed',
        error: 'prioritetni download nije uspio (private/anti-bot?) — nema info.json u _unlisted',
      });
      console.log(`  ❌ nema info.json → failed`);
      continue;
    }
    const meta = readMeta(job.youtube_id) || {};
    const deferred = llmDeferred(job.youtube_id, env);
    await api('PATCH', `/api/jobs/${job.id}`, { state: 'transcribing', llm_deferred: deferred, ...meta });
    console.log(`  ✅ obrađeno (Modal) → transcribing${meta.channel ? ' (' + meta.channel + ')' : ''}`);
    if (deferred) console.log(`  ⏸️  koraci 7+8 odgođeni: ${deferred} — admin: „▶ Članak ipak sada"`);

    // Auto-reuse za praćene kanale: ako video pripada nekoj automatic/podcasts listi
    // i kanal ga je već fetchao, prekopiraj ad-hoc artefakte u channel dir + reindex
    // da na kanalu ne stoji "U OBRADI". Za NOVE videe best-effort (nightly sweep
    // auto_reuse_adhoc.js --sweep pokupi propušteno). Za PONOVNU OBRADU (--replace)
    // je obavezan: bez njega channel dir ostane na starom, a sljedeći upload iz njega
    // vrati STARI članak/prijepis na CDN.
    const autoReuse = path.join(FETCH_REPO, 'auto_reuse_adhoc.js');
    if (fs.existsSync(autoReuse)) {
      const r = spawnSync('node', [autoReuse, ...plan.reuseArgs], { cwd: FETCH_REPO, stdio: 'inherit' });
      if (job.reprocess && r.status !== 0) {
        await api('PATCH', `/api/jobs/${job.id}`, {
          state: 'failed',
          error: `auto_reuse_adhoc.js --replace izašao s ${r.status} — channel dir/CDN možda nisu prepisani`,
        });
        console.log('  ❌ --replace nije uspio → failed');
      }
    }
    reportInventory(job.youtube_id);
  }
})().catch((e) => {
  console.error('⚠️ priority_poller greška:', e.message);
  process.exit(0); // soft fail — launchd tick ne ruši ništa
});
