-- Magisterium: per-video namjera (default UKLJUČENO) + queue za one-click (re)obradu (HR/EN).
--
-- with_magisterium: želimo li Magisterium teološko obogaćivanje (KORAK 8.5) za ovaj video.
-- DEFAULT 1 → puna obrada je pretpostavka za SVE jobove (nove i postojeće); admin ga po
-- videu može isključiti. Utječe na status-prikaz ("čeka" umjesto "preskočeno") i na cron
-- auto-enqueue. Sama obrada ostaje zaseban MCP run (vidi fetch.domovina.tv MAGISTERIUM_MCP_RUN.md).
ALTER TABLE jobs ADD COLUMN with_magisterium INTEGER NOT NULL DEFAULT 1;

-- Magisterium request queue: admin gumb (ili cron auto-enqueue) upiše zahtjev; bridge poller
-- na Mac Miniju ga claima i pokrene MCP runbook headless. Ključano po youtube_id — radi i za
-- videe kojih NEMA u `jobs` (već objavljeni kroz glavni pipeline, a Magisterium im nedostaje).
CREATE TABLE IF NOT EXISTS magisterium_jobs (
  id           TEXT PRIMARY KEY,
  youtube_id   TEXT NOT NULL,
  lang         TEXT NOT NULL DEFAULT 'hr',       -- 'hr' (default) | 'en' (overlay, samo eksplicitno)
  state        TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
  source       TEXT NOT NULL DEFAULT 'admin',    -- 'admin' (gumb) | 'auto' (cron)
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  claimed_at   INTEGER,
  done_at      INTEGER
);

-- Claim po redoslijedu (state='queued' ORDER BY created_at) bez table-scana.
CREATE INDEX IF NOT EXISTS idx_mag_jobs_claim ON magisterium_jobs(state, created_at);
-- Najviše jedan AKTIVAN (queued/running) zahtjev po (video, jezik) — sprječava duple runove.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mag_jobs_active
  ON magisterium_jobs(youtube_id, lang) WHERE state IN ('queued', 'running');
