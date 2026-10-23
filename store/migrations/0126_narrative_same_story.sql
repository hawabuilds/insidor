-- 0126_narrative_same_story.sql
--
-- A THIRD KIND OF MERGE: ONE STORY TOLD FROM TWO SIDES.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-23: the Chinese–Turkish meme war became four narratives on one morning ("Turkey
-- and China Meme War", "Cat Named Calajo", "Lele Starts China Twitter War", "Man Predicted 2026 Meme
-- War"), each in its own words and with its own coin names, so the same-subject rule (0108: the same
-- name) could never join them. What joins them is that their posts quote each other and quote the
-- same starting post. The regroup now merges such narratives (core group/narrative-origin.ts), and
-- that merge must be told apart from the owner's and from the same-name one: it is the one most
-- likely to need undoing while it is new, and it must be undoable without touching the others.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
-- internal.narrative.merged_by   gains 'same_story' (the regroup's quote merge). 'owner' and
--                                'same_subject' are unchanged.
--
-- No new column for the starting post: it is the narrative's earliest post (the early rows 0100
-- already mark the posts traced back), and the projector proves "Started by" from the stored quote
-- links (internal.post_reference) every frame, so a fact that can change is never frozen here.
--
-- What breaks if changed carelessly: the check is dropped and made again whole; a value left out of
-- this copy stops being writable, and the runner's save (store repo/narratives.ts) writes a quote
-- merge only once this check names 'same_story'.

alter table internal.narrative drop constraint narrative_merged_by_check;
alter table internal.narrative add constraint narrative_merged_by_check
  check (merged_by is null or merged_by in ('owner', 'same_subject', 'same_story'));

comment on column internal.narrative.merged_by is
  'Who merged it: the owner, the regroup''s same-subject rule (0108) or its same-story quote rule (0126); null before 0108 or when open.';
