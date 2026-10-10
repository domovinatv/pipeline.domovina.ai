# UI konvencije — admin + dashboard (v0.7.0+)

Sve stranice (/admin, /admin/keys, /dashboard) dijele **jedan** stylesheet:
`BASE_STYLE` u `backend/src/admin/views.ts` (layout() ga ugrađuje u `<head>`).
Dashboard ima samo mali lokalni `<style>` dodatak (`.imp`, `.vlinks`) u
`backend/src/dashboard/views.ts`. NEMA frontend builda — sve je server-rendered
HTML + inline JS.

## Jedan klijentski kod za admin i dashboard (v0.18.0+)

Do v0.17.0 dashboard je imao vlastitu kopiju klijentskog JS-a, pa je sve dodano u admin
nakon ~v0.14 (tokeni, bedževi modela i ponovne obrade, paginacija, pretraga) dashboardu
nedostajalo. Sad oba ekrana grade retke iz `backend/src/ui/client.ts`:

- `SHARED_CLIENT_JS` — formatiranje, bedževi (`jobBadges`), selecti modela, koraci +
  tokeni + 📁 datoteke u detail retku, stat pločice, filter/pretraga/pager, oEmbed preview.
  Stranica prije njega zada `READ` (`/admin/api` | `/api/v1`), `ACT` (`/admin/jobs` |
  `/api/v1/jobs`), `H` (zaglavlja; dashboard = Bearer ključ) i `COLS`.
- `renderJobChoiceFields()` — izbori obrade u formi za dodavanje (isti u obje forme).
- `renderReprocessFields()` + `REPROCESS_WIRE_JS` — ponovna obrada (admin stranica i
  dashboard `<dialog>`); serversko pravilo je `reprocessRedoArticle()` u `types.ts`.

⚠️ **PRAVILO: nova značajka u retku, koracima ili formi ide u `ui/client.ts`**, ne u jednu
od stranica. Na stranici ostaje samo ono što je stvarno njezino: admin akcije (skip,
odgodi, soft-delete, 🔑 izvor), dashboard krediti, ⚡ forsiranje i dijalog ponovne obrade.

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
  - (oba koriste `detailRow()`/`emptyRow()` iz ui/client.ts s `COLS` za colspan)
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
- **`form.title` nije polje „title"**: `HTMLFormElement.title` je atribut same forme, pa
  `f.title.value` baci grešku. Polja čitaj s `f.elements.namedItem('title')` (dashboard
  submit). Isto vrijedi za svako ime polja koje je i svojstvo forme (`action`, `method`, `name`).
- Admin stranice imaju CSP s nonceom (`admin/auth/mount.ts`): inline `<script>` dobiva nonce
  automatski, ali **inline handleri (`onclick=`, `onsubmit=`) su blokirani** — koristi
  `addEventListener`. CSP pušta samo `i.ytimg.com` (img) i `www.youtube.com` (oEmbed) izvana.
- Test `admin-jobs.test.ts` čita polja potvrdne stranice regexom; selecti u
  `renderReprocessFields()` nemaju `id` (dijalog dashboarda bi inače imao duple id-jeve).
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
5. Provjeri da nema horizontalnog scrolla: `document.documentElement.scrollWidth` mora biti
   jednak širini viewporta (na 390px ga je ranije gurao Fluid/Omeđeno toggle → skriven ≤760px).

Time se cijeli UI (uključivo klijentski row-rendering) provjeri bez D1/.dev.vars.
