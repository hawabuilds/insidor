-- 0108_narrative_same_subject.sql
--
-- WHO MERGED A NARRATIVE, AND THE OWNER'S "SPLIT".
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: "the same narrative posted several times" — Neo the raccoon three times,
-- Comet the deer three times, each a narrative of its own, because since 0106 a narrative is
-- permanent and two narratives already made never join. Now a newer narrative that is clearly the
-- same subject as an older one (core group/narrative-same.ts: the same name AND close in meaning)
-- is merged into it by the regroup. Until now only the owner merged, so a merged row said nothing
-- about who did it; an automatic merge must be told apart from his, for the record and so it can
-- be undone without touching his.
--
-- And he asked for "Split a narrative" (France protests and cat memes in one): he picks posts on
-- the narrative page and they become a new narrative, recorded as his call so the regroup keeps it.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- internal.narrative.merged_by   'owner' (his "Merge with…") or 'same_subject' (the regroup's
--                                same-subject merge); null on a narrative merged before 0108 (the
--                                owner's, or the old regroup's folds of 16-18 Oct — not knowable now)
-- owner_feedback 'split'         a narrative call: `members` the posts he moved out, `other_id` the
--                                new narrative they became
--
-- What breaks if changed carelessly: the check. owner_feedback_check is the one constraint saying
-- which calls are well formed; it is dropped and made again whole, so a verdict left out of this
-- copy stops being writable.

alter table internal.narrative add column merged_by text check (merged_by is null or merged_by in ('owner', 'same_subject'));
comment on column internal.narrative.merged_by is
  'Who merged it: the owner, or the regroup''s same-subject rule (0108); null before 0108 or when open.';

alter table internal.owner_feedback drop constraint owner_feedback_check;
alter table internal.owner_feedback add constraint owner_feedback_check check (
  (subject_kind = 'post' and verdict in ('meme', 'not') and coin_address is null and name is null)
  or (subject_kind = 'coin_match' and verdict in ('right', 'wrong', 'none', 'cleared') and (verdict not in ('none', 'cleared') or coin_address is null))
  or (subject_kind = 'name' and verdict in ('up', 'down') and name is not null)
  or (subject_kind = 'narrative' and name is null and (
        (verdict = 'not_narrative' and coin_address is null)
     or (verdict = 'merge' and other_id is not null and coin_address is null)
     or (verdict = 'remove_post' and other_id is not null and coin_address is null)
     or (verdict = 'split' and other_id is not null and coin_address is null and coalesce(cardinality(members), 0) >= 1)
     or (verdict in ('right', 'wrong') and coin_address is not null)
     or (verdict = 'cleared' and coin_address is null)))
);
