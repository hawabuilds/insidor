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

import type { BuildResult, TradeLimits, TradeQuote, TradeVenue } from '../../shared/api/index.ts';

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

/* ── the ticket's sizes and warnings (OrderSheet.tsx, Trador's OrderSheet) ── */

/**
 * Buy sizes the person can tap, in lamports. Trador's are 0.05, 0.25 and 1 SOL; ours are drawn
 * from a longer ladder and cut at the largest buy the gate will take at this slippage (the cap
 * is on the amount PLUS its slippage, services/trade gate.ts). When the largest is not itself on
 * the ladder it is offered as "Max", so the last button is always the most one trade may be.
 * With no cap (policy since 2026-10-15) the ladder's top three show — Trador's own 0.05, 0.25
 * and 1 — and any amount may be typed; the ticket says when it is more SOL than the wallet holds.
 */
export const BUY_LADDER_SOL = ['0.01', '0.025', '0.05', '0.25', '1'] as const;
/** Buttons shown, as in Trador's ticket. */
export const PRESETS_SHOWN = 3;
/** Sell sizes, as a share of what the wallet holds; 100 sells the exact balance. Trador's four. */
export const SELL_STEPS = [25, 50, 75, 100] as const;
/** Slippage offered, in basis points, within the server's bound. Ours: a launchpad curve moves more than Trador's 0.5/1/3%. */
export const SLIPPAGE_CHOICES = [100, 300, 500, 1000] as const;
/** Price impact past which the ticket says the pool is thin, warns, and refuses (Trador's 2, 15, 50). */
export const IMPACT_CAUTION_PCT = 2;
export const IMPACT_WARN_PCT = 15;
export const IMPACT_BLOCK_PCT = 50;

/** The most a buy may be at this slippage so that it, plus its slippage, stays within the cap. Null: no cap. */
export function largestBuy(limits: TradeLimits, slippageBps: number): bigint | null {
  return limits.maxBuyLamports === null ? null : (BigInt(limits.maxBuyLamports) * 10_000n) / (10_000n + BigInt(slippageBps));
}

export function buyPresets(limits: TradeLimits | null, slippageBps: number): readonly { readonly label: string; readonly lamports: bigint }[] {
  if (limits === null) return [];
  const top = largestBuy(limits, slippageBps);
  const fits = BUY_LADDER_SOL.map((sol) => ({ label: `${sol} SOL`, lamports: toBaseUnits(sol, 9) ?? 0n })).filter((p) => p.lamports > 0n && (top === null || p.lamports <= top));
  if (top === null) return fits.slice(-PRESETS_SHOWN);
  if (fits.length > 0 && fits[fits.length - 1]?.lamports === top) return fits.slice(-PRESETS_SHOWN);
  return top > 0n ? [...fits.slice(-(PRESETS_SHOWN - 1)), { label: 'Max', lamports: top }] : [];
}

/** Trador's amount field: digits and one point, at most `places` after it. */
export function sanitizeAmount(raw: string, places: number): string {
  const digits = raw.replace(/[^0-9.]/g, '');
  const parts = digits.split('.');
  return parts.length > 1 ? `${parts[0] ?? ''}.${parts.slice(1).join('').slice(0, places)}` : (parts[0] ?? '');
}

/** `pct` percent of `held`, rounded down; 100 is the exact balance. */
export function shareOf(held: bigint, pct: number): bigint {
  return pct >= 100 ? held : (held * BigInt(pct)) / 100n;
}

export type ImpactLevel = 'ok' | 'caution' | 'warn' | 'block';

export function impactLevel(pct: number | null): ImpactLevel {
  if (pct === null) return 'ok';
  const a = Math.abs(pct);
  return a >= IMPACT_BLOCK_PCT ? 'block' : a >= IMPACT_WARN_PCT ? 'warn' : a >= IMPACT_CAUTION_PCT ? 'caution' : 'ok';
}

/** Lamports as SOL for a summary line: four places, or the exact amount when that would print 0. */
export function solText(lamports: bigint): string {
  const exact = fromBaseUnits(lamports.toString(), 9);
  const n = Number(exact);
  return n >= 0.0001 ? String(Number(n.toFixed(4))) : exact;
}
