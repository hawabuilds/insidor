-- The label census for ADMIT v1: the denominator of the training set.
--
-- WHY THIS FILE EXISTS SEPARATELY FROM train_admit_v1.sql. That query ends with
-- `l.status = 'resolved'`, and a WHERE clause cannot count what it removed. Every
-- row it drops — a pending window, a censored window, a decision with no label at
-- all — disappears without leaving a number behind, and the dataset that comes
-- out scores against a population nobody chose. This query runs over the SAME
-- decisions with NONE of those filters and reports each exclusion as a count, so
-- the manifest can state what fraction of the population the model actually saw.
--
-- ★ THE ONE IT EXISTS FOR IS `censored`. A censored label is a window we could
--   not watch — a gap in the mint stream, a deleted post, a stale counter. It is
--   excluded from training because it is not a measurement; it must never be
--   excluded silently, because a rising censoring rate is the earliest visible
--   sign the label pipeline is rotting, and the training query is the one place
--   guaranteed to look at every label and the one place guaranteed not to say so.
--
-- WHAT BREAKS IF THIS IS CHANGED CARELESSLY: the scoped/joined CTEs must stay
-- character-for-character aligned with train_admit_v1.sql's FROM and its first
-- four WHERE clauses. If they drift, the census describes a different population
-- from the dataset it is printed beside, and every rate in the manifest is a rate
-- over the wrong denominator — which is the exact failure the labels table's
-- `population` column was added to prevent. build_dataset.py asserts that the
-- buckets partition (`joined_rows` splits exactly into the status buckets, and
-- `label_resolved` splits exactly into the three exclusion buckets plus
-- `admitted_to_training`), so a drift that changes the arithmetic fails the run
-- rather than shifting a number.
--
-- Parameters, named rather than positional because %(window_end)s is needed
-- twice and a repeated positional parameter is a bug waiting for a reorder:
--   %(window_start)s   decisions decided at or after this
--   %(window_end)s     decisions decided before this
--   %(purge_cutoff)s   labels must have RESOLVED before this
--
-- Versioned with the query it describes. train_admit_v2.sql gets
-- census_admit_v2.sql; neither is edited in place.

with scoped as (
  -- Identical to train_admit_v1.sql's decision-side population.
  select d.id, d.decided_at, d.subject_kind, d.subject_id
    from internal.decisions d
   where d.stage        = 'admit'
     and d.shadow_of   is null
     and d.applied_at is not null
     and d.decided_at >= %(window_start)s
     and d.decided_at <  %(window_end)s
),
latest_label as (
  -- ★ CHARACTER-FOR-CHARACTER THE SAME CTE AS train_admit_v1.sql. If the two
  -- drift, the census describes a different population from the dataset printed
  -- beside it. Its reasoning is written out once, there.
  --
  -- The half that belongs here: this query is where pinning `label_version = 'v1'`
  -- did the most damage. The training query merely LOST a corrected row; the
  -- census COUNTED its superseded predecessor, so every correction the labeller
  -- appended pushed `censoredRate` up — toward the ceiling at which
  -- build_dataset.py refuses to build. The pipeline throttled itself with its own
  -- repairs, and the number that said so was the one gate nobody would doubt.
  select distinct on (subject_kind, subject_id, label_name, window_days) *
    from internal.labels
   where label_name = 'peak_multiple'
     and (label_version = 'v1' or label_version ~ '^v1\.r[1-9][0-9]*$')
   order by subject_kind, subject_id, label_name, window_days,
            case when label_version = 'v1' then 1
                 else (substring(label_version from '^v1\.r([0-9]+)$'))::integer
            end desc
),
joined as (
  -- LEFT join, so a decision with no label survives and can be counted. The
  -- training query's inner join is what makes those rows invisible.
  select s.id,
         s.decided_at,
         l.status,
         l.censor_reason,
         l.window_days,
         l.resolves_at,
         l.origin_ts,
         l.label_version
    from scoped s
    left join latest_label l
      on  l.subject_kind  = s.subject_kind
      and l.subject_id    = s.subject_id
)

  -- Decisions before the label join. Differs from joined_rows exactly when a
  -- subject carries the same label at more than one window_days, which fans out.
  select 'decisions_in_window'        as bucket, ''  as detail, count(*)::bigint as n from scoped
union all
  select 'joined_rows',                          '',            count(*)::bigint from joined
union all
  -- A decision the labeller has never opened a row for. Not a negative, not a
  -- censored observation — an absence, and it is reported as one.
  select 'label_absent',                         '',            count(*)::bigint from joined where status is null
union all
  select 'label_' || status,                     '',            count(*)::bigint from joined where status is not null group by status
union all
  select 'censor_reason',        coalesce(censor_reason, '(unstated)'), count(*)::bigint from joined where status = 'censored' group by 2
union all
  select 'label_window_days',    window_days::text,             count(*)::bigint from joined where status is not null group by 2
union all
  -- ★ HOW OFTEN OUR OWN EVIDENCE IMPROVED. A row above revision 1 is a window we
  -- could not measure once and could later — a backfilled coverage gap, a market
  -- series that arrived late. It is counted here for the same reason `censored`
  -- is: the correction machinery is invisible while it works and indistinguishable
  -- from a broken one while it does not, and this is the only number that tells
  -- them apart. It is NOT an exclusion and takes no part in the partitions below.
  select 'label_superseded',                     '',            count(*)::bigint from joined
   where label_version ~ '^v1\.r[1-9][0-9]*$'
union all
  -- The three exclusions applied to resolved rows, nested so they partition:
  -- each counts only rows that survived the one above it.
  select 'excluded_window_still_open',           '',            count(*)::bigint from joined
   where status = 'resolved' and not (resolves_at < %(purge_cutoff)s)
union all
  select 'excluded_anticircular',                '',            count(*)::bigint from joined
   where status = 'resolved' and resolves_at < %(purge_cutoff)s and not (origin_ts >= decided_at)
union all
  select 'admitted_to_training',                 '',            count(*)::bigint from joined
   where status = 'resolved' and resolves_at < %(purge_cutoff)s and origin_ts >= decided_at
