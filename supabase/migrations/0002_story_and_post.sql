-- 0002_story_and_post.sql
-- The spine: story (was `narratives`), post (was `narrative_posts`), the
-- snapshot grid, the meme score, the text embedding, the 5-minute momentum
-- rollup, and post_heat — which had no home at all in the old build.
BEGIN;
SELECT insidor.migration_begin('0002', 'story_and_post', '@@CHECKSUM_0002@@');

-- ===========================================================================
-- story
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.story (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status                   story_status NOT NULL DEFAULT 'provisional',

  -- Naming (§3.5 regeneration policy). title_version increments on retitle.
  title                    text,
  title_version            integer NOT NULL DEFAULT 0,
  titled_at                timestamptz,
  title_centroid           halfvec(768),
  blurb                    text,
  subject                  text,
  subject_type             text,
  entity_keys              text[] NOT NULL DEFAULT '{}',
  cashtags                 text[] NOT NULL DEFAULT '{}',
  platforms                platform[] NOT NULL DEFAULT '{}',

  -- Clocks. first_post_at is the author's clock; first_seen_at is ours.
  first_post_at            timestamptz,
  first_seen_at            timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),

  -- THE lead-time clock. Set once at PROMOTE, frozen by trigger below.
  promoted_at              timestamptz,
  -- NULL for every pre-migration row; a true value suppresses every earliness
  -- claim on every surface. There is no backfill from created_at, ever.
  promoted_at_backfilled   boolean NOT NULL DEFAULT false,
  -- First seen already large, or >20 min after posting. Excluded from the
  -- earliness denominator permanently (§2.6).
  censored_entry           boolean NOT NULL DEFAULT false,

  -- D3. Default is the LEAST permissive tier: an unclassified story is
  -- invisible until the classifier explicitly relaxes it. Fail closed.
  coinability_tier         coinability_tier NOT NULL DEFAULT 'never',
  coinability_reason       text,
  coinability_model        text,
  coinability_confidence   real,

  -- Clustering quality. needs_review suppresses the coin CTA (§3.4, no SPLIT).
  needs_review             boolean NOT NULL DEFAULT false,
  coherence                real,
  centroid                 halfvec(768),
  centroid_n               real NOT NULL DEFAULT 0,
  exemplar_post_ids        uuid[] NOT NULL DEFAULT '{}',

  -- Aggregates, all maintained by the pipeline.
  n_posts                  integer NOT NULL DEFAULT 0,
  distinct_authors         integer NOT NULL DEFAULT 0,
  combined_views           bigint  NOT NULL DEFAULT 0,
  lifecycle                lifecycle,
  lifecycle_reason         text,
  heat                     double precision,
  presented_heat           smallint,
  heat_rank                integer,
  top_post_id              uuid,

  -- Merge. Absorbed stories 301 to the survivor; they are never 404.
  merged_into_id           uuid REFERENCES public.story(id) ON DELETE SET NULL,
  merged_at                timestamptz,
  merge_count_hour         smallint NOT NULL DEFAULT 0,

  -- Counters maintained by trigger from coin_match (0004). The primary button
  -- is a pure function of confirmed_coin_count and nothing else.
  confirmed_coin_count     smallint NOT NULL DEFAULT 0,
  unsure_coin_count        smallint NOT NULL DEFAULT 0,

  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- ---- generated: the product rules, as columns -------------------------
  earliness_eligible boolean GENERATED ALWAYS AS (
    promoted_at IS NOT NULL AND NOT promoted_at_backfilled AND NOT censored_entry
  ) STORED,

  -- A tier-`never` story is not "hidden by a filter". It is unreadable.
  -- RLS reads this column; see 0011.
  display_eligible boolean GENERATED ALWAYS AS (
    promoted_at IS NOT NULL
    AND coinability_tier <> 'never'
    AND status IN ('open','dormant','closed')
  ) STORED,

  can_create boolean GENERATED ALWAYS AS (
    coinability_tier = 'normal'
    AND status IN ('open','dormant','closed')
    AND needs_review = false
    AND promoted_at IS NOT NULL
  ) STORED
);

-- The composite key that lets child tables carry the tier and be constrained
-- on it. This is how "a story surfacing when its coinability forbids it"
-- becomes a foreign-key violation instead of a code review comment.
SELECT insidor.add_constraint('public.story', 'story_id_tier_key',
  'UNIQUE (id, coinability_tier)');

SELECT insidor.add_constraint('public.story', 'story_merged_needs_target',
  $$CHECK (status <> 'merged' OR (merged_into_id IS NOT NULL AND merged_at IS NOT NULL))$$);
SELECT insidor.add_constraint('public.story', 'story_no_self_merge',
  $$CHECK (merged_into_id IS DISTINCT FROM id)$$);
SELECT insidor.add_constraint('public.story', 'story_promote_after_first_post',
  $$CHECK (promoted_at IS NULL OR first_post_at IS NULL OR promoted_at >= first_post_at - interval '2 minutes')$$);
SELECT insidor.add_constraint('public.story', 'story_promoted_not_provisional',
  $$CHECK (promoted_at IS NULL OR status <> 'provisional')$$);
SELECT insidor.add_constraint('public.story', 'story_tier_needs_reason',
  $$CHECK (coinability_tier = 'never' OR coinability_reason IS NOT NULL)$$);
SELECT insidor.add_constraint('public.story', 'story_counts_nonneg',
  $$CHECK (confirmed_coin_count >= 0 AND unsure_coin_count >= 0)$$);
SELECT insidor.add_constraint('public.story', 'story_confidence_range',
  $$CHECK (coinability_confidence IS NULL OR coinability_confidence BETWEEN 0 AND 1)$$);

-- promoted_at is write-once. This is the single most load-bearing trigger in
-- the schema: every lead-time number in the product is measured from it.
DROP TRIGGER IF EXISTS story_freeze_promoted_at ON public.story;
CREATE TRIGGER story_freeze_promoted_at
  BEFORE UPDATE ON public.story
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('promoted_at');

DROP TRIGGER IF EXISTS story_touch ON public.story;
CREATE TRIGGER story_touch BEFORE UPDATE ON public.story
  FOR EACH ROW EXECUTE FUNCTION insidor.touch_updated_at();

-- Boards: 40 rows by presented heat within the display-eligible set.
CREATE INDEX IF NOT EXISTS story_board_idx
  ON public.story (heat DESC NULLS LAST)
  WHERE display_eligible;
-- "No coin yet" chip and the create funnel (Q: search default view).
CREATE INDEX IF NOT EXISTS story_no_coin_idx
  ON public.story (heat DESC NULLS LAST)
  WHERE display_eligible AND confirmed_coin_count = 0 AND can_create;
-- Nightly outcome classifier sweep: promoted more than 48h ago, unclassified.
CREATE INDEX IF NOT EXISTS story_promoted_at_idx
  ON public.story (promoted_at)
  WHERE promoted_at IS NOT NULL;
-- 301 redirect lookup for an absorbed id.
CREATE INDEX IF NOT EXISTS story_merged_into_idx
  ON public.story (merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS story_status_idx ON public.story (status);

COMMENT ON COLUMN public.story.promoted_at IS
  'Set once at PROMOTE. Write-once by trigger. NULL renders "not promoted" forever; it is never backfilled from created_at or first_seen_at, because those differ from promote by roughly the lead time the product is sold on.';
COMMENT ON COLUMN public.story.coinability_tier IS
  'D3. Defaults to the least permissive tier so an unclassified story cannot surface.';

-- Deliberately absent from this table, and why:
--   search_series      fabricated sine wave that drove search ordering
--   gain_24h           combined_views*0.14 invention
--   trend_term/peak/direction, img_seed, narr_idx, source, accel, age_min
--   lead_time_min      derived, and only from story_clock where both clocks exist
--   bought_reach       superseded by post_heat.organic_o

-- ===========================================================================
-- post
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.post (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id            uuid REFERENCES public.story(id) ON DELETE SET NULL,
  platform            platform NOT NULL,
  platform_post_id    text NOT NULL,

  author_handle       text NOT NULL,
  author_name         text,
  author_id           text,
  author_followers    integer,            -- current, display only
  followers_at_post   integer,            -- the plausibility denominator (§4.5 F4)

  posted_at           timestamptz NOT NULL,   -- timestamptz, not bigint ms
  first_seen_at       timestamptz NOT NULL DEFAULT now(),

  text                text NOT NULL DEFAULT '',
  lang                text,
  sample_replies      jsonb NOT NULL DEFAULT '[]'::jsonb,

  media_url           text,
  media_kind          media_kind,
  media_sha256        bytea,
  media_phash         bit(64),
  media_local_url     text,
  ocr_text            text,
  derived_subject     text,               -- rendered under a DERIVED label only

  entity_keys         text[] NOT NULL DEFAULT '{}',
  cashtags            text[] NOT NULL DEFAULT '{}',
  mints_in_text       text[] NOT NULL DEFAULT '{}',  -- S_mint_in_post, the strongest channel

  -- Latest observed counters. Every one is NULLABLE: absent is not zero.
  views               bigint,
  likes               integer,
  reposts             integer,
  replies             integer,
  quotes              integer,
  bookmarks           integer,

  unavailable         boolean NOT NULL DEFAULT false,  -- deleted upstream
  censored_entry      boolean NOT NULL DEFAULT false,
  second_wave         boolean NOT NULL DEFAULT false,
  tracking_tier       smallint NOT NULL DEFAULT 0,     -- 0 arrival 1 probation 2 candidate 3 tracked
  snapshot_count      smallint NOT NULL DEFAULT 0,
  last_snapshot_at    timestamptz,
  cluster_signal      text,                            -- cashtag|keyword|embedding|llm|none
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

SELECT insidor.add_constraint('public.post', 'post_platform_id_key',
  'UNIQUE (platform, platform_post_id)');
SELECT insidor.add_constraint('public.post', 'post_posted_at_sane',
  $$CHECK (posted_at > timestamptz '2020-01-01' AND posted_at < timestamptz '2035-01-01')$$);
SELECT insidor.add_constraint('public.post', 'post_counters_nonneg',
  $$CHECK (COALESCE(views,0) >= 0 AND COALESCE(likes,0) >= 0 AND COALESCE(reposts,0) >= 0
       AND COALESCE(replies,0) >= 0 AND COALESCE(quotes,0) >= 0)$$);
SELECT insidor.add_constraint('public.post', 'post_tier_range',
  $$CHECK (tracking_tier BETWEEN 0 AND 3)$$);
-- The permalink is the proof. If we have no platform_post_id we render no link
-- and say so; we never synthesise one, so the column is NOT NULL by design.
SELECT insidor.add_constraint('public.post', 'post_platform_post_id_nonempty',
  $$CHECK (length(platform_post_id) > 0)$$);

DROP TRIGGER IF EXISTS post_reject_future ON public.post;
CREATE TRIGGER post_reject_future
  BEFORE INSERT OR UPDATE ON public.post
  FOR EACH ROW EXECUTE FUNCTION insidor.reject_future_timestamp('posted_at');

DROP TRIGGER IF EXISTS post_touch ON public.post;
CREATE TRIGGER post_touch BEFORE UPDATE ON public.post
  FOR EACH ROW EXECUTE FUNCTION insidor.touch_updated_at();

-- Story page: posts table, ordered by views desc.
CREATE INDEX IF NOT EXISTS post_story_views_idx
  ON public.post (story_id, views DESC NULLS LAST) WHERE story_id IS NOT NULL;
-- Ingest freshness SLI-1 and the staleness band both read max(first_seen_at).
CREATE INDEX IF NOT EXISTS post_first_seen_idx ON public.post (first_seen_at DESC);
-- Snapshotter: which tracked posts are due.
CREATE INDEX IF NOT EXISTS post_due_idx
  ON public.post (last_snapshot_at NULLS FIRST) WHERE tracking_tier > 0 AND NOT unavailable;
-- "search a CA, the post appears" — the strongest matcher evidence channel.
CREATE INDEX IF NOT EXISTS post_mints_in_text_idx ON public.post USING gin (mints_in_text);
CREATE INDEX IF NOT EXISTS post_entity_keys_idx  ON public.post USING gin (entity_keys);
CREATE INDEX IF NOT EXISTS post_cashtags_idx     ON public.post USING gin (cashtags);
-- @handle search mode.
CREATE INDEX IF NOT EXISTS post_handle_idx ON public.post (lower(author_handle), posted_at DESC);
-- D-IMAGE / dedupe.
CREATE INDEX IF NOT EXISTS post_media_sha_idx ON public.post (media_sha256) WHERE media_sha256 IS NOT NULL;

-- ===========================================================================
-- post_snapshot — the geometric grid
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.post_snapshot (
  post_id       uuid NOT NULL REFERENCES public.post(id) ON DELETE CASCADE,
  captured_at   timestamptz NOT NULL,
  views         bigint,
  likes         integer,
  reposts       integer,
  replies       integer,
  quotes        integer,
  bookmarks     integer,
  -- views frozen while likes moved: emit no view-rate point, carry V forward.
  view_censored boolean NOT NULL DEFAULT false,
  unavailable   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (post_id, captured_at)
);

-- The index the old build never had. Serves: velocity/EWMA replay, the 20M
-- sparkline (last 8 deltas), and the momentum rollup writer.
CREATE INDEX IF NOT EXISTS post_snapshot_post_time_idx
  ON public.post_snapshot (post_id, captured_at DESC);

-- ===========================================================================
-- post_heat — every term in the PostHeat formula, with a home
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.post_heat (
  post_id            uuid PRIMARY KEY REFERENCES public.post(id) ON DELETE CASCADE,
  heat               double precision,
  base               double precision,
  presented_heat     smallint,
  rate_lcb_views     double precision,
  rate_lcb_reshares  double precision,
  rate_lcb_norm      double precision,
  s_fast             double precision,
  s_slow             double precision,
  ewma_updated_at    timestamptz,
  burst              double precision,
  organic_o          real,
  organic_features   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- f1..f5, logged when O<0.5
  ct_pickup_count    smallint NOT NULL DEFAULT 0,
  ct_first_seen_at   timestamptz,
  lifecycle          lifecycle,
  v_peak             double precision,
  censored_entry     boolean NOT NULL DEFAULT false,
  second_wave        boolean NOT NULL DEFAULT false,
  frozen             boolean NOT NULL DEFAULT false,      -- ingest gap: freeze, do not decay
  ticks_qualified    smallint NOT NULL DEFAULT 0,
  computed_at        timestamptz NOT NULL DEFAULT now()
);

SELECT insidor.add_constraint('public.post_heat', 'post_heat_o_range',
  $$CHECK (organic_o IS NULL OR organic_o BETWEEN 0.15 AND 1.0)$$);
SELECT insidor.add_constraint('public.post_heat', 'post_heat_presented_range',
  $$CHECK (presented_heat IS NULL OR presented_heat BETWEEN 0 AND 100)$$);
-- ACCEL renders "—" on a single snapshot, never a fabricated 1.0x.
SELECT insidor.add_constraint('public.post_heat', 'post_heat_burst_needs_two_ticks',
  $$CHECK (burst IS NULL OR ticks_qualified >= 2)$$);

CREATE INDEX IF NOT EXISTS post_heat_rank_idx ON public.post_heat (heat DESC NULLS LAST);

-- ===========================================================================
-- post_meme_score
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.post_meme_score (
  post_id          uuid PRIMARY KEY REFERENCES public.post(id) ON DELETE CASCADE,
  meme_score       real NOT NULL,
  reason           text,
  suggested_ticker text,   -- create-path prefill ONLY. See story_ticker.source.
  suggested_name   text,
  model            text NOT NULL,
  raw              jsonb,
  scored_at        timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.post_meme_score', 'meme_score_range',
  $$CHECK (meme_score BETWEEN 0 AND 1)$$);
CREATE INDEX IF NOT EXISTS post_meme_score_gate_idx
  ON public.post_meme_score (post_id) WHERE meme_score >= 0.35;

-- ===========================================================================
-- post_embedding — model is load-bearing; a model change is a full re-embed
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.post_embedding (
  post_id    uuid PRIMARY KEY REFERENCES public.post(id) ON DELETE CASCADE,
  model      text NOT NULL,           -- e.g. gemini-embedding-2
  dims       smallint NOT NULL,
  embedding  halfvec(768) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.post_embedding', 'post_embedding_dims',
  $$CHECK (dims = 768)$$);
-- Candidate generation: ANN over post vectors vs story centroids.
CREATE INDEX IF NOT EXISTS post_embedding_hnsw
  ON public.post_embedding USING hnsw (embedding halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ===========================================================================
-- story_momentum — the 5-minute rollup the story page chart reads
--
-- A table, not a matview over raw snapshots: posts are sampled on a per-post
-- geometric grid, so summing by minute makes a story's total DROP whenever
-- fewer posts happened to snapshot, and COOLING fires on a sampling artefact.
-- Written incrementally with last-observation-carried-forward per post.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.story_momentum (
  story_id       uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  bucket_at      timestamptz NOT NULL,          -- floor to 5 minutes, UTC
  views          bigint  NOT NULL,              -- LOCF sum across members
  reposts        integer,
  likes          integer,
  replies        integer,
  posts_in_5min  smallint NOT NULL DEFAULT 0,
  distinct_authors smallint NOT NULL DEFAULT 0,
  v              double precision,              -- reshares/min
  g              double precision,              -- growth
  r_hat          double precision,              -- branching factor
  member_count   smallint NOT NULL DEFAULT 0,   -- posts contributing (LOCF denominator)
  PRIMARY KEY (story_id, bucket_at)
);
-- extract(epoch FROM interval) is IMMUTABLE; date_part(text, timestamptz) is
-- only STABLE and Postgres rejects it in a CHECK. Hence the subtraction.
SELECT insidor.add_constraint('public.story_momentum', 'story_momentum_bucket_aligned',
  $$CHECK ((extract(epoch FROM (bucket_at - timestamptz 'epoch'))::bigint % 300) = 0)$$);
CREATE INDEX IF NOT EXISTS story_momentum_recent_idx
  ON public.story_momentum (story_id, bucket_at DESC);

-- ===========================================================================
-- platform_norm / author_roster — the self-calibrating denominators
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.platform_norm (
  platform             platform PRIMARY KEY,
  median_view_rate_24h double precision,
  median_views_at_age  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {age_bucket: median}
  p95_heat_1h          double precision,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.platform_norm.p95_heat_1h IS
  'Rebases hourly. The HEAT popover must render this value AND updated_at, because a row can jump 61 -> 88 with nothing changing underneath.';

CREATE TABLE IF NOT EXISTS public.author_roster (
  platform        platform NOT NULL,
  author_handle   text NOT NULL,
  author_id       text,
  follower_decile smallint NOT NULL,
  a0              double precision NOT NULL,   -- Gamma-Poisson prior shape
  b0              double precision NOT NULL,   -- Gamma-Poisson prior rate
  beta_hat        double precision,            -- NB-GLM per-author intercept
  n_posts_fitted  integer NOT NULL DEFAULT 0,
  tier            smallint NOT NULL DEFAULT 0, -- 0 none, 1 filter-rule, 2 stream
  eas             double precision,            -- Early Amplifier Score
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, author_handle)
);
SELECT insidor.add_constraint('public.author_roster', 'author_roster_decile',
  $$CHECK (follower_decile BETWEEN 0 AND 9)$$);

-- ===========================================================================
-- ingest_gap is a sensor_gap; see 0005. Here only the per-post trace.
-- ===========================================================================

SELECT insidor.migration_end('0002', 'story_and_post', '@@CHECKSUM_0002@@');
COMMIT;
