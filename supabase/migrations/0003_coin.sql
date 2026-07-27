-- 0003_coin.sql
-- The entity that did not exist. `narrative_tickers` was the only coin
-- storage and its spine was narrative_id, so 85-95% of the coins board — every
-- coin with no story — had nowhere to live. `coins`, `tokens`, `coin_index`
-- and `coin_mints` from four different feature lists are ONE table: coin.
BEGIN;
SELECT insidor.migration_begin('0003', 'coin', '@@CHECKSUM_0003@@');

CREATE TABLE IF NOT EXISTS public.coin (
  mint              text PRIMARY KEY,
  symbol            text,
  name              text,
  decimals          smallint,
  token_program     text,                -- create_v2 mints Token-2022, not Tokenkeg
  logo_url          text,
  logo_sha256       bytea,
  logo_phash        bit(64),
  creator_wallet    text,

  -- NULL is a legal, meaningful value: unknown age. It is never 0, and a NULL
  -- here forces the confidence stamp to NO STORY and suppresses Buy (0004).
  minted_at         timestamptz,
  minted_at_source  text NOT NULL DEFAULT 'unknown',

  launchpad         text,                -- 'pumpfun' | 'meteora' | ...
  curve_pct         real,
  migrated          boolean NOT NULL DEFAULT false,
  pool_address      text,
  socials           jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_twitter  text,                -- attacker-controlled; S_social caps at 0.85

  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  is_insidor_launch boolean NOT NULL DEFAULT false,
  is_major          boolean NOT NULL DEFAULT false,  -- G5: excluded from DERIVED
  updated_at        timestamptz NOT NULL DEFAULT now(),

  symbol_norm text GENERATED ALWAYS AS (
    upper(regexp_replace(COALESCE(symbol,''), '[^A-Za-z0-9]', '', 'g'))
  ) STORED,

  -- §02 asks for `band` generated. The Fresh 6h ceiling depends on now() and
  -- so cannot live in a stored generated column; it is an eligibility filter,
  -- not a band. What IS time-independent is generated here; the 6h ceiling is
  -- a WHERE clause in the board query (0012). A non-pumpfun launchpad has NULL
  -- curve_pct and lands in 'fresh' until a pool exists — never nowhere.
  band coin_band GENERATED ALWAYS AS (
    CASE
      WHEN migrated OR pool_address IS NOT NULL          THEN 'live'::coin_band
      WHEN curve_pct IS NOT NULL AND curve_pct >= 50     THEN 'graduating'::coin_band
      ELSE 'fresh'::coin_band
    END
  ) STORED
);

SELECT insidor.add_constraint('public.coin', 'coin_mint_base58',
  $$CHECK (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')$$);
SELECT insidor.add_constraint('public.coin', 'coin_symbol_len',
  $$CHECK (symbol IS NULL OR length(symbol) <= 13)$$);   -- create_v2 cap is 13
SELECT insidor.add_constraint('public.coin', 'coin_curve_range',
  $$CHECK (curve_pct IS NULL OR curve_pct BETWEEN 0 AND 100)$$);
SELECT insidor.add_constraint('public.coin', 'coin_minted_at_source_enum',
  $$CHECK (minted_at_source IN ('pumpportal_create','pair_min','launch','unknown'))$$);
-- If we claim to know when it was minted, we must say how we know.
SELECT insidor.add_constraint('public.coin', 'coin_minted_at_needs_source',
  $$CHECK ((minted_at IS NULL) = (minted_at_source = 'unknown'))$$);
SELECT insidor.add_constraint('public.coin', 'coin_minted_at_sane',
  $$CHECK (minted_at IS NULL OR minted_at > timestamptz '2020-01-01')$$);
SELECT insidor.add_constraint('public.coin', 'coin_decimals_range',
  $$CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 18)$$);

-- minted_at is write-once. Precedence is decided at write time (PumpPortal
-- create event > min(pairCreatedAt) across ALL Solana pairs > NULL). Letting a
-- later best-pair read overwrite it reintroduces the 418-vs-647-day defect.
DROP TRIGGER IF EXISTS coin_freeze_mint_time ON public.coin;
CREATE TRIGGER coin_freeze_mint_time
  BEFORE UPDATE ON public.coin
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('minted_at', 'creator_wallet');

DROP TRIGGER IF EXISTS coin_touch ON public.coin;
CREATE TRIGGER coin_touch BEFORE UPDATE ON public.coin
  FOR EACH ROW EXECUTE FUNCTION insidor.touch_updated_at();

-- Anti-duplicate check, per keystroke: symbol_norm equality then trigram.
CREATE INDEX IF NOT EXISTS coin_symbol_norm_idx ON public.coin (symbol_norm);
CREATE INDEX IF NOT EXISTS coin_symbol_trgm_idx
  ON public.coin USING gin (symbol_norm gin_trgm_ops);
-- Band boards: the ordered scan before heat is joined.
CREATE INDEX IF NOT EXISTS coin_band_minted_idx ON public.coin (band, minted_at DESC NULLS LAST);
-- creator_stat rollup and the DEV signal.
CREATE INDEX IF NOT EXISTS coin_creator_idx ON public.coin (creator_wallet) WHERE creator_wallet IS NOT NULL;
-- D-IMAGE: same image, different ticker.
CREATE INDEX IF NOT EXISTS coin_logo_sha_idx ON public.coin (logo_sha256) WHERE logo_sha256 IS NOT NULL;

COMMENT ON COLUMN public.coin.minted_at IS
  'Precedence: PumpPortal create event, then min(pairCreatedAt) across ALL Solana pairs, NULL if both absent. Never 0. Write-once.';
COMMENT ON TABLE public.coin IS
  'There is no age_min column. A stored age scalar is wrong the second after it is written.';

-- ===========================================================================
-- coin_snapshot — the time series. There was no price column anywhere in the
-- old schema, so every window and the entire CoinHeat formula were
-- uncomputable. Every numeric is NULLABLE: absent is not zero.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.coin_snapshot (
  mint               text NOT NULL REFERENCES public.coin(mint) ON DELETE CASCADE,
  captured_at        timestamptz NOT NULL,

  price_usd          numeric(38,18),
  mcap_usd           numeric(20,2),
  liquidity_usd      numeric(20,2),

  buy_vol_5m         numeric(20,2),
  sell_vol_5m        numeric(20,2),
  buy_vol_1h         numeric(20,2),
  sell_vol_1h        numeric(20,2),
  buy_vol_24h        numeric(20,2),
  sell_vol_24h       numeric(20,2),

  buys_5m            integer,
  sells_5m           integer,
  buyers_5m          integer,
  sellers_5m         integer,
  traders_5m         integer,
  net_buyers_5m      integer,

  organic_buy_5m     numeric(20,2),
  organic_sell_5m    numeric(20,2),
  organic_score      real,

  price_change_5m    real,
  price_change_1h    real,
  price_change_24h   real,

  holder_count            integer,
  holder_count_truncated  boolean NOT NULL DEFAULT false,  -- renders ">5,000"
  top1_pct                real,
  top10_pct               real,
  curve_pda_excluded      boolean NOT NULL DEFAULT false,

  curve_pct          real,
  source             text NOT NULL,        -- 'jupiter' | 'pumpportal' | 'dexscreener'
  grain_seconds      smallint NOT NULL DEFAULT 300,
  PRIMARY KEY (mint, captured_at)
);

-- $0 claims worthlessness; NULL claims ignorance. A zero price is never a fact.
SELECT insidor.add_constraint('public.coin_snapshot', 'coin_snapshot_price_positive',
  $$CHECK (price_usd IS NULL OR price_usd > 0)$$);
SELECT insidor.add_constraint('public.coin_snapshot', 'coin_snapshot_mcap_positive',
  $$CHECK (mcap_usd IS NULL OR mcap_usd > 0)$$);
SELECT insidor.add_constraint('public.coin_snapshot', 'coin_snapshot_pct_range',
  $$CHECK ((top1_pct  IS NULL OR top1_pct  BETWEEN 0 AND 100)
       AND (top10_pct IS NULL OR top10_pct BETWEEN 0 AND 100))$$);
-- A top-10 figure that includes the bonding-curve PDA reads 80-95% on every
-- healthy pre-graduation token. If it was not excluded we do not store it.
SELECT insidor.add_constraint('public.coin_snapshot', 'coin_snapshot_top10_needs_exclusion',
  $$CHECK (top10_pct IS NULL OR curve_pda_excluded)$$);
SELECT insidor.add_constraint('public.coin_snapshot', 'coin_snapshot_source_enum',
  $$CHECK (source IN ('jupiter','pumpportal','dexscreener','rugcheck','helius'))$$);

-- Serves the LEFT JOIN LATERAL that gives every board row its latest snapshot.
CREATE INDEX IF NOT EXISTS coin_snapshot_latest_idx
  ON public.coin_snapshot (mint, captured_at DESC);

-- ===========================================================================
-- coin_mcap_series — 5-minute mcap sampling for 24h, the ONLY source of
-- peak_mcap. Without it "peak" is a last-observed value with a flattering
-- label, which is why story_outcome refuses HIT/DUD below 6 samples (0005).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.coin_mcap_series (
  mint       text NOT NULL REFERENCES public.coin(mint) ON DELETE CASCADE,
  bucket_at  timestamptz NOT NULL,
  mcap_usd   numeric(20,2) NOT NULL,
  PRIMARY KEY (mint, bucket_at)
);
SELECT insidor.add_constraint('public.coin_mcap_series', 'coin_mcap_series_positive',
  $$CHECK (mcap_usd > 0)$$);
SELECT insidor.add_constraint('public.coin_mcap_series', 'coin_mcap_series_aligned',
  $$CHECK ((extract(epoch FROM (bucket_at - timestamptz 'epoch'))::bigint % 300) = 0)$$);

-- ===========================================================================
-- coin_safety — a Postgres RugCheck/Helius cache. The 300s in-memory cache
-- was per-lambda and therefore always cold.
--
-- There is no boolean anywhere in this table for an authority. api/safety.js
-- reported EVERY token mint- and freeze-revoked because it read `?? null` off
-- an endpoint with no authority fields and then wrote `x == null ? true`.
-- With authority_state NOT NULL DEFAULT 'unknown' that write is impossible:
-- the absent case has its own value and it fails the gate.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.coin_safety (
  mint                     text PRIMARY KEY REFERENCES public.coin(mint) ON DELETE CASCADE,
  mint_authority           authority_state NOT NULL DEFAULT 'unknown',
  freeze_authority         authority_state NOT NULL DEFAULT 'unknown',
  authority_source         text,                       -- 'helius' preferred
  transfer_fee_bps         integer,
  has_transfer_hook        boolean,
  sell_route               route_state NOT NULL DEFAULT 'unknown',
  sell_route_checked_at    timestamptz,
  top1_pct                 real,
  top10_pct                real,
  holder_count             integer,
  curve_pda_excluded       boolean NOT NULL DEFAULT false,
  lp_locked_pct            real,
  honeypot_proxy           boolean,                    -- sells_5m=0 AND buys_5m>30
  signals_checked          smallint NOT NULL DEFAULT 0,
  signals_total            smallint NOT NULL DEFAULT 9,
  raw                      jsonb,                      -- normalised server-side; never proxied
  checked_at               timestamptz NOT NULL DEFAULT now(),

  -- The mint-intrinsic half of the hard gate. Unknown fails closed, by
  -- construction: only the literal value 'revoked'/'ok' passes.
  -- Liquidity and band-dependent concentration thresholds are applied in the
  -- board query, because they are market data and change every tick.
  intrinsic_gate_pass boolean GENERATED ALWAYS AS (
        mint_authority   = 'revoked'
    AND freeze_authority = 'revoked'
    AND sell_route       = 'ok'
    AND COALESCE(transfer_fee_bps, 0) = 0
    AND COALESCE(has_transfer_hook, true) = false
    AND top10_pct IS NOT NULL
    AND curve_pda_excluded
  ) STORED
);

SELECT insidor.add_constraint('public.coin_safety', 'coin_safety_signals',
  $$CHECK (signals_checked BETWEEN 0 AND signals_total)$$);
SELECT insidor.add_constraint('public.coin_safety', 'coin_safety_top10_needs_exclusion',
  $$CHECK (top10_pct IS NULL OR curve_pda_excluded)$$);
SELECT insidor.add_constraint('public.coin_safety', 'coin_safety_route_needs_check',
  $$CHECK (sell_route = 'unknown' OR sell_route_checked_at IS NOT NULL)$$);

CREATE INDEX IF NOT EXISTS coin_safety_stale_idx ON public.coin_safety (checked_at);

COMMENT ON COLUMN public.coin_safety.mint_authority IS
  'Three-valued. absent -> unknown -> renders an em dash; present-and-empty -> revoked; present-with-a-pubkey -> active. On pump.fun mints both authorities are revoked by construction, so the UI renders them as a dim non-signal line, never a green tick.';

-- ===========================================================================
-- coin_image_embedding — separate space from post_embedding. Different model,
-- different dimensionality; mixing them in one column is a silent recall bug.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.coin_image_embedding (
  mint       text PRIMARY KEY REFERENCES public.coin(mint) ON DELETE CASCADE,
  model      text NOT NULL,             -- 'dinov2-vitb14' | 'sscd-disc-mixup'
  dims       smallint NOT NULL,
  embedding  halfvec(512) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coin_image_embedding_hnsw
  ON public.coin_image_embedding USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ===========================================================================
-- creator_stat — the DEV signal, free from the PumpPortal create stream.
-- Ships dark and accumulates ~14 days before the lime tick becomes reachable.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.creator_stat (
  creator_wallet    text PRIMARY KEY,
  mint_count        integer NOT NULL DEFAULT 0,
  rug_count         integer NOT NULL DEFAULT 0,   -- peak>=30k, now<=10% peak, age>=24h
  median_peak_mcap  numeric(20,2),
  first_mint_at     timestamptz,
  last_mint_at      timestamptz,
  has_verdict       boolean NOT NULL DEFAULT false,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
-- A clean tick can never be manufactured by absence of data.
SELECT insidor.add_constraint('public.creator_stat', 'creator_stat_verdict_needs_history',
  $$CHECK (has_verdict = false OR (mint_count >= 1 AND first_mint_at IS NOT NULL))$$);

SELECT insidor.migration_end('0003', 'coin', '@@CHECKSUM_0003@@');
COMMIT;
