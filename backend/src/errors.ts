import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { QueueFullError } from './db';

// Globalni error handler. Pun red (db.ts MAX_QUEUED_*) s bilo kojeg API puta → 429;
// admin forma ga hvata sama (HTML). Ostalo kao Hono default.
export function onAppError(err: Error, c: Context): Response {
  if (err instanceof QueueFullError) {
    console.warn(`queue_full ${err.perKey ? 'per_key' : 'total'} ${c.req.method} ${c.req.path}`);
    return c.json({ error: err.message }, 429);
  }
  // HTTPException (npr. bearerAuth 401) nosi vlastiti odgovor.
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  return c.text('Internal Server Error', 500);
}
