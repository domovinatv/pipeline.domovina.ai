#!/usr/bin/env node
/**
 * report_discovered.js — ZAVRŠNI korak noćnog runa: "što je sinoć novo stiglo".
 *
 * Prođe kroz storage/output/<kanal>/ i pronađe `*.info.json` datoteke nastale u zadnjih
 * N sati (default 26h — pokriva jedan nightly ciklus s rezervom), pa ih pošalje u
 * pipeline.domovina.ai kao "otkrivene videe". Backend ih grupira po danu otkrića u
 * podliste vidljive na /admin/discovered.
 *
 * NE queuea obradu. Ovo je čisto izvještavanje — video se dalje obrađuje standardnim
 * putem (Colab batch transkripcija → sljedeći nightly). Tek klik "⚡ Prioritet" u adminu
 * stvori pravi job i pokrene punu prioritetnu obradu.
 *
 * Idempotentno: ključ je youtube_id, pa ponovno pokretanje ne stvara duplikate — samo
 * osvježi `stage` (dokle je video stigao na disku), zbog čega podlista pokazuje živo stanje.
 *
 * Env:
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno — bez njega soft-exit 0, ne ruši nightly)
 *   FETCH_REPO                 (default sibling ../fetch.domovina.tv)
 *   DISCOVERED_LOOKBACK_HOURS  (default 26)
 *
 * CLI:
 *   --hours N        koliko sati unatrag gledati (override env)
 *   --since YYYY-MM-DD   apsolutni cutoff umjesto "zadnjih N sati" (za backfill podlista)
 *   --pending-transcription  IGNORIRAJ vremenski prozor; uzmi SVE što čeka Colab Canary
 *                    (ima .wav, nema .wav.canary.srt) — bez obzira koliko davno je stiglo
 *   --dry-run        samo ispiši što bi poslao
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
// Backlog mod: ne pitaj "kad je stiglo" nego "čeka li transkripciju". Vremenski prozor se
// ignorira jer backlog zna biti star tjednima (npr. bulk onboarding kanala), a i dalje čeka.
const PENDING_ONLY = argv.includes('--pending-transcription') || argv.includes('--pending');
const SINCE_ARG = getArg('--since');
const HOURS = parseFloat(getArg('--hours') || process.env.DISCOVERED_LOOKBACK_HOURS || '26');

if (!INGEST_KEY && !DRY_RUN) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem izvještaj o otkrivenim videima.');
  process.exit(0); // soft: nightly korak ne smije "pasti"
}

// Cutoff u ms. --since YYYY-MM-DD → ponoć tog dana po lokalnom vremenu.
let cutoffMs;
if (SINCE_ARG) {
  const p = SINCE_ARG.split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) {
    console.error(`❌ --since mora biti YYYY-MM-DD (dobio: ${SINCE_ARG})`);
    process.exit(1);
  }
  cutoffMs = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0).getTime();
} else {
  cutoffMs = Date.now() - HOURS * 3600 * 1000;
}

// Lokalni datum (YYYY-MM-DD) iz timestampa — dan otkrića = ime podliste. Namjerno LOKALNO,
// ne UTC: nightly krene u 01:00 CEST, pa bi UTC datum vukao podlistu na prethodni dan.
function localDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// YouTube ID iz basenamea. LAST match `_yt_` — naslovi epizoda znaju sadržavati "_yt_"
// pa bi prvi match uhvatio krivi niz. Vidi MEMORY: extract-video-id-last-match.
function extractVideoId(basename) {
  const m = basename.match(/.*_yt_([A-Za-z0-9_-]{11})(?:[._]|$)/);
  return m ? m[1] : null;
}

// Dokle je video stigao lokalno. Redoslijed provjera ide od NAJDALJE faze prema natrag —
// prvi pogodak pobjeđuje (sufiksi su ugniježđeni, pa je redoslijed nosivi dio).
function detectStage(dir, basename) {
  const has = (suffix) => {
    try {
      return fs.existsSync(path.join(dir, basename + suffix));
    } catch {
      return false;
    }
  };
  // Članak ima varijabilan `_{date}_{model}` infiks → traži po prefiksu u listingu dira.
  try {
    const files = fs.readdirSync(dir);
    if (files.some((f) => f.startsWith(basename + '.wav.canary.diarized') && f.endsWith('.article.json'))) {
      return 'article';
    }
  } catch {
    /* dir nedostupan → padni na sufiks provjere ispod */
  }
  if (has('.wav.canary.diarized.srt')) return 'diarized';
  if (has('.wav.canary.srt')) return 'transcribed';
  if (has('.wav')) return 'wav';
  return 'fetched';
}

function readInfo(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function collect() {
  const items = [];
  let scanned = 0;
  let channels;
  try {
    channels = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`❌ Ne mogu čitati ${OUTPUT_DIR}: ${e.message}`);
    return items;
  }
  for (const entry of channels) {
    // Simlinkani kanali (multi-disk storage) NISU isDirectory() → moraju se propustiti.
    // Vidi CLAUDE.md "Symlink gotchas".
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    // `_`-prefiks direktoriji (_unlisted) su ad-hoc queue — oni već IMAJU svoj job u
    // pipeline.domovina.ai, pa ih ovdje ne prijavljujemo (bili bi duplikat queuea).
    if (entry.name.startsWith('_')) continue;

    const dir = path.join(OUTPUT_DIR, entry.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.info.json')) continue;
      // macOS AppleDouble sidecari (`._<ime>`) na external volumeima završavaju istim
      // sufiksom i prolaze extractVideoId — ali nisu JSON, pa bi upisali prazan naslov
      // preko pravog retka. Preskoči sve što počinje točkom.
      if (f.startsWith('.')) continue;
      scanned++;
      let st;
      try {
        st = fs.statSync(path.join(dir, f));
      } catch {
        continue;
      }
      if (!PENDING_ONLY && st.mtimeMs < cutoffMs) continue;

      const basename = f.slice(0, -'.info.json'.length);
      const youtubeId = extractVideoId(basename);
      if (!youtubeId) continue;

      const stage = detectStage(dir, basename);
      // Backlog mod: samo ono što stvarno čeka Canary — WAV postoji, .canary.srt ne.
      // 'fetched' (nema ni WAV) čeka konverziju, ne Colab; sve dalje od 'wav' je već prošlo.
      if (PENDING_ONLY && stage !== 'wav') continue;

      const info = readInfo(path.join(dir, f)) || {};
      // Beamly audio-only: sintetički `_yt_` ID bez pravog YouTube videa → prioritetna
      // obrada bi pala na yt-dlp-u. Označi ga kao ne-promotable da admin ne nudi gumb.
      // Vidi MEMORY: beamly-audio-only-yt-matched-marker.
      const isBeamly = info._source === 'beamly';
      const promotable = !(isBeamly && info._yt_matched === false);
      const publishedAt = /^\d{8}_/.test(basename) ? basename.slice(0, 8) : null;

      items.push({
        youtube_id: youtubeId,
        youtube_url: info.webpage_url || `https://www.youtube.com/watch?v=${youtubeId}`,
        title: info.title || info.fulltitle || null,
        channel: info.channel || info.uploader || null,
        channel_dir: entry.name,
        duration_seconds: Number.isFinite(info.duration) ? Math.round(info.duration) : null,
        published_at: publishedAt,
        batch_date: localDate(st.mtimeMs),
        stage,
        promotable,
        source_platform: isBeamly ? 'beamly' : 'youtube',
      });
    }
  }
  console.log(`   🔎 Pregledano ${scanned} info.json datoteka; unutar prozora: ${items.length}`);
  return items;
}

(async () => {
  const window = PENDING_ONLY
    ? 'SVE što čeka Colab Canary (ima .wav, nema .canary.srt)'
    : SINCE_ARG
      ? `od ${SINCE_ARG}`
      : `zadnjih ${HOURS}h`;
  console.log(`🌙 Otkriveni videi — skeniram ${OUTPUT_DIR} (${window})`);
  const items = collect();

  if (!items.length) {
    console.log('   📭 Nema novih videa u prozoru — ništa za prijaviti.');
    return;
  }

  // Najnoviji prvi (čisto radi čitljivosti loga).
  items.sort((a, b) => (a.batch_date < b.batch_date ? 1 : a.batch_date > b.batch_date ? -1 : 0));
  for (const it of items) {
    console.log(
      `   • [${it.batch_date}] ${it.channel_dir}/${it.youtube_id} · ${it.stage} · ${(it.title || '').slice(0, 60)}`,
    );
  }

  if (DRY_RUN) {
    console.log(`   🧪 --dry-run — ne šaljem (${items.length} stavki).`);
    return;
  }

  const res = await fetch(PIPELINE_QUEUE_BASE + '/api/discovered', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + INGEST_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/discovered → ${res.status} ${await res.text()}`);
  }
  const out = await res.json();
  console.log(
    `   ✅ Prijavljeno: ${out.inserted} novih, ${out.updated} osvježenih${out.skipped ? `, ${out.skipped} preskočeno` : ''}`,
  );
  if (out.inserted) console.log(`   👉 Pregled i "⚡ Prioritet": ${PIPELINE_QUEUE_BASE}/admin/discovered`);
})().catch((e) => {
  console.error('⚠️ report_discovered greška:', e.message);
  process.exit(0); // soft fail — nightly ne ruši
});
