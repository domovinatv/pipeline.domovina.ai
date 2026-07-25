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
  /* Mobile: linkovi smiju zauzeti punu širinu kartice */
  @media (max-width: 760px) { .vlinks { flex: 1; } .vlink { max-width: 100%; } }
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
      <input class="url mono" id="url" name="url" placeholder="YouTube (watch?v=… / -N3jzopLGc4) ili X (x.com/…/status/…)" required autofocus>
    </div>
    <div class="field">
      <label for="title">Naslov (opcijski)</label>
      <input id="title" name="title" placeholder="npr. Intervju — gost">
    </div>
    <div class="field">
      <label>Način obrade</label>
      <div class="tierpick">
        <label class="tieropt"><input type="radio" name="tier" value="standard" checked> <b>Standardno</b> <span class="dim">— 1 kredit, noćni batch (do ~1–2 dana)</span></label>
        <label class="tieropt"><input type="radio" name="tier" value="priority"> <b>⚡ Prioritet</b> <span class="dim">— 3 kredita, obrada odmah (~15 min)</span></label>
      </div>
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
  <div class="hint" id="addmsg">Public ili unlisted — svejedno. Standard 1 kredit, prioritet 3. Gotov video je dostupan na <span class="mono">domovina.ai/v/{id}</span>.</div>
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
// thumb(j): za X nema ytimg thumbnail (sintetički id) → 𝕏 placeholder; inače ytimg.
function thumb(j){ if(j && j.source_platform==='x') return '<div class="rthumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:#0f1419;background:#E8F5FE;">𝕏</div>'; var id = (j && j.youtube_id!==undefined) ? j.youtube_id : j; return '<img class="rthumb" loading="lazy" alt="" src="https://i.ytimg.com/vi/'+esc(id)+'/mqdefault.jpg">'; }
function dur(s){ if(!s) return ''; s=Math.round(s); var h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60; var p=n=>String(n).padStart(2,'0'); return h? h+':'+p(m)+':'+p(x) : m+':'+p(x); }
function pill(s){ return '<span class="pill '+s+'">'+s+'</span>'; }
// Transkripcijski lock: koji backend (modal/colab) drži transkripciju. Prazno bez claima; nestaje na done/failed.
function transcribeBadge(j){
  if (j.transcribe_backend==='modal') return ' <span class="pill tb-modal" title="Transkribira Modal (serverless GPU)'+(j.transcribe_claimed_at?' · zauzeto '+fmt(j.transcribe_claimed_at):'')+'">⚡ Modal</span>';
  if (j.transcribe_backend==='colab') return ' <span class="pill tb-colab" title="Transkribira Colab Canary batch'+(j.transcribe_claimed_at?' · zauzeto '+fmt(j.transcribe_claimed_at):'')+'">🧪 Colab</span>';
  return '';
}
// Prioritet tier: ⚡ badge na prioritetnim jobovima (Modal instant put).
function priorityBadge(j){
  return j.priority ? ' <span class="pill prio" title="Prioritetna obrada (Modal, odmah)">⚡ Prioritet</span>' : '';
}
// Magisterium (re)obrada stanje po jeziku — badge u meta čeliji (kad zahtjev postoji).
function magStateBadge(j){
  function one(lang, st){
    if (!st) return '';
    var lbl = lang.toUpperCase();
    var cls = st==='done'?'done':(st==='failed'?'failed':(st==='running'?'run':'wait'));
    var glyph = st==='done'?'✓':(st==='failed'?'⚠':(st==='running'?'⏳':'⧗'));
    return ' <span class="pill mag mag-'+cls+'" title="Magisterium '+lbl+': '+esc(st)+'">🕊 '+lbl+' '+glyph+'</span>';
  }
  return one('hr', j.mag_hr_state)+one('en', j.mag_en_state);
}
// Magisterium one-click gumbi (samo za GOTOV video; sakriveni dok je zahtjev queued/running).
function magBtns(j){
  if (j.state!=='done') return '';
  var out='';
  var hrBusy = j.mag_hr_state==='queued' || j.mag_hr_state==='running';
  var enBusy = j.mag_en_state==='queued' || j.mag_en_state==='running';
  if (!hrBusy) out+='<button class="pillbtn mag-btn" data-mag="'+esc(j.id)+'" data-lang="hr" title="'+(j.mag_hr_state==='done'?'Ponovno Magisterium HR':'Pokreni Magisterium HR')+'">🕊 HR</button>';
  if (!enBusy) out+='<button class="pillbtn mag-btn" data-mag="'+esc(j.id)+'" data-lang="en" title="'+(j.mag_en_state==='done'?'Ponovno Magisterium EN overlay':'Pokreni Magisterium EN overlay')+'">🕊 EN</button>';
  return out;
}
// Pokreni Magisterium (HR/EN) za vlastiti gotov video.
async function runMagisterium(id, lang){
  var msg = document.getElementById('addmsg');
  msg.textContent = 'Šaljem Magisterium '+lang.toUpperCase()+' zahtjev…';
  try {
    var r = await fetch('/api/v1/jobs/'+id+'/magisterium', { method:'POST', headers: Object.assign({'content-type':'application/json'}, H), body: JSON.stringify({ lang: lang }) });
    var d = await r.json().catch(function(){ return {}; });
    if (r.status === 409) { msg.textContent = '⚠ ' + (d.error || 'Video još nije gotov.'); }
    else if (r.ok && d.deduped) { msg.textContent = '✓ Magisterium '+lang.toUpperCase()+' je već u redu / u tijeku.'; }
    else if (r.ok) { msg.textContent = '✓ Magisterium '+lang.toUpperCase()+' pokrenut — obrada kreće uskoro.'; }
    else { msg.textContent = '⚠ ' + (d.error || 'Greška.'); }
  } catch(e){ msg.textContent = '⚠ Mrežna greška.'; }
  refresh();
}

// "Forsiraj sada": digni queued standard job na prioritet (naplati razliku 2 kredita).
async function prioritize(id){
  var msg = document.getElementById('addmsg');
  msg.textContent = 'Dižem na prioritet…';
  try {
    var r = await fetch('/api/v1/jobs/'+id+'/prioritize', { method:'POST', headers: H });
    var d = await r.json().catch(function(){ return {}; });
    if (r.status === 402) { msg.textContent = '⚠ Nema dovoljno kredita za prioritet (treba ' + (d.required||2) + ').'; }
    else if (r.status === 409) { msg.textContent = '⚠ ' + (d.error || 'Job je već krenuo.'); }
    else if (r.ok) { msg.textContent = '⚡ Prebačeno na prioritet. Preostalo kredita: ' + (d.credits_remaining!=null?d.credits_remaining:'—'); }
    else { msg.textContent = '⚠ ' + (d.error || 'Greška.'); }
  } catch(e){ msg.textContent = '⚠ Mrežna greška.'; }
  refresh();
}

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
// Trajanje u ljudskom obliku (45s / 12 min / 3h 20min / 6d 4h). Isto ponašanje kao u
// /admin — obje površine čitaju isti timing iz izvještaja, pa ne smiju prikazivati različito.
// NB: bez backtickova u komentarima — cijeli <script> živi u template literalu.
function fmtDur(sec){
  if (sec===null || sec===undefined) return '';
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec+'s';
  var m = Math.floor(sec/60);
  if (sec < 3600) return m+' min';
  var h = Math.floor(m/60);
  if (sec < 86400) return h+'h '+(m%60)+'min';
  return Math.floor(h/24)+'d '+(h%24)+'h';
}
function fmtAt(ts){
  if (!ts) return '';
  return new Date(ts*1000).toLocaleString('hr-HR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function renderTiming(t){
  if (!t) return '';
  var cells = [];
  if (t.queued_at) cells.push(['U queue', fmtAt(t.queued_at), '']);
  if (t.start_at)  cells.push(['Početak', fmtAt(t.start_at), '']);
  if (t.end_at)    cells.push(['Kraj', fmtAt(t.end_at), '']);
  if (t.total_seconds !== null && t.total_seconds !== undefined) cells.push(['Ukupno', fmtDur(t.total_seconds), 'total']);
  if (!cells.length) return '';
  return '<div class="timing">'+cells.map(function(c){
    return '<div class="t-cell'+(c[2]==='total'?' t-total':'')+'"><div class="t-label">'+esc(c[0])+'</div><div class="t-val">'+esc(c[1])+'</div></div>';
  }).join('')+'</div>'+
  '<div class="timing-note">Vrijeme uz korak je trenutak objave njegovog rezultata; Δ je razmak do prethodnog koraka i uključuje čekanje na red, ne samo obradu. „Ukupno" je raspon od prvog do zadnjeg koraka.</div>';
}
function renderSteps(steps, timing){
  if (!steps || !steps.length) return '<div class="steps-loading">Nema podataka o koracima.</div>';
  return renderTiming(timing)+'<ul class="steps">'+steps.map(function(s){
    var cls = s.state;
    var link = s.url ? '<a class="s-open" href="'+esc(s.url)+'" target="_blank" rel="noopener">↗ otvori</a>' : '';
    var when = s.at ? '<span class="s-when">'+esc(fmtAt(s.at))+'</span>' : '';
    var delta = '';
    if (s.delta_seconds !== null && s.delta_seconds !== undefined) {
      delta = '<span class="s-delta" title="Od prethodnog koraka">+'+esc(fmtDur(s.delta_seconds))+'</span>';
    } else if (s.out_of_order) {
      delta = '<span class="s-delta reissue" title="Rezultat je naknadno ponovno objavljen">↺ ponovna objava</span>';
    }
    var time = (when||delta) ? '<div class="s-time">'+when+delta+'</div>' : '';
    return '<li class="is-'+cls+'"><span class="dot '+cls+'">'+stepGlyph(s.state)+'</span>'+
      '<div class="s-main"><div class="s-label">'+esc(s.label)+'</div><div class="s-note">'+esc(s.note)+'</div>'+time+'</div>'+
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
    host.innerHTML = renderSteps(data.steps, data.timing);
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
      // Izvor: X (source_url = originalni X post) ili YouTube. youtube_id je za X
      // sintetički → NE gradi youtu.be link; koristi source_url iz baze.
      var isX = j.source_platform === 'x';
      var srcUrl = j.source_url ? esc(j.source_url) : (isX ? '' : 'https://youtu.be/'+esc(j.youtube_id));
      var srcTitle = isX ? 'Izvorni X post' : 'Izvorni YouTube video';
      var domUrl = j.detail_url ? esc(j.detail_url) : '';
      var links = (srcUrl ? '<a class="mono vlink" href="'+srcUrl+'" target="_blank" rel="noopener" title="'+srcTitle+'">'+(isX?'𝕏 '+srcUrl:srcUrl)+'</a>' : '')
                + (domUrl ? '<a class="mono vlink" href="'+domUrl+'" target="_blank" rel="noopener" title="Objavljeno na domovina.ai">'+domUrl+'</a>'
                          : '<span class="mono vlink dim">domovina.ai — čeka objavu</span>');
      var vid = '<div class="vidcell">'+thumb(j)+'<div class="vlinks">'+links+'</div></div>';
      var sub = [j.channel?esc(j.channel):'', j.duration_seconds?dur(j.duration_seconds):''].filter(Boolean).join(' · ');
      var imp = j.source==='import' ? ' <span class="imp" title="Objavljeno ranije, izvan tvojih kredita (admin ili drugi ključ) — uvezeno u tvoju listu, nije naplaćeno">uvezeno</span>' : '';
      var meta = '<div>'+esc(j.title||'(bez naslova)')+imp+priorityBadge(j)+transcribeBadge(j)+magStateBadge(j)+'</div>'+(sub?'<div class="dim sub">'+sub+'</div>':'');
      // Rezultat: link kad gotovo (+ Magisterium HR/EN one-click); inače prioritet/greška.
      var res;
      if (j.detail_url) res = '<a href="'+esc(j.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'+(magBtns(j)?'<div style="display:flex;gap:.3rem;margin-top:.35rem;flex-wrap:wrap;">'+magBtns(j)+'</div>':'');
      else if (j.state==='queued' && !j.priority) res = '<button class="pillbtn prio-btn" data-prio="'+esc(j.id)+'" title="Obradi odmah preko Modala — naplati razliku (2 kredita)">⚡ Forsiraj sada</button>';
      else if (j.state==='failed' && j.error) res = '<span class="dim">'+esc(j.error).slice(0,80)+'</span>';
      else res = '<span class="dim">—</span>';
      // data-l = labela kolone za mobile karticu (CSS ::before)
      return '<tr><td class="dim" data-l="Dodano">'+fmt(j.created_at)+'</td><td data-l="Video">'+vid+'</td><td data-l="Naslov">'+meta+'</td><td data-l="Status">'+statusCell(j)+'</td><td data-l="Rezultat">'+res+'</td></tr>' + detailRow(j);
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
  var tier = (document.querySelector('input[name=tier]:checked')||{}).value || 'standard';
  msg.textContent = 'Šaljem…';
  try {
    var r = await fetch('/api/v1/jobs', { method:'POST', headers: Object.assign({'content-type':'application/json'}, H), body: JSON.stringify({ url: url, title: title || undefined, tier: tier }) });
    var d = await r.json().catch(function(){ return {}; });
    if (r.status === 402) { msg.textContent = '⚠ Nema dovoljno kredita (treba ' + (d.required||1) + ', imaš ' + (d.credits_remaining!=null?d.credits_remaining:0) + '). Javi se administratoru za dopunu.'; }
    else if (r.ok && d.already_published) { msg.innerHTML = '✓ Već objavljeno — dodano u tvoju listu (nije naplaćeno). <a href="'+esc(d.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'; document.getElementById('url').value=''; document.getElementById('title').value=''; document.getElementById('ytprev').hidden=true; }
    else if (r.ok && d.deduped) { msg.textContent = '✓ Već je u obradi — nije naplaćeno.'; }
    else if (r.ok && d.job) { msg.textContent = '✓ Poslano na obradu. Preostalo kredita: ' + (d.credits_remaining!=null?d.credits_remaining:'—'); document.getElementById('url').value=''; document.getElementById('title').value=''; document.getElementById('ytprev').hidden=true; }
    else { msg.textContent = '⚠ ' + (d.error || 'Greška pri slanju.'); }
  } catch(e){ msg.textContent = '⚠ Mrežna greška.'; }
  refresh();
});

document.getElementById('rows').addEventListener('click', function(e){
  var mb = e.target.closest('button.mag-btn');
  if (mb) { runMagisterium(mb.dataset.mag, mb.dataset.lang); return; }
  var pb = e.target.closest('button.prio-btn');
  if (pb) { prioritize(pb.dataset.prio); return; }
  var tog = e.target.closest('button.pillbtn');
  if (tog && tog.dataset.jobid) toggleSteps(tog.dataset.jobid);
});
refresh();
setInterval(refresh, 10000);
</script>`;
  return layout('DOMOVINA Pipeline — moj dashboard', body);
}
