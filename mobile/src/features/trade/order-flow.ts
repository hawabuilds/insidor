/**
 * THE ORDER SHEET'S DECISIONS, apart from the sheet so `node --test` can hold them: whether a
 * coin shows Buy and Sell at all, how a typed amount becomes base units, and the one order in
 * which a confirmed trade is built, checked and signed.
 *
 * ★ NO BROKEN BUTTON. Trading off shows no trade path; a coin with nowhere to trade shows
 * "Can't be traded right now" in place of the buttons; a check we could not make says so. A
 * button only appears when pressing it can work.
 *
 * ★ A FAILED SIMULATION NEVER REACHES THE WALLET. `confirmOrder` asks the wallet to sign only
 * after the build came back ready — which the trade service returns only when its simulation
 * passed. Blocked, the person sees why and nothing is signed or sent.
 *
 * What breaks if changed carelessly: amounts are parsed exactly, as decimal strings into base
 * units. A float would turn 0.1 SOL into 99,999,999 lamports and a quote for a different trade.
 */

import type { SendOutcome } from '@insidor/contracts/ports/wallet.ts';

import type { BuildResult, TradeQuote, TradeVenue } from '../../shared/api/index.ts';

export type TradeAvailability =
  | { readonly kind: 'off' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'open' }
  | { readonly kind: 'closed'; readonly line: string };

export function availability(trading: boolean, venue: TradeVenue | 'loading'): TradeAvailability {
  if (!trading) return { kind: 'off' };
  if (venue === 'loading') return { kind: 'checking' };
  if (venue === 'curve' || venue === 'pool') return { kind: 'open' };
  return { kind: 'closed', line: venue === 'none' ? "Can't be traded right now" : "Trading isn't available just now" };
}

/** "0.05" with 9 decimals → 50000000n. Null for anything that is not a positive amount. */
export function toBaseUnits(text: string, decimals: number): bigint | null {
  const t = text.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const [whole = '', frac = ''] = t.split('.');
  if (frac.length > decimals) return null;
  const units = BigInt((whole === '' ? '0' : whole) + frac.padEnd(decimals, '0'));
  return units > 0n ? units : null;
}

/** 50000000 with 9 decimals → "0.05". */
export function fromBaseUnits(units: string, decimals: number): string {
  const padded = units.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac === '' ? whole : `${whole}.${frac}`;
}

export type ConfirmOutcome =
  | { readonly kind: 'sent'; readonly ref: string }
  | { readonly kind: 'blocked'; readonly why: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'not-sent'; readonly why: string }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

export async function confirmOrder(
  quote: TradeQuote,
  deps: {
    readonly build: (q: TradeQuote) => Promise<BuildResult>;
    readonly signAndSend: (payload: Uint8Array) => Promise<SendOutcome>;
    readonly decode: (base64: string) => Uint8Array;
  },
): Promise<ConfirmOutcome> {
  return confirmBuilt(() => deps.build(quote), deps);
}

/** Any transaction the server builds and simulates — a trade, a send — signed only if it passed. */
export async function confirmBuilt(
  build: () => Promise<BuildResult>,
  deps: { readonly signAndSend: (payload: Uint8Array) => Promise<SendOutcome>; readonly decode: (base64: string) => Uint8Array },
): Promise<ConfirmOutcome> {
  const built = await build();
  if (built.kind === 'blocked') return { kind: 'blocked', why: built.why };
  const sent = await deps.signAndSend(deps.decode(built.transaction));
  switch (sent.kind) {
    case 'sent':
      return { kind: 'sent', ref: sent.ref };
    case 'refused':
      return { kind: 'refused' };
    case 'not-sent':
      return { kind: 'not-sent', why: sent.why };
    case 'unavailable':
      return { kind: 'unavailable' };
    default:
      return { kind: 'failed' };
  }
}

/** Base64 ↔ bytes, without a dependency: the browser's own codec. */
export function fromBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
