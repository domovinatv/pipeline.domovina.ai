# CLAUDE.md — pipeline.domovina.ai

Queue servis za ad-hoc/unlisted YouTube obradu kroz puni DOMOVINA AI pipeline.
Vidi `README.md` za arhitekturu. Ovdje samo konvencije za rad u kodu.

## Stack

- **Backend**: Cloudflare Worker, **Hono**, **D1** (`jobs` + `api_keys`), cron sweep.
  Modeliran po `../pay.domovina.ai/backend` (isti stack, branding, gitignore).
- **Bridge**: plain Node skripte (`bridge/`) koje trče lokalno na Mac Miniju i
  spajaju cloud queue s pipelineom u `../fetch.domovina.tv`.
- **Admin**: server-rendered HTML u Workeru (`src/admin/views.ts`), Basic Auth.
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
- **Secrets**: NIKAD u repo (public!). `ADMIN_USER`/`ADMIN_PASS`/`INGEST_KEY` kroz
  `wrangler secret put`. Lokalno `.dev.vars` (gitignored, vidi `.dev.vars.example`).
- **Auth**: `/admin/*` Basic Auth; `/api/jobs/*` Bearer `INGEST_KEY`.
- **Job stanja**: `queued→fetching→transcribing→processing→done|failed`. Bridge smije
  postaviti samo `BRIDGE_SETTABLE` stanja preko PATCH-a.
- **Claim**: atomski conditional UPDATE (`state='queued'` guard), bez D1 transakcija.
- **Producer granica**: stvarna obrada je u `../fetch.domovina.tv` (`fetch.js
  --unlisted-url`, `_`-kanal mehanizam). Ovaj repo NE obrađuje video, samo orkestrira queue.
- **Billing**: `price_cents`/`paid`/`api_keys` su SKELA — postoje ali nisu ožičeni.
  Ne uključuj naplatu bez eksplicitne odluke (plan: spoj na pay.domovina.ai intents).

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
```
