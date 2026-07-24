# Insidor Layer 3 — database schema

> Generated 2026-07-23T20:55:24.849Z from **Supabase service probe (SELECT * LIMIT 1) + schema SQL fallback**.
> **Age logic:** use `narrative_posts.posted_at` (bigint, unix epoch **milliseconds**).

## `ingest_near_miss`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `first_seen_at` | (live) | YES |  |
| `last_checked_at` | (live) | YES |  |
| `likes` | (live) | YES |  |
| `platform` | (live) | YES |  |
| `platform_post_id` | (live) | YES |  |
| `raw` | (live) | YES |  |
| `views` | (live) | YES |  |

## `narrative_posts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `cluster_match` | (live) | YES |  |
| `filter_label` | (live) | YES |  |
| `first_seen_at` | (live) | YES |  |
| `followers` | (live) | YES |  |
| `handle` | (live) | YES |  |
| `id` | (live) | YES |  |
| `image` | (live) | YES |  |
| `last_snapshot_at` | (live) | YES |  |
| `likes` | (live) | YES |  |
| `media_type` | (live) | YES |  |
| `media_url` | (live) | YES |  |
| `narrative_id` | (live) | YES |  |
| `notable` | (live) | YES |  |
| `platform` | (live) | YES |  |
| `platform_post_id` | (live) | YES |  |
| `posted_at` | (live) | YES |  |
| `posted_at_ts` | (live) | YES |  |
| `pruned_at` | (live) | YES |  |
| `quotes` | (live) | YES |  |
| `raw` | (live) | YES |  |
| `replies` | (live) | YES |  |
| `retweets` | (live) | YES |  |
| `sample_replies` | (live) | YES |  |
| `snapshot_tier` | (live) | YES |  |
| `sort_order` | (live) | YES |  |
| `text` | (live) | YES |  |
| `tracking_status` | (live) | YES |  |
| `views` | (live) | YES |  |

## `narrative_tickers`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `age_min` | (live) | YES |  |
| `canonical` | (live) | YES |  |
| `endorsed_by` | (live) | YES |  |
| `first_deployed` | (live) | YES |  |
| `holders` | (live) | YES |  |
| `id` | (live) | YES |  |
| `liquidity` | (live) | YES |  |
| `mcap` | (live) | YES |  |
| `mint_ca` | (live) | YES |  |
| `name` | (live) | YES |  |
| `narrative_id` | (live) | YES |  |
| `safety` | (live) | YES |  |
| `smart_money` | (live) | YES |  |
| `ticker` | (live) | YES |  |
| `vol24h` | (live) | YES |  |

## `narratives`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `accel` | (live) | YES |  |
| `age_min` | (live) | YES |  |
| `blurb` | (live) | YES |  |
| `bought_reach` | (live) | YES |  |
| `combined_views` | (live) | YES |  |
| `created_at` | (live) | YES |  |
| `cross_platform` | (live) | YES |  |
| `display_eligible` | (live) | YES |  |
| `engagement_velocity` | (live) | YES |  |
| `first_seen_at` | (live) | YES |  |
| `gain_24h` | (live) | YES |  |
| `gate_reason` | (live) | YES |  |
| `id` | (live) | YES |  |
| `img_seed` | (live) | YES |  |
| `lead_time_min` | (live) | YES |  |
| `lifecycle` | (live) | YES |  |
| `max_meme_score` | (live) | YES |  |
| `meme_score` | (live) | YES |  |
| `narr_idx` | (live) | YES |  |
| `organic_score` | (live) | YES |  |
| `platforms` | (live) | YES |  |
| `search_series` | (live) | YES |  |
| `source` | (live) | YES |  |
| `status` | (live) | YES |  |
| `title` | (live) | YES |  |
| `top_post_id` | (live) | YES |  |
| `trend_direction` | (live) | YES |  |
| `trend_peak` | (live) | YES |  |
| `trend_term` | (live) | YES |  |
| `updated_at` | (live) | YES |  |
| `views_velocity` | (live) | YES |  |

## `post_embeddings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `embedding` | (live) | YES |  |
| `post_id` | (live) | YES |  |
| `updated_at` | (live) | YES |  |

## `post_meme_scores`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `engagement_velocity` | (live) | YES |  |
| `meme_score` | (live) | YES |  |
| `model` | (live) | YES |  |
| `post_id` | (live) | YES |  |
| `raw` | (live) | YES |  |
| `reason` | (live) | YES |  |
| `scored_at` | (live) | YES |  |
| `suggested_name` | (live) | YES |  |
| `suggested_ticker` | (live) | YES |  |
| `velocity` | (live) | YES |  |
| `views_velocity` | (live) | YES |  |

## `post_snapshots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `bookmarks` | (live) | YES |  |
| `captured_at` | (live) | YES |  |
| `id` | (live) | YES |  |
| `likes` | (live) | YES |  |
| `post_id` | (live) | YES |  |
| `quotes` | (live) | YES |  |
| `raw` | (live) | YES |  |
| `replies` | (live) | YES |  |
| `retweets` | (live) | YES |  |
| `unavailable` | (live) | YES |  |
| `views` | (live) | YES |  |

## `worker_budget_state`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `adaptive_floor` | (live) | YES |  |
| `floor_min` | (live) | YES |  |
| `id` | (live) | YES |  |
| `media_lane_pct` | (live) | YES |  |
| `reads_today` | (live) | YES |  |
| `updated_at` | (live) | YES |  |
| `utc_date` | (live) | YES |  |

## `worker_cycle_log`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `adaptive_floor` | (live) | YES |  |
| `budget_note` | (live) | YES |  |
| `id` | (live) | YES |  |
| `ingested` | (live) | YES |  |
| `pruned` | (live) | YES |  |
| `ran_at` | (live) | YES |  |
| `reads_consumed` | (live) | YES |  |
| `skipped_floor` | (live) | YES |  |
| `snapshots_written` | (live) | YES |  |
| `worker` | (live) | YES |  |

## `worker_usage`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| `cost_usd` | (live) | YES |  |
| `reads_today` | (live) | YES |  |
| `source` | (live) | YES |  |
| `updated_at` | (live) | YES |  |
| `utc_date` | (live) | YES |  |

## Worker query audit

All checked `.select()` lists match the schema.

