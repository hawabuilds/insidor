-- 0026_rising.sql
--
-- THE FOR YOU AND POPULAR FEEDS: SINGLE POSTS, PROJECTED, SERVED VERBATIM.
--
-- The same shape as 0011's launches rail, for the same reasons: a view row per feed with
-- its own tick, and one row per post holding a payload the projector has already censored.
-- Its own pair of tables and its own tick, never shared with the board, so a feed of single
-- posts and the board of narratives cannot be joined into one claim by accident. See
-- docs/rising-posts-plan.md.
--
-- Which posts, and in what order, is decided once by the projector: a post found by the
-- catch-all search whose meme score, judged alone, clears the bar (0025). `position` is the
-- committed order — newest first for `fyp`, most views for `popular` — and the client never
-- sorts. The score itself is never in a payload; the feed shows the post, not our reasoning.

create table public.rising_view (
  feed_id      text primary key,
  tick         bigint not null,
  projected_at timestamptz not null default now()
);

create table public.rising_row (
  feed_id   text not null references public.rising_view (feed_id) on delete cascade,
  item_id   text not null,
  position  int  not null,
  payload   jsonb not null,
  primary key (feed_id, item_id)
);

create index rising_row_order_idx on public.rising_row (feed_id, position);

comment on table public.rising_row is
  'One single post per row of the For You or Popular feed, as the projector committed it. Facts only: no score, and a coin only when the narrative the post belongs to has one confident match.';

grant select on public.rising_view, public.rising_row to insidor_app;
