-- 0083_coined_posts.sql
--
-- THE POSTS COINS POINT AT, AND HOW EARLY WE SHOWED THEM: the record behind "lead time", the
-- four new ways a post can be found, and the search words learned from what gets coined.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner's goal from 2026-10-15: find viral posts BEFORE they are coined. Lead time — when
-- For You first showed a post against when the first coin naming it launched — is the main
-- number from now on, and it needs the coined posts written down. A coin's metadata document
-- (internal.coin_metadata) often carries the post itself in its social link, website or
-- description: 160 short videos and 10,951 text posts in the 48 hours to 2026-10-15 17:00 UTC.
--
-- internal.coin_post_link  one row per coin per post its metadata names. Written by the runner's
--                          coin-link step within seconds of a launch, and filled here once from
--                          every metadata document already read. The coin that launched first
--                          is the post's coin; later ones are copycats (the owner, 2026-10-15).
-- internal.short_link      a text post's shortened link and where it leads, read once, so the
--                          reposts step never follows the same link twice.
-- internal.search_word     words the short-video search asks besides the owner's list: the
--                          trend data's rising tags and sounds (origin 'trend'), and the tags,
--                          sounds and creators of posts that were coined (origin 'coined').
-- internal.coined_post_lead  the view the lead-time report, the re-tune and the number table read.
--
-- New lanes in internal.item_found_by: 'coin_link' (a coin's metadata named it), 'x_repost' (a
-- text post linked the short video), 'trend' (a trend word's search found it), 'creator' (a
-- creator with a coined post before). Each still goes through the judge before For You: a coin
-- naming a post is not proof it is a meme (the owner, 2026-10-15).
--
-- What breaks if changed carelessly: dropping an old lane value from the check (every row
-- written names one), or making the view read anything but the earliest coin per post. The
-- owner's rule is that only the earliest-launched coin links a post; a later copycat counted as
-- "first" would flatter every lead time.

alter table internal.item_found_by drop constraint item_found_by_lane_check;
alter table internal.item_found_by add constraint item_found_by_lane_check
  check (lane in ('all', 'media', 'slow', 'watch', 'coin_link', 'x_repost', 'trend', 'creator'));

create table internal.coin_post_link (
  asset_key       text not null,
  address         text not null,
  source          text not null,
  source_item_id  text not null check (length(source_item_id) between 1 and 64),
  link            text not null check (length(link) <= 600),
  minted_at       timestamptz,
  found_at        timestamptz not null,
  primary key (asset_key, source, source_item_id)
);
create index coin_post_link_post_idx on internal.coin_post_link (source, source_item_id, minted_at);
create index coin_post_link_found_idx on internal.coin_post_link (found_at desc);

comment on table internal.coin_post_link is
  'A post a coin''s metadata names (social link, website, chat link or description). The earliest-minted coin per post is the post''s coin; written within seconds of the launch by the runner.';

/* Every metadata document already read: the short-video source's video links and the text
   source's post links, the same two shapes the runner's step parses. */
insert into internal.coin_post_link (asset_key, address, source, source_item_id, link, minted_at, found_at)
select a.asset_key, a.address, l.source, l.id, left(l.link, 600), a.minted_at, m.read_at
  from internal.coin_metadata m
  join public.asset a using (asset_key)
  cross join lateral (
    select 'tiktok' as source, x[2] as id, x[1] as link
      from regexp_matches(concat_ws(' ', m.social_link, m.website, m.chat_link, m.description),
                          '(https?://(?:www\.|m\.)?tiktok\.com/@[A-Za-z0-9_.]+/(?:video|photo)/([0-9]{8,25}))', 'g') as x
    union
    select 'x', x[2], x[1]
      from regexp_matches(concat_ws(' ', m.social_link, m.website, m.chat_link, m.description),
                          '(https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/[A-Za-z0-9_]+/status(?:es)?/([0-9]{8,25}))', 'g') as x
  ) l
 where m.outcome = 'read'
on conflict do nothing;

create table internal.short_link (
  short_url    text primary key check (length(short_url) <= 200),
  target       text check (target is null or length(target) <= 2000),
  item_id      text not null,
  followed_at  timestamptz not null
);
create index short_link_followed_idx on internal.short_link (followed_at desc);

comment on table internal.short_link is
  'A shortened link in a text post we hold and where it led when followed once (null: it led nowhere). The reposts step reads short videos out of it.';

create table internal.search_word (
  origin      text not null check (origin in ('trend', 'coined')),
  kind        text not null check (kind in ('tag', 'sound', 'creator', 'video')),
  source      text not null,
  value       text not null check (length(value) between 1 and 200),
  rank        int,
  facts       jsonb,
  updated_at  timestamptz not null,
  primary key (origin, kind, source, value)
);

comment on table internal.search_word is
  'Words the short-video search asks besides the owner''s list: the trend data''s rising tags and sounds, and the tags, sounds and creators of posts that were coined. Rewritten by the runner; `facts` says why each is there.';

/* Each coined post: its first coin (earliest minted, or the owner's confirmed one when it is
   earlier still), when we found it and how, and when For You first showed it. */
create view internal.coined_post_lead as
with linked as (
  select l.source || ':' || l.source_item_id as item_id, l.address, l.minted_at
    from internal.coin_post_link l
   where l.minted_at is not null
  union all
  select f.item_id, f.coin_address, coalesce(a.minted_at, n.launched_at)
    from internal.owner_feedback f
    left join public.asset a on a.address = f.coin_address
    left join public.coin_name n on n.address = f.coin_address
   where f.subject_kind = 'coin_match' and f.verdict = 'right' and f.coin_address is not null
),
firsts as (
  select item_id, min(minted_at) as first_coin_at,
         (array_agg(address order by minted_at))[1] as first_coin,
         count(distinct address) as coins
    from linked
   where minted_at is not null
   group by item_id
)
select c.item_id,
       split_part(c.item_id, ':', 1) as source,
       i.posted_at,
       c.first_coin_at,
       c.first_coin,
       c.coins,
       i.first_seen_at,
       fb.lane as found_by,
       fb.found_at,
       fp.first_shown_at as shown_at,
       extract(epoch from (c.first_coin_at - fp.first_shown_at)) * 1000 as lead_ms
  from firsts c
  left join public.item i on i.item_id = c.item_id
  left join internal.item_found_by fb on fb.item_id = c.item_id
  left join public.feed_post fp on fp.item_id = c.item_id and fp.feed_id = 'fyp';

comment on view internal.coined_post_lead is
  'Every coined post with its first coin''s launch and For You''s first showing: lead_ms is positive when we showed it first, negative when the coin came first, null when never shown.';
