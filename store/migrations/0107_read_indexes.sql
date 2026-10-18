-- 0107_read_indexes.sql
--
-- THE READ SERVICE'S MISSING INDEXES: the Narratives tab's New and Most viewed lists, a token
-- page's narrative, and a token page's posts.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- Measured 18 Oct 2026 with EXPLAIN ANALYZE against the live store (405 pages in story_view):
--
--   GET /narratives/:view/all?sort=new|viewed  read every page in full to keep the observed ones
--     (`payload #>> '{provenance,kind}' = 'observed'`), then sorted: a sequential scan that
--     unpacks every page's JSON, 28-38 ms, growing with every narrative ever kept (0106 keeps them
--     all now). 0106's found_at and views_total indexes were never used, because the filter they
--     needed sat inside the JSON. Indexed on that filter first and the order after, a page of 20
--     reads 20 index entries.
--   GET /coin/:id/about's narrative (COIN_STORY_SQL)  a sequential scan unpacking every page to
--     find the one whose coin is this one: 70 ms. Indexed on the two places a page names its coin.
--   GET /coin/:id/about's posts (POSTS_SQL)  same_name_coin by address had no index (its key starts
--     with the subject): a sequential scan of ~4,000 rows on every token page.
--
-- The read service now keeps these replies ready in memory (services/read prepared.ts), so these
-- statements run behind requests rather than in front of them; they still run on every frame and
-- every cold token page, and the lists' two scans grow without bound.
--
-- ── HOW THIS IS APPLIED WITHOUT LOCKING WRITES ─────────────────────────────
--
-- The migrator runs each file inside one transaction (store/src/migrate.ts), and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction. A plain CREATE INDEX takes a SHARE lock: reads go
-- on, writes to that table wait until the build ends. On these tables the build is milliseconds
-- (story_view ~400 rows, same_name_coin ~4,000), so the plain build here is safe as written: the
-- projector's next write waits that long at most.
--
-- To add them with no write lock at all, run these same statements with CONCURRENTLY first, outside
-- a transaction (psql as the service role), then deploy: every statement below is `if not exists`
-- with the same name, so the migration finds each index and builds nothing:
--
--   create index concurrently if not exists story_view_observed_found_idx on public.story_view ((payload #>> '{provenance,kind}'), found_at desc nulls last, story_id);
--   (and likewise for the other four)
--
-- If a concurrent build fails it leaves an INVALID index of that name; drop it and build again
-- before deploying, or the `if not exists` below will keep the broken one.
--
-- What breaks if changed carelessly: the list statements must keep their filter spelled exactly
-- `payload #>> '{provenance,kind}'` and their order exactly as indexed, or the planner goes back to
-- the scan. Code does not depend on these: without them every read returns the same rows, slowly.

create index if not exists story_view_observed_found_idx
  on public.story_view ((payload #>> '{provenance,kind}'), found_at desc nulls last, story_id);

create index if not exists story_view_observed_views_idx
  on public.story_view ((payload #>> '{provenance,kind}'), views_total desc nulls last, story_id);

create index if not exists story_view_coin_idx
  on public.story_view ((payload #>> '{coins,coin,address}'))
  where payload #>> '{coins,kind}' = 'one';

create index if not exists story_view_top_coin_idx
  on public.story_view ((payload #>> '{topCoin,address}'));

create index if not exists same_name_coin_address_idx
  on public.same_name_coin (address, subject_kind);
