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
import {
  ARTICLE_MODELS,
  DEFAULT_ARTICLE_MODEL,
  DEFAULT_MAGISTERIUM_MODEL,
  MAGISTERIUM_MODELS,
} from '../types';
import { escapeHtml } from '../util';

// Verzija aplikacije — BUMPAJ prije svakog redeploya (semver). Prikazuje se u
// footeru svih stranica (admin + dashboard) da se na prvi pogled zna koji je
// build live. Podudaraj s "version" u package.json.
export const APP_VERSION = 'v0.13.0';

// <option> lista za izbor modela koraka 7+8. Katalog je jedan (types.ts) — UI ga samo
// renderira, pa se nova/uklonjena opcija ne mora održavati na dva mjesta.
function articleModelOptions(selected: string): string {
  return ARTICLE_MODELS.map(
    (o) =>
      `<option value="${escapeHtml(o.value)}"${o.value === selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
  ).join('');
}

function magisteriumModelOptions(selected: string): string {
  const LABEL: Record<string, string> = {
    opus: 'Claude Opus — default (najviša kvaliteta)',
    sonnet: 'Claude Sonnet',
    haiku: 'Claude Haiku',
  };
  return MAGISTERIUM_MODELS.map(
    (m) =>
      `<option value="${m}"${m === selected ? ' selected' : ''}>${escapeHtml(LABEL[m] ?? m)}</option>`,
  ).join('');
}

// Katalog serijaliziran za klijentski JS (selecti u retcima tablice se renderiraju tamo).
const MODEL_CATALOG_JSON = JSON.stringify({
  article: ARTICLE_MODELS.map((o) => ({
    value: o.value,
    label: o.label,
    short: o.short,
    hint: o.hint,
  })),
  magisterium: MAGISTERIUM_MODELS,
  defaults: { article: DEFAULT_ARTICLE_MODEL, magisterium: DEFAULT_MAGISTERIUM_MODEL },
});

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
  --navy: #002F6C; --navy-h: #01418F; --red: #FF0000;
  --ink: #13253C; --muted: #5B6B7C; --faint: #93A0AF;
  --border: #E3E8EF; --border-strong: #C9D4E0;
  --surface: #F1F4F9; --bg: #FFFFFF; --card: #FFFFFF; --page: #F4F6FA;
  --success: #2E8540; --warning: #B45309; --danger: #B42318;
  --radius: 14px; --radius-sm: 10px;
  --shadow-sm: 0 1px 2px rgba(16,32,54,.05), 0 1px 3px rgba(16,32,54,.07);
  --shadow-md: 0 4px 12px -2px rgba(16,32,54,.08), 0 16px 36px -16px rgba(0,47,108,.18);
  --ring: 0 0 0 3px rgba(1,65,134,.14);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  color-scheme: light;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; padding: 0; background: var(--page); color: var(--ink); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
a { color: var(--navy-h); }
::selection { background: #CFE0F5; }
.tricolor { display: flex; height: 5px; }
.tricolor span { flex: 1; }
.tricolor .red { background: var(--red); }
.tricolor .navy { background: var(--navy); }
/* Sticky header s blagim blur efektom — chrome ostaje vidljiv pri scrollu */
header {
  position: sticky; top: 0; z-index: 40;
  padding: .7rem 1.5rem; border-bottom: 1px solid var(--border);
  background: rgba(255,255,255,.88); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
}
header .brand { display: flex; align-items: center; gap: .6rem; }
header .brand .word { font-weight: 800; letter-spacing: .04em; font-size: 1.05rem; color: var(--navy); white-space: nowrap; }
header .brand .accent { color: var(--red); }
header .badge {
  background: var(--surface); border: 1px solid var(--border);
  padding: .25rem .7rem; border-radius: 999px; font-size: .78rem;
  color: var(--muted); font-weight: 600; white-space: nowrap;
}
/* Širina sadržaja: FLUID je default (tablica s modelima traži horizontalni prostor).
   Klasa .contained na :root prebacuje na omeđeni stupac; postavlja je inline skripta
   u <head>-u iz localStoragea, PRIJE prvog painta, da nema bljeska pogrešne širine.
   NB: bez backticka u ovom komentaru — cijeli BASE_STYLE živi u template literalu. */
main { padding: 1.75rem 1.5rem 3rem; max-width: none; margin: 0; }
:root.contained main { max-width: 86rem; margin: 0 auto; }
/* Toggle u headeru — dva segmenta, aktivni je "utisnut". */
.widthtoggle { display: flex; gap: 0; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; background: var(--surface); }
.widthtoggle button {
  border: 0; background: transparent; color: var(--muted); cursor: pointer;
  font-family: inherit; font-size: .74rem; font-weight: 700; padding: .3rem .7rem;
  display: inline-flex; align-items: center; gap: .3rem; transition: background .12s, color .12s;
}
.widthtoggle button:hover { color: var(--navy); }
.widthtoggle button[aria-pressed="true"] { background: var(--card); color: var(--navy); box-shadow: inset 0 0 0 1px var(--border); }
header .headright { display: flex; align-items: center; gap: .6rem; }
h1 { font-size: 1.4rem; font-weight: 800; letter-spacing: -.01em; color: var(--navy); margin: 0 0 1.1rem; }
/* Stat-kartice: bijele s bočnom akcent trakom u boji stanja (auto-fill drži karticu kompaktnom i kad ih je malo) */
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.75rem, 1fr)); gap: .7rem; margin-bottom: 1.4rem; }
.stat {
  position: relative; overflow: hidden; min-width: 0;
  background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: .7rem .95rem .75rem; box-shadow: var(--shadow-sm);
}
.stat::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--border-strong); }
.stat .label {
  font-size: .68rem; color: var(--muted); text-transform: uppercase;
  letter-spacing: .07em; font-weight: 700;
}
.stat .value { font-size: 1.5rem; font-weight: 800; margin-top: .1rem; line-height: 1.15; font-variant-numeric: tabular-nums; }
.stat.s-queued::before { background: #1D4ED8; }
.stat.s-queued .value { color: #1D4ED8; }
.stat.s-fetching::before,
.stat.s-transcribing::before,
.stat.s-processing::before { background: #D97706; }
.stat.s-fetching .value,
.stat.s-transcribing .value,
.stat.s-processing .value { color: #B45309; }
.stat.s-done::before { background: var(--success); }
.stat.s-done .value { color: var(--success); }
.stat.s-failed::before { background: var(--danger); }
.stat.s-failed .value { color: var(--danger); }
.stat.s-skipped::before { background: #94A3B8; }
.stat.s-skipped .value { color: #5A6570; }
.stat.s-postponed::before { background: #7C3AED; }
.stat.s-postponed .value { color: #7C3AED; }
/* Enqueue kartica */
.addbox {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.1rem 1.2rem 1.15rem; margin-bottom: 1.4rem; box-shadow: var(--shadow-sm);
}
.addbox form { display: flex; flex-direction: column; gap: .8rem; align-items: stretch; }
.addbox .field { display: flex; flex-direction: column; gap: .3rem; }
.addbox label { font-size: .72rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
.addbox input:not([type=checkbox]):not([type=radio]) {
  border: 1px solid var(--border); border-radius: .6rem; padding: .6rem .8rem;
  font-size: .95rem; font-family: inherit; background: var(--bg); color: var(--ink);
  width: 100%; transition: border-color .15s, box-shadow .15s;
}
.addbox input::placeholder { color: var(--faint); }
.addbox input:focus { outline: none; border-color: var(--navy-h); box-shadow: var(--ring); }
.addbox input[type=checkbox], .addbox input[type=radio] { accent-color: var(--navy-h); width: 1rem; height: 1rem; flex: none; }
.addbox button {
  border: 0; border-radius: .65rem; padding: .65rem 1.3rem; font-size: .95rem;
  font-weight: 700; cursor: pointer; color: #fff;
  background: linear-gradient(180deg, #0B4C9E 0%, var(--navy) 100%);
  box-shadow: 0 1px 2px rgba(0,47,108,.4), inset 0 1px 0 rgba(255,255,255,.14);
  align-self: flex-start; display: inline-flex; align-items: center; gap: .5rem;
  transition: transform .12s, box-shadow .15s, filter .15s;
}
.addbox button:hover { filter: brightness(1.1); box-shadow: 0 3px 10px rgba(0,47,108,.3), inset 0 1px 0 rgba(255,255,255,.14); }
.addbox button:active { transform: translateY(1px); }
/* Bijeli "+" — emoji ➕ ignorira CSS color (ostaje tamno siv na navy); plain glyph nasljeđuje #fff */
.addbox button .plus { color: #fff; font-weight: 900; font-size: 1.15em; line-height: 1; }
.addbox .hint { font-size: .8rem; color: var(--muted); margin-top: .6rem; line-height: 1.45; }
/* Izbor modela: dva selecta jedan uz drugi (na uskom ekranu se slažu jedan ispod drugog). */
.modelrow { display: flex; gap: .9rem; flex-wrap: wrap; }
.modelrow .field { flex: 1 1 18rem; min-width: 0; }
.addbox select {
  border: 1px solid var(--border); border-radius: .6rem; padding: .55rem .7rem;
  font-size: .9rem; font-family: inherit; background: var(--bg); color: var(--ink);
  width: 100%; cursor: pointer; transition: border-color .15s, box-shadow .15s;
}
.addbox select:focus { outline: none; border-color: var(--navy-h); box-shadow: var(--ring); }
.modelhint { font-size: .76rem; color: var(--muted); line-height: 1.4; min-height: 1.05rem; }
.modelhint.warn { color: #92400E; }
/* Stupac AKCIJE nosi gumbe + dva selecta; bez poda se stisne i sve se prelomi ružno.
   Roditelj .table-wrap ima overflow-x:auto, pa se u najgorem slučaju dobije horizontalni
   scroll umjesto kropanja. Naslov je jedini stupac koji smije rasti. */
td[data-l="Akcije"], th.col-akcije { min-width: 23rem; }
td[data-l="Naslov"] { min-width: 18rem; }
td[data-l="Video"], td[data-l="Dodano"], td[data-l="Status"], td[data-l="Rezultat"] { white-space: nowrap; }
/* Gumbi i selecti u jednom retku, s urednim prelomom kad ponestane mjesta. */
td[data-l="Akcije"] .actwrap { display: flex; flex-wrap: wrap; gap: .25rem; align-items: center; }
td[data-l="Akcije"] .actwrap .act { margin: 0; }
td[data-l="Akcije"] .modelwrap { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .35rem; }
/* Kompaktni select unutar retka tablice (promjena modela na postojećem jobu). */
select.modelsel {
  border: 1px solid var(--border); background: var(--card); color: var(--navy);
  border-radius: .5rem; padding: .24rem .4rem; font-size: .74rem; font-weight: 600;
  font-family: inherit; cursor: pointer; margin: 0;
  max-width: 13rem;
}
select.modelsel:focus { outline: none; border-color: var(--navy-h); box-shadow: var(--ring); }
select.modelsel.mag { color: #4338CA; border-color: #DDD6FE; }
/* Badge koji u meta čeliji pokazuje kojim modelom je job konfiguriran. */
.pill.model { background: #EEF2FF; color: #4338CA; border: 1px solid #DDD6FE; text-transform: none; letter-spacing: 0; }
/* YouTube oEmbed preview (readonly) */
.ytprev { display: flex; gap: .8rem; align-items: center; margin-top: .8rem; padding: .6rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.ytprev img { width: 120px; height: 68px; object-fit: cover; border-radius: .45rem; flex: none; background: var(--border); }
.ytprev-meta { min-width: 0; }
.ytprev-title { font-weight: 700; font-size: .92rem; line-height: 1.3; }
.ytprev-sub { font-size: .83rem; margin-top: .15rem; }
.ytprev-link { font-size: .82rem; display: inline-block; margin-top: .3rem; font-weight: 600; }
/* Akcijski gumbi u tablici */
button.act {
  border: 1px solid var(--border); background: var(--card); color: var(--navy);
  border-radius: .5rem; padding: .28rem .6rem; font-size: .78rem; font-weight: 600;
  cursor: pointer; margin-right: .25rem; margin-bottom: .25rem; font-family: inherit;
  transition: background .12s, border-color .12s, transform .1s;
}
button.act:hover { background: var(--surface); border-color: var(--border-strong); }
button.act.del { color: var(--danger); border-color: #f3c9c5; }
/* Video čelija u tablici: thumbnail + ID */
.vidcell { display: flex; align-items: center; gap: .6rem; min-width: 0; }
.rthumb { width: 88px; height: 50px; object-fit: cover; border-radius: .45rem; flex: none; background: var(--surface); border: 1px solid var(--border); }
td .sub { font-size: .8rem; margin-top: .2rem; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--card); box-shadow: var(--shadow-sm); }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th, td { text-align: left; padding: .6rem .85rem; border-bottom: 1px solid var(--surface); vertical-align: top; }
th { background: #F8FAFC; font-weight: 700; color: var(--muted); font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; white-space: nowrap; border-bottom: 1px solid var(--border); }
tbody tr:last-child td { border-bottom: 0; }
tbody tr { transition: background .12s; }
tbody tr:hover { background: #F8FAFC; }
.mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.dim { color: var(--muted); }
.pill { display: inline-block; padding: .16rem .58rem; border-radius: 999px; font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.pill.ok { background: #E0F1E5; color: var(--success); }
.pill.bad { background: #F8E2E0; color: var(--danger); }
.pill.warn { background: #FDF1E0; color: var(--warning); }
.pill.neutral { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
/* Izvor unosa: API ključ (naglašen) vs ručni admin unos */
.pill.src-api { background: #EEF2FF; color: #4338CA; border: 1px solid #DDD6FE; text-transform: none; letter-spacing: 0; }
.pill.src-admin { background: var(--surface); color: var(--muted); border: 1px solid var(--border); }
.pill.src-import { background: #F3E8FF; color: #7C3AED; border: 1px solid #E9D5FF; text-transform: none; letter-spacing: 0; }
.pill.src-x { background: #E8F5FE; color: #0F1419; border: 1px solid #C4E5FB; text-transform: none; letter-spacing: 0; }
/* Promoviran iz noćne podliste otkrivenih videa (/admin/discovered) */
.pill.src-disc { background: #FFFBEB; color: #92400E; border: 1px solid #FDE68A; text-transform: none; letter-spacing: 0; }
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
.tierpick { display: flex; flex-direction: column; gap: .45rem; }
label.tieropt {
  font-weight: 400; display: flex; align-items: flex-start; gap: .55rem; cursor: pointer;
  border: 1px solid var(--border); border-radius: .6rem; padding: .55rem .75rem;
  background: var(--bg); transition: border-color .15s, background .15s, box-shadow .15s;
  text-transform: none; letter-spacing: 0; font-size: .9rem; color: var(--ink); line-height: 1.4;
}
.tieropt input { margin-top: .18rem; }
.tieropt:hover { border-color: var(--border-strong); }
.tieropt:has(input:checked) { border-color: var(--navy-h); background: #F0F6FF; }
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
  font: inherit; cursor: pointer; border: 1px solid var(--border); background: var(--card);
  color: var(--navy); padding: .18rem .55rem; margin-top: .35rem; border-radius: .5rem;
  font-size: .76rem; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: .25rem;
  transition: background .12s, border-color .12s;
}
.pillbtn:hover { background: var(--surface); border-color: var(--border-strong); }
.pillbtn[aria-expanded="true"] { background: var(--navy); color: #fff; border-color: var(--navy); }
/* Expandable redak s koracima */
tr.detail-row > td { background: #F8FAFC; padding: .5rem 1rem 1rem; }
.steps-head { font-size: .76rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; margin: .3rem 0 .6rem; }
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
.steps .s-open { flex: none; font-size: .78rem; font-weight: 700; text-decoration: none; color: var(--navy); border: 1px solid var(--border); border-radius: .4rem; padding: .12rem .45rem; white-space: nowrap; background: var(--card); }
.steps .s-open:hover { border-color: var(--navy); }
.steps .s-badge { margin-left: .5rem; flex: none; }
.s-badge.done    { background: #E0F1E5; color: var(--success); }
.s-badge.pending { background: var(--card); color: var(--muted); border: 1px solid var(--border); }
.s-badge.skipped { background: #F3E8FF; color: #7C3AED; }
.steps-loading { color: var(--muted); font-size: .85rem; padding: .3rem 0; }
/* ── Vremenska traka obrade: početak / kraj / ukupno (iznad liste koraka) ── */
.timing { display: flex; gap: .5rem; flex-wrap: wrap; margin: .1rem 0 .55rem; }
.t-cell { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .4rem .7rem; min-width: 0; }
.t-label { font-size: .62rem; text-transform: uppercase; letter-spacing: .07em; font-weight: 800; color: var(--faint); }
.t-val { font-size: .86rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.t-cell.t-total { background: #F0F6FF; border-color: #CDDDF6; }
.t-cell.t-total .t-val { color: var(--navy); }
.timing-note { font-size: .72rem; color: var(--muted); margin: 0 0 .8rem; line-height: 1.45; }
/* Vrijeme objave koraka + Δ od prethodnog koraka */
.s-time { display: flex; gap: .45rem; align-items: center; margin-top: .18rem; flex-wrap: wrap; }
.s-when { font-size: .74rem; color: var(--faint); font-variant-numeric: tabular-nums; }
.s-delta { font-size: .74rem; font-weight: 700; color: #B45309; background: #FDF1E0; border: 1px solid #F5D9A8; border-radius: 999px; padding: .02rem .45rem; white-space: nowrap; }
.s-delta.reissue { color: var(--muted); background: var(--surface); border-color: var(--border); font-weight: 600; }
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
  border: 1px solid var(--border); border-radius: .55rem; padding: .45rem .65rem;
  font-size: .88rem; font-family: inherit; background: var(--card); color: var(--ink);
  transition: border-color .15s, box-shadow .15s;
}
.controls select:focus, .controls input:focus { outline: none; border-color: var(--navy-h); box-shadow: var(--ring); }
.controls .search { min-width: 14rem; }
.controls .spacer { flex: 1; }
.pager { display: flex; align-items: center; gap: .75rem; margin-top: .9rem; flex-wrap: wrap; }
.pager button {
  border: 1px solid var(--border); background: var(--card); color: var(--navy);
  border-radius: .55rem; padding: .4rem .9rem; font-size: .88rem; font-weight: 600; cursor: pointer;
  transition: background .12s, border-color .12s;
}
.pager button:hover:not(:disabled) { background: var(--surface); border-color: var(--border-strong); }
.pager button:disabled { opacity: .4; cursor: not-allowed; }
.pager .info { font-size: .85rem; color: var(--muted); }
.controls { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; margin-bottom: .85rem; }
.controls .auto { font-size: .8rem; color: var(--success); font-weight: 700; }
.empty { text-align: center; padding: 2rem; color: var(--muted); }
/* Tabovi (Queue / API ključevi) — segmentirana kontrola */
.tab {
  display: inline-block; padding: .42rem .95rem; border: 1px solid var(--border); border-radius: .55rem;
  text-decoration: none; font-weight: 700; font-size: .88rem; color: var(--muted); background: var(--card);
  transition: color .12s, background .12s, box-shadow .12s;
}
.tabs { display: inline-flex; gap: .25rem; margin-bottom: 1.2rem; background: #E9EDF3; border: 1px solid var(--border); border-radius: .75rem; padding: .25rem; }
.tabs .tab { border: 0; border-radius: .55rem; background: transparent; }
.tabs .tab.active { background: var(--card); color: var(--navy); box-shadow: var(--shadow-sm); }
.tabs .tab:hover:not(.active) { color: var(--navy); }
/* Flash: jednokratni prikaz sirovog API ključa */
.flash { background: #FFF8E1; border: 1px solid #F5DEB8; border-radius: var(--radius-sm); padding: 1rem; margin-bottom: 1.25rem; box-shadow: var(--shadow-sm); }
.flash .key {
  display: block; margin: .6rem 0 .3rem; padding: .55rem .7rem; background: var(--card);
  border: 1px solid var(--border); border-radius: .5rem; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: .95rem; font-weight: 700; word-break: break-all; color: var(--navy);
}
/* Krediti + inline akcijske forme u tablici ključeva */
.credits { font-weight: 800; font-size: 1.05rem; font-variant-numeric: tabular-nums; }
.credits.pos { color: var(--success); }
.credits.zero { color: var(--danger); }
.keyact { display: inline-flex; gap: .3rem; align-items: center; margin: 0 .4rem .25rem 0; }
.cred-inp { width: 4.5rem; border: 1px solid var(--border); border-radius: .45rem; padding: .25rem .45rem; font-size: .82rem; font-family: inherit; background: var(--card); color: var(--ink); }
.cred-inp:focus { outline: none; border-color: var(--navy-h); box-shadow: var(--ring); }
footer { margin: 2rem 0 0; padding: 1.1rem 1.5rem 1.4rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .8rem; text-align: center; background: var(--card); }
/* ── Mobile: tablice postaju kartice (data-l atribut na <td> = labela kolone) ── */
@media (max-width: 760px) {
  header { padding: .55rem 1rem; }
  header .badge { display: none; }
  main { padding: 1rem .9rem 2.25rem; }
  h1 { font-size: 1.2rem; }
  .stats { grid-template-columns: repeat(2, 1fr); gap: .55rem; }
  .stat { padding: .6rem .8rem .65rem; }
  .stat .value { font-size: 1.3rem; }
  .addbox { padding: .95rem .95rem 1rem; }
  .addbox button { width: 100%; justify-content: center; }
  .controls { gap: .5rem; }
  .controls .search { flex: 1 1 100%; min-width: 0; }
  /* Tablica → kartice: thead nestaje, svaki <tr> je kartica, ::before nosi labelu kolone */
  .table-wrap { border: 0; border-radius: 0; background: transparent; box-shadow: none; overflow: visible; }
  table, tbody { display: block; width: 100%; }
  thead { display: none; }
  tbody tr {
    display: block; background: var(--card); border: 1px solid var(--border);
    border-radius: var(--radius-sm); box-shadow: var(--shadow-sm);
    padding: .3rem .85rem; margin-bottom: .7rem;
  }
  tbody tr:hover { background: var(--card); }
  tbody td { display: block; width: 100%; border-bottom: 1px solid var(--surface); padding: .6rem 0; }
  tbody tr td:last-child { border-bottom: 0; }
  /* Podovi širine stupaca vrijede SAMO za tablični prikaz — u kartici bi 23rem
     prelilo 390px ekran u horizontalni scroll. Isto i nowrap na uskim stupcima. */
  td[data-l] { min-width: 0; white-space: normal; }
  td[data-l="Akcije"] .modelwrap { margin-top: .4rem; }
  select.modelsel { max-width: 100%; flex: 1 1 8rem; padding: .4rem .5rem; font-size: .82rem; }
  td[data-l]::before {
    content: attr(data-l); display: block; font-size: .64rem; font-weight: 800;
    letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin-bottom: .3rem;
  }
  /* Detail (koraci) kartica se vizualno "lijepi" na karticu retka iznad */
  tr.detail-row { margin-top: -.75rem; border-top: 0; border-top-left-radius: 0; border-top-right-radius: 0; }
  tr.detail-row > td { margin: 0 -.85rem; width: calc(100% + 1.7rem); padding: .5rem .85rem .9rem; border-radius: 0 0 calc(var(--radius-sm) - 1px) calc(var(--radius-sm) - 1px); }
  .rthumb { width: 104px; height: 59px; }
  .steps { max-width: 100%; }
  .steps li { flex-wrap: wrap; }
  .steps .s-badge { margin-left: auto; }
  /* Header na mobitelu: badge je dekorativan i prvi ide van da toggle stane u JEDAN
     redak (inače se labela prelomi ispod glifa i header naraste na dva reda). */
  header .badge { display: none; }
  .widthtoggle button { white-space: nowrap; padding: .35rem .6rem; }
  /* Veće touch mete */
  button.act { padding: .45rem .7rem; font-size: .84rem; }
  .pillbtn { padding: .35rem .6rem; }
  .pager { justify-content: center; }
  footer { padding: 1rem; }
}
@media (max-width: 400px) {
  header .brand .word { font-size: .95rem; }
  .keyact { flex-wrap: wrap; }
}
</style>`;

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="hr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>${BASE_STYLE}
<script>
// Primijeni spremljenu širinu PRIJE prvog painta (u <head>-u, prije <body>) — inače
// stranica bljesne fluid pa skoči u omeđeno. Default je fluid: samo eksplicitni
// 'contained' iz localStoragea dodaje klasu.
try { if (localStorage.getItem('dtvWidth') === 'contained') document.documentElement.classList.add('contained'); } catch (e) {}
</script>
</head><body>
<div class="tricolor"><span class="red"></span><span style="background:#fff"></span><span class="navy"></span></div>
<header>
  <div class="brand">${HEADER_LOGO_SVG}<span class="word">DOMOVINA<span class="accent"> Pipeline</span></span></div>
  <div class="headright">
    <div class="widthtoggle" role="group" aria-label="Širina prikaza">
      <button type="button" data-width="fluid" title="Puna širina ekrana">⇔ Fluid</button>
      <button type="button" data-width="contained" title="Omeđeni stupac (max 86rem)">▭ Omeđeno</button>
    </div>
    <span class="badge">ad-hoc pipeline queue</span>
  </div>
</header>
<main>${body}</main>
<footer>pipeline.domovina.ai — ručna obrada proizvoljnog (i unlisted) YouTube videa kroz puni AI pipeline <span class="dim" style="white-space:nowrap;">· ${APP_VERSION}</span></footer>
<script>
// Toggle širine. Dijeljen svim stranicama (admin + dashboard) jer živi u layoutu.
(function () {
  var root = document.documentElement;
  var btns = document.querySelectorAll('.widthtoggle button');
  function paint() {
    var mode = root.classList.contains('contained') ? 'contained' : 'fluid';
    btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.width === mode)); });
  }
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      root.classList.toggle('contained', b.dataset.width === 'contained');
      try { localStorage.setItem('dtvWidth', b.dataset.width); } catch (e) {}
      paint();
    });
  });
  paint();
})();
</script>
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
  articleModel?: string;
  magisteriumModel?: string;
  source?: 'youtube' | 'x';
}): string {
  const base = opts.siteBase.replace(/\/$/, '');
  const liveUrl = `${base}/v/${opts.youtubeId}`;
  // YouTube thumbnail postoji samo za YT; za X preskačemo (nema ekvivalenta po ID-u).
  const thumb =
    opts.source === 'x'
      ? ''
      : `<img src="https://i.ytimg.com/vi/${escapeHtml(opts.youtubeId)}/mqdefault.jpg" alt="">`;
  const body = `
<h1>Epizoda je već objavljena na domovina.ai</h1>
<p>Video <span class="mono">${escapeHtml(opts.youtubeId)}</span> je već prošao pipeline —
članak i artefakti postoje na CDN-u, pa je epizoda dostupna. Nema je smisla ponovno
obrađivati (troši resurse i ne mijenja rezultat).</p>
<div class="ytprev" style="margin:1rem 0;">
  ${thumb}
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
    <input type="hidden" name="article_model" value="${escapeHtml(opts.articleModel || '')}">
    <input type="hidden" name="magisterium_model" value="${escapeHtml(opts.magisteriumModel || '')}">
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

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// Stranica: live listing SVIH CDN artefakata jednog videa iz R2 bindinga
// (/admin/jobs/:id/files). Server-rendered redovi → data-l atributi obavezni
// za mobile kartice (vidi docs/UI.md).
export function renderJobFilesPage(opts: {
  jobId: string;
  youtubeId: string;
  title: string | null;
  cdnBase: string;
  groups: { label: string; prefix: string; files: { key: string; size: number; uploaded: string }[] }[];
}): string {
  const fmtUploaded = (iso: string) =>
    new Date(iso).toLocaleString('hr-HR', {
      timeZone: 'Europe/Zagreb',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const groupsHtml = opts.groups
    .map((g) => {
      const total = g.files.reduce((s, f) => s + f.size, 0);
      const rows = g.files
        .map((f) => {
          const rel = f.key.slice(g.prefix.length);
          const url = `${opts.cdnBase}/${f.key}`;
          return `<tr>
  <td data-l="Datoteka"><a class="mono" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(rel)}</a></td>
  <td data-l="Veličina" style="white-space:nowrap;">${humanSize(f.size)}</td>
  <td data-l="Uploadano" style="white-space:nowrap;">${escapeHtml(fmtUploaded(f.uploaded))}</td>
</tr>`;
        })
        .join('');
      const empty = `<tr><td colspan="3" class="dim">Nema datoteka pod ovim prefiksom.</td></tr>`;
      return `<div class="steps-head" style="margin-top:1.2rem;">${escapeHtml(g.label)}
  <span class="dim" style="text-transform:none;letter-spacing:0;font-weight:600;"> · ${g.files.length} ${g.files.length % 100 === 1 && g.files.length % 10 === 1 ? 'datoteka' : g.files.length % 10 >= 2 && g.files.length % 10 <= 4 && (g.files.length % 100 < 12 || g.files.length % 100 > 14) ? 'datoteke' : 'datoteka'} · ${humanSize(total)} · <span class="mono">${escapeHtml(g.prefix)}</span></span></div>
<table>
  <thead><tr><th>Datoteka</th><th>Veličina</th><th>Uploadano</th></tr></thead>
  <tbody>${rows || empty}</tbody>
</table>`;
    })
    .join('');

  const body = `
<h1>CDN datoteke — ${escapeHtml(opts.title || opts.youtubeId)}</h1>
<p style="display:flex; gap:.6rem; align-items:center; flex-wrap:wrap;">
  <a class="tab" href="/admin">← natrag na queue</a>
  <span class="mono dim">${escapeHtml(opts.youtubeId)}</span>
</p>
${groupsHtml}
<p class="dim" style="font-size:.8rem; margin-top:1rem;">Live listing iz R2 bucketa (ne curated lista ključeva) — vidi se stvarno stanje CDN-a, uključujući i naknadno dodane artefakte. Oprez: <span class="mono">video.mp4</span> / <span class="mono">video_h264.mp4</span> znaju imati stotine MB. JSON artefakti se serviraju s <span class="mono">immutable</span> cacheom — nakon regeneracije treba hard refresh.</p>`;
  return layout(`DOMOVINA Pipeline — datoteke ${opts.youtubeId}`, body);
}

// Navigacijski tabovi između queue, otkrivenih videa i API-ključeva.
function navTabs(active: 'queue' | 'discovered' | 'keys'): string {
  const tab = (href: string, id: string, label: string) =>
    `<a class="tab${active === id ? ' active' : ''}" href="${href}">${label}</a>`;
  return `<nav class="tabs">${tab('/admin', 'queue', 'Queue')}${tab('/admin/discovered', 'discovered', '🌙 Otkriveni')}${tab('/admin/keys', 'keys', 'API ključevi')}</nav>`;
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
      <input class="url mono" id="url" name="url" placeholder="YouTube (watch?v=… / -N3jzopLGc4) ili X (x.com/…/status/…)" required autofocus>
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
    <div class="modelrow">
      <div class="field">
        <label for="article_model">Model za sažetak + članak (koraci 7+8)</label>
        <select id="article_model" name="article_model">${articleModelOptions(DEFAULT_ARTICLE_MODEL)}</select>
        <div class="modelhint" id="article_model_hint"></div>
        <div class="modelhint warn">⚠ Vrijedi samo za <strong>⚡ prioritetne</strong> jobove — njih poller vrti kao zaseban single-video run. Standardni idu kroz noćni <em>batch</em> koji koracima 7+8 daje jedan globalni backend za sve epizode odjednom.</div>
      </div>
      <div class="field">
        <label for="magisterium_model">Model za Magisterium MCP (korak 8.5)</label>
        <select id="magisterium_model" name="magisterium_model">${magisteriumModelOptions(DEFAULT_MAGISTERIUM_MODEL)}</select>
        <div class="modelhint">Runbook ide kroz Claude Code CLI (Magisterium MCP alati) — Gemini ovdje nije opcija.</div>
      </div>
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
// thumb(j): za X nema ytimg thumbnail (sintetički id) → 𝕏 placeholder; inače ytimg.
function thumb(j){ if(j && j.source_platform==='x') return '<div class="rthumb" style="display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:#0f1419;background:#E8F5FE;">𝕏</div>'; var id = (j && j.youtube_id!==undefined) ? j.youtube_id : j; return '<img class="rthumb" loading="lazy" alt="" src="https://i.ytimg.com/vi/'+esc(id)+'/mqdefault.jpg">'; }
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
// Katalog modela iz types.ts (jedan izvor istine; ovdje samo renderiranje).
var MODELS = ${MODEL_CATALOG_JSON};
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
// Badge u meta čeliji: kojim je modelom job KONFIGURIRAN (7+8 i 8.5). Non-default izbor
// se ističe naglašeno — default (Gemini + Opus) se ne prikazuje da ne zatrpava redak.
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
// Kompaktni select u retku. kind='llm-model' (koraci 7+8) | 'mag-model' (korak 8.5).
// Koristi KRATKE oznake (o.short) — puni labeli iz forme se u retku samo kropaju.
function modelSel(j, kind, opts, current, title, cls){
  var o = opts.map(function(v){
    var label = kind==='mag-model' ? ('🕊 '+(MAG_MODEL_LABEL[v.value]||v.value)) : (v.short || v.label);
    return '<option value="'+esc(v.value)+'"'+(v.value===current?' selected':'')+'>'+esc(label)+'</option>';
  }).join('');
  return '<select class="modelsel'+(cls?' '+cls:'')+'" data-id="'+esc(j.id)+'" data-kind="'+kind+'" title="'+esc(title)+'">'+o+'</select>';
}
function modelSelects(j){
  var b = [];
  // Koraci 7+8 se mogu mijenjati samo dok članak još nije generiran — nakon 'done'
  // promjena ne bi ništa pokrenula (ponovna generacija je zaseban put).
  if (j.state!=='done' && j.state!=='failed') {
    // Bez ⚡ prioriteta job ide kroz noćni BATCH run (jedan --gemini-backend za sve
    // epizode odjednom) — per-video izbor tamo nema efekta. Reci to u tooltipu.
    b.push(modelSel(j, 'llm-model', MODELS.article, articleValue(j),
      j.priority
        ? 'Model za sažetak + članak (koraci 7+8)'
        : 'Model za sažetak + članak — NEMA efekta bez ⚡ prioriteta (noćni batch koristi jedan globalni backend)'));
  }
  // Magisterium model vrijedi UVIJEK — na done jobovima ga koriste gumbi 🕊 Mag HR/EN,
  // na ostalima cron auto-enqueue kad job dođe u done.
  var magOpts = MODELS.magisterium.map(function(m){ return { value:m, label:m }; });
  b.push(modelSel(j, 'mag-model', magOpts, j.magisterium_model || MODELS.defaults.magisterium,
    'Model za Magisterium MCP (korak 8.5) — vrijedi za sljedeći zahtjev', 'mag'));
  return b.join('');
}
function actions(j){
  var b = [];
  if (j.deleted_at) {   // soft-deleted: samo vrati ili trajno obriši
    b.push(btn(j.id,'restore','↩ Vrati'));
    b.push(btn(j.id,'purge','🗑 Trajno'));
    return '<div class="actwrap">'+b.join('')+'</div>';
  }
  if (j.state==='queued') { if (!j.priority) b.push(btn(j.id,'prioritize','⚡ Prioritet','Sponzoriraj instant obradu (Modal) — besplatno, radi i za API jobove')); b.push(btn(j.id,'skip','Skip')); b.push(btn(j.id,'postpone','Odgodi')); }
  if (j.state==='skipped'||j.state==='postponed'||j.state==='failed') b.push(btn(j.id,'requeue','↻ U queue'));
  b = b.concat(magActions(j));
  b.push(btn(j.id,'delete','✕'));
  // Dva reda: gumbi gore, selecti modela ispod — flex-wrap umjesto inline-blockova
  // koji su se prelamali nasred retka.
  return '<div class="actwrap">'+b.join('')+'</div><div class="modelwrap">'+modelSelects(j)+'</div>';
}

// Izvor zahtjeva: badge koji pokazuje TKO je predao job — API ključ (ime, iz
// /dashboard ili programatski) vs ručno iz /admin. Vizualno razlikuje kanale unosa.
function srcBadge(j){
  if (j.source==='api') return '<span class="pill src-api" title="Predano preko API ključa (dashboard/programatski)">🔑 '+esc(j.api_key_name||'API ključ')+'</span>';
  if (j.source==='admin') return '<span class="pill src-admin" title="Ručno dodano iz /admin">admin</span>';
  if (j.source==='x-admin') return '<span class="pill src-x" title="X (Twitter) post — ručno dodano iz /admin">𝕏 admin</span>';
  if (j.source==='x-api') return '<span class="pill src-x" title="X (Twitter) post — predano preko API ključa">𝕏 '+esc(j.api_key_name||'API ključ')+'</span>';
  if (j.source==='bridge') return '<span class="pill neutral" title="Bridge">bridge</span>';
  if (j.source==='discovered') return '<span class="pill src-disc" title="Promoviran iz noćne podliste otkrivenih videa">🌙 otkriveno</span>';
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
    '<td colspan="6"><div class="steps-head">Pipeline koraci'+
    ' <a class="s-open" style="text-transform:none;letter-spacing:0;margin-left:.5rem;" href="/admin/jobs/'+esc(j.id)+'/files" title="Live listing svih CDN artefakata ovog videa (R2)">📁 sve datoteke</a></div>'+
    '<div id="steps-'+esc(j.id)+'"><div class="steps-loading">Učitavam korake…</div></div></td></tr>';
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
// Kad job timestampova nema (video iz redovnog kanalnog puta), padamo na raspon objave artefakata.
function renderTiming(t){
  if (!t) return '';
  var cells = [];
  if (t.queued_at)  cells.push(['U queue', fmtAt(t.queued_at), '']);
  if (t.start_at)   cells.push(['Početak', fmtAt(t.start_at), '']);
  if (t.end_at)     cells.push(['Kraj', fmtAt(t.end_at), '']);
  if (t.total_seconds !== null && t.total_seconds !== undefined) cells.push(['Ukupno', fmtDur(t.total_seconds), 'total']);
  // Job prozor (claim → gotovo) je UŽI od ukupnog kad koraci trče izvan njega — Magisterium
  // se pokreće tek nakon što je job 'done'. Prikazujemo ga zasebno i samo kad se razlikuje,
  // da se ne pomiješa s headline brojem (upravo ta zamjena je davala "Ukupno 9 min" uz "+36 min").
  if (t.job_seconds !== null && t.job_seconds !== undefined && t.job_seconds !== t.total_seconds) {
    cells.push(['Od toga job', fmtDur(t.job_seconds), '']);
  }
  if (!cells.length) return '';
  var strip = '<div class="timing">'+cells.map(function(c){
    return '<div class="t-cell'+(c[2]==='total'?' t-total':'')+'"><div class="t-label">'+esc(c[0])+'</div><div class="t-val">'+esc(c[1])+'</div></div>';
  }).join('')+'</div>';
  return strip+'<div class="timing-note">Vrijeme uz korak je <strong>trenutak objave njegovog artefakta na CDN-u</strong> (Last-Modified), a Δ je razmak do prethodnog koraka — u njega ulazi i čekanje (npr. na Colab batch), ne samo računanje. „Ukupno" je raspon od prvog do zadnjeg koraka; „Od toga job" je uži prozor u kojem je bridge držao job (Magisterium i naknadni koraci trče izvan njega).</div>';
}
// Potrošnja tokena iz Claude Code headless sesija za ovaj video (Magisterium MCP runbook,
// --gemini-backend claude). Namjerno BEZ prikaza u dolarima: ti runovi idu pod pretplatom,
// ne per-token naplatom, pa bi "$X" implicirao trošak kojeg nema.
function fmtTok(n){
  if (!n) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(n >= 10000000 ? 0 : 1)+'M';
  if (n >= 1000) return Math.round(n/1000)+'k';
  return String(n);
}
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
function renderSteps(steps, timing, tokens){
  if (!steps || !steps.length) return '<div class="steps-loading">Nema podataka o koracima.</div>';
  return renderTiming(timing)+renderTokensAfter(steps, tokens);
}
// Koraci pa tokeni ispod njih (tokeni su dodatak, ne dio lanca koraka).
function renderTokensAfter(steps, tokens){
  return renderStepList(steps)+renderTokens(tokens);
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
async function loadSteps(id){
  var host = document.getElementById('steps-'+id);
  if (!host) return;
  try {
    var r = await fetch('/admin/api/jobs/'+id+'/pipeline', { headers: { 'accept':'application/json' } });
    if (!r.ok) { host.innerHTML = '<div class="steps-loading">Greška pri dohvatu koraka.</div>'; return; }
    var data = await r.json();
    host.innerHTML = renderSteps(data.steps, data.timing, data.tokens);
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
// Promjena modela na postojećem jobu (select u retku). Vrijednost ide u JSON body —
// ruta validira protiv kataloga i vraća 400 za nepoznat model.
async function setModel(id, kind, value){
  try {
    const r = await fetch('/admin/jobs/'+id+'/'+kind, {
      method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ value: value })
    });
    if (!r.ok) { const j = await r.json().catch(function(){ return {}; }); alert('Nije spremljeno: '+(j.error||r.status)); }
  } catch(e) { alert('Mrežna greška.'); }
  refresh();
}
async function refresh(){
  // Auto-refresh prepisuje cijeli <tbody>. Ako je select u retku otvoren/fokusiran,
  // preskoči tick — inače izbor nestane korisniku ispod prsta usred biranja.
  var af = document.activeElement;
  if (af && af.tagName === 'SELECT' && af.closest('#rows')) return;
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
      // Izvor link: X → source_url (originalni post); YouTube → youtu.be. Sintetički
      // youtube_id se za X NE koristi kao link (nije pravi YT video).
      const isX = j.source_platform === 'x';
      const srcHref = j.source_url ? esc(j.source_url) : (isX ? '' : 'https://youtu.be/'+esc(j.youtube_id));
      const srcLabel = isX ? (j.source_url ? esc(j.source_url) : '𝕏 '+esc(j.youtube_id)) : esc(j.youtube_id);
      const srcAnchor = srcHref
        ? '<a class="mono" href="'+srcHref+'" target="_blank" rel="noopener" title="'+(isX?'Izvorni X post':'Izvorni YouTube video')+'">'+(isX?'𝕏 ':'')+srcLabel+'</a>'
        : '<span class="mono dim">'+srcLabel+'</span>';
      const vid = '<div class="vidcell">'+thumb(j)+srcAnchor+'</div>';
      const sub = [j.channel?esc(j.channel):'', j.duration_seconds?dur(j.duration_seconds):''].filter(Boolean).join(' · ');
      const meta = '<div>'+esc(j.title||'(bez naslova)')+'</div>'+(sub?'<div class="dim sub">'+sub+'</div>':'')+'<div class="sub">'+srcBadge(j)+priorityBadge(j)+transcribeBadge(j)+magStateBadge(j)+modelBadge(j)+'</div>';
      const res = j.detail_url ? '<a href="'+esc(j.detail_url)+'" target="_blank" rel="noopener">▶ otvori</a>'
                : (j.state==='failed' && j.error ? '<span class="dim">'+esc(j.error).slice(0,80)+'</span>' : '<span class="dim">—</span>');
      // data-l = labela kolone za mobile karticu (CSS ::before)
      var row = '<tr'+(j.deleted_at?' class="deleted"':'')+'><td class="dim" data-l="Dodano">'+fmt(j.created_at)+'</td><td data-l="Video">'+vid+'</td><td data-l="Naslov">'+meta+'</td><td data-l="Status">'+statusCell(j)+'</td><td data-l="Rezultat">'+res+'</td><td data-l="Akcije">'+actions(j)+'</td></tr>';
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
// Selecti modela u retcima (data-kind = ruta: llm-model | mag-model).
document.getElementById('rows').addEventListener('change', function(e){
  const s = e.target.closest('select.modelsel');
  if (s) { s.blur(); setModel(s.dataset.id, s.dataset.kind, s.value); }
});
// Hint ispod selecta u formi za dodavanje — objasni što odabir znači (trošak/kvaliteta).
(function(){
  var sel = document.getElementById('article_model'), hint = document.getElementById('article_model_hint');
  if (!sel || !hint) return;
  function upd(){
    var o = MODELS.article.filter(function(x){ return x.value===sel.value; })[0];
    hint.textContent = o ? o.hint : '';
  }
  sel.addEventListener('change', upd);
  upd();
})();
refresh();
setInterval(refresh, 10000);
</script>`;
  return layout('DOMOVINA Pipeline — queue', body);
}

/**
 * "Otkriveni videi" — dnevne podliste onoga što je nightly SAM povukao.
 *
 * Namjerno odvojeno od /admin (queue obrade): ovdje ništa ne radi samo od sebe. Lista je
 * pregled ("evo što je sinoć stiglo"), a tek klik "⚡ Prioritet" stvori job i pokrene punu
 * prioritetnu obradu. Grupirano po danu otkrića da se na prvi pogled vidi dnevni priljev.
 */
export function renderDiscoveredPage(): string {
  const body = `
${navTabs('discovered')}
<h1>Otkriveni videi</h1>
<div class="stats" id="stats"></div>

<div class="addbox">
  <div class="hint" style="margin-top:0;">
    Ovo su videi koje je <strong>noćni pipeline sam pronašao i skinuo</strong> — po jedna podlista za svaki dan.
    Ništa se odavde ne obrađuje automatski: standardni put je i dalje Colab batch transkripcija pa noćna AI obrada.
    Klik na <strong>⚡ Prioritet</strong> stvara job u <a href="/admin">queueu</a> s prioritetom, pa ga poller
    na Mac Miniju odmah provuče kroz <em>punu</em> obradu (Modal transkripcija → diarizacija → članak → CDN),
    a <span class="mono">auto_reuse_adhoc</span> gotove artefakte vrati u kanal.
  </div>
  <div class="modelrow" style="margin-top:.9rem;">
    <div class="field">
      <label for="dArticleModel">Model za sažetak + članak (koraci 7+8)</label>
      <select id="dArticleModel">${articleModelOptions(DEFAULT_ARTICLE_MODEL)}</select>
    </div>
    <div class="field">
      <label for="dMagModel">Model za Magisterium MCP (korak 8.5)</label>
      <select id="dMagModel">${magisteriumModelOptions(DEFAULT_MAGISTERIUM_MODEL)}</select>
    </div>
  </div>
  <div class="hint" style="margin-top:.5rem;">Izbor vrijedi za <strong>sve</strong> ⚡ klikove na ovoj stranici (pojedinačne i „pošalji sve"). Već poslani jobovi zadržavaju model s kojim su stvoreni — mijenja se u <a href="/admin">queueu</a>. Sve odavde ide prioritetno (single-video run), pa se izbor modela za korake 7+8 <strong>uvijek</strong> poštuje.</div>
</div>

<div class="controls">
  <label for="fState" class="dim">Prikaži:</label>
  <select id="fState">
    <option value="new">samo nove (za odlučiti)</option>
    <option value="">sve</option>
    <option value="promoted">poslane na obradu</option>
    <option value="dismissed">sklonjene</option>
  </select>
  <span class="spacer"></span>
  <span class="auto">● auto-refresh 15s</span>
  <span class="dim" id="updated"></span>
</div>

<div id="batches"><div class="empty">Učitavam…</div></div>

<style>
/* Podlista jednog dana: zaglavlje s datumom + brojem + "pošalji sve", pa tablica ispod. */
.batch { margin-bottom: 1.6rem; }
.batch-head {
  display: flex; align-items: center; gap: .75rem; flex-wrap: wrap;
  padding: .6rem .9rem; background: var(--card); border: 1px solid var(--border);
  border-radius: var(--radius) var(--radius) 0 0; border-bottom: 0; box-shadow: var(--shadow-sm);
}
.batch-head .date { font-weight: 800; color: var(--navy); font-size: 1rem; letter-spacing: -.01em; }
.batch-head .count { font-size: .8rem; color: var(--muted); font-weight: 600; }
.batch-head .spacer { flex: 1; }
.batch .table-wrap { border-radius: 0 0 var(--radius) var(--radius); }
button.act.a-promote { color: #92400E; border-color: #FDE68A; background: #FFFBEB; font-weight: 700; }
button.act.a-promote:hover { background: #FEF3C7; }
button.act.a-promote-all { color: #92400E; border-color: #FDE68A; background: #FFFBEB; font-weight: 700; margin: 0; }
button.act.a-promote-all:hover { background: #FEF3C7; }
button.act.a-dismiss { color: #5A6570; border-color: #D4D9DE; }
button.act.a-dismiss:hover { background: #ECEFF2; }
/* Dokle je video stigao lokalno — badge koji nightly osvježava svake noći. */
.pill.stage { text-transform: none; letter-spacing: 0; }
.pill.st-fetched     { background: #ECEFF2; color: #5A6570; border: 1px solid var(--border); }
.pill.st-wav         { background: #E7EEF8; color: #1D4ED8; border: 1px solid #CDDDF6; }
.pill.st-transcribed { background: #FDF1E0; color: #B45309; border: 1px solid #F5D9A8; }
.pill.st-diarized    { background: #EEF2FF; color: #4338CA; border: 1px solid #DDD6FE; }
.pill.st-article     { background: #E0F1E5; color: #2E8540; border: 1px solid #BFE3CC; }
tr.dismissed td { opacity: .5; }
tr.dismissed .act { opacity: 1; }
@media (max-width: 760px) {
  .batch-head { border-radius: var(--radius-sm); border-bottom: 1px solid var(--border); margin-bottom: .6rem; }
  .batch .table-wrap { border-radius: 0; }
  .batch-head .spacer { flex: 1 1 100%; }
}
</style>

<script>
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function dur(s){ if(!s) return ''; s=Math.round(s); const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), x=s%60; const p=n=>String(n).padStart(2,'0'); return h? h+':'+p(m)+':'+p(x) : m+':'+p(x); }
// Datum podliste u ljudskom obliku (bez Date parsiranja — batch_date je već YYYY-MM-DD).
function humanDate(d){
  var p = String(d||'').split('-');
  if (p.length !== 3) return d;
  return p[2]+'. '+p[1]+'. '+p[0]+'.';
}
// Datum epizode iz YYYYMMDD prefiksa basenamea.
function humanPub(d){
  var s = String(d||'');
  if (s.length !== 8) return '';
  return s.slice(6,8)+'.'+s.slice(4,6)+'.'+s.slice(0,4)+'.';
}
var STAGE_LABEL = { fetched:'skinuto', wav:'WAV spreman', transcribed:'transkribirano', diarized:'diarizirano', article:'članak gotov' };
function stageBadge(st){
  var s = st || 'fetched';
  return '<span class="pill stage st-'+esc(s)+'" title="Dokle je video stigao lokalno">'+esc(STAGE_LABEL[s]||s)+'</span>';
}
function jobBadge(r){
  if (r.state !== 'promoted') return '';
  var js = r.job_state || 'queued';
  return ' <span class="pill '+esc(js)+'" title="Stanje joba u queueu obrade">⚡ '+esc(js)+'</span>';
}
function rowActions(r){
  if (r.state === 'promoted') {
    return '<a class="tab" style="padding:.28rem .6rem;font-size:.78rem;" href="/admin?q='+encodeURIComponent(r.youtube_id)+'">↗ vidi u queueu</a>';
  }
  var b = [];
  if (r.state === 'new') {
    if (r.promotable) {
      b.push('<button class="act a-promote" data-id="'+esc(r.id)+'" data-act="promote" title="Stvori prioritetni job — puna obrada odmah (Modal)">⚡ Prioritet</button>');
    } else {
      b.push('<span class="dim" title="Beamly audio-only (sintetički ID) — nema YouTube izvor za ponovni fetch">bez YT izvora</span>');
    }
    b.push('<button class="act a-dismiss" data-id="'+esc(r.id)+'" data-act="dismiss" title="Skloni iz liste za odlučiti">✕ Skloni</button>');
  } else if (r.state === 'dismissed') {
    b.push('<button class="act a-requeue" data-id="'+esc(r.id)+'" data-act="restore">↩ Vrati</button>');
  }
  return b.join('');
}
// Thumbnail se veže na promotable, NE na source_platform: beamly epizoda koja je matchana
// na YouTube ima pravi ID (i pravi ytimg thumbnail). Samo nematchani beamly (sintetički ID)
// dobije 🎧 placeholder — za njega bi ytimg vratio 404 i pokazao slomljenu sliku.
// NB: bez backtickova u ovom komentaru — cijeli <script> živi u template literalu.
function thumb(r){
  if (!r.promotable) return '<div class="rthumb" style="display:flex;align-items:center;justify-content:center;font-size:1.1rem;color:#5A6570;" title="Audio-only (nema YouTube izvor)">🎧</div>';
  return '<img class="rthumb" loading="lazy" alt="" src="https://i.ytimg.com/vi/'+esc(r.youtube_id)+'/mqdefault.jpg">';
}
function renderRow(r){
  var link = r.promotable
    ? '<a class="mono" href="https://youtu.be/'+esc(r.youtube_id)+'" target="_blank" rel="noopener">'+esc(r.youtube_id)+'</a>'
    : '<span class="mono dim">'+esc(r.youtube_id)+'</span>';
  var sub = [r.channel?esc(r.channel):'', r.duration_seconds?dur(r.duration_seconds):'', humanPub(r.published_at)].filter(Boolean).join(' · ');
  var meta = '<div>'+esc(r.title||'(bez naslova)')+'</div>'+(sub?'<div class="dim sub">'+sub+'</div>':'')
           + (r.channel_dir?'<div class="sub"><span class="pill neutral mono" style="text-transform:none;letter-spacing:0;">'+esc(r.channel_dir)+'</span></div>':'');
  return '<tr'+(r.state==='dismissed'?' class="dismissed"':'')+'>'+
    '<td data-l="Video"><div class="vidcell">'+thumb(r)+link+'</div></td>'+
    '<td data-l="Naslov">'+meta+'</td>'+
    '<td data-l="Faza">'+stageBadge(r.stage)+jobBadge(r)+'</td>'+
    '<td data-l="Akcije">'+rowActions(r)+'</td></tr>';
}
function renderBatch(date, rows, summary){
  var nNew = rows.filter(function(r){ return r.state==='new'; }).length;
  var promoteAll = nNew > 0
    ? '<button class="act a-promote-all" data-date="'+esc(date)+'" data-n="'+nNew+'" title="Pošalji sve nove iz ove podliste na prioritetnu obradu">⚡ Pošalji sve ('+nNew+')</button>'
    : '';
  var counts = [];
  if (summary) {
    if (summary.n_new) counts.push(summary.n_new+' za odlučiti');
    if (summary.n_promoted) counts.push(summary.n_promoted+' poslano');
    if (summary.n_dismissed) counts.push(summary.n_dismissed+' sklonjeno');
  }
  return '<section class="batch">'+
    '<div class="batch-head">'+
      '<span class="date">📅 '+esc(humanDate(date))+'</span>'+
      '<span class="count">'+rows.length+' '+(rows.length===1?'video':'videa')+(counts.length?' · '+esc(counts.join(' · ')):'')+'</span>'+
      '<span class="spacer"></span>'+promoteAll+
    '</div>'+
    '<div class="table-wrap"><table><thead><tr>'+
      '<th>Video</th><th>Naslov</th><th>Faza</th><th>Akcije</th>'+
    '</tr></thead><tbody>'+rows.map(renderRow).join('')+'</tbody></table></div>'+
  '</section>';
}

var pState = 'new';
// Izbor modela iz zaglavlja stranice — ide uz svaki promote (pojedinačni i batch).
function modelBody(){
  var a = document.getElementById('dArticleModel'), m = document.getElementById('dMagModel');
  return { article_model: a ? a.value : undefined, magisterium_model: m ? m.value : undefined };
}
function modelLabel(){
  var a = document.getElementById('dArticleModel');
  return a ? a.options[a.selectedIndex].text : 'default';
}
async function act(id, action){
  try {
    var r = await fetch('/admin/discovered/'+id+'/'+action, {
      method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(modelBody())
    });
    if (!r.ok) { var j = await r.json().catch(function(){ return {}; }); alert('Nije uspjelo: '+(j.error||r.status)); }
  } catch(e) { alert('Mrežna greška.'); }
  refresh();
}
async function promoteAll(date, n){
  if (!confirm('Poslati svih '+n+' videa od '+humanDate(date)+' na PUNU prioritetnu obradu?\\n\\nSvaki ide kroz Modal GPU transkripciju, a sažetak + članak radi: '+modelLabel())) return;
  try {
    var r = await fetch('/admin/discovered/batch/'+encodeURIComponent(date)+'/promote', {
      method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(modelBody())
    });
    var j = await r.json().catch(function(){ return {}; });
    if (j && typeof j.promoted === 'number') alert('Poslano: '+j.promoted+(j.skipped && j.skipped.length ? ' · preskočeno: '+j.skipped.length : ''));
  } catch(e) { alert('Mrežna greška.'); }
  refresh();
}
async function refresh(){
  try {
    var qs = pState ? ('?state='+encodeURIComponent(pState)) : '';
    var r = await fetch('/admin/api/discovered'+qs, { headers: { 'accept':'application/json' } });
    if (!r.ok) return;
    var data = await r.json();
    var counts = data.counts || {};
    var order = [['new','za odlučiti'],['promoted','poslano'],['dismissed','sklonjeno']];
    document.getElementById('stats').innerHTML = order.map(function(o){
      var cls = o[0]==='new' ? 'queued' : (o[0]==='promoted' ? 'done' : 'skipped');
      return '<div class="stat s-'+cls+'"><div class="label">'+o[1]+'</div><div class="value">'+(counts[o[0]]||0)+'</div></div>';
    }).join('');
    // Grupiraj po batch_date (već sortirano DESC iz baze — Map čuva redoslijed umetanja).
    var groups = new Map();
    (data.discovered||[]).forEach(function(r){
      if (!groups.has(r.batch_date)) groups.set(r.batch_date, []);
      groups.get(r.batch_date).push(r);
    });
    var summaries = {};
    (data.batches||[]).forEach(function(b){ summaries[b.batch_date] = b; });
    var html = '';
    groups.forEach(function(rows, date){ html += renderBatch(date, rows, summaries[date]); });
    document.getElementById('batches').innerHTML = html ||
      '<div class="empty">Nema otkrivenih videa'+(pState?' u ovom filteru':'')+'. Nightly ih upisuje na kraju svakog runa.</div>';
    document.getElementById('updated').textContent = 'osvježeno ' + new Date().toLocaleTimeString('hr-HR');
  } catch(e) {}
}
document.getElementById('fState').addEventListener('change', function(e){ pState = e.target.value; refresh(); });
document.getElementById('batches').addEventListener('click', function(e){
  var all = e.target.closest('button.a-promote-all');
  if (all) { promoteAll(all.dataset.date, parseInt(all.dataset.n,10)||0); return; }
  var b = e.target.closest('button.act');
  if (b && b.dataset.act) { b.classList.add('busy'); act(b.dataset.id, b.dataset.act); }
});
refresh();
setInterval(refresh, 15000);
</script>`;
  return layout('DOMOVINA Pipeline — otkriveni videi', body);
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
      <td data-l="Naziv">${escapeHtml(k.name)}<div class="dim sub mono">${escapeHtml(k.key_hash.slice(0, 12))}…</div></td>
      <td data-l="Krediti"><span class="credits ${k.credits > 0 ? 'pos' : 'zero'}">${k.credits}</span></td>
      <td data-l="Status">${status}</td>
      <td class="dim" data-l="Kreiran">${fmtTs(k.created_at)}</td>
      <td class="dim" data-l="Zadnje korišteno">${fmtTs(k.last_used_at)}</td>
      <td data-l="Akcije">
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
