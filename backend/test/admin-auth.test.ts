// Admin prijava (v0.19.0): bez sesije /admin ne otvara ništa, Basic Auth više ne vrijedi,
// promjene traže isti Origin. Pokretanje: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index';

const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }) }) },
  ADMIN_EMAILS: 'admin@example.com',
  ADMIN_HOST: 'pipeline.domovina.ai',
  ACCESS_TEAM_DOMAIN: 'domovina.cloudflareaccess.com',
  ACCESS_AUD: 'aud',
} as never;
const req = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request('https://pipeline.domovina.ai' + path, init), env, {} as ExecutionContext);

test('/admin bez sesije → prijava; Basic Auth zaglavlje ništa ne otvara', async () => {
  const r = await req('/admin/keys', { headers: { authorization: 'Basic ' + btoa('ms:lozinka') } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/admin/login?next=%2Fadmin%2Fkeys');
});

test('/admin/api bez sesije → 401 JSON (ne redirect)', async () => {
  assert.equal((await req('/admin/api/jobs')).status, 401);
});

test('POST bez istog Origina → 403 (CSRF)', async () => {
  assert.equal((await req('/admin/jobs', { method: 'POST' })).status, 403);
  assert.equal((await req('/admin/jobs', { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
});

test('stranica prijave: CSP s nonceom na inline skripti, pušta YouTube sličice i oEmbed', async () => {
  const r = await req('/admin/login');
  assert.equal(r.status, 200);
  const csp = r.headers.get('content-security-policy') ?? '';
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(csp, /img-src 'self' data: https:\/\/i\.ytimg\.com/);
  assert.match(csp, /connect-src 'self' https:\/\/www\.youtube\.com/);
  const html = await r.text();
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.ok(!/<script>/.test(html), 'inline <script> bez noncea');
});

test('drugi host za admin → 301 na ADMIN_HOST', async () => {
  const r = await worker.fetch(new Request('https://pipeline-domovina-backend.d-o-m.workers.dev/admin'), env, {} as ExecutionContext);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://pipeline.domovina.ai/admin');
});

test('dashboard i /api/v1 nisu pod admin prijavom', async () => {
  assert.equal((await req('/dashboard')).status, 200);
  assert.equal((await req('/api/v1/jobs')).status, 401); // Bearer ključ, ne sesija
});
