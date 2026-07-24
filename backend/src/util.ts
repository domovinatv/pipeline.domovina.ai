// Izvuci 11-znamenkasti YouTube ID iz URL-a ili sirovog ID-a.
// YT ID je [A-Za-z0-9_-]{11} i SMIJE počinjati s '-' (npr. -N3jzopLGc4).
// Podržava: watch?v=, youtu.be/, /shorts/, /embed/, /live/, domovina.ai /v/{id}
// (isti ID kao YouTube — korisnik često zalijepi baš tu poveznicu) i goli ID.
export function extractYouTubeId(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  // Goli ID
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
    /\/v\/([A-Za-z0-9_-]{11})/, // domovina.ai/v/{id} (front-end poveznica na epizodu)
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

export function watchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${youtubeId}`;
}

// Izvor obrade: YouTube ili X (Twitter). Zajednički oblik za enqueue: 11-znakovni
// ID (poštuje `_yt_<id>` konvenciju cijelog pipelinea), kanonski URL i oznaka izvora.
export type SourceKind = 'youtube' | 'x';
export interface SourceRef {
  id: string; // uvijek [A-Za-z0-9_-]{11}
  url: string; // kanonski URL koji ide u fetch.js --unlisted-url
  source: SourceKind;
}

// Prepoznaj X/Twitter status URL i vrati kanonski oblik + numerički status ID.
// Podržava x.com / twitter.com / mobile./www., sa ili bez query stringa.
function parseXStatus(input: string): { statusId: string; canonical: string } | null {
  const m = input.match(
    /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/i,
  );
  if (!m) return null;
  const [, user, statusId] = m;
  return { statusId, canonical: `https://x.com/${user}/status/${statusId}` };
}

// Deterministički 11-znakovni sintetički ID iz kanonskog URL-a (Beamly presedan).
// sha256 → base64url → prvih 11 znakova ∈ [A-Za-z0-9_-]{11}. ~66 bita, praktički
// bez kolizije. Backend je JEDINI izvor istine za ovaj ID; bridge ga prosljeđuje
// u fetch.js (--unlisted-id), pa producer NE mora re-hashati.
export async function synthIdFromUrl(canonicalUrl: string): Promise<string> {
  const data = new TextEncoder().encode(canonicalUrl);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const b64url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64url.slice(0, 11);
}

// Univerzalni ulaz za enqueue: prvo YouTube (backward-compat), zatim X.
// Vraća null ako ni jedno ne prepozna.
export async function extractSourceRef(input: string): Promise<SourceRef | null> {
  const s = (input || '').trim();
  if (!s) return null;
  const yt = extractYouTubeId(s);
  if (yt) return { id: yt, url: watchUrl(yt), source: 'youtube' };
  const x = parseXStatus(s);
  if (x) return { id: await synthIdFromUrl(x.canonical), url: x.canonical, source: 'x' };
  return null;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function newId(): string {
  return crypto.randomUUID();
}

// Sirovi API ključ za programatske klijente. Prefiks 'pdk_' (pipeline domovina key)
// + 32 random bajta u hexu. Pohranjuje se SAMO SHA-256 hash — ovo je jedini put da
// klijent vidi sirovi ključ (pokaže se jednom pri kreiranju).
export function genApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return 'pdk_' + hex;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Server-side oEmbed dohvat (radi za public I unlisted — oba vraćaju 200; samo
// private/obrisani daju 401/404 → null). Bez API ključa. Vraća naslov + kanal
// (author_name). Non-blocking — pozivatelj hvata null.
export async function fetchOEmbed(
  youtubeId: string,
): Promise<{ title?: string; channel?: string } | null> {
  try {
    const u =
      'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/watch?v=' + youtubeId);
    const r = await fetch(u);
    if (!r.ok) return null;
    const j = (await r.json()) as { title?: string; author_name?: string };
    return { title: j.title, channel: j.author_name };
  } catch {
    return null;
  }
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
