-- 0024_feed_floor.sql
--
-- WHERE THE CATCH-ALL SEARCH'S APPROVAL FLOORS ARE KEPT BETWEEN PASSES.
--
-- Discovery now searches for whatever is moving, with no keyword, and the only thing that
-- bounds what that costs is each lane's floor — "only posts with at least N approvals" —
-- which moves after every pass toward a target derived from the daily budget (core's
-- `nextFloor`). A floor held only in memory would reset on every restart to its starting
-- value, so a deploy at noon would re-learn the morning's floor by overspending or
-- returning nothing until it got there again. One row per lane, updated in place: this
-- is the floor NOW, not a history. The history is the spend ledger and the run log.
--
-- `internal`, with no grant: the app role has no USAGE on this schema, and a floor is a
-- fact about our own costs, not about the world.

create table internal.feed_floor (
  -- The lanes are core's FEED_LANES; store/src/migrations.test.ts keeps the two lists equal.
  lane        text primary key check (lane in ('all', 'media')),
  floor       integer not null check (floor > 0),
  updated_at  timestamptz not null
);

comment on table internal.feed_floor is
  'The current approval floor of each catch-all search lane. Moved after every live discovery pass toward a per-pass target derived from the daily budget. A cost control at the vendor, never an admission rule.';
