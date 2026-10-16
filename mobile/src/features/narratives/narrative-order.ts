/**
 * The Narratives tab's rules, apart from the screen so `node --test` holds them: which narratives
 * are listed, the three orders behind its chips, and the words on each card.
 *
 *   Listed   only real narratives: the server says the story was observed (`provenance`), never a
 *            seeded or hand-written one, and it lists at least one post. Which narratives are real
 *            beyond that is the server's call (its grouping and gates); this file adds no test of its own.
 *   Fastest  the default (the owner, 2026-10-17): views gained in the last hour (`viewsGained1h`),
 *            highest first
 *   Most views  the narrative's total across its posts (`viewsTotal`)
 *   Newest   first found (`foundAt`, the earliest save of any post it lists), newest first
 *
 * ★ AN UNKNOWN NEVER SORTS AS ZERO. A narrative whose number the server did not send, or could not
 * say, goes after every one that has it, in the board's order among themselves, so a missing number
 * can neither promote a card nor bury it as the slowest.
 */

import type { Story } from '../../shared/api/index.ts';
import { compact } from '../../shared/format/number.ts';

export const ORDERS = ['fastest', 'views', 'newest'] as const;
export type Order = (typeof ORDERS)[number];
export const ORDER_LABEL: Readonly<Record<Order, string>> = { fastest: 'Fastest', views: 'Most views', newest: 'Newest' };

/** Only narratives the server says happened, with a post to show. */
export function realNarratives(list: readonly Story[]): readonly Story[] {
  return list.filter((s) => s.provenance.kind === 'observed' && s.evidence.length > 0);
}

const gainOf = (s: Story): number | null => (s.viewsGained1h !== null && s.viewsGained1h.known ? s.viewsGained1h.amount : null);
const viewsOf = (s: Story): number | null => (s.viewsTotal !== null && s.viewsTotal.known ? s.viewsTotal.amount : null);
const foundOf = (s: Story): number | null => (s.foundAt !== null && s.foundAt.known ? s.foundAt.at : s.firstSeenAt.known ? s.firstSeenAt.at : null);

const KEY: Readonly<Record<Order, (s: Story) => number | null>> = { fastest: gainOf, views: viewsOf, newest: foundOf };

/** Highest first by the chip's number; unknowns after, in the order they came. */
export function ordered(list: readonly Story[], order: Order): readonly Story[] {
  const key = KEY[order];
  const known = list.filter((s) => key(s) !== null);
  const unknown = list.filter((s) => key(s) === null);
  return [...known].sort((a, b) => (key(b) ?? 0) - (key(a) ?? 0)).concat(unknown);
}

/** Fastest-growing first: the tab's default. */
export const byLastHour = (list: readonly Story[]): readonly Story[] => ordered(list, 'fastest');

/** Whether any card has a last hour to order by. */
export function anyLastHour(list: readonly Story[]): boolean {
  return list.some((s) => gainOf(s) !== null);
}

/** "+12K", or null when the server did not say. */
export function lastHourGain(s: Story): string | null {
  const g = gainOf(s);
  return g === null ? null : `${g >= 0 ? '+' : ''}${compact(g)}`;
}

/** "9 posts", and "4.2M views" when the server sent the total. */
export function postsLine(s: Story): readonly string[] {
  const n = s.postCount ?? s.evidence.length;
  const v = viewsOf(s);
  return [n === 1 ? '1 post' : `${n} posts`, ...(v !== null ? [`${compact(v)} views`] : [])];
}
