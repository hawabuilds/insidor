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
 * ★ EVERY ENTRY ALSO CARRIES ITS OWN ID (`insidorEntry`), so Back can find the page that entry
 * showed exactly as it was left (App.tsx keeps it drawn, shared/entry-scroll.ts keeps its scroll).
 * The id, not the address, is what names a visit: a NEW tap on the same narrative is a new entry with
 * a new id and opens fresh at the top; only coming back onto the old entry finds the old page. A
 * sheet's own entries (dismiss.ts) copy the state and so share their screen's id. `replaceTo` puts
 * a different screen in the entry, so it takes a new id (and no sheet depth: nothing is open on it).
 *
 * Separate from route.ts (pure, no window) and dismiss.ts (sheets): this is the one place that
 * knows how deep the app's own history is. What breaks if changed carelessly: anything that pushes
 * an entry without `entryState` leaves it unnumbered, and a Back from the screen after it may
 * replace instead of returning; an id carried onto a different screen hands that screen the old
 * one's kept page.
 */

import { hrefFor, type Route } from './route.ts';

const KEY = 'insidorAt';
const ENTRY = 'insidorEntry';
/** The layer depth dismiss.ts writes; a replaced entry starts with none. */
const LAYER = 'insidorLayer';
let at = 0;
let tracking = false;
let made = 0;

/** A new entry id: unique within this tab's history, which is all an id has to tell apart. */
function newId(): string {
  made += 1;
  return `${Date.now().toString(36)}.${made.toString(36)}`;
}

function stateObject(): Record<string, unknown> {
  const s: unknown = history.state;
  return s !== null && typeof s === 'object' ? { ...(s as Record<string, unknown>) } : {};
}

function numberOf(s: unknown): number | null {
  const n = s !== null && typeof s === 'object' ? (s as Record<string, unknown>)[KEY] : undefined;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

/** The entry id a history state carries, or null. Pure, for the tests. */
export function entryIdOf(s: unknown): string | null {
  const id = s !== null && typeof s === 'object' ? (s as Record<string, unknown>)[ENTRY] : undefined;
  return typeof id === 'string' && id !== '' ? id : null;
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
  const s = stateObject();
  history.replaceState({ ...s, [KEY]: n, [ENTRY]: entryIdOf(s) ?? newId() }, '');
  at = n;
}

/**
 * A new entry is unnumbered when it arrives; an entry we come back to already has its number. One
 * pushed by hand (push-open.ts) has a number but no id until it is first shown.
 */
function onMove(): void {
  const n = numberOf(history.state);
  if (n === null) stamp(at + 1);
  else if (entryIdOf(history.state) === null) stamp(n);
  else at = n;
}

/** Where the app is in its history: the entry's id and its number (0 for the entry it opened on). */
export function entryNow(): { readonly id: string; readonly at: number } {
  const id = entryIdOf(history.state);
  if (id !== null) return { id, at: numberOf(history.state) ?? at };
  /* Not yet stamped (only before trackHistory, or by a hand push before its hashchange): stamped now. */
  stamp(numberOf(history.state) ?? at);
  return { id: entryIdOf(history.state) ?? '', at };
}

/** Once, before the first frame (main.tsx): number the entry the app opened on, then every move. */
export function trackHistory(): void {
  if (tracking) return;
  tracking = true;
  const n = numberOf(history.state);
  stamp(n ?? 0);
  window.addEventListener('popstate', onMove);
  window.addEventListener('hashchange', onMove);
}

/**
 * Show `route` in place of the current entry, without adding one: a new screen, so a new id and no
 * open sheet. `sameVisit`: only the address is rewritten on the screen already showing (Feed
 * settings becoming the list under it), so the entry keeps its id and the page stays as it is.
 */
export function replaceTo(route: Route, opts: { readonly sameVisit?: boolean } = {}): void {
  const { [LAYER]: _layer, ...rest } = stateObject();
  const id = opts.sameVisit === true ? (entryIdOf(rest) ?? newId()) : newId();
  history.replaceState({ ...rest, [KEY]: at, [ENTRY]: id }, '', hrefFor(route));
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Back: to the screen they came from if it is ours, else to this screen's parent. */
export function goBack(fallback: Route): void {
  if (backStep(numberOf(history.state) ?? at) === 'history') history.back();
  else replaceTo(fallback);
}
