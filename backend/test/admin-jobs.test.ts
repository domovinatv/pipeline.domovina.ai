// Regresijski testovi za bugove nađene 08.10.2026. na ponovnoj obradi 6e1MW97dv10
// (job 34741663…). Pokretanje: `npm test` (esbuild bundla TS, pa `node --test`).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { admin } from '../src/admin/app';
import { isFreshFor, reconcilePublishedJobs } from '../src/pipeline';
import { cleanTitle } from '../src/util';

// ── Lažni D1: bilježi svaki SQL + bindove; SELECT-i ne vraćaju ništa.
interface Call { sql: string; binds: unknown[] }
function fakeDb() {
  const calls: Call[] = [];
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    run: async () => { calls.push({ sql, binds }); return { meta: { changes: 1 } }; },
    first: async () => { calls.push({ sql, binds }); return null; },
    all: async () => { calls.push({ sql, binds }); return { results: [] }; },
  });
  return { calls, db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database };
}

// ── fetch mock: article.json postoji na CDN-u s danim Last-Modified; oEmbed 404.
const realFetch = globalThis.fetch;
let articleLastModified: string | null = null;
beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/article.json') && articleLastModified !== null) {
      return new Response('{', { status: 206, headers: { 'last-modified': articleLastModified } });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  articleLastModified = null;
});

const AUTH = { authorization: 'Basic ' + btoa('u:p') };
function env(db: D1Database) {
  return { DB: db, ADMIN_USER: 'u', ADMIN_PASS: 'p', CDN_BASE: 'https://cdn.test', SITE_BASE: 'https://site.test' };
}
function post(db: D1Database, fields: Record<string, string>) {
  return admin.request(
    '/jobs',
    { method: 'POST', headers: AUTH, body: new URLSearchParams(fields) },
    env(db),
  );
}
// Iz HTML-a potvrdne stranice izvuci što bi browser poslao: hidden polja, označeni
// radio/checkbox i odabrane <option> u selectima (ono što forma podnosi bez klikanja).
function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) out[m[1]] = m[2];
  for (const m of html.matchAll(/<input type="(?:radio|checkbox)" name="([^"]+)" value="([^"]*)" checked>/g)) out[m[1]] = m[2];
  for (const m of html.matchAll(/<select (?:id="[^"]+" )?name="([^"]+)">(.*?)<\/select>/gs)) {
    const sel = m[2].match(/<option value="([^"]*)" selected>/);
    if (sel) out[m[1]] = sel[1];
  }
  return out;
}
function insertBinds(calls: Call[]): Record<string, unknown> {
  const ins = calls.find((c) => c.sql.includes('INSERT INTO jobs'));
  assert.ok(ins, 'job nije upisan');
  const cols = ins.sql.match(/INSERT INTO jobs \(([^)]+)\)/)![1].split(',').map((s) => s.trim());
  const vals = ins.sql.match(/VALUES \(([^)]+)\)/)![1].split(',').map((s) => s.trim());
  const row: Record<string, unknown> = {};
  let b = 0;
  cols.forEach((c, i) => { row[c] = vals[i] === '?' ? ins.binds[b++] : vals[i]; });
  return row;
}

// §2: Prioritet (i transkripcija) mora preživjeti potvrdnu stranicu "već objavljeno".
test('već objavljena epizoda: priority + transcription prolaze kroz "svejedno dodaj"', async () => {
  articleLastModified = 'Sat, 14 Mar 2026 10:00:00 GMT';
  const { db, calls } = fakeDb();
  const first = await post(db, {
    url: 'https://www.youtube.com/watch?v=6e1MW97dv10',
    priority: '1',
    transcription: 'canary',
    mag_present: '1',
    with_magisterium: '1',
  });
  const html = await first.text();
  assert.match(html, /već objavljena/);
  const hidden = hiddenFields(html);
  assert.equal(hidden.priority, '1');
  assert.equal(hidden.transcription, 'canary');
  assert.equal(hidden.force, '1');

  const second = await post(db, hidden);
  assert.equal(second.status, 303);
  const row = insertBinds(calls);
  assert.equal(row.priority, 1);
  assert.equal(row.credit_cost, 3);
  assert.equal(row.transcription, 'canary');
});

test('ponovna obrada: default izbori = Speechmatics + novi Opus članak + Magisterium, prioritetno', async () => {
  articleLastModified = 'Sat, 14 Mar 2026 10:00:00 GMT';
  const { db, calls } = fakeDb();
  const html = await (await post(db, { url: '6e1MW97dv10' })).text();
  const f = hiddenFields(html);
  assert.equal(f.reprocess, '1');
  assert.equal(f.transcription, 'speechmatics');
  assert.equal(f.article_mode, 'new');
  assert.equal(f.article_model, 'claude:opus');
  assert.equal(f.with_magisterium, '1');
  assert.equal((await post(db, f)).status, 303);
  const row = insertBinds(calls);
  assert.equal(row.reprocess, 1);
  assert.equal(row.priority, 1);
  assert.equal(row.redo_article, 1);
  assert.equal(row.transcription, 'speechmatics');
  assert.equal(row.llm_backend, 'claude');
  assert.equal(row.llm_model, 'opus');
});

test('ponovna obrada: novi prijepis povlači novi članak čak i kad forma kaže keep', async () => {
  const { db, calls } = fakeDb();
  await post(db, { url: '6e1MW97dv10', force: '1', reprocess: '1', transcription: 'canary', article_mode: 'keep', mag_present: '1' });
  assert.equal(insertBinds(calls).redo_article, 1);
});

test('ponovna obrada samo Magisteriuma', async () => {
  const { db, calls } = fakeDb();
  await post(db, { url: '6e1MW97dv10', force: '1', reprocess: '1', transcription: 'none', article_mode: 'keep', mag_present: '1', with_magisterium: '1' });
  const row = insertBinds(calls);
  assert.equal(row.transcription, 'none');
  assert.equal(row.redo_article, 0);
});

test('ponovna obrada bez ijednog izbora → 400, ništa upisano', async () => {
  articleLastModified = 'Sat, 14 Mar 2026 10:00:00 GMT';
  const { db, calls } = fakeDb();
  const res = await post(db, { url: '6e1MW97dv10', force: '1', reprocess: '1', transcription: 'none', article_mode: 'keep', mag_present: '1' });
  assert.equal(res.status, 400);
  assert.ok(!calls.some((c) => c.sql.includes('INSERT INTO jobs')));
});

test("'none' prijepis izvan ponovne obrade pada na default", async () => {
  const { db, calls } = fakeDb();
  await post(db, { url: '6e1MW97dv10', transcription: 'none' });
  const row = insertBinds(calls);
  assert.equal(row.transcription, 'speechmatics');
  assert.equal(row.reprocess, 0);
});

test('novi job bez izbora transkripcije dobije Speechmatics (kao nightly)', async () => {
  const { db, calls } = fakeDb();
  const res = await post(db, { url: '6e1MW97dv10', title: 'Pravi naslov' });
  assert.equal(res.status, 303);
  const row = insertBinds(calls);
  assert.equal(row.transcription, 'speechmatics');
  assert.equal(row.title, 'Pravi naslov');
});

// §4: naslov koji je zapravo URL se ne smije spremiti (postao bi ime datoteke).
test('naslov = URL se tretira kao prazan', async () => {
  const { db, calls } = fakeDb();
  const url = 'https://www.youtube.com/watch?v=6e1MW97dv10';
  await post(db, { url, title: url });
  assert.equal(insertBinds(calls).title, null);
});

test('cleanTitle', () => {
  const u = 'https://youtu.be/6e1MW97dv10';
  assert.equal(cleanTitle('  ', u), null);
  assert.equal(cleanTitle(u, u), null);
  assert.equal(cleanTitle('https://www.youtube.com/watch?v=xyz', u), null);
  assert.equal(cleanTitle('youtube.com/watch?v=xyz', u), null);
  assert.equal(cleanTitle('x.com/foo/status/1', u), null);
  assert.equal(cleanTitle('Hitna pomoć za nemirne #12', u), 'Hitna pomoć za nemirne #12');
  assert.equal(cleanTitle('Xavier o vjeri', u), 'Xavier o vjeri');
});

// §3: stari članak na CDN-u ne smije zatvoriti ponovnu obradu.
test('isFreshFor: članak stariji od claima nije signal gotovosti', () => {
  const job = { created_at: 1000, claimed_at: 2000 };
  assert.equal(isFreshFor({ present: true, at: 1500 }, job), false);
  assert.equal(isFreshFor({ present: true, at: 2000 }, job), true);
  assert.equal(isFreshFor({ present: true, at: 2600 }, job), true);
  assert.equal(isFreshFor({ present: false, at: null }, job), false);
  assert.equal(isFreshFor({ present: true, at: null }, job), false);
  // Bez claima sidro je kreiranje joba.
  assert.equal(isFreshFor({ present: true, at: 1100 }, { created_at: 1000, claimed_at: null }), true);
});

test('reconcilePublishedJobs: ponovna obrada ostaje u tijeku dok ne stigne novi članak', async () => {
  const claimedAt = Date.parse('2026-10-08T21:03:16Z') / 1000;
  const mk = () => ({
    id: '34741663', youtube_id: '6e1MW97dv10', state: 'fetching', detail_url: null,
    deleted_at: null, created_at: claimedAt - 30, claimed_at: claimedAt,
  });

  articleLastModified = 'Sat, 14 Mar 2026 10:00:00 GMT'; // ožujski članak
  let { db, calls } = fakeDb();
  let job = mk();
  assert.equal(await reconcilePublishedJobs(db, 'https://cdn.test', 'https://site.test', [job]), 0);
  assert.equal(job.state, 'fetching');
  assert.equal(calls.filter((c) => c.sql.startsWith('UPDATE')).length, 0);

  articleLastModified = 'Thu, 08 Oct 2026 21:40:00 GMT'; // novi članak nakon claima
  ({ db, calls } = fakeDb());
  job = mk();
  assert.equal(await reconcilePublishedJobs(db, 'https://cdn.test', 'https://site.test', [job]), 1);
  assert.equal(job.state, 'done');
});
