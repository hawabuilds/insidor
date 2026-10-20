/**
 * FOR YOU'S JUNK BAR: which posts about to JOIN For You the re-tune's junk fit is too sure are like
 * the owner's "Not a meme" posts (Policy.rising.junkBar, the owner 2026-10-20: "people shouldn't be
 * thrown trashy narratives").
 *
 * Its own file because it is the projector's one read of the junk fit, and the rules around that
 * read are easy to get wrong in the middle of rising.ts:
 *
 *   ★ THE BAR COMES FROM THE FIT. Core `forYouJunkBar` picks it from the applied fit's own held-out
 *     table — the lowest threshold that keeps `keepShare` of the owner's held-out memeable posts — so
 *     a refit that moves the scale moves the bar with it. No number in policy is a probability.
 *   ★ ONLY POSTS JOINING. A post already on For You (feed-members.ts) is never re-asked: the bar, like
 *     the six hours, stops a post joining and never takes one off — a nightly refit must not empty
 *     the screen of what people were already reading.
 *   ★ A MISSING INPUT IS NOT JUNK. No fit, no qualifying row, no vector for the post, or a failed
 *     read: the post joins exactly as it would without the bar. An outage is said once, not scored.
 *
 * Replayed over For You's last 7 days on 2026-10-20 (policy.ts `junkBar` has the table): it is the
 * only admission rule tried that cut more Not a memes than memes. It costs nothing: every vector is
 * the one the runner already stored when it judged the post (0074).
 *
 * What breaks if changed carelessly: the probability is `junkProbability` over the fit's own space —
 * scoring a vector of another space, or rounding the arithmetic, makes the held-out bar mean nothing.
 * The probability decides here and goes nowhere else: not on a row, not in a payload, not in a log.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { forYouJunkBar, junkProbability, underJunkBar } from '@insidor/core';
import { PgJunkFilterRepo, type Db } from '@insidor/store';

/**
 * The posts of `joining` that stay off For You: at or over the applied fit's For You bar. The reads
 * run in a savepoint, as feed-members.ts's do: inside the projector's one transaction a failed read
 * would otherwise abort the whole frame. Outside a transaction (a test's bare connection) there is
 * no savepoint to take and the reads run as they are.
 */
export async function overJunkBar(db: Db, joining: readonly string[], policy: Policy): Promise<ReadonlySet<string>> {
  if (!policy.rising.junkBar.on || joining.length === 0) return new Set();
  let saved = true;
  try {
    await db.query('savepoint junk_bar');
  } catch {
    saved = false;
  }
  try {
    const repo = new PgJunkFilterRepo(db);
    const applied = await repo.latestAppliedTable();
    const bar = applied === null ? null : forYouJunkBar(applied.table, policy);
    const vectors = applied === null || bar === null ? new Map() : await repo.vectors(joining, applied.fit.space);
    if (saved) await db.query('release savepoint junk_bar');
    if (applied === null || bar === null) return new Set();
    return new Set(joining.filter((id) => {
      const v = vectors.get(id);
      return !underJunkBar(v === undefined ? null : junkProbability(v.values, applied.fit.space, applied.fit), bar);
    }));
  } catch (e) {
    if (saved) await db.query('rollback to savepoint junk_bar');
    console.warn(`For You's junk bar could not be read; every post joins as before: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`);
    return new Set();
  }
}
