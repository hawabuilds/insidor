-- 0159_coin_shown_racers.sql
--
-- A COIN SHOWN IN A CARD'S PVP LIST WAS SHOWN (the owner, 2026-11-01, of $VETO EM6awu…: "we did
-- show it as pvp so shouldnt logo be shown for it too"). A card's PvP list
-- (`coins.evidence.racingCoins`, services/project one-coin-cards.ts) puts every racing coin on screen
-- beside the chosen one, with its market cap. 0145 caught only the chosen coin, so a racer that was
-- never chosen had no chart bubble, though the app had shown it.
--
-- Now the card trigger also keeps, for each coin in that list, the first moment it was written there
-- and the market cap the list showed for it then. Same rules as the chosen coin: one row per coin,
-- the earliest moment wins and never moves (`on conflict do nothing`), stamped `clock_timestamp()`
-- (0158), and a notification that came earlier still takes the bubble (0158's alert trigger).
--
-- Consequence: a racer that is chosen later now keeps the earlier moment it was first shown racing.
-- No backfill: frames are replaced each pass and keep no history, so a racer shown before this has
-- no recorded moment and is not guessed; the racers on cards when this is applied are caught on the
-- next frame.
--
-- What breaks if changed carelessly: the trigger must never fail the feed write — every read of the
-- list is guarded (an array check, a text check on each address, a numeric check on each cap), and
-- the whole racer pass sits in its own exception block.

create or replace function internal.note_coin_shown() returns trigger
  language plpgsql security definer set search_path = pg_catalog, internal as $$
declare
  addr text := new.payload #>> '{coins,coin,address}';
  cap  text := new.payload #>> '{coins,coin,marketCapUsd,v}';
  racers jsonb := new.payload #> '{coins,evidence,racingCoins}';
begin
  if new.payload #>> '{coins,kind}' = 'matched' and addr is not null and addr <> '' then
    insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
    values (addr, clock_timestamp(), case when cap ~ '^-?[0-9.eE+-]+$' then cap::float8 end, new.item_id, new.feed_id, 'card')
    on conflict (address) do nothing;

    if jsonb_typeof(racers) = 'array' then
      begin
        insert into internal.coin_shown (address, shown_at, mc_usd, item_id, feed_id, source)
        select r ->> 'address', clock_timestamp(),
               case when jsonb_typeof(r #> '{marketCapUsd,v}') = 'number' then (r #>> '{marketCapUsd,v}')::float8 end,
               new.item_id, new.feed_id, 'card'
          from jsonb_array_elements(racers) r
         where jsonb_typeof(r) = 'object' and jsonb_typeof(r -> 'address') = 'string' and r ->> 'address' <> ''
        on conflict (address) do nothing;
      exception when others then
        null; -- a racer's bubble is never worth losing the feed write
      end;
    end if;
  end if;
  return new;
end $$;

comment on table internal.coin_shown is
  'Each coin''s first appearance in the app: as a post''s matched coin or in its PvP list (source card, caught live), or its first notification (source alert), with the market cap shown then.';
