import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../types';
import { getApiKeyByHash } from '../db';
import { sha256Hex } from '../util';
import { renderDashboardPage, renderKeyPrompt } from './views';

// Korisnički self-service dashboard, scope-an na API ključ.
// Bez admin prijave (za razliku od /admin): ključ JE autentikacija. Nema listanja
// tuđih jobova — sve što UI radi ide preko /api/v1/* s Bearer istim ključem.
//
// Ključ ne stoji u URL-u (povijest preglednika, logovi, Referer): `?auth=pdk_…` (stari
// bookmarkovi, link koji admin pošalje) se jednom provjeri, spremi u HttpOnly kolačić i
// preusmjeri na čisti /dashboard.
export const dashboard = new Hono<{ Bindings: Env }>();

const KEY_COOKIE = '__Host-pipeline_key';
const KEY_COOKIE_MAX_AGE = 90 * 24 * 3600;

function keyCookie(value: string, maxAge: number): string {
  return `${KEY_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readKeyCookie(header: string | undefined): string {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === KEY_COOKIE) return decodeURIComponent(v.join('='));
  }
  return '';
}

// Stranica nosi ključ u inline JS-u (Bearer za /api/v1) — ne smije se cacheati ni uokviriti.
function secure(c: Context, html: string, status: 200 | 401 = 200) {
  c.header('cache-control', 'no-store');
  c.header('referrer-policy', 'same-origin');
  c.header('x-frame-options', 'DENY');
  c.header('x-content-type-options', 'nosniff');
  return c.html(html, status);
}

dashboard.get('/', async (c) => {
  const fromQuery = (c.req.query('auth') || '').trim();
  if (fromQuery) {
    const key = await getApiKeyByHash(c.env.DB, await sha256Hex(fromQuery));
    if (!key) return secure(c, renderKeyPrompt('Neispravan ili onemogućen API ključ.'), 401);
    c.header('set-cookie', keyCookie(fromQuery, KEY_COOKIE_MAX_AGE));
    return c.redirect('/dashboard', 302);
  }
  const raw = readKeyCookie(c.req.header('cookie'));
  if (!raw) return secure(c, renderKeyPrompt());
  const key = await getApiKeyByHash(c.env.DB, await sha256Hex(raw));
  if (!key) {
    // Ključ je u međuvremenu onemogućen/obrisan → makni kolačić, traži novi.
    c.header('set-cookie', keyCookie('', 0));
    return secure(c, renderKeyPrompt('API ključ više nije aktivan.'), 401);
  }
  return secure(c, renderDashboardPage(key, raw));
});

// „Odjava" s ovog preglednika (ključ ostaje važeći; samo se zaboravi ovdje).
dashboard.get('/logout', (c) => {
  c.header('set-cookie', keyCookie('', 0));
  return c.redirect('/dashboard', 302);
});
