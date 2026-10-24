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
 * ★ IT KEEPS THE LIST WHOLE WHEN THE FRAME MOVES ON. Given the frame's ids (`head`), it notices
 * when the frame card its pages continue has left the frame and reads the posts between the
 * frame's new last card and its pages (older-feed.ts `needsBridge`, `bridgeReached`), page by
 * page, into the same held list. One bridge per new last card: a failed one is not retried until
 * the frame's last card changes again, so a service that is down is not asked in a loop.
 *
 * Separate from Feed.tsx so each feed keeps its own pages while the other tab is open, and from
 * older-feed.ts, which holds the merge rule without any reading. What breaks if changed carelessly:
 * `more` must change identity when a page lands, so a list whose filters hid the whole page asks
 * again; `reset` must drop a page already on its way, or pull to refresh shows a stale page under
 * the new frame; and a bridge must stop where it meets the pages held, or it reads the whole scroll.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchRisingOlder, type RisingFeedId, type RisingPost } from '../../shared/api/index.ts';
import type { Order } from './feed-order.ts';
import { appendPage, bridgeReached, needsBridge } from './older-feed.ts';

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
  /** The frame card the pages continue: the one shown last when the first page, or the last bridge, was read. */
  readonly under: string | null;
  /** A bridge is being read (see the header); the next page waits for it. */
  readonly bridging: boolean;
}

const START: State = { posts: [], next: null, phase: 'idle', under: null, bridging: false };

/**
 * `lastShown` names the card the list shows last when the first page is asked for: the page then
 * starts under it, so it continues the list's order (For You). `order` joins each page to the ones
 * held by that order (feed-order.ts) rather than appending it.
 */
const NO_CARD = (): string | null => null;

export function useOlderPosts(
  feed: RisingFeedId,
  lastShown: () => string | null = NO_CARD,
  order: Order<RisingPost> | null = null,
  /** The frame's ids, top to bottom, when the pages continue it (For You); null for none. */
  head: readonly string[] | null = null,
): OlderPosts {
  const [state, setState] = useState<State>(START);
  const ref = useRef(state);
  ref.current = state;
  /* Each reset starts a new generation; a page from an older one is dropped. */
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  /* The frame's last card the latest bridge was read under: never twice for the same one. */
  const bridgedFrom = useRef<string | null>(null);

  const more = useCallback(() => {
    const s = ref.current;
    if (s.phase !== 'idle' || s.bridging || inFlight.current !== null) return;
    const gen = generation.current;
    const ac = new AbortController();
    inFlight.current = ac;
    const first = s.next === null;
    const under = first ? lastShown() : s.under;
    setState({ ...s, phase: 'loading', under });
    fetchRisingOlder(feed, s.next, ac.signal, first ? under : null).then(
      (page) => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setState((cur) =>
          page === null
            ? { ...cur, phase: 'done' }
            : { ...cur, posts: appendPage(cur.posts, page.posts, order), next: page.next, phase: page.next === null ? 'done' : 'idle' },
        );
      },
      () => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setState((cur) => ({ ...cur, phase: 'failed' }));
      },
    );
    /* `state` is a dependency on purpose: see the header. */
  }, [feed, state, lastShown, order]);

  /* The bridge: when the frame card the pages continue has left the frame (see the header). */
  const headKey = head === null ? null : head.join('\n');
  useEffect(() => {
    const s = ref.current;
    if (head === null || s.bridging || inFlight.current !== null || !needsBridge(s.under, head, s.posts)) return;
    const from = head[head.length - 1];
    if (from === undefined || from === bridgedFrom.current) return;
    bridgedFrom.current = from;
    const held = s.posts;
    const gen = generation.current;
    const ac = new AbortController();
    inFlight.current = ac;
    setState({ ...s, bridging: true });
    const walk = async (): Promise<void> => {
      let before: string | null = null;
      for (;;) {
        const page = await fetchRisingOlder(feed, before, ac.signal, before === null ? from : null);
        if (gen !== generation.current || page === null) return;
        setState((cur) => ({ ...cur, posts: appendPage(cur.posts, page.posts, order) }));
        if (page.next === null || bridgeReached(page.posts, held, order)) return;
        before = page.next;
      }
    };
    walk().then(
      () => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setState((cur) => ({ ...cur, bridging: false, under: from }));
      },
      () => {
        if (gen !== generation.current) return;
        inFlight.current = null;
        setState((cur) => ({ ...cur, bridging: false }));
      },
    );
    /* `head` is read through `headKey`; the phase and the bridge flag re-run it once a page lands. */
  }, [feed, headKey, state.phase, state.bridging, order]);

  const retry = useCallback(() => {
    if (ref.current.phase === 'failed') setState((cur) => ({ ...cur, phase: 'idle' }));
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    bridgedFrom.current = null;
    setState(START);
  }, []);

  useEffect(() => () => inFlight.current?.abort(), []);

  return { posts: state.posts, phase: state.phase, more, retry, reset };
}
