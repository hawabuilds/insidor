# Insidor Layer 3 — Architecture

> Repo: `Insidor-layer3` · Production: [insidor-layer3.vercel.app](https://insidor-layer3.vercel.app)  
> Static frontend in `site/` · Pipeline on Vercel Cron · Data in Supabase Postgres  
> Auth: Privy (Solana wallet + email)

---

## System overview

Insidor Layer 3 ingests viral X/TikTok posts, tracks engagement over time, scores meme potential with Claude, clusters posts into narratives, enriches with Google Trends, and displays eligible narratives plus a meme-gated viral feed in a static SPA. Token market data comes from DexScreener; on-chain trading uses Jupiter/Birdeye/Helius via Vercel serverless proxies.

```
External APIs                    Worker (Vercel Cron)              Supabase              Frontend
─────────────                    ────────────────────              ────────              ────────
twitterapi.io (X)     ──► ingest.js ──► narrative_posts ──► Realtime ──► Narratives tab
Apify (TikTok)*       ──► ingest-tiktok.js ──┘         post_snapshots    poll fallback
                                 snapshotter.js ──► post_snapshots
                                 score.js ──► post_meme_scores
                                 cluster.js ──► narratives, narrative_tickers
SerpAPI               ──► trends.js ──► narratives.search_series
DexScreener           ──► enrich-tickers.js ──► narrative_tickers.mint_ca
                                 live.js fastBoot ──► TOKENS[] (in-memory)
```

\* TikTok ingest runs in `worker/index.js` locally only — not scheduled in `vercel.json` crons.

---

## Repository layout (every file)

Excludes `node_modules/`, `.git/`, `.vercel/`. Env files listed for completeness; secrets are gitignored.

### Root

| File | Purpose |
|------|---------|
| `.env.example` | Template for API keys, Supabase, cron secret, pipeline tuning |
| `.env.local` | Local secrets (gitignored) |
| `.env.production.local` | Local production-mode env override (gitignored) |
| `.gitignore` | Ignores node_modules, env files, Vercel metadata |
| `.vercelignore` | Deploy exclusions; **keeps** `worker/` so cron routes can import it |
| `package.json` | npm scripts: pipeline stages, schema migrations, diagnostics |
| `package-lock.json` | Locked deps: `@supabase/supabase-js`, `@privy-io/js-sdk-core` |
| `vercel.json` | `outputDirectory: site`, `api/**/*.js` max 60s, cron schedules |

### `.cursor/`

| File | Purpose |
|------|---------|
| `.cursor/rules/project-safety.mdc` | Agent guardrails: workspace scope, Privy-only auth, safe deletes |

### `site/` — production UI (Vercel static output)

| File | Purpose |
|------|---------|
| `site/index.html` | SPA: 5 nav tabs, narratives table, token pages, Privy auth, right viral rail |
| `site/live.js` | DexScreener discovery/refresh; Supabase narratives + viral feed (Realtime + poll) |
| `site/config.js` | Supabase URL + anon key; `InsidorConfig.isLayer3()` |
| `site/tokenpage.js` | Token detail: DexScreener chart embed, Jupiter quote wiring |
| `site/.gitignore` | Site-local ignore patterns |

### `api/` — Vercel serverless

| File | Purpose |
|------|---------|
| `api/activity.js` | Birdeye recent trades + top traders (combined) |
| `api/balance.js` | Helius RPC: wallet SOL + optional SPL balance |
| `api/holders.js` | Helius token accounts → holder count, top holders, top10% |
| `api/ohlcv.js` | Birdeye OHLCV candles (15-minute cache) |
| `api/public-config.js` | Public Supabase URL + anon key from env |
| `api/quote.js` | Jupiter v1 quote proxy |
| `api/swap.js` | Unsigned Jupiter swap tx for Privy wallet signing |
| `api/safety.js` | RugCheck → mint/freeze/LP/top10 risk fields |
| `api/token-lookup.js` | DexScreener/pump.fun by `?ticker=` or `?mint=` |
| `api/token-search.js` | DexScreener/pump.fun search `?q=` |
| `api/toptraders.js` | Birdeye 24h PnL top traders |
| `api/trades.js` | Birdeye recent swaps for a mint |
| `api/cron/ingest.js` | Cron: `worker/ingest.js` X ingest cycle |
| `api/cron/snapshot.js` | Cron: `worker/snapshotter.js` tiered snapshots |
| `api/cron/score.js` | Cron: `worker/score.js` Claude meme scoring |
| `api/cron/cluster.js` | Cron: `worker/cluster.js` narrative clustering |
| `api/cron/trends.js` | Cron: `worker/trends.js` velocity + Google Trends |
| `api/cron/_lib/auth.js` | Validates `Authorization: Bearer $CRON_SECRET` |
| `api/cron/_lib/run-stage.js` | Shared cron runner: time guard, progress resume, JSON response |
| `api/_lib/birdeye-trades.js` | Shared Birdeye `/defi/txs/token` fetch + top-trader derivation |
| `api/_lib/cache.js` | In-memory TTL cache with stale-while-revalidate |
| `api/_lib/http.js` | CORS headers and `okJson()` helper |

### `lib/`

| File | Purpose |
|------|---------|
| `lib/token-lookup.js` | Shared DexScreener/pump.fun search for API routes |

### `docs/`

| File | Purpose |
|------|---------|
| `docs/ARCHITECTURE.md` | This document |
| `docs/schema.md` | Live Supabase columns + query mismatch audit |
| `docs/insidor-architecture.html` | Legacy architecture export (HTML) |
| `docs/insidor-architecture.pdf` | Legacy architecture export (PDF) |
| `docs/insidor-user-flows.html` | User-flow export (HTML) |
| `docs/insidor-user-flows.pdf` | User-flow export (PDF) |

### `worker/` — pipeline stages (cron-imported + local dev)

| File | Purpose |
|------|---------|
| `worker/index.js` | Local unified worker: 6 staggered stage loops |
| `worker/ingest.js` | X catch-all ingest → `narrative_posts` + initial snapshot |
| `worker/ingest-tiktok.js` | TikTok Apify ingest → `narrative_posts` (local only) |
| `worker/snapshotter.js` | Tiered re-fetch X/TT → `post_snapshots`, prune cold posts |
| `worker/score.js` | Top-N by views velocity → Claude → `post_meme_scores` |
| `worker/cluster.js` | Cluster scored posts → `narratives`, assign posts, tickers |
| `worker/trends.js` | Narrative velocity metrics + SerpAPI Google Trends |
| `worker/stats.js` | One-shot pipeline health diagnostic |
| `worker/coverage.js` | Audit whether tweet URLs exist in DB |
| `worker/budget-report.js` | X API read budget report |
| `worker/repair-stale.js` | Fix bad `posted_at` units and stale tracking rows |
| `worker/token-lookup.js` | CLI backfill `narrative_tickers` from DexScreener |
| `worker/backfill-tweet-billing.js` | Backfill tweet billing/read history |
| `worker/generate-schema-doc.js` | Generates `docs/schema.md` from live DB + SQL fallbacks |
| `worker/apply-schema-*.js` | One-shot migration runners per SQL file |
| `worker/schema*.sql` | Incremental Postgres DDL, indexes, RLS |

### `worker/lib/` — shared pipeline modules

| File | Purpose |
|------|---------|
| `anthropic-budget.js` | Daily Claude spend, dormancy, scoring pause → `worker_pipeline_state` |
| `anthropic-pricing.js` | Model pricing for cost estimation |
| `apify-budget.js` | Apify TikTok daily budget |
| `budget.js` | X/twitterapi.io read budget, adaptive floors, `posts_ingested` counter |
| `cluster-engine.js` | Cashtag/keyword/embedding match; narrative derivation |
| `cluster-persist.js` | Upsert narratives, assign posts, tickers, close aged-out |
| `cron-state.js` | Persist/resume cron progress → `worker_cron_progress`, `worker_pipeline_state` |
| `cycle-log.js` | Per-stage metrics → `worker_cycle_log` |
| `dist-stats.js` | Views-velocity distribution logging |
| `embeddings.js` | Text embeddings for semantic cluster matching |
| `enrich-tickers.js` | DexScreener on-chain enrichment of `narrative_tickers` |
| `env.js` | Load `.env.local`, require-env helpers |
| `funnel-log.js` | Structured ingest/score/cluster funnel logs |
| `ingest-floors.js` | Adaptive `min_faves` floor per ingest lane |
| `ingest-funnel.js` | Lane-level ingest logging |
| `ingest-query.js` | X advanced search query builders |
| `ingest-upsert.js` | Shared `narrative_posts` upsert for X and TikTok |
| `latency.js` | Pipeline eligibility latency logging |
| `meme-gate.js` | Platform meme thresholds (`MEME_MIN_X`, `MEME_MIN_TT`) |
| `meme-score.js` | Claude Haiku scoring (text + TikTok vision) |
| `nameability.js` | Cap/adjust suggested ticker nameability |
| `narrative-copy.js` | When to regenerate narrative title/blurb |
| `narrative-title.js` | Claude-generated narrative titles |
| `near-miss.js` | Sub-threshold posts; recheck when views rise |
| `parse-raw-post.js` | twitterapi.io tweet JSON → normalized fields |
| `parse-tiktok-post.js` | Apify TikTok item → normalized post |
| `pipeline-intervals.js` | Local poll intervals (ingest 10m, snapshot 60s, etc.) |
| `posted-at.js` | Normalize `posted_at` to unix **milliseconds** |
| `replication.js` | X entity search for CT replication signal |
| `retry.js` | Sleep + retry helpers |
| `serp-trends.js` | SerpAPI Google Trends + `worker_trend_cache` |
| `snapshots.js` | Insert `post_snapshots` rows |
| `subject-entity.js` | Extract subject entity from post text |
| `supabase.js` | Service-role Supabase client factory |
| `text-utils.js` | Text normalization, keyword extraction |
| `tiktok-budget.js` | TikTok/Apify read budget per cycle |
| `tiktok-enabled.js` | `TIKTOK_ENABLED` feature gate |
| `tiktok-reader.js` | Apify hashtag/search/batch URL actors |
| `time-guard.js` | Vercel 60s timeout guard with resume progress |
| `trend-term.js` | Derive Google Trends search term from narrative title |
| `tt-score-gate.js` | TikTok vision pre-gate before Claude |
| `tt-view-diagnostic.js` | Unreliable TikTok view detection |
| `ticker-proposals.js` | Scan posts for cashtag/ticker proposals |
| `velocity.js` | Views/engagement velocity, lifecycle stats |
| `x-reader.js` | twitterapi.io search, get-by-id, advanced search |

---

## Data flow: ingest → frontend feed

### Stage 1 — Ingest (X)

**Cron:** `/api/cron/ingest` every 2 minutes · **Module:** `worker/ingest.js`

1. Read budget state from `worker_budget_state` / `worker_usage`.
2. Build advanced search queries (`ingest-query.js`): catch-all, media lane, slow-burn.
3. Fetch tweets via `x-reader.js` (twitterapi.io).
4. Parse with `parse-raw-post.js` → `views`, `retweets`, `quotes`, `likes`, `replies`, `postedAt`.
5. Apply view floor (default ≥30k via `MIN_INGEST_VIEWS`).
6. Upsert via `ingest-upsert.js` → `narrative_posts` (`posted_at` bigint ms, `first_seen_at` timestamptz).
7. Insert initial `post_snapshots` row on first ingest (`snapshots.js`).
8. Sub-threshold posts → `ingest_near_miss` for recheck (`near-miss.js`).
9. Persist ingest memory to `worker_pipeline_state` (`cron-state.js`).

### Stage 1b — Ingest (TikTok, local only)

**Module:** `worker/ingest-tiktok.js` (in `worker/index.js`, **not** in Vercel crons)

Same upsert path; Apify via `tiktok-reader.js`; higher view floor (default 100k TT).

### Stage 2 — Snapshots

**Cron:** `/api/cron/snapshot` every 2 minutes · **Module:** `worker/snapshotter.js`

1. Load active `narrative_posts` (X + TT, ~3h window).
2. Tier by views velocity: HOT 2m / WARM 8m / COLD 20m (TT ×3 multiplier).
3. Re-fetch via `getTweetsByIds` (X) or `getTikTokVideosByUrls` (TT).
4. Append `post_snapshots` (`retweets`, `quotes`, `likes`, `replies`, `views`, `captured_at`).
5. Update denormalized `views` on `narrative_posts`.
6. Prune cold posts with vv &lt; 500/min after 10m (never prune viral-feed-eligible posts).

### Stage 3 — Meme scoring

**Cron:** `/api/cron/score` every 3 minutes · **Module:** `worker/score.js`

1. Select unscored posts in 3h window with views velocity (or fast-lane).
2. Top `SCORE_TOP_N` (default 10) per cycle.
3. Claude Haiku (`meme-score.js`); vision path for TikTok (`tt-score-gate.js`).
4. Insert `post_meme_scores` (`meme_score`, `suggested_ticker`, `suggested_name`).
5. Update `subject_entity` on `narrative_posts`.
6. Gated by `MEME_MIN_X` (0.6) / `MEME_MIN_TT` (0.75) and Anthropic daily budget.

### Stage 4 — Clustering

**Cron:** `/api/cron/cluster` every 3 minutes · **Module:** `worker/cluster.js`

1. Load scored posts (24h window) and open `narratives`.
2. Match: cashtag → keyword overlap → embedding similarity (`cluster-engine.js`).
3. Merge or create narratives (`source=cluster`, `status=open`).
4. Derive title/blurb (Claude), combined views, velocities.
5. `computeNarrativeReplication`: X entity search for CT pickup.
6. `applyDisplayGate`: set `display_eligible` when ≥200k combined views + meme/velocity gates pass.
7. Assign `narrative_posts.narrative_id`, upsert `narrative_tickers`.
8. `closeAgedOutNarratives`: close narratives past max age.
9. `enrichNarrativeTickers`: DexScreener lookup → `mint_ca`, mcap, liquidity.

### Stage 5 — Trends

**Cron:** `/api/cron/trends` every 45 minutes · **Module:** `worker/trends.js`

1. `refreshVelocityMetrics`: recompute `combined_views`, `gain_24h`, `views_velocity`, `accel`, `lifecycle`, `age_min` on open narratives.
2. `enrichGoogleTrends`: SerpAPI by `trend_term` → `search_series`, `trend_peak`, `trend_direction` (budget-capped, cached in `worker_trend_cache`).

### Frontend — bootstrap and live updates

**Files:** `site/index.html` + `site/live.js`

#### Boot sequence

1. `loadNarratives()` — REST fetch `narratives` where `display_eligible=true` (+ nested posts/tickers) → `NARRATIVES[]`.
2. `loadViralStream()` — REST fetch `narrative_posts` inner-join `post_meme_scores`, meme-gated → `VIRAL_STREAM[]`.
3. `fastBoot()` — DexScreener discovery → `TOKENS[]`.
4. `startNarrativesRealtime()` — Supabase Realtime channels.

#### Realtime channels

| Channel | Table / filter | UI effect |
|---------|----------------|-----------|
| `narratives-display-eligible` | `narratives` WHERE `display_eligible=true` | Narratives + Trending tables (incremental DOM) |
| `narratives-pipeline` | `narratives` WHERE `source=cluster` | Internal pipeline tracking (`NARRATIVES_ALL`) |
| `narrative-posts-firehose` | `narrative_posts` all events | Viral rail cards |
| `worker-pipeline-state` | `worker_pipeline_state` id=1 | Scoring-paused banner |

#### Poll fallbacks

| Target | Interval | When |
|--------|----------|------|
| Narratives REST diff | 60s | Realtime disconnected only |
| Viral feed REST | 20s | Always (supplements Realtime) |
| Pipeline state | 60s | Always |
| DexScreener tokens | 30s refresh / 120s discover | Always |

#### Frontend tabs

| Tab | Data source |
|-----|-------------|
| **Trending** | `NARRATIVES[]` (narratives sub-pane) + `TOKENS[]` (DexScreener) |
| **New Pairs** | `TOKENS[]` by age + `PENDING{}` candidate tickers |
| **Narratives** | `NARRATIVES[]` full table with trend sparklines |
| **Tokens** | `TOKENS[]` + `PENDING{}` |
| **Watchlist** | In-memory watch sets over narratives + tokens |
| **Right rail (viral)** | `VIRAL_STREAM[]` from Supabase meme-gated posts |
| **Token page** | DexScreener chart + `/api/trades`, `/api/holders`, `/api/safety`, Jupiter swap |

---

## Vercel deployment

| Setting | Value |
|---------|-------|
| Static output | `site/` |
| Serverless | `api/**/*.js`, `maxDuration: 60` |
| Cron ingest/snapshot | `*/2 * * * *` |
| Cron score/cluster | `*/3 * * * *` |
| Cron trends | `*/45 * * * *` |
| Cron auth | `Authorization: Bearer $CRON_SECRET` |

Local dev: `npx serve . -p 3456` from repo root · Optional pipeline: `npm run pipeline` → `worker/index.js`.

---

## Key Supabase tables

| Table | Role in pipeline |
|-------|------------------|
| `narrative_posts` | Ingested X/TikTok posts; tracking, views, narrative assignment |
| `post_snapshots` | Time-series engagement for velocity |
| `post_meme_scores` | Claude meme scores + suggested tickers |
| `post_embeddings` | Semantic vectors for cluster matching |
| `narratives` | Clustered stories; display gates and trend metrics |
| `narrative_tickers` | Proposed/deployed tickers per narrative |
| `ingest_near_miss` | Below-floor posts queued for recheck |
| `worker_pipeline_state` | Cron memory, scoring pause, budget counters |
| `worker_cron_progress` | Resumable per-stage progress (JSONB) |
| `worker_trend_cache` | SerpAPI Google Trends result cache |
| `worker_budget_state` | X ingest adaptive floors |
| `worker_usage` | Daily API usage and cost by source |
| `worker_cycle_log` | Per-stage cycle audit log |

Full column lists: `docs/schema.md`.

---

## External dependencies

| Service | Used by |
|---------|---------|
| Supabase Postgres + Realtime | Worker, frontend |
| twitterapi.io | X ingest, snapshots, replication |
| Apify | TikTok ingest/snapshots |
| Anthropic Claude | Meme scoring, narrative titles |
| SerpAPI | Google Trends enrichment |
| DexScreener | Token discovery, ticker enrichment |
| Birdeye / Helius / Jupiter / RugCheck | `/api/*` trading proxies |

---

## Notable constraints

1. **Cron time budget:** Each stage ≤60s via `time-guard.js`; partial progress saved to `worker_cron_progress` for resume.
2. **TikTok ingest gap:** No `/api/cron/ingest-tiktok` — production TT posts require local pipeline or future cron.
3. **Display gate:** Only `display_eligible=true` narratives appear in main UI; sub-threshold clusters still tracked internally.
4. **Age semantics:** Runtime age/recency uses `narrative_posts.posted_at` (bigint unix **ms**), not `first_seen_at` (ingest time) or `posted_at_ts` (timestamptz mirror — see schema audit).
5. **Secrets:** Browser uses anon key in `site/config.js`; service key only in worker/cron env.
