-- 0098_owner_seen.sql
--
-- THE POSTS THE OWNER HAD ON HIS SCREEN, AND THE ONES HE OPENED.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-18: "anything I leave on For You without tapping Not a meme counts as good. ...
-- a post that was on my screen for at least 2 seconds, or that I opened, and that I didn't tap Not a
-- meme on within 24 hours. ... Doesn't count: posts I never scrolled to." He taps "Not a meme" and
-- almost never "meme", so until now an untapped post was indistinguishable from one the owner never saw.
-- The phone app (the owner's wallet only) records a For You or narrative-page card at least half
-- visible for two seconds, and every post sheet the owner opens, and sends them in batches to the social
-- service's owner-only route (services/social owner-seen.ts), which writes here as insidor_people.
-- The "seen and kept" soft label is derived from these rows and internal.owner_feedback at read
-- time (store owner-seen.ts `seenKept`), never stored: a later "Not a meme" changes it, and the
-- owner's explicit calls always win.
--
-- ── ONE ROW PER POST, THE FIRST TIME ONLY ────────────────────────────────
--
-- Keyed by (owner_ref, item_id). The route upserts with `least()`, so each time column only ever
-- moves EARLIER: the first time the card was on screen, the first time the sheet was opened. A post
-- the owner scrolls past twenty times is one row, and the 24-hour window is counted from the first sight,
-- so seeing it again cannot reset the clock on a "Not a meme" that came late. `first_surface` is
-- where the first sight was (fyp, narrative, sheet), for the record.
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
--
-- Not a log of everyone's scrolling: only the owner's sign-in reaches the route (owner.ts
-- `ownerRefOf`, the same check as every owner call), and `owner_ref` says whose sight it was. No
-- score or label is written or shown from here.
--
-- What breaks if changed carelessly: an update path that sets a time LATER (a plain `= excluded`)
-- would restart the 24-hour window on every scroll and turn every late "Not a meme" into a keep.
-- `internal`, no app grant: the people role writes it, the tools and the re-tune read it.

create table internal.owner_seen (
  owner_ref                text not null check (owner_ref ~ '^(wallet|x):.+'),
  item_id                  text not null check (length(item_id) between 1 and 200),
  first_seen_on_screen_at  timestamptz,
  opened_at                timestamptz,
  first_surface            text not null check (first_surface in ('fyp', 'narrative', 'sheet')),
  updated_at               timestamptz not null default now(),
  primary key (owner_ref, item_id),
  check (first_seen_on_screen_at is not null or opened_at is not null)
);

create index owner_seen_first_idx on internal.owner_seen (least(first_seen_on_screen_at, opened_at));

comment on table internal.owner_seen is
  'The owner''s own screen: posts the owner had on screen for 2 s or more (first time) and posts the owner opened (first time), one row per post; the source of the "seen and kept" soft yes label.';

grant usage on schema internal to insidor_people;
grant select, insert, update on internal.owner_seen to insidor_people;
