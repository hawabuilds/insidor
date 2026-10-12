-- 0037_coin_name.sql
--
-- EVERY COIN WE HAVE SEEN, BY NAME, FOREVER: its address, name, ticker and launch time, and
-- nothing else.
--
-- The keep rule (0036) deletes a coin's full row after fourteen days unless it matters. Deleted
-- is not forgotten: a person searching a ticker from last month still finds the coin, and
-- tapping it loads everything else live from the market (services/read/src/search.ts). This
-- table is what they find. It is lean on purpose — four columns, no picture, no metadata, no
-- social links — because it grows by every launch and is never trimmed: ~42,000 rows a day.
--
-- Written by a trigger on public.asset, not by each writer. Every path that adds a coin (the mint
-- stream, a name search) goes through that table, and a trigger is the one place no future
-- writer can forget. Only the mint stream's and a search's coins: a seed or a fixture is a
-- fiction, and a forever index of fictions is how one ends up in Search. The first sighting
-- wins; a later upsert of the same coin never rewrites what we first saw it called.
--
-- `public`, granted to the app role: a coin's name and launch are facts about the world.

create table public.coin_name (
  address      text primary key,
  name         text,
  ticker       text,
  launched_at  timestamptz
);

-- Search reads it by exact ticker or exact name, never by substring: a fuzzy scan over every
-- launch ever is not a query a person typing should be able to start.
create index coin_name_ticker_idx on public.coin_name (upper(ticker));
create index coin_name_name_idx on public.coin_name (lower(name));

create function public.remember_coin_name() returns trigger language plpgsql as $$
begin
  if new.chain = 'solana' and new.origin in ('live_stream', 'backfill') then
    insert into public.coin_name (address, name, ticker, launched_at)
    values (new.address, left(new.name, 64), left(new.symbol, 32), new.minted_at)
    on conflict (address) do nothing;
  end if;
  return new;
end;
$$;

create trigger asset_remembers_its_name
  after insert on public.asset
  for each row execute function public.remember_coin_name();

insert into public.coin_name (address, name, ticker, launched_at)
select address, left(name, 64), left(symbol, 32), minted_at
  from public.asset
 where chain = 'solana' and origin in ('live_stream', 'backfill')
on conflict (address) do nothing;

grant select on public.coin_name to insidor_app;

comment on table public.coin_name is
  'Every coin seen by the mint stream or a search, by name, kept forever after its full row is deleted: address, name, ticker, launch time.';
