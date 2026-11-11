/**
 * PULL TO REFRESH, Trador's (components/Refresh.tsx usePullToRefresh) on For You, the Feed and its
 * Notifications: pull the list down from the very top and let go to read it again.
 *
 * Trador's numbers: the list follows half the finger's travel, up to 96px; letting go past 64px
 * refreshes, held at 64px while it works; a refresh that returns the same list still spins for
 * 600ms so it looks like it happened. Only from the top and only downward, so it can never fight
 * a scroll already underway.
 *
 * Separate from the screens because the page scrolls the window here (Trador has one scroll
 * container), so the listeners go on the document; and so the numbers live in one place.
 *
 * ★ ONLY THE LIST MOVES (the owner, 2026-11-11): everything above the list (title, running coins,
 * tabs, sort chips, the All / X / TikTok row) stays still; the list under it follows the pull and
 * the spinner sits in the gap it opens, right above the first card (Parts.tsx PullIndicator, placed
 * by each screen just before its moving list). The kept tabs are all mounted at once (App.tsx), so
 * `enabled` is the screen being on show: a hidden tab neither refreshes nor swallows the touch.
 *
 * What breaks if changed carelessly: the touchmove listener must stay non-passive, or
 * preventDefault is ignored and the browser's own bounce moves the page as well as the spinner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { scrollTopNow } from '../../shared/scroller.ts';

const PULL_AT = 64;
const MAX_PULL = 96;
const MIN_SPIN_MS = 600;

export const pullProgress = (pull: number): number => Math.min(1, pull / PULL_AT);

/** The page follows the pull at 0.6 of it, and eases back when let go, as Trador's scroller does. */
export const pullStyle = (pull: number): { transform?: string; transition?: string } => (pull > 0 ? { transform: `translateY(${pull * 0.6}px)` } : { transition: 'transform 220ms ease' });

/** The pull in px, and whether a refresh is running. `refresh` must resolve when the list has been read. */
export function usePullToRefresh(refresh: () => Promise<void>, enabled = true): { readonly pull: number; readonly refreshing: boolean } {
  const [pull, setPullState] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const busy = useRef(false);
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);
  const on = useRef(enabled);
  useEffect(() => {
    on.current = enabled;
  }, [enabled]);
  const setPull = useCallback((n: number) => {
    pullRef.current = n;
    setPullState(n);
  }, []);

  useEffect(() => {
    let startY: number | null = null;
    let tracking = false;
    const top = () => scrollTopNow() <= 0;
    const onStart = (e: TouchEvent) => {
      if (!on.current || !top() || busy.current || e.touches.length !== 1) return;
      /* A drag inside an open sheet or pop-up is that sheet's (its swipe to close), never a refresh. */
      if (e.target instanceof Element && e.target.closest('[role="dialog"]') !== null) return;
      startY = e.touches[0]?.clientY ?? null;
      tracking = startY !== null;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking || startY === null) return;
      const dy = (e.touches[0]?.clientY ?? startY) - startY;
      if (dy <= 0 || !top()) {
        tracking = false;
        setPull(0);
        return;
      }
      e.preventDefault();
      setPull(Math.min(MAX_PULL, dy * 0.5));
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      startY = null;
      if (pullRef.current < PULL_AT) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(PULL_AT);
      const started = Date.now();
      void latest
        .current()
        .catch(() => undefined)
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - started)))))
        .then(() => {
          busy.current = false;
          setRefreshing(false);
          setPull(0);
        });
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [setPull]);

  return { pull, refreshing };
}
