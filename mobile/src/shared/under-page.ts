/**
 * WHICH KEPT PAGE IS UNDER THE ONE ON SCREEN, so the back swipe (shared/ui/EdgeBack.tsx) can show
 * it sliding in underneath, as iPhone's own back swipe does (the owner, 2026-11-01: "dont leave it
 * out do it").
 *
 * App.tsx keeps earlier screens drawn but hidden (a bottom tab's wrapper `data-kept="tab:<tab>"`, a
 * page's `data-kept="page:<entry id>"`). History is a line numbered from 0 (shared/nav.ts
 * `insidorAt`), so the screen under the entry numbered n is whatever was last shown at n - 1: App
 * notes each arrival here, and the swipe asks for the one below. A screen not noted (opened from a
 * link with nothing of ours under it, or a page no longer kept) has nothing to show, and the swipe
 * shows the plain background instead of guessing.
 *
 * What breaks if changed carelessly: noting by entry id instead of number would miss a tab, which
 * is one wrapper shown across many entries; and a wrapper name that does not match App.tsx's
 * `data-kept` shows nothing underneath.
 */

type Shown = { readonly wrapper: string; readonly entry: string };

const byNumber = new Map<number, Shown>();

/** App.tsx, on every arrival: the entry numbered `at` shows `wrapper` (its `data-kept`). */
export function noteShown(at: number, wrapper: string, entry: string): void {
  byNumber.set(at, { wrapper, entry });
}

/** What Back from the entry numbered `at` lands on, if it was noted. */
export function underFor(at: number): Shown | null {
  return at > 0 ? (byNumber.get(at - 1) ?? null) : null;
}

/** The wrapper names App.tsx writes. */
export const tabWrapper = (tab: string): string => `tab:${tab}`;
export const pageWrapper = (entry: string): string => `page:${entry}`;
