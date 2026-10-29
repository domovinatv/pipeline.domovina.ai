// Mapiranje izbora joba → što priority_poller pokreće. `node --test bridge/`
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planFor, transcriptionFlow } = require('./plan');

const ALL = { replace: true, reprocess: true, reprocessArticle: true };
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

const CLOUD = ['--with-soniox', '--with-pyannote-ai', '--gemini-refine-promote'];

test("'soniox' (default Workera) → Soniox + pyannoteAI + Gemini sluh, kao nightly", () => {
  const p = planFor({ ...base, transcription: 'soniox' }, ALL);
  assert.equal(p.error, null);
  assert.ok(has(p.args, ...CLOUD));
  // Modal Canary + lokalni pyannote ostaju kao osigurač (isto kao nightly).
  assert.ok(has(p.args, '--with-modal-transcribe', '--modal-only', '--with-local-canary-diarize'));
  // Stari put je ispao: Speechmatics je sad fallback UNUTAR 2.7b, ne zaseban korak.
  assert.ok(!p.args.includes('--with-speechmatics'));
  assert.deepEqual(p.env, { CLAUDE_MODEL: 'opus', GEMINI_REFINE_SKELETON: 'auto' });
});

test("'soniox' alias i izostavljena vrijednost → isti cloud tok", () => {
  for (const transcription of ['soniox', undefined, null, '']) {
    const p = planFor({ ...base, transcription }, ALL);
    assert.ok(has(p.args, ...CLOUD), String(transcription));
    assert.equal(p.env.GEMINI_REFINE_SKELETON, 'auto');
  }
});

test('cloud tok s vertex backendom: env nosi samo kostur', () => {
  const p = planFor({ ...base, transcription: 'speechmatics', llm_backend: 'vertex', llm_model: null }, ALL);
  assert.deepEqual(p.env, { GEMINI_REFINE_SKELETON: 'auto' });
});

test("'canary': bez cloud zastavica i bez GEMINI_REFINE_SKELETON", () => {
  const p = planFor(base, ALL);
  for (const f of [...CLOUD, '--with-speechmatics']) assert.ok(!p.args.includes(f), f);
  assert.ok(!('GEMINI_REFINE_SKELETON' in p.env));
});

test('transcriptionFlow mapiranje', () => {
  assert.equal(transcriptionFlow({ transcription: 'speechmatics' }), 'cloud');
  assert.equal(transcriptionFlow({ transcription: 'soniox' }), 'cloud');
  assert.equal(transcriptionFlow({}), 'cloud');
  assert.equal(transcriptionFlow({ transcription: 'canary' }), 'canary');
  assert.equal(transcriptionFlow({ transcription: 'none' }), 'none');
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
  const p = planFor({ ...base, reprocess: 1 }, { replace: false, reprocess: true, reprocessArticle: true });
  assert.match(p.error, /--replace/);
  assert.deepEqual(p.args, []);
});

test('ponovna obrada samo članka', () => {
  const p = planFor({ ...base, reprocess: 1, transcription: 'none' }, ALL);
  assert.equal(p.mode, 'article-only');
  assert.deepEqual(p.args, ['--reprocess-article', '6e1MW97dv10', '--gemini-backend', 'claude']);
  assert.deepEqual(p.env, { CLAUDE_MODEL: 'opus' });
  const missing = planFor({ ...base, reprocess: 1, transcription: 'none' }, { replace: true, reprocess: true, reprocessArticle: false });
  assert.match(missing.error, /--reprocess-article/);
});

test('ponovna obrada samo Magisteriuma: bez runa', () => {
  const p = planFor({ ...base, reprocess: 1, transcription: 'none', redo_article: 0 }, { replace: false, reprocessArticle: false });
  assert.equal(p.mode, 'none');
  assert.equal(p.error, null);
});

test('ponovna obrada s prijepisom: run_pipeline dobiva --reprocess', () => {
  const p = planFor({ ...base, reprocess: 1, transcription: 'speechmatics' }, ALL);
  assert.equal(p.error, null);
  assert.ok(p.args.includes('--reprocess'));
  assert.ok(has(p.args, ...CLOUD));
  assert.equal(p.env.GEMINI_REFINE_SKELETON, 'auto');
});

test('obična (ne-reprocess) obrada: bez --reprocess', () => {
  const p = planFor(base, ALL);
  assert.ok(!p.args.includes('--reprocess'));
});

test('ponovna obrada bez fetch --reprocess: greška PRIJE runa', () => {
  const p = planFor({ ...base, reprocess: 1 }, { replace: true, reprocess: false, reprocessArticle: true });
  assert.match(p.error, /--reprocess/);
});

test('„Članak ipak sada": isti run, ali bez ograde Claude prozora', () => {
  const p = planFor({ ...base, llm_force: 1 }, ALL);
  assert.equal(p.mode, 'pipeline');
  assert.equal(p.env.CLAUDE_WINDOW_GUARD, '0');
  assert.ok(has(p.args, '--unlisted-url', '--modal-only'));
});

test('bez llm_force ograda ostaje (env je ne dira)', () => {
  assert.equal(planFor(base, ALL).env.CLAUDE_WINDOW_GUARD, undefined);
});

test('odgođena ponovna obrada: samo članak, bez novog plaćenog prijepisa', () => {
  const p = planFor({ ...base, reprocess: 1, llm_force: 1 }, ALL);
  assert.equal(p.mode, 'article-only');
  assert.ok(p.args.includes('--reprocess-article'));
  assert.ok(!p.args.includes('--reprocess'));
  assert.equal(p.env.CLAUDE_WINDOW_GUARD, '0');
});
