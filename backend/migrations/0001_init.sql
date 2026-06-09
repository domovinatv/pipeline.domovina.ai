-- pipeline.domovina.ai — ad-hoc/unlisted pipeline obrada queue.
--
-- Job životni ciklus (odražava multi-pass realnost: Canary transkripcija je
-- ručni Colab korak između prolaza pipelinea, pa se job NE dovrši u jednom runu):
--
--   queued → fetching → transcribing → processing → done
--                                                  ↘ failed
--
--   queued       admin/API ubacio, čeka da ga lokalni bridge pokupi
--   fetching     bridge claimao, yt-dlp skida video u _unlisted/
--   transcribing video skinut + WAV na Google Driveu, čeka Colab Canary
--   processing   .canary.srt stigao, lokalna diarizacija + Gemini AI lanac teku
--   done         data/{id}/article.json živ na CDN-u, detail_url spreman
--   failed       trajna greška (yt-dlp private/unavailable, itd.)

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,                       -- random uuid
  youtube_id   TEXT NOT NULL,                          -- 11-znamenkasti YT id (može počinjati s '-')
  youtube_url  TEXT NOT NULL,                          -- kanonski watch URL
  title        TEXT,                                   -- opcijski naslov (admin upisao)
  source       TEXT NOT NULL DEFAULT 'admin',          -- 'admin' | 'api'
  api_key_id   TEXT,                                   -- FK → api_keys.id (NULL za admin)
  state        TEXT NOT NULL DEFAULT 'queued',         -- vidi gore
  visibility   TEXT NOT NULL DEFAULT 'unlisted',       -- zasad uvijek unlisted
  detail_url   TEXT,                                   -- https://domovina.ai/v/{id} kad done
  error        TEXT,                                   -- zadnja greška kad failed
  attempts     INTEGER NOT NULL DEFAULT 0,
  -- Billing skela (SaaS vizija; zasad ugašeno — price_cents informativan, paid ignoriran):
  price_cents  INTEGER NOT NULL DEFAULT 0,
  paid         INTEGER NOT NULL DEFAULT 0,             -- 0/1; gate se UPALI kad se naplata uključi
  created_at   INTEGER NOT NULL,                       -- unix sekunde
  updated_at   INTEGER NOT NULL,
  claimed_at   INTEGER,
  done_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_state_created ON jobs(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created       ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_youtube       ON jobs(youtube_id);

-- API ključevi (SaaS vizija — €1/video prodaja). Tablica postoji od dana 1 da
-- kasnije ne treba migracija, ali NIJE ožičena u auth putu dok se naplata ne upali.
-- Naplata se planira spojiti na postojeći pay.domovina.ai payment-intents.
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,                   -- SHA-256 sirovog ključa
  credits      INTEGER NOT NULL DEFAULT 0,             -- preplaćeni krediti za obradu
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
