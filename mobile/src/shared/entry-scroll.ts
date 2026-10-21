/**
 * WHERE EACH VISIT WAS SCROLLED TO, by history entry, so Back lands on the very spot it left
 * (the owner, 2026-10-21: Back must show the previous page "and it not be reset").
 *
 * Keyed by the entry's id (shared/nav.ts), never by address: a NEW visit to a narrative is a new
 * entry and starts at its top, while Back onto the old entry finds its old position. A bottom tab
 * reached by a new entry (a tap on the tab bar) has no position of its own yet, so it takes the
 * tab's last one — the owner's rule of 2026-10-18 that switching tabs never starts a tab over.
 *
 * Inner scrollers (a row of chips scrolled sideways, a sheet's list) are kept by element: a page
 * left behind stays drawn (App.tsx, shared/kept-pages.ts) but hidden, and a hidden element can lose
 * its offset, so the last offset each one reported is put back when its page shows again.
 *
 * ★ NOTHING IS NOTED WHILE A SHEET HOLDS THE PAGE (dismiss.ts `hold`): the page behind a sheet is
 * not being scrolled, and an iPhone can report 0 for it while it is held, which would be kept as
 * the place to come back to. Its own module so dismiss.ts and the shell share one store without
 * importing each other. What breaks if changed carelessly: noting a position for the entry being
 * left after the move (the page shrinks as it hides, and the clamped scroll is reported a frame
 * later) writes the wrong spot; the shell switches the noted entry before the new page draws.
 */

const byEntry = new Map<string, number>();
const byTab = new Map<string, number>();
/** Entries kept, at most; the oldest are forgotten first. */
const MAX_ENTRIES = 200;
const inner = new Map<Element, { readonly top: number; readonly left: number }>();

let current: { readonly id: string; readonly tab: string | null } | null = null;
let held = false;
let watching = false;

/**
 * Once, before the first frame and before nav.ts starts tracking (main.tsx): the position is noted
 * again at the very moment the address changes, before anything redraws. A scroll event comes a
 * frame after the scroll, and a page in the background draws no frames, so a tap straight after a
 * scroll (or a Back from a phone that has just woken) would otherwise leave without its last spot.
 */
export function noteBeforeMoves(): void {
  if (watching) return;
  watching = true;
  const note = () => noteWindow(window.scrollY);
  window.addEventListener('popstate', note);
  window.addEventListener('hashchange', note);
}

/** Where a visit opens: its own last position, else (a bottom tab) the tab's, else the top. Pure, for the tests. */
export function startAt(own: number | undefined, tab: number | undefined, isTab: boolean): number {
  if (own !== undefined) return own;
  return isTab ? (tab ?? 0) : 0;
}

/** The entry now on screen; positions from here on are its. Returns where it should open. */
export function showEntry(id: string, tab: string | null): number {
  current = { id, tab };
  return startAt(byEntry.get(id), tab === null ? undefined : byTab.get(tab), tab !== null);
}

/** The window was scrolled: kept for the entry on screen (and its tab), unless a sheet holds the page. */
export function noteWindow(y: number): void {
  if (current === null || held) return;
  byEntry.delete(current.id);
  byEntry.set(current.id, y);
  while (byEntry.size > MAX_ENTRIES) {
    const oldest = byEntry.keys().next().value;
    if (oldest === undefined) break;
    byEntry.delete(oldest);
  }
  if (current.tab !== null) byTab.set(current.tab, y);
}

/** Where `id` was last scrolled to, if it was. */
export function savedFor(id: string): number | undefined {
  return byEntry.get(id);
}

/** dismiss.ts: a sheet holds the page still (true) or has given it back (false). */
export function setHeld(on: boolean): void {
  held = on;
}

/** An inner scroller moved. */
export function noteInner(el: Element): void {
  inner.set(el, { top: el.scrollTop, left: el.scrollLeft });
}

/** Every inner scroller still in the page goes back to where it last was; ones gone are forgotten. */
export function restoreInner(): void {
  for (const [el, at] of inner) {
    if (!el.isConnected) {
      inner.delete(el);
      continue;
    }
    if (el.scrollTop !== at.top) el.scrollTop = at.top;
    if (el.scrollLeft !== at.left) el.scrollLeft = at.left;
  }
}
