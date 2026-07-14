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

import type { ApiKeyRow } from '../types';
import { escapeHtml } from '../util';

// Verzija aplikacije — BUMPAJ prije svakog redeploya (semver). Prikazuje se u
// footeru svih stranica (admin + dashboard) da se na prvi pogled zna koji je
// build live. Podudaraj s "version" u package.json.
export const APP_VERSION = 'v0.6.0';

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
/* Stat-pločice obojane po stanju — iste semantičke boje kao pillovi u listi */
.stat.s-queued      { background: #E7EEF8; border-color: #CDDDF6; }
.stat.s-queued .value { color: #1D4ED8; }
.stat.s-fetching,
.stat.s-transcribing,
.stat.s-processing  { background: #FDF1E0; border-color: #F5DEB8; }
.stat.s-fetching .value,
.stat.s-transcribing .value,
.stat.s-processing .value { color: #B45309; }
.stat.s-done        { background: #E0F1E5; border-color: #BFE3CC; }
.stat.s-done .value { color: #2E8540; }
.stat.s-failed      { background: #F8E2E0; border-color: #F3C9C5; }
.stat.s-failed .value { color: #B42318; }
.stat.s-skipped     { background: #ECEFF2; border-color: #D4D9DE; }
.stat.s-skipped .value { color: #5A6570; }
.stat.s-postponed   { background: #F3E8FF; border-color: #E3D4FB; }
.stat.s-postponed .value { color: #7C3AED; }
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
button.act { border: 1px solid var(--border); background: var(--bg); color: var(--navy); border-radius: .35rem; padding: .2rem .5rem; font-size: .78rem; font-weight: 600; cursor: pointer; margin-right: .25rem; margin-bottom: .25rem; }
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
/* Izvor unosa: API ključ (naglašen) vs ručni admin unos */
.pill.src-api { background: #EEF2FF; color: #4338CA; border: 1px solid #DDD6FE; text-transform: none; letter-spacing: 0; }
.pill.src-admin { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.pill.src-import { background: #F3E8FF; color: #7C3AED; border: 1px solid #E9D5FF; text-transform: none; letter-spacing: 0; }
/* Transkripcijski claim/lock: koji backend drži transkripciju (colab batch vs modal GPU) */
.pill.tb-modal { background: #E7EEF8; color: #1D4ED8; border: 1px solid #C7D7F0; text-transform: none; letter-spacing: 0; }
.pill.tb-colab { background: #FDF1E0; color: #B45309; border: 1px solid #F5D9A8; text-transform: none; letter-spacing: 0; }
/* Priority tier: prioritetni (Modal instant) job */
.pill.prio { background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; text-transform: none; letter-spacing: 0; }
/* Magisterium (re)obrada stanje po jeziku (badge u meta čeliji) */
.pill.mag { text-transform: none; letter-spacing: 0; }
.pill.mag-wait   { background: #EEF2FF; color: #4338CA; border: 1px solid #DDD6FE; }   /* queued — čeka pollera */
.pill.mag-run    { background: #FDF1E0; color: #B45309; border: 1px solid #F5D9A8; }   /* running — poller obrađuje */
.pill.mag-done   { background: #E0F1E5; color: #2E8540; border: 1px solid #BFE3CC; }   /* done */
.pill.mag-failed { background: #F8E2E0; color: #B42318; border: 1px solid #F3C9C5; }   /* failed */
/* Tier izbor u enqueue formi + "Forsiraj sada" gumb */
.tierpick { display: flex; flex-direction: column; gap: .3rem; }
.tieropt { font-weight: 400; display: flex; align-items: center; gap: .4rem; cursor: pointer; }
.prio-btn { border-color: #FDE68A; color: #92400E; }
/* Semantičke boje po stanju (pill klasa = ime stanja) */
.pill.queued      { background: #E7EEF8; color: #1D4ED8; }   /* plava — čeka */
.pill.fetching,
.pill.transcribing,
.pill.processing  { background: #FDF1E0; color: #B45309; }   /* amber — u tijeku */
.pill.done        { background: #E0F1E5; color: #2E8540; }   /* zelena — gotovo */
.pill.failed      { background: #F8E2E0; color: #B42318; }   /* crvena — greška */
.pill.skipped     { background: #ECEFF2; color: #5A6570; }   /* siva — preskočeno */
.pill.postponed   { background: #F3E8FF; color: #7C3AED; }   /* ljubičasta — odgođeno */
/* "koraci" toggle ispod statusa — otvara per-korak pipeline prikaz */
.pillbtn {
  font: inherit; cursor: pointer; border: 1px solid var(--border); background: var(--bg);
  color: var(--navy); padding: .15rem .5rem; margin-top: .35rem; border-radius: .35rem;
  font-size: .76rem; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: .25rem;
}
.pillbtn:hover { background: var(--surface); }
.pillbtn[aria-expanded="true"] { background: var(--navy); color: #fff; border-color: var(--navy); }
/* Expandable redak s koracima */
tr.detail-row > td { background: var(--surface); padding: .4rem 1rem 1rem; }
.steps-head { font-size: .8rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: .3rem 0 .6rem; }
.steps { list-style: none; margin: 0; padding: 0; max-width: 38rem; }
.steps li { position: relative; display: flex; align-items: flex-start; gap: .6rem; padding: .3rem 0 .3rem .2rem; }
/* Vertikalna spojnica između točkica koraka */
.steps li:not(:last-child)::before { content: ""; position: absolute; left: .75rem; top: 1.5rem; bottom: -.3rem; width: 2px; background: var(--border); }
.steps .dot { position: relative; z-index: 1; width: 1.2rem; height: 1.2rem; border-radius: 50%; flex: none; display: inline-flex; align-items: center; justify-content: center; font-size: .72rem; font-weight: 900; color: #fff; }
.steps .dot.done    { background: var(--success); }
.steps .dot.pending { background: #fff; border: 2px dashed #CBD5E1; color: #94A3B8; }
.steps .dot.skipped { background: #EDE9FE; border: 2px solid #DDD0FB; color: #7C3AED; }
.steps .s-main { flex: 1; min-width: 0; }
.steps .s-label { font-weight: 700; font-size: .92rem; }
.steps .s-note { color: var(--muted); font-size: .78rem; margin-top: .05rem; }
.steps li.is-pending .s-label { color: var(--muted); }
.steps .s-open { flex: none; font-size: .78rem; font-weight: 700; text-decoration: none; color: var(--navy); border: 1px solid var(--border); border-radius: .3rem; padding: .1rem .4rem; white-space: nowrap; }
.steps .s-open:hover { background: var(--bg); border-color: var(--navy); }
.steps .s-badge { margin-left: .5rem; flex: none; }
.s-badge.done    { background: #E0F1E5; color: var(--success); }
.s-badge.pending { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.s-badge.skipped { background: #F3E8FF; color: #7C3AED; }
.steps-loading { color: var(--muted); font-size: .85rem; padding: .3rem 0; }
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
/* Magisterium akcije: toggle namjere (uklj/isklj) + one-click (re)obrada HR/EN */
button.act.a-mag-off, button.act.a-mag-on,
button.act.a-magisterium-hr, button.act.a-magisterium-en { color: #4338CA; border-color: #DDD6FE; }
button.act.a-mag-off:hover, button.act.a-mag-on:hover,
button.act.a-magisterium-hr:hover, button.act.a-magisterium-en:hover { background: #EEF2FF; }
button.act.a-mag-on { color: var(--muted); border-color: var(--border); }
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
/* Tabovi (Queue / API ključevi) */
.tabs { display: flex; gap: .5rem; margin-bottom: 1.1rem; }
.tabs .tab {
  padding: .4rem .9rem; border: 1px solid var(--border); border-radius: .4rem;
  text-decoration: none; font-weight: 700; font-size: .9rem; color: var(--muted); background: var(--surface);
}
.tabs .tab.active { background: var(--navy); color: #fff; border-color: var(--navy); }
.tabs .tab:hover:not(.active) { background: #eef1f4; }
/* Flash: jednokratni prikaz sirovog API ključa */
.flash { background: #FFF8E1; border: 1px solid #F5DEB8; border-radius: .5rem; padding: 1rem; margin-bottom: 1.25rem; }
.flash .key {
  display: block; margin: .6rem 0 .3rem; padding: .55rem .7rem; background: var(--bg);
  border: 1px solid var(--border); border-radius: .4rem; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: .95rem; font-weight: 700; word-break: break-all; color: var(--navy);
}
/* Krediti + inline akcijske forme u tablici ključeva */
.credits { font-weight: 800; font-size: 1.05rem; }
.credits.pos { color: var(--success); }
.credits.zero { color: var(--danger); }
.keyact { display: inline-flex; gap: .3rem; align-items: center; margin: 0 .4rem .25rem 0; }
.cred-inp { width: 4.5rem; border: 1px solid var(--border); border-radius: .35rem; padding: .2rem .4rem; font-size: .82rem; font-family: inherit; }
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
<footer>pipeline.domovina.ai — ručna obrada proizvoljnog (i unlisted) YouTube videa kroz puni AI pipeline <span class="dim" style="white-space:nowrap;">· ${APP_VERSION}</span></footer>
</body></html>`;
}

// Potvrdna stranica kad se dodaje epizoda koja je VEĆ objavljena na domovina.ai
// (CDN artefakt članka postoji, iako u našem queueu nema aktivnog joba). Ne
// queueamo tiho duplikat — pokažemo link na postojeću epizodu + escape hatch
// "svejedno dodaj" (POST natrag s force=1) ako admin ipak želi ponovnu obradu.
export function renderAlreadyPublishedPage(opts: {
  youtubeId: string;
  siteBase: string;
  rawUrl: string;
  title: string | null;
  withMagisterium?: boolean;
}): string {
  const base = opts.siteBase.replace(/\/$/, '');
  const liveUrl = `${base}/v/${opts.youtubeId}`;
  const body = `
<h1>Epizoda je već objavljena na domovina.ai</h1>
<p>Video <span class="mono">${escapeHtml(opts.youtubeId)}</span> je već prošao pipeline —
članak i artefakti postoje na CDN-u, pa je epizoda dostupna. Nema je smisla ponovno
obrađivati (troši resurse i ne mijenja rezultat).</p>
<div class="ytprev" style="margin:1rem 0;">
  <img src="https://i.ytimg.com/vi/${escapeHtml(opts.youtubeId)}/mqdefault.jpg" alt="">
  <div class="ytprev-meta">
    <div class="ytprev-title">${escapeHtml(opts.title || opts.youtubeId)}</div>
    <a class="ytprev-link" href="${escapeHtml(liveUrl)}" target="_blank" rel="noopener">▶ otvori na domovina.ai</a>
  </div>
</div>
<p style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;">
  <a class="tab" href="/admin">← natrag na queue</a>
  <form method="POST" action="/admin/jobs" style="margin:0;">
    <input type="hidden" name="url" value="${escapeHtml(opts.rawUrl)}">
    <input type="hidden" name="title" value="${escapeHtml(opts.title || '')}">
    <input type="hidden" name="force" value="1">
    <input type="hidden" name="mag_present" value="1">
    ${opts.withMagisterium === false ? '' : '<input type="hidden" name="with_magisterium" value="1">'}
    <button class="act a-requeue" type="submit">Svejedno dodaj u queue (ponovna obrada)</button>
  </form>
</p>`;
  return layout('DOMOVINA Pipeline — epizoda već postoji', body);
}

export function statePill(state: string): string {
  const cls =
    state === 'done' ? 'ok' : state === 'failed' ? 'bad' : state === 'queued' ? 'neutral' : 'warn';
  return `<span class="pill ${cls}">${state}</span>`;
}

// Navigacijski tabovi između queue i API-ključeva stranica.
function navTabs(active: 'queue' | 'keys'): string {
  const tab = (href: string, id: string, label: string) =>
    `<a class="tab${active === id ? ' active' : ''}" href="${href}">${label}</a>`;
  return `<nav class="tabs">${tab('/admin', 'queue', 'Queue')}${tab('/admin/keys', 'keys', 'API ključevi')}</nav>`;
}

// Glavna stranica: stats + forma za dodavanje + tablica (puni se JSON-om na klijentu).
export function renderJobsPage(): string {
  const body = `
${navTabs('queue')}
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
    <div class="field">
      <label class="tieropt"><input type="checkbox" name="priority" value="1"> ⚡ Prioritet (Modal instant fast-path)</label>
    </div>
    <div class="field">
      <input type="hidden" name="mag_present" value="1">
      <label class="tieropt"><input type="checkbox" name="with_magisterium" value="1" checked> 🕊 Magisterium AI (teološko obogaćivanje — KORAK 8.5)</label>
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
  <div class="hint">Public ili unlisted — svejedno. Video se obradi identično, ostaje neindeksiran, dostupan samo na <span class="mono">domovina.ai/v/{id}</span>. <em>Preview (naslov/kanal/thumbnail) radi i za unlisted; trajanje stiže nakon downloada. Bez previewa su samo private/obrisani videi.</em></div>
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
// ── Auto-prefill naslova iz YouTube oEmbed-a (bez API ključa, CORS OK).
// Radi za public I unlisted (oba vraćaju 200 — unlisted je embeddable). Samo
// private/obrisani vrate 401/404 → tiho preskočimo; bridge svejedno backfilla iz info.json.
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
      if (!r.ok) { if (prev) prev.hidden = true; return; }   // 401/404 (private/obrisan) → bez previewa
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
function btn(id,action,label,title){ return '<button class="act a-'+action+'" data-id="'+esc(id)+'" data-act="'+action+'"'+(title?' title="'+esc(title)+'"':'')+'>'+label+'</button>'; }
// Magisterium (re)obrada gumbi po jobu:
//  - ne-done  → toggle NAMJERE (utječe na status "čeka" vs "preskočeno" + cron auto-enqueue)
//  - done     → one-click POKRETANJE (re)obrade HR/EN (bridge poller pokupi zahtjev); dok je
//               zahtjev queued/running gumb se sakrije (badge u meta čeliji pokazuje stanje).
function magActions(j){
  var b = [];
  if (j.state==='done') {
    var hrBusy = j.mag_hr_state==='queued' || j.mag_hr_state==='running';
    var enBusy = j.mag_en_state==='queued' || j.mag_en_state==='running';
    if (!hrBusy) b.push(btn(j.id,'magisterium-hr','🕊 Mag HR', j.mag_hr_state==='done'?'Ponovno obradi Magisterium HR':'Pokreni Magisterium HR obradu'));
    if (!enBusy) b.push(btn(j.id,'magisterium-en','🕊 Mag EN', j.mag_en_state==='done'?'Ponovno obradi Magisterium EN overlay':'Pokreni Magisterium EN overlay'));
  } else {
    b.push(j.with_magisterium
      ? btn(j.id,'mag-off','🕊 Mag ✓','Magisterium UKLJUČEN za ovaj video — klik za isključi')
      : btn(j.id,'mag-on','🕊 Mag ✗','Magisterium ISKLJUČEN za ovaj video — klik za uključi'));
  }
  return b;
}
function actions(j){
  var b = [];
  if (j.deleted_at) {   // soft-deleted: samo vrati ili trajno obriši
    b.push(btn(j.id,'restore','↩ Vrati'));
    b.push(btn(j.id,'purge','🗑 Trajno'));
    return b.join('');
  }
  if (j.state==='queued') { if (!j.priority) b.push(btn(j.id,'prioritize','⚡ Prioritet','Sponzoriraj instant obradu (Modal) — besplatno, radi i za API jobove')); b.push(btn(j.id,'skip','Skip')); b.push(btn(j.id,'postpone','Odgodi')); }
  if (j.state==='skipped'||j.state==='postponed'||j.state==='failed') b.push(btn(j.id,'requeue','↻ U queue'));
  b = b.concat(magActions(j));
  b.push(btn(j.id,'delete','✕'));
  return b.join('');
}

// Izvor zahtjeva: badge koji pokazuje TKO je predao job — API ključ (ime, iz
// /dashboard ili programatski) vs ručno iz /admin. Vizualno razlikuje kanale unosa.
function srcBadge(j){
  if (j.source==='api') return '<span class="pill src-api" title="Predano preko API ključa (dashboard/programatski)">🔑 '+esc(j.api_key_name||'API ključ')+'</span>';
  if (j.source==='admin') return '<span class="pill src-admin" title="Ručno dodano iz /admin">admin</span>';
  if (j.source==='bridge') return '<span class="pill neutral" title="Bridge">bridge</span>';
  if (j.source==='import') return '<span class="pill src-import" title="Već objavljeno — uvezeno u listu ključa (nije naplaćeno)">↧ uvezeno'+(j.api_key_name?' · '+esc(j.api_key_name):'')+'</span>';
  return j.source ? '<span class="pill neutral">'+esc(j.source)+'</span>' : '';
}
// Prioritet tier: ⚡ badge na prioritetnim jobovima (Modal instant put).
function priorityBadge(j){
  return j.priority ? ' <span class="pill prio" title="Prioritetna obrada (Modal, odmah)">⚡ Prioritet</span>' : '';
}
// Transkripcijski lock: koji backend (modal/colab) trenutno drži transkripciju ovog videa.
// Prazno kad nema claima (NULL) — staro ponašanje. Nestaje kad job dođe u done/failed.
function transcribeBadge(j){
  if (j.transcribe_backend==='modal') return ' <span class="pill tb-modal" title="Transkribira Modal (serverless GPU)'+(j.transcribe_claimed_at?' · zauzeto '+fmt(j.transcribe_claimed_at):'')+'">⚡ Modal</span>';
  if (j.transcribe_backend==='colab') return ' <span class="pill tb-colab" title="Transkribira Colab Canary batch'+(j.transcribe_claimed_at?' · zauzeto '+fmt(j.transcribe_claimed_at):'')+'">🧪 Colab</span>';
  return '';
}
// Magisterium (re)obrada stanje po jeziku — badge u meta čeliji (kad postoji zahtjev u queueu).
// wait=queued (čeka pollera), run=running (poller obrađuje), done=gotovo, failed=greška.
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
// Status čelija = pill + očit "koraci" gumb koji otvara per-korak pipeline prikaz ispod retka.
function statusCell(j){
  var open = expandedId===j.id;
  return pill(j.state)+'<div><button class="pillbtn" data-jobid="'+esc(j.id)+'" aria-expanded="'+(open?'true':'false')+'" title="Prikaži korake pipelinea">'+(open?'▾':'▸')+' koraci</button></div>';
}
// Detail redak (colspan preko cijele tablice) — sadrži step-tracker, lazy-loadan.
function detailRow(j){
  return '<tr class="detail-row" data-detail="'+esc(j.id)+'"'+(expandedId===j.id?'':' hidden')+'>'+
    '<td colspan="6"><div class="steps-head">Pipeline koraci</div>'+
    '<div id="steps-'+esc(j.id)+'"><div class="steps-loading">Učitavam korake…</div></div></td></tr>';
}
function stepBadge(st){ return st==='done'?'gotovo':st==='skipped'?'preskočeno':'čeka'; }
function stepGlyph(st){ return st==='done'?'✓':st==='skipped'?'–':''; }
function renderSteps(steps){
  if (!steps || !steps.length) return '<div class="steps-loading">Nema podataka o koracima.</div>';
  return '<ul class="steps">'+steps.map(function(s){
    var cls = s.state;   // done | pending | skipped
    var link = s.url ? '<a class="s-open" href="'+esc(s.url)+'" target="_blank" rel="noopener" title="Otvori u novom tabu">↗ otvori</a>' : '';
    return '<li class="is-'+cls+'">'+
      '<span class="dot '+cls+'">'+stepGlyph(s.state)+'</span>'+
      '<div class="s-main"><div class="s-label">'+esc(s.label)+'</div><div class="s-note">'+esc(s.note)+'</div></div>'+
      link+
      '<span class="pill s-badge '+cls+'">'+stepBadge(s.state)+'</span>'+
    '</li>';
  }).join('')+'</ul>';
}
async function loadSteps(id){
  var host = document.getElementById('steps-'+id);
  if (!host) return;
  try {
    var r = await fetch('/admin/api/jobs/'+id+'/pipeline', { headers: { 'accept':'application/json' } });
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
    b.setAttribute('aria-expanded', on ? 'true':'false');
    b.textContent = (on?'▾':'▸')+' koraci';
  });
  if (expandedId) loadSteps(expandedId);
}

// Paging/filter stanje
var expandedId='', pState='', pQ='', pLimit=50, pOffset=0, pTotal=0;
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
      '<div class="stat s-'+s+'"><div class="label">'+s+'</div><div class="value">'+(counts[s]||0)+'</div></div>'
    ).join('');
    const rows = (data.jobs||[]).map(j => {
      const vid = '<div class="vidcell">'+thumb(j.youtube_id)+'<a class="mono" href="https://youtu.be/'+esc(j.youtube_id)+'" target="_blank" rel="noopener">'+esc(j.youtube_id)+'</a></div>';
      const sub = [j.channel?esc(j.channel):'', j.duration_seconds?dur(j.duration_seconds):''].filter(Boolean).join(' · ');
      const meta = '<div>'+esc(j.title||'(bez naslova)')+'</div>'+(sub?'<div class="dim sub">'+sub+'</div>':'')+'<div class="sub">'+srcBadge(j)+priorityBadge(j)+transcribeBadge(j)+magStateBadge(j)+'</div>';
      const res = j.detail_url ? '<a href="'+esc(j.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'
                : (j.state==='failed' && j.error ? '<span class="dim">'+esc(j.error).slice(0,80)+'</span>' : '<span class="dim">—</span>');
      var row = '<tr'+(j.deleted_at?' class="deleted"':'')+'><td class="dim">'+fmt(j.created_at)+'</td><td>'+vid+'</td><td>'+meta+'</td><td>'+statusCell(j)+'</td><td>'+res+'</td><td>'+actions(j)+'</td></tr>';
      return row + detailRow(j);
    }).join('');
    const shown = (data.jobs||[]).length;
    document.getElementById('rows').innerHTML = rows || '<tr><td colspan="6" class="empty">'+((pState||pQ)?'Nema rezultata za filter.':'Nema jobova još. Dodaj prvi gore.')+'</td></tr>';
    // Pager
    document.getElementById('pInfo').textContent = pTotal ? ((pOffset+1)+'–'+(pOffset+shown)+' od '+pTotal) : 'nema zapisa';
    document.getElementById('pPrev').disabled = pOffset <= 0;
    document.getElementById('pNext').disabled = pOffset + pLimit >= pTotal;
    document.getElementById('updated').textContent = 'osvježeno ' + new Date().toLocaleTimeString('hr-HR');
    // Ako je neki redak otvoren, re-loadaj njegove korake (rows innerHTML je upravo prepisan).
    if (expandedId && document.getElementById('steps-'+expandedId)) loadSteps(expandedId);
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
  const tog = e.target.closest('button.pillbtn');
  if (tog) { toggleSteps(tog.dataset.jobid); return; }
  const b = e.target.closest('button.act');
  if (b) { b.classList.add('busy'); act(b.dataset.id, b.dataset.act); }
});
refresh();
setInterval(refresh, 10000);
</script>`;
  return layout('DOMOVINA Pipeline — queue', body);
}

// Kratki UTC prikaz vremena za server-rendered tablice (bez klijentskog JS-a).
function fmtTs(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

// Stranica za upravljanje API ključevima (server-rendered, forme → redirect).
// `flash` se postavi nakon kreiranja da se sirovi ključ pokaže jednom.
export function renderKeysPage(keys: ApiKeyRow[], flash?: { rawKey: string; name: string }): string {
  const flashHtml = flash
    ? `<div class="flash">
    <strong>Ključ „${escapeHtml(flash.name)}" kreiran.</strong> Spremi ga sad — neće biti ponovno prikazan.
    <code class="key">${escapeHtml(flash.rawKey)}</code>
    <div class="dim">Pohranjuje se samo SHA-256 hash; sirovi ključ se kasnije ne može dohvatiti.</div>
  </div>`
    : '';

  const rows = keys
    .map((k) => {
      const status = k.enabled
        ? '<span class="pill ok">aktivan</span>'
        : '<span class="pill bad">onemogućen</span>';
      const toggle = k.enabled
        ? `<form method="POST" action="/admin/keys/${k.id}/disable" class="keyact"><button class="act a-skip">Onemogući</button></form>`
        : `<form method="POST" action="/admin/keys/${k.id}/enable" class="keyact"><button class="act a-requeue">Omogući</button></form>`;
      return `<tr>
      <td>${escapeHtml(k.name)}<div class="dim sub mono">${escapeHtml(k.key_hash.slice(0, 12))}…</div></td>
      <td><span class="credits ${k.credits > 0 ? 'pos' : 'zero'}">${k.credits}</span></td>
      <td>${status}</td>
      <td class="dim">${fmtTs(k.created_at)}</td>
      <td class="dim">${fmtTs(k.last_used_at)}</td>
      <td>
        <form method="POST" action="/admin/keys/${k.id}/credits" class="keyact">
          <input type="number" name="amount" value="10" step="1" class="cred-inp" aria-label="iznos kredita (negativno = oduzmi)">
          <button class="act a-requeue">Primijeni</button>
        </form>
        ${toggle}
        <form method="POST" action="/admin/keys/${k.id}/delete" class="keyact" onsubmit="return confirm('Trajno obrisati API ključ „${escapeHtml(k.name)}\\"? Nepovratno.')"><button class="act a-delete">Obriši</button></form>
      </td>
    </tr>`;
    })
    .join('');

  const body = `
${navTabs('keys')}
<h1>API ključevi</h1>
${flashHtml}

<div class="addbox">
  <form method="POST" action="/admin/keys">
    <div class="field">
      <label for="kname">Naziv ključa</label>
      <input id="kname" name="name" placeholder="npr. Klijent X" required autofocus>
    </div>
    <div class="field">
      <label for="kcred">Početni krediti</label>
      <input id="kcred" name="credits" type="number" value="0" min="0" step="1">
    </div>
    <button type="submit"><span class="plus">+</span> Kreiraj ključ</button>
  </form>
  <div class="hint">1 kredit = 1 obrađeni video. Klijent šalje <span class="mono">Authorization: Bearer &lt;ključ&gt;</span> na <span class="mono">POST /api/v1/jobs</span>. Enqueue troši 1 kredit; bez kredita → HTTP 402. Kredite ovdje dopunjuješ/oduzimaš ručno (polje prima i negativan iznos).</div>
</div>

<div class="table-wrap">
  <table>
    <thead><tr>
      <th>Naziv</th><th>Krediti</th><th>Status</th><th>Kreiran</th><th>Zadnje korišteno</th><th>Akcije</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="empty">Još nema ključeva. Kreiraj prvi gore.</td></tr>'}</tbody>
  </table>
</div>`;
  return layout('DOMOVINA Pipeline — API ključevi', body);
}
