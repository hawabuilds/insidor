-- 0062_trade.sql
--
-- EVERY TRADE THE TRADE SERVICE BUILT OR SENT: buy, sell, send (transfer) and launch, with what
-- was quoted, whether the simulation passed, the signature, and how it ended.
--
-- ONE ROW PER TRANSACTION, FILLED IN AS IT MOVES. The key is the hash of the transaction's
-- message — the bytes a wallet signs. The unsigned transaction the service builds and the signed
-- one the app sends back share that message, so /build and /send find the same row without the
-- app carrying an id. A send of a transaction this service never built (built before this
-- migration, say) still gets a row, with what the send knows: the wallet and the signature.
--
--   built      the simulation passed; a transaction went back to be signed
--   refused    the simulation failed; nothing signable went back (`simulation_error` says why)
--   sent       the chain accepted the signed transaction; not yet seen landed
--   send_fail  the chain refused it at send (`error` says why)
--   confirmed  seen landed and succeeded
--   failed     seen landed and failed
-- A sent row that is never seen landed stays `sent`: not finding a transaction is not evidence
-- it failed, and the row must not say it did.
--
-- AMOUNTS ARE BASE UNITS, AS TEXT-EXACT NUMERICS: lamports for SOL, the coin's smallest unit for a
-- coin. `in_amount`/`out_amount` are the quote before slippage; `bound` is the limit the person
-- accepted (the least out on a sell, the most in on a buy). Never a dollar figure: a stored price
-- is stale the next minute.
--
-- NO TRANSACTION BYTES AND NO KEYS. The service never holds a private key; it does not store the
-- transaction either, only the facts above.
--
-- WRITTEN ONLY THROUGH THE THREE FUNCTIONS BELOW. The trade service holds the app role, which
-- never writes a table; it is granted EXECUTE on these and SELECT on the table (the Portfolio and
-- audits read it). The functions refuse anything that is not an address, a signature or a known
-- kind, cut free text to 500 characters, and never move a settled row back.
--
-- No retention: a few rows a trade, and the record of real money moving is the point.

create table public.trade (
  id                text primary key check (id ~ '^[0-9a-f]{64}$'),
  wallet            text not null,
  kind              text check (kind in ('buy', 'sell', 'transfer', 'launch')),
  venue             text check (venue in ('curve', 'pool')),
  mint              text,               -- null: SOL itself (a SOL transfer)
  to_address        text,               -- a transfer's recipient
  in_amount         numeric,
  out_amount        numeric,
  bound             numeric,
  slippage_bps      integer,
  fee_bps           integer,            -- our platform fee as quoted
  quoted_cost_lamports bigint,          -- a launch's measured total cost
  simulated_ok      boolean,
  simulation_error  text,
  status            text not null check (status in ('built', 'refused', 'sent', 'send_fail', 'confirmed', 'failed')),
  signature         text,
  error             text,
  built_at          timestamptz,
  sent_at           timestamptz,
  settled_at        timestamptz
);

create index trade_wallet_idx on public.trade (wallet, coalesce(sent_at, built_at) desc);
create index trade_signature_idx on public.trade (signature) where signature is not null;

grant select on public.trade to insidor_app;

comment on table public.trade is
  'Each transaction the trade service built or sent: kind, coin, quoted amounts in base units, simulation, signature, outcome. Keyed by the hash of the signed message.';

create function public.record_trade_built(
  p_id text, p_wallet text, p_kind text, p_venue text, p_mint text, p_to text,
  p_in numeric, p_out numeric, p_bound numeric, p_slippage_bps integer, p_fee_bps integer, p_cost_lamports bigint,
  p_simulated_ok boolean, p_simulation_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[0-9a-f]{64}$' or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  if p_kind not in ('buy', 'sell', 'transfer', 'launch') then return; end if;
  if p_mint is not null and p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  if p_to is not null and p_to !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  insert into public.trade (id, wallet, kind, venue, mint, to_address, in_amount, out_amount, bound, slippage_bps, fee_bps,
                            quoted_cost_lamports, simulated_ok, simulation_error, status, built_at)
  values (p_id, p_wallet, p_kind, nullif(p_venue, ''), p_mint, p_to, p_in, p_out, p_bound, p_slippage_bps, p_fee_bps,
          p_cost_lamports, p_simulated_ok, left(p_simulation_error, 500), case when p_simulated_ok then 'built' else 'refused' end, now())
  on conflict (id) do nothing;
end;
$$;

create function public.record_trade_sent(p_id text, p_wallet text, p_signature text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id !~ '^[0-9a-f]{64}$' or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  if p_signature is not null and p_signature !~ '^[1-9A-HJ-NP-Za-km-z]{64,90}$' then return; end if;
  insert into public.trade (id, wallet, status, signature, error, sent_at)
  values (p_id, p_wallet, case when p_signature is null then 'send_fail' else 'sent' end, p_signature, left(p_error, 500), now())
  on conflict (id) do update
     set status    = case when public.trade.status in ('confirmed', 'failed') then public.trade.status else excluded.status end,
         signature = coalesce(excluded.signature, public.trade.signature),
         error     = excluded.error,
         sent_at   = excluded.sent_at;
end;
$$;

create function public.record_trade_settled(p_id text, p_signature text, p_ok boolean, p_error text)
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
end;
$$;

revoke all on function public.record_trade_built(text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, bigint, boolean, text) from public;
revoke all on function public.record_trade_sent(text, text, text, text) from public;
revoke all on function public.record_trade_settled(text, text, boolean, text) from public;
grant execute on function public.record_trade_built(text, text, text, text, text, text, numeric, numeric, numeric, integer, integer, bigint, boolean, text) to insidor_app;
grant execute on function public.record_trade_sent(text, text, text, text) to insidor_app;
grant execute on function public.record_trade_settled(text, text, boolean, text) to insidor_app;
