#!/usr/bin/env node
/**
 * claim_and_dispatch.js — lokalni bridge (Mac Mini), KORAK 0 punog runa.
 *
 * Povuče queued jobove iz pipeline.domovina.ai i za svaki pokrene
 * `fetch.js --unlisted-url`, čime video uđe u `_unlisted` kanal. Odatle ga
 * svaki puni pipeline run (nightly ili manualni) obradi automatski (convert_to_wav
 * auto-discoverira `_`-kanale; diarize/summary/article/... su dir-driven).
 *
 * Po jobu: uspjeh (info.json u _unlisted) → PATCH state=transcribing;
 *          neuspjeh (yt-dlp private/anti-bot) → PATCH state=failed.
 *
 * Env:
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno — Bearer za /api/jobs/*)
 *   FETCH_REPO         (default sibling ../fetch.domovina.tv)
 *   CLAIM_MAX          (default 5)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const INGEST_KEY = process.env.PIPELINE_QUEUE_INGEST_KEY;
const FETCH_REPO = process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');
const CLAIM_MAX = parseInt(process.env.CLAIM_MAX || '5', 10);
const UNLISTED_DIR = path.join(FETCH_REPO, 'storage', 'output', '_unlisted');

if (!INGEST_KEY) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem claim.');
  process.exit(0); // soft: nightly ne smije pasti zbog ovoga
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

(async () => {
  const { jobs } = await api('POST', '/api/jobs/claim', { max: CLAIM_MAX });
  if (!jobs.length) {
    console.log('📭 Nema queued jobova.');
    return;
  }
  console.log(`📥 Claimano ${jobs.length} jobova iz pipeline queuea.`);
  for (const job of jobs) {
    console.log(`\n→ ${job.youtube_id} (${job.id})`);
    const args = ['fetch.js', '--unlisted-url', job.youtube_url];
    if (job.title) args.push('--unlisted-title', job.title);
    spawnSync('node', args, { cwd: FETCH_REPO, stdio: 'inherit' });

    // fetch.js zna exit-ati 0 i kod anti-bot ABORT-a → ne vjeruj exit kodu,
    // provjeri je li info.json stvarno na disku.
    if (downloaded(job.youtube_id)) {
      await api('PATCH', `/api/jobs/${job.id}`, { state: 'transcribing' });
      console.log(`  ✅ skinuto → transcribing`);
    } else {
      await api('PATCH', `/api/jobs/${job.id}`, {
        state: 'failed',
        error: 'download nije uspio (private/anti-bot?) — nema info.json u _unlisted',
      });
      console.log(`  ❌ nema info.json → failed`);
    }
  }
})().catch((e) => {
  console.error('⚠️ claim_and_dispatch greška:', e.message);
  process.exit(0); // soft fail — ne ruši nightly
});
