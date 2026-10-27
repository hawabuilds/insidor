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
 * ★ A LAYER BELONGS TO THE PAGE IT WAS OPENED ON (the page's history entry id, shared/nav.ts; a
 * layer's own entries copy it). Leaving for another screen from inside a sheet (a coin in the post
 * sheet) no longer closes the sheet: the page behind stays drawn, hidden (App.tsx), with its sheet
 * still up, and Back from that screen lands on the sheet's entry and shows it as it was (the owner,
 * 2026-10-21: Back shows the previous page "and it not be reset"). So depth, Escape and the hold
 * below count only the layers of the entry on screen; a hidden page's layers wait. A bottom tab is
 * one screen across many entries: shown at another entry (a tab-bar tap), its old layer closes
 * (`ShownEntry`), and a Back onto that layer's leftover entry steps over it.
 *
 * ★ THE PAGE BEHIND DOES NOT MOVE. While the entry on screen has a layer open, the page is held
 * still (no scrolling); when the last one closes it is given back at the position kept for that
 * entry (shared/entry-scroll.ts), which is not noted while held.
 *
 * What breaks if changed carelessly: React mounts every component twice in development, so a layer
 * that pushes on every mount, or pops on every unmount without checking, leaves a stray entry and
 * the next back does nothing. `settle` reconciles history with the open layers after the fact.
 * Counting another page's layers as this one's makes Back skip or reopen the wrong sheet.
 */

import { useContext, useEffect, useRef, type RefObject } from 'react';

import { entryIdOf } from '../nav.ts';
import { savedFor, setHeld } from '../entry-scroll.ts';
import { ShownEntry } from '../screen-active.ts';
import { scroller, scrollTopNow, scrollToY } from '../scroller.ts';

interface Layer {
  /** The history entry of the page it was opened on. */
  readonly entry: string | null;
  readonly depth: number;
  readonly close: () => void;
  readonly escape: () => boolean;
}

const stack: Layer[] = [];
let held: { readonly y: number; readonly entry: string | null; readonly overflow: string } | null = null;
let listening = false;

const stateNow = (): unknown => (typeof history === 'undefined' ? null : history.state);
const depthNow = (): number => {
  const s = stateNow();
  const d = s !== null && typeof s === 'object' ? (s as { insidorLayer?: unknown }).insidorLayer : undefined;
  return typeof d === 'number' ? d : 0;
};
const entryNow = (): string | null => entryIdOf(stateNow());

/** The open layers of `entry`, bottom first. */
const layersOf = (entry: string | null): Layer[] => stack.filter((l) => l.entry === entry);

/**
 * Which of `layers` (one entry's, bottom first) close on landing at layer depth `d`, top first, and
 * how many leftover history entries to step back over (a layer that closed while its page was not
 * on screen). Pure, for the tests.
 */
export function onLanding<T extends { readonly depth: number }>(layers: readonly T[], d: number): { readonly close: readonly T[]; readonly stepOver: number } {
  const close = layers.filter((l) => l.depth > d).reverse();
  const left = layers.length - close.length;
  return { close, stepOver: d > left ? d - left : 0 };
}

/** Hold the page while the entry on screen has a layer open; give it back when it has none. */
function sync(): void {
  const entry = entryNow();
  const open = layersOf(entry).length > 0;
  if (open && held !== null && held.entry !== entry) giveBack(false);
  if (open && held === null) {
    /* The column is what scrolls (shared/scroller.ts): holding it still keeps its place. */
    const root = scroller();
    held = { y: scrollTopNow(), entry, overflow: root.style.overflowY };
    root.style.overflowY = 'hidden';
    setHeld(true);
  } else if (!open && held !== null) {
    giveBack(held.entry === entry);
  }
}

function giveBack(here: boolean): void {
  if (held === null) return;
  const h = held;
  held = null;
  setHeld(false);
  scroller().style.overflowY = h.overflow;
  /* Left for another page: that page's own position is the shell's to set (App.tsx). */
  if (!here) return;
  const y = (h.entry === null ? undefined : savedFor(h.entry)) ?? h.y;
  scrollToY(y);
  /* A history step can restore its own idea of the scroll a frame later; ours wins. */
  requestAnimationFrame(() => {
    if (entryNow() === h.entry && held === null) scrollToY(y);
  });
}

/**
 * After a layer closes: take off history entries no open layer owns any more, when we are still on
 * its page. Closed while its page was not on screen (a tab's sheet closed by showing the tab at a new
 * entry, a hidden page dropped), its entries stay behind us and a Back onto one steps over it.
 */
function settle(layer: Layer, at: string): void {
  setTimeout(() => {
    if (entryNow() === layer.entry) {
      const extra = depthNow() - layersOf(layer.entry).length;
      if (extra > 0 && location.href === at) history.go(-extra);
      else if (extra > 0) history.replaceState({ ...(history.state as object | null), insidorLayer: layersOf(layer.entry).length }, '');
    }
    sync();
  }, 0);
}

function onPop(): void {
  const { close, stepOver } = onLanding(layersOf(entryNow()), depthNow());
  /* Close every layer of this page deeper than the entry we landed on, top first. */
  for (const l of close) {
    const i = stack.indexOf(l);
    if (i >= 0) stack.splice(i, 1);
    l.close();
  }
  /* An entry left behind by a layer that closed while its page was away: step over it. */
  if (stepOver > 0) history.go(-stepOver);
  sync();
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const mine = layersOf(entryNow());
  const top = mine[mine.length - 1];
  if (top !== undefined && top.escape()) top.close();
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', onPop);
  /* A move to another screen (a link from inside a sheet) gives the page back to that screen. */
  window.addEventListener('hashchange', sync);
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
  const opened = useRef<string | null | undefined>(undefined);
  const shownAt = useContext(ShownEntry);

  useEffect(() => {
    listen();
    const entry = entryNow();
    opened.current = entry;
    const depth = layersOf(entry).length + 1;
    /* Remounted in place (development's double mount): the entry is already there. */
    if (depthNow() < depth) history.pushState({ ...(history.state as object | null), insidorLayer: depth }, '');
    const href = location.href;
    const layer: Layer = { entry, depth, close: () => close.current(), escape: () => escape.current };
    stack.push(layer);
    sync();
    return () => {
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      settle(layer, href);
    };
  }, []);

  /* A kept bottom tab shown at another entry than the one this layer opened on: it closes. */
  useEffect(() => {
    if (shownAt !== null && opened.current !== undefined && shownAt !== opened.current) close.current();
  }, [shownAt]);
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
