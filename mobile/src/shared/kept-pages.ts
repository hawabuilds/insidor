/**
 * WHICH PAGES STAY DRAWN BEHIND THE ONE ON SCREEN, so Back shows the page it left exactly as it was
 * (the owner, 2026-10-21: "when i press back on any page on the app i want to see previous page and
 * it not be reset"): its scroll, its chosen chart window and tab, the posts it had loaded, a sheet
 * left open over it.
 *
 * The rule is one line of history: a page is kept while its entry is still behind the current one.
 * Every entry carries a number (its depth, shared/nav.ts) and an id. Arriving at an entry drops
 * every kept page at that depth or deeper (those entries are ahead of us now, or were replaced),
 * except the entry itself when it is the one we came back to. A NEW visit is a new id, so it is
 * never handed an old page: a fresh tap on the same narrative opens it fresh at the top.
 *
 * Pure and separate from the shell (App.tsx) so the rule is tested under `node --test`. The five
 * bottom tabs are not here: they stay drawn by tab for the app's life (App.tsx KeptTabs), so a tab
 * arrival keeps only the pages behind it. What breaks if changed carelessly: keeping a page whose
 * entry is ahead of us (or replaced) shows a stale page on a later fresh visit; dropping one still
 * behind us brings back the reset this exists to stop. `max` bounds memory on a very deep walk.
 */

export interface KeptPage<R> {
  /** The history entry's id (shared/nav.ts `insidorEntry`). */
  readonly id: string;
  /** The entry's depth: 0 for the entry the app opened on. */
  readonly at: number;
  readonly route: R;
  /** The route as an address: an entry rewritten in place keeps its page but takes the new route. */
  readonly href: string;
}

/** How many pages are kept drawn behind the one on screen at most; the oldest go first. */
export const MAX_KEPT_PAGES = 8;

/**
 * The kept pages after arriving at `here`. `page`: whether `here` is a page (kept) rather than a
 * bottom tab (never kept here). Returns the same array when nothing changed, so a render can compare.
 */
export function arrive<R>(pages: readonly KeptPage<R>[], here: KeptPage<R>, page: boolean, max = MAX_KEPT_PAGES): readonly KeptPage<R>[] {
  /* The same entry with its address rewritten in place (Feed settings becoming the list it sits on)
     is the same visit: its new route, drawn by the same page (the shell keys pages by id). */
  const same = pages.find((p) => p.id === here.id);
  const behind = pages.filter((p) => p.at < here.at && p.id !== here.id);
  const kept = page ? [...behind, same !== undefined && same.href === here.href ? same : here] : behind;
  const out = kept.length > max ? kept.slice(kept.length - max) : kept;
  return out.length === pages.length && out.every((p, i) => p === pages[i]) ? pages : out;
}
