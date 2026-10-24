-- 0132_coin_post_link_via.sql
--
-- A COIN'S POST IS THE VIRAL ORIGINAL, NOT THE PROMOTION THAT POINTS AT IT: which post a coin's
-- link row was reached through, when the post its metadata named only quoted or linked it.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-24: "the posts you find from coin links on pf — some of them have quoted the
-- original viral post or mentioned the post link. For those situations just bring in the viral post
-- and link the coin rather than the promotion post. If it's a promotion post on its own, just send
-- the promotion post." Of the 21,740 posts coins named over 21-24 Oct, 8,087 quote, re-share or link
-- another post (7,490 quotes); for most the coin's own launcher posted it to point at someone
-- else's post (@igetsjiggy6767, 15 views, quoting an @elonmusk post of 39.7M).
--
-- internal.coin_post_link gains:
--   via   for a row the coin-link step reached through a promotion (services/runner
--         work/coin-links.ts): that promotion's item id — the post the coin's metadata actually
--         named, which quotes or links this row's post one hop away. Null: the metadata named this
--         post itself, as every row before this migration.
--
-- The promotion itself gets NO row of its own when its original is followed. Every reader of this
-- table — the one-coin pick's `link` tie, the project service's coin lookups, a narrative's coin
-- tie and "Started by", the instant judge, the coin-first route, the learned words — takes a row as
-- "this coin is this post's", and none of them should ever say that of a launcher's pointer. The
-- promotion stays on record here, as the `via` of its original's row, for whatever learns from it.
--
-- Internal only: the route's reasoning never reaches a screen.
--
-- What breaks if changed carelessly: writing the promotion's own row beside its original's, or a
-- row for a promotion whose original was NOT followed with `via` set. The first puts the launcher's
-- post back on every surface that asks which post a coin is; the second hides a standalone
-- promotion, which the owner wants sent as it is.

alter table internal.coin_post_link
  add column via text check (via is null or length(via) between 1 and 200);

comment on column internal.coin_post_link.via is
  'The promotion post (item id) the coin''s metadata named, which quotes or links this row''s post one hop away; null when the metadata named this post itself. Internal; never shown.';
