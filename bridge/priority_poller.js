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
  for (const job of jobs) {
    console.log(`\n→ ⚡ ${job.youtube_id} (${job.id})`);
    // Izvor: 'youtube' (default) ili 'x' (X/Twitter). Backend upisuje source='x-admin'/'x-api'
    // za X postove i minta 11-znakovni youtube_id (sintetički), pa ga OVDJE eksplicitno
    // prosljeđujemo fetch.js-u preko --unlisted-id (ne izvodi se iz X URL-a). Flagovi
    // prolaze kroz run_pipeline.sh else-granu (COMMON_ARGS) do fetch.js — kao --unlisted-url.
    const isX = typeof job.source === 'string' && job.source.startsWith('x');
    // Puni single-video pipeline s Modal transkripcijom (scoped na ovaj youtube_id).
    const args = [
      '--unlisted-url', job.youtube_url,
      ...(job.title ? ['--unlisted-title', job.title] : []),
      ...(isX ? ['--unlisted-id', job.youtube_id, '--unlisted-source', 'x'] : []),
      '--with-modal-transcribe', '--modal-only', job.youtube_id,
      '--with-local-canary-diarize', '--with-r2-upload',
    ];
    spawnSync(RUN_PIPELINE, args, { cwd: FETCH_REPO, stdio: 'inherit' });

    // Ne vjeruj exit kodu (run_pipeline je set -e-toleran, non-fatalni koraci); provjeri disk.
    if (downloaded(job.youtube_id)) {
      const meta = readMeta(job.youtube_id) || {};
      await api('PATCH', `/api/jobs/${job.id}`, { state: 'transcribing', ...meta });
      console.log(`  ✅ obrađeno (Modal) → transcribing${meta.channel ? ' (' + meta.channel + ')' : ''}`);

      // Auto-reuse za praćene kanale: ako video pripada nekoj automatic/podcasts listi
      // i kanal ga je već fetchao, prekopiraj ad-hoc artefakte u channel dir + reindex
      // da na kanalu ne stoji "U OBRADI". O(1) grep po listama; skupi reindex se pokreće
      // samo kad je stvarno nešto kopirano. Ako video još nije fetchan u channel dir,
      // nightly sweep (auto_reuse_adhoc.js --sweep) ga pokupi sljedeću noć. Best-effort.
      const autoReuse = path.join(FETCH_REPO, 'auto_reuse_adhoc.js');
      if (fs.existsSync(autoReuse)) {
        spawnSync('node', [autoReuse, '--video-id', job.youtube_id], { cwd: FETCH_REPO, stdio: 'inherit' });
      }
    } else {
      await api('PATCH', `/api/jobs/${job.id}`, {
        state: 'failed',
        error: 'prioritetni download nije uspio (private/anti-bot?) — nema info.json u _unlisted',
      });
      console.log(`  ❌ nema info.json → failed`);
    }
  }
})().catch((e) => {
  console.error('⚠️ priority_poller greška:', e.message);
  process.exit(0); // soft fail — launchd tick ne ruši ništa
});
