/**
 * The wide story feature set.
 *
 * The features that matter here are all shapes of BREADTH over time — how many
 * distinct authors, from how many distinct sources, arriving how fast, joined by how
 * much free evidence. Not volume: one account posting forty times is one person, and
 * a feature that counts it as forty is measuring persistence and calling it spread.
 *
 * The trap to avoid, and it is subtle: a story's features must be computable as of an
 * arbitrary past instant, because that is what a replay does. Anything derived from
 * "the story as it stands now" is lookahead wearing a convenience costume.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THE TRAP, MADE MECHANICAL, because "be careful" is not a design.
 *
 * `Story` is the CURRENT aggregate. Every one of these fields is a summary over ALL
 * members, including the ones that joined after `asOf`, and reading any of them here
 * would be lookahead that typechecks perfectly:
 *
 *     memberCount   distinctAuthors   distinctSources   lastMemberAt
 *     carriers      state             promotedAt        earliestPostAt
 *
 * `earliestPostAt` is the one that catches people, because a minimum feels safe. It
 * is not: a member that joins tomorrow can carry a post time from before every member
 * that exists today, so the story's earliest post MOVES BACKWARDS as it accretes. A
 * vector that reads it is a vector whose age term was computed from a post nobody had
 * seen yet, and it will look like a brilliant early-detection feature right up until
 * it is deployed.
 *
 * So this file destructures exactly two fields off `Story` — `storyId` and
 * `createdAt`, the two that are fixed at creation and cannot move — and recomputes
 * everything else from `members.filter(m => m.joinedAt <= asOf)`. The filter is the
 * first statement in the function for that reason: after it, there is no member in
 * scope that we were not allowed to see.
 *
 * ★ AND IT COUNTS DISTINCT THINGS, USING THE RULES THAT ALREADY EXIST.
 * `qualify/rules.ts` exports `distinctAuthors`, `distinctSources` and `freeJoinShare`
 * over a member list. They are reused rather than reimplemented, because a second
 * counting rule is a second definition of breadth, and the day the two disagree the
 * gate and the model will be fitted against different stories with the same name.
 */

import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { MatchEvidence, Story, StoryMember } from '@insidor/contracts/story.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { MS_PER_MINUTE, clamp01, safeRatio } from '../math.ts';
import { distinctAuthors, distinctSources, freeJoinShare } from '../qualify/rules.ts';

/**
 * Keyed on the SUBJECT and not on a stage — see `features/candidate.ts` for the argument.
 * A story vector is logged by QUALIFY today and by anything that scores a story later,
 * and one name over one shape is what keeps those from becoming two shapes over two.
 */
export const FEATURE_SET: FeatureSetId = 'story.wide.v1';

const PRESENT = 1;
const ABSENT = 0;

/** The largest share any single key holds. The concentration half of "breadth". */
function topShare(members: readonly StoryMember[], key: (m: StoryMember) => string): number | null {
  if (members.length === 0) return null;
  const counts = new Map<string, number>();
  let top = 0;
  for (const member of members) {
    const next = (counts.get(key(member)) ?? 0) + 1;
    counts.set(key(member), next);
    if (next > top) top = next;
  }
  return top / members.length;
}

/** The share of joins settled by one kind of evidence. The paid tier's own bill. */
function evidenceShare(
  members: readonly StoryMember[],
  kind: MatchEvidence['kind'],
): number | null {
  if (members.length === 0) return null;
  let hits = 0;
  for (const member of members) if (member.evidence.kind === kind) hits += 1;
  return hits / members.length;
}

/**
 * The wide story vector, computed strictly from members at or before asOf.
 *
 * ★ IT TAKES A POLICY, and the stub did not declare one. Two terms need a bar to be
 * relative to rather than absolute: the breadth saturation point (`authorBreadthFull`,
 * which QUALIFY already owns and which this reuses rather than declaring a second
 * one) and what "recently" means for the arrival-share terms. Both are judgements
 * about the product, both would otherwise be numbers typed into this file, and a
 * number typed into a feature builder is a number that silently redefines the feature
 * every time somebody edits it.
 *
 * @param asOf the instant the vector is computed AT. Not the clock, and not a
 *             default: a replay hands in an instant from six months ago and expects
 *             the same numbers the live run produced.
 */
export function storyFeatures(
  story: Story,
  members: readonly StoryMember[],
  asOf: Millis,
  p: Policy,
): FeatureVector {
  // ★ The first statement, on purpose. Nothing below is allowed to reach a member
  // that had not joined yet, and the only way to guarantee that is for no such member
  // to be in scope.
  const seen = members.filter((m) => m.joinedAt <= asOf);

  // ★ THE ONLY FIELD READ OFF THE AGGREGATE. `createdAt` is stamped once and cannot
  // move; `storyId` is the other safe one and is an identity rather than a feature.
  // Every other field on `Story` is a summary over members we may not have seen, and
  // the header lists them by name.
  const createdAt = story.createdAt;

  const authors = distinctAuthors(seen);
  const sources = distinctSources(seen);

  const joinTimes = seen.map((m) => m.joinedAt);
  const lastJoinedAt = joinTimes.length === 0 ? null : Math.max(...joinTimes);

  // Recomputed, never read off the aggregate — see the header. Null when not one
  // member we can see carried a post time, which is a real and common state and is
  // emphatically not "the story began at the epoch".
  const postTimes = seen.map((m) => m.postedAt).filter((t): t is Millis => t !== null);
  const earliestPostAt = postTimes.length === 0 ? null : Math.min(...postTimes);

  const accrualSpanMin = lastJoinedAt === null ? null : (lastJoinedAt - createdAt) / MS_PER_MINUTE;
  const recentFrom = asOf - p.features.recentWindowMin * MS_PER_MINUTE;
  const recentMembers = seen.filter((m) => m.joinedAt >= recentFrom);

  return {
    /* ── breadth, which is the product's actual claim ──────────────────── */
    memberCount: seen.length,
    distinctAuthors: authors,
    distinctSources: sources,
    /** Saturating, so a forty-author story and a twelve-author story are both "wide". */
    authorBreadth: clamp01(authors / p.qualify.authorBreadthFull),
    isCrossSource: sources > 1 ? PRESENT : ABSENT,
    authorsPerSource: safeRatio(authors, sources),

    /* ── and concentration, which is what tells breadth from persistence ─ */
    /**
     * ★ THE FEATURE THIS WHOLE FILE'S HEADER IS ABOUT. One account posting forty
     * times gives `memberCount: 40` and `topAuthorShare: 1` — a story that looks
     * enormous and is one person. `memberCount` alone cannot see the difference and
     * neither can `distinctAuthors` alone; the pair can.
     */
    topAuthorShare: topShare(seen, (m) => m.authorKey),
    topSourceShare: topShare(seen, (m) => m.source),
    membersPerAuthor: safeRatio(seen.length, authors),

    /* ── the evidence mix: how much of this story was free ─────────────── */
    freeJoinShare: freeJoinShare(seen),
    seedJoinShare: evidenceShare(seen, 'seed'),
    carrierJoinShare: evidenceShare(seen, 'carrier'),
    lineageJoinShare: evidenceShare(seen, 'lineage'),
    /** The paid tier's contribution, which is the number that decides its bill. */
    representationJoinShare: evidenceShare(seen, 'representation'),
    adjudicatedJoinShare: evidenceShare(seen, 'adjudicated'),

    /* ── time, measured from clocks that do not move ───────────────────── */
    /** Age since WE created the story. Always available; never moves backwards. */
    ageMin: (asOf - createdAt) / MS_PER_MINUTE,
    /**
     * Age since the earliest post we can see at `asOf`. Null when no visible member
     * carried a post time — an absence, and never a fallback to `createdAt`, because
     * that would silently report our own crawl latency as the story's age.
     */
    postAgeMin: earliestPostAt === null ? null : (asOf - earliestPostAt) / MS_PER_MINUTE,
    /** How late our reader was to the moment. Null for the same reason. */
    discoveryLagMin:
      earliestPostAt === null ? null : (createdAt - earliestPostAt) / MS_PER_MINUTE,
    /** The share of visible members whose source published a post time at all. */
    postTimeKnownShare: seen.length === 0 ? null : postTimes.length / seen.length,
    accrualSpanMin,
    /** How long since anything joined. A story nobody is copying any more. */
    sinceLastJoinMin: lastJoinedAt === null ? null : (asOf - lastJoinedAt) / MS_PER_MINUTE,

    /* ── arrival, as rates rather than totals ──────────────────────────── */
    /**
     * Members and authors per minute over the accrual span. Null — never a large
     * number — when the span is zero: every member of a story seeded this instant
     * arrived in no time at all, and dividing by that produces an infinity that then
     * wins every ranking it is fed into. `safeRatio` refuses on exactly that case.
     */
    joinRatePerMin: accrualSpanMin === null ? null : safeRatio(seen.length, accrualSpanMin),
    authorRatePerMin: accrualSpanMin === null ? null : safeRatio(authors, accrualSpanMin),
    /** How much of the story arrived inside the recent window. Bending, as a share. */
    recentJoinShare: seen.length === 0 ? null : recentMembers.length / seen.length,
    recentDistinctAuthors: distinctAuthors(recentMembers),
    recentAuthorShare: authors === 0 ? null : distinctAuthors(recentMembers) / authors,
  };
}
