-- „Ponovna obrada" već objavljene epizode iz admina — paritet s ručnim radom iz
-- fetch.domovina.tv Claude Code sesije (handoff 2026-10-08-2345).
--
-- reprocess:    1 = epizoda je već objavljena, ovo je NAMJERNA ponovna obrada. Bridge tada
--               nakon runa prepiše channel dir i CDN (auto_reuse_adhoc.js --replace), a
--               Magisterium ide s force (CDN pre-check se preskače).
-- redo_article: 0 = ne diraj postojeći članak (samo za reprocess bez novog prijepisa —
--               novi prijepis UVIJEK povlači novi članak, inače poglavlja/citati ne odgovaraju).
-- Prijepis: postojeća kolona `transcription` dobiva i vrijednost 'none' (= ne diraj),
-- dopuštenu samo uz reprocess=1.
ALTER TABLE jobs ADD COLUMN reprocess INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN redo_article INTEGER NOT NULL DEFAULT 1;

-- force: 1 = regeneriraj iako artefakt već postoji na CDN-u (ponovna obrada: stari
-- Magisterium referira poglavlja i vremena STAROG članka). Poller tada preskače CDN
-- pre-check i za uspjeh traži artefakt NOVIJI od claima.
ALTER TABLE magisterium_jobs ADD COLUMN force INTEGER NOT NULL DEFAULT 0;
