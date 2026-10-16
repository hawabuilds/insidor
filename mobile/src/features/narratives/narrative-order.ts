/**
 * The Narratives list's rules, apart from the screen so `node --test` holds them: which narratives
 * are listed, their order, and the words on each row.
 *
 *   Listed   only real narratives: the server says the story was observed (`provenance`), never a
 *            seeded or hand-written one, and it lists at least one post. Which narratives are real
 *            beyond that is the server's call (its grouping and gates); this file adds no test of its own.
 *   Order    fastest-growing first: by views gained in the last hour (`viewsGained1h`), the owner's
 *            order (2026-10-16).
 *
 * ★ AN UNKNOWN NEVER SORTS AS ZERO. A narrative whose last hour the server did not send, or could not
 * say, goes after every one that has it, in the board's order among themselves, so a missing number
 * can neither promote a row nor bury it as the slowest. While the server sends the gain for none of
 * them (it does not yet), the list is the board's order and the screen says so.
 *
 * And the stage's word for a row (Early, Forming, Big), which the server names; this file only spells it.
 */

import type { Story } from '../../shared/api/index.ts';
import { compact } from '../../shared/format/number.ts';

/** Only narratives the server says happened, with a post to show. */
export function realNarratives(list: readonly Story[]): readonly Story[] {
  return list.filter((s) => s.provenance.kind === 'observed' && s.evidence.length > 0);
}

const gainOf = (s: Story): number | null => (s.viewsGained1h !== null && s.viewsGained1h.known ? s.viewsGained1h.amount : null);

/** Fastest-growing first; unknown gains after, in the order they came. */
export function byLastHour(list: readonly Story[]): readonly Story[] {
  const known = list.filter((s) => gainOf(s) !== null);
  const unknown = list.filter((s) => gainOf(s) === null);
  return [...known].sort((a, b) => (gainOf(b) ?? 0) - (gainOf(a) ?? 0)).concat(unknown);
}

/** Whether any row has a last hour to order by. */
export function anyLastHour(list: readonly Story[]): boolean {
  return list.some((s) => gainOf(s) !== null);
}

/** "+12K last hour", or null when the server did not say. */
export function lastHourLine(s: Story): string | null {
  const g = gainOf(s);
  return g === null ? null : `${g >= 0 ? '+' : ''}${compact(g)} last hour`;
}

/** The stage's word on the row. Null when the server named none: no label, never a guess. */
export function stageLabel(s: Story): string | null {
  if (s.stage === 'early') return 'Early';
  if (s.stage === 'forming') return 'Forming';
  if (s.stage === 'big') return 'Big';
  return null;
}

/** "9 posts on X, TikTok". A count of the posts we list, and the sites they are on. */
export function postsLine(s: Story): string {
  const n = s.evidence.length;
  const sites = [...new Set(s.evidence.map((e) => e.sourceLabel))].join(', ');
  if (n === 0) return 'No posts listed';
  return `${n === 1 ? '1 post' : `${n} posts`} on ${sites}`;
}
