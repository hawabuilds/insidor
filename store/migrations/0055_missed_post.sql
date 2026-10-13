-- 0055_missed_post.sql
--
-- THE OWNER'S MISSED POSTS: links he pasted of posts we should have shown, each saved as a "yes"
-- example with the date, and a diagnosis of why we missed it.
--
-- ★ TWO WRITERS, ONE ROW EACH STEP. The social service (people role) takes the paste from the
-- owner, checked against Policy.owner, and inserts one `queued` row per link — nothing more, since
-- it holds no source keys. The runner (services/runner/src/work/missed-posts.ts) takes queued rows
-- within a minute, reads each post once on the learning book (`learn:` rows in internal.spend),
-- stores it in public.item if we did not hold it, and writes the diagnosis, the coins found and
-- `done` or `failed`. The app polls the list through the social service.
--
-- ★ WHAT THE RE-TUNE READS AS "YES" EXAMPLES: rows with `status = 'done'` (each has `item_id`).
-- The re-tune's gate "most of my missed posts pass" (Policy.learning.minMissedPass) is the share
-- of those items the judge passes. A `failed` row has no post behind it (not a post link, deleted,
-- a second paste of one post, no source or no money to read it) and is never an example. A post
-- is a "yes" once: the unique index below allows one `done` row per post, whoever pasted it.
--
-- ★ THE DIAGNOSIS IS ONE WORD WITH ITS FACTS BESIDE IT, IN THIS ORDER OF CLAIM:
--   never_found      the catch-all search never returned it (diagnosis_detail.why says why:
--                    not_in_search with the filter — language, repost, reply, hashtag — or
--                    under_floor, between_checks, or unexplained when the recall model says it
--                    would have been caught; `held` when we had it by another route)
--   not_judged       found, and the judge has not answered about it
--   rejected         found and judged, and the judge's answer kept it off (detail.judge is the
--                    latest internal.post_judgement: its answer, its name, when)
--   under_reach_bar  found and passed, but its views never cleared For You's or Popular's bar
--                    (detail.reach: the most views read and when)
--   shown_late       shown, but after the first coin of its name launched (detail: minutes)
--   shown            shown, and before any coin of its name: we did not miss it
--   unsure           found, passed and over the bar, yet never recorded as shown — we cannot tell
-- A `failed` row's diagnosis says why there is nothing to diagnose:
--   not_a_post, unreadable, duplicate, no_source, no_line
--
-- `coins` is every coin of the post's name launched after it (our own coin_name, then the free
-- market searches); `coin_address` only when exactly one was found, never a pick among several.
--
-- What breaks if changed carelessly: the diagnosis list is MISSED_DIAGNOSES and MISSED_FAILURES
-- in core/src/learning/missed.ts; services/runner/src/work/missed-posts.test.ts keeps them equal. A value
-- the runner writes and this CHECK refuses fails the row after its read was paid for.

create table internal.missed_post (
  id                bigint generated always as identity primary key,
  -- The link as pasted, trimmed. Parsed by the runner, which knows the sources' link shapes.
  url               text not null check (length(url) between 1 and 500),
  -- The sign-in id of the owner who pasted it.
  owner_ref         text not null check (length(owner_ref) > 0),
  added_at          timestamptz not null default now(),
  -- Set by the runner when the link is read: which source, and the post's id there.
  source            text,
  source_item_id    text,
  item_id           text references public.item (item_id) on delete set null,
  posted_at         timestamptz,
  status            text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  -- Reads tried; a read that failed for a reason that may pass (an outage) is tried again.
  attempts          integer not null default 0 check (attempts >= 0),
  last_error        text,
  diagnosis         text check (diagnosis in (
                      'never_found', 'not_judged', 'rejected', 'under_reach_bar', 'shown_late', 'shown', 'unsure',
                      'not_a_post', 'unreadable', 'duplicate', 'no_source', 'no_line')),
  diagnosis_detail  jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnosis_detail) = 'object'),
  coins             jsonb not null default '[]'::jsonb check (jsonb_typeof(coins) = 'array'),
  coin_address      text,
  -- The earliest launch among `coins`: what "shown late" is measured against.
  first_coin_at     timestamptz,
  -- What reading this post cost on the learning book; 0 when we already held it.
  usd               numeric(12, 8) not null default 0 check (usd >= 0),
  checked_at        timestamptz,
  unique (owner_ref, url),
  constraint queued_has_no_diagnosis check (status <> 'queued' or diagnosis is null),
  constraint done_is_diagnosed check (status <> 'done' or (diagnosis in (
    'never_found', 'not_judged', 'rejected', 'under_reach_bar', 'shown_late', 'shown', 'unsure') and item_id is not null)),
  constraint failed_says_why check (status <> 'failed' or diagnosis in ('not_a_post', 'unreadable', 'duplicate', 'no_source', 'no_line'))
);

create index missed_post_queue_idx on internal.missed_post (added_at) where status = 'queued';
create unique index missed_post_one_yes_idx on internal.missed_post (source, source_item_id) where status = 'done';

comment on table internal.missed_post is
  'Posts the owner pasted as missed: each a "yes" example once done, with why discovery, the judge or the reach bar missed it, and the coins of its name.';

-- The change to the search that would have caught most of them, when most were never found:
-- one row, rewritten by the runner after each batch. `text` is null when no change applies.
create table internal.missed_post_suggestion (
  id           smallint primary key default 1 check (id = 1),
  text         text,
  facts        jsonb not null default '{}'::jsonb,
  computed_at  timestamptz not null
);

comment on table internal.missed_post_suggestion is
  'The search change that would have caught most of the owner''s missed posts, with its cost a day; never applied by itself.';

-- The social service's role pastes and reads, and nothing else in this schema.
grant usage on schema internal to insidor_people;
grant select, insert on internal.missed_post to insidor_people;
grant usage, select on sequence internal.missed_post_id_seq to insidor_people;
grant select on internal.missed_post_suggestion to insidor_people;
