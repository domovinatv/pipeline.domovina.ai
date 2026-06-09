# bridge/ — lokalni poller (Mac Mini)

Spaja cloud queue (`pipeline.domovina.ai`) s lokalnim pipelineom u
`fetch.domovina.tv`. Plain Node, bez dependencija (koristi global `fetch`, Node 18+).

| skripta | kad | što radi |
|---|---|---|
| `claim_and_dispatch.js` | **prije** punog runa (KORAK 0) | claim queued jobova → `fetch.js --unlisted-url` → `transcribing`/`failed` |
| `reconcile.js` | **nakon** punog runa | gotove (CDN article 200) → `done` + `detail_url`; diarizirane → `processing` |

## Env

```bash
export PIPELINE_QUEUE_BASE="https://pipeline.domovina.ai"   # default
export PIPELINE_QUEUE_INGEST_KEY="…"                        # OBAVEZNO (Bearer)
export FETCH_REPO="/Users/ms/git/domovinatv/fetch.domovina.tv"  # default: sibling ../fetch.domovina.tv
export CLAIM_MAX="5"                                 # claim_and_dispatch
export CDN_BASE="https://cdn.domovina.ai"            # reconcile
export SITE_BASE="https://domovina.ai"               # reconcile (detail_url)
```

Bez `PIPELINE_QUEUE_INGEST_KEY` obje skripte ispišu upozorenje i **exit 0** (ne ruše nightly).

## Predložena integracija u `nightly_pipeline.sh`

```bash
# ─── KORAK 0: pipeline queue claim (ad-hoc/unlisted videi) ───
PIPELINE_QUEUE_BRIDGE="${PIPELINE_QUEUE_BRIDGE_DIR:-$REPO_DIR/../pipeline.domovina.ai/bridge}"
if [ -f "$PIPELINE_QUEUE_BRIDGE/claim_and_dispatch.js" ]; then
    run_step "pipeline claim" node "$PIPELINE_QUEUE_BRIDGE/claim_and_dispatch.js" || true
fi

# … run_pipeline.sh + channel index + meta upload …

# ─── ZAVRŠNO: javi pipeline-u gotove jobove ───
if [ -f "$PIPELINE_QUEUE_BRIDGE/reconcile.js" ]; then
    run_step "pipeline reconcile" node "$PIPELINE_QUEUE_BRIDGE/reconcile.js" || true
fi
```

`PIPELINE_QUEUE_INGEST_KEY` mora biti u launchd okruženju nightly-ja (ili izvezen u wrapperu).

## Zašto pull, ne push

Mac Mini je iza NAT-a — Cloudflare ga ne može dosegnuti. Bridge povlači. Claim je
atomski (conditional UPDATE `state='queued'` guard u D1), pa dva runa ne mogu uzeti
isti job. Stuck `fetching` (bridge pao prije PATCH-a) cloud cron vraća u `queued`.
