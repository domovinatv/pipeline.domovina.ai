# CLAUDE.md — pipeline.domovina.ai

Queue servis za ad-hoc/unlisted YouTube obradu kroz puni DOMOVINA AI pipeline.
Vidi `README.md` za arhitekturu. Ovdje samo konvencije za rad u kodu.

## Stack

- **Backend**: Cloudflare Worker, **Hono**, **D1** (`jobs` + `api_keys`), cron sweep.
  Modeliran po `../pay.domovina.ai/backend` (isti stack, branding, gitignore).
- **Bridge**: plain Node skripte (`bridge/`) koje trče lokalno na Mac Miniju i
  spajaju cloud queue s pipelineom u `../fetch.domovina.tv`.
- **Admin**: server-rendered HTML u Workeru (`src/admin/views.ts`), prijava Cloudflare
  Access + passkey (`src/admin/auth/`, `docs/admin-auth.md`).
  NEMA zasebnog frontend builda. UI konvencije (dizajn sustav, mobile kartice,
  `data-l` pravilo za nove stupce, vizualna verifikacija) → `docs/UI.md`.

## Komande

```bash
cd backend
npm install
npm run dev                 # wrangler dev (treba .dev.vars)
npm run typecheck           # tsc --noEmit
npm run db:migrate:local    # D1 migracije lokalno
npm run deploy              # wrangler deploy
```

## Konvencije

- **Jezik**: svi komentari, log poruke, admin UI tekst — hrvatski (kao cijeli ekosustav).
- **Secrets**: NIKAD u repo (public!). `INGEST_KEY`/`TRANSCRIBE_KEY` kroz
  `wrangler secret put`. Lokalno `.dev.vars` (gitignored, vidi `.dev.vars.example`).
- **Auth**: `/admin/*` sesija (Access ili passkey; CSP s nonceom — bez inline `onclick=`/
  `onsubmit=`, POST mora imati isti `Origin`); `/api/jobs/*` Bearer `INGEST_KEY`;
  `/dashboard` + `/api/v1/*` korisnikov API ključ.
- **Dijeljeni UI**: retke/korake/forme za admin i dashboard gradi `src/ui/client.ts`
  (nova značajka ide tamo, ne u jednu stranicu — `docs/UI.md`).
- **Job stanja**: `queued→fetching→transcribing→processing→done|failed`. Bridge smije
  postaviti samo `BRIDGE_SETTABLE` stanja preko PATCH-a.
- **Claim**: atomski conditional UPDATE (`state='queued'` guard), bez D1 transakcija.
- **Producer granica**: stvarna obrada je u `../fetch.domovina.tv` (`fetch.js
  --unlisted-url`, `_`-kanal mehanizam). Ovaj repo NE obrađuje video, samo orkestrira queue.
- **Billing**: `price_cents`/`paid` su SKELA (nema pay.domovina.ai intenta). Krediti
  API ključeva SU ožičeni: `/api/v1` atomski skida kredit po jobu (402 bez njih).
  Ne uključuj stvarnu naplatu bez eksplicitne odluke.
- **Limiti (v0.20.0, nakon incidenta 14.10.)**: `createJob` odbija INSERT kad je u redu
  ≥`MAX_QUEUED_TOTAL` (50) ili ≥`MAX_QUEUED_PER_KEY` (10) `queued` jobova → `QueueFullError`
  → 429 (`errors.ts`). Krediti po ključu najviše `MAX_KEY_CREDITS` (500). Bridge
  `priority_poller.js` ima lokalni dnevni budžet (`PRIORITY_DAILY_MAX`, 30). Svaki novi put
  koji stvara job ide kroz `createJob` — ne piši INSERT u `jobs` mimo njega.

## MCP Proxy Bridgeovi

Ovaj repo sadrži **stdio ↔ remote** MCP proxy bridgeove za AI coding alate:

- **`domovina-mcp.mjs`** — Domovina MCP (`mcp.domovina.ai`) preko OAuth 2.1 + DCR + PKCE.
  Headless flow: registrira klijenta, intercepta 302 redirect za auth code, razmijeni za token.
  **NIKAD** ne koristiti sirovi `MCP_API_KEY` za produkciju — seedan je samo u lokalnu PG bazu.
- **`magisterium-mcp.mjs`** — Magisterium AI preko A2A endpointa. Supabase Bearer token iz
  `.magisterium_token`. Za obnovu tokena: `node parse-cookies.mjs`.
- **Konfiguracija:** `~/.gemini/config/mcp_config.json` (Antigravity CLI) ili
  `~/Library/Application Support/Claude/claude_desktop_config.json` (Claude Desktop).

Detaljna dokumentacija: `docs/MCP_BRIDGES.md`.

Ponovna obrada / Speechmatics za prioritetne (v0.17.0) i ugovor prema fetch strani:
`docs/2026-10-08-ponovna-obrada.md`.
Playlista kroz prioritetni red, `fetch failed` nakon dugog `spawnSync`, `Vary: Origin` bundle i
Magisterium lock (19.10.): `docs/2026-10-19-playlista-hodocasnik.md`.
Inventar svih epizoda na disku + stanje po koraku (`/admin/episodes`, `bridge/report_inventory.js`,
tablica `episodes`, v0.21.0): `docs/2026-10-21-inventar-epizoda.md`.
