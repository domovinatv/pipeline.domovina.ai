import { Hono } from 'hono';
import type { Env } from './types';
import { admin } from './admin/app';
import { dashboard } from './dashboard/app';
import { jobsApi } from './jobs/api';
import { publicApi } from './jobs/v1';
import { transcriptionApi } from './transcription/api';
import { magisteriumApi } from './magisterium/api';
import { discoveredApi } from './discovered/api';
import { autoEnqueueMagisterium, countByState, sweepStuckFetching, sweepStuckTranscribing } from './db';

const app = new Hono<{ Bindings: Env }>();

// Health / info.
app.get('/', async (c) => {
  const counts = await countByState(c.env.DB).catch(() => ({}));
  return c.json({
    service: 'pipeline.domovina.ai',
    purpose: 'ad-hoc/unlisted YouTube → puni DOMOVINA AI pipeline queue',
    admin: '/admin',
    dashboard: '/dashboard?auth=<API ključ>',
    api: { enqueue: 'POST /api/jobs', claim: 'POST /api/jobs/claim', list: 'GET /api/jobs', status: 'GET /api/jobs/:id' },
    transcription: { claim: 'POST /api/transcription/claim', release: 'POST /api/transcription/release', claims: 'GET /api/transcription/claims', auth: 'Bearer <INGEST_KEY|TRANSCRIBE_KEY>' },
    magisterium: { enqueue: 'POST /api/magisterium', claim: 'POST /api/magisterium/claim', patch: 'PATCH /api/magisterium/:id', list: 'GET /api/magisterium', auth: 'Bearer <INGEST_KEY>' },
    discovered: { ingest: 'POST /api/discovered', list: 'GET /api/discovered', batches: 'GET /api/discovered/batches', admin: '/admin/discovered', auth: 'Bearer <INGEST_KEY>' },
    public_api: { enqueue: 'POST /api/v1/jobs', list: 'GET /api/v1/jobs', status: 'GET /api/v1/jobs/:id', pipeline: 'GET /api/v1/jobs/:id/pipeline', auth: 'Bearer <API ključ>' },
    counts,
  });
});

app.route('/admin', admin);
app.route('/dashboard', dashboard);
app.route('/api/jobs', jobsApi);
app.route('/api/v1', publicApi);
app.route('/api/transcription', transcriptionApi);
app.route('/api/magisterium', magisteriumApi);
app.route('/api/discovered', discoveredApi);

export default {
  fetch: app.fetch,
  // Cron: (1) vrati "stuck" fetching jobove (bridge pao prije PATCH-a) natrag u queued;
  // (2) oslobodi stale transcribe lockove (srušen Modal/Colab run inače trajno blokira fallback).
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      sweepStuckFetching(env.DB, 60 * 60).then((n) => {
        if (n) console.log(`sweep: vraćeno ${n} stuck fetching jobova u queued`);
      }),
    );
    // Stale transcribe lockovi — cutoff po backendu (modal je brz, colab legitimno dugo drži).
    ctx.waitUntil(
      sweepStuckTranscribing(env.DB, 'modal', 2 * 60 * 60).then((n) => {
        if (n) console.log(`sweep: oslobođeno ${n} stale modal transcribe lockova`);
      }),
    );
    ctx.waitUntil(
      sweepStuckTranscribing(env.DB, 'colab', 48 * 60 * 60).then((n) => {
        if (n) console.log(`sweep: oslobođeno ${n} stale colab transcribe lockova`);
      }),
    );
    // (3) Auto-enqueue Magisterium: done jobovi s with_magisterium=1 bez ijednog HR zahtjeva
    // dobiju queued zahtjev (poller ih pokupi; idempotentno preskoči ako artefakt već postoji).
    ctx.waitUntil(
      autoEnqueueMagisterium(env.DB, 10).then((n) => {
        if (n) console.log(`magisterium: auto-enqueue ${n} HR zahtjeva za done jobove`);
      }),
    );
  },
};
