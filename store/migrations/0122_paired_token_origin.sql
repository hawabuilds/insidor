-- 0122_paired_token_origin.sql
--
-- A TOKEN WE MET ONLY AS WHAT A LAUNCH WAS PAIRED AGAINST IS NOT A LAUNCH: the asset origin
-- 'paired_token'.
--
-- The launchpad lets a coin's curve be priced in another token — a stablecoin, a tokenised stock
-- (MSTRx, NVDAx, TSLAx, SPYx, METAx…), another coin. For those launches the launch socket put the
-- PAIRED token's address where the new coin's belongs, beside the new coin's name. Measured 21 Oct
-- 2026: MSTRx held as "LAURA" (and, in the name index, "Junior USD*", its first sighting, kept
-- forever by 0037), USDC held under an empty name, eighteen tokenised stocks in all under memes'
-- names — each renamed by every later launch against it — and the memes themselves (Laura,
-- Cg9z…pump) with no row. Coin matching, coin-first, picks and pushes all read those rows.
--
-- The adapter now refuses such a frame (adapters/venue/solana-pumpfun/src/stream.ts). This is the
-- other half: what a row already filed that way becomes, and what keeps it that way.
--
-- ★ AN ORIGIN, NOT A FLAG, because origin is the column every surface asserting a launch already
-- filters with an allowlist (OBSERVED_ASSET_ORIGINS). A value outside it is excluded everywhere
-- with no reader edited; a flag column would be a join or a predicate every reader must remember.
--
-- ★ IT IS FINAL. repo/assets.ts never lets a later launch frame rename a 'paired_token' row or
-- promote it back to observed: the next coin launched against MSTRx would otherwise file MSTRx
-- under its name again. Written by chainwatch's launch listing (a pool's paired token with no
-- curve of its own) and by tools/repair-stock-launches.ts.
--
-- The 0037 name-index trigger fires on INSERT of a 'live_stream' or 'backfill' row only, so a
-- 'paired_token' row never enters public.coin_name; the writers above correct the name a
-- misfiled row already left there (its market name and ticker, launch time unknown).
--
-- What breaks if changed carelessly: the list below is ASSET_ORIGINS in contracts/src/asset.ts,
-- held equal by store/src/migrations.test.ts, which now reads it from this file.

alter table public.asset drop constraint origin_is_a_known_kind;

alter table public.asset add constraint origin_is_a_known_kind check
  (origin in ('live_stream', 'backfill', 'operator', 'fixture', 'unrecorded', 'paired_token'));
