# Backtest — predictive signal experiment

**Pipeline is STOPPED.** These scripts do not start ingest, snapshotter, or any cron route.
Post search uses **X API v2 official** (`worker/lib/x-official-adapter.js`) only — never TwitterAPI.io.

## Setup

1. Apply `worker/schema-backtest.sql` (or `npm run schema:backtest` with `SUPABASE_DB_URL`).
2. `.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, optional `BIRDEYE_API_KEY`.
3. For stage 2+: `X_OFFICIAL_BEARER_TOKEN` (app-only bearer from X Developer Console).
4. Budget: `X_OFFICIAL_CREDIT_BUDGET=10` (default), `$0.005/read`.

## Stages (run in order — STOP at each gate)

| Step | Command |
|------|---------|
| 1 | `npm run backtest:tokens` → CSV in `backtest/out/` → **STOP** |
| Probe | `npm run backtest:probe-x -- --ticker=… --name=… --launch=ISO` → raw JSON + spend → **STOP** |
| 2 one | `npm run backtest:candidates -- --mint=…` |
| 2 all | `npm run backtest:candidates -- --all` (only after probe OK) → **STOP** if retained &lt; 20/group |
| 3 | `npm run backtest:features` |
| 4 | `npm run backtest:report` |

## Tables

`backtest_runs`, `backtest_tokens`, `backtest_candidates`, `backtest_post_features`, `backtest_spend_log`

Charge dedup cache: `.backtest/x-official-charged.json` (24h UTC window).
