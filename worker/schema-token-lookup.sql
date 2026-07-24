-- Token lookup fields — DexScreener / pump.fun enrichment

alter table public.narrative_tickers
  add column if not exists mint_ca text,
  add column if not exists dex_url text,
  add column if not exists pump_url text,
  add column if not exists lookup_at timestamptz;

create index if not exists narrative_tickers_mint_ca_idx
  on public.narrative_tickers (mint_ca)
  where mint_ca is not null;
