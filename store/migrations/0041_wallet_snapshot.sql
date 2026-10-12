-- 0041_wallet_snapshot.sql
--
-- WHAT A WALLET WAS WORTH, SAMPLED WHENEVER ITS OWNER LOOKED — the points the Wallet tab's
-- balance chart draws. Trador's portfolio snapshots, kept.
--
-- Nothing on the chain records a wallet's past dollar value, and rebuilding it would mean
-- replaying every transfer against past prices for every coin. So the read service samples: each
-- time a wallet is read, it may add one point. ★ THE LINE STARTS WHEN THE WALLET WAS FIRST SEEN,
-- NOT WHEN IT FIRST BOUGHT, and the screen says so; drawing it back to zero would be a
-- fabricated history, the one lie on a balance chart nobody can detect.
--
-- ★ THE READ SERVICE'S ONE WRITE, AND HOW NARROW IT IS. That service holds the app role, which
-- reads and never writes. It is granted EXECUTE on `record_wallet_snapshot` and nothing else on
-- this table: the function appends one point, for one wallet, only if the wallet's newest point
-- is older than the gap (never under a minute, whatever the caller asks), and only for a value
-- that is a real non-negative number. It cannot update, delete or touch any other table.
--
-- `public`: a wallet's value is derived from what anyone can read on the chain.

create table public.wallet_snapshot (
  address    text not null,
  at         timestamptz not null,
  total_usd  double precision not null check (total_usd >= 0),
  primary key (address, at)
);

create function public.record_wallet_snapshot(p_address text, p_total_usd double precision, p_gap_ms bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gap interval := make_interval(secs => greatest(coalesce(p_gap_ms, 0), 60000) / 1000.0);
begin
  if p_address is null or p_address !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  if p_total_usd is null or p_total_usd < 0 or p_total_usd = 'NaN'::double precision or p_total_usd = 'Infinity'::double precision then return; end if;
  if exists (select 1 from public.wallet_snapshot where address = p_address and at > now() - gap) then return; end if;
  insert into public.wallet_snapshot (address, at, total_usd) values (p_address, now(), p_total_usd)
  on conflict (address, at) do nothing;
end;
$$;

revoke all on function public.record_wallet_snapshot(text, double precision, bigint) from public;
grant execute on function public.record_wallet_snapshot(text, double precision, bigint) to insidor_app;
grant select on public.wallet_snapshot to insidor_app;

comment on table public.wallet_snapshot is
  'A wallet''s dollar value, sampled at most once per gap when it is read. The balance chart''s points; it starts when the wallet was first seen.';
