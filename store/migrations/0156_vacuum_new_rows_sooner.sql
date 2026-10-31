-- 0156_vacuum_new_rows_sooner.sql
--
-- NEW ROWS MARKED VISIBLE WITHIN ABOUT AN HOUR, SO THE READS THAT ONLY NEED AN INDEX STOP READING
-- THE TABLE: the readings, the coins, their metadata and the picture hashes.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- On 2026-10-30 the database was disk-bound and For You's rebuild took 5–17 minutes. Several of its
-- reads are answered by an index alone — the readings counted per post over the week
-- (observation_pkey), the coins minted in an hour (asset_minted_logo_idx), a coin's logo link
-- (coin_metadata_read_logo_idx) — but Postgres may skip the table only for pages its visibility
-- map marks all-visible, and only VACUUM sets that mark. An append-mostly table is vacuumed for its
-- inserts once they pass 20% of its size: 1.2 million readings, about three days at today's rate.
-- So the newest rows, which are the ones these reads ask for, were always fetched from the table: a
-- count of 1,000 posts' readings fetched 7,362 of 7,362 rows from the heap, and the hour digest of
-- the picture search 89,844 of 91,000 coins.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
-- Each table is vacuumed for its inserts after a fixed count instead of a share of its size:
-- 20,000 readings (about an hour), 5,000 coins, metadata rows or picture hashes (a few hours of
-- launches). A vacuum of inserted rows only reads the pages they landed on, which are the pages
-- the frames just read, so the extra vacuum work is small next to the heap reads it saves.
-- Nothing a statement returns changes; only which pages it must read to return it.
--
-- What breaks if changed carelessly: a threshold far lower (a few hundred rows) keeps autovacuum
-- busy on these tables all day and competes with the frames for the same disk.

alter table public.observation set (autovacuum_vacuum_insert_threshold = 20000, autovacuum_vacuum_insert_scale_factor = 0);
alter table public.asset set (autovacuum_vacuum_insert_threshold = 5000, autovacuum_vacuum_insert_scale_factor = 0);
alter table internal.coin_metadata set (autovacuum_vacuum_insert_threshold = 5000, autovacuum_vacuum_insert_scale_factor = 0);
alter table internal.image_hash set (autovacuum_vacuum_insert_threshold = 5000, autovacuum_vacuum_insert_scale_factor = 0);
