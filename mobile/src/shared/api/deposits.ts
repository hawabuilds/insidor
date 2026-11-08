/**
 * DEPOSITS FROM OTHER CHAINS, as the phone holds them (services/read/src/deposits.ts): the user's
 * fixed address on a chain, which pays out as SOL to their own wallet through Aurora Intents, and
 * what has arrived through it.
 *
 * Its own file beside theses.ts: the shapes and their decoders in one place, through the same
 * censor as every other read.
 *
 * ★ AN ADDRESS IS SHOWN ONLY WHEN THE SERVER GAVE ONE. Anything unreadable decodes to "missing",
 * never to a half-read address: a wrong address on this screen loses the user's money.
 */

import { assertNoInternalVocabulary } from './decode.ts';

export type DepositChain = 'evm' | 'btc' | 'tron' | 'ton' | 'sui' | 'near' | 'xrp' | 'doge' | 'ltc';

export type DepositAddress =
  | { readonly kind: 'ready'; readonly address: string; readonly coins: readonly string[] | null }
  | { readonly kind: 'missing'; readonly why: string };

export interface Arrival {
  readonly at: number;
  readonly sentAmount: number | null;
  readonly sentCoin: string | null;
  readonly state: 'swapping' | 'arrived' | 'failed';
  readonly gotSol: number | null;
  readonly txHash: string;
}

export type Arrivals = { readonly kind: 'read'; readonly arrivals: readonly Arrival[] } | { readonly kind: 'missing'; readonly why: string };

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function decodeDepositAddress(raw: unknown): DepositAddress {
  assertNoInternalVocabulary(raw, '$');
  const o = rec(raw);
  const address = str(o['address']);
  if (o['kind'] !== 'ready' || address === null) return { kind: 'missing', why: str(o['why']) ?? 'unavailable' };
  const coins = Array.isArray(o['coins']) ? (o['coins'] as unknown[]).flatMap((c) => (str(c) === null ? [] : [c as string])) : null;
  return { kind: 'ready', address, coins };
}

export function decodeArrivals(raw: unknown): Arrivals {
  assertNoInternalVocabulary(raw, '$');
  const o = rec(raw);
  if (o['kind'] !== 'read' || !Array.isArray(o['arrivals'])) return { kind: 'missing', why: str(o['why']) ?? 'unavailable' };
  const arrivals = (o['arrivals'] as unknown[]).flatMap((a): Arrival[] => {
    const x = rec(a);
    const at = num(x['at']);
    const txHash = str(x['txHash']);
    const state = x['state'];
    if (at === null || txHash === null || (state !== 'swapping' && state !== 'arrived' && state !== 'failed')) return [];
    return [{ at, txHash, state, sentAmount: num(x['sentAmount']), sentCoin: str(x['sentCoin']), gotSol: num(x['gotSol']) }];
  });
  return { kind: 'read', arrivals };
}
