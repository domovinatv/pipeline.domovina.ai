/**
 * Korisnički (scope-an na API ključ) dashboard na /dashboard.
 *
 * Za razliku od /admin (Basic Auth, vidi SVE jobove, upravlja stanjima), ovo je
 * lagani self-service UI za krajnjeg korisnika: autentikacija je njegov API ključ
 * u query stringu (`?auth=pdk_…`), a UI vidi i radi SAMO u scopeu tog ključa.
 *
 * Server-side rendera se samo ljuska + ugrađeni ključ; tablica/koraci se pune na
 * klijentu preko postojećih `/api/v1/*` endpointa (Bearer = isti ključ). Time se
 * ne duplicira logika: enqueue je isti kreditno-gejtani put kao programatski API.
 */

import type { ApiKeyRow } from '../types';
import { escapeHtml } from '../util';
import { layout } from '../admin/views';

// Ulazna stranica kad ključ nije zadan ili je neispravan: jednostavna forma koja
// preusmjeri na /dashboard?auth=<ključ>. `error` se postavi na neispravan ključ.
export function renderKeyPrompt(error?: string): string {
  const err = error
    ? `<div class="flash" style="background:#F8E2E0;border-color:#F3C9C5;"><strong>${escapeHtml(error)}</strong></div>`
    : '';
  const body = `
<h1>Moj pipeline</h1>
${err}
<div class="addbox">
  <form method="GET" action="/dashboard">
    <div class="field">
      <label for="auth">API ključ</label>
      <input class="mono" id="auth" name="auth" placeholder="pdk_…" required autofocus autocomplete="off">
    </div>
    <button type="submit">Otvori dashboard</button>
  </form>
  <div class="hint">Zalijepi svoj <span class="mono">pdk_…</span> ključ. Otvorit će se dashboard u scopeu tog ključa — vidiš samo svoje obrade i troškove kredita. Link <span class="mono">/dashboard?auth=…</span> možeš spremiti kao bookmark.</div>
</div>`;
  return layout('DOMOVINA Pipeline — moj dashboard', body);
}

// Glavni scope-ani dashboard. `rawKey` se ugrađuje u klijentski JS (nužno za Bearer
// pozive na /api/v1/*). Tablica + koraci pune se identično kao u adminu, ali čitaju
// samo jobove ovog ključa i enqueue troši njegove kredite.
export function renderDashboardPage(key: ApiKeyRow, rawKey: string): string {
  const body = `
<style>
  .imp { display:inline-block; margin-left:.4rem; padding:.05rem .45rem; border-radius:999px;
         font-size:.68rem; font-weight:700; letter-spacing:.02em; text-transform:uppercase;
         background:#F3E8FF; color:#7C3AED; vertical-align:middle; }
  .vlinks { display:flex; flex-direction:column; gap:.15rem; min-width:0; }
  .vlink { font-size:.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:40ch; }
  .vlink.dim { color:var(--muted); }
</style>
<h1>Moj pipeline <span class="dim" style="font-size:.9rem;font-weight:600;">— ${escapeHtml(key.name)}</span></h1>

<div class="stats" id="stats">
  <div class="stat ${key.credits > 0 ? 's-done' : 's-failed'}">
    <div class="label">Preostali krediti</div>
    <div class="value" id="credits">${key.credits}</div>
  </div>
</div>

<div class="addbox">
  <form id="addform">
    <div class="field">
      <label for="url">YouTube URL ili ID</label>
      <input class="url mono" id="url" name="url" placeholder="https://www.youtube.com/watch?v=… ili -N3jzopLGc4" required autofocus>
    </div>
    <div class="field">
      <label for="title">Naslov (opcijski)</label>
      <input id="title" name="title" placeholder="npr. Intervju — gost">
    </div>
    <button type="submit"><span class="plus">+</span> Pošalji na obradu</button>
  </form>
  <div class="ytprev" id="ytprev" hidden>
    <img id="ytprev-thumb" alt="">
    <div class="ytprev-meta">
      <div class="ytprev-title" id="ytprev-title"></div>
      <div class="ytprev-sub"><span id="ytprev-chan" class="dim"></span></div>
    </div>
  </div>
  <div class="hint" id="addmsg">Public ili unlisted — svejedno. 1 obrada = 1 kredit. Gotov video je dostupan na <span class="mono">domovina.ai/v/{id}</span>.</div>
</div>

<div class="controls">
  <span class="auto">● auto-refresh 10s</span>
  <span class="dim" id="updated"></span>
</div>

<div class="table-wrap">
  <table>
    <thead><tr>
      <th>Dodano</th><th>Video</th><th>Naslov</th><th>Status</th><th>Rezultat</th>
    </tr></thead>
    <tbody id="rows"><tr><td colspan="5" class="empty">Učitavam…</td></tr></tbody>
  </table>
</div>

<script>
var KEY = ${JSON.stringify(rawKey)};
var H = { 'authorization': 'Bearer ' + KEY };
var expandedId = '';

function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(ts){ if(!ts) return ''; return new Date(ts*1000).toLocaleString('hr-HR'); }
function thumb(id){ return '<img class="rthumb" loading="lazy" alt="" src="https://i.ytimg.com/vi/'+esc(id)+'/mqdefault.jpg">'; }
function dur(s){ if(!s) return ''; s=Math.round(s); var h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60; var p=n=>String(n).padStart(2,'0'); return h? h+':'+p(m)+':'+p(x) : m+':'+p(x); }
function pill(s){ return '<span class="pill '+s+'">'+s+'</span>'; }

function statusCell(j){
  var open = expandedId===j.id;
  return pill(j.state)+'<div><button class="pillbtn" data-jobid="'+esc(j.id)+'" aria-expanded="'+(open?'true':'false')+'">'+(open?'▾':'▸')+' koraci</button></div>';
}
function detailRow(j){
  return '<tr class="detail-row" data-detail="'+esc(j.id)+'"'+(expandedId===j.id?'':' hidden')+'>'+
    '<td colspan="5"><div class="steps-head">Pipeline koraci</div>'+
    '<div id="steps-'+esc(j.id)+'"><div class="steps-loading">Učitavam korake…</div></div></td></tr>';
}
function stepBadge(st){ return st==='done'?'gotovo':st==='skipped'?'preskočeno':'čeka'; }
function stepGlyph(st){ return st==='done'?'✓':st==='skipped'?'–':''; }
function renderSteps(steps){
  if (!steps || !steps.length) return '<div class="steps-loading">Nema podataka o koracima.</div>';
  return '<ul class="steps">'+steps.map(function(s){
    var cls = s.state;
    var link = s.url ? '<a class="s-open" href="'+esc(s.url)+'" target="_blank" rel="noopener">↗ otvori</a>' : '';
    return '<li class="is-'+cls+'"><span class="dot '+cls+'">'+stepGlyph(s.state)+'</span>'+
      '<div class="s-main"><div class="s-label">'+esc(s.label)+'</div><div class="s-note">'+esc(s.note)+'</div></div>'+
      link+'<span class="pill s-badge '+cls+'">'+stepBadge(s.state)+'</span></li>';
  }).join('')+'</ul>';
}
async function loadSteps(id){
  var host = document.getElementById('steps-'+id);
  if (!host) return;
  try {
    var r = await fetch('/api/v1/jobs/'+id+'/pipeline', { headers: H });
    if (!r.ok) { host.innerHTML = '<div class="steps-loading">Greška pri dohvatu koraka.</div>'; return; }
    var data = await r.json();
    host.innerHTML = renderSteps(data.steps);
  } catch(e) { host.innerHTML = '<div class="steps-loading">Greška pri dohvatu koraka.</div>'; }
}
function toggleSteps(id){
  expandedId = (expandedId===id) ? '' : id;
  document.querySelectorAll('tr.detail-row').forEach(function(tr){ tr.hidden = tr.dataset.detail!==expandedId; });
  document.querySelectorAll('button.pillbtn').forEach(function(b){
    var on = b.dataset.jobid===expandedId;
    b.setAttribute('aria-expanded', on?'true':'false');
    b.textContent = (on?'▾':'▸')+' koraci';
  });
  if (expandedId) loadSteps(expandedId);
}

async function refresh(){
  try {
    var r = await fetch('/api/v1/jobs?limit=100', { headers: H });
    if (!r.ok) return;
    var data = await r.json();
    if (typeof data.credits_remaining === 'number') document.getElementById('credits').textContent = data.credits_remaining;
    var rows = (data.jobs||[]).map(function(j){
      var ytUrl = 'https://youtu.be/'+esc(j.youtube_id);
      var domUrl = j.detail_url ? esc(j.detail_url) : '';
      var links = '<a class="mono vlink" href="'+ytUrl+'" target="_blank" rel="noopener" title="Izvorni YouTube video">'+ytUrl+'</a>'
                + (domUrl ? '<a class="mono vlink" href="'+domUrl+'" target="_blank" rel="noopener" title="Objavljeno na domovina.ai">'+domUrl+'</a>'
                          : '<span class="mono vlink dim">domovina.ai — čeka objavu</span>');
      var vid = '<div class="vidcell">'+thumb(j.youtube_id)+'<div class="vlinks">'+links+'</div></div>';
      var sub = [j.channel?esc(j.channel):'', j.duration_seconds?dur(j.duration_seconds):''].filter(Boolean).join(' · ');
      var imp = j.source==='import' ? ' <span class="imp" title="Objavljeno ranije, izvan tvojih kredita (admin ili drugi ključ) — uvezeno u tvoju listu, nije naplaćeno">uvezeno</span>' : '';
      var meta = '<div>'+esc(j.title||'(bez naslova)')+imp+'</div>'+(sub?'<div class="dim sub">'+sub+'</div>':'');
      var res = j.detail_url ? '<a href="'+esc(j.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'
              : (j.state==='failed' && j.error ? '<span class="dim">'+esc(j.error).slice(0,80)+'</span>' : '<span class="dim">—</span>');
      return '<tr><td class="dim">'+fmt(j.created_at)+'</td><td>'+vid+'</td><td>'+meta+'</td><td>'+statusCell(j)+'</td><td>'+res+'</td></tr>' + detailRow(j);
    }).join('');
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="5" class="empty">Još nema obrada. Pošalji prvu gore.</td></tr>';
    document.getElementById('updated').textContent = 'osvježeno ' + new Date().toLocaleTimeString('hr-HR');
    if (expandedId && document.getElementById('steps-'+expandedId)) loadSteps(expandedId);
  } catch(e) {}
}

// oEmbed preview (public/unlisted; private/obrisan → tiho preskoči)
(function(){
  var urlEl = document.getElementById('url'), prev = document.getElementById('ytprev'), lastId='', timer=null;
  function ytId(s){ s=(s||'').trim(); if(/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    var m = s.match(/[?&]v=([A-Za-z0-9_-]{11})|youtu[.]be[/]([A-Za-z0-9_-]{11})|[/]shorts[/]([A-Za-z0-9_-]{11})|[/]live[/]([A-Za-z0-9_-]{11})|[/]v[/]([A-Za-z0-9_-]{11})/);
    return m ? (m[1]||m[2]||m[3]||m[4]||m[5]) : ''; }
  async function prefill(){
    var id = ytId(urlEl.value);
    if (!id){ prev.hidden = true; lastId=''; return; }
    if (id===lastId) return; lastId=id;
    try {
      var u = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v='+id);
      var r = await fetch(u); if(!r.ok){ prev.hidden=true; return; }
      var j = await r.json();
      document.getElementById('ytprev-thumb').src = j.thumbnail_url||'';
      document.getElementById('ytprev-title').textContent = j.title||'';
      document.getElementById('ytprev-chan').textContent = j.author_name ? ('Kanal: '+j.author_name) : '';
      prev.hidden = false;
    } catch(e){ prev.hidden = true; }
  }
  urlEl.addEventListener('input', function(){ clearTimeout(timer); timer=setTimeout(prefill,400); });
})();

// Enqueue preko /api/v1/jobs (isti kreditni put kao programatski API).
document.getElementById('addform').addEventListener('submit', async function(e){
  e.preventDefault();
  var msg = document.getElementById('addmsg');
  var url = document.getElementById('url').value.trim();
  var title = document.getElementById('title').value.trim();
  if (!url) return;
  msg.textContent = 'Šaljem…';
  try {
    var r = await fetch('/api/v1/jobs', { method:'POST', headers: Object.assign({'content-type':'application/json'}, H), body: JSON.stringify({ url: url, title: title || undefined }) });
    var d = await r.json().catch(function(){ return {}; });
    if (r.status === 402) { msg.textContent = '⚠ Nema dovoljno kredita (0). Javi se administratoru za dopunu.'; }
    else if (r.ok && d.already_published) { msg.innerHTML = '✓ Već objavljeno — dodano u tvoju listu (nije naplaćeno). <a href="'+esc(d.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'; document.getElementById('url').value=''; document.getElementById('title').value=''; document.getElementById('ytprev').hidden=true; }
    else if (r.ok && d.deduped) { msg.textContent = '✓ Već je u obradi — nije naplaćeno.'; }
    else if (r.ok && d.job) { msg.textContent = '✓ Poslano na obradu. Preostalo kredita: ' + (d.credits_remaining!=null?d.credits_remaining:'—'); document.getElementById('url').value=''; document.getElementById('title').value=''; document.getElementById('ytprev').hidden=true; }
    else { msg.textContent = '⚠ ' + (d.error || 'Greška pri slanju.'); }
  } catch(e){ msg.textContent = '⚠ Mrežna greška.'; }
  refresh();
});

document.getElementById('rows').addEventListener('click', function(e){
  var tog = e.target.closest('button.pillbtn');
  if (tog) toggleSteps(tog.dataset.jobid);
});
refresh();
setInterval(refresh, 10000);
</script>`;
  return layout('DOMOVINA Pipeline — moj dashboard', body);
}
