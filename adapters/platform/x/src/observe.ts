/**
 * Re-reading counters for items we already know about. This is the tracking path,
 * and it is the majority of what we spend money on.
 *
 * ★ AN ID THAT COMES BACK WITH NO PAYLOAD IS OMITTED FROM THE RESULT, NEVER MAPPED
 * TO ZEROS. A deleted post and an unread post are different facts, and a zeroed
 * counter set would look like an item that lost all its engagement — a measurement,
 * and a dramatic one, where the truth is that we did not get a reading. The map is
 * keyed by id and the caller can see which ids are missing; that is the whole
 * mechanism, and it is why the client refuses to invent an entry for an id the
 * vendor did not answer.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE ADAPTER. Everything here is pure given a
 * client, so the batching, the keying and the absence rule are testable with no
 * network at all — which is where the rule that matters actually lives.
 */

import type { CounterSet, Millis } from '@insidor/contracts';
import { rec, str } from '@insidor/vendor-kit';

import { billedUnits } from './capabilities.ts';
import type { XClient } from './client.ts';
import { toCounters } from './to-item.ts';

export function chunk(ids: readonly string[], size: number): readonly (readonly string[])[] {
  if (size < 1) throw new RangeError('observe: batch size must be at least 1');
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export async function observeBatch(
  client: XClient,
  ids: readonly string[],
  at: Millis,
): Promise<{ readonly counters: Map<string, CounterSet>; readonly units: number }> {
  const raw = await client.lookup(ids);
  const counters = new Map<string, CounterSet>();
  for (const entry of raw) {
    /* Both spellings, because this vendor sends a numeric `id` and a string `id_str`
       for the same value and which one appears has changed under us before. An entry
       with neither is skipped rather than keyed by something we invented: an entry
       under a key no caller holds is worse than an absence, because it makes
       `counters.size` disagree with the number of ids actually answered — and that
       count is what the caller uses to tell a deleted post from an unread one. */
    const id = str(rec(entry).id) ?? str(rec(entry).id_str);
    if (id === null) continue;
    counters.set(id, toCounters(entry, at));
  }
  return {
    counters,
    /* Measured from the response, not estimated — and never below the vendor's
       per-request floor. A batch where every id has been deleted returns an empty
       array and still costs a whole unit; booking it at zero is how the tracking
       path came to understate its own spend. See `billedUnits`. */
    units: billedUnits(raw.length),
  };
}
