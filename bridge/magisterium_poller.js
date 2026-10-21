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
 *   2) HR: claude -p "@docs/MAGISTERIUM_MCP_RUN.md <VID>" (cwd = FETCH_REPO).
 *      EN: BEZ Claudea — translate_to_english.js (Vertex Gemini) + objava pod pipeline lockom.
 *   3) CDN verifikacija (GET, ne HEAD — CF cache-ira 404) → done | failed(+error).
 *
 * EN nije MCP nego strojni prijevod HR artefakata, a traje i preko sat vremena. Unutar
 * `claude -p` nije stao ni u Bash limit (10 min → pozadina → ubijen) ni u 60 min pollera:
 * yD9r0grKCkA 19.10. i A-oDNz3nvdQ 21.10. pali s ETIMEDOUT. Zato ga poller vrti sam, s
 * rokom po broju sekcija, i claima EN tek kad nema HR zahtjeva (jedan po ticku).
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
 *   MAG_RUN_TIMEOUT_MS         (default 3_600_000 = 60 min po HR videu; run traje ~14 min prosjek)
 *   MAG_EN_TIMEOUT_MAX_MS      (default 4 h — gornja granica EN prijevoda; inače 30 min + 5 min/sekciji)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
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
const EN_TIMEOUT_MAX_MS = parseInt(process.env.MAG_EN_TIMEOUT_MAX_MS || String(4 * 3600000), 10);
// Objava čeka pipeline lock do 30 min (with_pipeline_lock.sh), pa sam upload.
const PUBLISH_TIMEOUT_MS = 45 * 60000;

if (!INGEST_KEY) {
  console.error('❌ PIPELINE_QUEUE_INGEST_KEY nije postavljen — preskačem Magisterium poller.');
  process.exit(0); // soft: launchd tick ne smije "pasti"
}

// spawnSync runbooka blokira event loop ~14 min; zastarjeli keep-alive socket tada sruši
// prvi sljedeći PATCH ("fetch failed"), a magisterium_jobs nema stuck sweep — zahtjev bi
// trajno ostao u 'running'. Retry samo za idempotentne pozive (POST /claim bi claimao još).
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
// Uz `since` (unix s) vrijedi samo artefakt objavljen NAKON toga (Last-Modified) — za force
// zahtjeve (ponovna obrada), gdje stari Magisterium na CDN-u nije signal uspjeha.
async function artifactExists(youtubeId, lang, since = 0) {
  try {
    const r = await fetch(`${CDN_BASE}/data/${youtubeId}/${artifactName(lang)}${since ? '?x=' + Date.now() : ''}`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
    });
    if (!(r.ok || r.status === 206)) return false;
    if (!since) return true;
    const lm = Date.parse(r.headers.get('last-modified') || '');
    return Number.isFinite(lm) && Math.floor(lm / 1000) >= since;
  } catch {
    return false;
  }
}

// ─── EN PRIJEVOD (bez Claudea) ─────────────────────────────────────────────────
// Kanal i broj sekcija iz inventara epizoda (/api/episodes, isti INGEST_KEY). Kanal je nužan:
// video zna imati kopiju i u `_unlisted`, a `--video-id` bez `--channel` prevodi obje (2× vrijeme).
async function episodeInfo(youtubeId) {
  try {
    const { episodes } = await api('GET', `/api/episodes?q=${encodeURIComponent(youtubeId)}&limit=5`);
    return (episodes || []).find((e) => e.youtube_id === youtubeId) || null;
  } catch {
    return null;
  }
}

// Izmjereno 21.10.: sam sažetak 15 min uz Vertex 429 (umjesto ~3 min iz mjerenja 29.08.), pa
// rok ima veliku rezervu. EN se ionako claima samo kad HR reda nema.
function enTimeoutMs(sections) {
  const min = 30 + 5 * (Number.isFinite(sections) && sections > 0 ? sections : 20);
  return Math.min(Math.max(min * 60000, RUN_TIMEOUT_MS), EN_TIMEOUT_MAX_MS);
}

const EN_SUFFIXES = ['.canary.summary.en.json', '.article.en.json', '.article.magisterium.en.json'];

// Force (EN postoji samo uz stariji članak): skloni stare .en.json da ih translate (koji
// preskače postojeće) napravi iznova nad najnovijim člankom.
function backupEnFiles(channel, youtubeId) {
  const dir = path.join(FETCH_REPO, 'storage', 'output', channel);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith('.') || !f.includes(`_yt_${youtubeId}`) || !EN_SUFFIXES.some((x) => f.endsWith(x))) continue;
    fs.renameSync(path.join(dir, f), path.join(dir, `${f}.bak-${stamp}`));
    console.log(`  🗄 sklonio stari ${f.slice(-40)}`);
  }
}

// Vrati null kad je prijevod napravljen i objavljen, inače razlog za `failed`.
async function runEnglish(job) {
  const id = job.youtube_id;
  const ep = await episodeInfo(id);
  // Kanal ide u shell naredbu objave → samo sigurni znakovi (slugovi direktorija ih ionako imaju).
  const channel = ep && /^[A-Za-z0-9_-]+$/.test(ep.channel_dir || '') ? ep.channel_dir : null;
  if (job.force && !channel) return 'ponovni EN traži kanal iz inventara epizoda (report_inventory.js), a nema ga';
  if (job.force) backupEnFiles(channel, id);

  const timeout = enTimeoutMs(ep && ep.article_sections);
  const chArgs = channel ? ['--channel', channel] : [];
  console.log(`  🌐 EN prijevod (Vertex Gemini, bez Claudea)${channel ? ' · ' + channel : ''} · ${ep && ep.article_sections ? ep.article_sections + ' sekcija · ' : ''}rok ${Math.round(timeout / 60000)} min`);
  const tr = spawnSync('node', ['translate_to_english.js', '--input-dir', 'storage/output', ...chArgs, '--video-id', id], {
    cwd: FETCH_REPO,
    stdio: 'inherit',
    timeout,
  });
  if (tr.error) return `translate_to_english.js: ${tr.error.code || tr.error.message} (rok ${Math.round(timeout / 60000)} min) — gotovi dijelovi ostaju na disku`;
  if (tr.status !== 0) return `translate_to_english.js izašao s ${tr.status}`;

  // Objava kao korak 7 runbooka. Force: data/* su immutable → force_upload.js (prepis + purge).
  const upload = job.force
    ? `node force_upload.js --video-id ${id} --channel ${channel} --targets summary-en,article-en,magisterium-en`
    : `node upload_to_r2.js --input-dir storage/output --video-id ${id}`;
  const script = `${channel ? `node generate_channel_index.js --channel ${channel} && ` : ''}${upload} && node upload_to_r2.js --meta-dir storage/meta`;
  console.log('  📤 objava pod pipeline lockom (channel index + R2)…');
  const pub = spawnSync(path.join(FETCH_REPO, 'automatic', 'with_pipeline_lock.sh'), ['bash', '-c', script], {
    cwd: FETCH_REPO,
    stdio: 'inherit',
    timeout: PUBLISH_TIMEOUT_MS,
  });
  if (pub.status === 75) return 'pipeline lock nije dobiven u 30 min — prijevod je na disku, ponovi zahtjev (prijevod se preskače)';
  if (pub.error || pub.status !== 0) return `objava EN izašla s ${pub.error ? pub.error.code : pub.status}`;
  return null;
}

// ─── CLAUDE PROZOR KVOTE ──────────────────────────────────────────────────────
// Pita dijeljeni `claude-window` arbitar (repo stepanic/launchd-menubar,
// tools/claude-window, symlinkan u ~/.local/bin) smije li se sada zvati `claude`.
// Politika i testovi su tamo — ovdje je samo poziv. Aktivno uz CLAUDE_WINDOW_GUARD=1
// (postavlja ga automatic/magisterium_pipeline.sh); ručni runovi rade bez ograde.
const CLAUDE_WINDOW_BIN = process.env.CLAUDE_WINDOW_BIN || 'claude-window';
let claudeWindowLastReason = '';

// Osvježi redak u inventaru epizoda (/admin/episodes) za jedan video — bez čekanja nightlyja.
// Best-effort: report_inventory.js sam soft-exita, a greška ovdje ne smije srušiti tick.
function reportInventory(youtubeId) {
  try {
    spawnSync('node', [path.join(__dirname, 'report_inventory.js'), '--video-id', youtubeId], { stdio: 'inherit' });
  } catch (e) {
    console.log(`  ⚠️ inventar nije osvježen: ${e.message}`);
  }
}

function claudeWindowClosed() {
  if (process.env.CLAUDE_WINDOW_GUARD !== '1') return false;
  const r = spawnSync(CLAUDE_WINDOW_BIN, ['check'], { encoding: 'utf-8' });
  // Arbitar nedostupan → propusti posao. Gore je da poller stane jer symlink fali.
  if (r.error || typeof r.status !== 'number') {
    console.error(`  ⚠️ claude-window nedostupan (${r.error ? r.error.message : 'nepoznat status'}) — propuštam`);
    return false;
  }
  claudeWindowLastReason = (r.stderr || '').replace(/^claude-window:\s*/, '').trim();
  return r.status === 10;
}

function claudeWindowReason() {
  return claudeWindowLastReason || 'prozor zatvoren';
}

// Pokreni hibridni Magisterium MCP runbook headless preko Claude Code CLI. EN se traži samo
// eksplicitno (runbook default = HR-only). Vrati true ako je CLI izašao bez fatalne greške
// (svejedno se oslanjamo na CDN verifikaciju kao izvor istine, ne na exit kod).
function runRunbook(youtubeId, lang, model, force) {
  // force: ponovna obrada — runbook ne smije stati na "artefakt već postoji", a upload mora
  // prepisati immutable ključ (force_upload.js --targets magisterium, s purgeom).
  const suffix = (lang === 'en' ? ' +EN' : '') +
    (force ? ' --force (ponovna obrada: regeneriraj iako Magisterium već postoji — članak je nov; na kraju force_upload.js --targets magisterium)' : '');
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
      console.log(j.lang === 'en'
        ? `  • ${j.youtube_id} [en] → cd ${FETCH_REPO} && node translate_to_english.js --input-dir storage/output --video-id ${j.youtube_id}  (pa korak 7 runbooka)`
        : `  • ${j.youtube_id} [hr] → cd ${FETCH_REPO} && ${CLAUDE_BIN} --model ${modelFor(j)} -p "@docs/MAGISTERIUM_MCP_RUN.md ${j.youtube_id}"`);
    }
    return;
  }

  // Claude prozor kvote: poller tikca svakih 10 min, 24/7, pa bi runbook mogao
  // otvoriti nov 5h prozor u npr. 07:50 i pojesti kvotu prije nego korisnik sjedne
  // u 08:30. Provjera ide PRIJE claima — claimane jobove ne želimo ostaviti visjeti.
  // Preko dana arbitar propušta (granica 08:30 je tek sutra), pa ovo ne usporava
  // ad-hoc zahtjeve; blokira samo ~03:20–08:30. Vidi launchd-menubar/SCHEDULING.md.
  if (claudeWindowClosed()) {
    return console.log(`⏸️  Claude prozor: ${claudeWindowReason()} — preskačem tick.`);
  }

  // HR prvi (MCP, ~15 min). EN (prijevod, i preko sat vremena) tek kad HR reda nema — jedan po
  // ticku, da HR zahtjevi ne čekaju iza njega (21.10. dva HR-a stajala su iza EN-a).
  let { jobs } = await api('POST', '/api/magisterium/claim', { max: MAG_MAX, lang: 'hr' });
  if (!jobs.length) ({ jobs } = await api('POST', '/api/magisterium/claim', { max: 1, lang: 'en' }));
  if (!jobs.length) return console.log('📭 Nema Magisterium zahtjeva.');
  console.log(`🕊 Claimano ${jobs.length} Magisterium zahtjeva.`);

  for (const job of jobs) {
    const tag = `${job.youtube_id} [${job.lang}]`;
    console.log(`\n→ 🕊 ${tag} (${job.id})`);

    // 1) Već obrađeno? (auto-enqueue znatno češće pogodi ovo nego admin gumb.)
    //    Force (ponovna obrada) preskače ovu provjeru — stari artefakt je upravo ono što mijenjamo.
    const since = job.force ? job.claimed_at || Math.floor(Date.now() / 1000) : 0;
    if (!job.force && (await artifactExists(job.youtube_id, job.lang))) {
      await api('PATCH', `/api/magisterium/${job.id}`, { state: 'done' });
      console.log(`  ✅ artefakt već na CDN-u → done (preskočen run)`);
      continue;
    }

    // 2) EN: prijevod + objava bez Claudea. HR: MCP runbook headless — modelom sa zahtjeva.
    if (job.lang === 'en') {
      const err = await runEnglish(job);
      if (err) {
        await api('PATCH', `/api/magisterium/${job.id}`, { state: 'failed', error: err });
        console.log(`  ❌ ${err}`);
        reportInventory(job.youtube_id);
        continue;
      }
    } else {
      const model = modelFor(job);
      console.log(`  ▶ pokrećem MCP runbook (${CLAUDE_BIN} --model ${model} -p …) — može potrajati ~14 min…`);
      runRunbook(job.youtube_id, job.lang, model, job.force);
    }

    // 3) Verificiraj po CDN-u (izvor istine, ne exit kod). Za force: samo NOVIJI od claima.
    if (await artifactExists(job.youtube_id, job.lang, since)) {
      await api('PATCH', `/api/magisterium/${job.id}`, { state: 'done' });
      console.log(`  ✅ ${artifactName(job.lang)} live na CDN-u → done`);
    } else {
      await api('PATCH', `/api/magisterium/${job.id}`, {
        state: 'failed',
        error: `run završio, ali ${artifactName(job.lang)} nije na CDN-u (provjeri Claude CLI/MCP izlaz)`,
      });
      console.log(`  ❌ nema artefakta nakon runa → failed`);
    }
    reportInventory(job.youtube_id);
  }
})().catch((e) => {
  console.error('⚠️ magisterium_poller greška:', e.message);
  process.exit(0); // soft fail — launchd tick ne ruši ništa
});
