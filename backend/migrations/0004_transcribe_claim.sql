-- Transcription claim/lock: koji backend (colab|modal) drži transkripciju danog videa
-- i kad ga je zauzeo. Sprječava da Colab Canary batch i Modal serverless GPU
-- transkribiraju ISTI _unlisted WAV paralelno (dupli rad/trošak).
-- Aditivno; NULL = nema claima = staro ponašanje (oba backenda smiju raditi fajl).
-- transcribe_claimed_at je unix sekunde (kao claimed_at) radi jedinstva s nowSec()/sweepStuckFetching.
ALTER TABLE jobs ADD COLUMN transcribe_backend TEXT;       -- NULL | 'colab' | 'modal'
ALTER TABLE jobs ADD COLUMN transcribe_claimed_at INTEGER; -- unix sekunde kad je lock uzet

CREATE INDEX IF NOT EXISTS idx_jobs_transcribe ON jobs(state, transcribe_backend);
