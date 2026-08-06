# Insidor Layer 3 — database schema

> **Source:** Live Supabase project `layazmzgbrusnspjhiep`, probed 2026-07-28 via service-role `SELECT * LIMIT 1` per table + SQL migration fallbacks where tables/columns have no sample rows yet.  
> **Regenerate probe section:** `npm run schema:doc` (requires `SUPABASE_SERVICE_KEY` in `.env.local`).  
> **Age logic (canonical):** use `narrative_posts.posted_at` — **bigint, unix epoch milliseconds**. Do not treat it as `timestamptz`.  
> **Ingest time:** `narrative_posts.first_seen_at` — **timestamptz** (when the worker first saw the post).

---

## Type legend

| Marker | Meaning |
|--------|---------|
| `(live)` | Column confirmed present on live DB (from row probe) |
| `(sql)` | From `worker/schema*.sql` only — not confirmed by row probe (empty table or no rows yet) |
| `bigint ms` | Unix epoch milliseconds (not seconds) |
| `timestamptz` | Postgres `timestamp with time zone` |

---

## Tables on live database (probed)

### `ingest_near_miss`

Sub-threshold posts queued for recheck when views may cross ingest floor.

| Column | Type | Notes |
|--------|------|-------|
| `platform` | text | `x` or `tt` |
| `platform_post_id` | text | Unique per platform |
| `views` | int | Last known view count |
| `likes` | int | |
| `raw` | jsonb | Original API payload |
| `first_seen_at` | timestamptz | |
| `last_checked_at` | timestamptz | |

---

### `narrative_posts`

Canonical ingested posts. **No `reposts` column** — use `retweets` and `quotes`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `narrative_id` | text | FK → `narratives.id`; null before clustering |
| `platform` | text | `x`, `tt`, … |
| `platform_post_id` | text | Unique with `platform` |
| `sort_order` | int | Order within narrative |
| `handle` | text | |
| `text` | text | |
| `followers` | int | |
| `image` | boolean | Legacy flag |
| `media_url` | text | |
| `media_type` | text | |
| `views` | int | Denormalized latest views |
| `replies` | int | |
| `quotes` | int | Quote tweets (X) |
| `likes` | int | |
| `retweets` | int | Retweets / TikTok shares — **not** named `reposts` |
| `notable` | boolean | |
| `sample_replies` | jsonb | |
| `posted_at` | **bigint ms** | Platform publish time — used for viral feed age/sort |
| `posted_at_ts` | timestamptz | Mirror of `posted_at`; **not written by ingest JS** (SQL backfill only) |
| `first_seen_at` | timestamptz | Worker first ingest time |
| `last_snapshot_at` | timestamptz | |
| `tracking_status` | text | `active`, `pruned`, … |
| `pruned_at` | timestamptz | |
| `snapshot_tier` | text | HOT/WARM/COLD |
| `filter_label` | text | Ingest lane label |
| `raw` | jsonb | Full API payload |
| `cluster_match` | text | How post matched narrative |
| `subject_entity` | text | From meme scoring |
| `ct_pickup` | boolean | CT replication signal |
| `ticker_proposal_count` | int | |
| `sound_id` | text | TikTok sound |

---

### `narrative_tickers`

Ticker proposals and on-chain enrichment per narrative.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `narrative_id` | text | FK |
| `ticker` | text | |
| `name` | text | |
| `mcap` | numeric | |
| `liquidity` | numeric | |
| `vol24h` | numeric | |
| `holders` | int | |
| `age_min` | int | |
| `first_deployed` | boolean | |
| `endorsed_by` | text | |
| `canonical` | boolean | |
| `safety` | jsonb | |
| `smart_money` | jsonb | |
| `mint_ca` | text | Solana mint address |
| `dex_url` | text | **(sql)** `schema-token-lookup.sql` — may be missing on live DB |
| `pump_url` | text | **(sql)** may be missing on live DB |
| `lookup_at` | timestamptz | **(sql)** may be missing on live DB |

---

### `narratives`

Clustered story groups.

| Column | Type | Notes |
|--------|------|-------|
| `id` | text | PK |
| `title` | text | |
| `blurb` | text | |
| `img_seed` | int | |
| `created_at` | bigint | Narrative creation epoch |
| `narr_idx` | int | Legacy index |
| `search_series` | jsonb | Google Trends interest series |
| `lead_time_min` | int | |
| `organic_score` | int | |
| `source` | text | e.g. `cluster` |
| `status` | text | `open`, `closed`, … |
| `display_eligible` | boolean | Frontend gate |
| `gate_reason` | text | Why gated out |
| `combined_views` | int | |
| `views_velocity` | numeric | |
| `author_velocity` | numeric | |
| `distinct_authors` | int | |
| `gain_24h` | int | |
| `accel` | numeric | |
| `engagement_velocity` | numeric | |
| `lifecycle` | text | heating/peaking/cooling |
| `age_min` | int | |
| `meme_score` | numeric | |
| `max_meme_score` | numeric | |
| `platforms` | jsonb | |
| `cross_platform` | boolean | |
| `ct_pickup` | boolean | |
| `bought_reach` | boolean | |
| `ticker_proposals` | jsonb | |
| `top_post_id` | uuid | |
| `trend_term` | text | SerpAPI query term |
| `trend_peak` | numeric | |
| `trend_direction` | text | |
| `first_seen_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `post_embeddings`

| Column | Type |
|--------|------|
| `post_id` | uuid (PK/FK) |
| `embedding` | vector / jsonb |
| `updated_at` | timestamptz |

---

### `post_meme_scores`

| Column | Type |
|--------|------|
| `post_id` | uuid (PK/FK) |
| `meme_score` | numeric |
| `suggested_ticker` | text |
| `suggested_name` | text |
| `model` | text |
| `reason` | text |
| `raw` | jsonb |
| `scored_at` | timestamptz |
| `velocity` | numeric |
| `views_velocity` | numeric |
| `engagement_velocity` | numeric |

---

### `post_snapshots`

Time-series engagement. **No `reposts` column** — use `retweets` + `quotes`.

| Column | Type |
|--------|------|
| `id` | uuid |
| `post_id` | uuid (FK) |
| `captured_at` | timestamptz |
| `views` | int |
| `likes` | int |
| `replies` | int |
| `retweets` | int |
| `quotes` | int |
| `bookmarks` | int |
| `unavailable` | boolean |
| `raw` | jsonb |

---

### `worker_budget_state`

X ingest adaptive floors (single row `id=1`).

| Column | Type |
|--------|------|
| `id` | int |
| `utc_date` | date |
| `reads_today` | int |
| `hourly_tweets` | int |
| `hourly_window_start` | timestamptz |
| `adaptive_floor` | int |
| `floor_catch_all` | int |
| `floor_media` | int |
| `floor_slow_burn` | int |
| `floor_min` | int |
| `floor_min_decay_at` | timestamptz |
| `media_lane_pct` | numeric |
| `ingest_underutilised_since` | timestamptz |
| `updated_at` | timestamptz |

---

### `worker_cycle_log`

| Column | Type |
|--------|------|
| `id` | bigint |
| `worker` | text |
| `ran_at` | timestamptz |
| `ingested` | int |
| `snapshots_written` | int |
| `pruned` | int |
| `reads_consumed` | int |
| `skipped_floor` | int |
| `adaptive_floor` | int |
| `budget_note` | text |

---

### `worker_usage`

Daily usage/cost by source (`source` + `utc_date` unique).

| Column | Type | Notes |
|--------|------|-------|
| `source` | text | e.g. `x`, `anthropic`, `apify` |
| `utc_date` | date | |
| `reads_today` | int | |
| `cost_usd` | numeric | |
| `cost_breakdown` | jsonb | |
| `updated_at` | timestamptz | |
| `posts_ingested` | int | **(sql)** `schema-anthropic.sql` — **missing on live DB** (see mismatches) |

---

## Tables defined in SQL but not row-probed

These exist in migrations and are referenced by worker code. Run `npm run schema:cron` / `schema:anthropic` / etc. if missing.

### `worker_pipeline_state` (single row `id=1`)

| Column | Type | Source |
|--------|------|--------|
| `id` | int PK | schema-anthropic.sql |
| `scoring_paused` | boolean | |
| `pause_reason` | text | |
| `anthropic_spent_usd` | numeric | |
| `anthropic_budget_usd` | numeric | |
| `projected_daily_usd` | numeric | |
| `updated_at` | timestamptz | |
| `last_run_ingest` | timestamptz | schema-cron.sql |
| `last_run_snapshot` | timestamptz | |
| `last_run_score` | timestamptz | |
| `last_run_cluster` | timestamptz | |
| `last_run_trends` | timestamptz | |
| `last_catch_all_at` | timestamptz | |
| `last_slow_burn_at` | timestamptz | |
| `last_near_miss_at` | timestamptz | |
| `ingest_degraded_mode` | boolean | |
| `tt_hashtag_cursor` | int | |
| `tt_velocity_unreliable` | boolean | |
| `last_health_alarm_at` | timestamptz | |
| `last_heartbeat` | timestamptz | schema-pipeline-reliability.sql |
| `pipeline_pid` | int | |
| `pipeline_started_at` | timestamptz | |

**Read by:** `site/live.js` (`fetchPipelineState`), `worker/lib/cron-state.js`, `worker/lib/anthropic-budget.js`.

---

### `worker_cron_progress`

| Column | Type |
|--------|------|
| `stage` | text PK |
| `progress` | jsonb |
| `updated_at` | timestamptz |

**Used by:** `worker/lib/cron-state.js` (Vercel cron resume).

---

### `worker_trend_cache`

| Column | Type |
|--------|------|
| `term` | text PK |
| `result` | jsonb |
| `fetched_at` | timestamptz |

**Used by:** `worker/lib/serp-trends.js`.

---

### `worker_crashes`

| Column | Type |
|--------|------|
| `id` | bigserial |
| `ts` | timestamptz |
| `reason` | text |
| `stack` | text |
| `uptime_sec` | numeric |

**Defined in:** `schema-pipeline-reliability.sql`. No current worker writes (legacy supervisor removed).

---

## Query mismatch audit

Automated `.select()` audit (`npm run schema:doc`) plus manual review of inserts, upserts, REST query strings, and semantic naming. **No fixes applied** — documentation only.

### Severity: silent data loss

| # | Issue | Code | DB reality | Impact |
|---|-------|------|------------|--------|
| M1 | **`worker_usage.posts_ingested` missing** | `worker/lib/budget.js` (select/insert/update), `worker/lib/anthropic-budget.js:144`, `worker/ingest.js:743`, `worker/ingest-tiktok.js:293` | Column defined in `schema-anthropic.sql`; **not present** on live probed `worker_usage` | Ingest counters never persist; 7-day ingest stats always empty. Errors swallowed by `.catch()` |
| M2 | **`narrative_tickers.dex_url` / `pump_url` / `lookup_at` may be missing** | `worker/lib/enrich-tickers.js:23-40` writes all three; falls back to core-only patch on column error | `schema-token-lookup.sql` adds columns; **not in live row probe** for `narrative_tickers` | URL fields silently dropped; frontend constructs URLs from `mint_ca` only |
| M3 | **`posted_at_ts` never written by application** | Ingest writes only `posted_at` bigint ms (`worker/lib/ingest-upsert.js:44`, `worker/repair-stale.js:40`) | Column exists on live DB; SQL backfill in `schema-posted-at.sql` | Column drifts stale after ingest/repair unless SQL re-run. Low impact today because all runtime filters use `posted_at` ms |
| M4 | **Cluster ticker wipe resets enrichment** | `worker/lib/cluster-persist.js` deletes all tickers then re-inserts bare rows (`ticker`, `name`, zeros); `worker/cluster.js` re-enriches after | Enrichment columns (`mint_ca`, mcap, `dex_url`, …) exist | Failed DexScreener lookup after cluster **permanently clears** previously stored on-chain data |

---

### Severity: semantic / wrong metric (not a missing column)

| # | Issue | Code | Detail |
|---|-------|------|--------|
| M5 | **`reposts` is not a DB column** | DB: `retweets`, `quotes` on `narrative_posts` and `post_snapshots` | Worker ingest/snapshot paths use correct names |
| M6 | **UI label `reposts` = retweets + quotes** | `site/index.html:1289-1290` `postMetrics()` | Display-only; intentional UX grouping |
| M7 | **DOM scrape maps `reposts` → `retweets`, drops quotes** | `site/index.html:1406` `postFromNoteEl()` reads `data-metric="reposts"` into `retweets`, hardcodes `quotes: 0` | Quote counts lost when opening deploy from scraped rail card |
| M8 | **Velocity math uses `retweets` only, excludes `quotes`** | `worker/lib/velocity.js:3-9` comment says "reposts" but uses `snapshot.retweets` only | Engagement velocity undercounts vs UI "reposts" label |
| M9 | **`score.js` nested snapshot select omits `quotes`** | `worker/score.js:71-73` selects `retweets, replies` not `quotes` | Aligns with M8; quotes excluded from scoring context |
| M10 | **`posted_at` vs `first_seen_at` mixed semantics in UI fallback** | `site/live.js:498-504` — if `posted_at` null, client uses `firstSeenAt` for display age | Can show wrong "posted" age in narrative cards (not viral feed, which filters on `posted_at`) |
| M11 | **`mint` vs `mint_ca` naming** | DB: `mint_ca`; worker write: `enrich-tickers.js:22`; frontend read: `live.js:570` maps to `mint` | Correct mapping; no DB mismatch |

---

### Severity: tooling false positives (ignore for runtime)

| # | Issue | Detail |
|---|-------|--------|
| M12 | **`selectid` false positive** | `site/live.js:1141-1149` REST strings like `select=id,platform,…` parsed by `generate-schema-doc.js` as column `selectid` — not a real column reference |

---

### Severity: schema doc / migration drift

| # | Issue | Detail |
|---|-------|--------|
| M13 | **`generate-schema-doc.js` KNOWN_TABLES incomplete** | Missing: `worker_pipeline_state`, `worker_cron_progress`, `worker_trend_cache`, `worker_crashes` — causes false "table not in schema doc" for cron-state and serp-trends |
| M14 | **`SCHEMA_SQL_FILES` list incomplete** | Omits `schema-anthropic.sql`, `schema-cron.sql`, `schema-pipeline-reliability.sql`, `schema-token-lookup.sql`, etc. — offline fallback under-reports columns when tables are empty |
| M15 | **Original `schema.sql` vs live drift** | Base DDL has `narrative_posts.narrative_id NOT NULL`; live pipeline ingests with `narrative_id=null` before cluster — migration relaxed this constraint |

---

### Confirmed OK (worker + frontend selects)

- Worker `.select()` on `narrative_posts`, `post_snapshots`, `narratives` use valid column names (`retweets`, `quotes`, `posted_at`, `first_seen_at`, …).
- `worker/lib/ingest-upsert.js` upsert payload matches live columns (writes `posted_at` ms, not `posted_at_ts`).
- `worker/lib/snapshots.js` insert uses `retweets`, `quotes`, `bookmarks`.
- `worker/lib/parse-raw-post.js` maps `retweetCount` → `retweets`, `quoteCount` → `quotes`.
- `site/live.js:1147-1148` viral REST filter: `posted_at=gte.${postedCutoff}` (ms) + `order=posted_at.desc.nullslast,first_seen_at.desc` — **correct types**.
- `api/**/*.js` — no Supabase references (external APIs only).

---

## Recommended fix order (reference only — not applied)

1. Apply `worker/schema-anthropic.sql` → add `posts_ingested`; add error handling in `recordPostsIngested`.
2. Apply `worker/schema-token-lookup.sql` if not applied → `dex_url`, `pump_url`, `lookup_at`.
3. Change `cluster-persist.js` ticker upsert to merge/update instead of delete-all.
4. Either sync `posted_at_ts` on every `posted_at` write, or stop using `posted_at_ts` in indexes/docs.
5. Align velocity/scoring with quotes if "reposts" should mean retweets + quotes.
6. Extend `generate-schema-doc.js` KNOWN_TABLES and SCHEMA_SQL_FILES for accurate future audits.

---

## Appendix: live probe column inventory (2026-07-28)

Full column keys returned by service-role `SELECT * LIMIT 1` per table. Types shown as `(live)` when Postgres `information_schema` was not used.

### `ingest_near_miss`
`first_seen_at`, `last_checked_at`, `likes`, `platform`, `platform_post_id`, `raw`, `views`

### `narrative_posts`
`cluster_match`, `ct_pickup`, `filter_label`, `first_seen_at`, `followers`, `handle`, `id`, `image`, `last_snapshot_at`, `likes`, `media_type`, `media_url`, `narrative_id`, `notable`, `platform`, `platform_post_id`, `posted_at`, `posted_at_ts`, `pruned_at`, `quotes`, `raw`, `replies`, `retweets`, `sample_replies`, `snapshot_tier`, `sort_order`, `sound_id`, `subject_entity`, `text`, `ticker_proposal_count`, `tracking_status`, `views`

### `narrative_tickers`
`age_min`, `canonical`, `endorsed_by`, `first_deployed`, `holders`, `id`, `liquidity`, `mcap`, `mint_ca`, `name`, `narrative_id`, `safety`, `smart_money`, `ticker`, `vol24h`

### `narratives`
`accel`, `age_min`, `author_velocity`, `blurb`, `bought_reach`, `combined_views`, `created_at`, `cross_platform`, `ct_pickup`, `display_eligible`, `distinct_authors`, `engagement_velocity`, `first_seen_at`, `gain_24h`, `gate_reason`, `id`, `img_seed`, `lead_time_min`, `lifecycle`, `max_meme_score`, `meme_score`, `narr_idx`, `organic_score`, `platforms`, `search_series`, `source`, `status`, `ticker_proposals`, `title`, `top_post_id`, `trend_direction`, `trend_peak`, `trend_term`, `updated_at`, `views_velocity`

### `post_embeddings`
`embedding`, `post_id`, `updated_at`

### `post_meme_scores`
`engagement_velocity`, `meme_score`, `model`, `post_id`, `raw`, `reason`, `scored_at`, `suggested_name`, `suggested_ticker`, `velocity`, `views_velocity`

### `post_snapshots`
`bookmarks`, `captured_at`, `id`, `likes`, `post_id`, `quotes`, `raw`, `replies`, `retweets`, `unavailable`, `views`

### `worker_budget_state`
`adaptive_floor`, `floor_catch_all`, `floor_media`, `floor_min`, `floor_min_decay_at`, `floor_slow_burn`, `hourly_tweets`, `hourly_window_start`, `id`, `ingest_underutilised_since`, `media_lane_pct`, `reads_today`, `updated_at`, `utc_date`

### `worker_cycle_log`
`adaptive_floor`, `budget_note`, `id`, `ingested`, `pruned`, `ran_at`, `reads_consumed`, `skipped_floor`, `snapshots_written`, `worker`

### `worker_usage`
`cost_breakdown`, `cost_usd`, `reads_today`, `source`, `updated_at`, `utc_date` — **note: `posts_ingested` absent on live (M1)**

