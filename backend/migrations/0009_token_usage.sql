-- Potrošnja tokena po videu, izvučena iz Claude Code session datoteka (~/.claude/projects).
--
-- Koje sesije ulaze: SAMO `entrypoint = 'sdk-cli'` — to je headless `claude -p` koji pokreće
-- pipeline (Magisterium MCP runbook, `--gemini-backend claude`). Interaktivne sesije
-- (`entrypoint='cli'`) su čovjek za tipkovnicom i NE smiju se pripisati videu, iako često
-- spominju isti video ID.
--
-- Zašto se ne pamti trošak u dolarima: ovi runovi idu pod Claude Code PRETPLATOM, ne
-- per-token naplatom (vidi fetch.domovina.tv/CLAUDE.md — `--bare` je zabranjen upravo zato).
-- Prikazivati "$X" impliciralo bi naplatu koje nema. Držimo tokene; cijena je stvar plana.

CREATE TABLE IF NOT EXISTS token_usage (
  youtube_id             TEXT PRIMARY KEY,
  runs                   INTEGER NOT NULL DEFAULT 0,  -- broj headless sesija za ovaj video
  input_tokens           INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,  -- upis u prompt cache
  cache_read_tokens      INTEGER NOT NULL DEFAULT 0,  -- čitanje iz cachea (dominira kod dugih runbookova)
  output_tokens          INTEGER NOT NULL DEFAULT 0,
  models                 TEXT,                        -- CSV korištenih modela (npr. "claude-opus-5")
  first_at               INTEGER,                     -- unix sek, prva poruka najranije sesije
  last_at                INTEGER,                     -- unix sek, zadnja poruka najkasnije sesije
  source                 TEXT NOT NULL DEFAULT 'claude-code',
  updated_at             INTEGER NOT NULL
);

-- Sortiranje "najskuplji videi" bez table-scana.
CREATE INDEX IF NOT EXISTS idx_token_usage_out ON token_usage(output_tokens DESC);
