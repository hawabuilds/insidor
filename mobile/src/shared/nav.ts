/**
 * BACK THAT ALWAYS LEADS SOMEWHERE, even in the home-screen app, where there is no browser back.
 *
 * An app added to an iPhone's Home Screen has no back button and no back swipe, and it often
 * starts on the very screen a link or a notification named, with nothing under it. A Back button
 * that only calls `history.back()` then does nothing at all, and the screen cannot be left except
 * through the tab bar (the owner, 2026-10-14). So every Back in the app goes through `goBack`:
 *
 *   an entry of ours under this one   history.back(), so Back returns to where they came from
 *   nothing of ours under it          the screen's own parent (`fallback`), in place of this entry
 *
 * To know which, every history entry this page makes is numbered in `history.state` (`insidorAt`):
 * 0 for the entry the app opened on, one more for each screen after it. A number above 0 means an
 * entry of ours lies under this one. The number survives a reload with the entry itself.
 *
 * `replaceTo` changes screen without adding an entry and WITHOUT `location.replace`: on iPhone
 * Safari `location.replace('#…')` keeps the old entry's `history.state`, so a sheet's history entry
 * survived its own close and stepped the app back onto the screen that opened it (the Feed settings
 * that could not be left). `replaceState` with a state we write ourselves behaves the same in
 * every browser.
 *
 * Separate from route.ts (pure, no window) and dismiss.ts (sheets): this is the one place that
 * knows how deep the app's own history is. What breaks if changed carelessly: anything that pushes
 * an entry without `entryState` leaves it unnumbered, and a Back from the screen after it may
 * replace instead of returning.
 */

import { hrefFor, type Route } from './route.ts';

const KEY = 'insidorAt';
let at = 0;
let tracking = false;

function stateObject(): Record<string, unknown> {
  const s: unknown = history.state;
  return s !== null && typeof s === 'object' ? { ...(s as Record<string, unknown>) } : {};
}

function numberOf(s: unknown): number | null {
  const n = s !== null && typeof s === 'object' ? (s as Record<string, unknown>)[KEY] : undefined;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

/** What Back does from an entry numbered `n` (null: not numbered). Pure, for the tests. */
export function backStep(n: number | null): 'history' | 'fallback' {
  return n !== null && n > 0 ? 'history' : 'fallback';
}

/** The state for an entry pushed by hand at depth `n` (push-open.ts's launch steps). */
export function entryState(n: number): Record<string, number> {
  return { [KEY]: n };
}

/** Add an entry at `url` by hand (no hashchange fires for it), numbered one past this one. */
export function pushEntry(url: string): void {
  at += 1;
  history.pushState(entryState(at), '', url);
}

function stamp(n: number): void {
  history.replaceState({ ...stateObject(), [KEY]: n }, '');
  at = n;
}

/** A new entry is unnumbered when it arrives; an entry we come back to already has its number. */
function onMove(): void {
  const n = numberOf(history.state);
  if (n === null) stamp(at + 1);
  else at = n;
}

/** Once, before the first frame (main.tsx): number the entry the app opened on, then every move. */
export function trackHistory(): void {
  if (tracking) return;
  tracking = true;
  const n = numberOf(history.state);
  if (n === null) stamp(0);
  else at = n;
  window.addEventListener('popstate', onMove);
  window.addEventListener('hashchange', onMove);
}

/** Show `route` in place of the current entry, without adding one. */
export function replaceTo(route: Route): void {
  history.replaceState({ ...stateObject(), [KEY]: at }, '', hrefFor(route));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Back: to the screen they came from if it is ours, else to this screen's parent. */
export function goBack(fallback: Route): void {
  if (backStep(numberOf(history.state) ?? at) === 'history') history.back();
  else replaceTo(fallback);
}
