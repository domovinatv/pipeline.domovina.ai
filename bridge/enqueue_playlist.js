#!/usr/bin/env node
/**
 * enqueue_playlist.js — cijela YouTube playlista u queue jednom naredbom.
 *
 * yt-dlp --flat-playlist izvuče ID-eve (bez skidanja videa), pa za svaki video
 * POST /api/jobs (Bearer INGEST_KEY) s istim izborima kao admin forma. Sve odluke
 * (dedup aktivnog joba, preskok već objavljenog, limiti reda) donosi backend — ova
 * skripta je samo popis + petlja, pa web verzija kasnije zove isti endpoint.
 *
 * Limiti: INGEST_KEY nije korisnički ključ, pa vrijedi samo globalni MAX_QUEUED_TOTAL (50).
 * Kad backend vrati 429, skripta stane i ispiše što nije ušlo (ponovi kasnije — već
 * queueani se dedupliciraju). Prioritetne bridge vrti jedan po jedan i troše dnevni
 * budžet PRIORITY_DAILY_MAX (30) — veća playlista preko --priority prelije se u sutra.
 *
 * Env:
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (ako nije u env-u, čita se iz FETCH_REPO/.env)
 *   FETCH_REPO                 (default sibling ../fetch.domovina.tv)
 *
 * CLI:
 *   node bridge/enqueue_playlist.js <playlist-url> [opcije]
 *   --dry-run               samo ispiši popis, ništa ne šalji
 *   --priority              ⚡ prioritetna obrada odmah (default: standardni noćni batch)
 *   --transcription X       soniox | canary (default: soniox; 'speechmatics' = zastarjeli alias)
 *   --article-model X       npr. claude:opus, claude:sonnet, vertex (default: claude:opus)
 *   --magisterium-model X   opus | sonnet | haiku (default: opus)
 *   --no-magisterium        bez Magisterium koraka (8.5)
 *   --include-published     queueaj i videe koji su već objavljeni na domovina.ai
 *   --only ID[,ID…]         samo ovi ID-evi iz playliste
 *   --limit N               samo prvih N (nakon --only)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const FETCH_REPO = process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');

const argv = process.argv.slice(2);
function getArg(name) {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
}
const DRY_RUN = argv.includes('--dry-run');
const PRIORITY = argv.includes('--priority');
const NO_MAG = argv.includes('--no-magisterium');
const INCLUDE_PUBLISHED = argv.includes('--include-published');
const TRANSCRIPTION = getArg('--transcription');
const ARTICLE_MODEL = getArg('--article-model');
const MAG_MODEL = getArg('--magisterium-model');
const ONLY = (getArg('--only') || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = parseInt(getArg('--limit') || '0', 10);
const VALUE_FLAGS = ['--transcription', '--article-model', '--magisterium-model', '--only', '--limit'];
const playlistUrl = argv.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]));

if (!playlistUrl) {
  console.error('Upotreba: node bridge/enqueue_playlist.js <playlist-url> [--dry-run] [--priority] …');
  process.exit(2);
}

// Ključ iz env-a ili iz .env fetch repoa (isti kao nightly KORAK 0) — nikad se ne ispisuje.
function ingestKey() {
  if (process.env.PIPELINE_QUEUE_INGEST_KEY) return process.env.PIPELINE_QUEUE_INGEST_KEY;
  const envFile = path.join(FETCH_REPO, '.env');
  if (!fs.existsSync(envFile)) return null;
  const m = fs.readFileSync(envFile, 'utf8').match(/^\s*(?:export\s+)?PIPELINE_QUEUE_INGEST_KEY\s*=\s*["']?([^"'\s#]+)/m);
  return m ? m[1] : null;
}

function listPlaylist(url) {
  const r = spawnSync('yt-dlp', ['--flat-playlist', '-J', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`❌ yt-dlp nije uspio pročitati playlistu:\n${(r.stderr || '').trim()}`);
    process.exit(1);
  }
  const data = JSON.parse(r.stdout);
  return {
    title: data.title || '(bez naslova)',
    entries: (data.entries || [])
      .filter((e) => e && e.id)
      .map((e) => ({ id: e.id, title: e.title || '', duration: e.duration || 0 })),
  };
}

function fmtDur(s) {
  if (!s) return '  ?:??';
  s = Math.round(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`.padStart(6);
}

async function main() {
  const { title, entries } = listPlaylist(playlistUrl);
  let videos = ONLY.length ? entries.filter((e) => ONLY.includes(e.id)) : entries;
  if (LIMIT > 0) videos = videos.slice(0, LIMIT);

  const total = videos.reduce((s, v) => s + (v.duration || 0), 0);
  console.log(`📋 ${title} — ${videos.length}/${entries.length} videa, ukupno ${Math.round(total / 60)} min`);
  console.log(
    `   obrada: ${PRIORITY ? '⚡ prioritet' : 'standardno (noćni batch)'} · transkripcija ${TRANSCRIPTION || 'default'}` +
      ` · članak ${ARTICLE_MODEL || 'default'} · Magisterium ${NO_MAG ? 'isključen' : MAG_MODEL || 'default'}` +
      `${INCLUDE_PUBLISHED ? ' · i već objavljeni' : ''}`,
  );
  for (const v of videos) console.log(`   ${v.id}  ${fmtDur(v.duration)}  ${v.title}`);
  if (DRY_RUN) {
    console.log('\n(dry-run — ništa nije poslano)');
    return;
  }

  const key = ingestKey();
  if (!key) {
    console.error(`❌ PIPELINE_QUEUE_INGEST_KEY nije ni u env-u ni u ${path.join(FETCH_REPO, '.env')}`);
    process.exit(1);
  }

  const tally = { created: 0, deduped: 0, published: 0, failed: 0 };
  console.log('');
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const body = {
      url: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.title || undefined,
      priority: PRIORITY,
      transcription: TRANSCRIPTION || undefined,
      article_model: ARTICLE_MODEL || undefined,
      magisterium_model: MAG_MODEL || undefined,
      with_magisterium: !NO_MAG,
      skip_published: !INCLUDE_PUBLISHED,
    };
    let res, data;
    try {
      res = await fetch(`${PIPELINE_QUEUE_BASE}/api/jobs`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      console.log(`   ❌ ${v.id}  mreža: ${e.message}`);
      tally.failed++;
      continue;
    }
    if (res.status === 429) {
      const rest = videos.slice(i).map((x) => x.id);
      console.log(`   ⛔ ${v.id}  ${data.error || 'red je pun'}`);
      console.log(`\n⛔ Stao na ${i + 1}/${videos.length}. Nije ušlo (${rest.length}): ${rest.join(',')}`);
      console.log('   Ponovi isti poziv kasnije — već queueani se dedupliciraju.');
      tally.failed += rest.length;
      break;
    }
    if (!res.ok) {
      console.log(`   ❌ ${v.id}  HTTP ${res.status}: ${data.error || ''}`);
      tally.failed++;
    } else if (data.skipped === 'published') {
      console.log(`   ⏭  ${v.id}  već objavljen na domovina.ai (--include-published za ponovnu obradu)`);
      tally.published++;
    } else if (data.deduped) {
      console.log(`   =  ${v.id}  već u queueu (${data.job.state})`);
      tally.deduped++;
    } else {
      console.log(`   ✅ ${v.id}  queued${data.job.priority ? ' ⚡' : ''}  ${data.job.title || ''}`);
      tally.created++;
    }
  }
  console.log(
    `\nGotovo: ${tally.created} novih · ${tally.deduped} već u queueu · ${tally.published} već objavljeno · ${tally.failed} grešaka`,
  );
  process.exit(tally.failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
