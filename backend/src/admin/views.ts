/**
 * Branded HTML za pipeline.domovina.ai admin dashboard (/admin).
 *
 * DOMOVINA brand:
 *   navy  #002F6C  — primarna boja teksta + chrome
 *   red   #FF0000  — hrvatski naglasak
 *   white #FFFFFF  — površina
 *   muted #5A6570  — body / labele
 *
 * Shell (logo, tricolor, tabovi, tablica) preuzet iz pay.domovina.ai/backend
 * da admin prepozna isti izgled kroz sve DOMOVINA servise. Lista se renderira
 * server-side; redovi se osvježavaju JSON-om na klijentu (auto-refresh) bez reloada.
 */

const HEADER_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="36" height="36" aria-hidden="true">
<defs>
<linearGradient id="hdrFlag" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#FF0000"/><stop offset="33.3%" stop-color="#FF0000"/>
<stop offset="33.3%" stop-color="#FFFFFF"/><stop offset="66.6%" stop-color="#FFFFFF"/>
<stop offset="66.6%" stop-color="#002F6C"/><stop offset="100%" stop-color="#002F6C"/>
</linearGradient>
</defs>
<rect width="512" height="512" rx="32" fill="white"/>
<path d="M72 64H248C354.071 64 440 149.929 440 256C440 362.071 354.071 448 248 448H72V64Z" fill="url(#hdrFlag)"/>
<path d="M168 160H248C301.019 160 344 202.981 344 256C344 309.019 301.019 352 248 352H168V160Z" fill="white"/>
<g stroke="#002F6C" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
<line x1="205" y1="205" x2="295" y2="225"/><line x1="295" y1="225" x2="285" y2="285"/>
<line x1="285" y1="285" x2="205" y2="307"/><line x1="205" y1="307" x2="205" y2="205"/>
<line x1="205" y1="205" x2="245" y2="256"/><line x1="295" y1="225" x2="245" y2="256"/>
<line x1="285" y1="285" x2="245" y2="256"/><line x1="205" y1="307" x2="245" y2="256"/>
</g>
<g fill="#002F6C">
<circle cx="205" cy="205" r="10"/><circle cx="295" cy="225" r="10"/>
<circle cx="205" cy="307" r="10"/><circle cx="285" cy="285" r="10"/>
<circle cx="245" cy="256" r="14"/>
</g>
</svg>`;

const BASE_STYLE = `<style>
:root {
  --navy: #002F6C; --red: #FF0000; --muted: #5A6570;
  --border: #E1E5EA; --surface: #F5F7F9; --bg: #FFFFFF;
  --success: #2E8540; --warning: #B45309; --danger: #B42318;
  font-family: system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--navy); }
a { color: var(--navy); }
.tricolor { display: flex; height: 6px; }
.tricolor span { flex: 1; }
.tricolor .red { background: var(--red); }
.tricolor .navy { background: var(--navy); }
header {
  padding: .9rem 1.5rem; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
}
header .brand { display: flex; align-items: center; gap: .6rem; }
header .brand .word { font-weight: 800; letter-spacing: .04em; font-size: 1.1rem; }
header .brand .accent { color: var(--red); }
header .badge {
  background: var(--surface); border: 1px solid var(--border);
  padding: .25rem .6rem; border-radius: 1rem; font-size: .8rem;
  color: var(--muted); font-weight: 600;
}
main { padding: 1.5rem; max-width: 90rem; margin: 0 auto; }
h1 { font-size: 1.45rem; margin: 0 0 1rem; }
.stats { display: flex; gap: .75rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.stat {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: .5rem; padding: .55rem .9rem; min-width: 6.5rem;
}
.stat .label {
  font-size: .72rem; color: var(--muted); text-transform: uppercase;
  letter-spacing: .05em; font-weight: 700;
}
.stat .value { font-size: 1.35rem; font-weight: 700; }
.addbox {
  background: var(--surface); border: 1px solid var(--border); border-radius: .6rem;
  padding: 1rem; margin-bottom: 1.25rem;
}
.addbox form { display: flex; flex-direction: column; gap: .7rem; align-items: stretch; }
.addbox .field { display: flex; flex-direction: column; gap: .25rem; }
.addbox label { font-size: .75rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
.addbox input {
  border: 1px solid var(--border); border-radius: .4rem; padding: .5rem .75rem;
  font-size: .95rem; font-family: inherit; background: var(--bg); color: var(--navy);
  width: 100%;
}
.addbox button {
  border: 0; border-radius: .4rem; padding: .6rem 1.2rem; font-size: .95rem;
  font-weight: 700; cursor: pointer; background: var(--navy); color: #fff;
  align-self: flex-start; display: inline-flex; align-items: center; gap: .5rem;
}
.addbox button:hover { background: #013a86; }
/* Bijeli "+" — emoji ➕ ignorira CSS color (ostaje tamno siv na navy); plain glyph nasljeđuje #fff */
.addbox button .plus { color: #fff; font-weight: 900; font-size: 1.15em; line-height: 1; }
.addbox .hint { font-size: .8rem; color: var(--muted); margin-top: .5rem; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: .5rem; background: var(--bg); }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .55rem .8rem; border-bottom: 1px solid var(--border); vertical-align: top; }
th { background: var(--surface); font-weight: 700; color: var(--muted); font-size: .76rem; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover { background: var(--surface); }
.mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.dim { color: var(--muted); }
.pill { display: inline-block; padding: .15rem .55rem; border-radius: 1rem; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.pill.ok { background: #E0F1E5; color: var(--success); }
.pill.bad { background: #F8E2E0; color: var(--danger); }
.pill.warn { background: #FDF1E0; color: var(--warning); }
.pill.neutral { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.controls { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; margin-bottom: .75rem; }
.controls .auto { font-size: .82rem; color: var(--success); font-weight: 700; }
.empty { text-align: center; padding: 2rem; color: var(--muted); }
footer { margin: 2rem 0 0; padding: 1rem 1.5rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .82rem; text-align: center; }
@media (max-width: 720px) {
  header { padding: .7rem 1rem; } main { padding: 1rem; }
  .addbox input.url { min-width: 100%; }
  th, td { padding: .45rem .55rem; font-size: .82rem; }
}
</style>`;

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="hr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>${BASE_STYLE}
</head><body>
<div class="tricolor"><span class="red"></span><span style="background:#fff"></span><span class="navy"></span></div>
<header>
  <div class="brand">${HEADER_LOGO_SVG}<span class="word">DOMOVINA<span class="accent"> Pipeline</span></span></div>
  <span class="badge">ad-hoc pipeline queue</span>
</header>
<main>${body}</main>
<footer>pipeline.domovina.ai — ručna obrada proizvoljnog (i unlisted) YouTube videa kroz puni AI pipeline</footer>
</body></html>`;
}

export function statePill(state: string): string {
  const cls =
    state === 'done' ? 'ok' : state === 'failed' ? 'bad' : state === 'queued' ? 'neutral' : 'warn';
  return `<span class="pill ${cls}">${state}</span>`;
}

// Glavna stranica: stats + forma za dodavanje + tablica (puni se JSON-om na klijentu).
export function renderJobsPage(): string {
  const body = `
<h1>Queue obrade</h1>
<div class="stats" id="stats"></div>

<div class="addbox">
  <form method="POST" action="/admin/jobs">
    <div class="field">
      <label for="url">YouTube URL ili ID</label>
      <input class="url mono" id="url" name="url" placeholder="https://www.youtube.com/watch?v=… ili -N3jzopLGc4" required autofocus>
    </div>
    <div class="field">
      <label for="title">Naslov (opcijski)</label>
      <input id="title" name="title" placeholder="npr. Intervju — gost">
    </div>
    <button type="submit"><span class="plus">+</span> Dodaj u queue</button>
  </form>
  <div class="hint">Public ili unlisted — svejedno. Video se obradi identično, ostaje neindeksiran, dostupan samo na <span class="mono">domovina.ai/v/{id}</span>.</div>
</div>

<div class="controls">
  <span class="auto">● auto-refresh 10s</span>
  <span class="dim" id="updated"></span>
</div>

<div class="table-wrap">
  <table>
    <thead><tr>
      <th>Dodано</th><th>Video</th><th>Naslov</th><th>Status</th><th>Rezultat</th>
    </tr></thead>
    <tbody id="rows"><tr><td colspan="5" class="empty">Učitavam…</td></tr></tbody>
  </table>
</div>

<script>
// ── Auto-prefill naslova iz YouTube oEmbed-a (public videi; bez API ključa, CORS OK).
// Unlisted vraća 401 → tiho preskačemo; bridge svejedno backfilla pravi naslov iz info.json.
(function(){
  const urlEl = document.getElementById('url');
  const titleEl = document.getElementById('title');
  if (!urlEl || !titleEl) return;
  let autoFilled = '';                       // zadnji auto-upisani naslov (da ne gazimo ručni unos)
  let timer = null, lastId = '';
  function ytId(s){
    s = (s||'').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    const m = s.match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})|\/shorts\/([A-Za-z0-9_-]{11})|\/live\/([A-Za-z0-9_-]{11})/);
    return m ? (m[1]||m[2]||m[3]||m[4]) : '';
  }
  async function prefill(){
    const id = ytId(urlEl.value);
    if (!id || id === lastId) return;
    lastId = id;
    // Ne gazi ručno upisan naslov (prazno ili još uvijek prethodni auto-fill = slobodno)
    if (titleEl.value && titleEl.value !== autoFilled) return;
    try {
      const u = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id);
      const r = await fetch(u);
      if (!r.ok) return;                      // 401 unlisted / 404 → preskoči
      const j = await r.json();
      if (j && j.title) { titleEl.value = j.title; autoFilled = j.title; }
    } catch(e) {}                             // CORS/mreža → tiho
  }
  urlEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(prefill, 400); });
  urlEl.addEventListener('change', prefill);
})();

const STATE_CLASS = { done:'ok', failed:'bad', queued:'neutral' };
function pill(s){ return '<span class="pill '+(STATE_CLASS[s]||'warn')+'">'+s+'</span>'; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(ts){ if(!ts) return ''; const d=new Date(ts*1000); return d.toLocaleString('hr-HR'); }
async function refresh(){
  try {
    const r = await fetch('/admin/api/jobs?limit=200', { headers: { 'accept':'application/json' } });
    if (!r.ok) return;
    const data = await r.json();
    const counts = data.counts || {};
    const order = ['queued','fetching','transcribing','processing','done','failed'];
    document.getElementById('stats').innerHTML = order.map(s =>
      '<div class="stat"><div class="label">'+s+'</div><div class="value">'+(counts[s]||0)+'</div></div>'
    ).join('');
    const rows = (data.jobs||[]).map(j => {
      const yt = '<a class="mono" href="https://youtu.be/'+esc(j.youtube_id)+'" target="_blank" rel="noopener">'+esc(j.youtube_id)+'</a>';
      const res = j.detail_url ? '<a href="'+esc(j.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'
                : (j.state==='failed' && j.error ? '<span class="dim">'+esc(j.error).slice(0,80)+'</span>' : '<span class="dim">—</span>');
      return '<tr><td class="dim">'+fmt(j.created_at)+'</td><td>'+yt+'</td><td>'+esc(j.title||'')+'</td><td>'+pill(j.state)+'</td><td>'+res+'</td></tr>';
    }).join('');
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="5" class="empty">Nema jobova još. Dodaj prvi gore.</td></tr>';
    document.getElementById('updated').textContent = 'osvježeno ' + new Date().toLocaleTimeString('hr-HR');
  } catch(e) {}
}
refresh();
setInterval(refresh, 10000);
</script>`;
  return layout('DOMOVINA Pipeline — queue', body);
}
