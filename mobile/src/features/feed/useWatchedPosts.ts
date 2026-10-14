/**
 * THE WATCHLIST TAB'S POSTS: every post I watch (shared/watched-posts.ts), each read from the read
 * service as its card (the post sheet's own read, which holds the post however long ago it left For
 * You), newest watch first.
 *
 * Its own hook so the Feed keeps one rule per list: a post that cannot be read is counted and said
 * ("1 watched post couldn't be read just now"), never dropped silently, and a post read once is kept
 * while the tab is open, so starring another does not read them all again.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchPostSheet, type RisingPost } from '../../shared/api/index.ts';
import { watchedPosts } from '../../shared/watched-posts.ts';

export interface WatchedRows {
  readonly rows: readonly RisingPost[];
  /** Watched posts still being read. */
  readonly reading: number;
  /** Watched posts the read service could not give just now. */
  readonly failed: number;
  /** Whether the list of watched posts itself has been read from the alert service. */
  readonly state: 'loading' | 'ready' | 'failed';
}

export function useWatchedPosts(active: boolean): WatchedRows {
  useSyncExternalStore(watchedPosts.subscribe, watchedPosts.version, watchedPosts.version);
  const ids = watchedPosts.ids();
  const [read, setRead] = useState<ReadonlyMap<string, RisingPost | 'failed'>>(new Map());
  useEffect(() => {
    if (!active) return;
    const missing = ids.filter((id) => !read.has(id));
    if (missing.length === 0) return;
    const ac = new AbortController();
    for (const id of missing) {
      fetchPostSheet(id, ac.signal).then(
        (sheet) => setRead((m) => new Map(m).set(id, sheet.post)),
        () => {
          if (!ac.signal.aborted) setRead((m) => new Map(m).set(id, 'failed'));
        },
      );
    }
    return () => ac.abort();
    // `read` is read for what is missing, not a reason to read again.
  }, [active, ids.join(',')]);
  const rows = ids.flatMap((id) => {
    const p = read.get(id);
    return p === undefined || p === 'failed' ? [] : [p];
  });
  return { rows, reading: ids.filter((id) => !read.has(id)).length, failed: ids.filter((id) => read.get(id) === 'failed').length, state: watchedPosts.state() };
}
