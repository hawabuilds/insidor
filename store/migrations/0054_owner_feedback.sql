-- 0054_owner_feedback.sql
--
-- THE OWNER'S OWN CALLS, FROM THE PHONE: "Not a meme", "Is a meme", "Right coin", "Wrong coin",
-- "No coin is from this", and thumbs on a suggested name — each saved with the item, the date and,
-- when given, a few words of why. Written by services/social (as `insidor_people`) only after the
-- sign-in's wallet or X handle is checked against `owner` in contracts/src/policy.ts.
--
-- ★ APPEND-ONLY; THE NEWEST ROW IS THE CURRENT CALL. Changing your mind is a new row, never an
-- edit, so the re-tune can see that a post was hidden on Monday and brought back on Tuesday. The
-- current call is the latest row per (subject_kind, item_id) — and per name too, for names:
--
--   select distinct on (subject_kind, item_id, coalesce(name, ''))  *
--     from internal.owner_feedback order by subject_kind, item_id, coalesce(name, ''), created_at desc, id desc
--
-- ★ WHO READS WHAT (the twice-daily re-tune, and the projector):
--   post        'meme' | 'not'          → the judge's learned examples (tools/judge-examples.ts).
--                                         The projector also obeys it at once: 'not' hides the
--                                         post from For You, Popular, every narrative's post list
--                                         (and so the narrative itself if too few posts are left),
--                                         and search, which reads those lists; 'meme' passes the
--                                         post whatever the judge said. The reach bars still apply.
--   coin_match  'right' | 'wrong' | 'none'  → the coin-matching rules. `coin_address` is the coin
--                                         the owner says IS this item's ('right': the one shown;
--                                         'wrong': the one picked from the list, or null when not
--                                         picked); 'none' says no coin is from it. Nothing on
--                                         screen changes from this row: it is a label, not a link.
--   name        'up' | 'down'           → name suggestions. `name`/`ticker` are the suggestion
--                                         judged; `better_name` the owner's own, when typed.
--
-- `shown` is what was on the owner's screen when the call was made — the card's text, author,
-- link and picture for a post, the coin line for a match. It lets the owner's "Hidden by me" list
-- draw a post that no longer reaches any feed, and tells the re-tune what the call was about. It
-- is the owner's own client's account of a card the services projected, and is used for nothing
-- but display and context.
--
-- `internal`, because a call about what is a meme is the system's own training data and must never
-- reach the app role (which has no usage on this schema). The people role gets usage on the schema
-- and INSERT and SELECT on this one table — no UPDATE, no DELETE, and the trigger forbids both
-- anyway. The projector reads it as the service role, which already reads `internal`.
--
-- No foreign key to public.item: a post ages out of the projection long before a label about it
-- stops being worth learning from.
--
-- What breaks if changed carelessly: the trigger. Without it a "fix" that updates a row in place
-- would erase the history the re-tune learns from, and a hidden post would forget why.

create table internal.owner_feedback (
  id            bigint generated always as identity primary key,
  owner_ref     text not null check (owner_ref ~ '^(wallet|x):.+'),
  user_id       text not null check (length(user_id) > 0),
  subject_kind  text not null check (subject_kind in ('post', 'coin_match', 'name')),
  item_id       text not null check (length(item_id) between 1 and 200),
  verdict       text not null,
  coin_address  text check (coin_address is null or coin_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  name          text check (name is null or length(name) between 1 and 80),
  ticker        text check (ticker is null or length(ticker) between 1 and 20),
  better_name   text check (better_name is null or length(better_name) between 1 and 80),
  note          text check (note is null or length(note) between 1 and 200),
  shown         jsonb check (shown is null or jsonb_typeof(shown) = 'object'),
  created_at    timestamptz not null default now(),
  check (
    (subject_kind = 'post' and verdict in ('meme', 'not') and coin_address is null and name is null)
    or (subject_kind = 'coin_match' and verdict in ('right', 'wrong', 'none') and (verdict <> 'none' or coin_address is null))
    or (subject_kind = 'name' and verdict in ('up', 'down') and name is not null)
  )
);

create index owner_feedback_current_idx on internal.owner_feedback (subject_kind, item_id, created_at desc);

create trigger owner_feedback_append_only
  before update or delete on internal.owner_feedback
  for each row execute function internal.forbid_mutation();

grant usage on schema internal to insidor_people;
grant select, insert on internal.owner_feedback to insidor_people;

comment on table internal.owner_feedback is
  'The owner''s calls from the phone (post meme/not, coin match right/wrong/none, name up/down), append-only; the newest row per item (and name) is the current call.';

/* A post the owner hid leaves the feeds with its own reason, so the re-tune can tell the owner's
   "no" from the judge's. The constraint is replaced, never loosened: every old reason stays. */
alter table public.feed_rejection drop constraint feed_rejection_reason_check;
alter table public.feed_rejection add constraint feed_rejection_reason_check check (reason in (
  'not_scored', 'not_memeable', 'judge_unsure', 'name_test',
  'under_reach_bar', 'reach_unread', 'too_few_passing_posts', 'owner_not_meme'));
