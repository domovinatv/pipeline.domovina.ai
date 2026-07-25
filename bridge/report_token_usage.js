#!/usr/bin/env node
/**
 * report_token_usage.js — potrošnja tokena po videu iz Claude Code session datoteka.
 *
 * Claude Code svaku sesiju piše kao JSONL u ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl.
 * Svaka assistant poruka nosi `message.usage` (input / output / cache_creation / cache_read),
 * a redak nosi `entrypoint` i `timestamp`. Iz toga se dobiva stvarna potrošnja pipelinea
 * bez ijedne izmjene u samim skriptama koje pozivaju `claude`.
 *
 * TRI filtera nose točnost:
 *
 *   1) SAMO projekti pipelinea. Claude Code grupira sesije po cwd-u, a video ID se spominje
 *      i u sesijama drugih sustava (`ecosystem-brain` ih ima 436!) koje s obradom tog videa
 *      nemaju veze. Skeniranje svega bi im pripisalo tuđe tokene i višestruko naduvalo brojke.
 *      Default je projekt `fetch.domovina.tv` (odatle trče Magisterium MCP runovi);
 *      proširi preko CLAUDE_PROJECT_DIRS, a `--all-projects` je samo dijagnostika.
 *
 *   2) entrypoint === 'sdk-cli' — to je headless `claude -p` koji pokreće pipeline
 *      (Magisterium MCP runbook, --gemini-backend claude). Interaktivne sesije
 *      (entrypoint 'cli' — čovjek za tipkovnicom) često spominju isti video ID, ali
 *      njihovi tokeni NISU trošak obrade tog videa i ne smiju mu se pripisati.
 *
 *   3) video ID iz PROMPTA — prvi `MAGISTERIUM_MCP_RUN.md <VID>` ili `_yt_<VID>` pogodak.
 *      Sesije bez ID-a se broje kao neatribuirane i prijave u logu (ne tiho nestanu).
 *
 * NIJE pokriveno: `--gemini-backend claude` (koraci 7+8) trči s neutralnim cwd-om, a prompt
 * mu je čisti sadržaj iteracije bez video ID-a — te sesije se ne mogu pripisati videu bez
 * izmjene u generate_article_gemini.js (dodati ID u prompt).
 *
 * Šalje PUNE zbrojeve po videu (ne delte) — backend redak zamjenjuje, pa ponovno
 * pokretanje ne udvostručuje brojke.
 *
 * Env:
 *   PIPELINE_QUEUE_BASE        (default https://pipeline.domovina.ai)
 *   PIPELINE_QUEUE_INGEST_KEY  (obavezno — bez njega soft-exit 0)
 *   CLAUDE_PROJECTS_DIR        (default ~/.claude/projects)
 *   CLAUDE_PROJECT_DIRS        (CSV imena poddirektorija; default = projekt FETCH_REPO-a)
 *   FETCH_REPO                 (default sibling ../fetch.domovina.tv)
 *
 * CLI:
 *   --dry-run        samo ispiši
 *   --top N          koliko redaka ispisati (default 10)
 *   --all-projects   skeniraj SVE projekte (dijagnostika — pripisat će i tuđe sesije)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PIPELINE_QUEUE_BASE = process.env.PIPELINE_QUEUE_BASE || 'https://pipeline.domovina.ai';
const INGEST_KEY = process.env.PIPELINE_QUEUE_INGEST_KEY;
const PROJECTS_DIR =
  process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
const FETCH_REPO =
  process.env.FETCH_REPO || path.resolve(__dirname, '..', '..', 'fetch.domovina.tv');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ALL_PROJECTS = argv.includes('--all-projects');
const TOP = (() => {
  const i = argv.indexOf('--top');
  return i !== -1 && i + 1 < argv.length ? parseInt(argv[i + 1], 10) || 10 : 10;
})();

// Claude Code kodira cwd u ime projektnog direktorija zamjenom '/' i '.' crticom:
//   /Users/ms/git/domovinatv/fetch.domovina.tv → -Users-ms-git-domovinatv-fetch-domovina-tv
function encodeProjectDir(cwd) {
  return cwd.replace(/[/.]/g, '-');
}

const ALLOWED_PROJECTS = ALL_PROJECTS
  ? null // null = bez filtera
  : new Set(
      (process.env.CLAUDE_PROJECT_DIRS || encodeProjectDir(FETCH_REPO))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

if (!INGEST_KEY && !DRY_RUN) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem izvještaj o tokenima.');
  process.exit(0); // soft: nightly korak ne smije "pasti"
}

// Video ID iz teksta prompta. Magisterium runbook prvi (najprecizniji), pa `_yt_` konvencija.
// NB: goli 11-znakovni niz se NE prihvaća — previše lažnih pogodaka u slobodnom tekstu.
function videoIdFrom(text) {
  const m =
    text.match(/MAGISTERIUM_MCP_RUN\.md\s+([A-Za-z0-9_-]{11})/) ||
    text.match(/_yt_([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function scanSession(file) {
  let entrypoint = null;
  let videoId = null;
  let model = null;
  let firstAt = null;
  let lastAt = null;
  const tok = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue; // nedovršen zadnji redak (sesija u tijeku) — preskoči
    }
    if (!entrypoint && j.entrypoint) entrypoint = j.entrypoint;
    if (!videoId && j.message && j.message.content) {
      const c = j.message.content;
      videoId = videoIdFrom(typeof c === 'string' ? c : JSON.stringify(c));
    }
    const u = j.message && j.message.usage;
    if (u) {
      tok.input += u.input_tokens || 0;
      tok.output += u.output_tokens || 0;
      tok.cacheCreate += u.cache_creation_input_tokens || 0;
      tok.cacheRead += u.cache_read_input_tokens || 0;
      if (j.message.model) model = j.message.model;
    }
    if (j.timestamp) {
      const t = Math.floor(Date.parse(j.timestamp) / 1000);
      if (Number.isFinite(t)) {
        if (firstAt === null || t < firstAt) firstAt = t;
        if (lastAt === null || t > lastAt) lastAt = t;
      }
    }
  }
  return { entrypoint, videoId, model, firstAt, lastAt, tok };
}

function collect() {
  const per = new Map();
  let sessions = 0;
  let headless = 0;
  let unattributed = 0;
  let projects;
  try {
    projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`❌ Ne mogu čitati ${PROJECTS_DIR}: ${e.message}`);
    return { per, sessions, headless, unattributed };
  }
  for (const p of projects) {
    if (!p.isDirectory() && !p.isSymbolicLink()) continue;
    if (ALLOWED_PROJECTS && !ALLOWED_PROJECTS.has(p.name)) continue;
    const dir = path.join(PROJECTS_DIR, p.name);
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl') || f.startsWith('.')) continue;
      sessions++;
      const s = scanSession(path.join(dir, f));
      if (!s || s.entrypoint !== 'sdk-cli') continue; // samo headless pipeline runovi
      headless++;
      if (!s.videoId) {
        unattributed++;
        continue;
      }
      const cur =
        per.get(s.videoId) ||
        { runs: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, models: new Set(), firstAt: null, lastAt: null };
      cur.runs++;
      cur.input += s.tok.input;
      cur.output += s.tok.output;
      cur.cacheCreate += s.tok.cacheCreate;
      cur.cacheRead += s.tok.cacheRead;
      if (s.model) cur.models.add(s.model);
      if (s.firstAt !== null && (cur.firstAt === null || s.firstAt < cur.firstAt)) cur.firstAt = s.firstAt;
      if (s.lastAt !== null && (cur.lastAt === null || s.lastAt > cur.lastAt)) cur.lastAt = s.lastAt;
      per.set(s.videoId, cur);
    }
  }
  return { per, sessions, headless, unattributed };
}

const fmt = (n) => n.toLocaleString('hr-HR');

(async () => {
  console.log(
    `🎫 Potrošnja tokena — skeniram ${PROJECTS_DIR}` +
      (ALLOWED_PROJECTS ? ` (projekti: ${[...ALLOWED_PROJECTS].join(', ')})` : ' (SVI projekti)'),
  );
  const { per, sessions, headless, unattributed } = collect();
  console.log(
    `   🔎 ${sessions} sesija ukupno · ${headless} headless (sdk-cli) · ${per.size} videa atribuirano` +
      (unattributed ? ` · ${unattributed} headless bez video ID-a (nije pripisano)` : ''),
  );
  if (!per.size) {
    console.log('   📭 Nema atribuirane potrošnje — ništa za prijaviti.');
    return;
  }

  const items = [...per.entries()].map(([youtube_id, v]) => ({
    youtube_id,
    runs: v.runs,
    input_tokens: v.input,
    cache_creation_tokens: v.cacheCreate,
    cache_read_tokens: v.cacheRead,
    output_tokens: v.output,
    models: [...v.models].join(', ') || null,
    first_at: v.firstAt,
    last_at: v.lastAt,
  }));

  items.sort((a, b) => b.output_tokens - a.output_tokens);
  console.log(`   Najveći potrošači (izlazni tokeni), top ${Math.min(TOP, items.length)}:`);
  for (const it of items.slice(0, TOP)) {
    console.log(
      `   • ${it.youtube_id}  runs=${it.runs}  out=${fmt(it.output_tokens)}  cacheR=${fmt(it.cache_read_tokens)}  ${it.models || ''}`,
    );
  }
  const tot = items.reduce(
    (a, i) => {
      a.o += i.output_tokens;
      a.cr += i.cache_read_tokens;
      a.cc += i.cache_creation_tokens;
      a.i += i.input_tokens;
      return a;
    },
    { i: 0, o: 0, cc: 0, cr: 0 },
  );
  console.log(
    `   Σ ulaz=${fmt(tot.i)} · cache upis=${fmt(tot.cc)} · cache čitanje=${fmt(tot.cr)} · izlaz=${fmt(tot.o)}`,
  );

  if (DRY_RUN) {
    console.log(`   🧪 --dry-run — ne šaljem (${items.length} videa).`);
    return;
  }

  // Backend prima najviše 500 po zahtjevu.
  let written = 0;
  for (let i = 0; i < items.length; i += 400) {
    const res = await fetch(PIPELINE_QUEUE_BASE + '/api/usage', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + INGEST_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ items: items.slice(i, i + 400) }),
    });
    if (!res.ok) throw new Error(`POST /api/usage → ${res.status} ${await res.text()}`);
    written += (await res.json()).written || 0;
  }
  console.log(`   ✅ Zapisano ${written} videa.`);
})().catch((e) => {
  console.error('⚠️ report_token_usage greška:', e.message);
  process.exit(0); // soft fail — nightly ne ruši
});
