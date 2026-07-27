-- 0004_matching.sql
--
-- The correctness-critical file. Two tables and six CHECK constraints stand
-- between this product and a Buy button on an unrelated coin.
--
-- The old build had ONE table, narrative_tickers, doing four incompatible
-- jobs: create-path prefill, cashtag candidate, market-data cache, and coin
-- identity. An LLM-invented ticker landed in the same Map as a real cashtag
-- with no provenance column, became canonical by meme score, was resolved
-- against a live market, and rendered Buy. That is four jobs collapsing into
-- one row. Here they are two tables and they cannot touch:
--
--   story_ticker  candidates and prefills. HAS NO MARKET COLUMNS AT ALL.
--   coin_match    the (story, mint) verdict. The only input to the button.
BEGIN;
SELECT insidor.migration_begin('0004', 'matching', '@@CHECKSUM_0004@@');

-- ===========================================================================
-- story_ticker
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.story_ticker (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id      uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  ticker        text NOT NULL,
  name          text,

  -- NOT NULL, NO DEFAULT. An INSERT that forgets provenance fails. This is
  -- the whole fix: there is no value this column can hold that means
  -- "we don't know where this ticker came from".
  source        ticker_source NOT NULL,

  -- For 'llm', the exact span the model was grounded on. Rule 1 of the namer
  -- gate is that the span is a substring of the corpus; the column makes the
  -- claim auditable after the fact.
  source_span   text,
  post_id       uuid REFERENCES public.post(id) ON DELETE SET NULL,

  -- An LLM-suggested ticker may NEVER carry a mint. Constraint below.
  resolved_mint text REFERENCES public.coin(mint) ON DELETE SET NULL,

  score         real,          -- harvester ranking, create-form ordering only
  created_at    timestamptz NOT NULL DEFAULT now()
);

SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_shape',
  $$CHECK (ticker ~ '^[A-Z][A-Z0-9]{1,12}$')$$);

-- THE constraint. The $KANG defect, expressed as an impossibility.
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_llm_never_resolves',
  $$CHECK (source <> 'llm' OR resolved_mint IS NULL)$$);

-- An ungrounded LLM suggestion cannot even be stored.
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_llm_needs_span',
  $$CHECK (source <> 'llm' OR source_span IS NOT NULL)$$);

-- A cashtag or a mint-in-post claim must name the post it came from.
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_evidence_needs_post',
  $$CHECK (source NOT IN ('cashtag','mint_in_post') OR post_id IS NOT NULL)$$);

-- We minted it ourselves; ground truth, and the mint is mandatory.
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_launch_has_mint',
  $$CHECK (source <> 'insidor_launch' OR resolved_mint IS NOT NULL)$$);

SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_unique',
  'UNIQUE (story_id, ticker, source)');

CREATE INDEX IF NOT EXISTS story_ticker_story_idx ON public.story_ticker (story_id);
-- $TICKER search mode and the create-form prefill, which reads only the
-- non-'llm' sources.
CREATE INDEX IF NOT EXISTS story_ticker_prefill_idx
  ON public.story_ticker (ticker) WHERE source IN ('cashtag','mint_in_post');
CREATE INDEX IF NOT EXISTS story_ticker_trgm_idx
  ON public.story_ticker USING gin (ticker gin_trgm_ops);

COMMENT ON TABLE public.story_ticker IS
  'Candidates and create-path prefills. Deliberately carries NO mcap, liquidity, holders, vol24h, safety, canonical or first_deployed column. Those columns are how a suggested ticker got resolved against a live market and rendered a Buy button. Their absence is the fix.';

-- ===========================================================================
-- coin_match — one row per (story, mint). The only input to the primary button.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.coin_match (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id         uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  mint             text NOT NULL REFERENCES public.coin(mint) ON DELETE CASCADE,

  verdict          match_verdict  NOT NULL,
  relation         match_relation NOT NULL,

  -- Denormalised at match time. story_ticker is truncated and re-inserted by
  -- the pipeline every cycle; a page load racing a cycle would render
  -- "Buy $undefined". The button never reads a table that can vanish.
  ticker           text NOT NULL,
  name             text,
  ticker_source    ticker_source NOT NULL,

  score            real NOT NULL,

  -- Per-channel scores. NULL means NOT CHECKED and is rendered as
  -- "not checked", never "failed", never 0. The denominator in the evidence
  -- popover is channels_ran, not five.
  s_mint_in_post   real,
  s_img            real,
  s_text           real,
  s_tick           real,
  s_social         real,

  time_prior           real NOT NULL,
  market_plausibility  real,

  -- Copied from coin.minted_at at match time. Both are write-once, so they
  -- cannot drift apart.
  mint_time        timestamptz,
  earliest_post_at timestamptz NOT NULL,

  matcher_version  text NOT NULL,

  -- Raw feature vector. Server-only: 0011 revokes SELECT on this column and on
  -- `score` from anon, so "73% match" cannot reach a browser even by mistake.
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The categorical prose the stamp renders: {"image":"strong","name":"strong",
  -- "ticker":"weak","mint_in_post":"not_checked"}
  evidence_public  jsonb NOT NULL DEFAULT '{}'::jsonb,

  matched_at       timestamptz NOT NULL DEFAULT now(),
  retracted_at     timestamptz,

  -- ---- generated: read-side conveniences, all derived from base columns ----
  channels_ran smallint GENERATED ALWAYS AS (
      (s_mint_in_post IS NOT NULL)::int
    + (s_img          IS NOT NULL)::int
    + (s_text         IS NOT NULL)::int
    + (s_tick         IS NOT NULL)::int
    + (s_social       IS NOT NULL)::int
  ) STORED,

  strong_channels smallint GENERATED ALWAYS AS (
      (COALESCE(s_img,  0) >= 0.55)::int
    + (COALESCE(s_text, 0) >= 0.55)::int
    + (COALESCE(s_tick, 0) >= 0.60)::int
  ) STORED,

  delta_min integer GENERATED ALWAYS AS (
    CASE WHEN mint_time IS NULL THEN NULL
         ELSE round(extract(epoch FROM (mint_time - earliest_post_at)) / 60.0)::int
    END
  ) STORED
);

SELECT insidor.add_constraint('public.coin_match', 'coin_match_pair_key',
  'UNIQUE (story_id, mint)');
SELECT insidor.add_constraint('public.coin_match', 'coin_match_score_range',
  $$CHECK (score BETWEEN 0 AND 1)$$);
SELECT insidor.add_constraint('public.coin_match', 'coin_match_channel_ranges',
  $$CHECK ((s_mint_in_post IS NULL OR s_mint_in_post BETWEEN 0 AND 1)
       AND (s_img   IS NULL OR s_img   BETWEEN 0 AND 1)
       AND (s_text  IS NULL OR s_text  BETWEEN 0 AND 1)
       AND (s_tick  IS NULL OR s_tick  BETWEEN 0 AND 1)
       AND (s_social IS NULL OR s_social BETWEEN 0 AND 0.85))$$);
SELECT insidor.add_constraint('public.coin_match', 'coin_match_ticker_shape',
  $$CHECK (ticker ~ '^[A-Z][A-Z0-9]{1,12}$')$$);

-- =========================================================================
-- (1) A CONFIRMED match cannot exist without the evidence that justifies it.
--
-- Every clause here is a §5.7 rule. The expressions are written out in full
-- rather than referencing the generated columns above, so the constraint holds
-- on every Postgres version regardless of how generated columns are treated in
-- constraint expressions.
-- =========================================================================
-- The predicate is written out in full inside the constraint rather than
-- called as a function: a CHECK that depends on a user-defined function is a
-- pg_dump/restore ordering hazard, and this is the one constraint that must
-- never fail to be restored. The identical predicate is exported as
-- public.confirmable() below for the matcher's tests and the eval harness --
-- if the two ever disagree, the CI diff catches it.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_confirmed_requires_evidence',
$$CHECK (
  verdict <> 'confirmed' OR (
        score >= 0.80
    AND ticker_source <> 'llm'          -- provenance: an invented ticker can never confirm
    AND mint_time IS NOT NULL           -- unknown age fails closed, never "brand new"
    AND relation <> 'mentioned'         -- a typed cashtag is candidate generation, not a verdict
    AND (
          COALESCE(s_mint_in_post, 0) >= 0.90                   -- near proof, OR
       OR ( (COALESCE(s_img,  0) >= 0.55)::int
          + (COALESCE(s_text, 0) >= 0.55)::int
          + (COALESCE(s_tick, 0) >= 0.60)::int ) >= 2           -- two strong channels
        )
  )
)$$);

CREATE OR REPLACE FUNCTION public.confirmable(
  p_mint_in_post real, p_img real, p_text real, p_tick real
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_mint_in_post, 0) >= 0.90
      OR ( (COALESCE(p_img,  0) >= 0.55)::int
         + (COALESCE(p_text, 0) >= 0.55)::int
         + (COALESCE(p_tick, 0) >= 0.60)::int ) >= 2
$$;

-- G2 / G3, the temporal gates. DERIVED means "minted because of this story",
-- so the mint cannot predate the earliest post by more than clock skew, and
-- cannot follow it by more than 48h. This single constraint kills the
-- GYATT class: a 604-day-old shell can never be DERIVED.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_derived_temporal_gate',
$$CHECK (
  relation <> 'derived' OR (
        mint_time IS NOT NULL
    AND mint_time >= earliest_post_at - interval '10 minutes'
    AND mint_time <= earliest_post_at + interval '48 hours'
  )
)$$);

-- ADOPTED is the inverse claim and must state its own age.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_adopted_predates',
$$CHECK (
  relation <> 'adopted' OR (mint_time IS NOT NULL AND mint_time < earliest_post_at - interval '10 minutes')
)$$);

-- MENTIONED is an input, never a verdict.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_mentioned_not_actionable',
  $$CHECK (relation <> 'mentioned' OR verdict = 'unsure')$$);

-- Retraction is explicit and terminal, never a silent flip.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_retraction',
  $$CHECK (retracted_at IS NULL OR verdict = 'rejected')$$);

-- The evidence popover renders words for the channels that ran. If nothing
-- ran, there is nothing to show and nothing to confirm.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_public_evidence_present',
  $$CHECK (verdict = 'rejected' OR jsonb_typeof(evidence_public) = 'object' AND evidence_public <> '{}'::jsonb)$$);

-- Story page / coin page: matches for a story, confirmed first then score.
CREATE INDEX IF NOT EXISTS coin_match_story_idx
  ON public.coin_match (story_id, verdict, score DESC) WHERE retracted_at IS NULL;
-- Coins board LATERAL: one match per mint, confirmed before unsure.
CREATE INDEX IF NOT EXISTS coin_match_mint_idx
  ON public.coin_match (mint, verdict, score DESC) WHERE retracted_at IS NULL;
-- "N more coins from this story" sibling strip, sorted by mint_time asc.
CREATE INDEX IF NOT EXISTS coin_match_confirmed_mint_time_idx
  ON public.coin_match (story_id, mint_time)
  WHERE verdict = 'confirmed' AND retracted_at IS NULL;

COMMENT ON COLUMN public.coin_match.score IS
  'Stored for calibration. Column-level GRANT in 0011 keeps it off the wire. A user shown "73%" beside a Buy button does their own thresholding and the abstain band stops working.';

-- ===========================================================================
-- The confirmed/unsure counters on story. Maintained by trigger so the primary
-- button is one row read, and so RLS and story_cta_v can use it cheaply.
-- ===========================================================================
CREATE OR REPLACE FUNCTION insidor.recount_story_coins() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_story uuid;
BEGIN
  v_story := COALESCE(NEW.story_id, OLD.story_id);
  UPDATE public.story s SET
    -- Identity only. Safety is NOT a term here: "confirmed" answers "is this
    -- the right coin", not "is this safe to buy", and the count must be
    -- market-data independent or a four-minute-old mint with a null mcap
    -- flips back to Create and drives a duplicate launch.
    confirmed_coin_count = (
      SELECT count(*) FROM public.coin_match m
       WHERE m.story_id = v_story AND m.retracted_at IS NULL
         AND m.verdict = 'confirmed' AND m.mint_time IS NOT NULL AND m.ticker IS NOT NULL
    ),
    unsure_coin_count = (
      SELECT count(*) FROM public.coin_match m
       WHERE m.story_id = v_story AND m.retracted_at IS NULL AND m.verdict = 'unsure'
    )
  WHERE s.id = v_story;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS coin_match_recount ON public.coin_match;
CREATE TRIGGER coin_match_recount
  AFTER INSERT OR UPDATE OR DELETE ON public.coin_match
  FOR EACH ROW EXECUTE FUNCTION insidor.recount_story_coins();

-- ===========================================================================
-- match_label — the gold set and the growing eval set. Every CONFIRMED and
-- every UNSURE is logged with its vector; that is the eval set growing itself.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.match_label (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id        uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  mint            text NOT NULL REFERENCES public.coin(mint) ON DELETE CASCADE,
  label           boolean,                 -- NULL until a human labels it
  labeller        text,
  stratum         text NOT NULL,           -- easy_positive|transformed_image|ticker_drift|...
  features        jsonb NOT NULL,
  predicted       match_verdict NOT NULL,
  predicted_score real NOT NULL,
  matcher_version text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  labelled_at     timestamptz
);
SELECT insidor.add_constraint('public.match_label', 'match_label_pair_version_key',
  'UNIQUE (story_id, mint, matcher_version)');
SELECT insidor.add_constraint('public.match_label', 'match_label_labelled',
  $$CHECK ((label IS NULL) = (labelled_at IS NULL))$$);
CREATE INDEX IF NOT EXISTS match_label_stratum_idx ON public.match_label (stratum, label);

SELECT insidor.migration_end('0004', 'matching', '@@CHECKSUM_0004@@');
COMMIT;
