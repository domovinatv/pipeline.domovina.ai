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
 *   [--with-speechmatics --gemini-refine-promote]   (job.transcription='speechmatics')
 *   → uspjeh (info.json u _unlisted) → PATCH transcribing; neuspjeh → PATCH failed.
 * Wrapper nakon toga pokrene reconcile.js koji gotove flipne u done + detail_url.
 *
 * Env (isti kao bridge):
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno — Bearer za /api/jobs/*)
 *   FETCH_REPO                 (default sibling ../fetch.domovina.tv)
 *   PRIORITY_MAX               (default 3 — koliko prioritetnih po ticku)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const INGEST_KEY = process.env.PIPELINE_QUEUE_INGEST_KEY;
const FETCH_REPO = process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');
const PRIORITY_MAX = parseInt(process.env.PRIORITY_MAX || '3', 10);
const UNLISTED_DIR = path.join(FETCH_REPO, 'storage', 'output', '_unlisted');
const RUN_PIPELINE = path.join(FETCH_REPO, 'run_pipeline.sh');
const SITE_BASE = process.env.SITE_BASE || 'https://domovina.ai';
// Mapiranje izbora joba → zastavice (i whitelist backenda) živi u plan.js, pokriven testom.
const { planFor } = require('./plan');

if (!INGEST_KEY) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem prioritetni poller.');
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

(async () => {
  const { jobs } = await api('POST', '/api/jobs/claim', { max: PRIORITY_MAX, priority: true });
  if (!jobs.length) {
    console.log('📭 Nema prioritetnih jobova.');
    return;
  }
  console.log(`⚡ Claimano ${jobs.length} PRIORITETNIH jobova.`);
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
      await api('PATCH', `/api/jobs/${job.id}`, r.status === 0
        ? { state: 'processing' }
        : { state: 'failed', error: `run_pipeline.sh --reprocess-article izašao s ${r.status}` });
      continue;
    }

    console.log(`  🎙 transkripcija: ${job.transcription === 'speechmatics' ? 'Speechmatics + Gemini sluh (+ Modal Canary)' : 'Modal Canary + pyannote'}`);
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
    await api('PATCH', `/api/jobs/${job.id}`, { state: 'transcribing', ...meta });
    console.log(`  ✅ obrađeno (Modal) → transcribing${meta.channel ? ' (' + meta.channel + ')' : ''}`);

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
  }
})().catch((e) => {
  console.error('⚠️ priority_poller greška:', e.message);
  process.exit(0); // soft fail — launchd tick ne ruši ništa
});
