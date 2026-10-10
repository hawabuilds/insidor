/**
 * The lead post for each row on screen, read from its story a few at a time and kept for the
 * session. See `lead-post.ts` for why the feed has to do this at all.
 *
 * A story that fails to load is recorded as `null` — unknown — and the row simply shows no
 * badge and no handle. It is not retried in a loop: a row without a handle is fine, a feed
 * that hammers the read service is not.
 */

import { useEffect, useState } from 'react';
import { fetchStory } from '../../shared/api/index.ts';
import { leadPost, type LeadPost } from './lead-post.ts';

const AT_ONCE = 4;
const known = new Map<string, LeadPost | null>();
const inFlight = new Set<string>();

export function useLeadPosts(ids: readonly string[]): ReadonlyMap<string, LeadPost | null> {
  const [, setVersion] = useState(0);
  const wanted = ids.join('|');

  useEffect(() => {
    let live = true;
    const queue = ids.filter((id) => !known.has(id) && !inFlight.has(id));
    const next = async (): Promise<void> => {
      const id = queue.shift();
      if (id === undefined) return;
      inFlight.add(id);
      try {
        known.set(id, leadPost((await fetchStory(id)).evidence));
      } catch {
        known.set(id, null);
      } finally {
        inFlight.delete(id);
      }
      if (live) setVersion((v) => v + 1);
      await next();
    };
    for (let i = 0; i < AT_ONCE; i += 1) void next();
    return () => {
      live = false;
    };
    // `wanted` is the identity of `ids`.
  }, [wanted]);

  return known;
}
