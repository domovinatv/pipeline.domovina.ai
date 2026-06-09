import type { ApiKeyRow, JobRow, JobState } from './types';
import { genApiKey, newId, nowSec, sha256Hex } from './util';

const COLS =
  'id, youtube_id, youtube_url, title, channel, duration_seconds, source, api_key_id, state, visibility, detail_url, error, attempts, price_cents, paid, created_at, updated_at, claimed_at, done_at, deleted_at';

export interface CreateJobInput {
  youtubeId: string;
  youtubeUrl: string;
  title?: string | null;
  channel?: string | null;
  source?: string;
  apiKeyId?: string | null;
  priceCents?: number;
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

export async function createJob(db: D1Database, input: CreateJobInput): Promise<JobRow> {
  const id = newId();
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO jobs (id, youtube_id, youtube_url, title, channel, source, api_key_id, state, visibility, price_cents, paid, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'unlisted', ?, 0, 0, ?, ?)`,
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

export async function listJobs(db: D1Database, opts: ListOpts = {}): Promise<JobRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { where, binds } = buildFilter(opts);
  const res = await db
    .prepare(`SELECT ${COLS} FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
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
export async function claimJobs(db: D1Database, max: number): Promise<JobRow[]> {
  const n = Math.min(Math.max(max, 1), 25);
  const candidates = await db
    .prepare(`SELECT ${COLS} FROM jobs WHERE state = 'queued' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT ?`)
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

// Atomski "rezerviraj" 1 kredit (credits>0 guard, bez D1 transakcija). true = skinut.
export async function consumeApiKeyCredit(db: D1Database, id: string): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE api_keys SET credits = credits - 1 WHERE id = ? AND credits > 0`)
    .bind(id)
    .run();
  return (res.meta.changes ?? 0) === 1;
}

export async function touchApiKey(db: D1Database, id: string): Promise<void> {
  await db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).bind(nowSec(), id).run();
}
