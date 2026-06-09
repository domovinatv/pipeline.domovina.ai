import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import type { Env } from '../types';
import { countByState, countJobs, createJob, deleteJob, findActiveJobByYoutubeId, listJobs, restoreJob, softDeleteJob, updateJob } from '../db';
import { extractYouTubeId, fetchOEmbed, watchUrl } from '../util';
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
    const meta = await fetchOEmbed(youtubeId); // public → naslov+kanal; unlisted → null
    await createJob(c.env.DB, {
      youtubeId,
      youtubeUrl: watchUrl(youtubeId),
      title: title || meta?.title || null,
      channel: meta?.channel ?? null,
      source: 'admin',
      priceCents: 0,
    });
  }
  return c.redirect('/admin', 303);
});

// Admin akcije po jobu (poziva ih tablica preko fetch-a; Basic Auth se nasljeđuje).
//   delete   — soft-delete (reverzibilno; redak ostaje strikethrough u listi)
//   restore  — poništi soft-delete (vrati job u izvorno stanje)
//   purge    — TRAJNO obriši redak iz baze (nepovratno; iza confirm-a u UI-u)
//   skip     — state=skipped (nikad se ne claima)
//   postpone — state=postponed (drži izvan queuea)
//   requeue  — vrati u queued (iz skipped/postponed/failed), očisti grešku
admin.post('/jobs/:id/:action', async (c) => {
  const id = c.req.param('id');
  const action = c.req.param('action');
  switch (action) {
    case 'delete':
      await softDeleteJob(c.env.DB, id);
      break;
    case 'restore':
      await restoreJob(c.env.DB, id);
      break;
    case 'purge':
      await deleteJob(c.env.DB, id);
      break;
    case 'skip':
      await updateJob(c.env.DB, id, { state: 'skipped' });
      break;
    case 'postpone':
      await updateJob(c.env.DB, id, { state: 'postponed' });
      break;
    case 'requeue':
      await updateJob(c.env.DB, id, { state: 'queued', error: null });
      break;
    default:
      return c.json({ error: `nepoznata akcija: ${action}` }, 400);
  }
  return c.json({ ok: true });
});

// JSON za client-side auto-refresh tablice (paginirano + filter + search).
admin.get('/api/jobs', async (c) => {
  const limit = Number(c.req.query('limit') ?? 50);
  const offset = Number(c.req.query('offset') ?? 0);
  const state = c.req.query('state') || undefined;
  const q = c.req.query('q') || undefined;
  const [jobs, counts, total] = await Promise.all([
    listJobs(c.env.DB, { limit, offset, state, q }),
    countByState(c.env.DB), // globalni brojevi po stanju (jeftin GROUP BY) — za stats trake/filter
    countJobs(c.env.DB, { state, q }), // total za trenutni filter → pager
  ]);
  return c.json({ counts, jobs, total, limit, offset });
});
