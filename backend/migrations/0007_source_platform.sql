-- Izvor videa kao EKSPLICITNA metadata (ne izvodivo iz youtube_id-a).
--
-- Za X/Twitter jobove youtube_id je SINTETIČKI (sha256(URL)→11 znakova, vidi
-- util.ts:synthIdFromUrl) pa se iz njega NE može rekonstruirati YouTube ni X link —
-- UI je gradio slomljeni `youtu.be/<synthId>` + ytimg thumbnail. Ova dva stupca drže
-- pravi izvor da UI linka na originalni post:
--   source_platform : 'youtube' | 'x'  — koja platforma je izvor
--   source_url      : kanonski originalni URL (X post URL / YouTube watch URL)
--
-- youtube_url ostaje (bridge ga čita kao --unlisted-url); source_url je honesti,
-- platform-neutralni "odakle je ovo došlo" pokazivač koji čitaju consumeri/UI.
ALTER TABLE jobs ADD COLUMN source_platform TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE jobs ADD COLUMN source_url TEXT;

-- Backfill postojećih redaka: source_url = kanonski izvor (dosad u youtube_url).
UPDATE jobs SET source_url = youtube_url WHERE source_url IS NULL;

-- X jobovi (source 'x-api'/'x-admin', ili X URL zapisan u youtube_url) → platforma 'x'.
UPDATE jobs SET source_platform = 'x'
 WHERE source LIKE 'x%'
    OR youtube_url LIKE 'https://x.com/%'
    OR youtube_url LIKE 'https://twitter.com/%'
    OR youtube_url LIKE 'https://www.x.com/%'
    OR youtube_url LIKE 'https://mobile.x.com/%';
