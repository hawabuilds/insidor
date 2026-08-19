/**
 * When a candidate becomes a story anything downstream is allowed to look at.
 *
 * The bar is breadth, not volume: distinct authors and distinct sources, never member
 * count alone. In the build this replaces, ninety-one percent of populated stories
 * contained exactly one post by one author — the product's premise is that people are
 * making their own versions, and the grouper could not see a second version. A
 * promotion rule that counts members would have called every one of those a story.
 *
 * Promotion is also what makes the judge affordable: QUALIFY runs after this, so the
 * expensive call happens once per surviving story instead of once per member.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ WHY VOLUME IS THE WRONG BAR, which is worth one paragraph because it is the bar
 * everybody reaches for first.
 *
 * Member count is the one input on this list an adversary controls directly and
 * cheaply. A hundred posts from one account is a hundred posts from one account: it
 * costs one account, it can be bought by the thousand, and under a volume bar it
 * produces a promoted story, a judge call we paid for, and eventually a coin
 * presented to a user as something people are making versions of. Distinct authorship
 * is not free to fake — every extra author is another account with its own history —
 * so the bar is set on the thing that costs the attacker something.
 *
 * The same argument is why `distinctAuthors` and not `authorKey` diversity computed
 * here: the denormalised count on Story is maintained at join time from the member
 * rows, so this function cannot be fooled by being handed a partial member list.
 *
 * And it is why all three clauses use `>=` against a Policy field rather than a
 * hand-written minimum: the numbers move, and when they move every decision row still
 * says which ones it was judged against.
 */

import type { Story } from '@insidor/contracts/story.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

/**
 * TO BUILD: the promotion test against Policy.group.promoteMin*, and nothing else.
 *
 * "Nothing else" is load-bearing: no age, no score, no engagement. A story that has
 * shown breadth is eligible to be LOOKED at, and every judgement about whether it is
 * worth anything happens in QUALIFY, after this, once. Folding a quality test in here
 * would move a judgement upstream of the stage that logs judgements.
 *
 * Total on every Story, including a malformed one: a candidate with no members
 * answers false rather than throwing, because "not yet" is the honest answer to
 * "should this be promoted" and an exception here would stop the whole batch.
 */
export function shouldPromote(story: Story, p: Policy): boolean {
  // Volume, and it is the WEAKEST of the three on purpose — it is here only to stop a
  // two-author story being promoted off two posts, not as evidence in its own right.
  if (story.memberCount < p.group.promoteMinMembers) return false;

  // Breadth of authorship: the clause the previous build did not have, and the one
  // that would have kept ninety-one percent of its stories out of the pipeline.
  if (story.distinctAuthors < p.group.promoteMinDistinctAuthors) return false;

  // Breadth of source. Ships at one — see the field's comment in policy.ts — so today
  // it passes everything, and the day a second adapter is live it becomes the
  // strongest clause of the three by changing one number in one file.
  if (story.distinctSources < p.group.promoteMinDistinctSources) return false;

  return true;
}
