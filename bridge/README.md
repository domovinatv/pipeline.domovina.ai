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
node bridge/report_discovered.js --dry-run                 # samo ispiši
node bridge/report_discovered.js --since 2026-07-18        # backfill starijih podlista
node bridge/report_discovered.js --pending-transcription   # SVE što čeka Colab (ima .wav, nema .canary.srt)
```

## Potrošnja tokena — zašto tri filtera

`report_token_usage.js` čita Claude Code session datoteke (`~/.claude/projects/*/*.jsonl`);
svaka assistant poruka nosi `message.usage`, pa se dobiva stvarna potrošnja headless runova
bez ijedne izmjene u skriptama koje pozivaju `claude`.

Atribucija videu traži **sva tri** filtera — bilo koji izostavljen daje krive brojke:

1. **samo projekti pipelinea** (default: projekt `FETCH_REPO`-a). Mjereno 2026-07-25:
   `ecosystem-brain` ima **436** sesija koje spominju video ID-eve a nisu obrada tog videa,
   naspram 33 stvarne u `fetch.domovina.tv` → skeniranje svega naduvava brojke ~8×.
   `--all-projects` postoji samo za dijagnostiku.
2. **`entrypoint === 'sdk-cli'`** — headless `claude -p`. Interaktivne sesije (`cli`) su
   čovjek za tipkovnicom i nisu trošak obrade videa.
3. **video ID iz prompta** (`MAGISTERIUM_MCP_RUN.md <VID>` / `_yt_<VID>`); goli 11-znakovni
   niz se ne prihvaća.

Bez preračuna u dolare — runovi idu pod Claude Code pretplatom, ne per-token naplatom.

```bash
node bridge/report_token_usage.js --dry-run --top 10
```

Puni kontekst, izmjerene brojke i zamke:
`../fetch.domovina.tv/docs/pipeline_observability_2026-07.md`.

`PIPELINE_QUEUE_INGEST_KEY` mora biti u launchd okruženju nightly-ja (ili izvezen u wrapperu).

## Izbor modela po videu (od 0.11.0)

Admin bira model u `/admin` (forma za dodavanje + selecti u retku) i na `/admin/discovered`
(zaglavlje stranice). Izbor putuje kroz D1 (`jobs.llm_backend`/`llm_model`/`magisterium_model`,
`magisterium_jobs.model`) do bridgea, koji ga prevede u ono što skripte u `fetch.domovina.tv`
ionako oduvijek podržavaju. **Bridge je bio jedina karika koja je falila** — mehanika je
postojala, samo je nitko nije prosljeđivao.

| Korak | Gdje se odlučuje | Što bridge napravi |
|---|---|---|
| 7+8 (sažetak + outline + članak) | `jobs.llm_backend` + `llm_model` | `priority_poller.js` doda `--gemini-backend <b>` i postavi `CLAUDE_MODEL` u env `run_pipeline.sh`-a |
| 8.5 (Magisterium MCP) | `magisterium_jobs.model` (naslijeđen s `jobs.magisterium_model`) | `magisterium_poller.js` pokrene `claude --model <m> -p …` |

Oba mjesta imaju **whitelist** (`LLM_BACKENDS`, `ALLOWED_MODELS`): neispravna vrijednost iz
baze pada na default uz upozorenje umjesto da sruši run (`--gemini-backend smeće` je fatalna
validacijska greška, `--model smeće` ruši CLI).

### ⚠ Ograničenje: koraci 7+8 samo na prioritetnim jobovima

Per-video izbor modela za korake 7+8 poštuje **samo `priority_poller.js`**, jer on vrti
`run_pipeline.sh` kao zaseban single-video run. Standardni jobovi kroz `claim_and_dispatch.js`
dobiju samo download (`fetch.js --unlisted-url`); sažetak i članak im nastaju u **noćnom batchu**,
gdje je `run_pipeline.sh` pozvan JEDNOM za sve epizode i ima jedan globalni `--gemini-backend`.
Tamo per-video izbor nema kamo — admin UI to i piše uz select.

Magisterium (8.5) nema to ograničenje: `magisterium_poller.js` obrađuje zahtjev po zahtjev,
pa izbor modela vrijedi za **svaki** video, prioritetni ili ne.

### Zašto Fable nije u ponudi

Downstream (channel_index, CDN manifest) dedupa članke po **leksikografski najvećem**
`_{datum}_{model}.article.json`, a model slug ide u ime datoteke. `opus`/`sonnet`/`haiku`
počinju slovom > `'g'` pa pri istom datumu pobjeđuju `gemini-*`. `fable` počinje s `'f' < 'g'`
→ članak bi se uredno generirao, spremio i **nikad servirao**. Dok se to ne popravi uzvodno
(slug koji sortira iznad `gemini-`), Fable se ne nudi. Vidi `fetch.domovina.tv/generate_article_gemini.js:84-93`.

## Zašto pull, ne push

Mac Mini je iza NAT-a — Cloudflare ga ne može dosegnuti. Bridge povlači. Claim je
atomski (conditional UPDATE `state='queued'` guard u D1), pa dva runa ne mogu uzeti
isti job. Stuck `fetching` (bridge pao prije PATCH-a) cloud cron vraća u `queued`.
