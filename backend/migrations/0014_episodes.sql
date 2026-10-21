-- Inventar SVIH epizoda na disku Mac Minija + stanje po koraku (/admin/episodes).
--
-- Zašto zasebna tablica (a ne jobs / discovered_videos):
--   • `jobs` je queue OBRADE — epizoda iz nightlyja nema job i ne smije ga dobiti samim
--     time što postoji (zagadila bi claim/dedup/limite reda).
--   • `discovered_videos` je dnevni PRILJEV (zadnjih 26 h) s admin stanjem new/promoted.
--   • `episodes` je cijeli katalog na disku, uključujući EN kanale kojih podcast.domovina.ai
--     nema. Puni ga bridge/report_inventory.js (disk-scan, bez vremenskog prozora, nula LLM
--     poziva). Ključ je youtube_id, bez FK na jobs — veza se radi po youtube_id u upitu.
--
-- Vrijednosti koraka: 'ok' | 'missing' | 'blocked' (*.blocked.json marker) |
--   'partial' (npr. postoji samo za stariji članak, ili je članak krnji) | 'na' (ne primjenjuje
--   se — audio-only epizoda nema screenshotove). NULL = još nije provjereno (cdn dok se redak
--   ne otvori u adminu).
--
-- Faza 3 („dodaj samo što fali") filtrira po ovim stupcima i stvara zahtjeve u postojećim
-- queueovima (magisterium_jobs, jobs reprocess) — ova tablica ostaje čisti opis stanja.

CREATE TABLE IF NOT EXISTS episodes (
  youtube_id       TEXT PRIMARY KEY,
  channel_dir      TEXT NOT NULL,                 -- slug u storage/output (pipeline)
  channel          TEXT,                          -- ljudsko ime kanala iz info.json
  title            TEXT,
  upload_date      TEXT,                          -- YYYYMMDD (info.json, inače prefiks basenamea)
  duration_seconds INTEGER,
  audio_only       INTEGER NOT NULL DEFAULT 0,    -- beamly bez YT matcha (nema video/screenshotove)
  -- Koraci (redoslijed = run_pipeline.sh)
  fetch            TEXT NOT NULL DEFAULT 'missing',
  transcript       TEXT NOT NULL DEFAULT 'none',  -- speechmatics | canary | none
  diarized         TEXT NOT NULL DEFAULT 'missing',
  summary          TEXT NOT NULL DEFAULT 'missing',
  article          TEXT NOT NULL DEFAULT 'missing',
  article_model    TEXT,                          -- slug iz imena najnovijeg članka (opus, gemini-2.5-flash…)
  article_date     TEXT,                          -- YYYY-MM-DD iz imena najnovijeg članka
  rag              TEXT NOT NULL DEFAULT 'missing',
  screenshots      TEXT NOT NULL DEFAULT 'missing',
  epub             TEXT NOT NULL DEFAULT 'missing',
  words            TEXT NOT NULL DEFAULT 'missing',
  magisterium_hr   TEXT NOT NULL DEFAULT 'missing',
  magisterium_en   TEXT NOT NULL DEFAULT 'missing',
  article_en       TEXT NOT NULL DEFAULT 'missing',
  cdn              TEXT,                          -- NULL dok Worker ne proba CDN (lazy, kad se redak otvori)
  cdn_checked_at   INTEGER,
  -- Potpis stanja s diska: upsert piše redak samo kad se nešto promijenilo (nightly šalje
  -- cijeli katalog, a D1 naplaćuje pisanje po retku).
  sig              TEXT,
  first_seen_at    INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL               -- zadnja promjena stanja (ne zadnji sken — vidi sig)
);

CREATE INDEX IF NOT EXISTS idx_ep_channel ON episodes(channel_dir, upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_ep_upload ON episodes(upload_date DESC);
