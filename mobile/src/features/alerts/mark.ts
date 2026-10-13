/**
 * What sits at the left of a Feed or Notifications row: a rank badge, a coin's logo (the address the
 * alert service sends, else the one in the alert's own token link; its first letter only when there
 * is no logo), a rising post's poster's picture (an up arrow, Trador's face for a row that belongs to
 * no one person, when the poster has none; the same arrow on "N people found your comment useful", which
 * belongs to no one person either), a person's picture for a follow or a reply (their
 * monogram only when they have no picture: the name comes from the link or the title), a dollar sign for the owner's
 * supplier warning and supplier account alert, a turn arrow for the owner's twice-daily learning
 * report, or the bell.
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

export type MarkKind = { readonly kind: 'rank'; readonly rank: string } | { readonly kind: 'person'; readonly name: string; readonly picture?: string } | { readonly kind: 'coin'; readonly letter: string; readonly address?: string } | { readonly kind: 'rising'; readonly label: string; readonly picture?: string } | { readonly kind: 'useful'; readonly label: string } | { readonly kind: 'money'; readonly label: string } | { readonly kind: 'learned'; readonly label: string } | { readonly kind: 'bell' };

export function markOf(a: { readonly kind: string; readonly rank: string | null; readonly symbol: string | null; readonly href?: string; readonly title?: string; readonly picture?: string | null; readonly coin?: string | null }, ranks: readonly string[]): MarkKind {
  const picture = typeof a.picture === 'string' && a.picture.startsWith('https://') ? a.picture : null;
  if (a.rank !== null && ranks.includes(a.rank)) return { kind: 'rank', rank: a.rank };
  if (a.kind === 'supplier_warning') return { kind: 'money', label: 'Supplier spend' };
  if (a.kind === 'supplier_account') return { kind: 'money', label: 'Supplier account' };
  if (a.kind === 'retune_summary') return { kind: 'learned', label: 'Learning from your calls' };
  if (a.kind === 'comment_useful') return { kind: 'useful', label: 'Found useful' };
  if (a.kind === 'rising_post') return picture === null ? { kind: 'rising', label: 'Rising post' } : { kind: 'rising', label: 'Rising post', picture };
  const person = personOf(a);
  if (person !== null) return picture === null ? { kind: 'person', name: person } : { kind: 'person', name: person, picture };
  if (a.symbol !== null && a.symbol !== '') {
    const address = typeof a.coin === 'string' && a.coin !== '' ? a.coin : tokenAddress(a.href ?? '');
    return address === null ? { kind: 'coin', letter: a.symbol.charAt(0) } : { kind: 'coin', letter: a.symbol.charAt(0), address };
  }
  return { kind: 'bell' };
}

/** Who followed (their profile link, `/#/u/<handle>`) or replied (the title, "<name> replied"); null otherwise. */
export function personOf(a: { readonly kind: string; readonly href?: string; readonly title?: string }): string | null {
  if (a.kind === 'follow') {
    const m = /#\/u\/([^/?#]+)/.exec(a.href ?? '');
    if (m === null || m[1] === undefined) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return null;
    }
  }
  if (a.kind === 'reply') {
    const m = /^(.+) replied$/.exec(a.title ?? '');
    return m === null || m[1] === undefined || m[1] === 'Someone' ? null : m[1];
  }
  return null;
}

/** The coin's address from an alert's token link (`/#/token/solana%3A<address>`); null for any other link. */
export function tokenAddress(href: string): string | null {
  const m = /#\/token\/([^/?#]+)/.exec(href);
  if (m === null || m[1] === undefined) return null;
  let id: string;
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const address = id.startsWith('solana:') ? id.slice('solana:'.length) : '';
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? address : null;
}
