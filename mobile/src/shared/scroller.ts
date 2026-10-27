/**
 * THE ONE THING THAT SCROLLS: the app's column (`#root`), never the page.
 *
 * ★ WHY (the owner, 2026-10-27, the fifth time: "navigation bar bug again keeps moving up, a lot of
 * users have complained"). When the page itself scrolled, an iPhone could leave the visible screen
 * and the page's own box apart — mid-scroll, after the keyboard, after coming back to the app — and
 * the tab bar and the Buy and Sell bars, fixed to the page's box, went with the box. Four fixes
 * measured the gap and moved the bars by it (shared/viewport.ts before 2026-10-27), and each time
 * iOS reported the gap wrong somewhere and a bar ended mid-screen. With the page never scrolling,
 * there is no gap: the page box is the screen, and only this column moves under the bars.
 * tokens.css holds the page still (`html, body` hidden overflow) and makes `#root` the scroller.
 *
 * Every reader of the scroll position, every write to it and every scroll listener goes through
 * here, so a screen never reads the page's scroll, which is now always 0.
 *
 * What breaks if changed carelessly: reading `window.scrollY` anywhere (it is always 0 now), or
 * listening for 'scroll' on `window` (it never fires for the column).
 */

/** The scrolling column; the document's own scroller only before the app has mounted. */
export function scroller(): HTMLElement {
  return document.getElementById('root') ?? (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** How far the column is scrolled, in px. */
export const scrollTopNow = (): number => scroller().scrollTop;

/** Scroll the column to `y`. */
export function scrollToY(y: number): void {
  scroller().scrollTo(0, y);
}

/** Scroll the column by `dy`. */
export function scrollByY(dy: number): void {
  scroller().scrollBy(0, dy);
}

/** The column's visible height: the screen less nothing, since the column is the screen. */
export const viewHeight = (): number => scroller().clientHeight || window.innerHeight;

/** Listen for the column's scrolling; returns the stop. */
export function onColumnScroll(listener: () => void): () => void {
  const el = scroller();
  el.addEventListener('scroll', listener, { passive: true });
  return () => el.removeEventListener('scroll', listener);
}
