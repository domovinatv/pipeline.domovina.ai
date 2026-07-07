import { Hono } from 'hono';
import type { Env } from '../types';
import { TRANSCRIBE_BACKENDS } from '../types';
import { claimTranscription, listTranscriptionClaims, releaseTranscription } from '../db';

export const transcriptionApi = new Hono<{ Bindings: Env }>();

// Transkripcijski claim/lock: sprječava da Colab Canary batch i Modal serverless GPU
// obrađuju ISTI video paralelno. Ključa se po youtube_id (backendi znaju samo njega).
//
// Auth: prihvaća INGEST_KEY (Mac Mini / run_pipeline.sh) ILI zaseban scoped TRANSCRIBE_KEY
// (npr. Colab — smije samo /api/transcription/*, ne može enqueue-ati ni PATCH-ati jobove).
transcriptionApi.use('*', async (c, next) => {
  const ingest = c.env.INGEST_KEY;
  const scoped = c.env.TRANSCRIBE_KEY;
  if (!ingest && !scoped) return c.json({ error: 'INGEST_KEY/TRANSCRIBE_KEY nisu konfigurirani' }, 503);
  const auth = c.req.header('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || (token !== ingest && token !== scoped)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

function isBackend(v: unknown): v is string {
  return typeof v === 'string' && (TRANSCRIBE_BACKENDS as readonly string[]).includes(v);
}

// Claim: pokušaj uzeti lock za video. {claimed:true} → transkribiraj; {claimed:false} → drugi backend drži.
// {tracked:false} → video nije u queueu (glavni korpus) → uvijek claimed (nema gejta).
transcriptionApi.post('/claim', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { youtube_id?: string; backend?: string };
  if (!body.youtube_id) return c.json({ error: 'youtube_id nedostaje' }, 400);
  if (!isBackend(body.backend)) return c.json({ error: "backend mora biti 'colab' ili 'modal'" }, 400);
  const res = await claimTranscription(c.env.DB, body.youtube_id, body.backend);
  return c.json(res);
});

// Release: oslobodi lock (opcijski samo ako ga drži zadani backend).
transcriptionApi.post('/release', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { youtube_id?: string; backend?: string };
  if (!body.youtube_id) return c.json({ error: 'youtube_id nedostaje' }, 400);
  if (body.backend !== undefined && !isBackend(body.backend)) {
    return c.json({ error: "backend mora biti 'colab' ili 'modal'" }, 400);
  }
  const released = await releaseTranscription(c.env.DB, body.youtube_id, body.backend);
  return c.json({ released });
});

// Lista aktivnih claimova (state ∈ transcribing/processing). ?backend=modal filtrira.
// Colab batch povlači ?backend=modal da zna koje WAV-ove preskočiti.
transcriptionApi.get('/claims', async (c) => {
  const backend = c.req.query('backend');
  if (backend !== undefined && !isBackend(backend)) {
    return c.json({ error: "backend mora biti 'colab' ili 'modal'" }, 400);
  }
  const claims = await listTranscriptionClaims(c.env.DB, backend);
  return c.json({ claims });
});
