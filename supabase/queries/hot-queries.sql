-- supabase/queries/hot-queries.sql
-- The four queries that decide whether the product feels fast. Each one names
-- the index it must use; the CI job in .github/workflows/db.yml runs EXPLAIN
-- against a seeded database and fails if any of them falls back to a Seq Scan
-- or a Sort.
--
-- The shape shared by Q1 and Q2 is the important one: RANKING IS NOT A QUERY.
-- commit_board() writes board_state every 20 seconds; the read path is a
-- 40-row ordered index scan plus primary-key joins. A board that ranks in the
-- request is a board that gets slower exactly when it gets popular.


-- ===========================================================================
-- Q1. THE POSTS BOARD  --  /feed?lane=posts
-- Target: < 8 ms. 40 rows.
-- Drives: board_state_rank_key (lane, band, rank)  [ordered scan, no sort]
--         post_pkey, post_heat_pkey               [40 index lookups]
--         story_pkey, story_clock_pkey            [40 index lookups]
-- ===========================================================================
SELECT
  bs.rank,
  bs.prev_rank,
  bs.entered_at,
  bs.escape_hatch,

  p.id                AS post_id,
  p.platform,
  p.author_handle,
  p.author_name,
  p.author_followers,
  p.posted_at,
  p.text,
  p.media_url,
  p.media_kind,
  p.derived_subject,
  p.unavailable,
  p.second_wave,
  p.censored_entry,

  h.presented_heat,
  h.rate_lcb_views,
  h.rate_lcb_reshares,
  h.burst,                       -- NULL renders as an em dash, never "1.0x"
  h.organic_o,
  h.lifecycle,
  h.frozen,
  h.ct_pickup_count,
  p.views,                       -- REACH: an eligibility gate, rendered grey

  s.id                AS story_id,
  s.title,
  s.coinability_tier,
  s.can_create,
  s.confirmed_coin_count,        -- the ONLY input to the primary button
  s.unsure_coin_count,
  s.n_posts,

  sc.lead_time_min,              -- GENERATED; NULL means not measurable, ever
  sc.unmeasurable,
  sc.t_crypto,
  s.earliness_eligible
FROM public.board_state bs
JOIN public.post       p  ON p.id  = bs.post_id
JOIN public.post_heat  h  ON h.post_id = p.id
JOIN public.story      s  ON s.id  = p.story_id
LEFT JOIN public.story_clock sc ON sc.story_id = s.id
WHERE bs.lane = 'posts'
ORDER BY bs.rank
LIMIT 40;

-- The gate breakdown rendered underneath, one row:
SELECT eligible, shown, by_reason
  FROM public.board_gate_count
 WHERE lane = 'posts'
 ORDER BY committed_at DESC
 LIMIT 1;                        -- board_gate_count_recent_idx


-- ===========================================================================
-- Q2. THE COINS BOARD  --  /feed?lane=coins&band=fresh
-- Target: < 15 ms. 40 rows, two laterals each hitting a covering index.
-- Drives: board_state_rank_key                 (lane, band, rank)
--         coin_pkey
--         coin_snapshot_latest_idx             (mint, captured_at DESC) LIMIT 1
--         coin_match_mint_idx                  (mint, verdict, score DESC) LIMIT 1
--         coin_safety_pkey
--
-- Two laterals rather than one join: a coin with no trades yet must still
-- appear (pre-rank zone, every numeric "..") and a coin with no story is
-- 85-95% of this band. An inner join to either would delete the modal row.
-- ===========================================================================
SELECT
  bs.rank, bs.prev_rank, bs.escape_hatch,

  c.mint, c.symbol, c.name, c.logo_url, c.decimals, c.socials,
  c.minted_at,                   -- NULL renders "-", never "brand new"
  c.curve_pct, c.migrated, c.band, c.launchpad, c.is_insidor_launch,

  snap.captured_at   AS price_at,
  snap.price_usd, snap.mcap_usd, snap.liquidity_usd,
  snap.buy_vol_5m, snap.sell_vol_5m, snap.buy_vol_24h, snap.sell_vol_24h,
  snap.buys_5m, snap.sells_5m, snap.traders_5m, snap.net_buyers_5m,
  snap.price_change_5m, snap.price_change_1h, snap.price_change_24h,
  snap.holder_count, snap.holder_count_truncated, snap.top10_pct,

  sf.mint_authority, sf.freeze_authority, sf.sell_route,
  sf.signals_checked, sf.signals_total, sf.intrinsic_gate_pass, sf.checked_at,

  m.story_id, m.verdict, m.relation, m.ticker AS match_ticker,
  m.delta_min, m.evidence_public,          -- score is not granted to anon
  st.title AS story_title,
  st.confirmed_coin_count AS story_confirmed_count,
  sc.lead_time_min, sc.unmeasurable, sc.t_crypto,

  public.coin_tradeable(
    c.band, sf.intrinsic_gate_pass, snap.liquidity_usd, snap.top10_pct,
    snap.buys_5m, snap.sells_5m, snap.captured_at, c.minted_at
  ) AS tradeable
FROM public.board_state bs
JOIN public.coin c ON c.mint = bs.mint
LEFT JOIN public.coin_safety sf ON sf.mint = c.mint
LEFT JOIN LATERAL (
  SELECT s2.* FROM public.coin_snapshot s2
   WHERE s2.mint = c.mint
   ORDER BY s2.captured_at DESC
   LIMIT 1
) snap ON true
LEFT JOIN LATERAL (
  -- One match per mint: confirmed before unsure, then score. The MULTI state
  -- ("1 of 3 coins") reads story.confirmed_coin_count, not a second query.
  SELECT m2.* FROM public.coin_match m2
   WHERE m2.mint = c.mint AND m2.retracted_at IS NULL
   ORDER BY (m2.verdict = 'confirmed') DESC, m2.score DESC
   LIMIT 1
) m ON true
LEFT JOIN public.story       st ON st.id = m.story_id
LEFT JOIN public.story_clock sc ON sc.story_id = m.story_id
WHERE bs.lane = 'coins'
  AND bs.band = 'fresh'
  -- The Fresh 6h ceiling. It is a filter, not part of the generated band,
  -- because it depends on now() and a generated column cannot.
  AND (c.minted_at IS NULL OR c.minted_at > now() - interval '6 hours')
ORDER BY bs.rank
LIMIT 40;

-- The hidden-by-gate count, always stated beside the band count:
SELECT count(*) AS hidden_by_gate
  FROM public.board_state bs
  JOIN public.coin c ON c.mint = bs.mint
  LEFT JOIN public.coin_safety sf ON sf.mint = c.mint
  LEFT JOIN LATERAL (
    SELECT s2.liquidity_usd, s2.top10_pct, s2.buys_5m, s2.sells_5m, s2.captured_at
      FROM public.coin_snapshot s2 WHERE s2.mint = c.mint
     ORDER BY s2.captured_at DESC LIMIT 1
  ) snap ON true
 WHERE bs.lane = 'coins' AND bs.band = 'fresh'
   AND NOT public.coin_tradeable(c.band, sf.intrinsic_gate_pass, snap.liquidity_usd,
                                 snap.top10_pct, snap.buys_5m, snap.sells_5m,
                                 snap.captured_at, c.minted_at);


-- ===========================================================================
-- Q3. THE STORY PAGE  --  /story/[id]
-- Target: < 25 ms, ONE round trip. Discussion is deliberately a second query
-- on its own Suspense boundary so a slow comment scan never blocks evidence.
-- Drives: story_pkey, story_clock_pkey, story_outcome_pkey,
--         coin_match_story_idx      (story_id, verdict, score DESC)
--         post_story_views_idx      (story_id, views DESC)
--         story_momentum_recent_idx (story_id, bucket_at DESC)
-- ===========================================================================
WITH s AS (
  SELECT * FROM public.story WHERE id = $1
)
SELECT
  s.id, s.title, s.blurb, s.subject, s.status, s.merged_into_id,
  s.promoted_at, s.promoted_at_backfilled, s.earliness_eligible,
  s.coinability_tier, s.can_create, s.needs_review,
  s.lifecycle, s.lifecycle_reason, s.combined_views, s.distinct_authors,
  s.n_posts, s.platforms, s.confirmed_coin_count, s.unsure_coin_count,

  to_jsonb(sc.*) - 'promoted_at'                       AS clock,
  to_jsonb(so.*)                                       AS outcome,

  -- Matches, confirmed first then earliest mint. Default sort is mint_time
  -- ASC ("the first one made from this story"); sorting by market cap
  -- systematically demotes the freshly minted derived coin, which is the coin
  -- the pipeline exists to find.
  (SELECT jsonb_agg(x ORDER BY x.verdict_rank, x.mint_time NULLS LAST)
     FROM (
       SELECT (m.verdict = 'confirmed')::int * -1 AS verdict_rank,
              m.mint, m.verdict, m.relation, m.ticker, m.name,
              m.mint_time, m.delta_min, m.evidence_public,
              c.logo_url, c.decimals,
              snap.mcap_usd, snap.liquidity_usd, snap.price_usd, snap.captured_at
         FROM public.coin_match m
         JOIN public.coin c ON c.mint = m.mint
         LEFT JOIN LATERAL (
           SELECT s2.mcap_usd, s2.liquidity_usd, s2.price_usd, s2.captured_at
             FROM public.coin_snapshot s2 WHERE s2.mint = m.mint
            ORDER BY s2.captured_at DESC LIMIT 1
         ) snap ON true
        WHERE m.story_id = s.id AND m.retracted_at IS NULL
     ) x)                                              AS matches,

  -- The posts table, and the source post is posts[0].
  (SELECT jsonb_agg(y ORDER BY y.views DESC NULLS LAST)
     FROM (
       SELECT p.id, p.platform, p.platform_post_id, p.author_handle, p.author_name,
              p.author_followers, p.posted_at, p.text, p.media_url, p.media_kind,
              p.views, p.reposts, p.likes, p.replies, p.unavailable
         FROM public.post p WHERE p.story_id = s.id
        LIMIT 50
     ) y)                                              AS posts,

  -- Momentum: the 5-minute rollup, never a matview over raw snapshots.
  (SELECT jsonb_agg(to_jsonb(mm.*) ORDER BY mm.bucket_at)
     FROM public.story_momentum mm
    WHERE mm.story_id = s.id AND mm.bucket_at > now() - interval '24 hours') AS momentum,

  -- Create-path prefill. NEVER reads source = 'llm' unless the caller is the
  -- create sheet; the column-level filter is here so no other consumer can.
  (SELECT jsonb_agg(jsonb_build_object('ticker', t.ticker, 'source', t.source,
                                       'span', t.source_span))
     FROM public.story_ticker t WHERE t.story_id = s.id)  AS ticker_candidates,

  -- Staleness, per worker, with a work-done check. `max(ran_at)` reads `live`
  -- during the exact outage that has actually happened.
  (SELECT jsonb_object_agg(e.stage, jsonb_build_object(
            'last_output_at', r.last_output_at,
            'zero_streak',    COALESCE(r.zero_streak, 999)))
     FROM public.ops_stage_expected e
     LEFT JOIN LATERAL (
       SELECT max(sr.finished_at) FILTER (WHERE sr.rows_out > 0) AS last_output_at,
              count(*) FILTER (WHERE sr.rows_out = 0)            AS zero_streak
         FROM public.ops_stage_run sr
        WHERE sr.stage = e.stage AND sr.started_at > now() - interval '2 hours'
     ) r ON true
    WHERE e.enabled)                                    AS pipeline_health
FROM s
LEFT JOIN public.story_clock   sc ON sc.story_id = s.id
LEFT JOIN public.story_outcome so ON so.story_id = s.id;

-- Discussion, second round trip, own boundary. "Earliest" means written when
-- the story was smallest, not oldest by clock.
SELECT id, author_wallet, body, created_at,
       snap_views, snap_coin_count, snap_age_min, snap_early,
       snap_position_state, snap_position_lamports, snap_position_mint,
       snap_position_decimals
  FROM public.comment
 WHERE story_id = $1 AND status = 'visible'
 ORDER BY snap_views ASC, created_at ASC
 LIMIT 50;                        -- comment_story_earliest_idx, no sort


-- ===========================================================================
-- Q4. THE RECORD  --  /search?chip=finished  and  /ops/earliness
-- Target: < 30 ms. Default filter is All, asserted in CI as a route constant.
-- Drives: story_outcome_recent_idx (classified_at DESC)
--         story_pkey, story_clock_pkey
--         record_summary_mv (the denominators, one row)
-- ===========================================================================
SELECT
  o.outcome,
  o.lead_time_min,                -- signed. -7 renders "-7m late" in red, at
                                  -- identical geometry and size to "+31m".
  o.peak_mcap,
  o.peak_mcap_samples,
  o.classified_at,

  s.id AS story_id,
  s.title,
  s.promoted_at,                  -- "we saw it", absolute clock time
  sc.t_crypto,                    -- "crypto saw it", absolute clock time
  sc.t_ct_url,                    -- proof: a permalink belonging to someone else
  sc.unmeasurable,
  sc.unmeasurable_sensor,

  c.mint, c.symbol,
  p.platform, p.platform_post_id  -- proof: the original post
FROM public.story_outcome o
JOIN public.story       s  ON s.id = o.story_id
JOIN public.story_clock sc ON sc.story_id = o.story_id
LEFT JOIN public.coin   c  ON c.mint = o.first_coin_mint
LEFT JOIN public.post   p  ON p.id  = s.top_post_id
WHERE s.earliness_eligible
  AND s.coinability_tier <> 'never'
  AND ($1::story_outcome_kind IS NULL OR o.outcome = $1)   -- NULL = All, the default
ORDER BY o.classified_at DESC
LIMIT 50 OFFSET $2;

-- The denominators, printed above the table. Never a rate without one.
SELECT stories_total, got_a_coin, never_did,
       early_n, late_n, same_minute_n, unmeasurable_n,
       median_lead_early, median_lead_late, abstain_rate, computed_at
  FROM public.record_summary_mv;
