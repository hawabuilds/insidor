/**
 * The Narratives tab's first page, by name: the key it is kept under (shared/kept-reads.ts) and the
 * read that fills it. Its own file so the tab (Narratives.tsx) and the read ahead
 * (shared/prefetch.ts) share one key without the read ahead importing the screen, which would
 * make an import loop through the post sheet. What breaks if changed carelessly: two spellings of
 * the key and the read ahead fills a key the tab never looks at.
 */

import { BOARD_VIEW, fetchAllNarratives, type NarrativeListSort } from '../../shared/api/index.ts';

/** The first page this phone last read for a list, kept to show while it is read again. */
export const firstPageKey = (sort: NarrativeListSort, on: 'x' | 'tiktok' | null): string => `narratives:${BOARD_VIEW}:${sort}:${on ?? 'all'}`;

export const readFirstPage = (sort: NarrativeListSort, on: 'x' | 'tiktok' | null) => (signal: AbortSignal) => fetchAllNarratives(BOARD_VIEW, sort, 0, on, signal);
