/**
 * The kept-read key of a coin's own facts (SearchedToken), and the one way another screen may put
 * what it already knows of a coin there before opening its page.
 *
 * Apart from SearchedToken.tsx so a list (the Portfolio's holdings) can use it without loading the
 * token page's code with the list. Why it exists (the owner, 2026-10-21: tapping Laura in the
 * Portfolio did not open its chart): the page waited for the read service before drawing anything,
 * and for a coin the service had to look up first that wait was the whole tap. Now the page opens
 * at once on the row's name, ticker and picture, and its own read replaces them a moment later;
 * the chart fills in after.
 *
 * ★ ONLY WHAT THE ROW KNOWS, NEVER A NUMBER IT DOES NOT. Market cap and launch time are pending
 * ("not read yet") until the page's read lands; nothing here is a guess. In memory only, and never
 * over an answer already kept, so a real read is never replaced by a stand-in.
 *
 * What breaks if changed carelessly: the key. SearchedToken reads exactly this key; two spellings
 * would leave the page waiting again with nothing on it.
 */

import type { SearchedCoin } from '../../shared/api/index.ts';
import { keep, kept } from '../../shared/kept-reads.ts';

export const searchedKey = (coinId: string): string => `searched:${coinId}`;

/** Put a row's own facts of a coin where its page reads first, unless the page already has its own. */
export function primeSearchedCoin(c: { readonly coinId: string; readonly address: string; readonly name: string | null; readonly ticker: string | null; readonly imageUrl: string | null }): void {
  const key = searchedKey(c.coinId);
  if (kept(key) !== undefined) return;
  const coin: SearchedCoin = {
    coinId: c.coinId,
    address: c.address,
    name: c.name,
    ticker: c.ticker,
    imageUrl: c.imageUrl,
    marketCapUsd: { known: false, pending: 'not_read_yet' },
    launchedAt: { known: false, pending: 'not_read_yet' },
    venue: null,
  };
  keep(key, coin, false);
}
