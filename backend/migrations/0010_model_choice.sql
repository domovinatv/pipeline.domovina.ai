-- Izbor modela po videu za AI korake pipelinea (koraci 7+8 i 8.5 u fetch.domovina.tv).
--
-- Do sada je izbor bio implicitan i globalan: koraci 7 (sažetak) + 8 (članak) uvijek na
-- Vertex Gemini (`gemini.conf:GEMINI_MODEL`), Magisterium (8.5) uvijek na `claude --model opus`.
-- Mehanika zamjene VEĆ postoji u `run_pipeline.sh` (`--gemini-backend vertex|cli|claude`
-- + `CLAUDE_MODEL`/`CLAUDE_EFFORT` env), ali je bridge nikad nije prosljeđivao. Ove kolone
-- su nedostajuća karika: admin bira po videu, bridge prevede u zastavice pri pokretanju.
--
-- Aditivno; DEFAULT-i reproduciraju današnje ponašanje za sve postojeće retke.

-- Koraci 7+8: koji backend i koji model generiraju sažetak + outline + article.json.
-- llm_backend: 'vertex' (Vertex AI REST) | 'cli' (gemini CLI) | 'claude' (Claude Code pretplata)
-- llm_model:   NULL = default tog backenda (gemini.conf GEMINI_MODEL, odnosno CLAUDE_MODEL);
--              inače konkretan slug ('opus' | 'sonnet' | 'haiku').
ALTER TABLE jobs ADD COLUMN llm_backend TEXT NOT NULL DEFAULT 'vertex';
ALTER TABLE jobs ADD COLUMN llm_model   TEXT;

-- Korak 8.5: model za Magisterium MCP runbook. NULL = 'opus' (dosadašnji fiksni izbor).
-- Živi na `jobs` (a ne samo na magisterium_jobs) jer je to NAMJERA po videu — kao
-- `with_magisterium` — pa je naslijede i admin gumb i cron auto-enqueue.
ALTER TABLE jobs ADD COLUMN magisterium_model TEXT;

-- Isti izbor, razriješen u trenutku enqueuea, na samom zahtjevu — poller čita samo ovo
-- (ne mora natrag u `jobs`, a zahtjev može postojati i za video kojeg u `jobs` uopće nema).
ALTER TABLE magisterium_jobs ADD COLUMN model TEXT;
