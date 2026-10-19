-- 0111_feed_lang_floor.sql
--
-- EACH LANGUAGE'S OWN FLOOR ON THE NEWEST-POSTS SEARCH, KEPT BETWEEN PASSES.
--
-- The newest-posts search (the fresh bands, Policy.feed.fresh) is asked once per language, because
-- the posts supplier answers an OR of languages with the last one only (2026-10-16). Until now the
-- languages shared one floor, internal.feed_floor's 'all' row, moved by all their posts together:
-- with eight languages a busy one raised English's floor, and the floor went from about 100 likes on
-- 16 Oct to about 510 on 19 Oct while the English posts it buys did not change. From
-- Policy.feed.langSplit each language has its own floor, moved toward its own share of the bands'
-- money; this is where those floors outlive a restart, for the reason 0024 gives for the lanes' own.
--
-- One row per language, updated in place: the floor NOW, not a history. A language with no row
-- starts at the shared 'all' floor (services/runner work/discover.ts) and moves from there.
--
-- ★ ITS OWN TABLE, NOT MORE VALUES IN feed_floor's LANE CHECK. That check is the lane vocabulary,
-- pinned to FEED_LANES by store/src/migrations.test.ts; a language is not a lane, and a list of
-- languages written into a CHECK would need a migration every time the owner adds one.
--
-- `internal`, with no grant: a floor is a fact about our own costs, not about the world.
-- What breaks if changed carelessly: keying it by anything but the language code the adapter sends
-- (lower-case, as in Policy.feed.langs) starts that language from the shared floor on every pass.

create table internal.feed_lang_floor (
  lang        text primary key check (length(lang) between 1 and 16),
  floor       integer not null check (floor > 0),
  updated_at  timestamptz not null
);

comment on table internal.feed_lang_floor is
  'The current approval floor of each language''s newest-posts search (the fresh bands). Moved after every live discovery pass toward the language''s share of the bands'' daily money (Policy.feed.langSplit). A cost control at the vendor, never an admission rule.';
