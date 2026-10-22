/**
 * A WALLET'S CATCHES, AS THE PHONE HOLDS THEM — the profile's stats strip (Caught early, Best catch,
 * Hit rate) and the coins whose rows carry the green "Early" tag, from GET /wallet/:address/catches
 * (services/read catches.ts holds the rules). Apart from client.ts so `node --test` can hold the
 * decoding without the network.
 *
 * ★ A STAT WE CANNOT SAY IS A REASON, NEVER ZERO. Each of the three is a number or a closed reason:
 * none caught yet, none bought here (no entry to measure from), no price now, or not read just
 * now. An unknown reason from a newer service reads as "not read", never as a number.
 *
 * What breaks if changed carelessly: reading `{ v: 0 }` as missing. A hit rate of 0 says every coin
 * is down, which is a fact the strip must show.
 */

import { assertNoInternalVocabulary } from './decode.ts';

export type CatchWhy = 'none_caught' | 'no_entry' | 'no_market' | 'not_read_yet';
export type CatchStat = { readonly known: true; readonly amount: number } | { readonly known: false; readonly why: CatchWhy };

export type Catches =
  | {
      readonly kind: 'read';
      readonly caughtEarly: CatchStat;
      /** The best multiple from entry to peak, as a ratio (164 is 164x). */
      readonly bestCatch: CatchStat;
      /** The share up from their entry, 0 to 1. */
      readonly hitRate: CatchStat;
      /** The held coins caught early, by address. */
      readonly early: ReadonlySet<string>;
    }
  | { readonly kind: 'unavailable' };

const WHYS: readonly CatchWhy[] = ['none_caught', 'no_entry', 'no_market', 'not_read_yet'];

function stat(v: unknown): CatchStat {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const n = o['v'];
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return { known: true, amount: n };
  const why = WHYS.find((w) => w === o['why']);
  return { known: false, why: why ?? 'not_read_yet' };
}

export function decodeCatches(raw: unknown): Catches {
  assertNoInternalVocabulary(raw, '$');
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  if (o['kind'] !== 'read') return { kind: 'unavailable' };
  const early = Array.isArray(o['early'])
    ? o['early'].flatMap((e) => {
        const a = typeof e === 'object' && e !== null ? (e as Record<string, unknown>)['address'] : null;
        return typeof a === 'string' && a !== '' ? [a] : [];
      })
    : [];
  return { kind: 'read', caughtEarly: stat(o['caughtEarly']), bestCatch: stat(o['bestCatch']), hitRate: stat(o['hitRate']), early: new Set(early) };
}
