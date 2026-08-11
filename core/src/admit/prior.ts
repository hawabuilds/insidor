/**
 * The author prior — our own standing for an account, in [0,1].
 *
 * WHY ours and never theirs: every source publishes some prominence signal, and
 * every one of them is the source's to game and the account's to buy. A prior we
 * compute from our own history of that account — did their items reach stories, did
 * those stories go anywhere — is expensive to manufacture, because manufacturing it
 * means actually producing things other people copy.
 *
 * WHY it is a prior and not a gate: the roster is the strongest single term in the
 * admission score and it must never be the only thing consulted, or the system
 * becomes a follower of accounts it already knows and stops finding anything. The
 * corpus-relative carrier term exists precisely to admit unknown accounts, and it is
 * available at zero engagement, which is where lead time actually comes from.
 */

import type { AuthorKey } from '@insidor/contracts/ids.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { notImplemented } from '../not-implemented.ts';

/**
 * The account's own history, as counts. No source fields, no follower number: those
 * are theirs. These are ours, and they are outcomes we observed.
 */
export interface AuthorHistory {
  readonly authorKey: AuthorKey;
  readonly observedFrom: Millis;
  readonly itemsAdmitted: number;
  readonly itemsJoinedStory: number;
  readonly storiesQualified: number;
  /** Stories of theirs that produced a confidently matched asset. Sparse and slow. */
  readonly storiesResolved: number;
}

/**
 * TO BUILD: the roster tier.
 *
 * Runs offline, nightly, over the whole author corpus, and writes `Author.rosterTier`
 * — it is not called on the admission path, because the admission path is handed the
 * already-computed tier as data.
 *
 * Two properties it must have, and neither is obvious:
 *   - It must shrink toward the population mean for accounts with little history, or
 *     an account with one lucky item outranks an account with forty good ones.
 *   - It must decay with age, because the accounts that mattered six months ago are
 *     a different population from the ones that matter now, and a roster that never
 *     forgets slowly becomes a list of who was early to the last regime.
 */
export function rosterTier(_history: AuthorHistory, _now: Millis): number {
  return notImplemented('admit/prior.ts: the shrunk, decayed author roster tier');
}
