/**
 * Re-reading counters for posts we already know about. This is the tracking path,
 * and on a source billed per run it is where most of the money goes.
 *
 * WHY THIS IS ITS OWN FILE, given the loop used to be inlined in the adapter. Two of
 * the three rules below are refusals, and a refusal inlined in an adapter method
 * cannot be tested without building an adapter, a meter and a clock. The other two
 * sources split this out for the same reason.
 *
 * ★ THE THREE RULES, AND ALL THREE ARE ABOUT NOT INVENTING A READING ──────
 *
 *   1. AN ID THAT COMES BACK WITH NO PAYLOAD IS OMITTED FROM THE RESULT, NEVER
 *      MAPPED TO ZEROS. A deleted post and an unread post are different facts, and a
 *      zeroed counter set would look like a post that lost every view it had — a
 *      measurement, and a dramatic one, where the truth is that we did not get a
 *      reading.
 *
 *   2. AN ID WE CANNOT ADDRESS IS NOT ASKED FOR. This source is addressed by URL, so
 *      re-reading a post needs the author's handle, which only the caller can look
 *      up. An absent handle is skipped rather than guessed, and — new here — so is a
 *      handle or an id that will not survive the client's URL gate. A wrong URL costs
 *      a paid run and returns nothing, which then reads as a deleted post.
 *
 *   3. A BATCH OF NOTHING IS NOT RUN. Every one of these calls is billed whole, so a
 *      run submitted with an empty list is a charge with no possible result. The
 *      client refuses it; this file makes sure it never gets there, because an
 *      exception is worse than simply having nothing to do.
 */

import type { CounterSet, Millis } from '@insidor/contracts';
import { rec, str } from '@insidor/vendor-kit';

import { isPathSegment, postUrl } from './client.ts';
import type { TikTokClient } from './client.ts';
import { toCounters } from './to-item.ts';

/**
 * The longest handle or id we will put into an actor input.
 *
 * ★ THE LENGTH BOUND LIVES HERE AND NOT IN THE URL BUILDER, because this is where a
 * long string costs something: it goes into the body of a run we PAY for, and a
 * hundred of them go into one body. The builder's gate answers a different question —
 * whether a character can change which request is made — and mixing the two would put
 * a resource limit into a routing rule, where the next reader would loosen it for a
 * routing reason.
 *
 * Comfortably above any real value on this source, so it is a sanity bound rather
 * than a filter: an id here is nineteen digits and a handle is at most a couple of
 * dozen characters.
 */
const MAX_SEGMENT = 64;

/** An id we hold, and the URL this source knows it by. */
export interface Addressed {
  readonly id: string;
  readonly url: string;
}

const addressableSegment = (value: string): boolean => value.length <= MAX_SEGMENT && isPathSegment(value);

/**
 * The ids we can actually ask about, paired with their URLs. Everything else is
 * dropped HERE, where the reason is one line, rather than inside a run we paid for.
 *
 * Exported and pure: this is rule 2, and it is the one that costs money when it is
 * wrong.
 */
export function addressable(
  sourceItemIds: readonly string[],
  handleOf: (sourceItemId: string) => string | null,
): readonly Addressed[] {
  const out: Addressed[] = [];
  for (const id of sourceItemIds) {
    const handle = handleOf(id);
    // Checked with the predicate rather than by catching the builder's throw: a handle
    // we cannot put in a URL is a handle we do not have, which is the case the null
    // branch already covers, and one skipped id must never fail a whole batch.
    if (handle === null || !addressableSegment(handle) || !addressableSegment(id)) continue;
    out.push({ id, url: postUrl(handle, id) });
  }
  return out;
}

export function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size < 1) throw new RangeError('observe: batch size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function observeBatch(
  client: TikTokClient,
  batch: readonly Addressed[],
  at: Millis,
): Promise<{ readonly counters: Map<string, CounterSet>; readonly runId: string | null }> {
  const run = await client.runObserve(batch.map((entry) => entry.url));
  const counters = new Map<string, CounterSet>();
  for (const entry of run.items) {
    /* Both spellings, because this scraper family has used each of them. An entry
       with neither is skipped rather than keyed by something we invented: an entry
       under a key no caller holds is worse than an absence, because it makes
       `counters.size` disagree with the number of ids actually answered — and that
       count is what the caller uses to tell a deleted post from an unread one. */
    const id = str(rec(entry).id) ?? str(rec(entry).awemeId);
    if (id === null) continue;
    counters.set(id, toCounters(entry, at));
  }
  return { counters, runId: run.runId };
}
