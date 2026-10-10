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
 *
 * Od v0.18.0 retke, korake, tokene, datoteke, filter i paginaciju gradi isti klijentski
 * kod kao /admin (ui/client.ts), a korisnik ima SVE izbore obrade kao admin (odluka
 * 2026-10-10: ključeve dobivaju samo poznati ljudi; kontrola je revoke + praćenje po ključu).
 * Ovdje ostaje samo ono što je specifično za ključ: krediti, ⚡ forsiranje, ponovna obrada
 * vlastitog videa u dijalogu, oznaka uvezenih epizoda.
 */

import type { ApiKeyRow } from '../types';
import { escapeHtml } from '../util';
import { layout } from '../admin/views';
import { SHARED_CLIENT_JS, renderJobChoiceFields, renderReprocessFields } from '../ui/client';

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
  <div class="hint">Zalijepi svoj <span class="mono">pdk_…</span> ključ. Otvorit će se dashboard u scopeu tog ključa — vidiš samo svoje obrade i troškove kredita. Ovaj preglednik zapamti ključ 90 dana; link <span class="mono">/dashboard?auth=…</span> i dalje radi.</div>
</div>`;
  return layout('DOMOVINA Pipeline — moj dashboard', body);
}

// Glavni scope-ani dashboard. `rawKey` se ugrađuje u klijentski JS (nužno za Bearer
// pozive na /api/v1/*). Stranica se servira s `no-store`, a ključ ne stoji u URL-u
// (dashboard/app.ts ga iz ?auth= premjesti u kolačić).
export function renderDashboardPage(key: ApiKeyRow, rawKey: string): string {
  const body = `
<style>
  .imp { display:inline-block; margin-left:.4rem; padding:.05rem .45rem; border-radius:999px;
         font-size:.68rem; font-weight:700; letter-spacing:.02em; text-transform:uppercase;
         background:#F3E8FF; color:#7C3AED; vertical-align:middle; }
  .vlinks { display:flex; flex-direction:column; gap:.15rem; min-width:0; }
  .vlink { font-size:.8rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:26ch; }
  .vlink.dim { color:var(--muted); }
  /* Mobile: linkovi smiju zauzeti punu širinu kartice */
  @media (max-width: 760px) { .vlinks { flex: 1; } .vlink { max-width: 100%; } }
</style>
<h1>Moj pipeline <span class="dim" style="font-size:.9rem;font-weight:600;">— ${escapeHtml(key.name)}</span> <a class="tab" style="font-size:.8rem;vertical-align:middle;" href="/dashboard/logout" title="Zaboravi ključ u ovom pregledniku">odjava</a></h1>

<div class="stats" id="stats"></div>

<div class="addbox">
  <form id="addform">
    <div class="field">
      <label for="url">YouTube URL ili ID</label>
      <input class="url mono" id="url" name="url" placeholder="YouTube (watch?v=… / -N3jzopLGc4) ili X (x.com/…/status/…)" required autofocus>
    </div>
    <div class="field">
      <label for="title">Naslov (opcijski)</label>
      <input id="title" name="title" placeholder="npr. Intervju — gost" autocomplete="off">
    </div>
    <div class="field">
      <label>Način obrade</label>
      <div class="tierpick">
        <label class="tieropt"><input type="radio" name="tier" value="standard" checked> <b>Standardno</b> <span class="dim">— <span id="cost-std"></span>, noćni batch (do ~1–2 dana)</span></label>
        <label class="tieropt"><input type="radio" name="tier" value="priority"> <b>⚡ Prioritet</b> <span class="dim">— <span id="cost-prio"></span>, obrada odmah (~15 min), poštuje sve izbore ispod</span></label>
      </div>
    </div>
    ${renderJobChoiceFields()}
    <button type="submit"><span class="plus">+</span> Pošalji na obradu</button>
  </form>
  <div class="ytprev" id="ytprev" hidden>
    <img id="ytprev-thumb" alt="">
    <div class="ytprev-meta">
      <div class="ytprev-title" id="ytprev-title"></div>
      <div class="ytprev-sub"><span id="ytprev-chan" class="dim"></span></div>
      <a id="ytprev-link" class="ytprev-link" target="_blank" rel="noopener">▶ otvori na YouTube</a>
    </div>
  </div>
  <div class="hint" id="notice">Public ili unlisted — svejedno. Gotov video je dostupan na <span class="mono">domovina.ai/v/{id}</span>.</div>
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
      <th>Dodano</th><th>Video</th><th>Naslov</th><th>Status</th><th>Rezultat</th><th class="col-akcije">Akcije</th>
    </tr></thead>
    <tbody id="rows"><tr><td colspan="6" class="empty">Učitavam…</td></tr></tbody>
  </table>
</div>

<div class="pager">
  <button id="pPrev">← Prethodna</button>
  <button id="pNext">Sljedeća →</button>
  <span class="info" id="pInfo"></span>
</div>

<dialog class="rpdlg" id="rpdlg">
  <div class="addbox">
    <form id="rpform" method="dialog">
      <h2>🔁 Ponovna obrada</h2>
      <p class="dim" id="rp-title" style="margin-top:0"></p>
      ${renderReprocessFields({})}
      <div class="hint" id="rp-msg"></div>
      <p style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; margin-top:1rem;">
        <button class="act" type="button" id="rp-cancel">Odustani</button>
        <button class="act a-requeue" type="submit" id="rp-submit">🔁 Pokreni ponovnu obradu</button>
      </p>
    </form>
  </div>
</dialog>

<script>
var KEY = ${JSON.stringify(rawKey)};
var READ = '/api/v1', ACT = '/api/v1/jobs', H = { 'authorization': 'Bearer ' + KEY }, COLS = 6;
${SHARED_CLIENT_JS}
// ── Samo dashboard: krediti, akcije nad vlastitim jobom, ponovna obrada
var credits = ${key.credits};
function kredita(n){ return n+' '+(n===1?'kredit':'kredita'); }
function trSel(){ var s=document.getElementById('transcription'); return s ? s.value : MODELS.defaults.transcription; }
function paintCosts(){
  document.getElementById('cost-std').textContent = kredita(COSTS.standard);
  document.getElementById('cost-prio').textContent = kredita(COSTS.priority[trSel()]||COSTS.priority.speechmatics);
}
function creditsStat(){
  return '<div class="stat '+(credits>0?'s-done':'s-failed')+'"><div class="label">Preostali krediti</div><div class="value">'+credits+'</div></div>';
}
function setCredits(n){ if (typeof n==='number') credits = n; }
function pbtn(cls, attrs, label, title){ return '<button class="act '+cls+'" '+attrs+' title="'+esc(title)+'">'+label+'</button>'; }
// Akcije nad vlastitim jobom. Magisterium HR/EN samo za GOTOV video (sakriveni dok je zahtjev u tijeku).
function actions(j){
  var b = [];
  if (j.state==='queued' && !j.priority) {
    var up = (COSTS.priority[j.transcription]||COSTS.priority.speechmatics) - (j.credit_cost||COSTS.standard);
    b.push(pbtn('a-prioritize', 'data-prio="'+esc(j.id)+'"', '⚡ Forsiraj sada', 'Obradi odmah preko Modala — naplati razliku ('+kredita(up)+')'));
  }
  if (j.state==='done' && j.source!=='import') b.push(pbtn('a-requeue', 'data-rp="'+esc(j.id)+'"', '🔁 Ponovna obrada', 'Podigni epizodu na razinu nove: prijepis, članak, Magisterium — po izboru'));
  if (j.state==='done') {
    var hrBusy = j.mag_hr_state==='queued' || j.mag_hr_state==='running';
    var enBusy = j.mag_en_state==='queued' || j.mag_en_state==='running';
    if (!hrBusy) b.push(pbtn('a-magisterium-hr', 'data-mag="'+esc(j.id)+'" data-lang="hr"', '🕊 Mag HR', j.mag_hr_state==='done'?'Ponovno Magisterium HR':'Pokreni Magisterium HR'));
    if (!enBusy) b.push(pbtn('a-magisterium-en', 'data-mag="'+esc(j.id)+'" data-lang="en"', '🕊 Mag EN', j.mag_en_state==='done'?'Ponovno Magisterium EN overlay':'Pokreni Magisterium EN overlay'));
  }
  // Uvezena epizoda nije korisnikova obrada → bez selecta modela.
  return '<div class="actwrap">'+b.join('')+'</div>'+(j.source==='import' ? '' : modelSelects(j));
}
// Poziv na /api/v1 s porukom u #notice; vraća {r, d} ili null na mrežnu grešku.
async function call(path, body, pending){
  notify(pending);
  try {
    var r = await fetch('/api/v1'+path, { method:'POST', headers: Object.assign({'content-type':'application/json'}, H), body: JSON.stringify(body||{}) });
    var d = await r.json().catch(function(){ return {}; });
    setCredits(d.credits_remaining);
    return { r: r, d: d };
  } catch(e) { notify('⚠ Mrežna greška.'); return null; }
}
function creditsError(d){ return '⚠ Nema dovoljno kredita (treba '+(d.required||1)+', imaš '+(d.credits_remaining!=null?d.credits_remaining:0)+'). Javi se administratoru za dopunu.'; }
async function runMagisterium(id, lang){
  var x = await call('/jobs/'+id+'/magisterium', { lang: lang }, 'Šaljem Magisterium '+lang.toUpperCase()+' zahtjev…');
  if (x) {
    if (x.r.status === 409) notify('⚠ ' + (x.d.error || 'Video još nije gotov.'));
    else if (x.r.ok && x.d.deduped) notify('✓ Magisterium '+lang.toUpperCase()+' je već u redu / u tijeku.');
    else if (x.r.ok) notify('✓ Magisterium '+lang.toUpperCase()+' pokrenut — obrada kreće uskoro.');
    else notify('⚠ ' + (x.d.error || 'Greška.'));
  }
  refresh();
}
// "Forsiraj sada": digni queued standard job na prioritet (naplati razliku).
async function prioritize(id){
  var x = await call('/jobs/'+id+'/prioritize', {}, 'Dižem na prioritet…');
  if (x) {
    if (x.r.status === 402) notify(creditsError(x.d));
    else if (x.r.status === 409) notify('⚠ ' + (x.d.error || 'Job je već krenuo.'));
    else if (x.r.ok) notify('⚡ Prebačeno na prioritet. Preostalo kredita: ' + credits);
    else notify('⚠ ' + (x.d.error || 'Greška.'));
  }
  refresh();
}

// ── Dijalog ponovne obrade (isti izbori kao admin; server odlučuje isto, types.ts)
var rpJob = null, rpDlg = document.getElementById('rpdlg'), rpForm = document.getElementById('rpform');
var rpUpd = wireReprocess(rpForm);
function rpCost(){
  var t = rpForm.querySelector('input[name=transcription]:checked');
  return COSTS.priority[t ? t.value : 'speechmatics'];
}
function paintRpCost(){ document.getElementById('rp-submit').textContent = '🔁 Pokreni ponovnu obradu — '+kredita(rpCost()); }
rpForm.addEventListener('change', paintRpCost);
function openReprocess(j){
  rpJob = j;
  document.getElementById('rp-title').textContent = (j.title||j.youtube_id);
  document.getElementById('rp-msg').textContent = '';
  rpForm.querySelector('select[name=article_model]').value = articleValue(j);
  rpForm.querySelector('select[name=magisterium_model]').value = j.magisterium_model || MODELS.defaults.magisterium;
  rpUpd(); paintRpCost();
  rpDlg.showModal();
}
document.getElementById('rp-cancel').addEventListener('click', function(){ rpDlg.close(); });
rpForm.addEventListener('submit', async function(e){
  e.preventDefault();
  if (!rpJob) return;
  var f = rpForm, t = f.querySelector('input[name=transcription]:checked'), m = f.querySelector('input[name=article_mode]:checked');
  var msg = document.getElementById('rp-msg');
  msg.textContent = 'Šaljem…';
  try {
    var r = await fetch('/api/v1/jobs/'+rpJob.id+'/reprocess', { method:'POST', headers: Object.assign({'content-type':'application/json'}, H), body: JSON.stringify({
      transcription: t ? t.value : undefined,
      article_mode: m ? m.value : undefined,
      article_model: f.querySelector('select[name=article_model]').value,
      with_magisterium: f.querySelector('input[name=with_magisterium]').checked,
      magisterium_model: f.querySelector('select[name=magisterium_model]').value,
    }) });
    var d = await r.json().catch(function(){ return {}; });
    setCredits(d.credits_remaining);
    if (r.status === 402) { msg.textContent = creditsError(d); return; }
    if (!r.ok) { msg.textContent = '⚠ ' + (d.error || 'Greška.'); return; }
    rpDlg.close();
    notify('🔁 Ponovna obrada pokrenuta. Preostalo kredita: ' + credits);
  } catch(e2) { msg.textContent = '⚠ Mrežna greška.'; return; }
  refresh();
});

var lastJobs = {};
async function refresh(){
  if (refreshBlocked() || rpDlg.open) return;
  try {
    var r = await fetch(READ+'/jobs'+listQs(), { headers: H });
    if (!r.ok) return;
    var data = await r.json();
    setCredits(data.credits_remaining);
    renderStats(data.counts, creditsStat());
    lastJobs = {};
    var rows = (data.jobs||[]).map(function(j){
      lastJobs[j.id] = j;
      // Izvor: X (source_url = originalni X post) ili YouTube. youtube_id je za X
      // sintetički → NE gradi youtu.be link; koristi source_url iz baze.
      var isX = j.source_platform === 'x';
      var srcUrl = j.source_url ? esc(j.source_url) : (isX ? '' : 'https://youtu.be/'+esc(j.youtube_id));
      var srcTitle = isX ? 'Izvorni X post' : 'Izvorni YouTube video';
      var domUrl = j.detail_url ? esc(j.detail_url) : '';
      var links = (srcUrl ? '<a class="mono vlink" href="'+srcUrl+'" target="_blank" rel="noopener" title="'+srcTitle+': '+srcUrl+'">'+(isX?'𝕏 '+srcUrl:srcUrl)+'</a>' : '')
                + (domUrl ? '<a class="mono vlink" href="'+domUrl+'" target="_blank" rel="noopener" title="Objavljeno na domovina.ai">'+domUrl+'</a>'
                          : '<span class="mono vlink dim">domovina.ai — čeka objavu</span>');
      var vid = '<div class="vidcell">'+thumb(j)+'<div class="vlinks">'+links+'</div></div>';
      var sub = [j.channel?esc(j.channel):'', j.duration_seconds?dur(j.duration_seconds):''].filter(Boolean).join(' · ');
      var imp = j.source==='import' ? ' <span class="imp" title="Objavljeno ranije, izvan tvojih kredita (admin ili drugi ključ) — uvezeno u tvoju listu, nije naplaćeno">uvezeno</span>' : '';
      var meta = '<div>'+esc(j.title||'(bez naslova)')+imp+'</div>'+(sub?'<div class="dim sub">'+sub+'</div>':'')+'<div class="sub">'+jobBadges(j)+'</div>';
      var res = j.detail_url ? '<a href="'+esc(j.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'
              : (j.state==='failed' && j.error ? '<span class="dim">'+esc(j.error).slice(0,80)+'</span>' : '<span class="dim">—</span>');
      // data-l = labela kolone za mobile karticu (CSS ::before)
      return '<tr><td class="dim" data-l="Dodano">'+fmt(j.created_at)+'</td><td data-l="Video">'+vid+'</td><td data-l="Naslov">'+meta+'</td><td data-l="Status">'+statusCell(j)+'</td><td data-l="Rezultat">'+res+'</td><td data-l="Akcije">'+actions(j)+'</td></tr>' + detailRow(j);
    }).join('');
    document.getElementById('rows').innerHTML = rows || emptyRow((pState||pQ)?'Nema rezultata za filter.':'Još nema obrada. Pošalji prvu gore.');
    updatePager(data);
    reloadExpanded();
  } catch(e) {}
}

// Enqueue preko /api/v1/jobs (isti kreditni put kao programatski API) — svi izbori iz forme.
document.getElementById('addform').addEventListener('submit', async function(e){
  e.preventDefault();
  // f.elements[…], ne f.title: form.title je atribut same forme, ne polje „title".
  var f = e.target, el = function(n){ return f.elements.namedItem(n); };
  var url = el('url').value.trim();
  if (!url) return;
  var x = await call('/jobs', {
    url: url,
    title: el('title').value.trim() || undefined,
    tier: (f.querySelector('input[name=tier]:checked')||{}).value || 'standard',
    transcription: el('transcription').value,
    article_model: el('article_model').value,
    with_magisterium: el('with_magisterium').checked,
    magisterium_model: el('magisterium_model').value,
  }, 'Šaljem…');
  if (x) {
    var d = x.d, clear = function(){ el('url').value=''; el('title').value=''; document.getElementById('ytprev').hidden=true; };
    if (x.r.status === 402) notify(creditsError(d));
    else if (x.r.ok && d.already_published) { notify('✓ Već objavljeno — dodano u tvoju listu (nije naplaćeno).'); clear(); }
    else if (x.r.ok && d.deduped) notify('✓ Već je u obradi — nije naplaćeno.');
    else if (x.r.ok && d.job) { notify('✓ Poslano na obradu. Preostalo kredita: ' + credits); clear(); }
    else notify('⚠ ' + (d.error || 'Greška pri slanju.'));
  }
  refresh();
});

document.getElementById('rows').addEventListener('click', function(e){
  if (handleRowClick(e)) return;
  var mb = e.target.closest('button[data-mag]');
  if (mb) { runMagisterium(mb.dataset.mag, mb.dataset.lang); return; }
  var pb = e.target.closest('button[data-prio]');
  if (pb) { prioritize(pb.dataset.prio); return; }
  var rb = e.target.closest('button[data-rp]');
  if (rb && lastJobs[rb.dataset.rp]) openReprocess(lastJobs[rb.dataset.rp]);
});
document.getElementById('transcription').addEventListener('change', paintCosts);
paintCosts();
wireListControls();
wireAddForm();
refresh();
setInterval(refresh, 10000);
</script>`;
  return layout('DOMOVINA Pipeline — moj dashboard', body);
}
