import { Hono } from 'hono';
import type { Env } from '../types';
import { getApiKeyByHash } from '../db';
import { sha256Hex } from '../util';
import { renderDashboardPage, renderKeyPrompt } from './views';

// Korisnički self-service dashboard, scope-an na API ključ iz query stringa.
// Bez Basic Autha (za razliku od /admin): ključ JE autentikacija. Nema listanja
// tuđih jobova — sve što UI radi ide preko /api/v1/* s Bearer istim ključem.
export const dashboard = new Hono<{ Bindings: Env }>();

dashboard.get('/', async (c) => {
  const raw = (c.req.query('auth') || '').trim();
  if (!raw) return c.html(renderKeyPrompt());
  const key = await getApiKeyByHash(c.env.DB, await sha256Hex(raw));
  if (!key) return c.html(renderKeyPrompt('Neispravan ili onemogućen API ključ.'));
  return c.html(renderDashboardPage(key, raw));
});
