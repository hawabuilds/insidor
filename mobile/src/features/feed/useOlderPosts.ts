/**
 * THE INFINITE SCROLL'S PAGES FOR ONE FEED: what has been read so far under the frame, and the
 * reading of the next page when the list asks for it (WindowList's `onNearEnd`, about ten cards
 * before the end — older-feed.ts `PREFETCH_ROWS`).
 *
 * One page at a time: a second ask while a page is on its way is ignored, so a fast flick reads
 * each page once. When the read service says there is no scroll for this feed (its table is not
 * there yet), the list simply ends at the frame. A failed read stops asking until the person taps
 * Try again — retrying on its own on every scroll would hammer a service that is down.
 *
 * Separate from Feed.tsx so each feed keeps its own pages while the other tab is open, and from
 * older-feed.ts, which holds the merge rule without any reading. What breaks if changed carelessly:
 * `more` must change identity when a page lands, so a list whose filters hid the whole page asks
 * again; and `reset` must drop a page already on its way, or pull to refresh shows a stale page
 * under the new frame.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchRisingOlder, type RisingFeedId, type RisingPost } from '../../shared/api/index.ts';
import { appendPage } from './older-feed.ts';

export type OlderPhase = 'idle' | 'loading' | 'failed' | 'done';

export interface OlderPosts {
  /** Every older post read so far, in the order the pages came. */
  readonly posts: readonly RisingPost[];
  readonly phase: OlderPhase;
  /** Read the next page, unless one is on its way, the last was read, or the last read failed. */
  readonly more: () => void;
  /** After a failure: ask again. */
  readonly retry: () => void;
  /** Forget every page (pull to refresh): the scroll starts again under the new frame. */
  readonly reset: () => void;
}

interface State {
  readonly posts: readonly RisingPost[];
  readonly next: string | null;
  readonly phase: OlderPhase;
}

const START: State = { posts: [], next: null, phase: 'idle' };

export function useOlderPosts(feed: RisingFeedId): OlderPosts {
  const [state, setState] = useState<State>(START);
  const ref = useRef(state);
  ref.current = state;
  /* Each reset starts a new generation; a page from an older one is dropped. */
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const more = useCallback(() => {
    const s = ref.current;
    if (s.phase !== 'idle' || inFlight.current !== null) return;
    const gen = generation.current;
    const ac = new AbortController();
    inFlight.current = ac;
    setState({ ...s, phase: 'loading' });
    fetchRisingOlder(feed, s.next, ac.signal).then(
      (page) => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setState((cur) =>
          page === null
            ? { ...cur, phase: 'done' }
            : { posts: appendPage(cur.posts, page.posts), next: page.next, phase: page.next === null ? 'done' : 'idle' },
        );
      },
      () => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setState((cur) => ({ ...cur, phase: 'failed' }));
      },
    );
    /* `state` is a dependency on purpose: see the header. */
  }, [feed, state]);

  const retry = useCallback(() => {
    if (ref.current.phase === 'failed') setState((cur) => ({ ...cur, phase: 'idle' }));
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    setState(START);
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { posts: state.posts, phase: state.phase, more, retry, reset };
}
