/**
 * WHAT THE OWNER'S COIN CALLS ON ONE POST ADD UP TO, read in the order they were made.
 *
 * The owner's coin calls are append-only (the store keeps every tap): "This is the coin" (`right`,
 * with its coin), "Wrong coin" (`wrong`), "No coin is from this" (`none`) and "Remove my label"
 * (`cleared`). This folds one post's calls into three facts every reader needs:
 *
 *   own    the coin the owner says is the post's, and when they said it, or null
 *   wrong  each coin the owner says is NOT the post's, and when
 *   none   the newest standing call is "No coin is from this"
 *
 * ★ "WRONG" WITH A COIN IS USUALLY THE RIGHT COIN. The app saves "Wrong coin" at once with no coin
 * (the coin the card showed is in `shown`), then "This one" in the sheet saves `wrong` again WITH the
 * coin the owner picked — the right one. So `wrong` + a coin reads as `right` with that coin, and
 * the card's shown coin as wrong. The one exception is a RETRACTION: `wrong` naming a coin an
 * earlier `right` on the same post named (the owner's 2026-10-13 KARL label, rows 15 then 183) takes
 * that coin back and marks it wrong. `cleared` drops the standing calls but not that history: a
 * later `wrong` on a coin once called right is still a retraction.
 *
 * Pure and its own file because three readers must agree to the letter — the projector (which coin a
 * post shows, and which it must never show), the re-tune and the coin-match refit (which labels they
 * test on) — and a fourth spelling of the rule, in SQL, lives in the store
 * (store/src/repo/owner-coin-calls.ts); the tests here pin the cases both must answer the same way.
 *
 * What breaks if changed carelessly: the ORDER. Calls are folded oldest first, by time then id;
 * folding newest first would make every retraction look like a confirmation and every change of
 * mind powerless.
 */

/** One stored coin call. `shownCoin`: the address of the coin the card showed when it was made, if one. */
export interface CoinCallRow {
  readonly itemId: string;
  readonly verdict: string;
  readonly coinAddress: string | null;
  readonly shownCoin: string | null;
  readonly atMs: number;
  readonly id: number;
}

export interface PostCoinCalls {
  readonly own: { readonly address: string; readonly atMs: number } | null;
  /** Address → when the owner said it is not this post's coin. */
  readonly wrong: ReadonlyMap<string, number>;
  readonly none: boolean;
}

/** The address in a stored coin id ('<chain>:<address>'), or the value as given when it has no chain. */
export function addressOfCoinId(coinId: string | null | undefined): string | null {
  if (typeof coinId !== 'string' || coinId.trim() === '') return null;
  const at = coinId.lastIndexOf(':');
  const a = at < 0 ? coinId : coinId.slice(at + 1);
  return a.trim() === '' ? null : a.trim();
}

/** Every post's calls folded, oldest first. A post whose calls add up to nothing is still present, empty. */
export function foldCoinCalls(rows: readonly CoinCallRow[]): ReadonlyMap<string, PostCoinCalls> {
  const sorted = [...rows].sort((a, b) => a.atMs - b.atMs || a.id - b.id);
  const state = new Map<string, { own: { address: string; atMs: number } | null; wrong: Map<string, number>; none: boolean; namedRight: Set<string> }>();
  for (const r of sorted) {
    const s = state.get(r.itemId) ?? { own: null, wrong: new Map<string, number>(), none: false, namedRight: new Set<string>() };
    state.set(r.itemId, s);
    const coin = r.coinAddress !== null && r.coinAddress.trim() !== '' ? r.coinAddress.trim() : null;
    if (r.verdict === 'right' && coin !== null) {
      s.own = { address: coin, atMs: r.atMs };
      s.wrong.delete(coin);
      s.none = false;
      s.namedRight.add(coin);
    } else if (r.verdict === 'wrong' && coin !== null && s.namedRight.has(coin)) {
      /* A retraction: the coin an earlier "This is the coin" named is not it after all. */
      if (s.own?.address === coin) s.own = null;
      s.wrong.set(coin, r.atMs);
      s.none = false;
    } else if (r.verdict === 'wrong' && coin !== null) {
      /* "Wrong coin", then "This one": the picked coin is the post's, the shown one is not. */
      s.own = { address: coin, atMs: r.atMs };
      s.wrong.delete(coin);
      if (r.shownCoin !== null && r.shownCoin !== coin) s.wrong.set(r.shownCoin, r.atMs);
      s.none = false;
    } else if (r.verdict === 'wrong') {
      if (r.shownCoin !== null) s.wrong.set(r.shownCoin, r.atMs);
      /* The shown coin was the owner's own, or we cannot tell which coin was shown: no owner coin. */
      if (r.shownCoin === null || s.own?.address === r.shownCoin) s.own = null;
      s.none = false;
    } else if (r.verdict === 'none') {
      s.own = null;
      s.none = true;
    } else if (r.verdict === 'cleared') {
      s.own = null;
      s.wrong.clear();
      s.none = false;
    }
  }
  return new Map([...state].map(([id, s]) => [id, { own: s.own, wrong: s.wrong, none: s.none }] as const));
}

/**
 * The label a post's calls give the coin-match test: its coin, `none`, or nothing to test
 * (no call, a cleared one, or only coins said to be wrong).
 */
export function coinLabelOf(calls: PostCoinCalls | undefined): { readonly right: string | null } | null {
  if (calls === undefined) return null;
  if (calls.own !== null) return { right: calls.own.address };
  if (calls.none) return { right: null };
  return null;
}
