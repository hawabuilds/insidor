-- 0012 — OUR OWN STANDING FOR AN ACCOUNT GETS SOMEWHERE TO LIVE, AND IT IS NOT public.
--
-- `AuthorRepo.setRosterTier` has been in contracts/src/ports/store.ts since 0002 and
-- there has never been anywhere for it to write. That is not a missing feature, it is
-- a port method that cannot be implemented — and the field it feeds,
-- `Author.rosterTier`, is multiplied by `admit.weights.authorRosterTier = 0.3`, the
-- largest single weight in the admission score. Until this table exists every
-- admission is scored with that term absent.
--
-- ★ WHY A SEPARATE INTERNAL TABLE AND NOT A COLUMN ON public.author.
--
-- The obvious spelling is `alter table public.author add column roster_tier`. It is
-- one line, it is next to `follower_count` where it reads naturally, and it would
-- quietly undo the product's central claim. 0002 line 148 says:
--
--     grant select on public.author, public.item, public.item_fingerprint to insidor_app;
--
-- The grant is on the TABLE, not on a column list, so a new column on that table is a
-- new column the browser's credential can read. `roster_tier` is a score we computed —
-- exactly the kind of number the whole schema split exists to keep off a screen. The
-- app cannot NAME a score because of the wire types, and it must also be unable to
-- REACH one; a column here would leave the first guarantee standing and silently
-- retire the second.
--
-- So it goes in `internal`, which the app role has no USAGE on. Postgres answers
-- `permission denied for schema internal` rather than returning a number, and that
-- answer does not depend on anybody remembering why.
--
-- WHY OURS AND NEVER THEIRS: every source publishes some prominence signal and every
-- one of them is the source's to game and the account's to buy. This one is computed
-- by core/src/admit/prior.ts from outcomes we observed — did their items reach
-- stories, did those stories go anywhere — which is expensive to manufacture, because
-- manufacturing it means actually producing things other people copy.

create table internal.author_roster (
  author_key text primary key references public.author(author_key),

  -- In [0,1]. The contract is on the consuming field (contracts/src/vocabulary.ts):
  -- "Our own standing for this account, in [0,1], computed by core from history."
  -- `admit/stage.ts` wraps it in clamp01, so a value outside the range would be
  -- silently truncated there rather than caught; it is caught here instead.
  tier double precision not null check (tier >= 0 and tier <= 1),

  -- ★ WHEN, so that a stale roster is visible as staleness rather than as a confident
  -- number. prior.ts: "a roster that never forgets slowly becomes a list of who was
  -- early to the last regime." A tier from six months ago is a claim about a
  -- population that no longer exists, and without this column nothing says which it is.
  computed_at timestamptz not null default now(),

  -- How much history the tier was computed from, so a shrunk-to-the-mean tier is
  -- distinguishable from an earned one. Two accounts can hold 0.5 because one was
  -- measured at 0.5 and the other has no history at all; they are not the same claim.
  observed_items integer not null default 0 check (observed_items >= 0)
);

comment on table internal.author_roster is
  'Our own standing per account, in [0,1], recomputed offline from outcomes we observed. '
  'In internal because it is a score: the app role has no USAGE here and never will.';

-- The nightly recompute walks oldest-first, so this is the order it reads in.
create index author_roster_stale_idx on internal.author_roster (computed_at asc);

-- ABSENCE IS THE DAY-ONE STATE AND IT IS NOT A ZERO. An account with no row here has
-- never been computed; a row holding 0 would say we computed one and it was the worst
-- possible. `Author.rosterTier` is `number | null` for exactly this reason and the
-- feature vector keeps the null, so the two stay distinguishable into the log.
--
-- No grant. Deliberately, and see the header: this is the column the app must not be
-- able to reach, and the way it cannot reach it is that nothing here says it may.
