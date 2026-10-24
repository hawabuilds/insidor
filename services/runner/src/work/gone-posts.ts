/**
 * WHETHER A POST WAS DELETED, FROM THE RE-READS WE ALREADY MAKE (0131; the owner, 2026-10-24: "if
 * the post was deleted i want an indication that it was deleted on the post card on the feed").
 *
 * The readings loop and TRACK hand every re-read they make to `noteRereads`; nothing here asks a
 * source for anything, so this costs no call and no money. Three outcomes of one re-read, kept
 * apart because they mean different things:
 *
 *   failed     the call threw — a rate limit, a refusal, an outage, an empty balance. Nothing is
 *              concluded about any post in it: an outage is not a claim.
 *   left out   the source ANSWERED and did not return the post. Only on a source that declares
 *              `leftOutIsGone` (contracts ports/platform.ts; X does): elsewhere a left-out id may be a
 *              read the source did not make, and nothing is recorded.
 *   returned   the post came back: any record of its absence, and any "deleted", is cleared.
 *
 * ★ LEFT OUT IS NOT DELETED (`goneVerdict`). X leaves a post out the same way when the author deleted
 * it and when the account went private or was suspended, and gives no reason. So a post is called
 * deleted only when two answered re-reads left it out AND the same account was seen publicly after
 * the first: another of its posts read, or the account returned by a search or lookup. A readable
 * account is neither private nor suspended, so the post is what went. Without that the answer is
 * `unsure` and the card says nothing — never "deleted" on a guess.
 *
 * What breaks if changed carelessly: calling `noteRereads` from a catch block (a failed read would
 * mark every post in it gone), or for a source without `leftOutIsGone`. Every store error is logged
 * and swallowed: this bookkeeping must never cost a pass its readings. Before 0131 it logs once a
 * pass and does nothing.
 */

import type { Millis } from '@insidor/contracts';
import type { Capabilities } from '@insidor/contracts/ports/platform.ts';
import type { PgGonePostRepo, UnreturnedPost } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

/** How many undecided posts one settle looks at; the newest misses first. A bound, not a judgement. */
const SETTLE_BATCH = 200;

export interface GoneDeps {
  readonly repo: Pick<PgGonePostRepo, 'leftOut' | 'returned' | 'pending' | 'markDeleted'>;
  readonly log: Logger;
}

/** One post asked in a re-read: our id, and the source's. */
export interface AskedPost {
  readonly itemId: string;
  readonly sourceItemId: string;
}

/** What one re-read said about the presence of each post asked. */
export type RereadOutcome =
  | { readonly kind: 'answered'; readonly returned: readonly string[]; readonly leftOut: readonly string[] }
  /** The call failed, or the source cannot say what a left-out id means: no post is concluded about. */
  | { readonly kind: 'nothing'; readonly returned: readonly string[] };

/**
 * The outcome of one re-read. `answered` is the map the source returned, or `failed` when the call
 * threw. Returned posts are always returned; only an answered call on a `leftOutIsGone` source can
 * leave one out.
 */
export function rereadOutcome(
  capabilities: Pick<Capabilities, 'leftOutIsGone'>,
  asked: readonly AskedPost[],
  answered: ReadonlyMap<string, unknown> | 'failed',
): RereadOutcome {
  if (answered === 'failed') return { kind: 'nothing', returned: [] };
  const returned = asked.filter((p) => answered.has(p.sourceItemId)).map((p) => p.itemId);
  if (capabilities.leftOutIsGone !== true) return { kind: 'nothing', returned };
  return { kind: 'answered', returned, leftOut: asked.filter((p) => !answered.has(p.sourceItemId)).map((p) => p.itemId) };
}

export type GoneVerdict =
  | { readonly kind: 'deleted'; readonly at: number }
  /** `once`: one answered re-read left it out, which a short answer can do. `account_unseen`: its
      account has not been seen publicly since, so it may be private or suspended rather than deleted. */
  | { readonly kind: 'unsure'; readonly why: 'once' | 'account_unseen' };

/** Whether a left-out post is deleted, by the rule in the header. Deleted as of the first miss. */
export function goneVerdict(post: Pick<UnreturnedPost, 'firstAt' | 'misses' | 'accountSeenAt'>): GoneVerdict {
  if (post.misses < 2) return { kind: 'unsure', why: 'once' };
  if (post.accountSeenAt === null || post.accountSeenAt <= post.firstAt) return { kind: 'unsure', why: 'account_unseen' };
  return { kind: 'deleted', at: post.firstAt };
}

/** Records what one re-read said, then settles what can be settled. Never throws. */
export async function noteRereads(
  deps: GoneDeps | undefined,
  capabilities: Pick<Capabilities, 'leftOutIsGone'>,
  asked: readonly AskedPost[],
  answered: ReadonlyMap<string, unknown>,
  at: Millis,
): Promise<number> {
  if (deps === undefined || asked.length === 0) return 0;
  const outcome = rereadOutcome(capabilities, asked, answered);
  try {
    await deps.repo.returned(outcome.returned);
    if (outcome.kind === 'answered') await deps.repo.leftOut(outcome.leftOut, new Date(at));
  } catch (e) {
    deps.log.warn('could not record which posts a re-read returned; nothing concluded', { err: errorText(e) });
    return 0;
  }
  /* Every answered re-read, not only one that left a post out: the account sighting that settles a
     post often comes after the post has stopped being re-read at all. */
  return outcome.kind === 'answered' ? settleGone(deps) : 0;
}

/** Marks deleted every undecided post the rule now calls deleted. Returns how many. Never throws. */
export async function settleGone(deps: GoneDeps): Promise<number> {
  try {
    const pending = await deps.repo.pending(SETTLE_BATCH);
    const deleted = pending.flatMap((p) => {
      const v = goneVerdict(p);
      return v.kind === 'deleted' ? [{ itemId: p.itemId, at: v.at }] : [];
    });
    const marked = await deps.repo.markDeleted(deleted);
    if (marked > 0) deps.log.info('posts found deleted from their source', { posts: marked });
    return marked;
  } catch (e) {
    deps.log.warn('could not settle which posts were deleted; tried again on the next re-read', { err: errorText(e) });
    return 0;
  }
}
