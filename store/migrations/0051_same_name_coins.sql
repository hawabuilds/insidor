-- 0051_same_name_coins.sql
--
-- WHICH COINS USE A FEED POST'S NAME, BY ADDRESS, SO "SEE 3 COINS" CAN LIST THE THREE.
--
-- An unsure post card says "3 coins use this name. We can't tell which one came from here."
-- Until now only the 3 was kept: 0035's internal.coin_lookup stored how many coins a name
-- search returned, never which. A button that promises three coins and then lists something
-- else, or nothing, is a claim we could not back. Two changes, both so the count on the card
-- and the list behind it are the same rows:
--
--   1. internal.coin_lookup keeps the addresses the search kept (`hits`, newest launch first,
--      at most `universe.lookup.hitsPerTerm`) and whether more came back than were kept
--      (`more`). Null on both for a search made before this migration: that row has a count
--      and no list, so the projector does not offer a list for it and the lookup searches the
--      name again (store/src/repo/coin-universe.ts `lookupTerms`).
--
--   2. public.same_name_coin is the projected list, rewritten by the projector in the same
--      transaction as the feeds: one row per coin per unsure narrative (the coins the board
--      weighed and could not choose between) or unsure post (the coins its name search kept
--      that we hold by name). The card's count is the number of these rows, by construction.
--      The read service lists them on GET /post/:id/coins.
--
-- ★ THIS TABLE NEVER LINKS A COIN. A row says "this coin uses the same name", which is a fact
-- about the world — any market search for the name says it too. It is not "this is the post's
-- coin", which is why the feed row itself still carries only the count: a coin is never one
-- prop away from a Buy button on the card. Buy happens on the coin's own page, opened by a
-- person who chose it, exactly as from Search.
--
-- `public`, granted to the app role: addresses and a subject id, nothing the system weighed.
-- What breaks if changed carelessly: the projector deletes and rewrites a whole kind each run.
-- A writer that appended instead would leave a coin listed under a post the board has since
-- settled, and the list would outgrow the count on the card.

alter table internal.coin_lookup add column hits text[];
alter table internal.coin_lookup add column more boolean;
alter table internal.coin_lookup add constraint hits_kept_with_more check ((hits is null) = (more is null));

create table public.same_name_coin (
  subject_kind  text not null check (subject_kind in ('story', 'post')),
  subject_id    text not null,
  address       text not null,
  primary key (subject_kind, subject_id, address)
);

comment on table public.same_name_coin is
  'The coins an unsure narrative or feed post shares its name with, by address, as the projector committed them. A list of same-named coins, never a link.';

grant select on public.same_name_coin to insidor_app;
