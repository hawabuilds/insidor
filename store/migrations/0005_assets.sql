-- 0005_assets.sql
--
-- Coins. Every outcome label and every resolve gate hangs on knowing when a coin
-- was created and how much we trust that timestamp, so mint time is a STORED
-- column with its provenance recorded beside it — never a value derived at read
-- time from whatever a market vendor happens to be serving today.
--
-- WHY MINT TIME IS NOT SIMPLY `not null`:
-- the measured failure is not absence, it is confident wrongness. Comparing a
-- market vendor's earliest-pair timestamp against the launchpad's own creation
-- time for 60 coins: 20 had no timestamped pair at all, and of the 40 that did the
-- median lag was +22 minutes, with a tail running to +9,743 hours. The vendor drops
-- the original bonding-curve pair after migration, so the earliest surviving pool
-- is the migration pool. Against a 3.8-minute median post-to-mint lag, a 22-minute
-- error silently REVERSES the ordering the pre-mint gate exists to enforce.
--
-- A `not null` column would have been satisfied by exactly that wrong number. So
-- the invariant is stronger than not-null and is enforced three ways below:
--   1. the source is always recorded, and it is never nullable;
--   2. a vendor field can never claim 'exact' — only a launchpad API or the chain;
--   3. the timestamp may be absent ONLY when the confidence says 'unknown', and
--      'unknown' fails gate G1, so no Buy affordance can render behind it.
-- Absence is loud and cheap. A confident wrong timestamp costs a user money.

create table public.asset (
  chain    text not null check (chain in ('solana')),   -- add ROWS for a chain, not columns
  address  text not null,
  caip19   text not null unique,        -- 'solana:<genesis>/token:<mint>' — the wire id
  venue_id text not null,               -- 'solana:pumpfun' | 'solana:amm'

  minted_at         timestamptz,
  minted_at_source  text not null check (minted_at_source in
                      ('launchpad_api', 'chain_rpc', 'vendor_field', 'none')),
  minted_at_conf    text not null check (minted_at_conf in ('exact', 'bounded', 'unknown')),
  minted_at_bound_s integer,            -- half-width of the bound, in seconds

  -- A vendor field can NEVER be 'exact'. A database invariant, not a convention.
  constraint exact_requires_real_source check
    (minted_at_conf <> 'exact' or minted_at_source in ('launchpad_api', 'chain_rpc')),
  constraint bounded_requires_width check
    (minted_at_conf <> 'bounded' or minted_at_bound_s is not null),
  -- Absent iff unknown, in both directions: you cannot hide a missing timestamp
  -- behind a confident label, and you cannot label a timestamp you have as unknown.
  constraint unknown_iff_absent check
    ((minted_at is null) = (minted_at_conf = 'unknown')),
  constraint none_source_iff_unknown check
    ((minted_at_source = 'none') = (minted_at_conf = 'unknown')),

  -- OBSERVED, not an identifier. No unique constraint on symbol. Ever. One meme
  -- spawned 306 distinct tokens sharing a symbol; treating the symbol as a key is
  -- how you confidently return the wrong one of them.
  symbol   text,
  name     text,
  image_uri text,
  decimals integer,
  creator  text,

  -- The column name is the warning. Anything in here was typed by whoever minted
  -- the coin and may be a deliberate impersonation of the story's real source.
  declared_social jsonb,

  first_seen_at timestamptz not null default now(),
  primary key (chain, address)
);

-- Candidate generation is TIME-FIRST, symbol-second: select the coins minted in
-- the window after the story's earliest post, then score symbol as one channel
-- over that set. The inverse — search a vendor by symbol, then filter by time —
-- is what returns a plausible 65-day-old survivor for a fresh story.
create index asset_time_idx on public.asset (chain, minted_at desc)
  where minted_at is not null;
create index asset_symbol_idx on public.asset (chain, upper(symbol), minted_at desc);
create index asset_venue_idx on public.asset (venue_id, minted_at desc);

/* ── the mint coverage log ────────────────────────────────────────────────
   Owned by the chain watcher. One row per contiguous window of the mint stream we
   actually observed.

   This exists so that "resolved / negative" is assertable. A label may only say
   "no coin appeared" if we watched the entire window; if the cursor had a gap, the
   label is CENSORED, not negative. Without this table every gap silently becomes a
   negative training example, and the model learns from an absence that was ours,
   not the world's. */

create table internal.mint_coverage (
  chain       text not null,
  window_from timestamptz not null,
  window_to   timestamptz not null,
  observed_at timestamptz not null default now(),
  cursor_ref  text,                     -- the durable cursor position, for resume
  gap         boolean not null default false,
  gap_reason  text,

  primary key (chain, window_from),
  constraint window_is_forward check (window_to > window_from)
);

create index mint_coverage_gap_idx on internal.mint_coverage (chain, window_from desc)
  where gap;

grant select on public.asset to insidor_app;
