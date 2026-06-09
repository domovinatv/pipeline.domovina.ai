-- Dodatni YouTube metapodaci na jobu za pregled queuea (i za API-submittane jobove).
-- channel: kanal (oEmbed author_name pri unosu za public; bridge backfilla iz info.json za sve).
-- duration_seconds: trajanje (samo iz info.json nakon downloada — oEmbed ga ne daje).
-- Thumbnail se NE sprema (deterministički https://i.ytimg.com/vi/{id}/mqdefault.jpg, radi i za unlisted).
ALTER TABLE jobs ADD COLUMN channel TEXT;
ALTER TABLE jobs ADD COLUMN duration_seconds INTEGER;
