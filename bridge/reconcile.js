#!/usr/bin/env node
/**
 * reconcile.js — lokalni bridge (Mac Mini), ZAVRŠNI KORAK punog runa.
 *
 * Za jobove u 'fetching'/'transcribing'/'processing' provjeri je li obrada gotova
 * i javi status natrag pipeline.domovina.ai-u:
 *   • CDN data/{id}/article.json → 200  ⇒  done + detail_url (live na /v/{id})
 *   • lokalno {id}.canary.diarized.srt postoji, ali članak još ne na CDN-u ⇒ processing
 *   • inače ostaje transcribing (čeka Colab Canary)
 *
 * Env:
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno)
 *   FETCH_REPO         (default sibling ../fetch.domovina.tv)
 *   CDN_BASE           (default https://cdn.domovina.ai)
 *   SITE_BASE          (default https://domovina.ai)
 */
const fs = require('fs');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const INGEST_KEY = process.env.PIPELINE_QUEUE_INGEST_KEY;
const FETCH_REPO = process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');
const CDN_BASE = process.env.CDN_BASE || 'https://cdn.domovina.ai';
const SITE_BASE = process.env.SITE_BASE || 'https://domovina.ai';
const UNLISTED_DIR = path.join(FETCH_REPO, 'storage', 'output', '_unlisted');

if (!INGEST_KEY) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem reconcile.');
  process.exit(0);
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

function hasDiarizedLocally(youtubeId) {
  try {
    return fs
      .readdirSync(UNLISTED_DIR)
      .some((f) => f.includes('_yt_' + youtubeId) && f.endsWith('.canary.diarized.srt'));
  } catch {
    return false;
  }
}

// Naslov/kanal/trajanje iz info.json (_unlisted). Isti izvor kao priority_poller.readMeta,
// ali ovdje kao SIGURNOSNA backfill mreža: kad job ide fetching→done direktno (npr. članak
// je već bio live pa preskoči transcribing PATCH poller-a), naslov inače ostane null.
// Za X `channel` ne postoji u info.json-u (yt-dlp twitter daje samo `uploader`) → fallback.
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

async function articleLive(youtubeId) {
  // GET (ne HEAD) — Cloudflare cache-ira 404 do 4h po točnom URL-u.
  const r = await fetch(`${CDN_BASE}/data/${youtubeId}/article.json`, { method: 'GET' });
  return r.ok;
}

(async () => {
  // 'fetching' uključen: epizoda može biti već objavljena na CDN-u (npr. već prošla
  // glavni pipeline) pa se treba odmah zatvoriti u 'done', a ne čekati transcribing.
  const { jobs } = await api('GET', '/api/jobs?state=fetching,transcribing,processing&limit=200');
  if (!jobs.length) {
    console.log('📭 Nema jobova za reconcile.');
    return;
  }
  console.log(`🔎 Reconcile ${jobs.length} jobova…`);
  for (const job of jobs) {
    if (await articleLive(job.youtube_id)) {
      const patch = {
        state: 'done',
        detail_url: `${SITE_BASE}/v/${job.youtube_id}`,
      };
      // Backfill metapodataka ako fale (job je preskočio poller-ov transcribing PATCH).
      if (!job.title || !job.channel || !job.duration_seconds) {
        const meta = readMeta(job.youtube_id);
        if (meta) {
          if (!job.title && meta.title) patch.title = meta.title;
          if (!job.channel && meta.channel) patch.channel = meta.channel;
          if (!job.duration_seconds && meta.duration_seconds) patch.duration_seconds = meta.duration_seconds;
        }
      }
      await api('PATCH', `/api/jobs/${job.id}`, patch);
      console.log(`  ✅ ${job.youtube_id} → done (${SITE_BASE}/v/${job.youtube_id})${patch.title ? ' [+naslov]' : ''}`);
    } else if (job.state === 'transcribing' && hasDiarizedLocally(job.youtube_id)) {
      await api('PATCH', `/api/jobs/${job.id}`, { state: 'processing' });
      console.log(`  ⚙️  ${job.youtube_id} → processing (diarizirano, AI lanac u tijeku)`);
    } else {
      console.log(`  ⏳ ${job.youtube_id} ostaje ${job.state}`);
    }
  }
})().catch((e) => {
  console.error('⚠️ reconcile greška:', e.message);
  process.exit(0);
});
