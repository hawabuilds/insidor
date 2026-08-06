-- Backtest experiment tables (offline worker/backtest/* stages).

CREATE TABLE IF NOT EXISTS backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  config jsonb,
  stats jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS backtest_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  mint text NOT NULL,
  ticker text,
  name text,
  launch_at timestamptz NOT NULL,
  peak_mcap numeric,
  peak_multiple numeric,
  current_mcap numeric,
  peak_liquidity numeric,
  holders int,
  liquidity_exists boolean,
  liquidity_dead_within_24h boolean DEFAULT false,
  outcome text NOT NULL CHECK (outcome IN ('winner', 'loser', 'ignored')),
  narrative_cohort text NOT NULL DEFAULT 'unknown'
    CHECK (narrative_cohort IN ('narrative', 'non_narrative', 'unknown')),
  source text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, mint)
);

CREATE INDEX IF NOT EXISTS backtest_tokens_run_outcome_idx ON backtest_tokens (run_id, outcome);

CREATE TABLE IF NOT EXISTS backtest_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  token_id uuid NOT NULL REFERENCES backtest_tokens(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('winner', 'loser')),
  status text NOT NULL CHECK (status IN ('retained', 'rejected_name', 'rejected_no_post', 'skipped_non_narrative')),
  narrative_cohort text CHECK (narrative_cohort IN ('narrative', 'non_narrative', 'unknown')),
  name_pass boolean,
  name_reject_reason text,
  post_search_queries jsonb,
  match_confidence numeric,
  match_reason text,
  matched_platform_post_id text,
  matched_post_text text,
  matched_post_at timestamptz,
  matched_post_url text,
  matched_post_raw jsonb,
  x_queries_run int DEFAULT 0,
  x_tweets_read int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, token_id)
);

CREATE INDEX IF NOT EXISTS backtest_candidates_run_status_idx ON backtest_candidates (run_id, status, outcome);

CREATE TABLE IF NOT EXISTS backtest_post_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES backtest_candidates(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN ('winner', 'loser')),
  feature_window_min int NOT NULL DEFAULT 30,
  views_at_t numeric,
  view_velocity_t numeric,
  acceleration_t numeric,
  author_followers numeric,
  engagement_rate_t numeric,
  had_media boolean,
  distinct_authors_t int,
  age_min_when_seen numeric,
  ticker_proposed_in_replies boolean,
  meme_score numeric,
  in_narrative_posts boolean,
  narrative_post_id uuid,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS backtest_spend_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES backtest_runs(id) ON DELETE SET NULL,
  stage text NOT NULL,
  tweets_read int NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  note text,
  logged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backtest_spend_log_stage_idx ON backtest_spend_log (stage, logged_at DESC);

-- Idempotent migration for existing backtest installs
ALTER TABLE backtest_tokens
  ADD COLUMN IF NOT EXISTS narrative_cohort text NOT NULL DEFAULT 'unknown';
ALTER TABLE backtest_tokens DROP CONSTRAINT IF EXISTS backtest_tokens_narrative_cohort_check;
ALTER TABLE backtest_tokens ADD CONSTRAINT backtest_tokens_narrative_cohort_check
  CHECK (narrative_cohort IN ('narrative', 'non_narrative', 'unknown'));

ALTER TABLE backtest_candidates
  ADD COLUMN IF NOT EXISTS narrative_cohort text;
ALTER TABLE backtest_candidates DROP CONSTRAINT IF EXISTS backtest_candidates_narrative_cohort_check;
ALTER TABLE backtest_candidates ADD CONSTRAINT backtest_candidates_narrative_cohort_check
  CHECK (narrative_cohort IN ('narrative', 'non_narrative', 'unknown'));

ALTER TABLE backtest_candidates DROP CONSTRAINT IF EXISTS backtest_candidates_status_check;
ALTER TABLE backtest_candidates ADD CONSTRAINT backtest_candidates_status_check
  CHECK (status IN ('retained', 'rejected_name', 'rejected_no_post', 'skipped_non_narrative'));
