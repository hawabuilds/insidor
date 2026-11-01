-- 0158_coin_shown_write_time.sql
--
-- THE CHART'S BUBBLE IS WHEN WE TOLD PEOPLE, AT THE CAP WE TOLD THEM (the owner, 2026-11-01: "we
-- pushed $BLACKED at 12.5k but on the chart it says 33k" ... "should be when notified no?").
--
-- The bubble (public.coin_notified, read by services/read coin-about.ts) is now the EARLIER of:
--   - the coin's first notification (people.alert kind 'coin_launched', any delivery but 'refused':
--     listed in the app's Notifications whether or not that phone allows pushes), at the market cap
--     the notification said; and
--   - the first time a card showed it as a post's coin (0145), for a coin we never notified about.
-- Time and cap always come from the same moment. Kept as one row per coin, written as each moment
-- happens, so the chart reads one row by its key and never searches everyone's alerts.
--
-- Two fixes to 0145 as well:
--   1. Its trigger stamped `now()`, which in Postgres is the START of the writing transaction. The
--      projector writes a whole frame in one transaction, and a full frame can run for many minutes:
--      $BLACKED's card was written about 09:48 with the 09:48 cap ($33,184) but stamped 09:29:00,
--      when the coin traded near $12K. `clock_timestamp()` is when the row is actually written.
--   2. Card rows already stamped too early are moved to the time their cap was true, where that is
--      exact: the coin's own market reading with that very cap, taken after the stamp and within two
--      hours. A row with no such reading keeps its time (unknown is not guessed).
--
-- What breaks if changed carelessly: neither trigger may ever fail the write it rides on (the feed
-- frame, a person's alert) — both inserts are guarded; and public.coin_notified keeps 0143's three
-- columns in order, so the read service reads it unchanged.

-- 1. A card's moment is when it is written.
create or replace function internal.note_coin_shown() returns trigger
  language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  addr text := new.payload #>> '{coins,coin,address}';
  cap  text := new.payload #>> '{coins,coin,marketCapUsd,v}';
begin
  if new.payload #>> '{coins,kind}' = 'matched' and addr is not null and addr <> '' then
    insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
    values (addr, clock_timestamp(), case when cap ~ '^-?[0-9.eE+-]+$' then cap::float8 end, new.item_id, new.feed_id, 'card')
    on conflict (address) do nothing;
  end if;
  return new;
end $$;

-- 2. Card rows stamped at their frame's start move to the reading their cap came from.
update internal.coin_shown s
   set shown_at = (select min(m.taken_at)
                     from public.market_reading m
                    where m.chain = 'solana' and m.address = s.address
                      and m.taken_at > s.shown_at and m.taken_at <= s.shown_at + interval '2 hours'
                      and m.market_cap_usd = s.mc_usd)
 where s.source = 'card' and s.mc_usd is not null
   and exists (select 1
                 from public.market_reading m
                where m.chain = 'solana' and m.address = s.address
                  and m.taken_at > s.shown_at and m.taken_at <= s.shown_at + interval '2 hours'
                  and m.market_cap_usd = s.mc_usd);

-- 3. A coin's first notification takes the bubble when it came first.
create function internal.note_coin_notified() returns trigger
  language plpgsql security definer set search_path = pg_catalog, internal, people as $$
declare
  addr text := coalesce(nullif(new.facts ->> 'address', ''), new.subject);
begin
  if new.kind = 'coin_launched' and coalesce(new.delivery, '') <> 'refused' and addr is not null and addr <> '' then
    begin
      insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
      values (addr, new.at,
              case when jsonb_typeof(new.facts -> 'mcUsd') = 'number' then (new.facts ->> 'mcUsd')::float8 end,
              new.facts ->> 'item', null, 'alert')
      on conflict (address) do update
        set shown_at = excluded.shown_at, mc_usd = excluded.mc_usd, item_id = excluded.item_id,
            feed_id = null, source = 'alert'
        where excluded.shown_at < internal.coin_shown.shown_at;
    exception when others then
      null; -- the bubble is never worth losing a person's notification
    end;
  end if;
  return new;
end $$;

create trigger alert_coin_notified after insert on people.alert
  for each row execute function internal.note_coin_notified();

-- 4. The notifications already sent.
insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
select distinct on (coalesce(nullif(facts ->> 'address', ''), subject))
       coalesce(nullif(facts ->> 'address', ''), subject),
       at,
       case when jsonb_typeof(facts -> 'mcUsd') = 'number' then (facts ->> 'mcUsd')::float8 end,
       facts ->> 'item', null, 'alert'
  from people.alert
 where kind = 'coin_launched' and coalesce(delivery, '') <> 'refused'
   and coalesce(nullif(facts ->> 'address', ''), subject) is not null
 order by coalesce(nullif(facts ->> 'address', ''), subject), at
on conflict (address) do update
  set shown_at = excluded.shown_at, mc_usd = excluded.mc_usd, item_id = excluded.item_id,
      feed_id = null, source = 'alert'
  where excluded.shown_at < internal.coin_shown.shown_at;

comment on view public.coin_notified is
  'Each coin''s chart bubble: its first notification, or its first card when it was never notified, whichever came first, with the market cap of that same moment.';
