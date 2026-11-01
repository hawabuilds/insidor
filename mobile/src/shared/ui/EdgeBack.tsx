/**
 * THE IPHONE BACK SWIPE in the home-screen app: drag from the left edge and the page slides right
 * under the finger; let go far enough (or flick) and it slides off and goes back, otherwise it
 * slides home. Nothing is drawn on top of the page (the owner, 2026-11-01: "i want the iphone
 * homescreen swipe only"). The rules — where it starts, when it is a scroll, when it goes back, and
 * why it is on only in the iPhone home-screen app — are in shared/edge-back.ts.
 *
 * What moves: with a sheet or pop-up open, that top layer; otherwise the page (`main`), moved by
 * `left`, never `transform`. A transform would make every pinned bar inside the page (the narrative
 * coin bar, the trade bars) pin to the page instead of the screen and jump while dragging; `left`
 * leaves them where they are.
 *
 * What it does on letting go is never its own: it presses the Back arrow on screen, or, with a
 * layer open, does the phone's back, which closes that one layer (shared/ui/dismiss.ts).
 *
 * What breaks if changed carelessly: the touchmove listener must stay non-passive, or the page
 * scrolls up and down while it slides; and the page must be put back after every swipe, gone back
 * or not, or it is left shifted off screen.
 */

import { useEffect } from 'react';

import { decidedBy, goesBack, phaseOf, startsSwipe } from '../edge-back.ts';

const SLIDE_MS = 220;
const SHADOW = '-10px 0 24px rgb(0 0 0 / 45%)';

/** The iPhone home-screen app, the one place with no back swipe of its own. */
function iphoneHomeScreen(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true;
}

const shown = (el: Element): boolean => el.getClientRects().length > 0;

function layerDepth(): number {
  const s: unknown = history.state;
  const d = s !== null && typeof s === 'object' ? (s as { insidorLayer?: unknown }).insidorLayer : undefined;
  return typeof d === 'number' ? d : 0;
}

type Target = { readonly el: HTMLElement; readonly how: 'left' | 'translate'; readonly back: () => void };

/** What a swipe here would move and do, or null when there is nothing to go back to. */
function targetNow(): Target | null {
  if (layerDepth() > 0) {
    const layers = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(shown);
    const top = layers[layers.length - 1];
    if (top === undefined) return null;
    return { el: top, how: 'translate', back: () => history.back() };
  }
  const main = document.querySelector('main');
  const arrow = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Back"]')].find((b) => shown(b) && b.closest('[role="dialog"]') === null);
  if (main === null || arrow === undefined) return null;
  return { el: main, how: 'left', back: () => arrow.click() };
}

function place(t: Target, x: number): void {
  if (t.how === 'left') {
    t.el.style.position = 'relative';
    t.el.style.left = `${x}px`;
  } else {
    t.el.style.translate = `${x}px 0`;
  }
  t.el.style.boxShadow = x > 0 ? SHADOW : '';
}

function reset(t: Target): void {
  t.el.style.transition = '';
  t.el.style.left = '';
  t.el.style.position = '';
  t.el.style.translate = '';
  t.el.style.boxShadow = '';
}

function settle(t: Target, go: boolean): void {
  t.el.style.transition = `${t.how} ${SLIDE_MS}ms ease-out`;
  place(t, go ? window.innerWidth : 0);
  window.setTimeout(() => {
    if (!go) {
      reset(t);
      return;
    }
    t.back();
    /* Held off screen until the screen behind has drawn, so the old page never flashes back. */
    window.setTimeout(() => reset(t), 80);
  }, SLIDE_MS);
}

export function EdgeBack(): null {
  useEffect(() => {
    if (!iphoneHomeScreen()) return undefined;
    let swipe: { x: number; y: number; at: number; dx: number; decided: boolean; target: Target } | null = null;

    const start = (e: TouchEvent) => {
      swipe = null;
      const touch = e.touches[0];
      if (e.touches.length !== 1 || touch === undefined || !startsSwipe(touch.clientX)) return;
      const target = targetNow();
      if (target === null) return;
      swipe = { x: touch.clientX, y: touch.clientY, at: e.timeStamp, dx: 0, decided: false, target };
    };
    const move = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (swipe === null || touch === undefined) return;
      const dx = touch.clientX - swipe.x;
      const dy = touch.clientY - swipe.y;
      if (phaseOf(dx, dy, swipe.decided) === 'dropped') {
        if (swipe.decided) settle(swipe.target, false);
        swipe = null;
        return;
      }
      if (!swipe.decided && decidedBy(dx, dy)) swipe.decided = true;
      if (!swipe.decided) return;
      e.preventDefault();
      swipe.dx = dx;
      swipe.target.el.style.transition = '';
      place(swipe.target, Math.max(0, dx));
    };
    const end = (e: TouchEvent) => {
      if (swipe === null) return;
      if (swipe.decided) settle(swipe.target, e.type === 'touchend' && goesBack(swipe.dx, e.timeStamp - swipe.at));
      swipe = null;
    };

    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, []);
  return null;
}
