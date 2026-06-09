import type { JobRow, JobState } from './types';
import { newId, nowSec } from './util';

const COLS =
  'id, youtube_id, youtube_url, title, channel, duration_seconds, source, api_key_id, state, visibility, detail_url, error, attempts, price_cents, paid, created_at, updated_at, claimed_at, done_at';

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
      `SELECT ${COLS} FROM jobs WHERE youtube_id = ? AND state NOT IN ('failed','done','skipped') ORDER BY created_at DESC LIMIT 1`,
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

export async function listJobs(
  db: D1Database,
  opts: { state?: string; limit?: number } = {},
): Promise<JobRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  let sql = `SELECT ${COLS} FROM jobs`;
  const binds: unknown[] = [];
  if (opts.state) {
    // Dozvoli više stanja odvojenih zarezom: ?state=transcribing,processing
    const states = opts.state.split(',').map((s) => s.trim()).filter(Boolean);
    if (states.length) {
      sql += ` WHERE state IN (${states.map(() => '?').join(',')})`;
      binds.push(...states);
    }
  }
  sql += ` ORDER BY created_at DESC LIMIT ?`;
  binds.push(limit);
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<JobRow>();
  return res.results ?? [];
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
    .prepare(`SELECT ${COLS} FROM jobs WHERE state = 'queued' ORDER BY created_at ASC LIMIT ?`)
    .bind(n)
    .all<JobRow>();
  const claimed: JobRow[] = [];
  const ts = nowSec();
  for (const row of candidates.results ?? []) {
    const upd = await db
      .prepare(
        `UPDATE jobs SET state='fetching', claimed_at=?, updated_at=?, attempts=attempts+1 WHERE id=? AND state='queued'`,
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
