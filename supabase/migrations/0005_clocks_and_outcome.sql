-- 0005_clocks_and_outcome.sql
--
-- The two prospective clocks, their gap detection, the derived lead time, and
-- the honest record. Today's "+31m early" badges have no prospective clock
-- behind them at all; this file is what makes the product's headline number a
-- measurement rather than an assertion.
BEGIN;
SELECT insidor.migration_begin('0005', 'clocks_and_outcome', '@@CHECKSUM_0005@@');

-- ===========================================================================
-- Clock A — every Solana mint, from the PumpPortal websocket. Written BEFORE
-- any alert fires. A retrospective search has lookahead bias and would make
-- the headline number a lie.
--
-- The mint stream is `coin` itself (coin.minted_at + minted_at_source =
-- 'pumpportal_create'). There is no separate coin_mints table: two tables
-- holding a mint time is two tables that can disagree.
-- ===========================================================================

-- ===========================================================================
-- Clock B — ~300 crypto-Twitter accounts polled every 2 minutes.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.ct_mention (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id         uuid REFERENCES public.story(id) ON DELETE CASCADE,
  mint             text REFERENCES public.coin(mint) ON DELETE CASCADE,
  handle           text NOT NULL,
  platform_post_id text NOT NULL,
  posted_at        timestamptz NOT NULL,
  observed_at      timestamptz NOT NULL DEFAULT now(),
  permalink        text NOT NULL,
  matched_on       text NOT NULL,     -- 'cashtag' | 'mint' | 'entity' | 'quote'
  created_at       timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.ct_mention', 'ct_mention_key',
  'UNIQUE (handle, platform_post_id)');
SELECT insidor.add_constraint('public.ct_mention', 'ct_mention_targets_something',
  $$CHECK (story_id IS NOT NULL OR mint IS NOT NULL)$$);
-- The proof travels with the claim: a permalink belonging to somebody else.
SELECT insidor.add_constraint('public.ct_mention', 'ct_mention_permalink_present',
  $$CHECK (length(permalink) > 0)$$);
CREATE INDEX IF NOT EXISTS ct_mention_story_first_idx
  ON public.ct_mention (story_id, posted_at) WHERE story_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ct_mention_mint_first_idx
  ON public.ct_mention (mint, posted_at) WHERE mint IS NOT NULL;

-- ===========================================================================
-- Sensor liveness and gaps. Symmetric by construction: one table, one enum,
-- so it is impossible to ship gap detection for the mint stream and forget it
-- for the CT poller.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.sensor_heartbeat (
  sensor            sensor PRIMARY KEY,
  last_beat_at      timestamptz NOT NULL,
  -- The watermark: the sensor has fully observed everything up to this point.
  observed_through  timestamptz NOT NULL,
  connected_at      timestamptz,
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb
);
SELECT insidor.add_constraint('public.sensor_heartbeat', 'sensor_watermark_not_future',
  $$CHECK (observed_through <= last_beat_at + interval '1 minute')$$);

CREATE TABLE IF NOT EXISTS public.sensor_gap (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sensor      sensor NOT NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  detected_by text NOT NULL,        -- 'supervisor' | 'heartbeat_job' | 'manual'
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.sensor_gap', 'sensor_gap_ordered',
  $$CHECK (ended_at IS NULL OR ended_at > started_at)$$);
CREATE INDEX IF NOT EXISTS sensor_gap_window_idx ON public.sensor_gap (sensor, started_at, ended_at);

-- ===========================================================================
-- story_clock — one row per promoted story. This is where lead time lives,
-- and the table is designed so that a lead time WITHOUT both clock readings
-- is not a bug you can ship, it is a row Postgres will not accept.
--
-- Four mechanisms together:
--   1. promoted_at is copied here by trigger from story.promoted_at, which is
--      itself write-once; the row cannot be created before PROMOTE.
--   2. t_mint_observed_through and t_ct_observed_through are NOT NULL: you
--      cannot record a clock without recording how far that sensor had
--      actually scanned. A missing sensor has no watermark and no row.
--   3. Both watermarks must reach past promoted_at, so a lead measured by a
--      sensor that had not yet caught up is rejected.
--   4. t_crypto and lead_time_min are GENERATED. There is no way to write a
--      lead time by hand at all.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.story_clock (
  story_id                 uuid PRIMARY KEY REFERENCES public.story(id) ON DELETE CASCADE,

  promoted_at              timestamptz NOT NULL,   -- copied from story by trigger

  t_mint                   timestamptz,            -- first matching mint
  t_mint_mint              text REFERENCES public.coin(mint) ON DELETE SET NULL,
  t_ct                     timestamptz,            -- first crypto-Twitter post
  t_ct_handle              text,
  t_ct_url                 text,

  -- Reading 2 of 2 from each sensor: how far it had scanned when we measured.
  t_mint_observed_through  timestamptz NOT NULL,
  t_ct_observed_through    timestamptz NOT NULL,

  first_post_at            timestamptz,

  -- Set by the gap job when a sensor_gap overlaps [promoted_at, t_crypto].
  unmeasurable             boolean NOT NULL DEFAULT false,
  unmeasurable_sensor      sensor,
  unmeasurable_gap_id      bigint REFERENCES public.sensor_gap(id) ON DELETE SET NULL,

  measured_at              timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- LEAST() is avoided: an explicit CASE is unambiguously immutable.
  t_crypto timestamptz GENERATED ALWAYS AS (
    CASE
      WHEN t_mint IS NULL THEN t_ct
      WHEN t_ct   IS NULL THEN t_mint
      WHEN t_mint < t_ct  THEN t_mint
      ELSE t_ct
    END
  ) STORED,

  lead_time_min integer GENERATED ALWAYS AS (
    CASE
      WHEN t_mint IS NULL AND t_ct IS NULL THEN NULL
      ELSE round(
        extract(epoch FROM (
          (CASE
             WHEN t_mint IS NULL THEN t_ct
             WHEN t_ct   IS NULL THEN t_mint
             WHEN t_mint < t_ct  THEN t_mint
             ELSE t_ct
           END) - promoted_at
        )) / 60.0
      )::int
    END
  ) STORED
);

-- A clock event cannot be later than the watermark that claims to have seen it.
SELECT insidor.add_constraint('public.story_clock', 'story_clock_mint_within_watermark',
  $$CHECK (t_mint IS NULL OR t_mint <= t_mint_observed_through)$$);
SELECT insidor.add_constraint('public.story_clock', 'story_clock_ct_within_watermark',
  $$CHECK (t_ct IS NULL OR t_ct <= t_ct_observed_through)$$);

-- THE constraint that makes "a lead time recorded without both clock readings"
-- impossible: both sensors must have scanned past the promote moment before
-- any lead time can be computed from this row at all.
SELECT insidor.add_constraint('public.story_clock', 'story_clock_both_sensors_past_promote',
  $$CHECK (t_mint_observed_through >= promoted_at AND t_ct_observed_through >= promoted_at)$$);

-- Unmeasurable must name the blind sensor. "We will not claim a number we
-- could not verify" needs the sensor's name in the copy.
SELECT insidor.add_constraint('public.story_clock', 'story_clock_unmeasurable_names_sensor',
  $$CHECK (unmeasurable = false OR unmeasurable_sensor IS NOT NULL)$$);

-- If we claim a first crypto post we must be able to link to it.
SELECT insidor.add_constraint('public.story_clock', 'story_clock_ct_needs_proof',
  $$CHECK (t_ct IS NULL OR (t_ct_handle IS NOT NULL AND t_ct_url IS NOT NULL))$$);
SELECT insidor.add_constraint('public.story_clock', 'story_clock_mint_needs_mint',
  $$CHECK (t_mint IS NULL OR t_mint_mint IS NOT NULL)$$);

-- Both clock readings and promoted_at are write-once. t_crypto = min of the
-- two, so a later sighting must never move an already-recorded first sighting.
DROP TRIGGER IF EXISTS story_clock_freeze ON public.story_clock;
CREATE TRIGGER story_clock_freeze
  BEFORE UPDATE ON public.story_clock
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('promoted_at', 't_mint', 't_ct');

CREATE OR REPLACE FUNCTION insidor.story_clock_copy_promoted_at() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_promoted timestamptz;
BEGIN
  SELECT promoted_at INTO v_promoted FROM public.story WHERE id = NEW.story_id;
  IF v_promoted IS NULL THEN
    RAISE EXCEPTION 'story % has no promoted_at; a clock cannot exist before PROMOTE', NEW.story_id;
  END IF;
  NEW.promoted_at := v_promoted;   -- not the caller's value. The story is the source.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS story_clock_promoted_at ON public.story_clock;
CREATE TRIGGER story_clock_promoted_at
  BEFORE INSERT ON public.story_clock
  FOR EACH ROW EXECUTE FUNCTION insidor.story_clock_copy_promoted_at();

DROP TRIGGER IF EXISTS story_clock_touch ON public.story_clock;
CREATE TRIGGER story_clock_touch BEFORE UPDATE ON public.story_clock
  FOR EACH ROW EXECUTE FUNCTION insidor.touch_updated_at();

-- The record, sorted by lead. Lead is sortable everywhere it appears.
CREATE INDEX IF NOT EXISTS story_clock_lead_idx
  ON public.story_clock (lead_time_min) WHERE unmeasurable = false;
-- "+2h14m and counting": stories with no t_crypto yet, both clocks live.
CREATE INDEX IF NOT EXISTS story_clock_open_idx
  ON public.story_clock (promoted_at DESC) WHERE t_mint IS NULL AND t_ct IS NULL;

COMMENT ON TABLE public.story_clock IS
  'lead_time_min is GENERATED. It cannot be inserted, updated, or backfilled. If it is present, both sensor watermarks were past promoted_at and at least one clock fired.';

-- ===========================================================================
-- story_outcome — the honest record. Misses are visible by default.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.story_outcome (
  story_id          uuid PRIMARY KEY REFERENCES public.story(id) ON DELETE CASCADE,
  outcome           story_outcome_kind NOT NULL,
  lead_time_min     integer,             -- frozen copy from story_clock
  first_coin_mint   text REFERENCES public.coin(mint) ON DELETE SET NULL,
  peak_mcap         numeric(20,2),
  peak_mcap_samples integer NOT NULL DEFAULT 0,
  hit_threshold     numeric(20,2),       -- the threshold in force when classified
  lifecycle_reason  text,                -- 'dead' | 'starved' | 'merged'
  classified_at     timestamptz NOT NULL DEFAULT now(),
  classifier_version text NOT NULL
);

SELECT insidor.add_constraint('public.story_outcome', 'story_outcome_late_is_negative',
  $$CHECK (outcome <> 'late' OR (lead_time_min IS NOT NULL AND lead_time_min < 0))$$);
SELECT insidor.add_constraint('public.story_outcome', 'story_outcome_no_coin_has_no_coin',
  $$CHECK (outcome <> 'no_coin' OR first_coin_mint IS NULL)$$);
SELECT insidor.add_constraint('public.story_outcome', 'story_outcome_hit_dud_need_coin',
  $$CHECK (outcome NOT IN ('hit','dud') OR first_coin_mint IS NOT NULL)$$);

-- A "peak" market cap derived from a single observation is a last-observed
-- value with a flattering label. Six samples is 30 minutes of the series.
SELECT insidor.add_constraint('public.story_outcome', 'story_outcome_peak_needs_series',
  $$CHECK (outcome NOT IN ('hit','dud')
           OR (peak_mcap IS NOT NULL AND peak_mcap_samples >= 6 AND hit_threshold IS NOT NULL))$$);

-- Unmeasurable stories leave the aggregate record; they are never wins.
SELECT insidor.add_constraint('public.story_outcome', 'story_outcome_unmeasurable_has_no_lead',
  $$CHECK (outcome <> 'unmeasurable' OR lead_time_min IS NULL)$$);

CREATE INDEX IF NOT EXISTS story_outcome_recent_idx ON public.story_outcome (classified_at DESC);
CREATE INDEX IF NOT EXISTS story_outcome_kind_idx   ON public.story_outcome (outcome, classified_at DESC);
-- The monitor that holds count(outcome IS NULL AND promoted_at < now()-72h) at
-- zero is an anti-join against story_promoted_at_idx (0002).

SELECT insidor.migration_end('0005', 'clocks_and_outcome', '@@CHECKSUM_0005@@');
COMMIT;
