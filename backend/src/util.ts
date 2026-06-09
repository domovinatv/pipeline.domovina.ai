// Izvuci 11-znamenkasti YouTube ID iz URL-a ili sirovog ID-a.
// YT ID je [A-Za-z0-9_-]{11} i SMIJE počinjati s '-' (npr. -N3jzopLGc4).
// Podržava: watch?v=, youtu.be/, /shorts/, /embed/, /live/ i goli ID.
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

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Server-side oEmbed dohvat (public videi; unlisted vraća 401 → null). Bez API ključa.
// Vraća naslov + kanal (author_name). Non-blocking — pozivatelj hvata null.
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
