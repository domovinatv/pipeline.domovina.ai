-- Odgoda koraka 7+8 zbog ograde Claude prozora (fetch.domovina.tv lib/claude_window.js).
--
-- priority_worker.sh vrti run uz CLAUDE_WINDOW_GUARD=1: između ~03:30 i 08:30 nov Opus poziv
-- otvorio bi 5h prozor kvote živ u 08:30, pa koraci 7+8 epizodu ODGODE. Run prođe bez
-- članka, job ostane u processing, a ništa ga ne vraća u red do idućeg nightlyja (29.10.2026.,
-- MNk-eEpDb3E: prijepis gotov za 3,5 min, članak bi čekao ~22 h). Admin to nije vidio.
--
-- llm_deferred: razlog odgode koji je bridge javio (NULL = nije odgođen). Briše se kad job
--               dođe u done ili kad admin klikne „Pokreni ipak sada".
-- llm_force:    1 = admin je svjesno pristao otvoriti nov prozor kvote; bridge tada vrti
--               run BEZ ograde (CLAUDE_WINDOW_GUARD=0).
ALTER TABLE jobs ADD COLUMN llm_deferred TEXT;
ALTER TABLE jobs ADD COLUMN llm_force INTEGER NOT NULL DEFAULT 0;
