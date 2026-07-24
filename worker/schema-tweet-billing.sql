-- Tweet-based billing counters (reads_today = tweets returned, not API calls)

alter table public.worker_budget_state
  add column if not exists hourly_tweets int not null default 0,
  add column if not exists hourly_window_start timestamptz;

-- Backfill: historical rows counted API calls (~1) not tweets (~20/page)
-- Uses TWEETS_PER_CALL_ESTIMATE default of 20; re-run backfill script for precise correction.

update public.worker_usage
set
  reads_today = reads_today * 20,
  cost_usd = round((reads_today * 20 * 0.00015)::numeric, 4)
where source = 'x'
  and reads_today > 0
  and reads_today < 5000;

update public.worker_budget_state
set
  reads_today = reads_today * 20,
  updated_at = (now() at time zone 'utc')
where id = 1
  and reads_today > 0
  and reads_today < 5000;

update public.worker_cycle_log
set reads_consumed = reads_consumed * 20
where reads_consumed is not null
  and reads_consumed > 0
  and reads_consumed < 500;
