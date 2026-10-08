// Mapiranje izbora joba → što priority_poller pokreće. `node --test bridge/`
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planFor } = require('./plan');

const ALL = { replace: true, reprocessArticle: true };
const base = {
  youtube_id: '6e1MW97dv10',
  youtube_url: 'https://www.youtube.com/watch?v=6e1MW97dv10',
  title: 'Naslov',
  source: 'admin',
  llm_backend: 'claude',
  llm_model: 'opus',
  transcription: 'canary',
  reprocess: 0,
  redo_article: 1,
};
const has = (args, ...flags) => flags.every((f) => args.includes(f));

test('običan prioritetni job s Canaryjem: bit-identično dosadašnjem pozivu', () => {
  const p = planFor(base, { replace: false, reprocessArticle: false });
  assert.equal(p.error, null);
  assert.equal(p.mode, 'pipeline');
  assert.deepEqual(p.args, [
    '--unlisted-url', base.youtube_url, '--unlisted-title', 'Naslov',
    '--with-modal-transcribe', '--modal-only', '6e1MW97dv10',
    '--with-local-canary-diarize', '--with-r2-upload', '--gemini-backend', 'claude',
  ]);
  assert.deepEqual(p.env, { CLAUDE_MODEL: 'opus' });
  assert.deepEqual(p.reuseArgs, ['--video-id', '6e1MW97dv10']);
});

test('Speechmatics: + --with-speechmatics --gemini-refine-promote, Modal Canary ostaje', () => {
  const p = planFor({ ...base, transcription: 'speechmatics' }, ALL);
  assert.ok(has(p.args, '--with-speechmatics', '--gemini-refine-promote', '--with-modal-transcribe'));
});

test('vertex backend se ne prosljeđuje i ne postavlja CLAUDE_MODEL', () => {
  const p = planFor({ ...base, llm_backend: 'vertex', llm_model: null }, ALL);
  assert.ok(!p.args.includes('--gemini-backend'));
  assert.deepEqual(p.env, {});
});

test('nepoznat backend → vertex (whitelist)', () => {
  const p = planFor({ ...base, llm_backend: 'rm -rf' }, ALL);
  assert.ok(!p.args.includes('--gemini-backend'));
});

test('X post: sintetički id ide eksplicitno', () => {
  const p = planFor({ ...base, source: 'x-admin' }, ALL);
  assert.ok(has(p.args, '--unlisted-id', '--unlisted-source'));
});

test('ponovna obrada s prijepisom: reuse s --replace', () => {
  const p = planFor({ ...base, reprocess: 1, transcription: 'speechmatics' }, ALL);
  assert.equal(p.mode, 'pipeline');
  assert.deepEqual(p.reuseArgs, ['--video-id', '6e1MW97dv10', '--replace']);
});

test('ponovna obrada bez fetch --replace: greška PRIJE runa', () => {
  const p = planFor({ ...base, reprocess: 1 }, { replace: false, reprocessArticle: true });
  assert.match(p.error, /--replace/);
  assert.deepEqual(p.args, []);
});

test('ponovna obrada samo članka', () => {
  const p = planFor({ ...base, reprocess: 1, transcription: 'none' }, ALL);
  assert.equal(p.mode, 'article-only');
  assert.deepEqual(p.args, ['--reprocess-article', '6e1MW97dv10', '--gemini-backend', 'claude']);
  assert.deepEqual(p.env, { CLAUDE_MODEL: 'opus' });
  const missing = planFor({ ...base, reprocess: 1, transcription: 'none' }, { replace: true, reprocessArticle: false });
  assert.match(missing.error, /--reprocess-article/);
});

test('ponovna obrada samo Magisteriuma: bez runa', () => {
  const p = planFor({ ...base, reprocess: 1, transcription: 'none', redo_article: 0 }, { replace: false, reprocessArticle: false });
  assert.equal(p.mode, 'none');
  assert.equal(p.error, null);
});
