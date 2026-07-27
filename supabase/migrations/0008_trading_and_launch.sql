-- 0008_trading_and_launch.sql
-- trade (request_id unique so the DATABASE enforces single submission across
-- tabs), launch, namer_run, fee_share.
BEGIN;
SELECT insidor.migration_begin('0008', 'trading_and_launch', '@@CHECKSUM_0008@@');

CREATE TABLE IF NOT EXISTS public.trade (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Written at ORDERING. Unique, so a second tab cannot submit the same order.
  request_id        text NOT NULL,
  user_id           uuid NOT NULL REFERENCES public.app_user(id) ON DELETE CASCADE,
  wallet            text NOT NULL,
  mint              text NOT NULL REFERENCES public.coin(mint) ON DELETE RESTRICT,
  story_id          uuid REFERENCES public.story(id) ON DELETE SET NULL,
  side              trade_side NOT NULL,
  status            trade_status NOT NULL DEFAULT 'ordering',

  in_amount_raw     numeric(40,0) NOT NULL,
  in_mint           text NOT NULL,
  out_amount_raw    numeric(40,0),
  min_out_raw       numeric(40,0) NOT NULL,
  price_impact_pct  real,
  route             text,
  slippage_bps      integer,

  -- Frozen from the order that produced the signed transaction, and
  -- re-asserted server-side against this request_id inside /api/execute.
  fee_bps_quoted    integer NOT NULL,
  fee_bps_charged   integer,
  -- Captured server-side at submission. Every PnL number in the product
  -- derives from this column, never from a browser price global.
  sol_usd_at_trade  numeric(20,6) NOT NULL,

  signature         text,
  error_code        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  submitted_at      timestamptz,
  confirmed_at      timestamptz
);

SELECT insidor.add_constraint('public.trade', 'trade_request_id_key', 'UNIQUE (request_id)');
SELECT insidor.add_constraint('public.trade', 'trade_signature_key',  'UNIQUE (signature)');
SELECT insidor.add_constraint('public.trade', 'trade_fee_bps_range',
  $$CHECK (fee_bps_quoted BETWEEN 0 AND 255
       AND (fee_bps_charged IS NULL OR fee_bps_charged BETWEEN 0 AND 255))$$);
-- A fill is confirmed by signature status, never inferred from a balance change.
SELECT insidor.add_constraint('public.trade', 'trade_confirmed_needs_signature',
  $$CHECK (status <> 'confirmed'
           OR (signature IS NOT NULL AND out_amount_raw IS NOT NULL AND confirmed_at IS NOT NULL))$$);
SELECT insidor.add_constraint('public.trade', 'trade_amounts_positive',
  $$CHECK (in_amount_raw > 0 AND min_out_raw >= 0)$$);
SELECT insidor.add_constraint('public.trade', 'trade_wallet_base58',
  $$CHECK (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')$$);

DROP TRIGGER IF EXISTS trade_freeze ON public.trade;
CREATE TRIGGER trade_freeze BEFORE UPDATE ON public.trade
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns(
    'request_id', 'signature', 'fee_bps_quoted', 'sol_usd_at_trade',
    'in_amount_raw', 'min_out_raw');

CREATE INDEX IF NOT EXISTS trade_user_idx ON public.trade (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trade_mint_idx ON public.trade (mint, created_at DESC);
-- The "still confirming" poller.
CREATE INDEX IF NOT EXISTS trade_pending_idx
  ON public.trade (submitted_at) WHERE status IN ('signed','submitted');

COMMENT ON COLUMN public.trade.fee_bps_quoted IS
  'Jupiter documents a 50 bps referral floor but a 10 bps platform fee was measured live on fresh mints. The range check is deliberately wide: this number is read from the order response and displayed, never hardcoded. FLAGGED FOR VERIFICATION on the day the swap route is written.';

-- ===========================================================================
-- launch
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.launch (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mint                text UNIQUE REFERENCES public.coin(mint) ON DELETE SET NULL,
  story_id            uuid NOT NULL,
  -- Carried so the composite FK below can refuse a launch against a story
  -- whose tier forbids it. ON UPDATE RESTRICT: reclassifying a story that has
  -- already launched a coin is exactly founder open question 9 and must not
  -- be resolved by a silent cascade.
  story_coinability_tier coinability_tier NOT NULL,

  creator_user_id     uuid NOT NULL REFERENCES public.app_user(id) ON DELETE RESTRICT,
  signer_wallet       text NOT NULL,
  creator_wallet      text NOT NULL,       -- create_v2: may differ from signer

  ticker              text NOT NULL,
  name                text NOT NULL,
  image_url           text,
  image_sha256        bytea,
  metadata_uri        text,

  -- Generated and persisted encrypted BEFORE the first signature, so a retry
  -- reuses it and a late confirmation fails with "account already in use"
  -- rather than minting twice.
  mint_keypair_enc    bytea NOT NULL,
  first_buy_sol       numeric(20,9) NOT NULL DEFAULT 0,

  sharing_config_pubkey text,
  fee_shares_written_at timestamptz,
  namer_run_id        uuid,

  tx_signature        text UNIQUE,
  status              text NOT NULL DEFAULT 'prepared',
  error_code          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  landed_at           timestamptz
);

SELECT insidor.add_constraint('public.launch', 'launch_story_tier_fk',
  $$FOREIGN KEY (story_id, story_coinability_tier)
      REFERENCES public.story (id, coinability_tier) ON UPDATE RESTRICT$$);
-- D3, as a foreign key: a launch row cannot exist against a story that is not
-- tier `normal`. Not a client check, not a server check, not a view.
SELECT insidor.add_constraint('public.launch', 'launch_requires_normal_tier',
  $$CHECK (story_coinability_tier = 'normal')$$);
SELECT insidor.add_constraint('public.launch', 'launch_ticker_shape',
  $$CHECK (ticker ~ '^[A-Z][A-Z0-9]{1,12}$')$$);
SELECT insidor.add_constraint('public.launch', 'launch_name_len',
  $$CHECK (length(name) BETWEEN 1 AND 32)$$);
SELECT insidor.add_constraint('public.launch', 'launch_status_enum',
  $$CHECK (status IN ('prepared','signing','landed','failed','expired'))$$);
SELECT insidor.add_constraint('public.launch', 'launch_landed_has_mint',
  $$CHECK (status <> 'landed' OR (mint IS NOT NULL AND tx_signature IS NOT NULL AND landed_at IS NOT NULL))$$);

DROP TRIGGER IF EXISTS launch_freeze ON public.launch;
CREATE TRIGGER launch_freeze BEFORE UPDATE ON public.launch
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns(
    'mint_keypair_enc', 'mint', 'tx_signature', 'creator_wallet', 'ticker');

-- Rate limits: launches_last_1h / launches_last_24h in story_cta_v.
CREATE INDEX IF NOT EXISTS launch_creator_recent_idx
  ON public.launch (creator_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS launch_story_idx ON public.launch (story_id);

-- ===========================================================================
-- namer_run — written at FORM OPEN, not at submit. Abandonment is the
-- strongest negative signal the namer produces, and a table that only records
-- submissions fits the weights on a hits-only sample.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.namer_run (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id                 uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  user_id                  uuid REFERENCES public.app_user(id) ON DELETE SET NULL,
  device_id                text,
  opened_at                timestamptz NOT NULL DEFAULT now(),
  deterministic_top        text,
  deterministic_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  model                    text,
  model_candidates         jsonb,
  model_latency_ms         integer,
  gate_failures            text[] NOT NULL DEFAULT '{}',
  chosen_ticker            text,
  outcome                  text,          -- accepted|edited|abandoned|typed_over
  time_to_first_keystroke_ms integer,
  closed_at                timestamptz
);
SELECT insidor.add_constraint('public.namer_run', 'namer_run_outcome_enum',
  $$CHECK (outcome IS NULL OR outcome IN ('accepted','edited','abandoned','typed_over'))$$);
CREATE INDEX IF NOT EXISTS namer_run_story_idx ON public.namer_run (story_id, opened_at DESC);

-- ===========================================================================
-- fee_share — created on every launch so the option is preserved permanently;
-- the shares themselves are not written until founder decision D1 lands.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.fee_share (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mint           text NOT NULL REFERENCES public.coin(mint) ON DELETE CASCADE,
  config_pubkey  text NOT NULL,
  recipient      text NOT NULL,
  role           text NOT NULL,          -- 'creator' | 'poster' | 'insidor'
  bps            integer NOT NULL,
  written_at     timestamptz,            -- NULL = config exists, shares not set
  created_at     timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.fee_share', 'fee_share_bps_range',
  $$CHECK (bps BETWEEN 0 AND 10000)$$);
SELECT insidor.add_constraint('public.fee_share', 'fee_share_role_enum',
  $$CHECK (role IN ('creator','poster','insidor'))$$);
SELECT insidor.add_constraint('public.fee_share', 'fee_share_unique',
  'UNIQUE (mint, role)');
-- updateFeeSharesV2 is one-shot on chain. Write-once here so the database
-- cannot disagree with the chain about whether it has been spent.
DROP TRIGGER IF EXISTS fee_share_freeze ON public.fee_share;
CREATE TRIGGER fee_share_freeze BEFORE UPDATE ON public.fee_share
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('written_at', 'recipient', 'bps');

SELECT insidor.migration_end('0008', 'trading_and_launch', '@@CHECKSUM_0008@@');
COMMIT;
