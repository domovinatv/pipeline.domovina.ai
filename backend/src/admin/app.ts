import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env } from '../types';
import { countByState, createJob, findActiveJobByYoutubeId, listJobs } from '../db';
import { extractYouTubeId, watchUrl } from '../util';
import { layout, renderJobsPage } from './views';

export const admin = new Hono<{ Bindings: Env }>();

// Basic Auth gate na cijelo /admin stablo. Bez postavljenih secreta → 503 (safe default).
admin.use('*', async (c, next) => {
  if (!c.env.ADMIN_USER || !c.env.ADMIN_PASS) {
    return c.text('Admin nije konfiguriran (postavi ADMIN_USER + ADMIN_PASS secrete).', 503);
  }
  const mw = basicAuth({
    username: c.env.ADMIN_USER,
    password: c.env.ADMIN_PASS,
    realm: 'DOMOVINA Pipeline admin',
  });
  return mw(c, next);
});

admin.get('/', (c) => c.html(renderJobsPage()));

// Forma "dodaj u queue".
admin.post('/jobs', async (c) => {
  const form = await c.req.parseBody();
  const raw = String(form.url ?? '').trim();
  const title = String(form.title ?? '').trim() || null;
  const youtubeId = extractYouTubeId(raw);
  if (!youtubeId) {
    return c.html(
      layout(
        'DOMOVINA Pipeline — greška',
        `<h1>Neispravan unos</h1><p>Ne mogu izvući YouTube ID iz: <span class="mono">${raw.replace(/</g, '&lt;')}</span></p><p><a href="/admin">← natrag</a></p>`,
      ),
      400,
    );
  }
  // Dedup: ako već postoji aktivan job za isti video, ne stvaraj duplikat.
  const existing = await findActiveJobByYoutubeId(c.env.DB, youtubeId);
  if (!existing) {
    await createJob(c.env.DB, {
      youtubeId,
      youtubeUrl: watchUrl(youtubeId),
      title,
      source: 'admin',
      priceCents: 0,
    });
  }
  return c.redirect('/admin', 303);
});

// JSON za client-side auto-refresh tablice.
admin.get('/api/jobs', async (c) => {
  const limit = Number(c.req.query('limit') ?? 200);
  const [jobs, counts] = await Promise.all([
    listJobs(c.env.DB, { limit }),
    countByState(c.env.DB),
  ]);
  return c.json({ counts, jobs });
});
