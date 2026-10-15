// /api/v1 (korisnički API ključ): izbori obrade kao admin (v0.18.0) i ograde ponovne obrade.
// Pokretanje: `npm test`.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { publicApi } from '../src/jobs/v1';
import { MAX_QUEUED_PER_KEY, MAX_QUEUED_TOTAL } from '../src/db';
import { onAppError } from '../src/errors';

// Kao u index.ts: QueueFullError → 429 ide kroz globalni onError.
const app = new Hono().route('/', publicApi);
app.onError(onAppError);

const KEY = { id: 'key1', name: 'prijatelj', credits: 10, enabled: 1 };

// ── Lažni D1: api_keys lookup vraća KEY, SELECT joba po id-u vraća `job`, ostali SELECT-i null.
interface Call { sql: string; binds: unknown[] }
// `queued` = što vraća COUNT reda na čekanju; `insertChanges` = 0 glumi INSERT koji je odbio limit.
function fakeDb(job: Record<string, unknown> | null = null, opts: { queued?: number; insertChanges?: number } = {}) {
  const calls: Call[] = [];
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    run: async () => {
      calls.push({ sql, binds });
      return { meta: { changes: sql.includes('INSERT INTO jobs') ? (opts.insertChanges ?? 1) : 1 } };
    },
    first: async () => {
      calls.push({ sql, binds });
      if (sql.startsWith('SELECT COUNT(*) FROM jobs')) return opts.queued ?? 0;
      if (sql.includes('FROM api_keys WHERE key_hash')) return KEY;
      if (sql.includes('FROM jobs WHERE id = ?')) return job;
      return null;
    },
    all: async () => { calls.push({ sql, binds }); return { results: [] }; },
  });
  return { calls, db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database };
}

// CDN/oEmbed: ništa ne postoji (video nije objavljen).
const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

async function post(db: D1Database, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { authorization: 'Bearer pdk_test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db } as never);
}
function insertBinds(calls: Call[]): Record<string, unknown> {
  const ins = calls.find((c) => c.sql.includes('INSERT INTO jobs'));
  assert.ok(ins, 'job nije upisan');
  const cols = ins.sql.match(/INSERT INTO jobs \(([^)]+)\)/)![1].split(',').map((s) => s.trim());
  // INSERT … SELECT <vrijednosti> WHERE <limit reda> (db.ts createJob).
  const vals = ins.sql.match(/SELECT (.+?)\s+WHERE \(/s)![1].split(',').map((s) => s.trim());
  const row: Record<string, unknown> = {};
  let b = 0;
  cols.forEach((c, i) => { row[c] = vals[i] === '?' ? ins.binds[b++] : vals[i]; });
  return row;
}

test('enqueue bez izbora = maksimalna kvaliteta (Opus članak, Magisterium, Speechmatics)', async () => {
  const { db, calls } = fakeDb();
  const r = await post(db, '/jobs', { url: '6e1MW97dv10', tier: 'priority' });
  assert.equal(r.status, 201);
  const row = insertBinds(calls);
  assert.equal(row.llm_backend, 'claude');
  assert.equal(row.llm_model, 'opus');
  assert.equal(row.with_magisterium, 1);
  assert.equal(row.transcription, 'speechmatics');
  assert.equal(row.credit_cost, 5);
  assert.equal(row.api_key_id, 'key1');
});

test('enqueue poštuje izbore modela iz dashboarda', async () => {
  const { db, calls } = fakeDb();
  await post(db, '/jobs', {
    url: '6e1MW97dv10', tier: 'priority', transcription: 'canary',
    article_model: 'claude:sonnet', with_magisterium: false, magisterium_model: 'haiku',
  });
  const row = insertBinds(calls);
  assert.equal(row.llm_model, 'sonnet');
  assert.equal(row.with_magisterium, 0);
  assert.equal(row.magisterium_model, 'haiku');
  assert.equal(row.credit_cost, 3);
});

test('nepoznat model → 400, ništa se ne naplati ni upiše', async () => {
  const { db, calls } = fakeDb();
  const r = await post(db, '/jobs', { url: '6e1MW97dv10', article_model: 'fable' });
  assert.equal(r.status, 400);
  assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO jobs') || c.sql.includes('credits = credits -')));
});

const doneJob = {
  id: 'j1', api_key_id: 'key1', youtube_id: '6e1MW97dv10', youtube_url: 'https://www.youtube.com/watch?v=6e1MW97dv10',
  source_platform: 'youtube', source_url: 'https://www.youtube.com/watch?v=6e1MW97dv10', title: 'T', channel: 'C',
  state: 'done', source: 'api', transcription: 'speechmatics', credit_cost: 5,
};

test('ponovna obrada vlastitog gotovog videa: prioritetno, naplaćeno po prijepisu', async () => {
  const { db, calls } = fakeDb(doneJob);
  const r = await post(db, '/jobs/j1/reprocess', { transcription: 'none', article_mode: 'keep', with_magisterium: true });
  assert.equal(r.status, 201);
  const row = insertBinds(calls);
  assert.equal(row.reprocess, 1);
  assert.equal(row.priority, 1);
  assert.equal(row.redo_article, 0);
  assert.equal(row.transcription, 'none');
  assert.equal(row.credit_cost, 3);
});

test('ponovna obrada: tuđi job 404, uvezena epizoda 403, nedovršen 409', async () => {
  assert.equal((await post(fakeDb({ ...doneJob, api_key_id: 'drugi' }).db, '/jobs/j1/reprocess', {})).status, 404);
  assert.equal((await post(fakeDb({ ...doneJob, source: 'import' }).db, '/jobs/j1/reprocess', {})).status, 403);
  assert.equal((await post(fakeDb({ ...doneJob, state: 'processing' }).db, '/jobs/j1/reprocess', {})).status, 409);
});

test('promjena modela članka na gotovom jobu → 409; Magisterium model prolazi', async () => {
  const { db, calls } = fakeDb(doneJob);
  assert.equal((await post(db, '/jobs/j1/llm-model', { value: 'vertex' })).status, 409);
  assert.equal((await post(db, '/jobs/j1/mag-model', { value: 'sonnet' })).status, 200);
  assert.ok(calls.some((c) => c.sql.includes('magisterium_model') && c.sql.startsWith('UPDATE')));
});

test('pun red → 429 PRIJE naplate: ni kredit ni job', async () => {
  for (const queued of [MAX_QUEUED_TOTAL, MAX_QUEUED_PER_KEY]) {
    const { db, calls } = fakeDb(null, { queued });
    const r = await post(db, '/jobs', { url: '6e1MW97dv10', tier: 'priority' });
    assert.equal(r.status, 429);
    assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO jobs') || c.sql.includes('credits = credits -')));
  }
});

test('INSERT odbijen limitom (utrka) → 429 i krediti vraćeni', async () => {
  const { db, calls } = fakeDb(null, { insertChanges: 0 });
  const r = await post(db, '/jobs', { url: '6e1MW97dv10', tier: 'priority' });
  assert.equal(r.status, 429);
  const refund = calls.find((c) => c.sql.includes('MIN(?, MAX(0, credits + ?))'));
  assert.ok(refund, 'krediti nisu vraćeni');
  assert.equal(refund.binds[1], 5);
});

test('limit reda je u samom INSERT-u, i po ključu', async () => {
  const { db, calls } = fakeDb();
  await post(db, '/jobs', { url: '6e1MW97dv10' });
  const ins = calls.find((c) => c.sql.includes('INSERT INTO jobs'))!;
  assert.match(ins.sql, /WHERE \(SELECT COUNT\(\*\) FROM jobs WHERE state = 'queued'/);
  assert.deepEqual(ins.binds.slice(-4), [MAX_QUEUED_TOTAL, 'key1', 'key1', MAX_QUEUED_PER_KEY]);
});
