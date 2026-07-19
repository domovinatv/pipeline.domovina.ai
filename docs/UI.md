# UI konvencije — admin + dashboard (v0.7.0+)

Sve stranice (/admin, /admin/keys, /dashboard) dijele **jedan** stylesheet:
`BASE_STYLE` u `backend/src/admin/views.ts` (layout() ga ugrađuje u `<head>`).
Dashboard ima samo mali lokalni `<style>` dodatak (`.imp`, `.vlinks`) u
`backend/src/dashboard/views.ts`. NEMA frontend builda — sve je server-rendered
HTML + inline JS.

## Dizajn sustav (premium SaaS, v0.7.0)

- Svijetla pozadina `--page` + bijele kartice (`--card`) sa sjenama
  (`--shadow-sm/md`), radius tokeni `--radius`/`--radius-sm`.
- Sticky header s backdrop blurom; DOMOVINA brand boje ostaju
  (`--navy #002F6C`, `--red #FF0000`, tricolor traka).
- Stat-kartice: bijele s bočnom akcent trakom (`.stat::before`) u boji stanja
  (`.stat.s-queued`, `.s-done`, …) — iste semantičke boje kao `.pill.<state>`.
- Fokus: svi inputi/selecti imaju focus ring (`--ring`).
- Tier/checkbox opcije u formama: `label.tieropt` = selectable kartica
  (`:has(input:checked)` za aktivno stanje).

## Mobile responzivnost — tablice postaju kartice (≤760px)

U media queryju `@media (max-width: 760px)`:

- `thead` se sakrije, `table`/`tbody`/`tr`/`td` postaju `display:block`;
  svaki `<tr>` je samostojeća kartica.
- **Labelu kolone nosi `data-l` atribut na `<td>`** — CSS je ispisuje kroz
  `td[data-l]::before { content: attr(data-l) }`.
- ⚠️ **PRAVILO: novi stupac u bilo kojoj tablici MORA dobiti `data-l="Labela"`
  u row-generaciji**, inače na mobitelu ćelija ostaje bez naslova. Mjesta gdje
  se redovi generiraju:
  - admin queue: `refresh()` u `renderJobsPage()` (admin/views.ts)
  - korisnički dashboard: `refresh()` u `renderDashboardPage()` (dashboard/views.ts)
  - API ključevi: server-rendered redovi u `renderKeysPage()` (admin/views.ts)
- Detail redak s pipeline koracima (`tr.detail-row`) se negativnim marginom
  vizualno "lijepi" na karticu retka iznad.
- Globalno `[hidden]{display:none!important}` je NUŽAN — `tbody tr{display:block}`
  bi inače pregazio native `hidden` atribut (detail redovi bi se svi otvorili).

## Poznate zamke

- **Specificitet u addboxu:** `.addbox label` (uppercase/muted/mala slova) gazi
  `.tieropt` — zato je selektor `label.tieropt` (jednak specificitet, kasnije u
  fileu → pobjeđuje). Isti oprez za svaki novi label-varijant unutar `.addbox`.
- `.addbox input` pravila su scopana s `:not([type=checkbox]):not([type=radio])`
  da `width:100%` ne razvuče checkboxe/radije.
- Inline `<script>` je u TS template literalu: **bez backslasheva u regexima**
  (koristi `[.]`/`[/]` klase — vidi komentar uz `ytId()`), bez backticka i `${`.
- `APP_VERSION` (admin/views.ts) bumpaj prije SVAKOG deploya i podudari s
  `version` u package.json — prikazuje se u footeru za brzu identifikaciju builda.

## Vizualna verifikacija bez wrangler deva (recept)

View funkcije su čisti string-rendereri pa se daju bundlati i izvršiti u Nodeu:

1. Mali `render.ts` koji importa `renderJobsPage`/`renderKeysPage`/
   `renderDashboardPage`, pozove ih s fake podacima i `writeFileSync` u HTML.
2. `./node_modules/.bin/esbuild --bundle render.ts --platform=node --outfile=render.cjs && node render.cjs`
3. Otvori HTML u browseru (chrome-devtools MCP), pa u konzoli stubaj fetch i
   pozovi globalni `refresh()` da se tablica napuni fake jobovima:
   ```js
   window.fetch = async () => ({ ok:true, json: async () => ({ total:1, counts:{...}, jobs:[...] }) });
   await refresh();
   ```
4. Screenshot na 1440px (desktop) i 390px (mobile).

Time se cijeli UI (uključivo klijentski row-rendering) provjeri bez D1/.dev.vars.
