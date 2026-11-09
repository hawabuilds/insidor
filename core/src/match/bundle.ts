/**
 * WHETHER A COIN'S HOLDERS ARE ONE HOLDER (Policy.oneCoin.bundle; the owner, 2026-11-09, $GTA6: "isn't
 * this a scam too?"). A bundler splits a coin's supply into many wallets of exactly the same size so it
 * reads as widely held, then trades tiny amounts between them to hold the price still: GTA6 stood at
 * $5.9M four minutes after its launch, and 19 of its 20 largest holders held exactly 301,080 tokens
 * each — some 98% of the supply in one hand that can sell it at any moment.
 *
 * Buyers on a curve or in a pool pay different prices and get different amounts; many of the largest
 * holders sharing one whole-token amount is a transfer pattern, not trading. So the rule is the size of
 * the largest group of the top holders that hold the same whole amount: `sameAmountMin` or more is a
 * bundle. An empty account (sold out) holds nothing and is in no group.
 *
 * Pure: the amounts are read by the caller (the venue adapter's `topHolders`), and an unread coin is
 * never judged here — the caller decides what an unknown means.
 *
 * What breaks if changed carelessly: comparing raw units instead of whole tokens catches only exact
 * transfers, and comparing the share of supply instead catches nothing a bundler rounds.
 */

/** True when at least `sameAmountMin` of these holders hold the same whole-token amount. */
export function bundledHolders(wholeAmounts: readonly string[], sameAmountMin: number): boolean {
  const groups = new Map<string, number>();
  for (const a of wholeAmounts) {
    const k = a.replace(/^0+/, '');
    if (k === '') continue;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  return [...groups.values()].some((n) => n >= sameAmountMin);
}
