/**
 * HOW EVERY SHEET AND POP-UP CLOSES — the phone's back gesture or button, Escape, and a downward
 * swipe — and how the page behind it is held still and given back exactly where it was.
 *
 * Separate from the sheet's look (Sheet.tsx, Modal.tsx) because one rule has to hold across all
 * of them at once: only the TOP layer closes. A post sheet with Create open over it, or Choose coin
 * with its quick buy panel open, must lose one layer per back or Escape, never two.
 *
 * ★ THE BACK GESTURE CLOSES A LAYER WITHOUT LEAVING THE PAGE. Each open layer adds one history
 * entry at the same address, numbered by depth (`insidorLayer` in history.state). Back pops it, and
 * every layer deeper than the entry we land on closes. Closing a layer any other way (X, swipe, a
 * tap outside) takes its entry back off, so the next back really goes back. No hashchange fires
 * for these entries, so the router never sees them.
 *
 * ★ THE PAGE BEHIND DOES NOT MOVE. The first layer to open notes the scroll position and stops the
 * page scrolling; the last to close puts it back, unless closing it went to another screen.
 *
 * What breaks if changed carelessly: React mounts every component twice in development, so a layer
 * that pushes on every mount, or pops on every unmount without checking, leaves a stray entry and
 * the next back does nothing. `settle` reconciles history with the open layers after the fact.
 */

import { useEffect, useRef, type RefObject } from 'react';

interface Layer {
  readonly depth: number;
  readonly close: () => void;
  readonly escape: () => boolean;
}

const stack: Layer[] = [];
let held: { readonly y: number; readonly href: string; readonly overflow: string } | null = null;
let listening = false;

const depthNow = (): number => {
  const s: unknown = typeof history === 'undefined' ? null : history.state;
  const d = s !== null && typeof s === 'object' ? (s as { insidorLayer?: unknown }).insidorLayer : undefined;
  return typeof d === 'number' ? d : 0;
};

function hold(): void {
  if (held !== null) return;
  const root = document.documentElement;
  held = { y: window.scrollY, href: location.href, overflow: root.style.overflow };
  root.style.overflow = 'hidden';
}

function release(): void {
  if (held === null || stack.length > 0) return;
  const h = held;
  held = null;
  document.documentElement.style.overflow = h.overflow;
  if (location.href !== h.href) return;
  window.scrollTo(0, h.y);
  /* A history step can restore its own idea of the scroll a frame later; ours wins. */
  requestAnimationFrame(() => {
    if (location.href === h.href) window.scrollTo(0, h.y);
  });
}

/**
 * After layers change: take off history entries no open layer owns any more. Only where the layer
 * left us: if closing it went to another screen and the browser carried the layer's number onto
 * that screen's entry (iPhone Safari does, for `location.replace('#…')`), stepping back would undo
 * the move and reopen what was just closed, so the number is wiped from the entry instead.
 */
function settle(at: string): void {
  setTimeout(() => {
    const extra = depthNow() - stack.length;
    if (extra > 0 && location.href === at) history.go(-extra);
    else if (extra > 0) history.replaceState({ ...(history.state as object | null), insidorLayer: stack.length }, '');
    release();
  }, 0);
}

function onPop(): void {
  const d = depthNow();
  /* Close every layer deeper than the entry we landed on, top first. */
  while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) > d) stack.pop()?.close();
  /* An entry left behind by a layer that closed by going to another screen: step over it. */
  if (d > stack.length) history.go(-(d - stack.length));
  release();
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (top !== undefined && top.escape()) top.close();
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPop);
  window.addEventListener('keydown', onKey);
}

/**
 * Register an open layer. `onClose` is called by back, Escape (unless `escape` is false at the
 * time), and by whatever else the caller wires; it must unmount the layer.
 */
export function useDismiss(onClose: () => void, opts: { readonly escape?: boolean } = {}): void {
  const close = useRef(onClose);
  close.current = onClose;
  const escape = useRef(opts.escape ?? true);
  escape.current = opts.escape ?? true;

  useEffect(() => {
    listen();
    const depth = stack.length + 1;
    if (stack.length === 0) hold();
    /* Remounted in place (development's double mount): the entry is already there. */
    if (depthNow() < depth) history.pushState({ ...(history.state as object | null), insidorLayer: depth }, '');
    const href = location.href;
    const layer: Layer = { depth, close: () => close.current(), escape: () => escape.current };
    stack.push(layer);
    return () => {
      const at = stack.indexOf(layer);
      if (at >= 0) stack.splice(at, 1);
      settle(href);
    };
  }, []);
}

/**
 * Swipe down to close, on `panel`: a touch that starts with the panel's scroller at its top and
 * moves down drags the panel with the finger; let go past 90px (or with a quick flick) and it
 * closes, otherwise it springs back. A mouse can drag it by any `[data-sheet-grab]` part.
 * Anything marked `[data-no-swipe]` (a video's seek bar, a text field) keeps its own gestures.
 */
export function useSwipeClose(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = panel.current;
    if (el === null) return;
    let startY = 0;
    let startX = 0;
    let startT = 0;
    let dy = 0;
    let active = false;
    let decided = false;

    const begin = (target: EventTarget | null, x: number, y: number): boolean => {
      const t = target instanceof Element ? target : null;
      if (t?.closest('[data-no-swipe], input, textarea, select') != null) return false;
      const scroller = t?.closest('[data-sheet-scroll]');
      if (scroller != null && scroller.scrollTop > 0) return false;
      startX = x;
      startY = y;
      startT = Date.now();
      dy = 0;
      active = true;
      decided = false;
      return true;
    };
    /** True while the gesture is the panel's: the caller then stops the page from scrolling. */
    const move = (x: number, y: number): boolean => {
      if (!active) return false;
      const d = y - startY;
      if (!decided) {
        if (Math.abs(d) < 6 && Math.abs(x - startX) < 6) return false;
        decided = true;
        if (d <= 0 || Math.abs(x - startX) > Math.abs(d)) {
          active = false;
          return false;
        }
      }
      dy = Math.max(0, d);
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      return true;
    };
    const end = () => {
      if (!active) return;
      active = false;
      const quick = dy > 30 && dy / Math.max(1, Date.now() - startT) > 0.6;
      el.style.transition = 'transform 0.2s ease-out';
      if (dy > 90 || quick) {
        el.style.transform = 'translateY(100%)';
        setTimeout(() => close.current(), 160);
      } else {
        el.style.transform = '';
      }
    };

    const ts = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || t === undefined) {
        active = false;
        return;
      }
      begin(e.target, t.clientX, t.clientY);
    };
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t !== undefined && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
    };
    const pd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (!(e.target instanceof Element) || e.target.closest('[data-sheet-grab]') === null || e.target.closest('button, a') !== null) return;
      if (!begin(e.target, e.clientX, e.clientY)) return;
      const pm = (m: PointerEvent) => void move(m.clientX, m.clientY);
      const pu = () => {
        window.removeEventListener('pointermove', pm);
        window.removeEventListener('pointerup', pu);
        end();
      };
      window.addEventListener('pointermove', pm);
      window.addEventListener('pointerup', pu);
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('pointerdown', pd);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('pointerdown', pd);
    };
  }, [panel]);
}
