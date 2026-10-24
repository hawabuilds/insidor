-- 0135_narrative_listed.sql
--
-- ONCE LISTED, LISTED: the record that a narrative's page was written, so a later rule cannot take it.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-24: "why's the oldest narrative 1 day? Never remove narratives, bring them
-- back." The projector (services/project narrative-frame.ts) held every narrative it re-projected
-- to the listing rules of THAT frame and deleted the page of any that failed. When the viral floor
-- arrived (2026-10-23 ~13:37 UTC, Policy.narrative.origin.viralFloor: a narrative is listed only on a post over For
-- You's views bar), every older narrative built on small posts failed it on its next turn in the page
-- queue and its page was deleted: on 24 Oct 18:40 UTC, 1,309 narratives were open and shown and 248
-- had a page; 942 of the 1,061 without one failed only the floor, 48 the two-accounts rule of 18 Oct,
-- 63 the post count (a post judged an ad since). The posts' readings were all still there — the
-- slimming job keeps every narrative's posts — so it was the rule, re-asked, not lost data.
--
-- Nothing recorded which narratives had been listed: public.story_view was the only trace and it was
-- what got deleted. internal.narrative.shown is the runner's flag, set before the projector's own
-- rules (the floor among them), so it cannot say "listed" either.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- internal.narrative.listed_at   when the projector first wrote its page (set by narrative-frame.ts,
--                                coalesced, never cleared by code). A narrative with it is held only
--                                to the owner's own calls; one without it must clear every listing
--                                rule first, as before. Merges, his "Not a narrative" and his
--                                "Not a meme" leaving no post still take a page away.
--
-- ── THE SEED: WHICH OF TODAY'S NARRATIVES WERE LISTED ────────────────────
--
-- No record survives, so the seed is the honest proxy, and its time is the runner's first_shown_at
-- (the earliest it could have been listed), never invented:
--   * every open narrative with a page now — it is listed;
--   * every open, shown narrative the runner first showed before 2026-10-23 13:37:30 UTC, the
--     commit of the viral floor: before it, the projector listed what the runner showed (two posts,
--     two accounts after 18 Oct). Narratives shown after it that never cleared the floor were never
--     listed and stay unlisted until a viral post joins them. One shown between that commit and its
--     deploy, listed for a few minutes and then dropped, is not seeded: no trace says which.
-- The owner's hides and merges are not exempted here because the projector applies them every frame
-- whatever this column says: a hidden one's page still goes, a merged one is not open.
--
-- To take the seeded ones back off (the owner's call), clear listed_at on them: the projector then
-- holds them to the rules again and deletes the pages that fail.
--
-- What breaks if changed carelessly: code that clears listed_at, or sets it for a page not written.
-- The first makes any rule change delete pages again; the second lists a narrative that never
-- cleared the rules. The cutoff below is data about one past day, not a rule: never move it to code.

alter table internal.narrative add column listed_at timestamptz;
comment on column internal.narrative.listed_at is
  'When the projector first wrote its page (0135 seeded older ones with first_shown_at). Set: held only to the owner''s calls, never to a later rule.';

update internal.narrative n
   set listed_at = n.first_shown_at
 where n.state = 'open'
   and n.first_shown_at is not null
   and (exists (select 1 from public.story_view v where v.story_id = n.narrative_id)
        or (n.shown and n.first_shown_at < timestamptz '2026-10-23 13:37:30+00'));

update internal.narrative n
   set listed_at = coalesce(n.first_shown_at, v.projected_at)
  from public.story_view v
 where v.story_id = n.narrative_id and n.state = 'open' and n.listed_at is null;
