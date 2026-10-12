/**
 * The one place in adapters/ that constructs a `Discovered`.
 *
 * Three platform adapters return this shape and there is nothing platform-
 * specific about assembling it, so it is built here rather than three times.
 * The practical value is narrow and real: when the port changes, one file
 * changes.
 */

import type { Author, Item } from '@insidor/contracts';
import type { Discovered } from '@insidor/contracts/ports/platform.ts';

/**
 * @param cursor  null means "we have no way to ask for more", which is not the
 *                same as "there is no more".
 * @param hasMore true only when the VENDOR said so. A guess here either loops
 *                forever or stops a page early, and both look like working code.
 */
export function discovered(
  items: readonly Item[],
  authors: readonly Author[],
  cursor: string | null,
  hasMore: boolean,
): Discovered {
  return { items, authors: uniqueAuthors(authors), cursor, hasMore };
}

/**
 * One author per key, the last description in the response winning. A page with ten posts
 * by one account describes that account ten times; the store should be told once.
 */
export function uniqueAuthors(authors: readonly Author[]): readonly Author[] {
  const byKey = new Map<string, Author>();
  for (const author of authors) byKey.set(author.authorKey, author);
  return [...byKey.values()];
}
