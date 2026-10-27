-- 0145_coin_shown.sql
--
-- THE FIRST TIME THE APP SHOWED A COIN AS A POST'S COIN (the owner, 2026-10-27: "not necessarily
-- pushed to phones because not all notis get pushed to phones — how about when you showed or made
-- visible on app that coin was matched"). The token chart's bubble marks that moment, at the market
-- cap the card showed then. 0143 read the coin pushes, which reach only the phones that allow them;
-- this reads the app itself.
--
-- A card shows a coin as matched when a feed row's payload says `coins.kind = 'matched'`
-- (public.rising_row, For You and Popular). The projector replaces those rows every frame, so the
-- moment is caught as it is written: a trigger keeps the first (address → when, cap, post, feed) and
-- never moves it. One row per coin, so the table grows by the coins we ever showed, not by frames.
--
-- BEFORE THIS EXISTED: a coin shown before 0145 has no caught moment. Its stand-in is the first alert
-- the Feed listed for it (fyp_coin, fyp_proven, story_post, coin_launched — any delivery but
-- 'refused'); those are raised from the same feed rows within a pass of the card showing, so they are
-- the nearest record there is. Marked `source = 'alert'` so the difference is never hidden.
--
-- What breaks if changed carelessly: the view's columns. public.coin_notified keeps 0143's three, in
-- order, so the read service (services/read coin-about.ts NOTIFIED_SQL) reads it unchanged. The
-- trigger is `security definer` so the projector's role need not write `internal`; and it must never
-- fail the feed write — the insert is `on conflict do nothing` and reads only the new row.

create table internal.coin_shown (
  address    text primary key,
  shown_at   timestamptz not null,
  mc_usd     float8,
  item_id    text,
  feed_id    text,
  source     text not null check (source in ('card', 'alert'))
);

comment on table internal.coin_shown is
  'Each coin''s first appearance in the app as a post''s matched coin, with the market cap shown then. source card = caught live; alert = before 0145, from the Feed''s first alert.';

create function internal.note_coin_shown() returns trigger
  language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  addr text := new.payload #>> '{coins,coin,address}';
  cap  text := new.payload #>> '{coins,coin,marketCapUsd,v}';
begin
  if new.payload #>> '{coins,kind}' = 'matched' and addr is not null and addr <> '' then
    insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
    values (addr, now(), case when cap ~ '^-?[0-9.eE+-]+$' then cap::float8 end, new.item_id, new.feed_id, 'card')
    on conflict (address) do nothing;
  end if;
  return new;
end $$;

create trigger rising_row_coin_shown after insert or update of payload on public.rising_row
  for each row execute function internal.note_coin_shown();

-- Before 0145: the first Feed alert per coin.
insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
select distinct on (coalesce(facts ->> 'address', subject))
       coalesce(facts ->> 'address', subject),
       at,
       case when jsonb_typeof(facts -> 'mcUsd') = 'number' then (facts ->> 'mcUsd')::float8 end,
       null, null, 'alert'
  from people.alert
 where kind in ('coin_launched', 'fyp_coin', 'fyp_proven', 'story_post') and delivery <> 'refused'
   and coalesce(facts ->> 'address', subject) is not null
 order by coalesce(facts ->> 'address', subject), at
on conflict (address) do nothing;

-- And what the feeds show this minute, so a coin on a card now is not left to its alert.
insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
select distinct on (payload #>> '{coins,coin,address}')
       payload #>> '{coins,coin,address}', now(),
       case when jsonb_typeof(payload #> '{coins,coin,marketCapUsd,v}') = 'number' then (payload #>> '{coins,coin,marketCapUsd,v}')::float8 end,
       item_id, feed_id, 'card'
  from public.rising_row
 where payload #>> '{coins,kind}' = 'matched' and payload #>> '{coins,coin,address}' is not null
on conflict (address) do nothing;

create or replace view public.coin_notified as
select address, shown_at as notified_at, mc_usd from internal.coin_shown;

comment on view public.coin_notified is
  'Each coin''s first appearance in the app as a post''s matched coin and the market cap shown then; no user. The token chart''s bubble.';

grant select on public.coin_notified to insidor_app;
