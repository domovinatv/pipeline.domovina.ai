import type { ApiKeyRow, JobRow, JobState, MagisteriumJobRow } from './types';
import { genApiKey, newId, nowSec, sha256Hex } from './util';

const COLS =
  'id, youtube_id, youtube_url, title, channel, duration_seconds, source, api_key_id, state, visibility, detail_url, error, attempts, price_cents, paid, priority, credit_cost, with_magisterium, created_at, updated_at, claimed_at, transcribe_backend, transcribe_claimed_at, done_at, deleted_at';

export interface CreateJobInput {
  youtubeId: string;
  youtubeUrl: string;
  title?: string | null;
  channel?: string | null;
  source?: string;
  apiKeyId?: string | null;
  priceCents?: number;
  priority?: number; // 0 standard | 1 prioritet
  creditCost?: number; // rezervirani krediti (1 standard, 3 prioritet)
  withMagisterium?: boolean; // default true — želimo li Magisterium (KORAK 8.5) za ovaj video
}

// Vrati postojeći ne-terminalni job za isti video (idempotencija/dedup), ako postoji.
export async function findActiveJobByYoutubeId(
  db: D1Database,
  youtubeId: string,
): Promise<JobRow | null> {
  const row = await db
    .prepare(
      `SELECT ${COLS} FROM jobs WHERE youtube_id = ? AND deleted_at IS NULL AND state NOT IN ('failed','done','skipped') ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(youtubeId)
    .first<JobRow>();
  return row ?? null;
}

// Bilo koji ne-obrisan job OVOG ključa za dati video (bilo kojeg stanja, uklj.
// terminalna). Idempotencija import-grane: ponovni unos već objavljene epizode
// vrati postojeći red umjesto da stvori duplikat u korisnikovoj listi.
export async function findJobByYoutubeIdForKey(
  db: D1Database,
  youtubeId: string,
  apiKeyId: string,
): Promise<JobRow | null> {
  const row = await db
    .prepare(
      `SELECT ${COLS} FROM jobs WHERE youtube_id = ? AND api_key_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(youtubeId, apiKeyId)
    .first<JobRow>();
  return row ?? null;
}

export interface CreateImportedJobInput {
  youtubeId: string;
  youtubeUrl: string;
  title?: string | null;
  channel?: string | null;
  apiKeyId: string;
  detailUrl: string;
}

// Uveze VEĆ objavljenu epizodu u listu ključa kao gotov (done) job. NE troši kredit
// i NE queuea obradu — samo referencira postojeću publikaciju (source='import', paid=0),
// da je korisnik vidi u svom dashboardu s jasnom oznakom da je nastala izvan njegovih
// kredita (ranije, kroz admin ili neki drugi ključ / redovni pipeline).
export async function createImportedJob(
  db: D1Database,
  input: CreateImportedJobInput,
): Promise<JobRow> {
  const id = newId();
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO jobs (id, youtube_id, youtube_url, title, channel, source, api_key_id, state, visibility, detail_url, price_cents, paid, attempts, created_at, updated_at, done_at)
       VALUES (?, ?, ?, ?, ?, 'import', ?, 'done', 'unlisted', ?, 0, 0, 0, ?, ?, ?)`,
    )
    .bind(
      id,
      input.youtubeId,
      input.youtubeUrl,
      input.title ?? null,
      input.channel ?? null,
      input.apiKeyId,
      input.detailUrl,
      ts,
      ts,
      ts,
    )
    .run();
  return (await getJob(db, id))!;
}

export async function createJob(db: D1Database, input: CreateJobInput): Promise<JobRow> {
  const id = newId();
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO jobs (id, youtube_id, youtube_url, title, channel, source, api_key_id, state, visibility, price_cents, paid, priority, credit_cost, with_magisterium, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'unlisted', ?, 0, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      id,
      input.youtubeId,
      input.youtubeUrl,
      input.title ?? null,
      input.channel ?? null,
      input.source ?? 'admin',
      input.apiKeyId ?? null,
      input.priceCents ?? 0,
      input.priority ?? 0,
      input.creditCost ?? 1,
      input.withMagisterium === false ? 0 : 1,
      ts,
      ts,
    )
    .run();
  return (await getJob(db, id))!;
}

export async function getJob(db: D1Database, id: string): Promise<JobRow | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM jobs WHERE id = ?`).bind(id).first<JobRow>();
  return row ?? null;
}

export interface ListOpts {
  state?: string; // CSV dozvoljen: "queued,processing"
  q?: string; // search po youtube_id / title / channel
  apiKeyId?: string; // ograniči na jobove jednog API ključa (v1 klijent vidi samo svoje)
  limit?: number;
  offset?: number;
}

// Sastavi WHERE za listanje/brojanje (state filter + free-text search).
function buildFilter(opts: ListOpts): { where: string; binds: unknown[] } {
  const cond: string[] = [];
  const binds: unknown[] = [];
  if (opts.state) {
    const states = opts.state.split(',').map((s) => s.trim()).filter(Boolean);
    if (states.length) {
      cond.push(`state IN (${states.map(() => '?').join(',')})`);
      binds.push(...states);
    }
  }
  if (opts.q && opts.q.trim()) {
    const like = '%' + opts.q.trim() + '%';
    cond.push(`(youtube_id LIKE ? OR title LIKE ? OR channel LIKE ?)`);
    binds.push(like, like, like);
  }
  if (opts.apiKeyId) {
    cond.push(`api_key_id = ?`);
    binds.push(opts.apiKeyId);
  }
  return { where: cond.length ? 'WHERE ' + cond.join(' AND ') : '', binds };
}

// Jobs kolone prefiksirane s `j.` — nužno kad je u igri LEFT JOIN api_keys
// (obje tablice imaju id/created_at, pa bi bez prefiksa bile dvosmislene).
const JOB_COLS_J = COLS.split(',')
  .map((c) => 'j.' + c.trim())
  .join(', ');

export async function listJobs(db: D1Database, opts: ListOpts = {}): Promise<JobRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { where, binds } = buildFilter(opts);
  // LEFT JOIN api_keys → tko je predao job (ime ključa); NULL za admin/bridge unos.
  // Korelirani subupiti → najnovije Magisterium (re)obrada stanje po jeziku (za admin badge/gumb).
  const res = await db
    .prepare(
      `SELECT ${JOB_COLS_J}, ak.name AS api_key_name,
              (SELECT m.state FROM magisterium_jobs m WHERE m.youtube_id = j.youtube_id AND m.lang = 'hr' ORDER BY m.created_at DESC LIMIT 1) AS mag_hr_state,
              (SELECT m.state FROM magisterium_jobs m WHERE m.youtube_id = j.youtube_id AND m.lang = 'en' ORDER BY m.created_at DESC LIMIT 1) AS mag_en_state
       FROM jobs j LEFT JOIN api_keys ak ON ak.id = j.api_key_id
       ${where} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<JobRow>();
  return res.results ?? [];
}

// Ukupan broj jobova za dani filter (za pager).
export async function countJobs(db: D1Database, opts: ListOpts = {}): Promise<number> {
  const { where, binds } = buildFilter(opts);
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM jobs ${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export async function countByState(db: D1Database): Promise<Record<string, number>> {
  const res = await db.prepare(`SELECT state, COUNT(*) AS n FROM jobs GROUP BY state`).all<{
    state: string;
    n: number;
  }>();
  const out: Record<string, number> = {};
  for (const r of res.results ?? []) out[r.state] = r.n;
  return out;
}

// Atomski claim: pokupi do `max` queued jobova i prebaci ih u 'fetching'.
// Bez transakcija u D1 — koristimo conditional UPDATE po id-u (state='queued' guard).
// opts.priorityOnly: uzmi SAMO prioritetne (Modal fast-path poller). Bez toga: svi,
// ali priority-first (noćni bulk tako fallback drenira prioritetne prve ako je poller pao).
export async function claimJobs(
  db: D1Database,
  max: number,
  opts: { priorityOnly?: boolean } = {},
): Promise<JobRow[]> {
  const n = Math.min(Math.max(max, 1), 25);
  const prioCond = opts.priorityOnly ? ' AND priority > 0' : '';
  const candidates = await db
    .prepare(
      `SELECT ${COLS} FROM jobs WHERE state = 'queued' AND deleted_at IS NULL${prioCond} ORDER BY priority DESC, created_at ASC LIMIT ?`,
    )
    .bind(n)
    .all<JobRow>();
  const claimed: JobRow[] = [];
  const ts = nowSec();
  for (const row of candidates.results ?? []) {
    const upd = await db
      .prepare(
        `UPDATE jobs SET state='fetching', claimed_at=?, updated_at=?, attempts=attempts+1 WHERE id=? AND state='queued' AND deleted_at IS NULL`,
      )
      .bind(ts, ts, row.id)
      .run();
    // D1 meta.changes === 1 → mi smo dobili ovaj red (nije ga drugi claim preuzeo).
    if (upd.meta.changes === 1) {
      claimed.push({ ...row, state: 'fetching', claimed_at: ts, updated_at: ts, attempts: row.attempts + 1 });
    }
  }
  return claimed;
}

export interface UpdateJobInput {
  state?: JobState;
  detailUrl?: string | null;
  error?: string | null;
  title?: string | null;
  channel?: string | null;
  durationSeconds?: number | null;
}

export async function updateJob(
  db: D1Database,
  id: string,
  input: UpdateJobInput,
): Promise<JobRow | null> {
  const sets: string[] = ['updated_at=?'];
  const binds: unknown[] = [nowSec()];
  if (input.state !== undefined) {
    sets.push('state=?');
    binds.push(input.state);
    if (input.state === 'done') {
      sets.push('done_at=?');
      binds.push(nowSec());
    }
    // Terminalno stanje → transcribe lock više nema smisla; očisti ga da GET /claims
    // ostane čist i da stale-sweep nema što raditi. ('postponed' se može nastaviti → NE diraj.)
    if (input.state === 'done' || input.state === 'failed' || input.state === 'skipped') {
      sets.push('transcribe_backend=NULL', 'transcribe_claimed_at=NULL');
    }
  }
  if (input.detailUrl !== undefined) {
    sets.push('detail_url=?');
    binds.push(input.detailUrl);
  }
  if (input.error !== undefined) {
    sets.push('error=?');
    binds.push(input.error);
  }
  if (input.title !== undefined) {
    sets.push('title=?');
    binds.push(input.title);
  }
  if (input.channel !== undefined) {
    sets.push('channel=?');
    binds.push(input.channel);
  }
  if (input.durationSeconds !== undefined) {
    sets.push('duration_seconds=?');
    binds.push(input.durationSeconds);
  }
  binds.push(id);
  await db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id=?`).bind(...binds).run();
  return getJob(db, id);
}

// Soft-delete: označi redak obrisanim (reverzibilno). Claim/dedup ga ignoriraju,
// admin ga prikazuje strikethrough. Izvorno `state` ostaje netaknuto za restore.
export async function softDeleteJob(db: D1Database, id: string): Promise<boolean> {
  const ts = nowSec();
  const res = await db
    .prepare(`UPDATE jobs SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`)
    .bind(ts, ts, id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// Restore: poništi soft-delete (vrati job u listu u izvornom stanju).
export async function restoreJob(db: D1Database, id: string): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE jobs SET deleted_at=NULL, updated_at=? WHERE id=? AND deleted_at IS NOT NULL`)
    .bind(nowSec(), id)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// Trajno (nepovratno) brisanje retka iz baze.
export async function deleteJob(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM jobs WHERE id = ?`).bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// Sweep: jobovi koji su predugo zaglavili u 'fetching' (bridge pao prije PATCH-a)
// vraćaju se u 'queued' da ih sljedeći claim ponovo pokupi.
export async function sweepStuckFetching(db: D1Database, olderThanSec: number): Promise<number> {
  const cutoff = nowSec() - olderThanSec;
  const res = await db
    .prepare(`UPDATE jobs SET state='queued', updated_at=? WHERE state='fetching' AND claimed_at < ?`)
    .bind(nowSec(), cutoff)
    .run();
  return res.meta.changes ?? 0;
}

// ───────────────────────── Transkripcijski claim/lock (colab ⇄ modal) ─────────────────────────

export interface ClaimTranscriptionResult {
  claimed: boolean; // smije li pozivatelj transkribirati ovaj video
  tracked: boolean; // postoji li job u D1 queueu (false = untracked glavni korpus → uvijek claimed)
  backend: string; // 'colab' | 'modal' — kod claimed=false ovo je backend koji DRŽI lock
}

// Atomični compare-and-set claim po youtube_id (transkripcijski backendi znaju samo youtube_id,
// ne D1 uuid). Bez transakcija u D1 — conditional UPDATE (transcribe_backend IS NULL guard).
// Untracked video (nije u queueu) → {claimed:true, tracked:false}: gate vrijedi samo za queue-tracked.
export async function claimTranscription(
  db: D1Database,
  youtubeId: string,
  backend: string,
): Promise<ClaimTranscriptionResult> {
  // Aktivni (ne-terminalni, živ) job za ovaj video — kandidat za lock.
  const job = await db
    .prepare(
      `SELECT id, transcribe_backend FROM jobs
       WHERE youtube_id = ? AND deleted_at IS NULL AND state NOT IN ('done','failed','skipped')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(youtubeId)
    .first<{ id: string; transcribe_backend: string | null }>();
  if (!job) return { claimed: true, tracked: false, backend };

  const ts = nowSec();
  const upd = await db
    .prepare(
      `UPDATE jobs SET transcribe_backend=?, transcribe_claimed_at=?, updated_at=?
       WHERE id=? AND transcribe_backend IS NULL`,
    )
    .bind(backend, ts, ts, job.id)
    .run();
  // meta.changes === 1 → mi smo uzeli lock (nitko ga nije držao).
  if (upd.meta.changes === 1) return { claimed: true, tracked: true, backend };

  // 0 promjena → netko već drži. Pročitaj holdera; isti backend = idempotentan re-claim.
  const holder = await db
    .prepare(`SELECT transcribe_backend FROM jobs WHERE id=?`)
    .bind(job.id)
    .first<{ transcribe_backend: string | null }>();
  const heldBy = holder?.transcribe_backend ?? backend;
  if (heldBy === backend) return { claimed: true, tracked: true, backend };
  return { claimed: false, tracked: true, backend: heldBy };
}

// Otpusti transcribe lock za video. `backend` guard (opcionalan) spriječi da netko otpusti tuđi lock.
export async function releaseTranscription(
  db: D1Database,
  youtubeId: string,
  backend?: string,
): Promise<number> {
  const guard = backend ? ' AND transcribe_backend=?' : '';
  const binds: unknown[] = [nowSec(), youtubeId];
  if (backend) binds.push(backend);
  const res = await db
    .prepare(
      `UPDATE jobs SET transcribe_backend=NULL, transcribe_claimed_at=NULL, updated_at=?
       WHERE youtube_id=? AND deleted_at IS NULL AND transcribe_backend IS NOT NULL${guard}`,
    )
    .bind(...binds)
    .run();
  return res.meta.changes ?? 0;
}

export interface TranscriptionClaim {
  youtube_id: string;
  backend: string;
  claimed_at: number | null;
}

// Aktivni claimovi (job u transcribing/processing) — Colab batch ovo povlači da zna što preskočiti.
export async function listTranscriptionClaims(
  db: D1Database,
  backend?: string,
): Promise<TranscriptionClaim[]> {
  const guard = backend ? ' AND transcribe_backend=?' : '';
  const binds: unknown[] = [];
  if (backend) binds.push(backend);
  const res = await db
    .prepare(
      `SELECT youtube_id, transcribe_backend AS backend, transcribe_claimed_at AS claimed_at
       FROM jobs
       WHERE transcribe_backend IS NOT NULL AND deleted_at IS NULL
         AND state IN ('transcribing','processing')${guard}
       ORDER BY transcribe_claimed_at DESC`,
    )
    .bind(...binds)
    .all<TranscriptionClaim>();
  return res.results ?? [];
}

// Sweep: transcribe lock predugo u 'transcribing' (srušen run) → oslobodi (backend=NULL) da
// drugi backend može preuzeti. Cutoff je PO BACKENDU jer im se legitimni lifetime bitno razlikuje:
//   - modal → sekunde/minute; >2h = stvarno zaglavljen.
//   - colab → batch piše SRT na Drive, tek idući nightly rclone-pull + diarize gura job u
//     'processing' → lock legitimno traje i po nekoliko sati; prerani otpust bi ponovno otvorio
//     prozor za duplu transkripciju (baš safety-net radi kojeg feature postoji). Zato ~48h.
// (Kad job legitimno napreduje u processing/done/skipped, updateJob ionako očisti lock.)
export async function sweepStuckTranscribing(
  db: D1Database,
  backend: string,
  olderThanSec: number,
): Promise<number> {
  const cutoff = nowSec() - olderThanSec;
  const res = await db
    .prepare(
      `UPDATE jobs SET transcribe_backend=NULL, transcribe_claimed_at=NULL, updated_at=?
       WHERE transcribe_backend=? AND state='transcribing' AND transcribe_claimed_at < ?`,
    )
    .bind(nowSec(), backend, cutoff)
    .run();
  return res.meta.changes ?? 0;
}

// ───────────────────────── API ključevi (SaaS programatski enqueue) ─────────────────────────
const KEY_COLS = 'id, name, key_hash, credits, enabled, created_at, last_used_at';

// Kreiraj ključ: generiraj sirovi ključ, pohrani SAMO njegov SHA-256. Sirovi se
// vraća pozivatelju jednom (admin ga pokaže korisniku — poslije nije dohvatljiv).
export async function createApiKey(
  db: D1Database,
  name: string,
  credits: number,
): Promise<{ row: ApiKeyRow; rawKey: string }> {
  const id = newId();
  const rawKey = genApiKey();
  const keyHash = await sha256Hex(rawKey);
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO api_keys (id, name, key_hash, credits, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .bind(id, name, keyHash, Math.max(0, Math.floor(credits) || 0), ts)
    .run();
  return { row: (await getApiKey(db, id))!, rawKey };
}

export async function getApiKey(db: D1Database, id: string): Promise<ApiKeyRow | null> {
  return (
    (await db.prepare(`SELECT ${KEY_COLS} FROM api_keys WHERE id = ?`).bind(id).first<ApiKeyRow>()) ??
    null
  );
}

// Auth lookup: nađi OMOGUĆEN ključ po hashu (onemogućeni se tretiraju kao nepostojeći).
export async function getApiKeyByHash(db: D1Database, hash: string): Promise<ApiKeyRow | null> {
  return (
    (await db
      .prepare(`SELECT ${KEY_COLS} FROM api_keys WHERE key_hash = ? AND enabled = 1`)
      .bind(hash)
      .first<ApiKeyRow>()) ?? null
  );
}

export async function listApiKeys(db: D1Database): Promise<ApiKeyRow[]> {
  const res = await db
    .prepare(`SELECT ${KEY_COLS} FROM api_keys ORDER BY created_at DESC`)
    .all<ApiKeyRow>();
  return res.results ?? [];
}

export async function setApiKeyEnabled(
  db: D1Database,
  id: string,
  enabled: boolean,
): Promise<void> {
  await db.prepare(`UPDATE api_keys SET enabled = ? WHERE id = ?`).bind(enabled ? 1 : 0, id).run();
}

// Dopuni (ili oduzmi) kredite; ne ide ispod 0. Ručni top-up dok nema pay.domovina.ai veze.
export async function addApiKeyCredits(db: D1Database, id: string, delta: number): Promise<void> {
  await db
    .prepare(`UPDATE api_keys SET credits = MAX(0, credits + ?) WHERE id = ?`)
    .bind(Math.floor(delta) || 0, id)
    .run();
}

export async function deleteApiKey(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare(`DELETE FROM api_keys WHERE id = ?`).bind(id).run();
  return (res.meta.changes ?? 0) > 0;
}

// Atomski "rezerviraj" N kredita (credits>=n guard, bez D1 transakcija). true = skinuto.
// `credits>=?` je nosivi dio: ako ključ ima 2 a tražiš 3 → 0 promjena, bez overdrawa.
export async function consumeApiKeyCredits(db: D1Database, id: string, n: number): Promise<boolean> {
  const cost = Math.max(1, Math.floor(n) || 1);
  const res = await db
    .prepare(`UPDATE api_keys SET credits = credits - ? WHERE id = ? AND credits >= ?`)
    .bind(cost, id, cost)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

// Rezerviraj točno 1 kredit (tanki wrapper radi backward-compat poziva).
export async function consumeApiKeyCredit(db: D1Database, id: string): Promise<boolean> {
  return consumeApiKeyCredits(db, id, 1);
}

// "Forsiraj sada": digni queued standard job na prioritet (priority=1, credit_cost=3).
// Guard state='queued' AND priority=0 → ne dira ono što je već krenulo ni već-prioritetno.
// apiKeyId (opcijski) ograniči na vlasnika ključa (dashboard); admin ga izostavi.
export async function prioritizeJob(
  db: D1Database,
  id: string,
  apiKeyId: string | null,
  creditCost: number,
): Promise<boolean> {
  const ownerGuard = apiKeyId ? ' AND api_key_id = ?' : '';
  const binds: unknown[] = [creditCost, nowSec(), id];
  if (apiKeyId) binds.push(apiKeyId);
  const res = await db
    .prepare(
      `UPDATE jobs SET priority=1, credit_cost=?, updated_at=? WHERE id=? AND state='queued' AND priority=0 AND deleted_at IS NULL${ownerGuard}`,
    )
    .bind(...binds)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

export async function touchApiKey(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).bind(nowSec(), id).run();
}

// Uključi/isključi Magisterium namjeru za jedan job (admin checkbox u listi). Utječe na
// status-prikaz ("čeka" vs "preskočeno") i na cron auto-enqueue.
export async function setJobMagisterium(db: D1Database, id: string, on: boolean): Promise<void> {
  await db
    .prepare(`UPDATE jobs SET with_magisterium=?, updated_at=? WHERE id=?`)
    .bind(on ? 1 : 0, nowSec(), id)
    .run();
}

// ───────────────────────── Magisterium (re)obrada queue (magisterium_jobs) ─────────────────────────
const MAG_COLS =
  'id, youtube_id, lang, state, source, error, created_at, updated_at, claimed_at, done_at';

export async function getMagisteriumJob(db: D1Database, id: string): Promise<MagisteriumJobRow | null> {
  const row = await db
    .prepare(`SELECT ${MAG_COLS} FROM magisterium_jobs WHERE id = ?`)
    .bind(id)
    .first<MagisteriumJobRow>();
  return row ?? null;
}

// Ubaci zahtjev za Magisterium (re)obradu videa (HR default, EN samo eksplicitno). Idempotentno:
// ako VEĆ postoji aktivan (queued/running) zahtjev za isti (video, jezik) — vrati njega (deduped),
// ne stvaraj duplikat (partial unique index idx_mag_jobs_active isto štiti od race-a).
export async function enqueueMagisteriumJob(
  db: D1Database,
  input: { youtubeId: string; lang?: string; source?: string },
): Promise<{ row: MagisteriumJobRow; deduped: boolean }> {
  const lang = input.lang === 'en' ? 'en' : 'hr';
  const existing = await db
    .prepare(
      `SELECT ${MAG_COLS} FROM magisterium_jobs WHERE youtube_id=? AND lang=? AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(input.youtubeId, lang)
    .first<MagisteriumJobRow>();
  if (existing) return { row: existing, deduped: true };

  const id = newId();
  const ts = nowSec();
  try {
    await db
      .prepare(
        `INSERT INTO magisterium_jobs (id, youtube_id, lang, state, source, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      )
      .bind(id, input.youtubeId, lang, input.source ?? 'admin', ts, ts)
      .run();
  } catch {
    // Race: drugi zahtjev je upravo ubacio aktivni red (partial unique index) → vrati postojeći.
    const row = await db
      .prepare(
        `SELECT ${MAG_COLS} FROM magisterium_jobs WHERE youtube_id=? AND lang=? AND state IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(input.youtubeId, lang)
      .first<MagisteriumJobRow>();
    if (row) return { row, deduped: true };
    throw new Error('enqueueMagisteriumJob: insert nije uspio');
  }
  return { row: (await getMagisteriumJob(db, id))!, deduped: false };
}

// Atomski claim: pokupi do `max` queued Magisterium zahtjeva → 'running' (bridge poller).
// Bez D1 transakcija — conditional UPDATE (state='queued' guard), isto kao claimJobs.
export async function claimMagisteriumJobs(db: D1Database, max: number): Promise<MagisteriumJobRow[]> {
  const n = Math.min(Math.max(max, 1), 10);
  const candidates = await db
    .prepare(`SELECT ${MAG_COLS} FROM magisterium_jobs WHERE state='queued' ORDER BY created_at ASC LIMIT ?`)
    .bind(n)
    .all<MagisteriumJobRow>();
  const claimed: MagisteriumJobRow[] = [];
  const ts = nowSec();
  for (const row of candidates.results ?? []) {
    const upd = await db
      .prepare(`UPDATE magisterium_jobs SET state='running', claimed_at=?, updated_at=? WHERE id=? AND state='queued'`)
      .bind(ts, ts, row.id)
      .run();
    if (upd.meta.changes === 1) claimed.push({ ...row, state: 'running', claimed_at: ts, updated_at: ts });
  }
  return claimed;
}

// Poller javlja ishod: state='done' (obrađeno/verificirano na CDN-u) ili 'failed' (+error).
export async function updateMagisteriumJob(
  db: D1Database,
  id: string,
  input: { state?: string; error?: string | null },
): Promise<MagisteriumJobRow | null> {
  const sets: string[] = ['updated_at=?'];
  const binds: unknown[] = [nowSec()];
  if (input.state !== undefined) {
    sets.push('state=?');
    binds.push(input.state);
    if (input.state === 'done') {
      sets.push('done_at=?');
      binds.push(nowSec());
    }
  }
  if (input.error !== undefined) {
    sets.push('error=?');
    binds.push(input.error);
  }
  binds.push(id);
  await db.prepare(`UPDATE magisterium_jobs SET ${sets.join(', ')} WHERE id=?`).bind(...binds).run();
  return getMagisteriumJob(db, id);
}

export async function listMagisteriumJobs(
  db: D1Database,
  opts: { state?: string; limit?: number } = {},
): Promise<MagisteriumJobRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const where = opts.state ? ' WHERE state=?' : '';
  const binds: unknown[] = opts.state ? [opts.state] : [];
  const res = await db
    .prepare(`SELECT ${MAG_COLS} FROM magisterium_jobs${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...binds, limit)
    .all<MagisteriumJobRow>();
  return res.results ?? [];
}

// Cron auto-enqueue: done jobovi s with_magisterium=1 koji JOŠ NEMAJU nijedan magisterium_jobs
// zapis (bilo kojeg stanja) → auto-ubaci HR zahtjev (source='auto'). Idempotentno: poller prvo
// provjeri CDN artefakt i preskoči run ako Magisterium već postoji. Jednom pokušano (uklj. failed)
// → ne re-enqueuea se (spriječi petlju); ručni gumb u adminu svejedno može ponovno zatražiti.
export async function autoEnqueueMagisterium(db: D1Database, cap = 10): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT j.youtube_id AS youtube_id FROM jobs j
       WHERE j.state='done' AND j.with_magisterium=1 AND j.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM magisterium_jobs m WHERE m.youtube_id=j.youtube_id AND m.lang='hr')
       ORDER BY j.updated_at DESC LIMIT ?`,
    )
    .bind(Math.min(Math.max(cap, 1), 25))
    .all<{ youtube_id: string }>();
  let n = 0;
  for (const r of rows.results ?? []) {
    const { deduped } = await enqueueMagisteriumJob(db, { youtubeId: r.youtube_id, lang: 'hr', source: 'auto' });
    if (!deduped) n++;
  }
  return n;
}
