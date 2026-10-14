/**
 * A LONG LIST THAT ONLY DRAWS THE ROWS NEAR THE SCREEN, scrolled with the page (the owner,
 * 2026-10-14: For You scrolls without end and must stay smooth on an iPhone after 500 cards).
 *
 * The rows above and below the drawn ones are empty space of the right height (padding on the
 * list), so the page is as tall as the whole list and the scroll bar tells the truth, while the
 * page holds a couple of dozen cards whatever the list's length. Each drawn row is measured as it
 * lays out (one ResizeObserver for all of them) and remembered by key, so a row scrolled past
 * keeps its real height when it is no longer drawn; a row not yet drawn counts as the average
 * (window-range.ts).
 *
 * ★ NOTHING THE PERSON IS LOOKING AT MOVES. After every change — a row measured taller than its
 * guess, a post arriving at the top, a page appended — the first row on screen is found again by
 * key and the page is scrolled by however far it moved, before the browser paints. The browser's
 * own scroll anchoring is switched off inside the list (`overflow-anchor: none`) so the two never
 * correct the same move twice, and the phone's Safari, which has none, behaves like every other.
 * At the very top nothing is held, so a new post slides in where it is seen (features/feed
 * LiveCard.tsx).
 *
 * ★ `onNearEnd` FIRES WHEN THE LAST DRAWN ROW IS WITHIN `nearEnd` ROWS OF THE END, so the next
 * page is asked for well before anybody reaches the bottom. The caller ignores repeats while a
 * page is on its way.
 *
 * Written here rather than taken from a library: the app has no list library, and the ones that
 * do this well bring their own scroll container, which would break pull to refresh and the live
 * list's anchoring, both of which scroll the page itself. What breaks if changed carelessly: a row
 * wrapper that lets its card's bottom margin collapse through it measures 12px short on every card
 * (hence `display: flow-root`); reading the scroll position in render instead of in the scroll
 * handler draws the wrong rows for a frame.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { anchorShift, rowAt, rowOffsets, rowsNear } from './window-range.ts';

/** Within this many pixels of the top counts as at the top: nothing is held there. */
const TOP_SLACK_PX = 8;

const scrollTop = (): number => document.scrollingElement?.scrollTop ?? window.scrollY;

export function WindowList<T>({
  items,
  keyOf,
  render,
  guess,
  overscan,
  nearEnd,
  onNearEnd,
  rowAttrs,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  /** A row's height before any has been measured, in px. */
  guess: number;
  /** How far above and below the screen rows are drawn, in px. */
  overscan: number;
  /** Ask for more when the last drawn row is this many rows from the end. */
  nearEnd: number;
  onNearEnd?: () => void;
  /** Attributes for each row's wrapper (the live list finds its cards by one). */
  rowAttrs?: (item: T) => Record<string, string>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [measuredAt, setMeasuredAt] = useState(0);
  /* Where the screen is relative to the list, from the last scroll or resize. */
  const view = useRef({ top: 0, height: typeof window === 'undefined' ? 800 : window.innerHeight });
  const [, setViewTick] = useState(0);
  const anchor = useRef<{ readonly key: string; readonly at: number } | null>(null);

  const keys = useMemo(() => items.map(keyOf), [items, keyOf]);
  /* `measuredAt` is the heights' version: the map itself is mutated in place. */
  const offsets = useMemo(() => rowOffsets(keys, heights.current, guess), [keys, guess, measuredAt]);
  const { start, end } = rowsNear(offsets, view.current.top, view.current.height, overscan);

  /* The list's own top on the page, and where the screen is against it. */
  const readView = useCallback(() => {
    const el = box.current;
    if (el === null) return;
    const listTop = el.getBoundingClientRect().top;
    view.current = { top: -listTop, height: window.innerHeight };
  }, []);

  const noteAnchor = useCallback(() => {
    const i = rowAt(offsets, Math.max(0, view.current.top));
    const key = keys[i];
    anchor.current = key === undefined || scrollTop() <= TOP_SLACK_PX ? null : { key, at: offsets[i] ?? 0 };
  }, [keys, offsets]);

  /* Scrolling: re-read the screen once a frame and redraw only when the drawn rows change. */
  const drawn = useRef({ start, end });
  drawn.current = { start, end };
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        readView();
        const next = rowsNear(offsetsRef.current, view.current.top, view.current.height, overscan);
        if (next.start !== drawn.current.start || next.end !== drawn.current.end) setViewTick((t) => t + 1);
        else noteAnchorRef.current();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [overscan, readView]);
  const noteAnchorRef = useRef(noteAnchor);
  noteAnchorRef.current = noteAnchor;

  /* After every change: hold the row on screen where it was, then note it again. */
  useLayoutEffect(() => {
    const was = anchor.current;
    if (was !== null && scrollTop() > TOP_SLACK_PX) {
      const shift = anchorShift(was.key, was.at, keys, offsets);
      if (Math.abs(shift) >= 0.5) window.scrollBy(0, shift);
    }
    readView();
    const next = rowsNear(offsets, view.current.top, view.current.height, overscan);
    if (next.start !== start || next.end !== end) setViewTick((t) => t + 1);
    noteAnchor();
  });

  /* Each drawn row measured as it lays out (one observer for all of them); a change redraws the
     offsets once per frame. Made in a layout effect, after the first rows have attached, so those
     are observed too; rows attached later are observed as they attach. */
  const observer = useRef<ResizeObserver | null>(null);
  const live = useRef(new Map<HTMLDivElement, string>());
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const el = e.target as HTMLDivElement;
        const key = live.current.get(el);
        if (key === undefined) continue;
        const h = el.offsetHeight;
        if (h > 0 && heights.current.get(key) !== h) {
          heights.current.set(key, h);
          changed = true;
        }
      }
      if (changed && frame === 0) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setMeasuredAt((n) => n + 1);
        });
      }
    });
    observer.current = ro;
    for (const el of live.current.keys()) ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      observer.current = null;
    };
  }, []);

  /* One ref per key for the list's life, so a redraw does not unobserve and observe every row again.
     The observer's first report on a new row is its measurement. */
  const refs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const rowRef = (key: string) => {
    let ref = refs.current.get(key);
    if (ref === undefined) {
      let held: HTMLDivElement | null = null;
      ref = (el: HTMLDivElement | null) => {
        if (held !== null) {
          observer.current?.unobserve(held);
          live.current.delete(held);
        }
        held = el;
        if (el === null) return;
        live.current.set(el, key);
        observer.current?.observe(el);
      };
      refs.current.set(key, ref);
    }
    return ref;
  };

  /* The next page, asked for well before the end. */
  const last = items.length;
  useEffect(() => {
    if (onNearEnd !== undefined && end >= last - nearEnd) onNearEnd();
  }, [end, last, nearEnd, onNearEnd]);

  const padTop = offsets[start] ?? 0;
  const padBottom = (offsets[offsets.length - 1] ?? 0) - (offsets[end] ?? 0);
  return (
    <div ref={box} style={{ paddingTop: padTop, paddingBottom: padBottom, overflowAnchor: 'none' }}>
      {items.slice(start, end).map((item, i) => {
        const key = keys[start + i] ?? '';
        return (
          <div key={key} ref={rowRef(key)} style={{ display: 'flow-root' }} {...(rowAttrs?.(item) ?? {})}>
            {render(item)}
          </div>
        );
      })}
    </div>
  );
}
