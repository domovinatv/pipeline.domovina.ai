# Stvarni LLM izvor po jobu (`llm_provider`, v0.22.0) — 07.11.2026.

## Zašto

Od 07.11.2026. bridge Tier 2 jobovima pregazi traženi backend koraka 7+8 (i reelsa 9.9):
`bridge/plan.js` `planFor`, `TIER2_LLM_BACKEND` (default `agy`) → sažetak, članak i reels
idu kroz `agy` u tmuxu (`../fetch.domovina.tv/lib/agy_tmux.js`, `gemini-3.8-flash-low`).
Job u D1 i dalje ima `llm_backend='claude'`, `llm_model='opus'`, pa je admin pokazivao Opus.
Isti problem kao ASR (`asr_provider`, 0017, 04.11.): job nosi TRAŽENO, bridge javlja STVARNO.

## Ugovor

- Stupac `jobs.llm_provider TEXT NULL` (migracija `0018_llm_provider.sql`).
- Format `'<backend>[:<model>]'`, regex `^(agy|claude|cli|vertex)(:[A-Za-z0-9._-]+)?$`, ≤80 znakova.
  Primjeri: `agy:gemini-3.8-flash-low`, `claude:opus`. `NULL` = nepoznato / stari reci.
- `PATCH /api/jobs/:id` (Bearer `INGEST_KEY`) prima `llm_provider`; `null` briše.
  Nevaljana vrijednost se **tiho ignorira** (kao `asr_provider`), nema 400.
- `agy` namjerno NIJE u `LLM_BACKENDS`: job se i dalje kreira kao claude, override radi bridge.
- Bridge šalje polje uz postojeći PATCH `state:'transcribing'` u `priority_poller.js`
  (radi ga fetch-domovina-tv sesija).

## UI

`modelBadge()` u `src/ui/client.ts` (dijele ga /admin i /dashboard): s `llm_provider` pill
„🤖 agy · gemini-3.8-flash-low (tmux)”, title „Traženo: claude:opus”. Kad se stvarno i traženo
razlikuju → klasa `.pill.model.differs` (amber). Ta klasa postoji samo u `src/admin/views.ts`,
pa je na /dashboardu pill bez amber isticanja.

## Otvoreno

- Bridge commit u `priority_poller.js` (+ `plan.js`) — druga sesija.
- Backfill prvih 10 `done` Tier 2 jobova (PATCH po jobu).
- Pill nije vizualno provjeren (desktop ni mobile).
