# DOMOVINA Pipeline — `pipeline.domovina.ai`

Queue servis za **ad-hoc obradu proizvoljnog (i unlisted) YouTube videa** kroz puni
DOMOVINA AI pipeline. Pošalješ YouTube URL/ID kroz mali admin dashboard → video se
obradi **identično** kao katalog (transkripcija → diarizacija → sažetak → članak →
RAG → screenshots → Magisterium → CDN), ali ostaje **neindeksiran**: dostupan samo na
privatnom `https://domovina.ai/v/{id}` (kao YouTube unlisted).

Vizija: SaaS — naplata ~€1 po obrađenom videu preko API ključeva (skela postoji,
ugašena; naplata se planira spojiti na postojeći `pay.domovina.ai` payment-intents).

## Arhitektura — dvije polovice

Pipeline trči **lokalno** na Mac Miniju (iza NAT-a), pa je model **pull**: cloud drži
red, lokalni bridge ga povlači.

```
┌─────────────────────── CLOUD (Cloudflare) ───────────────────────┐
│  pipeline.domovina.ai  (Worker, Hono)                               │
│   • /admin           Basic Auth dashboard — dodaj URL, kronološki  │
│                      ispis jobova + status (auto-refresh)          │
│   • /api/jobs/*      Bearer INGEST_KEY — enqueue/claim/patch/list   │
│   • D1 `jobs`        queued→fetching→transcribing→processing→done   │
│   • cron */15        sweep stuck 'fetching' → 'queued'              │
└────────────────────────────┬──────────────────────────────────────┘
                             │  HTTPS (Bearer INGEST_KEY)
┌────────────────────────────┴──── LOKALNO (Mac Mini) ──────────────┐
│  bridge/claim_and_dispatch.js  (KORAK 0 punog runa)               │
│     claim queued → `fetch.js --unlisted-url` → _unlisted/         │
│  ── postojeći pipeline (nightly ili manualni run) ──              │
│     convert_to_wav (auto-discover _unlisted) → WAV→Drive          │
│     → [Colab Canary] → diarize → summary → article → … → R2       │
│  bridge/reconcile.js  (ZAVRŠNI KORAK)                             │
│     CDN data/{id}/article.json 200 → PATCH done + detail_url      │
└───────────────────────────────────────────────────────────────────┘
```

**Multi-pass realnost:** Canary transkripcija je ručni Colab korak između prolaza,
pa se job NE dovrši u jednom runu (`transcribing` → čeka Colab → idući run
`processing`/`done`). To je namjerno — koristi postojeći provjereni proces.

## Job stanja

| stanje | značenje |
|---|---|
| `queued` | admin/API ubacio, čeka da ga bridge pokupi |
| `fetching` | bridge claimao, yt-dlp skida u `_unlisted/` |
| `transcribing` | skinuto + WAV na Driveu, čeka Colab Canary |
| `processing` | `.canary.srt` stigao, diarizacija + Gemini lanac teku |
| `done` | `data/{id}/article.json` živ na CDN-u, `detail_url` spreman |
| `failed` | trajna greška (private/unavailable/anti-bot) |

## Setup (cloud)

```bash
cd backend
npm install

# 1. D1 baza
wrangler d1 create pipeline_domovina
#    → zalijepi database_id u wrangler.toml
wrangler d1 migrations apply pipeline_domovina --remote

# 2. Secrets
wrangler secret put ADMIN_USER     # npr. ms
wrangler secret put ADMIN_PASS
wrangler secret put INGEST_KEY     # dugački random token (dijeli ga bridge)

# 3. Deploy — wrangler.toml ima [[routes]] custom_domain=true, pa deploy SAM
#    stvori proxied DNS zapis + edge cert za pipeline.domovina.ai (bez ručnog DNS-a).
npm run deploy
```

Otvori `https://pipeline.domovina.ai/admin` (Basic Auth) i dodaj prvi video.
Novi subdomain nije pod Cloudflare Access app-om → javno dostupan odmah (auth radi Worker).

## Setup (lokalni bridge na Mac Miniju)

Bridge skripte su plain Node (bez dependencija). Postavi env (npr. u
`~/.config/domovina-pipeline.env` ili izvozom u nightly wrapperu):

```bash
export PIPELINE_QUEUE_BASE="https://pipeline.domovina.ai"
export PIPELINE_QUEUE_INGEST_KEY="…isti INGEST_KEY…"
export FETCH_REPO="/Users/ms/git/domovinatv/fetch.domovina.tv"   # default: sibling
```

Ruční test:
```bash
node bridge/claim_and_dispatch.js   # povuče queued, skine u _unlisted
node bridge/reconcile.js            # javi done za gotove
```

### Integracija u nightly

U `fetch.domovina.tv/automatic/nightly_pipeline.sh`:
- **prije** `run_pipeline.sh`: `node …/pipeline.domovina.ai/bridge/claim_and_dispatch.js`
- **nakon** završnih koraka: `node …/pipeline.domovina.ai/bridge/reconcile.js`

Obje skripte soft-fail-aju (exit 0) ako `PIPELINE_QUEUE_INGEST_KEY` nije postavljen, pa ne
ruše nightly. Vidi `bridge/README.md`.

## API (Bearer `INGEST_KEY`)

| metoda | put | svrha |
|---|---|---|
| POST | `/api/jobs` | enqueue `{url\|youtube_id, title?}` (dedup po videu) |
| GET | `/api/jobs?state=&limit=` | lista (state može biti CSV) |
| POST | `/api/jobs/claim` | `{max}` → claim queued → fetching |
| GET | `/api/jobs/:id` | status |
| PATCH | `/api/jobs/:id` | `{state, detail_url?, error?}` (bridge) |

## Što je u `fetch.domovina.tv` (producer)

`pipeline.domovina.ai` se oslanja na unlisted mehanizam u pipeline repou:
- `fetch.js --unlisted-url <URL>` → skida u `_unlisted` kanal
- `_`-prefiks: `generate_channel_index.js` preskače (neindeksiran), `upload_to_r2.js`
  uključuje (per-video na CDN), Flutter `/v/:id` čita po ID-u (index-neovisno)
- `convert_to_wav.js` auto-discoverira `_`-kanale u punom runu

## Billing (skela, ugašeno)

`jobs.price_cents`/`paid` + `api_keys` tablica postoje od dana 1. Kad se naplata upali:
job se gejta na plaćeni `pay.domovina.ai` payment-intent prije nego ode u `queued`.
