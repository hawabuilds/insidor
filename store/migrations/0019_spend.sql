-- 0019_spend.sql
--
-- WHAT WE SPENT, ON DISK, SO THE DAILY CAP OUTLIVES THE PROCESS THAT ENFORCES IT.
--
-- ── ★ THE BUG THIS TABLE EXISTS TO CLOSE ────────────────────────────────────
--
-- Before this file the only ledger was a closure. `inMemoryMeter` held an array of
-- spends, `mayspend` summed it, and the sum was correct — for exactly as long as the
-- process lived. Its own header said so: "a restart is a fresh day's budget".
--
-- That is not a small gap in a cap, it is the gap that removes the cap. A daily
-- ceiling that resets on boot bounds nothing under the one condition where a bill
-- actually runs away: a process that crashes and is restarted by a supervisor. Crash
-- every sixty seconds under a restarting supervisor and the day gets fourteen hundred
-- fresh budgets, each of them individually enforced, each of them correct, and the
-- invoice is fourteen hundred times the number somebody typed into policy. Nothing in
-- the system was wrong; the ledger simply had no memory, and a memoryless ledger is
-- indistinguishable from a working one right up until the restart.
--
-- So the tally is seeded from this table at boot and written behind every record. The
-- meter stays synchronous — it is consulted inside an adapter call, on the path of
-- every request, and an adapter may not await a database — and this is the durable
-- half it composes with.
--
-- ── ★ WHY IT IS APPEND-ONLY, LIKE THE DECISION LOG AND THE READING SERIES ────
--
-- Because the question asked of it is not only "what is today's total". It is also
-- "what did we buy, when, and did the bill double because the price moved or because
-- the volume did" — which is why `units` is stored beside `usd` rather than being
-- folded into it. A running total in one mutable row would answer the first question
-- and destroy the second, and the second is the one asked during an incident.
--
-- The `internal.forbid_mutation()` trigger from 0001 is attached below. A correction
-- is a new row. Editing a spend row would mean editing the evidence of a charge that
-- has already left somebody's card.
--
-- ── ★ WHY `internal` AND NOT `public` ───────────────────────────────────────
--
-- Every row here names a vendor we buy from and an endpoint we call, which is text
-- about our own machinery and not a fact about the world. It fails the product rule
-- head-on — none of this would be true if Insidor did not exist — so it lives in the
-- schema 0001 never granted the app role USAGE on, and there is no grant line below.
-- What a reader may be told about spending is a projector's decision, not this one's.
--
-- ── ★ WHY THERE IS NO PARTITION AND NO RETENTION, unlike internal.decisions ──
--
-- Volume. `decisions` takes a row per subject per stage and is partitioned by day
-- because a month of it is unmanageable; this takes a row per VENDOR CALL, and the
-- cadences in services/runner make that a few hundred a day at the shipped
-- configuration. A year is a rounding error. Partitioning it would buy maintenance
-- work and a `spend_default` failure mode in exchange for nothing.

create table internal.spend (
  id           bigint generated always as identity primary key,

  -- The opaque vendor token the adapter records, NOT a source id. The distinction is
  -- load-bearing: two sources can sit behind one reseller and therefore one bill, and
  -- a per-vendor cap keyed by source would then cap each of them separately while the
  -- invoice added them together. This column is what the cap is grouped by.
  vendor       text not null check (length(vendor) > 0),

  -- The specific call — 'search', 'lookup', 'judge'. Prices are per endpoint and never
  -- per vendor, so a total that lost this could not say which call got expensive.
  endpoint     text not null check (length(endpoint) > 0),

  -- ★ THE BILLING KIND, STORED. Vendors bill in kinds that do not reconcile — per item
  -- returned, per call, per actor run, flat — and summing `units` across two kinds is
  -- meaningless arithmetic that produces a number anyway. Keeping the kind on the row
  -- is what lets a reader refuse to add them. The list matches BILLING_UNITS in
  -- contracts/src/ports/meter.ts and store/src/migrations.test.ts asserts that it does.
  unit         text not null check (unit in ('per-item-returned', 'per-call', 'per-run', 'flat')),

  -- ★ COUNTABLE UNITS, BESIDE THE DOLLARS AND NOT INSTEAD OF THEM. A bill that doubled
  -- is a different investigation depending on whether the price moved or the volume
  -- did, and a row holding only the total cannot answer it. Numeric rather than integer
  -- because a token-priced call reports fractional units of its own accounting.
  units        numeric(14, 4) not null check (units >= 0),

  -- What it cost. Eight decimal places because the smallest real charge in this system
  -- is $0.00015 and rounding it to cents would record every discovery call as free.
  usd          numeric(12, 8) not null check (usd >= 0),

  -- ★ WHEN THE CALL HAPPENED, injected by the caller, NOT `now()`. This is the column
  -- the daily total is grouped by, and it has to be the instant the adapter recorded so
  -- that a replay and a live run produce the same ledger. A `default now()` here would
  -- make the day boundary a property of when the row reached Postgres.
  at           timestamptz not null,

  -- When the row landed. Separate from `at` so a write-behind that fell an hour behind
  -- is visible as itself rather than as an hour of spending that never happened.
  recorded_at  timestamptz not null default now()
);

-- The one query on the hot path: today's total, and today's total per vendor. Both are
-- served by this index, and `vendor` is included so the per-vendor line does not go to
-- the heap for a sum taken once a second at boot and after every refusal.
create index spend_day_idx on internal.spend (at desc) include (vendor, usd);

comment on table internal.spend is
  'Append-only ledger of every billable vendor call. Seeded into the in-memory meter at boot and written behind each record, which is what makes a daily cap survive a restart. A crash loop with no memory here spends the daily cap once per crash.';

comment on column internal.spend.vendor is
  'The opaque vendor token, not a source id. Two sources behind one reseller share one bill, and the per-vendor cap is grouped by this.';

comment on column internal.spend.unit is
  'The billing KIND. Units of different kinds do not add up; the column exists so a reader can refuse to add them.';

comment on column internal.spend.at is
  'When the call happened, as the caller recorded it. Never now() — the day boundary must not depend on when the row reached the database.';

/* Append-only, by the trigger from 0001 and not by discipline. A spend row is evidence
   of a charge that has already been made; an UPDATE here would be editing somebody's
   invoice after the fact, and the direction it would be edited in is always the same —
   toward a day that looks affordable. */
create trigger spend_append_only
  before update or delete on internal.spend
  for each row execute function internal.forbid_mutation();

/* No grant line, and the omission is deliberate. `internal` is a schema the app role has
   no USAGE on, so there is nothing here that could put a vendor's name or our own
   spending in front of a browser by accident. 0001's default privileges already give
   insidor_service SELECT and insidor_internal SELECT/INSERT, which covers the runner
   seeding its meter and writing to it. */
