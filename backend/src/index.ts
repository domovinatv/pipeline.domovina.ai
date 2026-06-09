import { Hono } from 'hono';
import type { Env } from './types';
import { admin } from './admin/app';
import { jobsApi } from './jobs/api';
import { publicApi } from './jobs/v1';
import { countByState, sweepStuckFetching } from './db';

const app = new Hono<{ Bindings: Env }>();

// Health / info.
app.get('/', async (c) => {
  const counts = await countByState(c.env.DB).catch(() => ({}));
  return c.json({
    service: 'pipeline.domovina.ai',
    purpose: 'ad-hoc/unlisted YouTube → puni DOMOVINA AI pipeline queue',
    admin: '/admin',
    api: { enqueue: 'POST /api/jobs', claim: 'POST /api/jobs/claim', list: 'GET /api/jobs', status: 'GET /api/jobs/:id' },
    public_api: { enqueue: 'POST /api/v1/jobs', list: 'GET /api/v1/jobs', status: 'GET /api/v1/jobs/:id', auth: 'Bearer <API ključ>' },
    counts,
  });
});

app.route('/admin', admin);
app.route('/api/jobs', jobsApi);
app.route('/api/v1', publicApi);

export default {
  fetch: app.fetch,
  // Cron: vrati "stuck" fetching jobove (bridge pao prije PATCH-a) natrag u queued.
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      sweepStuckFetching(env.DB, 60 * 60).then((n) => {
        if (n) console.log(`sweep: vraćeno ${n} stuck fetching jobova u queued`);
      }),
    );
  },
};
