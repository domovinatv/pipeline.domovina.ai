-- Soft-delete: reverzibilno "brisanje" iz admin liste bez gubitka zapisa.
-- deleted_at IS NULL → živ job; IS NOT NULL → soft-deleted (strikethrough u adminu).
-- Ortogonalno na `state` (čuva izvorno stanje za restore). Claim i dedup ignoriraju
-- soft-deleted redove. Trajno (nepovratno) brisanje i dalje radi DELETE retka.
ALTER TABLE jobs ADD COLUMN deleted_at INTEGER;
