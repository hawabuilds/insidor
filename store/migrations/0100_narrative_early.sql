-- 0100_narrative_early.sql
--
-- WHICH OF A NARRATIVE'S POSTS THE REGROUP DID NOT MAKE: the early posts, matched back in.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: "when a narrative forms or grows, check all stored posts from up to 7
-- days back that match it and add them, so the earliest one is included." The regroup sees two
-- days of posts, newest first, at most 1,500 (Policy.narrative), and a story's first posts fall off
-- it as it ages: the Tesla Roadster narrative's own first post was stored and no longer in it. The
-- runner now matches the posts the regroup could not see back into the narratives it made (core
-- group/narrative-early.ts) and lists them with the narrative.
--
-- ── WHY A COLUMN AND NOT A SECOND TABLE ──────────────────────────────────
--
-- An early post is one of the narrative's posts like any other to every reader (the projector, the
-- narrative-name search, the story coins): they read internal.narrative_member and must keep
-- reading one table. Only the runner needs to tell them apart, and it must: the regroup keeps a
-- narrative's id by the posts it shares with the last pass, and compares its posts with the last
-- pass's to say whether they changed. Counted there, every early post would be a post the regroup
-- "lost" every pass, and the narrative's posts would read as changed each time — which, under the
-- owner's "Not a narrative", would undo his call two minutes after he made it.
--
-- What breaks if changed carelessly: the default. A row written by a runner that does not know this
-- column is a grouped post, which is what every row before this migration was.

alter table internal.narrative_member add column early boolean not null default false;

comment on column internal.narrative_member.early is
  'True: a stored post the regroup could not see (older than its window or over its cap), matched back in by the runner (core group/narrative-early.ts). Never used to keep ids or to say the posts changed.';
