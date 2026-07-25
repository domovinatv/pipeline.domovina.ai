-- "Otkriveni videi" — dnevna podlista svega što je noćni pipeline NOVO povukao.
--
-- Zašto ZASEBNA tablica, a ne novo stanje u `jobs`:
--   `jobs` je queue OBRADE — svaki redak je namjera da se nešto obradi (claim, krediti,
--   priority tier, transcribe lock). Otkriveni video NIJE namjera obrade; on je samo
--   zapis "ovo je sinoć stiglo". Kad bi živio u `jobs`, zagadio bi countByState, claim
--   upite i dedup (findActiveJobByYoutubeId), a bridge bi ga mogao slučajno pokupiti.
--   Odvojena tablica = queue koji se GLEDA, a tek na klik postaje queue koji se RADI.
--
-- Tok: nightly (report_discovered.js) upiše retke → admin /admin/discovered vidi podlistu
-- po danu → jedan klik "⚡ Prioritet" stvori pravi `jobs` redak (priority=1) i ovdje
-- zapiše state='promoted' + job_id. Promoted redak ostaje vidljiv kao trag.

CREATE TABLE IF NOT EXISTS discovered_videos (
  id               TEXT PRIMARY KEY,
  youtube_id       TEXT NOT NULL UNIQUE,          -- 11-znakovni ID iz `_yt_<id>` u basenameu
  youtube_url      TEXT NOT NULL,                 -- kanonski watch URL (za promote → fetch.js)
  title            TEXT,
  channel          TEXT,                          -- ime kanala iz info.json (ljudsko)
  channel_dir      TEXT,                          -- slug direktorija u storage/output (pipeline)
  duration_seconds INTEGER,
  published_at     TEXT,                          -- YYYYMMDD prefiks basenamea (datum epizode)
  batch_date       TEXT NOT NULL,                 -- YYYY-MM-DD dan OTKRIĆA = podlista u adminu
  -- Dokle je video stigao lokalno u trenutku zadnjeg izvještaja. Bridge ga računa s diska
  -- (postojanje .wav / .canary.srt / .canary.diarized.srt / *.article.json) i osvježava ga
  -- na svakom nightlyju — zato podlista pokazuje ŽIVO stanje, ne samo "stiglo je".
  stage            TEXT NOT NULL DEFAULT 'fetched',
  -- 0 = nema pravi YouTube izvor (beamly audio-only sa sintetičkim ID-em) → promote bi pao
  -- na yt-dlp-u, pa admin UI za takve ne nudi gumb. Vidi MEMORY: beamly-audio-only marker.
  promotable       INTEGER NOT NULL DEFAULT 1,
  source_platform  TEXT NOT NULL DEFAULT 'youtube', -- 'youtube' | 'beamly'
  state            TEXT NOT NULL DEFAULT 'new',   -- new | promoted | dismissed
  job_id           TEXT,                          -- jobs.id kad je promoviran (trag prema queueu)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  promoted_at      INTEGER
);

-- Podliste po danu (admin grupira po batch_date DESC).
CREATE INDEX IF NOT EXISTS idx_disc_batch ON discovered_videos(batch_date DESC, created_at DESC);
-- Filtriranje po stanju unutar podliste + stat trake.
CREATE INDEX IF NOT EXISTS idx_disc_state ON discovered_videos(state, batch_date DESC);
