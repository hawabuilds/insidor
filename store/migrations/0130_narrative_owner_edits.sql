-- 0130_narrative_owner_edits.sql
--
-- THE OWNER NAMES A NARRATIVE HIMSELF, AND ADDS A POST TO IT; AND WHICH NARRATIVES ARE A MEME WAR
-- BETWEEN COUNTRIES.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-23: the country meme wars on X (China vs Turkey, France vs Japan) want one name
-- he chooses, and the cheap titler re-titles a narrative every time it grows by half, so a name he
-- typed would last one pass. His name must be the one the board, the page, the posts' tags and the
-- pushes say, and the titler must never write over it. And a post that belongs in one (a quote-tweet
-- of the war in another language, a TikTok of it) is often never grouped there: he pastes its link.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────
--
-- owner_feedback 'rename'   a narrative call: `name` the title he typed (1 to 80 characters).
--                           Append-only like every call, so the re-tune can read what he renamed
--                           and from what.
-- internal.narrative        the title itself, written by services/social when he saves it with
--                           `title_model = 'owner'`. That value is the mark: the runner's titler
--                           (store repo/narratives.ts `setTitle`) writes only where it is not
--                           'owner', so no pass can overwrite his title, however much it grows.
--                           The people role is given UPDATE on those three columns only (and
--                           `title_posts`, so the count the title was written for stays true).
-- owner_feedback 'add_post' a narrative call: `other_id` the post he added, `members` the narrative's
--                           posts then (read by the server, as every narrative call). The runner moves
--                           the post into the narrative (core group/narrative-keep.ts `ownerAdds`) once
--                           it is stored — a link to a post we do not hold is queued as a missed post
--                           (0055) and read within a minute — and the pins keep it there. Only his own
--                           later "Remove this post" or "Split" of it takes it out.
-- internal.narrative.fight  the countries whose users are trading memes and insults with each other
--                           in it (policy.v155 Policy.narrative.fight), as the titler answered in the
--                           same call as its title: two or more names, alphabetical; an empty array
--                           when it said no; null when it was never asked (the runner asks those,
--                           a few a pass). `fight_model` is the model that answered, `fight_at` when.
--                           Kept apart from the title so an owner's title never stops it being asked.
-- owner_feedback 'fight'    the owner's own answer ("Twitter World War" on the Edit sheet): `name`
--                           the countries ("China, Turkey"), or null for "not a meme war". Written
--                           onto `fight` by services/social with `fight_model = 'owner'`, which the
--                           runner never writes over (store repo/narratives.ts `setFight`), as the title.
--
-- What breaks if changed carelessly: the owner_feedback check is dropped and made again whole (as
-- 0108 did); a verdict left out of this copy stops being writable. And the column grant: widening it
-- to the whole row would let the people role move posts, which only the runner does.

alter table internal.owner_feedback drop constraint owner_feedback_check;
alter table internal.owner_feedback add constraint owner_feedback_check check (
  (subject_kind = 'post' and verdict in ('meme', 'not') and coin_address is null and name is null)
  or (subject_kind = 'coin_match' and verdict in ('right', 'wrong', 'none', 'cleared') and (verdict not in ('none', 'cleared') or coin_address is null))
  or (subject_kind = 'name' and verdict in ('up', 'down') and name is not null)
  or (subject_kind = 'narrative' and verdict = 'rename' and name is not null and coin_address is null)
  or (subject_kind = 'narrative' and verdict = 'fight' and coin_address is null)
  or (subject_kind = 'narrative' and name is null and (
        (verdict = 'not_narrative' and coin_address is null)
     or (verdict = 'merge' and other_id is not null and coin_address is null)
     or (verdict = 'remove_post' and other_id is not null and coin_address is null)
     or (verdict = 'add_post' and other_id is not null and coin_address is null)
     or (verdict = 'split' and other_id is not null and coin_address is null and coalesce(cardinality(members), 0) >= 1)
     or (verdict in ('right', 'wrong') and coin_address is not null)
     or (verdict = 'cleared' and coin_address is null)))
);

grant update (title, title_posts, title_model, titled_at) on internal.narrative to insidor_people;

alter table internal.narrative add column fight text[] check (fight is null or cardinality(fight) = 0 or cardinality(fight) >= 2);
alter table internal.narrative add column fight_model text;
alter table internal.narrative add column fight_at timestamptz;
grant update (fight, fight_model, fight_at) on internal.narrative to insidor_people;
comment on column internal.narrative.fight is
  'The countries whose users trade memes in it (an online meme war, 0130), alphabetical; empty: asked, not one; null: never asked.';

comment on column internal.narrative.title_model is
  'The model that wrote the title, or ''owner'' when the owner typed it (0130): the titler never writes over an owner title.';
