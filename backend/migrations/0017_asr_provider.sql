-- Stvarni ASR izvor teksta epizode (04.11.2026.).
--
-- `transcription` je ono što je job TRAŽIO (default 'soniox'). Od 02.11.2026. bridge bira
-- ASR po tieru (ASR_PRIMARY): praćeni kanali Soniox, sve ostalo Speechmatics, uz fallback.
-- Admin je zato svim jobovima pokazivao „🎙 Soniox", iako je 41/43 Tier 2 epizoda prošlo
-- kroz Speechmatics. Bridge nakon obrade pogleda disk i javi stvarni izvor.
--
-- asr_provider: 'soniox' | 'speechmatics' | 'canary' | NULL (još nije poznato / stari reci).
ALTER TABLE jobs ADD COLUMN asr_provider TEXT;
