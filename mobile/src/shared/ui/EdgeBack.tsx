/**
 * THE IPHONE BACK SWIPE in the home-screen app: drag from the left edge and the page slides right
 * under the finger while the screen you will land on slides in beneath it, a little behind and
 * dimmed, brightening as it comes; let go far enough (or flick) and the page slides off and you are
 * on that screen, otherwise both slide home. Nothing is drawn on top (the owner, 2026-11-01: "i want
 * the iphone homescreen swipe only"; "dont leave it out do it" of the screen underneath). The rules
 * — where it starts, when it is a scroll, when it goes back, and why it is on only in the iPhone
 * home-screen app — are in shared/edge-back.ts.
 *
 * What moves:
 *   a sheet or pop-up open   that top layer slides off; the page under it is already showing
 *   otherwise                the screen's own wrapper (App.tsx `data-kept`) slides, and the kept
 *                            screen that Back lands on (shared/under-page.ts) is shown pinned
 *                            beneath it at the place it was scrolled to. With none kept (opened
 *                            from a link with nothing of ours under it), the plain background.
 * Moved by `left`, never `transform`: a transform would pin every bar inside the page (the
 * narrative coin bar, the trade bars) to the page instead of the screen.
 *
 * What it does on letting go is never its own: it presses the Back arrow on screen, or, with a
 * layer open, does the phone's back, which closes that one layer (shared/ui/dismiss.ts). Once the
 * app has drawn the new screen, every style the swipe set is taken off again; a wrapper's
 * `display` is App.tsx's, so it is put back only where App did not change it.
 *
 * What breaks if changed carelessly: the touchmove listener must stay non-passive, or the page
 * scrolls up and down while it slides; a style left on a wrapper after a swipe leaves a screen
 * pinned over another.
 */

import { useEffect } from 'react';

import { decidedBy, goesBack, phaseOf, startsSwipe } from '../edge-back.ts';
import { savedFor } from '../entry-scroll.ts';
import { underFor } from '../under-page.ts';

const SLIDE_MS = 220;
const SHADOW = '-10px 0 24px rgb(0 0 0 / 45%)';
/** The screen underneath starts this share of the width to the left, and this dim, as iPhone's does. */
const UNDER_OFFSET = 0.3;
const UNDER_DIM = 0.6;
/** How long to wait for the app to draw the screen Back lands on before tidying up anyway. */
const LANDED_MS = 500;

/** The iPhone home-screen app, the one place with no back swipe of its own. */
function iphoneHomeScreen(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true;
}

const shown = (el: Element): boolean => el.getClientRects().length > 0;

function stateNumber(key: 'insidorLayer' | 'insidorAt'): number {
  const s: unknown = history.state;
  const d = s !== null && typeof s === 'object' ? (s as Record<string, unknown>)[key] : undefined;
  return typeof d === 'number' ? d : 0;
}

type Layer = { readonly el: HTMLElement; readonly display: string };
type Target = {
  readonly top: Layer;
  readonly how: 'left' | 'translate';
  readonly under: Layer | null;
  readonly underY: number;
  readonly back: () => void;
};

const layerOf = (el: HTMLElement): Layer => ({ el, display: el.style.display });

/** What a swipe here would move and do, or null when there is nothing to go back to. */
function targetNow(): Target | null {
  if (stateNumber('insidorLayer') > 0) {
    const layers = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter(shown);
    const top = layers[layers.length - 1];
    if (top === undefined) return null;
    return { top: layerOf(top), how: 'translate', under: null, underY: 0, back: () => history.back() };
  }
  const main = document.querySelector('main');
  const arrow = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Back"]')].find((b) => shown(b) && b.closest('[role="dialog"]') === null);
  if (main === null || arrow === undefined) return null;
  const wrappers = [...main.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.dataset['kept'] !== undefined);
  const top = wrappers.find((w) => w.style.display === 'contents' && w.contains(arrow)) ?? main;
  const below = underFor(stateNumber('insidorAt'));
  const under = below === null ? undefined : wrappers.find((w) => w.dataset['kept'] === below.wrapper && w !== top);
  return {
    top: layerOf(top),
    how: 'left',
    under: under === undefined ? null : layerOf(under),
    underY: below === null ? 0 : (savedFor(below.entry) ?? 0),
    back: () => arrow.click(),
  };
}

/** Draw the swipe `x` px across. */
function place(t: Target, x: number): void {
  const top = t.top.el.style;
  if (t.how === 'translate') {
    top.translate = `${x}px 0`;
  } else {
    top.display = 'block';
    top.position = 'relative';
    top.zIndex = '2';
    top.left = `${x}px`;
    top.minHeight = '100dvh';
    top.background = 'var(--bg)';
  }
  top.boxShadow = x > 0 ? SHADOW : '';
  if (t.under !== null) {
    const p = Math.min(1, x / window.innerWidth);
    const under = t.under.el;
    if (under.style.position !== 'fixed') {
      Object.assign(under.style, { display: 'block', position: 'fixed', top: '0', right: '0', bottom: '0', width: '100%', overflow: 'hidden', zIndex: '1', pointerEvents: 'none' });
      under.scrollTop = t.underY;
    }
    under.style.left = `${-UNDER_OFFSET * (1 - p) * window.innerWidth}px`;
    under.style.filter = `brightness(${UNDER_DIM + (1 - UNDER_DIM) * p})`;
  }
}

const SWIPE_STYLES = ['translate', 'position', 'zIndex', 'left', 'top', 'right', 'bottom', 'width', 'minHeight', 'background', 'boxShadow', 'overflow', 'pointerEvents', 'filter', 'transition'] as const;

/** Take every style the swipe set off again; `display` only where the app did not change it since. */
function tidy(layer: Layer): void {
  const s = layer.el.style;
  for (const k of SWIPE_STYLES) s[k] = '';
  if (s.display === 'block' && layer.display !== 'block') s.display = layer.display;
}

function settle(t: Target, go: boolean): void {
  t.top.el.style.transition = t.how === 'translate' ? `translate ${SLIDE_MS}ms ease-out` : `left ${SLIDE_MS}ms ease-out`;
  if (t.under !== null) t.under.el.style.transition = `left ${SLIDE_MS}ms ease-out, filter ${SLIDE_MS}ms ease-out`;
  place(t, go ? window.innerWidth : 0);
  const done = () => {
    tidy(t.top);
    if (t.under !== null) tidy(t.under);
  };
  window.setTimeout(() => {
    if (!go) {
      done();
      return;
    }
    /* Held where they are until the app has drawn the screen Back lands on, so nothing flashes. */
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener('popstate', landed);
      window.removeEventListener('hashchange', landed);
      done();
    };
    const landed = () => requestAnimationFrame(() => requestAnimationFrame(finish));
    window.addEventListener('popstate', landed);
    window.addEventListener('hashchange', landed);
    window.setTimeout(finish, LANDED_MS);
    t.back();
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
      swipe.target.top.el.style.transition = '';
      if (swipe.target.under !== null) swipe.target.under.el.style.transition = '';
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
