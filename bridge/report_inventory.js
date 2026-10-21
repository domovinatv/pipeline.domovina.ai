#!/usr/bin/env node
/**
 * report_inventory.js — inventar SVIH epizoda na disku + stanje po koraku → /admin/episodes.
 *
 * Brat od report_discovered.js (isti disk-scan, isti env, soft-exit bez ključa), ali BEZ
 * vremenskog prozora: prođe cijeli storage/output/ (osim `sabor` i `_webpbackfill`) i za svaku
 * epizodu izvede stanje svakog koraka iz imena datoteka. Nula LLM poziva, nula pipeline
 * runova — čisto izvještavanje. Backend upserta po youtube_id i piše redak samo kad se
 * stanje promijenilo (potpis `sig`), pa je nightly slanje cijelog kataloga jeftino.
 *
 * CDN isporuku NE skenira (R2 LIST-once pravilo, a per-fajl probe bi bio ~40k zahtjeva):
 * Worker je proba lijeno kad se redak otvori u adminu (pipeline.ts).
 *
 * Env:
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno — bez njega soft-exit 0, ne ruši nightly)
 *   FETCH_REPO                 (default sibling ../fetch.domovina.tv)
 *
 * CLI:
 *   --channel <dir>    samo jedan kanal (slug direktorija)
 *   --video-id <id>    samo jedna epizoda (kraj priority/magisterium pollera)
 *   --dry-run          ispiši sažetak, ne šalji
 *   --verbose          uz --dry-run ispiši i svaki redak
 */
const fs = require('fs');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const INGEST_KEY = process.env.PIPELINE_QUEUE_INGEST_KEY;
const FETCH_REPO = process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');
const OUTPUT_DIR = path.join(FETCH_REPO, 'storage', 'output');

const argv = process.argv.slice(2);
function getArg(name) {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
}
const DRY_RUN = argv.includes('--dry-run');
const VERBOSE = argv.includes('--verbose');
const ONLY_CHANNEL = getArg('--channel');
const ONLY_ID = getArg('--video-id');

// Isto kao audit_pipeline.js: nisu dio podcast korpusa (drukčiji artefakti / backfill smeće).
const SKIP_CHANNELS = new Set(['sabor', '_webpbackfill']);
// Backend prima najviše 500 stavki po zahtjevu.
const BATCH = 400;

if (!INGEST_KEY && !DRY_RUN) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem inventar epizoda.');
  process.exit(0); // soft: nightly korak ne smije "pasti"
}

// Sve iza ZADNJEG `_yt_<id>` u imenu (naslovi znaju sadržavati "_yt_" — MEMORY
// extract-video-id-last-match). Vraća { id, rest } ili null.
function splitName(name) {
  const all = [...name.matchAll(/_yt_([A-Za-z0-9_-]{11})/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  return { id: m[1], rest: name.slice(m.index + m[0].length) };
}

// Članak: `.wav.canary.diarized_{YYYY-MM-DD}_{model}.article.json`. Model slug ima točke
// (gemini-2.5-flash) → lijeni `(.+?)`, ne `[^.]+`. `.article.en.json` / `.article.magisterium.json`
// ne završavaju na `.article.json`, pa ih regex ne hvata.
const ARTICLE_RE = /^\.wav\.canary\.diarized_(\d{4}-\d{2}-\d{2})_(.+?)\.article\.json$/;
const MEDIA_RE = /^(?:\.f\d+)?\.(?:mkv|mp4|webm|mp3|m4a|wav)$/;
// Mali article.json je krnji (2026-08-28: 279 B s `"iterations": []`). Sadržaj validira
// audit_pipeline.js; ovdje samo jeftina heuristika po veličini, bez čitanja datoteke.
const ARTICLE_MIN_BYTES = 2000;

function readInfo(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

// Stanje koraka koji ovisi o članku: ok za NAJNOVIJI članak, partial ako postoji samo uz
// stariji (npr. Magisterium rađen nad gemini člankom, a članak je u međuvremenu regeneriran).
function perArticle(rest, stems, latestStem, suffix) {
  if (latestStem && rest.has(latestStem + suffix)) return 'ok';
  return stems.some((s) => rest.has(s + suffix)) ? 'partial' : 'missing';
}

function classify(ep) {
  const rest = ep.rest; // Set svih sufiksa iza `_yt_<id>`
  const list = [...rest];
  const has = (s) => rest.has(s);

  const info = ep.infoFile ? readInfo(path.join(ep.dir, ep.infoFile)) : null;
  const audioOnly = !!(info && info._yt_matched === false);

  const media = list.some((r) => MEDIA_RE.test(r));
  const speechmatics = list.some((r) => r.startsWith('.mp3.speechmatics') && r.endsWith('.srt'));
  const canary = has('.wav.canary.srt');

  const articles = list.filter((r) => ARTICLE_RE.test(r)).sort();
  // Leksikografski najveći = najnoviji datum (isti dedup kao audit_pipeline.js).
  const latest = articles.length ? articles[articles.length - 1] : null;
  const stems = articles.map((a) => a.slice(0, -'.article.json'.length));
  const latestStem = latest ? latest.slice(0, -'.article.json'.length) : null;
  let article = 'missing';
  if (latest) {
    let size = ARTICLE_MIN_BYTES;
    try {
      size = fs.statSync(path.join(ep.dir, ep.prefix + latest)).size;
    } catch {
      /* stat pao (disk) → ne proglašavaj krnjim na slijepo */
    }
    article = size < ARTICLE_MIN_BYTES ? 'partial' : 'ok';
  } else if (has('.wav.canary.diarized.blocked.json')) {
    article = 'blocked';
  }
  const am = latest ? latest.match(ARTICLE_RE) : null;

  const upload = (info && info.upload_date) || (/^\d{8}_/.test(ep.prefix) ? ep.prefix.slice(0, 8) : null);
  return {
    youtube_id: ep.id,
    channel_dir: ep.channel,
    channel: (info && (info.channel || info.uploader)) || null,
    title: (info && (info.title || info.fulltitle)) || null,
    upload_date: upload && /^\d{8}$/.test(upload) ? upload : null,
    duration_seconds: info && Number.isFinite(info.duration) ? Math.round(info.duration) : null,
    audio_only: audioOnly,
    fetch: ep.infoFile ? 'ok' : media ? 'partial' : 'missing',
    transcript: speechmatics ? 'speechmatics' : canary ? 'canary' : 'none',
    diarized:
      has('.wav.canary.diarized.srt') ||
      has('.mp3.speechmatics.diarized.srt') ||
      has('.mp3.speechmatics.gemini.diarized.srt')
        ? 'ok'
        : 'missing',
    summary: has('.wav.canary.summary.json')
      ? 'ok'
      : has('.wav.canary.summary.blocked.json')
        ? 'blocked'
        : 'missing',
    article,
    article_model: am ? am[2] : null,
    article_date: am ? am[1] : null,
    rag: has('.rag_combined.jsonl') ? 'ok' : 'missing',
    screenshots: audioOnly ? 'na' : has('_screenshots') ? 'ok' : 'missing',
    epub: has('.epub') ? 'ok' : 'missing',
    words: has('.words.json') ? 'ok' : has('.words.skipped.json') ? 'na' : 'missing',
    magisterium_hr: perArticle(rest, stems, latestStem, '.article.magisterium.json'),
    magisterium_en: perArticle(rest, stems, latestStem, '.article.magisterium.en.json'),
    article_en: perArticle(rest, stems, latestStem, '.article.en.json'),
  };
}

const STEP_KEYS = ['fetch', 'diarized', 'summary', 'article', 'rag', 'screenshots', 'epub', 'words', 'magisterium_hr', 'magisterium_en', 'article_en'];
function okCount(r) {
  return STEP_KEYS.filter((k) => r[k] === 'ok').length + (r.transcript !== 'none' ? 1 : 0);
}

function collect() {
  let channels;
  try {
    channels = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`❌ Ne mogu čitati ${OUTPUT_DIR}: ${e.message}`);
    return [];
  }
  const groups = new Map(); // `${channel} ${id}` → epizoda
  for (const entry of channels) {
    // Simlinkani kanali (multi-disk storage) NISU isDirectory() — vidi fetch CLAUDE.md.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.') || SKIP_CHANNELS.has(entry.name)) continue;
    if (ONLY_CHANNEL && entry.name !== ONLY_CHANNEL) continue;
    const dir = path.join(OUTPUT_DIR, entry.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (e) {
      console.error(`   ⚠️ Preskačem ${entry.name}: ${e.message}`);
      continue;
    }
    for (const f of files) {
      // AppleDouble sidecari (`._…`) i skriveni markeri.
      if (f.startsWith('.')) continue;
      // Izvedeni namespace-ovi koji nisu stanje epizode (isto kao audit_pipeline.js).
      if (f.includes('.loudnorm.') || f.includes('.sortformer.')) continue;
      const s = splitName(f);
      if (!s) continue;
      if (ONLY_ID && s.id !== ONLY_ID) continue;
      const key = `${entry.name} ${s.id}`;
      let ep = groups.get(key);
      if (!ep) {
        ep = { id: s.id, channel: entry.name, dir, prefix: f.slice(0, f.length - s.rest.length), rest: new Set(), infoFile: null };
        groups.set(key, ep);
      }
      ep.rest.add(s.rest);
      if (s.rest === '.info.json') {
        ep.infoFile = f;
        ep.prefix = f.slice(0, -'.info.json'.length);
      }
    }
  }

  // Ista epizoda zna biti u `_unlisted` (ad-hoc job) i u kanalu (auto_reuse_adhoc) → jedan
  // redak po youtube_id: pravi kanal pobjeđuje `_`-direktorij, inače dalje stigla kopija.
  const byId = new Map();
  for (const ep of groups.values()) {
    const row = classify(ep);
    const prev = byId.get(row.youtube_id);
    if (!prev) {
      byId.set(row.youtube_id, row);
      continue;
    }
    const rank = (r) => (r.channel_dir.startsWith('_') ? 0 : 1000) + okCount(r);
    if (rank(row) > rank(prev)) byId.set(row.youtube_id, row);
  }
  return [...byId.values()];
}

function summarize(rows) {
  const miss = (k, v = 'ok') => rows.filter((r) => r[k] !== v && r[k] !== 'na').length;
  return [
    `${rows.length} epizoda`,
    `bez transkripta ${rows.filter((r) => r.transcript === 'none').length}`,
    `bez članka ${miss('article')}`,
    `bez Magisterium HR ${miss('magisterium_hr')}`,
    `bez Magisterium EN ${miss('magisterium_en')}`,
    `bez EN članka ${miss('article_en')}`,
  ].join(' · ');
}

(async () => {
  const scope = ONLY_ID ? `video ${ONLY_ID}` : ONLY_CHANNEL ? `kanal ${ONLY_CHANNEL}` : 'cijeli katalog';
  console.log(`📚 Inventar epizoda — skeniram ${OUTPUT_DIR} (${scope})`);
  const t0 = Date.now();
  const rows = collect();
  console.log(`   🔎 ${summarize(rows)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!rows.length) return;

  if (DRY_RUN) {
    if (VERBOSE || ONLY_ID) {
      for (const r of rows) console.log('   •', JSON.stringify(r));
    }
    console.log(`   🧪 --dry-run — ne šaljem (${rows.length} stavki).`);
    return;
  }

  let changed = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const items = rows.slice(i, i + BATCH);
    const res = await fetch(PIPELINE_QUEUE_BASE + '/api/episodes/inventory', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + INGEST_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) throw new Error(`POST /api/episodes/inventory → ${res.status} ${await res.text()}`);
    const out = await res.json();
    changed += out.changed || 0;
  }
  console.log(`   ✅ Poslano ${rows.length}, promijenjeno ${changed} → ${PIPELINE_QUEUE_BASE}/admin/episodes`);
})().catch((e) => {
  console.error('⚠️ report_inventory greška:', e.message);
  process.exit(0); // soft fail — nightly ne ruši
});
