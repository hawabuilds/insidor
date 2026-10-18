/**
 * THE OWNER'S SCREEN, TIMED: which cards were at least half in view for two seconds, and which post
 * sheets were opened, handed to the batch in seen.ts. The owner's sign-in only — for anyone else
 * the hooks observe nothing and note nothing.
 *
 *   useSeenOnScreen(surface, on)  a ref for each card: `ref={seen(post.id)}`
 *   useOpenedPost(postId)         in the post sheet: noted once when it opens
 *
 * The observer says which cards are on screen at all; while any is, each is measured every
 * `CHECK_EVERY_MS` (its box against the screen), so only the few cards in view cost anything.
 *
 * ★ A BREAK RESTARTS THE TWO SECONDS. A card that leaves the view, or a page that goes to the
 * background, stops its clock; it must then be in view for the full two seconds again. A phone left
 * face-down on For You does not make every card on it "seen".
 *
 * ★ ONE REF PER CARD, KEPT. The feed re-renders every few seconds (its clock, the live list); a new
 * ref function each render would unobserve and re-observe every card and restart every clock, so a
 * card would never reach two seconds. Each post id keeps its ref for the life of the list.
 *
 * What breaks if changed carelessly: noting the moment the two seconds END instead of when the card
 * came into view would start the owner's 24-hour window two seconds late; harmless, but the server
 * and the tools count from first sight, so the header of 0098 would be wrong.
 */

import { useCallback, useEffect, useRef } from 'react';

import { sendSeen, type SeenSurface } from '../../shared/api/owner.ts';
import { ownerStore } from './owner-store.ts';
import { CHECK_EVERY_MS, createSeenBatch, ON_SCREEN_MS, SEND_EVERY_MS, VISIBLE_SHARE } from './seen.ts';

const isOwner = () => ownerStore.get().owner === true;
const batch = createSeenBatch({ send: (posts, closing) => sendSeen(posts, closing), isOwner });

let started = false;
/** The ten-second sender and the page-hide flush, started the first time the owner's screen is watched. */
function start(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  setInterval(() => void batch.flush(), SEND_EVERY_MS);
  const closing = () => void batch.flush(true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') closing();
  });
  window.addEventListener('pagehide', closing);
}

/** The share of a card in view: of the card, or of the screen for a card taller than two screens. */
function shareInView(el: Element): number {
  const r = el.getBoundingClientRect();
  const screen = window.innerHeight;
  const shown = Math.max(0, Math.min(r.bottom, screen) - Math.max(r.top, 0));
  if (r.height <= 0 || screen <= 0) return 0;
  return Math.max(shown / r.height, shown / screen >= VISIBLE_SHARE ? VISIBLE_SHARE : 0);
}

export function useSeenOnScreen(surface: Exclude<SeenSurface, 'sheet'>, on: boolean): (itemId: string) => (el: Element | null) => void {
  const refs = useRef(new Map<string, (el: Element | null) => void>());
  const ids = useRef(new Map<Element, string>());
  /* The cards the observer says are on screen at all, and since when each has been half in view. */
  const near = useRef(new Map<Element, number | null>());
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!on || typeof IntersectionObserver === 'undefined') return;
    start();
    let ticker: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const now = Date.now();
      const visible = document.visibilityState === 'visible';
      for (const [el, since] of near.current) {
        const id = ids.current.get(el);
        /* A break restarts the two seconds: out of view, under half, or the page in the background. */
        if (id === undefined || !visible || shareInView(el) < VISIBLE_SHARE) near.current.set(el, null);
        else if (since === null) near.current.set(el, now);
        else if (now - since >= ON_SCREEN_MS && isOwner()) batch.onScreen(id, surface, since);
      }
      if (near.current.size === 0 && ticker !== null) {
        clearInterval(ticker);
        ticker = null;
      }
    };
    const o = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) near.current.set(e.target, near.current.get(e.target) ?? null);
        else near.current.delete(e.target);
      }
      if (near.current.size > 0 && ticker === null) ticker = setInterval(tick, CHECK_EVERY_MS);
    });
    observer.current = o;
    for (const el of ids.current.keys()) o.observe(el);
    return () => {
      o.disconnect();
      observer.current = null;
      near.current.clear();
      if (ticker !== null) clearInterval(ticker);
    };
  }, [on, surface]);

  return useCallback((itemId: string) => {
    let ref = refs.current.get(itemId);
    if (ref === undefined) {
      let held: Element | null = null;
      ref = (el: Element | null) => {
        if (held !== null) {
          observer.current?.unobserve(held);
          ids.current.delete(held);
          near.current.delete(held);
        }
        held = el;
        if (el !== null) {
          ids.current.set(el, itemId);
          observer.current?.observe(el);
        }
      };
      refs.current.set(itemId, ref);
    }
    return ref;
  }, []);
}

/** The post sheet was opened: noted once per post for the owner, nothing for anyone else. */
export function useOpenedPost(postId: string): void {
  useEffect(() => {
    if (!isOwner()) return;
    start();
    batch.opened(postId, Date.now());
  }, [postId]);
}
