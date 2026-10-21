-- Broj sekcija najnovijeg članka (Σ iterations[].sections). Trajanje Magisterium EN prijevoda
-- skalira ~100 s po sekciji (fetch.domovina.tv/docs/2026-08-29-magisterium-en-overlay-trosak.md),
-- a poller prekida run nakon 60 min → admin upozori prije 🕊 EN za duge članke.
ALTER TABLE episodes ADD COLUMN article_sections INTEGER;
