# bridge/ — lokalni poller (Mac Mini)

Spaja cloud queue (`pipeline.domovina.ai`) s lokalnim pipelineom u
`fetch.domovina.tv`. Plain Node, bez dependencija (koristi global `fetch`, Node 18+).

| skripta | kad | što radi |
|---|---|---|
| `claim_and_dispatch.js` | **prije** punog runa (KORAK 0) | claim queued jobova → `fetch.js --unlisted-url` → `transcribing`/`failed` |
| `priority_poller.js` | često (launchd, flock) | claim **prioritetnih** jobova → puni single-video run (Modal) → `transcribing`/`failed` |
| `reconcile.js` | **nakon** punog runa | gotove (CDN article 200) → `done` + `detail_url`; diarizirane → `processing` |
| `report_discovered.js` | **zadnje** u nightlyju | prijavi što je run NOVO povukao → dnevna podlista na `/admin/discovered` (ne queuea obradu) |
| `magisterium_poller.js` | često (launchd) | claim `magisterium_jobs` zahtjeva → `claude -p "@…/MAGISTERIUM_MCP_RUN.md <VID>"` headless → CDN verifikacija → `done`/`failed` |

## Env

```bash
export PIPELINE_QUEUE_BASE="https://pipeline.domovina.ai"   # default
export PIPELINE_QUEUE_INGEST_KEY="…"                        # OBAVEZNO (Bearer)
export FETCH_REPO="/Users/ms/git/domovinatv/fetch.domovina.tv"  # default: sibling ../fetch.domovina.tv
export CLAIM_MAX="5"                                 # claim_and_dispatch
export PRIORITY_MAX="3"                               # priority_poller
export CDN_BASE="https://cdn.domovina.ai"            # reconcile + magisterium_poller
export SITE_BASE="https://domovina.ai"               # reconcile (detail_url)
# magisterium_poller:
export CLAUDE_BIN="claude"                            # Claude Code CLI (mora imati Magisterium MCP u sesiji)
export MAG_MAX="2"                                    # zahtjeva po ticku (chat rate-limit 15/min)
export MAG_RUNNER="claude"                            # 'claude' = pokreni headless | 'manual' = samo ispiši komande
# report_discovered:
export DISCOVERED_LOOKBACK_HOURS="26"                 # prozor skeniranja (pokriva jedan nightly ciklus)
```

Bez `PIPELINE_QUEUE_INGEST_KEY` sve skripte ispišu upozorenje i **exit 0** (ne ruše nightly).

## Magisterium poller — preduvjeti i tok

`magisterium_poller.js` pokreće produkcijski hibridni Magisterium MCP workflow
(`fetch.domovina.tv/docs/MAGISTERIUM_MCP_RUN.md`) **headless** preko Claude Code CLI
(`claude -p`). Zato Claude Code na Macu **mora imati Magisterium MCP dostupan** (interaktivno
autenticiran MCP možda nije prisutan u čistom cron/headless kontekstu — testiraj `MAG_RUNNER=manual`
prvo, koji samo ispiše točne komande bez claima/pokretanja).

Idempotentno: prije runa provjeri CDN (`article.magisterium[.en].json`); ako artefakt već
postoji → odmah `done` (ne troši tokene). To čini cloud cron **auto-enqueue** granu jeftinom —
done jobovi s `with_magisterium=1` dobiju HR zahtjev, a poller preskoči one koji su već obrađeni.

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

# ─── ZADNJE: dnevna podlista onoga što je run novo povukao ───
if [ -f "$PIPELINE_QUEUE_BRIDGE/report_discovered.js" ]; then
    run_step "pipeline discovered" node "$PIPELINE_QUEUE_BRIDGE/report_discovered.js" || true
fi
```

## Otkriveni videi — zašto zaseban queue

`report_discovered.js` **ne queuea obradu**. Skenira `storage/output/<kanal>/*.info.json`
mlađe od prozora (default 26h) i upiše ih u `discovered_videos` — tablicu odvojenu od `jobs`.

Razlog za odvajanje: `jobs` je queue **obrade** (claim, krediti, priority tier, transcribe
lock). Otkriveni video nije namjera obrade nego zapis „ovo je sinoć stiglo". U `jobs`-u bi
zagadio `countByState`, claim upite i dedup, a bridge bi ga mogao slučajno pokupiti.

Admin na `/admin/discovered` vidi podliste po danu otkrića; klik **⚡ Prioritet** tek tada
stvori `jobs` redak (`priority=1`, `source='discovered'`) koji `priority_poller.js` pokupi
u sljedećem ticku i provuče kroz puni single-video pipeline.

Idempotentno po `youtube_id`: ponovno pokretanje ne duplicira retke, samo osvježi `stage`
(dokle je video stigao na disku), pa podlista pokazuje živo stanje, a ne samo „stiglo je".

```bash
node bridge/report_discovered.js --dry-run            # samo ispiši
node bridge/report_discovered.js --since 2026-07-18   # backfill starijih podlista
```

`PIPELINE_QUEUE_INGEST_KEY` mora biti u launchd okruženju nightly-ja (ili izvezen u wrapperu).

## Zašto pull, ne push

Mac Mini je iza NAT-a — Cloudflare ga ne može dosegnuti. Bridge povlači. Claim je
atomski (conditional UPDATE `state='queued'` guard u D1), pa dva runa ne mogu uzeti
isti job. Stuck `fetching` (bridge pao prije PATCH-a) cloud cron vraća u `queued`.
