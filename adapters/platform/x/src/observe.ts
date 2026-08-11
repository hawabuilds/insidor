/**
 * Re-reading counters for items we already know about. This is the tracking
 * path, and it is the majority of what we spend money on.
 *
 * An id that comes back with no payload is OMITTED from the result, never
 * mapped to zeros. A deleted post and an unread post are different facts, and
 * a zeroed counter set would look like an item that lost all its engagement.
 */

import type { CounterSet, Millis } from '@insidor/contracts';
import { rec, str } from '@insidor/vendor-kit';

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
    const id = str(rec(entry).id) ?? str(rec(entry).id_str);
    if (id === null) continue;
    counters.set(id, toCounters(entry, at));
  }
  return { counters, units: raw.length };
}
