-- 0147_logo_lookup_idx.sql
--
-- THE PROJECTOR'S PICTURE LOOKUP, FROM TWO NARROW INDEXES INSTEAD OF TWO TABLES (2026-10-27, the
-- evening For You's full frame timed out on most runs while the database was disk-bound).
--
-- Post matching widens each For You post's coin candidates with the coins whose logo looks like the
-- post's picture (store/src/repo/image-hash.ts `neighbours`): every coin minted across the window of
-- the frame's posts, its logo (coin_metadata's read image, else the asset's own), and that logo's
-- hash. Measured that evening on a three-day window: 14 s, of which 10.5 s was fetching 130,000
-- asset rows one by one from the heap and 2.2 s a full read of coin_metadata (168 MB) — for three
-- columns of each.
--
-- Each index carries exactly the columns the lookup reads, so it is answered from the index alone:
--
--   asset_minted_logo_idx         minted_at, with address, asset_key and image_uri
--   coin_metadata_read_logo_idx   asset_key → image_uri, for the rows read ('read')
--
-- HOW IT IS APPLIED: built first by hand with CREATE INDEX CONCURRENTLY, as 0146 was (the migrator
-- runs a file in one transaction, where CONCURRENTLY cannot run, and a plain build would hold the
-- launch stream's writes to public.asset for the build). This file then finds them built.
--
-- What breaks if changed carelessly: the INCLUDE lists. Drop a column the lookup selects and the
-- planner goes back to the heap for every row, which is the cost this file exists to remove.

create index if not exists asset_minted_logo_idx on public.asset (minted_at) include (address, asset_key, image_uri)
  where minted_at is not null;

create index if not exists coin_metadata_read_logo_idx on internal.coin_metadata (asset_key) include (image_uri)
  where outcome = 'read';
