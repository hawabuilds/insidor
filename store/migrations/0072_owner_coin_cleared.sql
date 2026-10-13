-- 0072_owner_coin_cleared.sql
--
-- THE OWNER CAN TAKE BACK A COIN LABEL: "Remove my label" on a post saves a coin call `cleared`.
--
-- internal.owner_feedback (0054) is append-only, and the newest row per (subject_kind, item_id) is
-- the call. Until now a coin call could only be replaced by another call — right, wrong or none —
-- so a mistaken "This is the coin" could be overwritten but never removed. `cleared` is that
-- removal: a new row, dated, that says "no call" from here on. The rows before it stay, so the
-- re-tune can still see that the owner once said something and then took it back.
--
-- Every reader treats a current `cleared` exactly as no row at all:
--   services/project owner-calls.ts     no owner coin on the post: the evidence decides again
--   store repo learning.ts matchCalls   left out of the re-tune's matching lessons and hand gold
--   tools/lib/coin-match-fit.ts         neither a right label nor a "none", so not a test case
--   store repo label-embeddings.ts      only `right` is read
--   services/social owner.ts            the app shows no "You said…" tag
--
-- What breaks if changed carelessly: the constraint is replaced whole, never loosened; every old
-- verdict stays allowed, so no stored row fails it. `cleared`, like `none`, names no coin: a
-- cleared row with an address would read as a call about that coin to anything that forgot to
-- check the verdict.

alter table internal.owner_feedback drop constraint owner_feedback_check;
alter table internal.owner_feedback add constraint owner_feedback_check check (
  (subject_kind = 'post' and verdict in ('meme', 'not') and coin_address is null and name is null)
  or (subject_kind = 'coin_match' and verdict in ('right', 'wrong', 'none', 'cleared') and (verdict not in ('none', 'cleared') or coin_address is null))
  or (subject_kind = 'name' and verdict in ('up', 'down') and name is not null)
);

comment on table internal.owner_feedback is
  'The owner''s calls from the phone (post meme/not, coin match right/wrong/none/cleared, name up/down), append-only; the newest row per item (and name) is the current call, and a newest `cleared` coin call is no call.';
