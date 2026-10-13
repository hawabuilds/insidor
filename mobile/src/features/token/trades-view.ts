/**
 * THE TRADES LIST'S DECISIONS, apart from the panel so `node --test` holds them: which trades a
 * filter keeps, what each row is keyed by, and which rows arrived since the last read.
 *
 * Trador's tape has two scopes, All and Mine. The owner asked for buys and sells too, so the
 * rail here is All, Buys, Sells, and Mine when a wallet is signed in. "Mine" is the tape's own
 * trades whose wallet is yours — the latest trades the market source lists, not your whole
 * history (that is Portfolio's), and the empty line says exactly that.
 *
 * What breaks if changed carelessly: the key. A trade with no transaction is keyed by its time,
 * side and size; keying by position would mark every row as new each time one arrives.
 */

import type { MarketTrade } from '../../shared/api/index.ts';

export type TapeFilter = 'all' | 'buys' | 'sells' | 'mine';

export const TAPE_FILTERS: readonly { readonly value: TapeFilter; readonly label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'buys', label: 'Buys' },
  { value: 'sells', label: 'Sells' },
  { value: 'mine', label: 'Mine' },
];

/** The filters on offer: Mine only for a signed-in wallet, since without one it has nothing to match. */
export function filtersFor(account: string | null): readonly { readonly value: TapeFilter; readonly label: string }[] {
  return account === null ? TAPE_FILTERS.filter((f) => f.value !== 'mine') : TAPE_FILTERS;
}

export function filterTape(trades: readonly MarketTrade[], filter: TapeFilter, account: string | null): readonly MarketTrade[] {
  switch (filter) {
    case 'buys':
      return trades.filter((t) => t.side === 'buy');
    case 'sells':
      return trades.filter((t) => t.side === 'sell');
    case 'mine':
      return account === null ? [] : trades.filter((t) => t.maker === account);
    default:
      return trades;
  }
}

export function tradeKey(t: MarketTrade): string {
  if (t.tx !== null) return `${t.tx}:${t.side}`;
  return `${t.at.known ? t.at.at : 'at?'}:${t.side}:${t.tokenAmount.known ? t.tokenAmount.amount : 'n?'}`;
}

/**
 * The keys seen for the first time, given the keys seen before. The first read marks nothing:
 * animating a whole list on arrival reads as loading, not as activity (Trador's useArrivals).
 */
export function arrivals(seen: ReadonlySet<string> | null, keys: readonly string[]): { readonly seen: ReadonlySet<string>; readonly fresh: ReadonlySet<string> } {
  if (seen === null) return { seen: new Set(keys), fresh: new Set() };
  const fresh = keys.filter((k) => !seen.has(k));
  return { seen: new Set([...seen, ...fresh]), fresh: new Set(fresh) };
}

/** The empty line for a filter, in words: never a blank panel. */
export function emptyLine(filter: TapeFilter, ticker: string): string {
  switch (filter) {
    case 'buys':
      return `No buys of ${ticker} in the latest trades.`;
    case 'sells':
      return `No sells of ${ticker} in the latest trades.`;
    case 'mine':
      return `You haven't traded ${ticker} from this wallet in the latest trades.`;
    default:
      return 'No trades yet.';
  }
}
