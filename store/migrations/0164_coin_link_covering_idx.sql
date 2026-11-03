-- 0164_coin_link_covering_idx.sql
--
-- A NEW COIN'S OWN LINKS READ FROM ONE SMALL INDEX, NOT ONE METADATA ROW PER COIN (2026-11-03, the
-- database at 99% that night; the owner demoing in person every day that week).
--
-- The runner's name-example sync (store name-examples.ts `fromDatabase`, linked, every 15 minutes)
-- reads public.coin_link (0059: internal.coin_metadata where outcome = 'read' and a link is set) for
-- every coin minted in the last two days. Measured that night: 72,783 coins, one metadata row each,
-- 10,852 pages from disk, 21 s for that step alone; pg_stat_statements had the whole statement at
-- 6,770 calls averaging 22.8 s, among the heaviest on the database.
--
-- This partial index holds exactly coin_link's rows, keyed by the coin, carrying the three links: the
-- view's read becomes an index-only scan of a few pages per hundred coins. Same rows, same values: an
-- index changes how they are found, never which.
--
-- HOW IT IS APPLIED: as 0146, 0160 and 0161, built first by hand with CREATE INDEX CONCURRENTLY (the
-- migrator runs each file in a transaction, where CONCURRENTLY cannot run, and a plain build would
-- hold the metadata reader's writes). This file then finds it built and does nothing. On a fresh
-- database the table is small and the plain build here is instant.
--
-- What breaks if changed carelessly: the WHERE must stay coin_link's own filter and the INCLUDE must
-- carry every column the view returns, or the planner goes back to the table for each coin.

create index if not exists coin_metadata_link_idx on internal.coin_metadata (asset_key)
  include (social_link, website, chat_link)
  where outcome = 'read' and (social_link is not null or website is not null or chat_link is not null);
