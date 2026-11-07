-- Stvarni LLM izvor koraka 7+8 (i reelsa 9.9) po jobu (07.11.2026.).
--
-- `llm_backend`/`llm_model` je ono što je job TRAŽIO. Od 07.11.2026. bridge za Tier 2
-- jobove pregazi backend (bridge/plan.js, TIER2_LLM_BACKEND, default 'agy'): sažetak,
-- članak i reels idu kroz `agy` u tmuxu (Gemini 3.8 Flash low), a job i dalje kaže
-- claude:opus. Bridge javi stvarni izvor uz PATCH state='transcribing'.
--
-- llm_provider: '<backend>[:<model>]', backend ∈ agy|claude|cli|vertex, npr.
-- 'agy:gemini-3.8-flash-low' ili 'claude:opus'. NULL = nepoznato / stari reci.
ALTER TABLE jobs ADD COLUMN llm_provider TEXT;
