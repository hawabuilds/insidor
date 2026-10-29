-- 0151_coin_post_check.sql
--
-- WHETHER A COIN TIED TO A POST BY ITS NAME ALONE IS ABOUT THAT POST, ASKED ONCE AND KEPT (the owner,
-- 2026-10-29: the coins on a post whose "linked x post or image is unrelated to the post we match it to").
-- A coin whose name is a common word ("vanilla", "test", "SI") meets every post that uses the word. The
-- runner shows the judge the coin as it presents itself — its name, ticker, description, the post its own
-- link points at, its picture — beside the post's words and picture, and asks whether they are about the
-- same subject (services/runner work/coin-post-check.ts). The matchers drop the coin on "no": the runner's
-- single pick and the projector's "See N coins" list.
--
-- Why words AND pictures, not pictures alone: replayed on 29 Oct, the picture-only question (0040's
-- image_pair_check) said "no" to every Mbappe coin on the Mbappe posts, because a cartoon is not the photo.
-- With the coin's words beside it, the same model rejected @AFP's "vanilla" coins on a Yokohama post about a
-- dog called Vanilla, "SI" on the Akita post and "test" on the Trump phone, and kept Mbappe 8 of 8 and GTA 6
-- 14 of 17.
--
-- ★ ONE ROW A PAIR, EVER. The primary key is the pair: a pair is paid for once (about $0.0002), and the
-- daily cap counts rows by `checked_at`. `answer` is null when no usable answer came back (a picture that
-- would not load, a garbled reply): the pair is not asked again and, like "unsure", keeps its coin — no
-- answer is never a "no".
--
-- What breaks if changed carelessly: the meaning of a row. The matchers read ONLY `answer = 'no'`, and only
-- for a coin with no link, picture or address evidence; widening that read to null or "unsure" would drop
-- the coins the check could not see, the opposite of "an outage is not a claim".

create table internal.coin_post_check (
  item_id     text        not null check (length(item_id) between 1 and 200),
  address     text        not null check (length(address) between 1 and 200),
  answer      text        check (answer is null or answer in ('yes', 'no', 'unsure')),
  prompt_id   text        not null,
  model       text        not null,
  usd         double precision not null default 0 check (usd >= 0),
  checked_at  timestamptz not null default now(),
  primary key (item_id, address)
);

create index coin_post_check_checked_idx on internal.coin_post_check (checked_at);

comment on table internal.coin_post_check is
  'Whether a coin tied to a post by its name alone is about the same subject, by the judge on both sides'' words and pictures: yes, no, unsure, or null when no usable answer came back. One row a pair. Internal; never shown.';
