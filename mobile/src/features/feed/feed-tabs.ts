/**
 * THE BOARD'S ROWS IN THE SERVER'S ORDER. The board reply carries its order as an array of ids
 * beside the rows (the live channel patches rows one at a time, so the order has to survive that);
 * this puts the rows back into it. Never re-sorted here: the ranking is the server's.
 *
 * Home no longer lists the board's narratives (the owner, 2026-10-17: narratives live on their own
 * tab), so For You's tabs no longer come from here; the board rows' filters (feed-filters.ts) still
 * take their rows in this order. What breaks if changed carelessly: an id with no row is skipped,
 * never turned into an empty row.
 */

import type { BoardRow } from '../../shared/api/index.ts';

export function rowsInOrder(order: readonly string[], rows: readonly BoardRow[]): readonly BoardRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return order.flatMap((id) => {
    const r = byId.get(id);
    return r === undefined ? [] : [r];
  });
}
