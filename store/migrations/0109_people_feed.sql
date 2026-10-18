-- 0109_people_feed.sql
--
-- THE FEED OF PEOPLE YOU FOLLOW: their buys and sells and their comments, newest first
-- (services/social activity.ts, as `insidor_people`). Trador's Following feed, on Insidor's rows.
--
-- ── WHOSE TRADES MAY BE SHOWN ─────────────────────────────────────────────
--
-- `people.profile.trades_public` is the profile switch "Show my trades to followers". It is ON
-- by default, as Trador's (`users.portfolio_public`, its 0012): following someone is following
-- what they do, and their trades are the point of it (the owner, 2026-10-18, knowing it makes
-- every existing person's landed trades visible to their followers when this runs). Turning it
-- off takes them off the Feed at once. The chain is public either way; this governs what
-- Insidor shows, and the switch says so. The social service filters on it in the same query that
-- reads the trades, so there is no second place that could forget it.
--
-- ── WHAT THE SOCIAL SERVICE MAY READ ──────────────────────────────────────
--
-- `public.trade` was readable only by the read service's app role. The social service's role
-- now reads it too, select only: it never writes a trade (that is the trade service's three
-- functions, 0062). The table carries no keys and no transaction bytes, only the facts of each
-- trade, and RLS already lets our four roles through (0073).
--
-- ── INDEXES ───────────────────────────────────────────────────────────────
--
--   trade_landed_idx         a followed person's landed buys and sells, newest first, and the
--                            whole list's (Latest), each a page of 21 from the top of the index.
--   comment_top_level_idx    every visible top-level comment newest first, for Latest; a followed
--                            person's comments use comment_author_idx (0043).
--   profile_wallet_idx       the join from a trade's wallet to the person who made it.
-- Plain CREATE INDEX: the tables are a few rows today (9 trades, 0 comments on 18 Oct 2026), so
-- the SHARE lock the migrator's transaction takes is milliseconds.
--
-- What breaks if changed carelessly: `trades_public` is read on every Feed page; dropping its
-- filter from the trade read shows the trades of people who turned the switch off.

alter table people.profile add column trades_public boolean not null default true;

create index profile_wallet_idx on people.profile (wallet) where wallet is not null;

create index trade_landed_idx on public.trade (wallet, settled_at desc)
  where status = 'confirmed' and kind in ('buy', 'sell') and settled_at is not null;
create index trade_landed_all_idx on public.trade (settled_at desc)
  where status = 'confirmed' and kind in ('buy', 'sell') and settled_at is not null;

create index comment_top_level_idx on people.comment (created_at desc)
  where parent_id is null and hidden_at is null;

grant select on public.trade to insidor_people;

-- ── WHERE A TRADE STOOD: THE MARKET CAP WHEN IT LANDED ─────────────────────
--
-- The Feed says what Trador says and nothing more: a buy "at $48K market cap", a sell "in profit"
-- or "at a loss", never an amount. `market_cap_usd` is the coin's market cap from our own market
-- readings (public.market_reading) when the trade landed, and `market_cap_at` is when that
-- reading was taken, so its distance from the landing can always be checked.
--
-- Recorded by record_trade_settled below, the trade service's own settle step (its signature is
-- unchanged, so the running trade service needs no change): the newest reading of the coin taken
-- in the ten minutes up to the landing. None in that window is null, never a guess; the Feed then
-- looks either side of the landing within social.tradeCapWindowMs, and says nothing if that finds
-- none either. Trades that landed before this migration have no recorded cap and are read that
-- second way. Both columns are additive: nothing that reads public.trade today reads them.

alter table public.trade add column market_cap_usd double precision, add column market_cap_at timestamptz;

create or replace function public.record_trade_settled(p_id text, p_signature text, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[0-9a-f]{64}$' or p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$' then return; end if;
  update public.trade
     set status = case when p_ok then 'confirmed' else 'failed' end,
         error = coalesce(left(p_error, 500), error),
         settled_at = now()
   where id = p_id and signature = p_signature and status in ('sent', 'send_fail');
  if p_ok then
    update public.trade t
       set (market_cap_usd, market_cap_at) = (
             select m.market_cap_usd, m.taken_at
               from public.market_reading m
              where m.chain = 'solana' and m.address = t.mint and m.market_cap_usd is not null
                and m.taken_at between t.settled_at - interval '10 minutes' and t.settled_at
              order by m.taken_at desc
              limit 1)
     where t.id = p_id and t.signature = p_signature and t.status = 'confirmed'
       and t.kind in ('buy', 'sell') and t.mint is not null and t.market_cap_usd is null;
  end if;
end;
$$;

revoke all on function public.record_trade_settled(text, text, boolean, text) from public;
grant execute on function public.record_trade_settled(text, text, boolean, text) to insidor_app;
