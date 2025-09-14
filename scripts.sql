-- Optional but recommended for bulk loads
SET @old_fk = @@foreign_key_checks; SET FOREIGN_KEY_CHECKS = 0;
SET @old_uc = @@unique_checks;      SET UNIQUE_CHECKS      = 0;
SET @old_ai = @@auto_increment_increment; SET auto_increment_increment = 1;

CREATE DATABASE IF NOT EXISTS mb_min
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
USE mb_min;

-- Tag dictionary (we only need id and name)
CREATE TABLE tag (
  id   INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Recording ↔ tag votes (count = vote count / weight)
CREATE TABLE recording_tag (
  recording_id INT UNSIGNED NOT NULL,
  tag_id       INT UNSIGNED NOT NULL,
  count        INT NOT NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Helper set of recording ids that actually have tags
CREATE TABLE rec_with_tags (
  recording_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (recording_id)
) ENGINE=InnoDB;

-- Tiny staging table for a subset of recording columns (id, gid, name)
-- We only load the three columns we care about to keep this small.
CREATE TABLE recording_stage (
  id   INT UNSIGNED NOT NULL,
  gid  CHAR(36)     NOT NULL,
  name VARCHAR(500) NOT NULL
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

-- Final minimal recording table used by your APIs
CREATE TABLE recording_min (
  id        INT UNSIGNED NOT NULL,
  gid       CHAR(36)     NOT NULL,
  name      VARCHAR(500) NOT NULL,
  tag_count INT NOT NULL DEFAULT 0
) ENGINE=InnoDB ROW_FORMAT=DYNAMIC;

LOAD DATA LOCAL INFILE 'E:/UOL/2025 Fall/FYP/next-track-api/data/mbdump/tag'
INTO TABLE tag
CHARACTER SET utf8mb4
FIELDS TERMINATED BY '\t' ESCAPED BY '\\'
LINES TERMINATED BY '\n'
(id, name, @ignored);

LOAD DATA LOCAL INFILE 'E:/UOL/2025 Fall/FYP/next-track-api/data/mbdump/recording_tag'
INTO TABLE recording_tag
FIELDS TERMINATED BY '\t' ESCAPED BY '\\'
LINES TERMINATED BY '\n'
(recording_id, tag_id, count);

INSERT INTO rec_with_tags (recording_id)
SELECT DISTINCT recording_id FROM recording_tag;

LOAD DATA LOCAL INFILE 'E:/UOL/2025 Fall/FYP/next-track-api/data/mbdump/recording'
INTO TABLE recording_stage
CHARACTER SET utf8mb4
FIELDS TERMINATED BY '\t' ESCAPED BY '\\'
LINES TERMINATED BY '\n'
-- map first 3 columns into real columns; capture the rest into throwaway variables
(id, gid, name, @c4, @c5, @c6, @c7, @c8, @c9, @c10);

INSERT INTO recording_min (id, gid, name)
SELECT s.id, s.gid, s.name
FROM recording_stage AS s
JOIN rec_with_tags   AS r ON r.recording_id = s.id;

DROP TABLE recording_stage;

UPDATE recording_min AS rm
JOIN (
  SELECT recording_id, COUNT(*) AS tag_count
  FROM recording_tag
  GROUP BY recording_id
) AS t ON t.recording_id = rm.id
SET rm.tag_count = t.tag_count;

-- tag: lookups by id and (optionally) by name
ALTER TABLE tag
  ADD INDEX idx_tag_name (name);

-- recording_tag: composite PK for uniqueness + “reverse” index for tag → recordings
ALTER TABLE recording_tag
  ADD PRIMARY KEY (recording_id, tag_id),
  ADD KEY idx_tag_recording (tag_id, recording_id);

-- recording_min: primary key, unique MBID, fulltext on name for /resolve
ALTER TABLE recording_min
  ADD PRIMARY KEY (id),
  ADD UNIQUE KEY uq_gid (gid),
  ADD FULLTEXT KEY ft_name (name);

-- Helpful stats for the optimizer
ANALYZE TABLE tag, recording_tag, recording_min;

SELECT COUNT(*) AS tags            FROM tag;
SELECT COUNT(*) AS rec_tag_rows    FROM recording_tag;
SELECT COUNT(*) AS rec_with_tags   FROM rec_with_tags;
SELECT COUNT(*) AS recordings_kept FROM recording_min;
SELECT MIN(tag_count), AVG(tag_count), MAX(tag_count) FROM recording_min;

-- GET /resolve
-- exact, prefer richer tags (tag_count)
SELECT gid, name, id
FROM recording_min
WHERE name = ?
ORDER BY tag_count DESC
LIMIT 1;

-- fallback full‑text
SELECT gid, name, id, MATCH(name) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
FROM recording_min
WHERE MATCH(name) AGAINST (? IN NATURAL LANGUAGE MODE)
ORDER BY score DESC, tag_count DESC
LIMIT 1;

-- then fetch tags for that recording_id
SELECT t.name AS tag, rt.count
FROM recording_tag rt
JOIN tag t ON t.id = rt.tag_id
WHERE rt.recording_id = ?           -- id from the resolver
ORDER BY rt.count DESC
LIMIT 50;

-- POST /recommendations (tags‑only Jaccard)
-- 1) Map user MBIDs → recording ids
SELECT id FROM recording_min WHERE gid IN (?, ?, ...);

-- 2) Session tag set P (distinct tag names or just ids)
SELECT DISTINCT rt.tag_id
FROM recording_tag rt
WHERE rt.recording_id IN (?, ?, ...);

-- 3) Candidate overlaps: fast because of idx_tag_recording
SELECT rt.recording_id, COUNT(*) AS overlap
FROM recording_tag rt
WHERE rt.tag_id IN (?, ?, ...)             -- the P set
  AND rt.recording_id NOT IN (?, ?, ...)   -- exclude the input recordings
GROUP BY rt.recording_id
ORDER BY overlap DESC
LIMIT 1000;

-- 4) Get tag_count and display data for those candidates
SELECT id, gid, name, tag_count
FROM recording_min
WHERE id IN (?, ?, ...);
