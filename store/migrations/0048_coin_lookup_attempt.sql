-- 0048_coin_lookup_attempt.sql
--
-- WHEN EACH FEED SUBJECT FIRST WAITED FOR ITS COIN SEARCH, AND HOW MANY SEARCHES FOR IT FAILED.
--
-- 0035's internal.coin_lookup holds only finished searches, and a search both sources failed on
-- is deliberately not written there: "searched, nothing found" on the strength of an outage would
-- show "No coin yet" and a Create button on a name that may already be a coin. That left a post
-- whose search kept failing indistinguishable from one not reached yet, so its card said "still
-- checking" forever, and a failing name was retried every pass without end.
--
-- One row per narrative or post the lookup has seen in the feed without a finished search:
--
--   `queued_at`      the first pass that saw it waiting. The projector shows "Couldn't check"
--                    on a post with no finished search `universe.lookup.giveUpMs` after this —
--                    the moment it entered the feed as the lookup saw it, never the post's own
--                    age, so a post that reaches the feed late is not given up on arrival;
--   `attempts`       searches that failed on every source since the last one that finished. The
--                    lookup tries a name `1 + retries` times, then leaves it for `keepMs`;
--   `last_failed_at` what the per-minute and per-day caps count a failed search by.
--
-- A finished search writes coin_lookup as before and sets `attempts` back to zero, so a name
-- searched again after `keepMs` gets its retries afresh. A row with no failures is normal.
--
-- What breaks if changed carelessly: `queued_at` must never move once written. Updating it on
-- every pass would push "Couldn't check" back forever and the card would wait without end.
--
-- `internal`, no grant: which searches failed is our pipeline, not a fact about the world.

create table internal.coin_lookup_attempt (
  subject_kind    text not null check (subject_kind in ('story', 'post')),
  subject_id      text not null,
  queued_at       timestamptz not null,
  attempts        integer not null default 0 check (attempts >= 0),
  last_failed_at  timestamptz,
  -- The sources' own error text, bounded, for the logs and a person reading this table.
  last_error      text check (length(last_error) <= 500),
  primary key (subject_kind, subject_id)
);

create index coin_lookup_attempt_failed_idx on internal.coin_lookup_attempt (last_failed_at) where last_failed_at is not null;

comment on table internal.coin_lookup_attempt is
  'When each feed narrative or post first waited for its coin search and how many searches for it failed on every source. Drives retries and the "Couldn''t check" line.';
