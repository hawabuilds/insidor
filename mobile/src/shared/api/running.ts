/**
 * THE RUNNING COINS STRIP, AS THE PHONE HOLDS IT — GET /running/coins (services/read
 * running-coins.ts holds which coins and in what order). Apart from client.ts so `node --test` can
 * hold the decoding without the network.
 *
 * ★ A COIN WITHOUT A NUMBER IS DROPPED, NEVER SHOWN AS 0. The service sends only coins whose market
 * cap and 24-hour move it knows; an item missing either here (a newer or broken service) is left
 * off the strip rather than drawn as "$0" or "0%". The order is the server's and is kept.
 *
 * What breaks if changed carelessly: re-sorting here. The order is "most dollars traded in the last
 * hour", decided once on the server; a phone that sorts by percent shows a different strip.
 */

import { assertNoInternalVocabulary } from './decode.ts';

export interface RunningCoin {
  readonly coinId: string;
  readonly address: string;
  readonly ticker: string;
  readonly imageUrl: string | null;
  readonly marketCapUsd: number;
  /** The 24-hour move in percent (12.5 is up 12.5%). */
  readonly change24hPct: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** The strip's coins in the server's order; an item missing a field is left out. */
export function decodeRunningCoins(raw: unknown): readonly RunningCoin[] {
  assertNoInternalVocabulary(raw, '$');
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(o['coins']) ? o['coins'] : [];
  const seen = new Set<string>();
  return list.flatMap((x): RunningCoin[] => {
    const c = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : {};
    const coinId = text(c['coinId']);
    const address = text(c['address']);
    const ticker = text(c['ticker']);
    const cap = num(c['marketCapUsd']);
    const pct = num(c['change24hPct']);
    if (coinId === null || address === null || ticker === null || cap === null || cap <= 0 || pct === null || seen.has(address)) return [];
    seen.add(address);
    const image = text(c['imageUrl']);
    return [{ coinId, address, ticker: ticker.trim(), imageUrl: image !== null && image.startsWith('https://') ? image : null, marketCapUsd: cap, change24hPct: pct }];
  });
}
