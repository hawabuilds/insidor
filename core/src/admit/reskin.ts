/**
 * WHETHER AN ACCOUNT WAS EMPTIED AND DRESSED UP AS SOMEONE ELSE, from its own history alone.
 *
 * The scheme (the owner, 2026-11-04): a team takes an old account, clears it, gives it a real
 * organisation's name, picture, bio and website (@honolulu_zoo: made 2009, 60 posts, no likes),
 * launches a coin and spams posts for a few days. The account's age makes it look established;
 * its own history gives it away, because an account that old which was really used has posted
 * and liked far more than a few dozen times.
 *
 * Its own file because it is the one decision that keeps a post out of storage altogether
 * (services/runner work/arrivals.ts), so it is read and tested apart from the admission score.
 *
 * ★ A GATE, NOT A PENALTY, AND ONLY ON A KNOWN HISTORY. Every number must be present: a source
 * that gave no age, post count or like count says nothing, and nothing is held for it (an
 * absence is never read as zero). What breaks if changed carelessly: loosening any one bar
 * without re-measuring on the feed's accounts holds real accounts' posts, and they are never
 * stored, so the record cannot show the mistake later.
 */

import type { AccountHistory, Millis, Policy } from '@insidor/contracts';

import { DAYS_PER_YEAR, MS_PER_DAY } from '../math.ts';

/** True only when the source gave all three facts and every one is under its bar. */
export function reskinned(history: AccountHistory | undefined, now: Millis, policy: Policy['ingest']['reskin']): boolean {
  if (!policy.on || history === undefined) return false;
  const { createdAt, postsEver, approvalsGiven } = history;
  if (createdAt === null || postsEver === null || approvalsGiven === null) return false;
  const ageMs = now - createdAt;
  if (ageMs < policy.minAgeMs) return false;
  const years = ageMs / (MS_PER_DAY * DAYS_PER_YEAR);
  return postsEver < policy.maxPostsEver && postsEver / years < policy.maxPostsPerYear && approvalsGiven < policy.maxApprovalsGiven;
}
