/**
 * What sits at the left of an alert row: a rank badge, a coin's first letter, a dollar sign for
 * the owner's supplier warning, a turn arrow for the owner's twice-daily learning report, or the bell.
 *
 * Its own pure file so the choice is tested without rendering. The supplier warning gets its own
 * mark because it is the one row about the owner's own money rather than a coin or a person, and
 * among a day of coin alerts it has to be findable at a glance. It is chosen by the alert's kind,
 * never by its facts: the list carries no spend figures, only the text the server wrote. The
 * learning report gets its own for the same reason: it is about the feed learning from the
 * owner's calls, not about a coin, and should not read as a coin row.
 *
 * What breaks if changed carelessly: the order. A rank is checked first because a rank-up carries
 * no symbol; a coin before the bell because most rows are coins.
 */

export type MarkKind = { readonly kind: 'rank'; readonly rank: string } | { readonly kind: 'coin'; readonly letter: string } | { readonly kind: 'money'; readonly label: string } | { readonly kind: 'learned'; readonly label: string } | { readonly kind: 'bell' };

export function markOf(a: { readonly kind: string; readonly rank: string | null; readonly symbol: string | null }, ranks: readonly string[]): MarkKind {
  if (a.rank !== null && ranks.includes(a.rank)) return { kind: 'rank', rank: a.rank };
  if (a.kind === 'supplier_warning') return { kind: 'money', label: 'Supplier spend' };
  if (a.kind === 'retune_summary') return { kind: 'learned', label: 'Learning from your calls' };
  if (a.symbol !== null && a.symbol !== '') return { kind: 'coin', letter: a.symbol.charAt(0) };
  return { kind: 'bell' };
}
