/**
 * FOR YOU, LIVE — the list a person is looking at, kept current while they look at it.
 *
 * Three ways a new frame reaches the phone, cheapest first: the read service's stream says the
 * feed changed (shared/api/client.ts openRisingStream); every 30 seconds while For You is open and on screen the
 * phone asks for the feed's number alone and reads the feed only if the number moved (the backup,
 * for a stream that is down or that this build cannot open); and, as before, opening the app, pull
 * to refresh and coming back to it. A hidden tab, another screen or another feed tab asks nothing.
 *
 * Each read is merged by live-feed.ts: new posts at the top, nothing reordered or removed.
 * ★ THE LIST IS REBUILT IN THE SERVER'S ORDER, removals included, only when nobody is looking at a
 * card: the first read, opening the FYP tab, pull to refresh, and coming back to the app after more
 * than five minutes away. Any other read only adds at the top.
 *
 * ★ SCROLLED DOWN, NOTHING MOVES. When posts go in above somebody who has scrolled, the first card
 * they can see is measured before the list changes and the page is scrolled by exactly how far that
 * card moved, so it stays where their eyes are and the new posts wait above. Browsers that anchor
 * scrolling themselves leave that distance at zero, so the correction is never applied twice. At
 * the top (within a few pixels), new posts slide in where they are seen (LiveCard.tsx).
 *
 * Separate from Feed.tsx because none of it runs while the switch is off: Feed then renders the
 * read exactly as before. What breaks if changed carelessly: measuring the anchor after the
 * re-render (instead of before) measures the moved card against itself and corrects nothing; an
 * interval that keeps running on a hidden page reads the feed for nobody.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RisingFeed, RisingPost } from '../../shared/api/index.ts';
import { fetchRisingTick, openRisingStream } from '../../shared/api/client.ts';
import type { Load } from '../../shared/hooks.ts';
import { BACKUP_CHECK_MS, merge, reconcile, staggerDelay } from './live-feed.ts';

/** How a card that is new to the list comes in. */
export interface Arrival {
  /** Wait this long before sliding in, so several come one after another. */
  readonly delay: number;
  /** Slide in (the person is at the top), or simply be there with its highlight (scrolled down). */
  readonly slide: boolean;
}

export interface LiveFeed {
  /** The list to show, or null before the first read. */
  readonly rows: readonly RisingPost[] | null;
  readonly arrivals: ReadonlyMap<string, Arrival>;
  /** The next read rebuilds the list in the server's order (pull to refresh). */
  readonly rebuildNext: () => void;
}

interface LiveList {
  readonly rows: readonly RisingPost[];
  readonly arrivals: ReadonlyMap<string, Arrival>;
}

/** Within this many pixels of the top counts as at the top. */
const TOP_SLACK_PX = 8;
/** Away from the app longer than this, the list is rebuilt on return. */
const AWAY_REBUILD_MS = 5 * 60_000;

/** The attribute every live card carries, so the anchor can be found again after the list changes. */
export const LIVE_ID_ATTR = 'data-live-id';

const scrollTop = (): number => document.scrollingElement?.scrollTop ?? window.scrollY;

/** The first card any part of which is on screen, and where its top is now. */
function firstVisibleCard(): { readonly id: string; readonly top: number } | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[${LIVE_ID_ATTR}]`)) {
    const box = el.getBoundingClientRect();
    if (box.bottom > 0) return { id: el.getAttribute(LIVE_ID_ATTR) ?? '', top: box.top };
  }
  return null;
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

export function useLiveFeed(on: boolean, load: Load<RisingFeed>, reload: () => void): LiveFeed {
  const [list, setList] = useState<LiveList | null>(null);
  const listRef = useRef<LiveList | null>(null);
  const rebuild = useRef(true);
  const merged = useRef<RisingFeed | null>(null);
  const held = useRef<number | null>(null);
  const anchor = useRef<{ readonly id: string; readonly top: number } | null>(null);
  const visible = useVisible();

  /* Opening the tab (or the switch) starts from the server's order. */
  useEffect(() => {
    if (!on) return;
    rebuild.current = true;
    merged.current = null;
  }, [on]);

  /* Coming back after a long time away is a fresh look, not a glance. */
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    if (!visible) hiddenAt.current = Date.now();
    else if (hiddenAt.current !== null) {
      if (Date.now() - hiddenAt.current > AWAY_REBUILD_MS) rebuild.current = true;
      hiddenAt.current = null;
    }
  }, [visible]);

  /* A new read: merged at the top, or the list rebuilt (see the header). */
  useLayoutEffect(() => {
    if (!on || load.state !== 'ready' || load.value === merged.current) return;
    const value = load.value;
    merged.current = value;
    held.current = value.tick;
    /* Worked out here, not in a state updater: an updater may run twice and this has effects. */
    const prev = listRef.current;
    let next: LiveList;
    if (prev === null || rebuild.current) {
      rebuild.current = false;
      next = { ...reconcile(value.posts), arrivals: new Map() };
    } else {
      const m = merge(prev.rows, value.posts);
      if (m.arrived.length === 0) next = { rows: m.rows, arrivals: prev.arrivals };
      else {
        const atTop = scrollTop() <= TOP_SLACK_PX;
        /* Measured now, while the screen still shows the old list. */
        anchor.current = atTop ? null : firstVisibleCard();
        const arrivals = new Map(prev.arrivals);
        m.arrived.forEach((id, i) => arrivals.set(id, { delay: atTop ? staggerDelay(i) : 0, slide: atTop }));
        next = { rows: m.rows, arrivals };
      }
    }
    listRef.current = next;
    setList(next);
  }, [on, load]);

  /* After the new list is laid out: put the card that was on screen back where it was. */
  useLayoutEffect(() => {
    const was = anchor.current;
    anchor.current = null;
    if (was === null) return;
    const el = document.querySelector<HTMLElement>(`[${LIVE_ID_ATTR}="${CSS.escape(was.id)}"]`);
    if (el === null) return;
    const moved = el.getBoundingClientRect().top - was.top;
    if (moved !== 0) window.scrollBy(0, moved);
  }, [list]);

  /* Read the feed again when the number moved past the one we hold, or when we cannot tell. */
  const latestReload = useRef(reload);
  latestReload.current = reload;
  const onChanged = useCallback((tick: number | null) => {
    if (tick === null || held.current === null || tick > held.current) latestReload.current();
  }, []);

  /* The stream, and the 30-second backup, only while For You is open and on screen. */
  useEffect(() => {
    if (!on || !visible) return;
    const close = openRisingStream('fyp', onChanged);
    const ac = new AbortController();
    const timer = setInterval(() => {
      void fetchRisingTick('fyp', ac.signal).then((tick) => {
        if (tick !== null) onChanged(tick);
      });
    }, BACKUP_CHECK_MS);
    return () => {
      close?.();
      clearInterval(timer);
      ac.abort();
    };
  }, [on, visible, onChanged]);

  const rebuildNext = useCallback(() => {
    rebuild.current = true;
  }, []);

  return { rows: on ? (list?.rows ?? null) : null, arrivals: list?.arrivals ?? new Map(), rebuildNext };
}
