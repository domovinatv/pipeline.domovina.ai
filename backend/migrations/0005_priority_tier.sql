-- Priority tier: 0 = standard (noćni Colab bulk, jeftino), 1 = prioritet/instant (Modal fast-path).
-- credit_cost = koliko je kredita rezervirano za ovaj job (1 standard, 3 prioritet). Omogućuje
-- "forsiraj sada" upgrade (naplati razliku) i točan prikaz troška po jobu.
-- Aditivno; DEFAULT-i → svi postojeći jobovi ostaju standard, credit_cost=1 (staro ponašanje).
ALTER TABLE jobs ADD COLUMN priority    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN credit_cost INTEGER NOT NULL DEFAULT 1;

-- Claim po prioritetu bez table-scana: WHERE state='queued' [AND priority>0] ORDER BY priority DESC, created_at ASC.
CREATE INDEX IF NOT EXISTS idx_jobs_priority_claim ON jobs(state, priority, created_at);
