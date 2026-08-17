/**
 * Re-reading counters for posts we already know about. This is the tracking
 * path, and on every other source it is the majority of what we spend money on.
 * Here it is free, which changes the price and none of the rules.
 *
 * ★ AN ID THAT COMES BACK WITH NO PAYLOAD IS OMITTED FROM THE RESULT, NEVER
 * MAPPED TO ZEROS. On this source that case is not exotic: posts are removed by
 * moderators, deleted by their authors, and hidden by community settings, all
 * of which make a fullname stop answering. A zeroed counter set would look like
 * a post that lost every comment it had — a measurement, and a dramatic one —
 * where the truth is that we did not get a reading. The map is keyed by id and
 * the caller can see which ids are missing; that is the whole mechanism.
 *
 * A removed post that DOES still answer is a different case again, and it is
 * not handled here: it comes back with real counters and a body of `[removed]`,
 * so its numbers are readings and its text is a state. `to-item.ts` owns that
 * distinction.
 */

import type { CounterSet, Millis } from '@insidor/contracts';
import { rec, str } from '@insidor/vendor-kit';

import { isBareId, isFullname, LINK_KIND } from './client.ts';
import type { RedditClient } from './client.ts';
import { toCounters } from './to-item.ts';

export function chunk(ids: readonly string[], size: number): readonly (readonly string[])[] {
  if (size < 1) throw new RangeError('observe: batch size must be at least 1');
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export async function observeBatch(
  client: RedditClient,
  ids: readonly string[],
  at: Millis,
): Promise<{ readonly counters: Map<string, CounterSet>; readonly returned: number }> {
  const raw = await client.info(ids);
  const counters = new Map<string, CounterSet>();

  for (const entry of raw) {
    const r = rec(entry);
    /* Keyed by the FULLNAME, which is what the caller asked with and what we
       store as `sourceItemId`. Falling back to the bare id would key the map by
       a string no caller holds, so every entry would silently look absent —
       a result that is empty, plausible, and wrong.

       Both spellings are shape-checked against the same rule `to-item.ts` mints
       ids with, and the reason is subtler here than there: an unusable key
       cannot corrupt anything, because the caller only ever LOOKS UP ids it
       already holds. What it can do is sit in the returned map as an entry
       nobody asked for, so `counters.size` disagrees with the number of ids
       answered — and that count is what the caller uses to tell a removed post
       from an unread one. One rule, three files. */
    const name = str(r.name);
    const bare = str(r.id);
    const id =
      name !== null && isFullname(name)
        ? name
        : bare !== null && isBareId(bare)
          ? `${LINK_KIND}_${bare}`
          : null;
    if (id === null) continue;
    counters.set(id, toCounters(entry, at));
  }

  return { counters, returned: raw.length };
}
