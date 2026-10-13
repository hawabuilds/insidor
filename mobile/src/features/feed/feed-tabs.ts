/**
 * WHICH ROWS EACH FEED TAB SHOWS, AND IN WHAT ORDER.
 *
 * There is one board on the read service (`default`), so all three tabs are views of it:
 *
 *   FYP        the board, in the order the server committed. Never re-sorted here — the
 *              ranking is the server's, and the desktop app holds the same line.
 *   Popular    the same rows, most viewed first. ★ THIS IS A SORT ON THE CLIENT, and it is
 *              deliberate rather than a lapse: it orders by one published fact (views), it
 *              makes no judgement the server has not made, and the tab says what it is. When
 *              the read service serves a popular view of its own, this becomes a fetch.
 *              ★ Rows whose views are unknown are NOT sorted as zero — they come after the
 *              counted ones, as their own group, so "not reported" never reads as "least seen".
 *   News       a feed of single posts like FYP's (Feed.tsx reads `GET /rising/news`); over the
 *              board it is the server's order, as FYP is.
 *   Watchlist  starred rows, in the server's order. A starred story that is not on the board
 *              right now is counted, so an empty list can say why it is empty.
 */

import type { BoardRow } from '../../shared/api/index.ts';

export type FeedTab = 'watchlist' | 'fyp' | 'popular' | 'news';

export interface TabView {
  readonly rows: readonly BoardRow[];
  /** Popular only: rows with no view count, shown after the counted ones under a label. */
  readonly uncounted: readonly BoardRow[];
  /** Watchlist only: starred stories that are not on the board right now. */
  readonly starredOffBoard: number;
}

export function rowsInOrder(order: readonly string[], rows: readonly BoardRow[]): readonly BoardRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return order.flatMap((id) => {
    const r = byId.get(id);
    return r === undefined ? [] : [r];
  });
}

export function tabView(tab: FeedTab, ordered: readonly BoardRow[], starred: readonly string[]): TabView {
  switch (tab) {
    case 'fyp':
    case 'news':
      return { rows: ordered, uncounted: [], starredOffBoard: 0 };
    case 'popular': {
      const counted = ordered.filter((r) => r.reach.known);
      const amount = (r: BoardRow) => (r.reach.known ? r.reach.amount : 0);
      /* Stable: equal views keep the server's order between them. */
      const sorted = [...counted].sort((a, b) => amount(b) - amount(a));
      return { rows: sorted, uncounted: ordered.filter((r) => !r.reach.known), starredOffBoard: 0 };
    }
    case 'watchlist': {
      const on = new Set(ordered.map((r) => r.id));
      return {
        rows: ordered.filter((r) => starred.includes(r.id)),
        uncounted: [],
        starredOffBoard: starred.filter((id) => !on.has(id)).length,
      };
    }
  }
}
