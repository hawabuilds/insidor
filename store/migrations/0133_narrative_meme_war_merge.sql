-- 0133_narrative_meme_war_merge.sql
--
-- A FOURTH KIND OF MERGE: A NARRATIVE THAT IS WHOLLY A MEME WAR'S POSTS FOLDS INTO THAT WAR.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-24: "it's not catching any of the viral posts under the narrative that have
-- hundreds of thousands and even 1M+ views". A viral post of a live meme war (a French post mocking
-- the Japanese, a Chinese one naming Turkey) that the regroup had already put in a narrative of its
-- own, or in a small one of posts all of the same war, could never reach the war: the meme-war rule
-- took only posts in no narrative, and a post is in one narrative at most (0093's
-- narrative_member_item_uq). The runner's meme-war catch-up (core group/fight-native.ts, policy.v162)
-- now merges such a narrative into the war, as the owner's "Merge with…" would — every post moves,
-- the merged one stays pointing at the war, so its link still opens (0106 public.story_alias). That
-- merge must be told apart from the others: it is the newest rule, the one most likely to need
-- undoing while it is new, and it must be undoable without touching the owner's or the regroup's.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────
--
-- internal.narrative.merged_by   gains 'meme_war' (the catch-up's fold). 'owner', 'same_subject'
--                                and 'same_story' are unchanged.
--
-- Nothing else: a single post that leaves a small mixed narrative for a war moves its own
-- narrative_member row, as the owner's "Add a post" does (0130), and needs no mark.
--
-- What breaks if changed carelessly: the check is dropped and made again whole; a value left out of
-- this copy stops being writable, and the runner's save (store repo/narratives.ts) writes a meme-war
-- fold only once this check names 'meme_war'.

alter table internal.narrative drop constraint narrative_merged_by_check;
alter table internal.narrative add constraint narrative_merged_by_check
  check (merged_by is null or merged_by in ('owner', 'same_subject', 'same_story', 'meme_war'));

comment on column internal.narrative.merged_by is
  'Who merged it: the owner, the regroup''s same-subject rule (0108), its same-story quote rule (0126) or the meme-war catch-up (0133); null before 0108 or when open.';
