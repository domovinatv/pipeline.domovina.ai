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
/* YouTube oEmbed preview (readonly) */
.ytprev { display: flex; gap: .8rem; align-items: center; margin-top: .8rem; padding: .6rem; background: var(--bg); border: 1px solid var(--border); border-radius: .5rem; }
.ytprev[hidden] { display: none; }
.ytprev img { width: 120px; height: 68px; object-fit: cover; border-radius: .35rem; flex: none; background: var(--surface); }
.ytprev-title { font-weight: 700; font-size: .95rem; line-height: 1.25; }
.ytprev-sub { font-size: .85rem; margin-top: .15rem; }
.ytprev-link { font-size: .82rem; display: inline-block; margin-top: .3rem; }
/* Akcijski gumbi u tablici */
button.act { border: 1px solid var(--border); background: var(--bg); color: var(--navy); border-radius: .35rem; padding: .2rem .5rem; font-size: .78rem; font-weight: 600; cursor: pointer; margin-right: .25rem; }
button.act:hover { background: var(--surface); }
button.act.del { color: var(--danger); border-color: #f3c9c5; }
/* Video čelija u tablici: thumbnail + ID */
.vidcell { display: flex; align-items: center; gap: .5rem; }
.rthumb { width: 88px; height: 50px; object-fit: cover; border-radius: .3rem; flex: none; background: var(--surface); }
td .sub { font-size: .8rem; margin-top: .15rem; }
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
/* Semantičke boje po stanju (pill klasa = ime stanja) */
.pill.queued      { background: #E7EEF8; color: #1D4ED8; }   /* plava — čeka */
.pill.fetching,
.pill.transcribing,
.pill.processing  { background: #FDF1E0; color: #B45309; }   /* amber — u tijeku */
.pill.done        { background: #E0F1E5; color: #2E8540; }   /* zelena — gotovo */
.pill.failed      { background: #F8E2E0; color: #B42318; }   /* crvena — greška */
.pill.skipped     { background: #ECEFF2; color: #5A6570; }   /* siva — preskočeno */
.pill.postponed   { background: #F3E8FF; color: #7C3AED; }   /* ljubičasta — odgođeno */
/* Akcijski gumbi: boja akcije == boja stanja koje proizvodi (vizualna veza) */
button.act.a-skip     { color: #5A6570; border-color: #D4D9DE; }
button.act.a-skip:hover     { background: #ECEFF2; }
button.act.a-postpone { color: #7C3AED; border-color: #E3D4FB; }
button.act.a-postpone:hover { background: #F3E8FF; }
button.act.a-requeue  { color: #1D4ED8; border-color: #CDDDF6; }
button.act.a-requeue:hover  { background: #E7EEF8; }
button.act.a-delete   { color: #B42318; border-color: #F3C9C5; }
button.act.a-delete:hover   { background: #F8E2E0; }
button.act.a-restore  { color: #1D4ED8; border-color: #CDDDF6; }
button.act.a-restore:hover  { background: #E7EEF8; }
button.act.a-purge    { color: #B42318; border-color: #F3C9C5; }
button.act.a-purge:hover    { background: #F8E2E0; }
button.act:active { transform: translateY(1px); }
button.act.busy { opacity: .45; pointer-events: none; }
/* Soft-deleted redak: prekrižen + zatamnjen (akcijski gumbi ostaju čitljivi) */
tr.deleted td { text-decoration: line-through; opacity: .55; }
tr.deleted .act { text-decoration: none; opacity: 1; }
/* Filter/search kontrole + pager */
.controls select, .controls input {
  border: 1px solid var(--border); border-radius: .4rem; padding: .35rem .6rem;
  font-size: .88rem; font-family: inherit; background: var(--bg); color: var(--navy);
}
.controls .search { min-width: 14rem; }
.controls .spacer { flex: 1; }
.pager { display: flex; align-items: center; gap: .75rem; margin-top: .9rem; flex-wrap: wrap; }
.pager button {
  border: 1px solid var(--border); background: var(--bg); color: var(--navy);
  border-radius: .4rem; padding: .35rem .8rem; font-size: .88rem; font-weight: 600; cursor: pointer;
}
.pager button:hover:not(:disabled) { background: var(--surface); }
.pager button:disabled { opacity: .4; cursor: not-allowed; }
.pager .info { font-size: .85rem; color: var(--muted); }
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
  <div class="ytprev" id="ytprev" hidden>
    <img id="ytprev-thumb" alt="">
    <div class="ytprev-meta">
      <div class="ytprev-title" id="ytprev-title"></div>
      <div class="ytprev-sub"><span id="ytprev-chan" class="dim"></span></div>
      <a id="ytprev-link" class="ytprev-link" target="_blank" rel="noopener">▶ otvori na YouTube</a>
    </div>
  </div>
  <div class="hint">Public ili unlisted — svejedno. Video se obradi identično, ostaje neindeksiran, dostupan samo na <span class="mono">domovina.ai/v/{id}</span>. <em>Preview (kanal/thumbnail) radi za public; za unlisted ostali metapodaci (trajanje, datum) stignu nakon downloada.</em></div>
</div>

<div class="controls">
  <label for="fState" class="dim">Status:</label>
  <select id="fState">
    <option value="">svi</option>
    <option value="queued">queued</option>
    <option value="fetching">fetching</option>
    <option value="transcribing">transcribing</option>
    <option value="processing">processing</option>
    <option value="done">done</option>
    <option value="failed">failed</option>
    <option value="postponed">postponed</option>
    <option value="skipped">skipped</option>
  </select>
  <input id="fQ" class="search" type="search" placeholder="traži ID / naslov / kanal…">
  <label for="fLimit" class="dim">po stranici:</label>
  <select id="fLimit">
    <option>25</option><option selected>50</option><option>100</option><option>200</option>
  </select>
  <span class="spacer"></span>
  <span class="auto">● auto-refresh 10s</span>
  <span class="dim" id="updated"></span>
</div>

<div class="table-wrap">
  <table>
    <thead><tr>
      <th>Dodano</th><th>Video</th><th>Naslov</th><th>Status</th><th>Rezultat</th><th>Akcije</th>
    </tr></thead>
    <tbody id="rows"><tr><td colspan="6" class="empty">Učitavam…</td></tr></tbody>
  </table>
</div>

<div class="pager">
  <button id="pPrev">← Prethodna</button>
  <button id="pNext">Sljedeća →</button>
  <span class="info" id="pInfo"></span>
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
    // NB: [.] i [/] umjesto \. \/ — ovaj <script> je u server-side template literalu
    // koji bi pojeo backslasheve i razbio regex (numeric-separator crash). Klase rade isto.
    const m = s.match(/[?&]v=([A-Za-z0-9_-]{11})|youtu[.]be[/]([A-Za-z0-9_-]{11})|[/]shorts[/]([A-Za-z0-9_-]{11})|[/]live[/]([A-Za-z0-9_-]{11})/);
    return m ? (m[1]||m[2]||m[3]||m[4]) : '';
  }
  const prev = document.getElementById('ytprev');
  async function prefill(){
    const id = ytId(urlEl.value);
    if (!id) { if (prev) prev.hidden = true; lastId = ''; return; }
    if (id === lastId) return;
    lastId = id;
    try {
      const u = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id);
      const r = await fetch(u);
      if (!r.ok) { if (prev) prev.hidden = true; return; }   // 401 unlisted / 404 → bez previewa
      const j = await r.json();
      // Readonly preview kartica
      if (prev) {
        document.getElementById('ytprev-thumb').src = j.thumbnail_url || '';
        document.getElementById('ytprev-title').textContent = j.title || '';
        document.getElementById('ytprev-chan').textContent = j.author_name ? ('Kanal: ' + j.author_name) : '';
        document.getElementById('ytprev-link').href = 'https://www.youtube.com/watch?v=' + id;
        prev.hidden = false;
      }
      // Prefill naslova (ne gazi ručni unos)
      if (j.title && (!titleEl.value || titleEl.value === autoFilled)) { titleEl.value = j.title; autoFilled = j.title; }
    } catch(e) { if (prev) prev.hidden = true; }   // CORS/mreža → tiho
  }
  urlEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(prefill, 400); });
  urlEl.addEventListener('change', prefill);
})();

// pill klasa = ime stanja → semantička boja iz CSS-a (.pill.queued, .pill.done, …)
function pill(s){ return '<span class="pill '+s+'">'+s+'</span>'; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(ts){ if(!ts) return ''; const d=new Date(ts*1000); return d.toLocaleString('hr-HR'); }
function thumb(id){ return '<img class="rthumb" loading="lazy" alt="" src="https://i.ytimg.com/vi/'+esc(id)+'/mqdefault.jpg">'; }
function dur(s){ if(!s) return ''; s=Math.round(s); const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60; const p=n=>String(n).padStart(2,'0'); return h? h+':'+p(m)+':'+p(x) : m+':'+p(x); }
// Akcijski gumb: klasa a-{action} → boja akcije == boja stanja koje proizvodi (vizualna veza).
function btn(id,action,label){ return '<button class="act a-'+action+'" data-id="'+esc(id)+'" data-act="'+action+'">'+label+'</button>'; }
function actions(j){
  var b = [];
  if (j.deleted_at) {   // soft-deleted: samo vrati ili trajno obriši
    b.push(btn(j.id,'restore','↩ Vrati'));
    b.push(btn(j.id,'purge','🗑 Trajno'));
    return b.join('');
  }
  if (j.state==='queued') { b.push(btn(j.id,'skip','Skip')); b.push(btn(j.id,'postpone','Odgodi')); }
  if (j.state==='skipped'||j.state==='postponed'||j.state==='failed') b.push(btn(j.id,'requeue','↻ U queue'));
  b.push(btn(j.id,'delete','✕'));
  return b.join('');
}

// Paging/filter stanje
var pState='', pQ='', pLimit=50, pOffset=0, pTotal=0;
async function act(id, action){
  // soft-delete (delete) je reverzibilno → bez potvrde; trajno (purge) → confirm.
  if (action==='purge' && !confirm('Trajno obrisati ovaj job iz baze? Nepovratno.')) return;
  try { await fetch('/admin/jobs/'+id+'/'+action, { method:'POST' }); } catch(e) {}
  refresh();
}
async function refresh(){
  try {
    const qs = '?limit='+pLimit+'&offset='+pOffset+(pState?'&state='+encodeURIComponent(pState):'')+(pQ?'&q='+encodeURIComponent(pQ):'');
    const r = await fetch('/admin/api/jobs'+qs, { headers: { 'accept':'application/json' } });
    if (!r.ok) return;
    const data = await r.json();
    pTotal = data.total||0;
    const counts = data.counts || {};
    const order = ['queued','fetching','transcribing','processing','done','failed','postponed','skipped'];
    document.getElementById('stats').innerHTML = order.map(s =>
      '<div class="stat"><div class="label">'+s+'</div><div class="value">'+(counts[s]||0)+'</div></div>'
    ).join('');
    const rows = (data.jobs||[]).map(j => {
      const vid = '<div class="vidcell">'+thumb(j.youtube_id)+'<a class="mono" href="https://youtu.be/'+esc(j.youtube_id)+'" target="_blank" rel="noopener">'+esc(j.youtube_id)+'</a></div>';
      const sub = [j.channel?esc(j.channel):'', j.duration_seconds?dur(j.duration_seconds):''].filter(Boolean).join(' · ');
      const meta = '<div>'+esc(j.title||'(bez naslova)')+'</div>'+(sub?'<div class="dim sub">'+sub+'</div>':'');
      const res = j.detail_url ? '<a href="'+esc(j.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'
                : (j.state==='failed' && j.error ? '<span class="dim">'+esc(j.error).slice(0,80)+'</span>' : '<span class="dim">—</span>');
      return '<tr'+(j.deleted_at?' class="deleted"':'')+'><td class="dim">'+fmt(j.created_at)+'</td><td>'+vid+'</td><td>'+meta+'</td><td>'+pill(j.state)+'</td><td>'+res+'</td><td>'+actions(j)+'</td></tr>';
    }).join('');
    const shown = (data.jobs||[]).length;
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="6" class="empty">'+((pState||pQ)?'Nema rezultata za filter.':'Nema jobova još. Dodaj prvi gore.')+'</td></tr>';
    // Pager
    document.getElementById('pInfo').textContent = pTotal ? ((pOffset+1)+'–'+(pOffset+shown)+' od '+pTotal) : 'nema zapisa';
    document.getElementById('pPrev').disabled = pOffset <= 0;
    document.getElementById('pNext').disabled = pOffset + pLimit >= pTotal;
    document.getElementById('updated').textContent = 'osvježeno ' + new Date().toLocaleTimeString('hr-HR');
  } catch(e) {}
}
// Filter/search/page-size kontrole
var fState=document.getElementById('fState'), fQ=document.getElementById('fQ'), fLimit=document.getElementById('fLimit'), qTimer=null;
fState.addEventListener('change', function(){ pState=fState.value; pOffset=0; refresh(); });
fLimit.addEventListener('change', function(){ pLimit=parseInt(fLimit.value,10)||50; pOffset=0; refresh(); });
fQ.addEventListener('input', function(){ clearTimeout(qTimer); qTimer=setTimeout(function(){ pQ=fQ.value.trim(); pOffset=0; refresh(); }, 350); });
document.getElementById('pPrev').addEventListener('click', function(){ if(pOffset>0){ pOffset=Math.max(0,pOffset-pLimit); refresh(); } });
document.getElementById('pNext').addEventListener('click', function(){ if(pOffset+pLimit<pTotal){ pOffset+=pLimit; refresh(); } });
// Akcijski gumbi (data-id/data-act) + busy feedback na klik.
document.getElementById('rows').addEventListener('click', function(e){
  const b = e.target.closest('button.act');
  if (b) { b.classList.add('busy'); act(b.dataset.id, b.dataset.act); }
});
refresh();
setInterval(refresh, 10000);
</script>`;
  return layout('DOMOVINA Pipeline — queue', body);
}
