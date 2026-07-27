#!/usr/bin/env node
/**
 * magisterium_poller.js — Magisterium (re)obrada poller (Mac Mini).
 *
 * Cloud queue (pipeline.domovina.ai) drži `magisterium_jobs` zahtjeve: admin ih stvara
 * gumbom u /admin ("🕊 Mag HR/EN"), a cron auto-enqueuea HR za done jobove s uključenim
 * Magisteriumom. Ovaj poller ih claima i za svaki pokrene PUNI hibridni Magisterium MCP
 * workflow (fetch.domovina.tv/docs/MAGISTERIUM_MCP_RUN.md) headless preko Claude Code CLI,
 * pa verificira artefakt na CDN-u i javi ishod natrag u queue.
 *
 * ZAŠTO Claude Code, a ne node skripta: produkcijski Magisterium ide ISKLJUČIVO preko
 * Magisterium MCP-a (prep → chat → assemble), koji je LLM-driven. Runbook je pisan tako da
 * ga Claude Code odradi autonomno. Poller je samo "ruka" koja ga pokreće po zahtjevu.
 *
 * Po zahtjevu:
 *   1) CDN pre-check — ako artefakt VEĆ postoji (article.magisterium[.en].json 200) → done
 *      (idempotentno; ne troši tokene na ono što je gotovo — bitno za auto-enqueue granu).
 *   2) inače: claude -p "@docs/MAGISTERIUM_MCP_RUN.md <VID> [+EN]" (cwd = FETCH_REPO).
 *   3) CDN verifikacija (GET, ne HEAD — CF cache-ira 404) → done | failed(+error).
 *
 * Env:
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno — Bearer za /api/magisterium/*)
 *   FETCH_REPO                 (default sibling ../fetch.domovina.tv)
 *   CDN_BASE                   (default https://cdn.domovina.ai)
 *   CLAUDE_BIN                 (default 'claude' — Claude Code CLI, mora imati Magisterium MCP)
 *   CLAUDE_MODEL               (default 'opus' — DETERMINISTIČKI model; bez toga CLI uzme zadnje
 *                               korišteni pa kvaliteta varira Fable/Sonnet/Haiku/Opus)
 *   CLAUDE_PERMISSION_MODE     (default 'bypassPermissions' — headless runbook radi bash/MCP/R2 bez interakcije)
 *   MAG_MAX                    (default 2 — koliko zahtjeva po ticku; chat je rate-limitiran 15/min)
 *   MAG_RUNNER                 ('claude' default | 'manual' = samo ispiši komande, ne pokreći/claimaj)
 *   MAG_RUN_TIMEOUT_MS         (default 3_600_000 = 60 min po videu; run traje ~14 min prosjek)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const INGEST_KEY = process.env.PIPELINE_QUEUE_INGEST_KEY;
const FETCH_REPO = process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');
const CDN_BASE = (process.env.CDN_BASE || 'https://cdn.domovina.ai').replace(/\/$/, '');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || 'bypassPermissions';
// DETERMINISTIČKI model za Magisterium runbook. Bez ovoga Claude Code CLI koristi
// ZADNJE korišteni model (može biti Fable/Sonnet/Haiku) → nedeterministična kvaliteta.
// Magisterium teološka obrada traži Opus. Overridable preko env, ali default = opus.
// Od 2026-07: zahtjev iz queuea može nositi VLASTITI model (job.model, admin ga bira po
// videu) — tada on pobjeđuje ovaj env default. NULL na zahtjevu → ostaje CLAUDE_MODEL.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'opus';
// Modeli koje smijemo proslijediti CLI-ju. Whitelist jer `--model <smeće>` ruši run,
// a vrijednost dolazi iz baze (drugi servis) — ne vjerujemo joj na slijepo.
const ALLOWED_MODELS = ['opus', 'sonnet', 'haiku'];
const MAG_MAX = parseInt(process.env.MAG_MAX || '2', 10);
const MAG_RUNNER = process.env.MAG_RUNNER || 'claude';
const RUN_TIMEOUT_MS = parseInt(process.env.MAG_RUN_TIMEOUT_MS || '3600000', 10);

if (!INGEST_KEY) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem Magisterium poller.');
  process.exit(0); // soft: launchd tick ne smije "pasti"
}

async function api(method, pathname, body) {
  const res = await fetch(PIPELINE_QUEUE_BASE + pathname, {
    method,
    headers: { authorization: 'Bearer ' + INGEST_KEY, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${await res.text()}`);
  return res.json();
}

// Model za jedan zahtjev: izbor s njega (admin) ako je dozvoljen, inače env/default.
// Nepoznata vrijednost se NE prosljeđuje — pada na default uz upozorenje, jer bi rušila run.
function modelFor(job) {
  if (!job.model) return CLAUDE_MODEL;
  if (ALLOWED_MODELS.includes(job.model)) return job.model;
  console.error(`  ⚠️ nepoznat model '${job.model}' na zahtjevu — koristim '${CLAUDE_MODEL}'`);
  return CLAUDE_MODEL;
}

// CDN artefakt po jeziku: HR → article.magisterium.json, EN → article.magisterium.en.json.
function artifactName(lang) {
  return lang === 'en' ? 'article.magisterium.en.json' : 'article.magisterium.json';
}

// Postoji li artefakt? GET s Range bytes=0-0 (ne HEAD — Cloudflare cache-ira 404 po točnom URL-u).
async function artifactExists(youtubeId, lang) {
  try {
    const r = await fetch(`${CDN_BASE}/data/${youtubeId}/${artifactName(lang)}`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}

// Pokreni hibridni Magisterium MCP runbook headless preko Claude Code CLI. EN se traži samo
// eksplicitno (runbook default = HR-only). Vrati true ako je CLI izašao bez fatalne greške
// (svejedno se oslanjamo na CDN verifikaciju kao izvor istine, ne na exit kod).
function runRunbook(youtubeId, lang, model) {
  const suffix = lang === 'en' ? ' +EN' : '';
  const prompt = `@docs/MAGISTERIUM_MCP_RUN.md ${youtubeId}${suffix}`;
  const args = ['-p', prompt];
  const useModel = model || CLAUDE_MODEL;
  if (useModel) args.push('--model', useModel);
  if (CLAUDE_PERMISSION_MODE) args.push('--permission-mode', CLAUDE_PERMISSION_MODE);
  const r = spawnSync(CLAUDE_BIN, args, {
    cwd: FETCH_REPO,
    stdio: 'inherit',
    timeout: RUN_TIMEOUT_MS,
  });
  if (r.error) {
    console.error(`  ⚠️ Claude CLI greška: ${r.error.message}`);
    return false;
  }
  return true;
}

(async () => {
  // Manual mod: samo ispiši queued zahtjeve + točne komande za ručno pokretanje (bez claima).
  if (MAG_RUNNER === 'manual') {
    const { jobs } = await api('GET', '/api/magisterium?state=queued');
    if (!jobs.length) return console.log('📭 Nema queued Magisterium zahtjeva.');
    console.log(`📋 ${jobs.length} queued Magisterium zahtjeva (MAG_RUNNER=manual — pokreni ručno):`);
    for (const j of jobs) {
      console.log(`  • ${j.youtube_id} [${j.lang}] → cd ${FETCH_REPO} && ${CLAUDE_BIN} --model ${modelFor(j)} -p "@docs/MAGISTERIUM_MCP_RUN.md ${j.youtube_id}${j.lang === 'en' ? ' +EN' : ''}"`);
    }
    return;
  }

  const { jobs } = await api('POST', '/api/magisterium/claim', { max: MAG_MAX });
  if (!jobs.length) return console.log('📭 Nema Magisterium zahtjeva.');
  console.log(`🕊 Claimano ${jobs.length} Magisterium zahtjeva.`);

  for (const job of jobs) {
    const tag = `${job.youtube_id} [${job.lang}]`;
    console.log(`\n→ 🕊 ${tag} (${job.id})`);

    // 1) Već obrađeno? (auto-enqueue znatno češće pogodi ovo nego admin gumb.)
    if (await artifactExists(job.youtube_id, job.lang)) {
      await api('PATCH', `/api/magisterium/${job.id}`, { state: 'done' });
      console.log(`  ✅ artefakt već na CDN-u → done (preskočen run)`);
      continue;
    }

    // 2) Pokreni runbook headless — modelom koji nosi sam zahtjev (admin izbor po videu).
    const model = modelFor(job);
    console.log(`  ▶ pokrećem MCP runbook (${CLAUDE_BIN} --model ${model} -p …) — može potrajati ~14 min…`);
    runRunbook(job.youtube_id, job.lang, model);

    // 3) Verificiraj po CDN-u (izvor istine, ne exit kod).
    if (await artifactExists(job.youtube_id, job.lang)) {
      await api('PATCH', `/api/magisterium/${job.id}`, { state: 'done' });
      console.log(`  ✅ ${artifactName(job.lang)} live na CDN-u → done`);
    } else {
      await api('PATCH', `/api/magisterium/${job.id}`, {
        state: 'failed',
        error: `run završio, ali ${artifactName(job.lang)} nije na CDN-u (provjeri Claude CLI/MCP izlaz)`,
      });
      console.log(`  ❌ nema artefakta nakon runa → failed`);
    }
  }
})().catch((e) => {
  console.error('⚠️ magisterium_poller greška:', e.message);
  process.exit(0); // soft fail — launchd tick ne ruši ništa
});
