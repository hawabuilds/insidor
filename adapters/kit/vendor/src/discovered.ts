/**
 * The one place in adapters/ that constructs a `Discovered`.
 *
 * Three platform adapters return this shape and there is nothing platform-
 * specific about assembling it, so it is built here rather than three times.
 * The practical value is narrow and real: when the port changes, one file
 * changes.
 */

import type { Item } from '@insidor/contracts';
import type { Discovered } from '@insidor/contracts/ports/platform.ts';

/**
 * @param cursor  null means "we have no way to ask for more", which is not the
 *                same as "there is no more".
 * @param hasMore true only when the VENDOR said so. A guess here either loops
 *                forever or stops a page early, and both look like working code.
 */
export function discovered(items: readonly Item[], cursor: string | null, hasMore: boolean): Discovered {
  return { items, cursor, hasMore };
}
