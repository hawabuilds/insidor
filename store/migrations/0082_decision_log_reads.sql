-- 0082_decision_log_reads.sql
--
-- THE THREE INDEXES THAT STOP THE RUNNER READING THE WHOLE DECISION LOG OFF DISK EVERY PASS,
-- and the one that stops the projector reading every coin to find one by its address.
--
-- ── THE FAILURE, AS MEASURED ON 2026-10-15 ───────────────────────────────
--
-- From about 04:09 UTC the projector failed almost every run with "canceling statement due to
-- statement timeout", and For You and Popular stopped moving. None of its own statements had
-- changed. The database had run out of disk: a single page read was taking about 10 ms
-- (a 535-page index scan of public.asset took 5.2 s), so every statement that touched anything
-- not already in memory was slow, and the projector's longest ones (the latest market reading
-- per coin, 35 s; the picture neighbours, 30 s; a post's reach readings, 27 s) went past its 30 s
-- limit. One read-only run of the whole projection took 207 s.
--
-- What was eating the disk was the runner reading internal.decisions, which grows by about
-- 800 MB a day against 256 MB of shared buffers. Sampling pg_stat_activity once a second for
-- 40 s, ADMIT's score quantile was running in 35 of the 40 samples and the latest-decision
-- lookup in 15. Both found their rows through (stage, decided_at) or (subject_kind,
-- subject_id) and then fetched every matching row from the table one random page at a time:
--
--   scoreQuantile    ~19,000 admit rows a day, each on its own page, to read one number
--   countSince       the same rows again, for today's admission count
--   latestForSubjects / decidedSubjects   filter on stage and subject_id with no subject_kind,
--                    so the (subject_kind, subject_id) index is walked end to end on every
--                    partition and every stage's rows for the subject are fetched, then dropped
--
-- ── THE DECISION ─────────────────────────────────────────────────────────
--
-- decisions_live_score_idx answers the quantile and the count from the index alone: the
-- columns they filter and read (verdict, score) are carried in it, and `shadow_of is null` is
-- its predicate because both queries say exactly that. A challenger's rows are never read.
--
-- decisions_stage_subject_idx leads with stage and then subject_id, which is the shape both
-- subject lookups ask in. decisions_subject_idx stays for the label joins, which ask by kind.
--
-- asset_address_idx: public.asset's unique key is (chain, address), and four projector reads
-- (story-coins.ts, coin-list.ts, post-match.ts and loadCoinFactsByAddress in db.ts) ask by
-- address alone, so each walked the whole key. There is one chain today, so this is the same set of rows.
--
-- ── WHAT BREAKS IF THIS IS APPLIED CARELESSLY ────────────────────────────
--
-- An index on a partitioned table cannot be built CONCURRENTLY, and a migration runs in one
-- transaction. Built here, it holds a SHARE lock on each decisions partition while it reads
-- it, and the runner's inserts wait (and time out after 60 s) for that long. On a starved disk
-- that is minutes. The way round it is to build each partition's index CONCURRENTLY first,
-- outside a transaction, with exactly these definitions; `create index` on the parent then
-- finds the matching index on every partition, attaches it, and builds nothing.
--
-- The partitions created after this (internal.ensure_decision_partition) get both indexes from
-- the parent automatically. Code does not depend on any of these: before they exist every read
-- returns the same rows, slowly.

create index if not exists decisions_live_score_idx
  on internal.decisions (stage, decided_at) include (verdict, score)
  where shadow_of is null;

create index if not exists decisions_stage_subject_idx
  on internal.decisions (stage, subject_id, decided_at desc);

create index if not exists asset_address_idx
  on public.asset (address);
