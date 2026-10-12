/**
 * What a GROUP decision owes the store: a member row, a newly seeded story, and the
 * promotion that follows from either.
 *
 * Split from stage.ts because stage.ts decides and logs, and this turns a decision that has
 * already been logged into the rows it promises. Both are pure; the runner does the writes.
 * Keeping the shapes here means the runner never builds a Story or a StoryMember by hand,
 * which is where an origin, a clock or an evidence kind would quietly be made up.
 *
 * ★ A SEEDED STORY TAKES ITS ORIGIN FROM THE POST THAT SEEDED IT. A real post seeds an
 * observed story; a seeded post seeds a fixture story. The runner also keeps the two apart
 * in the candidate block, so a real post never joins a fixture story — which would wrap a
 * fiction's provenance (and its permission to name invented coins) around something a
 * person actually posted.
 *
 * ★ THE STORY ID IS DERIVED FROM THE SEEDING POST, so seeding the same post twice — a
 * restart between the decision and the write, or a re-decision — writes the same row
 * rather than a second story about the same moment.
 */

import { storyId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type { MatchEvidence, Story, StoryMember } from '@insidor/contracts/story.ts';
import type { Fingerprint, Item, Millis } from '@insidor/contracts/vocabulary.ts';

import type { EvidencedMatch } from './match.ts';
import { shouldPromote } from './promote.ts';

/**
 * ★ WHICH GROUP ANSWERS LEAVE A POST WITH NO STORY, AND SO START ONE.
 *
 * Not only `M6_no_candidate_block`. The runner hands GROUP every open story as the block —
 * carrier blocking in the store is not built — so once a single story exists, an unrelated
 * post is scored against it and comes back `M3_below_match_bar` or `M5_generic_carrier`:
 * "not part of THAT story". Read as "owes nothing", that post would belong nowhere for ever,
 * and on a live feed only the first moment of the day could ever form a story. Measured,
 * not argued: the end-to-end test in e2e/ had its unrelated post vanish exactly this way.
 *
 * `M4_ambiguous_match` does NOT seed: the post may well belong to one of two stories, and a
 * third story would be a guess in the other direction. `M9_member_cap` does not either: the
 * post belongs, the story is full for now, and it waits.
 */
export function owesASeed(reason: ReasonCode): boolean {
  return reason === 'M6_no_candidate_block' || reason === 'M3_below_match_bar' || reason === 'M5_generic_carrier';
}

/** An item id is `<source>:<id>`; a story id component may not hold the separator. */
function seedToken(item: Item): string {
  return `seed-${String(item.itemId).replaceAll(':', '-').replaceAll('|', '-')}`;
}

function memberOf(story: Story, item: Item, evidence: MatchEvidence, joinedAt: Millis): StoryMember {
  return {
    storyId: story.storyId,
    itemId: item.itemId,
    authorKey: item.authorKey,
    source: item.source,
    postedAt: item.postedAt,
    joinedAt,
    evidence,
  };
}

/** The story's carriers plus any of the item's it does not already hold, oldest first. */
export function carriersWith(story: Story, item: Item): readonly Fingerprint[] {
  const held = new Set(story.carriers.map((f) => `${f.kind}\u0000${f.key}`));
  const added = item.fingerprints.filter((f) => !held.has(`${f.kind}\u0000${f.key}`));
  return added.length === 0 ? story.carriers : [...story.carriers, ...added];
}

/**
 * A new candidate story with this item as its only member.
 *
 * `earliestPostAt` is the post's own time, or when we first saw it if the source gave none.
 * That fallback is LATER than the truth, never earlier, so the coin window it anchors can
 * only start late — it can miss a coin, it cannot admit one minted before the post. The
 * store's member recount moves it earlier the moment a member with a real post time joins.
 */
export function seedStory(item: Item, at: Millis): { readonly story: Story; readonly member: StoryMember } {
  const story: Story = {
    storyId: storyId(seedToken(item)),
    state: 'candidate',
    origin: item.origin,
    createdAt: at,
    promotedAt: null,
    earliestPostAt: item.postedAt ?? item.firstSeenAt,
    lastMemberAt: at,
    memberCount: 1,
    distinctAuthors: 1,
    distinctSources: 1,
    carriers: item.fingerprints,
    mergedInto: null,
  };
  return { story, member: memberOf(story, item, { kind: 'seed' }, at) };
}

/** The member row a join writes, carrying the evidence that settled it. */
export function joinMember(item: Item, match: EvidencedMatch, at: Millis): StoryMember {
  return memberOf(match.story, item, match.evidence, at);
}

/**
 * The story as it should be stored after a membership change: the item's carriers added,
 * and promoted if it now clears the bar. `story` must be the row read back AFTER the member
 * was written, because the bar is on the counts the store recomputed from membership.
 *
 * Promotion is one-way. A promoted story that later looks narrower — it cannot, counts only
 * grow — is never demoted here; closing a story is a different decision.
 */
export function afterMembership(story: Story, item: Item, p: Policy, at: Millis): Story {
  const carriers = carriersWith(story, item);
  const promote = story.state === 'candidate' && shouldPromote(story, p);
  if (!promote && carriers === story.carriers) return story;
  return {
    ...story,
    carriers,
    ...(promote ? { state: 'promoted' as const, promotedAt: at } : {}),
  };
}
