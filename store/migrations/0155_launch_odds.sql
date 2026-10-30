-- 0155_launch_odds.sql
--
-- WHAT HAPPENED TO PAST LAUNCHES THAT OPENED LIKE THIS ONE (the owner, 2026-10-30: show a trader the odds
-- and the rug risk on a coin's token page, at a glance). tools/odds-bands.ts reads a month of launches'
-- first hours from the chain (tools/odds-backfill.ts), groups them by how they opened, and writes here what
-- share of each group went on to double, triple, 5x and 10x from that moment, how many were rugged within
-- the hour and how many never moved. The read service matches a live coin to its group and shows the
-- group's history beside the history of all launches.
--
-- ★ HISTORY, NOT A FORECAST. Every number here is a count of things that happened to launches that already
-- happened: "of the 1,240 launches that opened with 15 or more buyers in their first second, 31% went on to
-- double". It stays true whether or not Insidor exists, which is the product rule. Nothing in this table is
-- a model's output about a coin; the only thing computed live is which group a coin belongs to, from facts
-- about its own opening.
--
-- ── public.launch_odds ─────────────────────────────────────────────────
--
-- One row a (signal time, group). `signal` is when the launch was looked at — its first second, its first
-- minute, its fifth minute — and every outcome is measured FROM THE PRICE AT THAT TIME, never from the launch
-- price, because that is the price a trader looking then would have paid. `band` 0 is every launch (the
-- normal rate shown beside a group's); bands 1.. are groups ordered by `score_from`, the lower edge of the
-- simple opening score the tool defines (its header says how the score is made, so a reader of a row can
-- recompute it). `launches` is how many sampled launches the row rests on; `held_up` says whether the group
-- told the same story on the launches after the tool's split date as on those before it — a group that did
-- not is still written, so the page can say "no different from a normal launch" rather than guess.
--
-- ── public.launch_odds_badge ───────────────────────────────────────────
--
-- One row a (fact, signal time, value range): what a single opening fact on its own said, and the colour
-- the data earned it. A badge is red where launches with that fact were rugged clearly more often than
-- normal (or went on to double clearly less often), green where they doubled clearly more often, amber
-- between. The cut-offs are the tool's, from the data; the page shows the comparison in the badge's words.
--
-- ── public.launch_first_second ─────────────────────────────────────────
--
-- The read service's window on internal.launch_open (0150): one coin's first second, three counts. The app
-- role reads public only (0001), so the view is how a token page reaches it. Counts, never wallets — the
-- table holds none.
--
-- What breaks if changed carelessly: the shares are 0..1 and weighted (graduates were sampled more heavily
-- than other launches, and each launch counts for its stratum's population); writing a raw count's share
-- here would overstate every runner rate by the oversampling. And `built_at`: the read service shows the
-- newest build only, so a partial rebuild must write all its rows in one transaction.

create table public.launch_odds (
  signal        text not null check (signal in ('second_1', 'minute_1', 'minute_5')),
  band          integer not null check (band >= 0),
  -- The group's opening score range, [score_from, score_to). Band 0 (every launch) has neither.
  score_from    double precision,
  score_to      double precision,
  launches      integer not null check (launches >= 0),
  hit_2x        double precision not null check (hit_2x between 0 and 1),
  hit_3x        double precision not null check (hit_3x between 0 and 1),
  hit_5x        double precision not null check (hit_5x between 0 and 1),
  hit_10x       double precision not null check (hit_10x between 0 and 1),
  rugged_1h     double precision not null check (rugged_1h between 0 and 1),
  never_moved   double precision not null check (never_moved between 0 and 1),
  -- Of the group's launches that doubled, half had reached the hour's peak within this many seconds of the
  -- signal time (weighted median). Null when too few doubled to say: never zero.
  half_peak_s   double precision check (half_peak_s is null or half_peak_s >= 0),
  -- The slow run: the share that first reached 2x of the signal time's price more than an hour later and
  -- within a day. NULL until the backfill's day reads have run: not measured, never zero.
  slow_2x       double precision check (slow_2x is null or slow_2x between 0 and 1),
  held_up       boolean not null,
  launched_from timestamptz not null,
  launched_to   timestamptz not null,
  built_at      timestamptz not null default now(),
  primary key (signal, band),
  constraint launch_odds_band_zero_is_all check ((band = 0) = (score_from is null))
);

create table public.launch_odds_badge (
  fact          text not null check (fact in ('first_second_buyers', 'first_second_buys', 'dev_buy', 'moved_since_launch', 'trades_so_far')),
  signal        text not null check (signal in ('second_1', 'minute_1', 'minute_5')),
  value_from    double precision not null,
  -- Exclusive; null is open-ended.
  value_to      double precision,
  tone          text not null check (tone in ('green', 'amber', 'red')),
  launches      integer not null check (launches >= 0),
  hit_2x        double precision not null check (hit_2x between 0 and 1),
  rugged_1h     double precision not null check (rugged_1h between 0 and 1),
  -- The fact's usual value over all launches (weighted median, the same on every row of a fact), and the
  -- weighted share of launches whose value is at least `value_from`: "Usual $20", "Top 5% of launches".
  usual_value    double precision,
  share_at_least double precision check (share_at_least is null or share_at_least between 0 and 1),
  built_at      timestamptz not null default now(),
  primary key (fact, signal, value_from)
);

create view public.launch_first_second as
select address, launched_at, buyers, buys, dev_buy_usd
  from internal.launch_open;

comment on table public.launch_odds is
  'What happened within the hour to past launches grouped by how they opened (0155, tools/odds-bands.ts): weighted shares that went on to 2x/3x/5x/10x from the signal time''s price, were rugged, or never moved. Band 0 is every launch. History only.';
comment on table public.launch_odds_badge is
  'One opening fact''s history and the colour the data earned it (0155, tools/odds-bands.ts).';
comment on view public.launch_first_second is
  'One coin''s first second of trading (internal.launch_open, 0150): buys, distinct buyers, the creator''s opening buy in dollars. Counts only.';

grant select on public.launch_odds to insidor_app;
grant select on public.launch_odds_badge to insidor_app;
grant select on public.launch_first_second to insidor_app;
