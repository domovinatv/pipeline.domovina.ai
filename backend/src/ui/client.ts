/**
 * Zajednički UI za /admin i korisnički /dashboard.
 *
 * Do v0.17.0 dashboard je imao vlastitu kopiju klijentskog JS-a (napravljenu oko v0.7–v0.14),
 * pa je svaka nova značajka admina (tokeni, bedževi modela/ponovne obrade, paginacija…) ulazila
 * samo u admin. Sad oba ekrana grade retke, korake, tokene i datoteke iz ISTOG koda ovdje;
 * stranica samo zada gdje čita i piše:
 *
 *   var READ = '/admin/api' | '/api/v1';   // GET jobs, jobs/:id/pipeline, jobs/:id/files
 *   var ACT  = '/admin/jobs' | '/api/v1/jobs'; // POST :id/llm-model | :id/mag-model
 *   var H    = { … };                       // dodatna zaglavlja (dashboard: Bearer ključ)
 *   var COLS = 6;                           // broj stupaca tablice (colspan detail retka)
 *
 * PRAVILO: nova značajka u retku/koracima/formi ide OVDJE, ne u jednu od stranica (docs/UI.md).
 *
 * NB: SHARED_CLIENT_JS je TS template literal — bez backslasheva u regexima (koristi [.]/[/]),
 * bez backticka i bez dolar-vitičaste interpolacije osim namjerne.
 */

import {
  ARTICLE_MODELS,
  DEFAULT_ARTICLE_MODEL,
  DEFAULT_MAGISTERIUM_MODEL,
  DEFAULT_TRANSCRIPTION,
  MAGISTERIUM_MODELS,
  STANDARD_COST,
  TRANSCRIPTION_OPTIONS,
  priorityCost,
} from '../types';
import { escapeHtml } from '../util';

// ───────────────────────── Server-side dijelovi formi ─────────────────────────

// <option> lista za izbor modela koraka 7+8. Katalog je jedan (types.ts) — UI ga samo
// renderira, pa se nova/uklonjena opcija ne mora održavati na dva mjesta.
export function articleModelOptions(selected: string): string {
  return ARTICLE_MODELS.map(
    (o) =>
      `<option value="${escapeHtml(o.value)}"${o.value === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
  ).join('');
}

// <option> lista za izbor transkripcije (prioritetni fast-path). Katalog u types.ts.
export function transcriptionOptions(selected: string): string {
  return TRANSCRIPTION_OPTIONS.map(
    (o) =>
      `<option value="${escapeHtml(o.value)}"${o.value === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
  ).join('');
}

export function magisteriumModelOptions(selected: string): string {
  const LABEL: Record<string, string> = {
    opus: 'Claude Opus — default (najviša kvaliteta)',
    sonnet: 'Claude Sonnet',
    haiku: 'Claude Haiku',
  };
  return MAGISTERIUM_MODELS.map(
    (m) => `<option value="${m}"${m === selected ? ' selected' : ''}>${escapeHtml(LABEL[m] ?? m)}</option>`,
  ).join('');
}

// Izbori obrade u formi za dodavanje (transkripcija, Magisterium, modeli) — isti u adminu i
// dashboardu. Tier/prioritet NIJE ovdje: admin ima besplatni checkbox, dashboard tier s kreditima.
export function renderJobChoiceFields(): string {
  return `
    <div class="field">
      <label for="transcription">Transkripcija</label>
      <select id="transcription" name="transcription">${transcriptionOptions(DEFAULT_TRANSCRIPTION)}</select>
      <div class="modelhint" id="transcription_hint"></div>
      <div class="modelhint warn">⚠ Vrijedi samo za <strong>⚡ prioritetne</strong> jobove. Standardni idu kroz noćni <em>batch</em>, koji svjež priljev ionako vrti kroz Speechmatics + Gemini sluh.</div>
    </div>
    <div class="field">
      <input type="hidden" name="mag_present" value="1">
      <label class="tieropt"><input type="checkbox" name="with_magisterium" value="1" checked> 🕊 Magisterium AI (teološko obogaćivanje — KORAK 8.5)</label>
    </div>
    <div class="modelrow">
      <div class="field">
        <label for="article_model">Model za sažetak + članak (koraci 7+8)</label>
        <select id="article_model" name="article_model">${articleModelOptions(DEFAULT_ARTICLE_MODEL)}</select>
        <div class="modelhint" id="article_model_hint"></div>
        <div class="modelhint warn">⚠ Vrijedi samo za <strong>⚡ prioritetne</strong> jobove — njih poller vrti kao zaseban single-video run. Standardni idu kroz noćni <em>batch</em> s jednim globalnim backendom za sve epizode — od 2026-07-29 i on je <strong>Claude Opus</strong> (nightly_pipeline.sh).</div>
      </div>
      <div class="field">
        <label for="magisterium_model">Model za Magisterium MCP (korak 8.5)</label>
        <select id="magisterium_model" name="magisterium_model">${magisteriumModelOptions(DEFAULT_MAGISTERIUM_MODEL)}</select>
        <div class="modelhint">Runbook ide kroz Claude Code CLI (Magisterium MCP alati) — Gemini ovdje nije opcija.</div>
      </div>
    </div>`;
}

// Izbori ponovne obrade (prijepis / članak / Magisterium). Admin ih renderira na potvrdnoj
// stranici, dashboard u dijalogu. Imena polja su ista, pa server čita isto (types.ts
// reprocessRedoArticle); UI pravilo „novi prijepis → novi članak" zrcali REPROCESS_WIRE_JS.
export function renderReprocessFields(opts: {
  transcription?: string;
  articleModel?: string;
  magisteriumModel?: string;
  withMagisterium?: boolean;
}): string {
  const tr = opts.transcription || DEFAULT_TRANSCRIPTION;
  const radio = (name: string, value: string, checked: boolean, label: string, hint = '') =>
    `<label class="tieropt"><input type="radio" name="${name}" value="${value}"${checked ? ' checked' : ''}> ${label}${hint ? ` <span class="dim">— ${hint}</span>` : ''}</label>`;
  const trOpt = (o: (typeof TRANSCRIPTION_OPTIONS)[number]) =>
    radio('transcription', o.value, tr === o.value, escapeHtml(o.label));
  return `
    <div class="field">
      <label>Prijepis</label>
      ${radio('transcription', 'none', tr === 'none', 'Ne diraj postojeći prijepis')}
      ${TRANSCRIPTION_OPTIONS.slice().reverse().map(trOpt).join('\n      ')}
    </div>
    <div class="field">
      <label>Članak (koraci 7+8)</label>
      ${radio('article_mode', 'keep', false, 'Ne diraj postojeći članak', 'samo bez novog prijepisa')}
      ${radio('article_mode', 'new', true, 'Novi članak')}
      <select name="article_model">${articleModelOptions(opts.articleModel || DEFAULT_ARTICLE_MODEL)}</select>
    </div>
    <div class="field">
      <label class="tieropt"><input type="checkbox" name="with_magisterium" value="1"${opts.withMagisterium === false ? '' : ' checked'}> 🕊 Magisterium iznova (za novi članak)</label>
      <select name="magisterium_model">${magisteriumModelOptions(opts.magisteriumModel || DEFAULT_MAGISTERIUM_MODEL)}</select>
    </div>
    <div class="modelhint">⚡ Ponovna obrada uvijek ide prioritetnim putem (zaseban single-video run) — samo on poštuje izbore iznad. Nakon runa bridge prepiše channel dir (stare datoteke → <span class="mono">.bak</span>) i CDN, tako da prijepis i words.json na CDN-u dolaze iz istog prolaza.</div>`;
}

// Novi prijepis povlači novi članak (poglavlja/citati starog ne odgovaraju novom tekstu).
// Zrcali reprocessRedoArticle() iz types.ts; server ionako odlučuje isto.
export const REPROCESS_WIRE_JS = `
function wireReprocess(f){
  function upd(){
    var t = f.querySelector('input[name=transcription]:checked');
    var keep = f.querySelector('input[name=article_mode][value=keep]');
    var lock = !t || t.value !== 'none';
    keep.disabled = lock;
    if (lock) f.querySelector('input[name=article_mode][value=new]').checked = true;
    var art = f.querySelector('input[name=article_mode]:checked');
    f.querySelector('select[name=article_model]').disabled = !art || art.value !== 'new';
    f.querySelector('select[name=magisterium_model]').disabled = !f.querySelector('input[name=with_magisterium]').checked;
  }
  f.addEventListener('change', upd);
  upd();
  return upd;
}`;

// ───────────────────────── Klijentski JS (dijeljen) ─────────────────────────

// Katalog serijaliziran za klijentski JS (selecti u retcima tablice se renderiraju tamo).
const MODEL_CATALOG_JSON = JSON.stringify({
  article: ARTICLE_MODELS.map((o) => ({ value: o.value, label: o.label, short: o.short, hint: o.hint })),
  magisterium: MAGISTERIUM_MODELS,
  transcription: TRANSCRIPTION_OPTIONS,
  defaults: {
    article: DEFAULT_ARTICLE_MODEL,
    magisterium: DEFAULT_MAGISTERIUM_MODEL,
    transcription: DEFAULT_TRANSCRIPTION,
  },
});

// Cijene u kreditima (dashboard ih prikazuje uz izbor); izvor je types.ts.
const COSTS_JSON = JSON.stringify({
  standard: STANDARD_COST,
  priority: { speechmatics: priorityCost('speechmatics'), canary: priorityCost('canary'), none: priorityCost('none') },
});

export const SHARED_CLIENT_JS = `
// ── Osnovno
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(ts){ if(!ts) return ''; return new Date(ts*1000).toLocaleString('hr-HR'); }
// pill klasa = ime stanja → semantička boja iz CSS-a (.pill.queued, .pill.done, …)
function pill(s){ return '<span class="pill '+s+'">'+s+'</span>'; }
// thumb(j): za X nema ytimg thumbnail (sintetički id) → 𝕏 placeholder; inače ytimg.
function thumb(j){ if(j && j.source_platform==='x') return '<div class="rthumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:#0f1419;background:#E8F5FE;">𝕏</div>'; var id = (j && j.youtube_id!==undefined) ? j.youtube_id : j; return '<img class="rthumb" loading="lazy" alt="" src="https://i.ytimg.com/vi/'+esc(id)+'/mqdefault.jpg">'; }
function dur(s){ if(!s) return ''; s=Math.round(s); var h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60; var p=function(n){ return String(n).padStart(2,'0'); }; return h? h+':'+p(m)+':'+p(x) : m+':'+p(x); }
// Poruka korisniku: u #notice ako ga stranica ima, inače alert (admin).
function notify(m){ var el=document.getElementById('notice'); if (el) el.textContent=m; else alert(m); }

// ── Katalog modela (types.ts je jedan izvor istine; ovdje samo renderiranje)
var MODELS = ${MODEL_CATALOG_JSON};
var COSTS = ${COSTS_JSON};
var MAG_MODEL_LABEL = { opus:'Opus', sonnet:'Sonnet', haiku:'Haiku' };

// (backend, model) iz baze → vrijednost selecta. Mora pratiti articleModelValue() u types.ts.
function articleValue(j){
  var backend = j.llm_backend || 'vertex';
  var model = j.llm_model || null;
  var want = model ? (backend+':'+model) : backend;
  return MODELS.article.some(function(o){ return o.value===want; }) ? want : MODELS.defaults.article;
}
// Kratka oznaka modela za badge — ista koju koristi i select u retku (polje short u katalogu).
function articleShort(j){
  var v = articleValue(j);
  var o = MODELS.article.filter(function(x){ return x.value===v; })[0];
  return o ? (o.short || o.label) : v;
}
// Badge: kojim je modelom job KONFIGURIRAN (7+8 i 8.5). Default se ne prikazuje.
function modelBadge(j){
  var out = '';
  if (articleValue(j) !== MODELS.defaults.article) {
    out += ' <span class="pill model" title="Model koraka 7+8 (sažetak + članak)">🤖 '+esc(articleShort(j))+'</span>';
  }
  var mm = j.magisterium_model;
  if (mm && mm !== MODELS.defaults.magisterium) {
    out += ' <span class="pill model" title="Model Magisterium MCP runbooka (korak 8.5)">🕊 '+esc(MAG_MODEL_LABEL[mm]||mm)+'</span>';
  }
  return out;
}
var TRANSCRIPTION_SHORT = {};
MODELS.transcription.forEach(function(o){ TRANSCRIPTION_SHORT[o.value] = o.short; });
function reprocessBadge(j){
  if (!j.reprocess) return '';
  var what = [j.transcription!=='none'?'prijepis':'', j.redo_article?'članak':'', j.with_magisterium?'Magisterium':''].filter(Boolean).join(' + ');
  return ' <span class="pill model" title="Ponovna obrada već objavljene epizode: '+esc(what)+'">🔁 '+esc(what)+'</span>';
}
// Transkripcija: bitna samo za prioritetne jobove (standardne vrti nightly s globalnom konfiguracijom).
function transcriptionBadge(j){
  if (!j.priority || !j.transcription || j.transcription==='none') return '';
  var sm = j.transcription === 'speechmatics';
  return ' <span class="pill model" title="'+(sm?'Speechmatics + Gemini sluh (kao nightly) → i words.json':'Samo Modal Canary + pyannote (jeftino, bez words.json)')+'">🎙 '+esc(TRANSCRIPTION_SHORT[j.transcription]||j.transcription)+'</span>';
}
function priorityBadge(j){
  return j.priority ? ' <span class="pill prio" title="Prioritetna obrada (Modal, odmah)">⚡ Prioritet</span>' : '';
}
// Transkripcijski lock: koji backend (modal/colab) drži transkripciju. Nestaje na done/failed.
function transcribeBadge(j){
  if (j.transcribe_backend==='modal') return ' <span class="pill tb-modal" title="Transkribira Modal (serverless GPU)'+(j.transcribe_claimed_at?' · zauzeto '+fmt(j.transcribe_claimed_at):'')+'">⚡ Modal</span>';
  if (j.transcribe_backend==='colab') return ' <span class="pill tb-colab" title="Transkribira Colab Canary batch'+(j.transcribe_claimed_at?' · zauzeto '+fmt(j.transcribe_claimed_at):'')+'">🧪 Colab</span>';
  return '';
}
// Magisterium (re)obrada stanje po jeziku. wait=queued, run=running, done, failed.
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
// Svi bedževi stanja/izbora joba, istim redom na obje stranice.
function jobBadges(j){
  return priorityBadge(j)+reprocessBadge(j)+transcriptionBadge(j)+transcribeBadge(j)+magStateBadge(j)+modelBadge(j);
}

// ── Selecti modela u retku. kind='llm-model' (koraci 7+8) | 'mag-model' (korak 8.5).
function modelSel(j, kind, opts, current, title, cls){
  var o = opts.map(function(v){
    var label = kind==='mag-model' ? ('🕊 '+(MAG_MODEL_LABEL[v.value]||v.value)) : (v.short || v.label);
    return '<option value="'+esc(v.value)+'"'+(v.value===current?' selected':'')+'>'+esc(label)+'</option>';
  }).join('');
  return '<select class="modelsel'+(cls?' '+cls:'')+'" data-id="'+esc(j.id)+'" data-kind="'+kind+'" title="'+esc(title)+'">'+o+'</select>';
}
function modelSelects(j){
  var b = [];
  // Koraci 7+8 se mijenjaju samo dok članak još nije generiran (ponovna generacija je zaseban put).
  if (j.state!=='done' && j.state!=='failed') {
    b.push(modelSel(j, 'llm-model', MODELS.article, articleValue(j),
      j.priority
        ? 'Model za sažetak + članak (koraci 7+8)'
        : 'Model za sažetak + članak — NEMA efekta bez ⚡ prioriteta (noćni batch koristi jedan globalni backend)'));
  }
  // Magisterium model vrijedi UVIJEK — na done jobovima ga koriste gumbi 🕊 HR/EN,
  // na ostalima cron auto-enqueue kad job dođe u done.
  var magOpts = MODELS.magisterium.map(function(m){ return { value:m, label:m }; });
  b.push(modelSel(j, 'mag-model', magOpts, j.magisterium_model || MODELS.defaults.magisterium,
    'Model za Magisterium MCP (korak 8.5) — vrijedi za sljedeći zahtjev', 'mag'));
  return '<div class="modelwrap">'+b.join('')+'</div>';
}
// Promjena modela na postojećem jobu. Ruta validira protiv kataloga i vraća 400 za nepoznat model.
async function setModel(id, kind, value){
  try {
    var r = await fetch(ACT+'/'+id+'/'+kind, {
      method:'POST', headers: Object.assign({'content-type':'application/json'}, H), body: JSON.stringify({ value: value })
    });
    if (!r.ok) { var d = await r.json().catch(function(){ return {}; }); notify('Nije spremljeno: '+(d.error||r.status)); }
  } catch(e) { notify('Mrežna greška.'); }
  refresh();
}

// ── Koraci pipelinea, tokeni i CDN datoteke (detail redak ispod retka)
var expandedId = '', filesOpen = false, filesCache = {};
function statusCell(j){
  var open = expandedId===j.id;
  return pill(j.state)+'<div><button class="pillbtn" data-jobid="'+esc(j.id)+'" aria-expanded="'+(open?'true':'false')+'" title="Prikaži korake pipelinea">'+(open?'▾':'▸')+' koraci</button></div>';
}
function detailRow(j){
  var open = expandedId===j.id, fOpen = filesOpen && open;
  // FILES_PAGE (samo admin): poveznica na zasebnu stranicu s listingom.
  var page = (typeof FILES_PAGE==='string') ? ' <a class="s-open" style="text-transform:none;letter-spacing:0;" href="'+FILES_PAGE+esc(j.id)+'/files" title="Ista lista na zasebnoj stranici">↗ zasebno</a>' : '';
  return '<tr class="detail-row" data-detail="'+esc(j.id)+'"'+(open?'':' hidden')+'>'+
    '<td colspan="'+COLS+'"><div class="steps-head">Pipeline koraci'+
    ' <button class="pillbtn files-btn" data-filesjob="'+esc(j.id)+'" aria-expanded="'+(fOpen?'true':'false')+'" style="margin-left:.5rem;" title="Sve datoteke ovog videa na CDN-u (live iz R2)">📁 datoteke</button>'+page+'</div>'+
    '<div id="steps-'+esc(j.id)+'"><div class="steps-loading">Učitavam korake…</div></div>'+
    '<div id="files-'+esc(j.id)+'"'+(fOpen?'':' hidden')+'></div></td></tr>';
}
function stepBadge(st){ return st==='done'?'gotovo':st==='skipped'?'preskočeno':'čeka'; }
function stepGlyph(st){ return st==='done'?'✓':st==='skipped'?'–':''; }
// Trajanje u ljudskom obliku; bira najkrupniju smislenu jedinicu (45s / 12 min / 3h 20min / 6d 4h).
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
// Vremenska traka: kad je ušlo u queue, kad je obrada počela/završila i koliko je ukupno trajala.
function renderTiming(t){
  if (!t) return '';
  var cells = [];
  if (t.queued_at)  cells.push(['U queue', fmtAt(t.queued_at), '']);
  if (t.start_at)   cells.push(['Početak', fmtAt(t.start_at), '']);
  if (t.end_at)     cells.push(['Kraj', fmtAt(t.end_at), '']);
  if (t.total_seconds !== null && t.total_seconds !== undefined) cells.push(['Ukupno', fmtDur(t.total_seconds), 'total']);
  // Job prozor (claim → gotovo) je UŽI od ukupnog kad koraci trče izvan njega (Magisterium
  // kreće tek nakon 'done'). Zasebno i samo kad se razlikuje, da se ne pomiješa s headline brojem.
  if (t.job_seconds !== null && t.job_seconds !== undefined && t.job_seconds !== t.total_seconds) {
    cells.push(['Od toga job', fmtDur(t.job_seconds), '']);
  }
  if (!cells.length) return '';
  var strip = '<div class="timing">'+cells.map(function(c){
    return '<div class="t-cell'+(c[2]==='total'?' t-total':'')+'"><div class="t-label">'+esc(c[0])+'</div><div class="t-val">'+esc(c[1])+'</div></div>';
  }).join('')+'</div>';
  return strip+'<div class="timing-note">Vrijeme uz korak je <strong>trenutak objave njegovog artefakta na CDN-u</strong> (Last-Modified), a Δ je razmak do prethodnog koraka — u njega ulazi i čekanje (npr. na Colab batch), ne samo računanje. „Ukupno" je raspon od prvog do zadnjeg koraka; „Od toga job" je uži prozor u kojem je bridge držao job (Magisterium i naknadni koraci trče izvan njega).</div>';
}
function fmtTok(n){
  if (!n) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(n >= 10000000 ? 0 : 1)+'M';
  if (n >= 1000) return Math.round(n/1000)+'k';
  return String(n);
}
// Potrošnja tokena iz Claude Code headless sesija za ovaj video. Namjerno BEZ dolara:
// ti runovi idu pod pretplatom, ne per-token naplatom.
function renderTokens(t){
  if (!t) return '';
  var cells = [
    ['Ulaz', fmtTok(t.input_tokens)],
    ['Cache upis', fmtTok(t.cache_creation_tokens)],
    ['Cache čitanje', fmtTok(t.cache_read_tokens)],
    ['Izlaz', fmtTok(t.output_tokens)],
  ];
  var models = t.models ? '<span class="dim"> · '+esc(t.models)+'</span>' : '';
  return '<div class="steps-head" style="margin-top:1rem;">Potrošnja tokena — Claude Code'+
      ' <span class="dim" style="text-transform:none;letter-spacing:0;font-weight:600;">('+(t.runs||0)+' '+((t.runs===1)?'headless run':'headless runova')+')</span>'+models+'</div>'+
    '<div class="timing">'+cells.map(function(c){
      return '<div class="t-cell"><div class="t-label">'+esc(c[0])+'</div><div class="t-val">'+esc(c[1])+'</div></div>';
    }).join('')+'</div>'+
    '<div class="timing-note">Zbroj iz Claude Code session datoteka, samo <strong>headless</strong> runovi pipelinea (Magisterium MCP runbook, <span class="mono">--gemini-backend claude</span>) — interaktivne sesije se ne pripisuju videu. Runovi idu pod Claude Code pretplatom, pa se trošak ne izražava u dolarima.</div>';
}
function renderStepList(steps){
  return '<ul class="steps">'+steps.map(function(s){
    var cls = s.state;   // done | pending | skipped
    var link = s.url ? '<a class="s-open" href="'+esc(s.url)+'" target="_blank" rel="noopener" title="Otvori u novom tabu">↗ otvori</a>' : '';
    // Δ = koliko je prošlo od prethodnog koraka. Negativan razmak (artefakt stariji od
    // prethodnog) NIJE trajanje nego ponovna objava — označimo ga, ne prikazujemo kao vrijeme.
    var when = s.at ? '<span class="s-when" title="Objavljeno na CDN-u">'+esc(fmtAt(s.at))+'</span>' : '';
    var delta = '';
    if (s.delta_seconds !== null && s.delta_seconds !== undefined) {
      delta = '<span class="s-delta" title="Od prethodnog koraka (uključuje i čekanje)">+'+esc(fmtDur(s.delta_seconds))+'</span>';
    } else if (s.out_of_order) {
      delta = '<span class="s-delta reissue" title="Artefakt je stariji od prethodnog koraka — naknadno ponovno objavljen">↺ ponovna objava</span>';
    }
    var time = (when||delta) ? '<div class="s-time">'+when+delta+'</div>' : '';
    return '<li class="is-'+cls+'">'+
      '<span class="dot '+cls+'">'+stepGlyph(s.state)+'</span>'+
      '<div class="s-main"><div class="s-label">'+esc(s.label)+'</div><div class="s-note">'+esc(s.note)+'</div>'+time+'</div>'+
      link+
      '<span class="pill s-badge '+cls+'">'+stepBadge(s.state)+'</span>'+
    '</li>';
  }).join('')+'</ul>';
}
// Koraci pa tokeni ispod njih (tokeni su dodatak, ne dio lanca koraka).
function renderSteps(steps, timing, tokens){
  if (!steps || !steps.length) return '<div class="steps-loading">Nema podataka o koracima.</div>';
  return renderTiming(timing)+renderStepList(steps)+renderTokens(tokens);
}
async function loadSteps(id){
  var host = document.getElementById('steps-'+id);
  if (!host) return;
  try {
    var r = await fetch(READ+'/jobs/'+id+'/pipeline', { headers: Object.assign({'accept':'application/json'}, H) });
    if (!r.ok) { host.innerHTML = '<div class="steps-loading">Greška pri dohvatu koraka.</div>'; return; }
    var data = await r.json();
    host.innerHTML = renderSteps(data.steps, data.timing, data.tokens);
  } catch(e) { host.innerHTML = '<div class="steps-loading">Greška pri dohvatu koraka.</div>'; }
}
function fmtSize(b){
  if (b >= 1073741824) return (b/1073741824).toFixed(2)+' GB';
  if (b >= 1048576) return (b/1048576).toFixed(1)+' MB';
  if (b >= 1024) return Math.round(b/1024)+' KB';
  return b+' B';
}
function renderFiles(data){
  var out = '';
  (data.groups||[]).forEach(function(g){
    var tot = 0; (g.files||[]).forEach(function(f){ tot += f.size; });
    out += '<div class="steps-head" style="margin-top:.8rem;">'+esc(g.label)+
      ' <span class="dim" style="text-transform:none;letter-spacing:0;font-weight:600;">· '+g.files.length+' · '+fmtSize(tot)+'</span></div>';
    if (!g.files.length) { out += '<div class="steps-loading">Nema datoteka.</div>'; return; }
    out += g.files.map(function(f){
      var rel = f.key.slice(g.prefix.length);
      var when = f.uploaded ? new Date(f.uploaded).toLocaleString('hr-HR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      return '<div style="padding:.15rem 0;overflow-wrap:anywhere;"><a class="mono" href="'+esc(data.cdn_base+'/'+f.key)+'" target="_blank" rel="noopener">'+esc(rel)+'</a>'+
        ' <span class="dim" style="white-space:nowrap;">— '+fmtSize(f.size)+(when?' · '+when:'')+'</span></div>';
    }).join('');
  });
  return out || '<div class="steps-loading">Nema datoteka na CDN-u.</div>';
}
// Cache renderiranog HTML-a po jobu: refresh() svakih 10s re-rendera retke pa otvoreni
// panel obnavljamo iz cachea bez ponovnog fetcha (sadržaj se rijetko mijenja).
async function loadFiles(id){
  var host = document.getElementById('files-'+id);
  if (!host) return;
  if (filesCache[id]) { host.innerHTML = filesCache[id]; return; }
  host.innerHTML = '<div class="steps-loading">Učitavam datoteke…</div>';
  try {
    var r = await fetch(READ+'/jobs/'+id+'/files', { headers: Object.assign({'accept':'application/json'}, H) });
    if (!r.ok) { host.innerHTML = '<div class="steps-loading">Greška pri dohvatu datoteka.</div>'; return; }
    filesCache[id] = renderFiles(await r.json());
    host.innerHTML = filesCache[id];
  } catch(e) { host.innerHTML = '<div class="steps-loading">Greška pri dohvatu datoteka.</div>'; }
}
function toggleFiles(id){
  if (expandedId !== id) return;
  filesOpen = !filesOpen;
  var host = document.getElementById('files-'+id);
  if (host) host.hidden = !filesOpen;
  document.querySelectorAll('button.files-btn').forEach(function(b){
    b.setAttribute('aria-expanded', (filesOpen && b.dataset.filesjob===id)?'true':'false');
  });
  if (filesOpen) loadFiles(id);
}
function toggleSteps(id){
  expandedId = (expandedId===id) ? '' : id;
  // Zatvaranje/promjena retka resetira files panel (inače bi stari sadržaj ostao vidljiv).
  filesOpen = false;
  document.querySelectorAll('div[id^="files-"]').forEach(function(d){ d.hidden = true; });
  document.querySelectorAll('button.files-btn').forEach(function(b){ b.setAttribute('aria-expanded','false'); });
  document.querySelectorAll('tr.detail-row').forEach(function(tr){ tr.hidden = tr.dataset.detail!==expandedId; });
  document.querySelectorAll('button.pillbtn[data-jobid]').forEach(function(b){
    var on = b.dataset.jobid===expandedId;
    b.setAttribute('aria-expanded', on?'true':'false');
    b.textContent = (on?'▾':'▸')+' koraci';
  });
  if (expandedId) loadSteps(expandedId);
}
// Nakon što refresh() prepiše tbody: re-loadaj otvoreni redak (koraci i datoteke).
function reloadExpanded(){
  if (expandedId && document.getElementById('steps-'+expandedId)) loadSteps(expandedId);
  if (expandedId && filesOpen && document.getElementById('files-'+expandedId)) loadFiles(expandedId);
}
// Zajednički klikovi u tablici: datoteke (PRIJE generičkog pillbtn — dijele klasu) i koraci.
function handleRowClick(e){
  var fb = e.target.closest('button.files-btn');
  if (fb) { toggleFiles(fb.dataset.filesjob); return true; }
  var tog = e.target.closest('button.pillbtn[data-jobid]');
  if (tog) { toggleSteps(tog.dataset.jobid); return true; }
  return false;
}

// ── Stat pločice, filter, pretraga, paginacija
var STATE_ORDER = ['queued','fetching','transcribing','processing','done','failed','postponed','skipped'];
var pState='', pQ='', pLimit=50, pOffset=0, pTotal=0;
function listQs(){
  return '?limit='+pLimit+'&offset='+pOffset+(pState?'&state='+encodeURIComponent(pState):'')+(pQ?'&q='+encodeURIComponent(pQ):'');
}
// prefix = dodatne pločice ispred stanja (dashboard: preostali krediti).
function renderStats(counts, prefix){
  document.getElementById('stats').innerHTML = (prefix||'') + STATE_ORDER.map(function(s){
    return '<div class="stat s-'+s+'"><div class="label">'+s+'</div><div class="value">'+((counts||{})[s]||0)+'</div></div>';
  }).join('');
}
function emptyRow(text){ return '<tr><td colspan="'+COLS+'" class="empty">'+text+'</td></tr>'; }
function updatePager(data){
  pTotal = data.total||0;
  var shown = (data.jobs||[]).length;
  document.getElementById('pInfo').textContent = pTotal ? ((pOffset+1)+'–'+(pOffset+shown)+' od '+pTotal) : 'nema zapisa';
  document.getElementById('pPrev').disabled = pOffset <= 0;
  document.getElementById('pNext').disabled = pOffset + pLimit >= pTotal;
  document.getElementById('updated').textContent = 'osvježeno ' + new Date().toLocaleTimeString('hr-HR');
}
// Auto-refresh prepisuje cijeli <tbody>. Ako je select u retku otvoren/fokusiran, preskoči
// tick — inače izbor nestane korisniku ispod prsta usred biranja.
function refreshBlocked(){
  var af = document.activeElement;
  return !!(af && af.tagName === 'SELECT' && af.closest('#rows'));
}
function wireListControls(){
  var fState=document.getElementById('fState'), fQ=document.getElementById('fQ'), fLimit=document.getElementById('fLimit'), qTimer=null;
  fState.addEventListener('change', function(){ pState=fState.value; pOffset=0; refresh(); });
  fLimit.addEventListener('change', function(){ pLimit=parseInt(fLimit.value,10)||50; pOffset=0; refresh(); });
  fQ.addEventListener('input', function(){ clearTimeout(qTimer); qTimer=setTimeout(function(){ pQ=fQ.value.trim(); pOffset=0; refresh(); }, 350); });
  document.getElementById('pPrev').addEventListener('click', function(){ if(pOffset>0){ pOffset=Math.max(0,pOffset-pLimit); refresh(); } });
  document.getElementById('pNext').addEventListener('click', function(){ if(pOffset+pLimit<pTotal){ pOffset+=pLimit; refresh(); } });
  // Selecti modela u retcima (data-kind = ruta: llm-model | mag-model).
  document.getElementById('rows').addEventListener('change', function(e){
    var s = e.target.closest('select.modelsel');
    if (s) { s.blur(); setModel(s.dataset.id, s.dataset.kind, s.value); }
  });
}

// ── Forma za dodavanje: YouTube oEmbed preview + prefill naslova, hintovi izbora
// Radi za public I unlisted (oba vraćaju 200). Private/obrisani vrate 401/404 → tiho
// preskočimo; bridge svejedno backfilla iz info.json.
function ytId(s){
  s = (s||'').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  // NB: [.] i [/] umjesto backslash escapea — template literal bi ih pojeo (numeric-separator crash).
  var m = s.match(/[?&]v=([A-Za-z0-9_-]{11})|youtu[.]be[/]([A-Za-z0-9_-]{11})|[/]shorts[/]([A-Za-z0-9_-]{11})|[/]live[/]([A-Za-z0-9_-]{11})|[/]v[/]([A-Za-z0-9_-]{11})/);
  return m ? (m[1]||m[2]||m[3]||m[4]||m[5]) : '';
}
function wireAddForm(){
  var urlEl = document.getElementById('url'), titleEl = document.getElementById('title'), prev = document.getElementById('ytprev');
  if (urlEl && titleEl) {
    var autoFilled = '', timer = null, lastId = '';
    var prefill = async function(){
      var id = ytId(urlEl.value);
      if (!id) { if (prev) prev.hidden = true; lastId = ''; return; }
      if (id === lastId) return;
      lastId = id;
      try {
        var r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
        if (!r.ok) { if (prev) prev.hidden = true; return; }
        var j = await r.json();
        if (prev) {
          document.getElementById('ytprev-thumb').src = j.thumbnail_url || '';
          document.getElementById('ytprev-title').textContent = j.title || '';
          document.getElementById('ytprev-chan').textContent = j.author_name ? ('Kanal: ' + j.author_name) : '';
          var link = document.getElementById('ytprev-link');
          if (link) link.href = 'https://www.youtube.com/watch?v=' + id;
          prev.hidden = false;
        }
        // Prefill naslova (ne gazi ručni unos)
        if (j.title && (!titleEl.value || titleEl.value === autoFilled)) { titleEl.value = j.title; autoFilled = j.title; }
      } catch(e) { if (prev) prev.hidden = true; }
    };
    urlEl.addEventListener('input', function(){ clearTimeout(timer); timer = setTimeout(prefill, 400); });
    urlEl.addEventListener('change', prefill);
  }
  // Hint ispod selecta — objasni što odabir znači (trošak/kvaliteta).
  [['article_model','article_model_hint','article'],['transcription','transcription_hint','transcription']].forEach(function(x){
    var sel = document.getElementById(x[0]), hint = document.getElementById(x[1]);
    if (!sel || !hint) return;
    function upd(){
      var o = MODELS[x[2]].filter(function(v){ return v.value===sel.value; })[0];
      hint.textContent = o ? o.hint : '';
    }
    sel.addEventListener('change', upd);
    upd();
  });
}
${REPROCESS_WIRE_JS}
`;
