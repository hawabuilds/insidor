/**
 * THE WATCH STAR on a post: on a For You card, on the post sheet, and on the Watchlist tab's cards
 * (the owner, 2026-10-14). Filled while the post is watched; a tap watches it or stops watching it.
 * A watched post's coin — launched, found, proven, or its story's — is pushed within seconds
 * (services/notify/src/watch.ts), and the post is listed in the Watchlist tab.
 *
 * Its own component so the three places draw one star with one rule: the change shows at once and
 * is put back, with a toast saying so, if the alert service refuses it (shared/watched-posts.ts) —
 * a star that says "watching" while nothing will be sent is the one thing it must never do. A tap
 * on a card's star does not open the card.
 */

import { useSyncExternalStore, type MouseEvent } from 'react';

import { watchedPosts } from '../watched-posts.ts';
import { useToast } from './ComingSoon.tsx';
import { StarIcon } from './icons.tsx';
import styles from './watch-star.module.css';

export function useWatchedPostIds(): readonly string[] {
  return useSyncExternalStore(watchedPosts.subscribe, watchedPosts.ids, watchedPosts.ids);
}

export function WatchStar({ postId, size = 'card' }: { postId: string; size?: 'card' | 'sheet' }) {
  const on = useWatchedPostIds().includes(postId);
  const toast = useToast();
  const tap = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    watchedPosts.set(postId, !on).then(
      () => toast(on ? 'Stopped watching this post' : 'Watching this post', on ? '' : 'You will hear the moment a coin for it launches or is found.'),
      (err: unknown) => toast(on ? "Couldn't stop watching" : "Couldn't watch this post", err instanceof Error ? err.message : 'Try again in a moment.'),
    );
  };
  return (
    <button
      type="button"
      className={`${styles['star']} ${size === 'sheet' ? styles['big'] : ''} ${on ? styles['on'] : ''}`}
      aria-pressed={on}
      aria-label={on ? 'Stop watching this post' : 'Watch this post'}
      onClick={tap}
    >
      <StarIcon size={size === 'sheet' ? 20 : 18} filled={on} />
    </button>
  );
}
