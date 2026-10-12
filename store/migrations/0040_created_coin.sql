-- 0040_created_coin.sql
--
-- COINS LAUNCHED THROUGH INSIDOR: which coin, who created it, from which narrative, and the
-- transaction that created it.
--
-- Written once, after the create transaction lands (services/trade, the Create flow), so a coin
-- shows "Created on Insidor" and the creator's Wallet tab lists it under "Coins you created".
-- Read by the read service. The market cap and the creator's fees are not stored here: both
-- are read live from the chain and the market, because a stored copy is stale the next minute.
--
-- `story_id` carries no foreign key: a narrative can be merged away; the coin was still made
-- from it, and the record of that is the point.
--
-- `public`, granted to the app role: that a coin was created through Insidor, by which wallet,
-- is a fact about the world, on the chain for anyone to see.

create table public.created_coin (
  address     text primary key,
  creator     text not null,
  story_id    text,
  signature   text not null,
  created_at  timestamptz not null
);

create index created_coin_creator_idx on public.created_coin (creator, created_at desc);

grant select on public.created_coin to insidor_app;

comment on table public.created_coin is
  'A coin launched through Insidor: its address, its creator''s wallet, the narrative it came from, the create transaction.';
