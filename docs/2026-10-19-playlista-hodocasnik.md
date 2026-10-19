# 19.10.2026. — playlista HODOČASNIK kroz prioritetni red i Magisterium

Prvi veći prolaz `bridge/enqueue_playlist.js`: 13 pjesama M. P. Thompsona, sve ⚡ prioritet,
Speechmatics, Claude Opus, Magisterium HR. Ovdje su tri kvara koja su se pritom pokazala i
otvorene stavke. Vezano: [`2026-10-08-ponovna-obrada.md`](2026-10-08-ponovna-obrada.md).

## 1. `fetch failed` nakon dugog `spawnSync` — claimani jobovi vise u `fetching`

`priority_poller.js` claima do 3 joba pa ih vrti redom kroz `spawnSync(run_pipeline.sh)`
(~13 min po pjesmi). Za to vrijeme event loop stoji; Cloudflare zatvori keep-alive socket, a
undici ga iskoristi za prvi sljedeći PATCH → `TypeError: fetch failed`. Iznimka je izlazila iz
`for` petlje, pa su ostala 2 claimana joba tick-a ostajala u `fetching` dok ih cron sweep
(`sweepStuckFetching`, 1 h) ne vrati u `queued`. Svaki ponovni claim troši dnevni budžet
(`PRIORITY_DAILY_MAX`).

Simptom u `automatic/logs/priority_*.log`: `⚠️ priority_poller greška: fetch failed` odmah
nakon `PIPELINE ZAVRŠEN` prvog joba, pa `⏳ <id> ostaje fetching` u reconcileu.

Fix `5b96271`: `api()` u `priority_poller.js` i `magisterium_poller.js` ponavlja PATCH/GET do
3× (2 s, 4 s). POST `/claim` se namjerno ne ponavlja — ponovno slanje bi claimalo još jobova.
Za Magisterium je bitnije: `magisterium_jobs` nema stuck sweep, pa bi pao PATCH ostavio
zahtjev trajno u `running`.

Nije napravljeno: izolacija po jobu (try/catch oko tijela petlje). Uz retry nije nužna, ali
4xx na PATCH-u i dalje prekida ostatak tick-a.

## 2. Magisterium na stranici se ne vidi iako je na CDN-u — `Vary: Origin`

Flutter app zna koje datoteke epizoda ima samo iz `data/{id}/episode.json`. CDN čuva dvije
varijante (bez/s `Origin`), a edge drži bundle satima unatoč `max-age=60, must-revalidate`.
`build_episode_bundle.js` purgeao je samo NOVE bundleove, pa je preglednik za yD9r0grKCkA
dobivao bundle od 11:52 bez `article.magisterium.json` (HIT, `age` 7006 s), dok je curl bez
`Origin` vidio svjež.

Fix `e5d57304` (fetch.domovina.tv): purge svakog zapisanog bundlea. Provjera:

```bash
curl -s -H 'Origin: https://domovina.ai' https://cdn.domovina.ai/data/ID/episode.json | jq '.files'
node build_episode_bundle.js --video-id ID --force   # ručno: rewrite + purge obje varijante
```

## 3. Magisterium vlastiti lock (fetch `6e687cd2`) — radi, ali objava ne preživljava čekanje

- **yD9r0grKCkA [hr]:** runbook je radio paralelno s prioritetnim redom, objava (korak 7,
  `with_pipeline_lock.sh`) čekala ~10 min i prošla. ✅
- **yD9r0grKCkA [en]:** `spawnSync claude ETIMEDOUT` nakon 60 min (`MAG_RUN_TIMEOUT_MS`):
  prijevod (20–60 min) + čekanje locka ne stanu u sat. Runbook je prijevod još i pustio
  „u pozadinu". → `failed`.
- **g9w5zmNaVoI [hr]:** analiza gotova (71/100) i na disku, ali objava je čekala lock u Bash
  tool pozivu claudea; alat ju je ugasio (timeout alata ≪ 30 min), pa ju je model ponovno
  pustio u pozadinu. Headless `claude -p` ubija djecu na izlazu (memorija
  `headless-claude-p-ubija-djecu`) → objava vjerojatno nikad ne dođe na CDN.

Zaključak: čekanje na pipeline lock ne smije biti unutar claude sesije. Prijedlog: runbook
završava na disku, a `magisterium_pipeline.sh` (ili poller) nakon izlaza claudea sam radi
objavu kroz `with_pipeline_lock.sh`, bez limita alata.

## Stanje na kraju dana (16:40)

| | |
|---|---|
| Pipeline done | yD9r0grKCkA, g9w5zmNaVoI, 9guRcVlh-nU, N6GNJcGVzQ8, hzoATR5LVvY, DanxudpvykE |
| Pipeline ostatak | TziTlA7JhlQ, KSULTdNwyJA, mN-JoBDuOO8 + 4 vraćena sweepom (M66aQ-tCaXI, 5qqBaZYfKjM, 89FB43fRabw, v3XjNKFeBoE) |
| Magisterium done | yD9r0grKCkA [hr] |
| Magisterium failed | yD9r0grKCkA [en] (ETIMEDOUT) |
| Magisterium red | g9w5zmNaVoI [hr] u radu (objava upitna), ostale pjesme [hr] queued |
| Zaostatak | NamKWyUNrbU [hr] `running` od 23.09. — treba ručni UPDATE |
