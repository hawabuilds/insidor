/**
 * THE SWIPE FROM THE LEFT EDGE THAT GOES BACK, in the iPhone home-screen app (a user, 2026-11-01:
 * "add swipe tech to your app I don't wanna scroll to the top to click the back arrow"; the owner:
 * "i want the iphone homescreen swipe only" — the page itself slides away under the finger, as
 * iPhone's own back swipe does, with nothing drawn on top of it).
 *
 * An app added to the Home Screen has no back swipe of its own (shared/nav.ts), so a page's only way
 * back was its arrow, at the top of a long page. Safari has its own edge swipe and Android its own
 * system back, so this is on only where `navigator.standalone` is true: the iPhone home-screen app.
 * Turning it on anywhere else would go back twice for one swipe.
 *
 * ★ THE SWIPE DOES EXACTLY WHAT BACK DOES ON THAT SCREEN, never a Back of its own. Each screen's
 * arrow knows its own parent (goBack's fallback differs per screen), so the swipe presses the arrow
 * showing on screen. With a sheet or pop-up open it is the phone's back instead (`history.back()`),
 * which closes the top layer only (shared/ui/dismiss.ts). On a screen with no arrow (a bottom tab's
 * own screen) the swipe does nothing and nothing moves.
 *
 * This file is the decision, pure for the tests: where a swipe may start, when it is a scroll
 * instead, and whether letting go goes back. EdgeBack.tsx listens and moves the page.
 *
 * What breaks if changed carelessly: a wider `EDGE_PX` starts swipes on things people drag (a chart,
 * a row of coins); a looser vertical cancel turns ordinary scrolling near the edge into going back.
 */

/** A swipe starts only this close to the left edge. */
export const EDGE_PX = 24;
/** Let go this far in, it goes back. */
export const COMMIT_PX = 80;
/** Or a flick: at least this far, this fast (px per ms). */
export const FLICK_PX = 40;
export const FLICK_SPEED = 0.5;
/** A swipe that moves this much up or down before this much across is a scroll, and is dropped. */
export const CANCEL_DY = 24;
export const DECIDE_DX = 12;

export type Phase = 'tracking' | 'dropped';

/** Whether a touch at `x` may start a swipe. */
export const startsSwipe = (x: number): boolean => x >= 0 && x <= EDGE_PX;

/** While the finger moves: is it still a back swipe, or a scroll that started near the edge. */
export function phaseOf(dx: number, dy: number, decided: boolean): Phase {
  if (decided) return dx < -DECIDE_DX ? 'dropped' : 'tracking';
  if (Math.abs(dy) >= CANCEL_DY && Math.abs(dy) > dx) return 'dropped';
  return 'tracking';
}

/** Has the swipe gone far enough across to count as a sideways swipe (after which it is never dropped for drifting up or down). */
export const decidedBy = (dx: number, dy: number): boolean => dx >= DECIDE_DX && dx > Math.abs(dy);

/** On letting go: back, or nothing. */
export function goesBack(dx: number, ms: number): boolean {
  if (dx >= COMMIT_PX) return true;
  return dx >= FLICK_PX && ms > 0 && dx / ms >= FLICK_SPEED;
}
