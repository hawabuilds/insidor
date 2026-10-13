-- 0058_post_coin_evidence.sql
--
-- WHY A FEED POST'S COIN MATCHED, AND WHAT IT COULD BE CALLED — both as facts the app may show.
--
-- 1. public.same_name_coin gains each coin's evidence against the post, so "See 3 coins" can
--    list them strongest first and say why for each, and the card can say why its one coin is
--    the post's. Three facts and an order, never a score:
--
--      links_post         the coin's own links or description carry this post's id or its
--                         picture's. Null: the coin's metadata was not read (never "no").
--      same_picture       the coin's picture is the post's: near-identical, or borderline and
--                         the judge said the same subject. Null: not compared.
--      launched_after_ms  the coin's first transaction minus the post's time; negative is
--                         before. Null: either time unknown. A fact about two clocks, true
--                         whether or not Insidor exists.
--      position           the projector's order (core `byEvidence`): links, picture, timing,
--                         name, then the earliest launch. The read service sorts by it and
--                         nothing else, so the list and the card cannot disagree.
--
--    The facts are written for a narrative's list too, as nulls: a narrative's coins were
--    weighed by the board, not by this rule, and a null says "not weighed here", not "no".
--
-- 2. public.post_name_idea: the Create sheet's name and ticker ideas for a post on a feed, from
--    the judge's own names for its subject (core `nameIdeas`), with brand names the projector
--    can recognise dropped. Rewritten whole by the projector with the feeds. Whether a ticker is
--    free is NOT stored: it is a live fact the read service checks when a person asks.
--
-- Both `public`, granted to the app role: an address, a time difference, two yes/no facts, a
-- name, a ticker. None of them is the system's reasoning — the judge's confidence, the picture
-- similarity and the rule that chose stay in `internal` and in the projector.
--
-- What breaks if changed carelessly: `links_post` and `same_picture` are three-valued on
-- purpose. A `not null default false` here would turn "we could not read this coin's links"
-- into "this coin does not link the post", and the card would say less than it knows while the
-- list said something untrue.

alter table public.same_name_coin
  add column links_post        boolean,
  add column same_picture      boolean,
  add column launched_after_ms bigint,
  add column position          integer check (position is null or position >= 0);

comment on column public.same_name_coin.links_post is
  'The coin''s own links carry this post''s id or its picture''s. Null: the coin''s metadata was not read.';
comment on column public.same_name_coin.same_picture is
  'The coin''s picture is the post''s (near-identical, or borderline and confirmed). Null: not compared.';
comment on column public.same_name_coin.launched_after_ms is
  'The coin''s launch minus the post''s time, in ms; negative is before. Null: a time is unknown.';

create table public.post_name_idea (
  item_id   text not null,
  position  integer not null check (position >= 0),
  name      text not null check (length(name) between 1 and 64),
  ticker    text not null check (ticker ~ '^[A-Z0-9]{1,10}$'),
  primary key (item_id, position)
);

comment on table public.post_name_idea is
  'Name and ticker ideas for a coin made from a feed post, from the judge''s names for its subject, in the projector''s order. Rewritten with the feeds.';

grant select on public.post_name_idea to insidor_app;

-- 3. The coins whose metadata was `unavailable` get their tries back. Every one failed on our
--    side: the runner read through ipfs.io, which answered its bursts with 429 (services/runner
--    config.ts now tries the launchpad's gateway, then Pinata's). Their attempts were spent on
--    our outage, not on the coin's document, so the count goes back to one and the universe loop
--    reads them again within its per-pass caps. Nothing is removed; `not_content_addressed`
--    rows are untouched, since that is a final answer.
update internal.coin_metadata set attempts = 1 where outcome = 'unavailable';
