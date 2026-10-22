/**
 * The portfolio's wording, apart from the screens so `node --test` holds it: what a holding's gain
 * says, how an amount is written, and the SOL row's value (the line under the total is the
 * profile's, features/profile/profile-words.ts moveLine). Shared by the
 * Portfolio tab and a profile's portfolio, so a holding reads the same wherever it is shown.
 *
 * ★ A GAIN IS SIGNED DOLLARS, "+$17.40" / "−$47.80", THE SIGN PART OF THE NUMBER. It is the gain
 * in SOL at today's SOL price (services/read wallet.ts); without a SOL price it is said in SOL
 * instead, never dropped to zero.
 *
 * ★ NO GAIN IS A PLAIN DASH; ITS REASON IS SAID ONCE, UNDER THE LIST. A row stays short ("—"); the
 * reason is in the row's `title` and in the one note on the screen ("Gains count coins bought in
 * Insidor."), with a second sentence only when our record of trades could not be read.
 *
 * ★ THE WORTH NEVER BLANKS WHILE A PRICE IS KNOWN (the owner, 2026-10-21: "i should see the
 * dollar value of my holdings at all times"). A read that lacks a price this phone saw within a
 * day shows that last price instead, saying how old it is ("as of 5m ago"); a coin no market
 * prices is a dash with a short reason, never zero, and the total says when it leans on an old
 * price.
 */

import type { Holding, Portfolio } from '../../shared/api/index.ts';
import type { Measured } from '../../shared/format/measure.ts';

export function profitLine(p: Holding['profit']): { readonly text: string; readonly tone: 'up' | 'down' | 'none'; readonly title: string } {
  if (p.kind === 'none') {
    return p.why === 'history_unread'
      ? { text: '—', tone: 'none', title: 'Our record of your trades could not be read just now.' }
      : { text: '—', tone: 'none', title: 'Not bought in Insidor, so there is no price paid to measure against.' };
  }
  /* A kept read from an older build can carry an older shape: say nothing rather than break. */
  if (typeof p.sol !== 'number' || p.usd === undefined) return { text: '—', tone: 'none', title: 'Reading this again.' };
  const tone = p.sol < 0 ? 'down' : 'up';
  const title = p.partial ? 'Covers only the part of this holding bought in Insidor.' : 'Current value minus what you paid.';
  if (p.usd.known) return { text: signedUsd(p.usd.amount), tone, title };
  const abs = Math.abs(p.sol);
  return { text: `${p.sol < 0 ? '−' : '+'}${abs.toFixed(abs > 0 && abs < 0.01 ? 4 : 3)} SOL`, tone, title };
}

/** "+$8.10" / "−$3.10": two places, four under a cent so a tiny move is not "+$0.00". */
export function signedUsd(v: number): string {
  const abs = Math.abs(v);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${v < 0 ? '−' : '+'}$${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * The SOL row's dollars. The reply carries the total in dollars and in SOL, both counted at the
 * same SOL price, so their ratio is that price exactly; null when either is unknown or the SOL
 * total is nothing to divide by.
 */
export function solValueUsd(p: Extract<Portfolio, { kind: 'read' }>): number | null {
  if (!p.solBalance.known || !p.totalUsd.known || !p.totalSol.known || !(p.totalSol.amount > 0)) return null;
  return p.solBalance.amount * (p.totalUsd.amount / p.totalSol.amount);
}

/** The one note under the list: where gains come from, and only if needed, that the record was not read. */
export function gainsNote(holdings: readonly Holding[]): string {
  const unread = holdings.some((h) => h.profit.kind === 'none' && h.profit.why === 'history_unread');
  return unread ? 'Gains count coins bought in Insidor. Your trades could not be read just now.' : 'Gains count coins bought in Insidor.';
}

/** 1392353535035 with 6 decimals → "1.39M": enough to recognise, exact in the coin's page. */
export function compactAmount(amount: string, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  if (!Number.isFinite(n)) return '—';
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, suffix] of units) if (n >= size) return `${(n / size).toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
  return n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toPrecision(3);
}

/* ── the last known dollars, so the worth never blanks (the owner, 2026-10-21) ── */

/**
 * The dollar prices this phone last saw for a wallet: SOL's, and each coin's for one whole coin,
 * each with when it was read. Kept on the phone (PortfolioScreen) and folded in by `steadyWallet`.
 */
export interface LastPrices {
  readonly sol: { readonly usd: number; readonly at: number } | null;
  readonly coins: Readonly<Record<string, { readonly usd: number; readonly at: number }>>;
}

/** A last price older than this is not shown: the row says it has no price instead. */
export const LAST_PRICE_FOR_MS = 24 * 60 * 60_000;

const wholeCoins = (h: Holding): number => Number(h.amount) / 10 ** h.decimals;

/** `prev` with every price this read knows, read at `at`; what this read lacks keeps its last price. */
export function notePrices(prev: LastPrices | null, p: Portfolio, at: number): LastPrices {
  const coins: Record<string, { usd: number; at: number }> = {};
  for (const [a, v] of Object.entries(prev?.coins ?? {})) if (at - v.at < LAST_PRICE_FOR_MS) coins[a] = v;
  let sol = prev?.sol ?? null;
  if (p.kind !== 'read') return { sol, coins };
  if (p.totalUsd.known && p.totalSol.known && p.totalSol.amount > 0) sol = { usd: p.totalUsd.amount / p.totalSol.amount, at };
  for (const h of p.holdings) {
    const n = wholeCoins(h);
    if (h.valueUsd.known && n > 0) coins[h.address] = { usd: h.valueUsd.amount / n, at };
  }
  return { sol, coins };
}

/**
 * What the Portfolio shows: the fresh read, with any dollars it lacks filled from the last price
 * this phone saw, each filled number carrying when that price was read. `asOf.total` is set when
 * the total leans on a last price (the oldest one it used); `asOf.holdings` names each row that
 * does. A coin with no last price either stays a dash with its reason: never zero.
 */
export interface SteadyWallet {
  readonly data: Extract<Portfolio, { kind: 'read' }>;
  readonly asOf: { readonly total: number | null; readonly holdings: ReadonlyMap<string, number> };
}

export function steadyWallet(p: Extract<Portfolio, { kind: 'read' }>, last: LastPrices | null, now: number): SteadyWallet {
  const asOf = new Map<string, number>();
  const young = (at: number): boolean => now - at < LAST_PRICE_FOR_MS;
  const holdings = p.holdings.map((h): Holding => {
    const kept = last?.coins[h.address];
    if (h.valueUsd.known || kept === undefined || !young(kept.at)) return h;
    const value = wholeCoins(h) * kept.usd;
    if (!Number.isFinite(value)) return h;
    asOf.set(h.address, kept.at);
    return { ...h, priceUsd: { known: true, amount: kept.usd }, valueUsd: { known: true, amount: value } };
  });
  const filled = holdings.reduce((s, h) => s + (asOf.has(h.address) && h.valueUsd.known ? h.valueUsd.amount : 0), 0);
  let totalUsd = p.totalUsd;
  let totalSol = p.totalSol;
  let totalAt: number | null = asOf.size > 0 ? Math.min(...asOf.values()) : null;
  if (p.totalUsd.known && p.totalSol.known && p.totalSol.amount > 0) {
    const solPrice = p.totalUsd.amount / p.totalSol.amount;
    totalUsd = { known: true, amount: p.totalUsd.amount + filled };
    totalSol = { known: true, amount: p.totalSol.amount + filled / solPrice };
  } else if (last?.sol != null && young(last.sol.at) && p.solBalance.known) {
    /* No SOL price in this read: the whole total is at SOL's last price, and says when. */
    const coinsUsd = holdings.reduce((s, h) => s + (h.valueUsd.known ? h.valueUsd.amount : 0), 0);
    const usd = p.solBalance.amount * last.sol.usd + coinsUsd;
    totalUsd = { known: true, amount: usd };
    totalSol = { known: true, amount: usd / last.sol.usd };
    totalAt = Math.min(totalAt ?? last.sol.at, last.sol.at);
  }
  return {
    data: { ...p, holdings, totalUsd, totalSol, unpriced: holdings.filter((h) => !h.valueUsd.known).length },
    asOf: { total: totalAt, holdings: asOf },
  };
}

/** "as of 5m ago" for a number shown from a last price. */
export function asOfWords(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < 60_000) return 'as of just now';
  if (ms < 3_600_000) return `as of ${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `as of ${Math.floor(ms / 3_600_000)}h ago`;
  return `as of ${Math.floor(ms / 86_400_000)}d ago`;
}

/** A holding with no dollars anywhere: the short reason under its dash, and the longer one for its title. */
export function noPriceReason(m: Measured): { readonly text: string; readonly title: string } {
  if (m.known) return { text: '', title: '' };
  return m.pending === 'not_read_yet' || m.pending === 'unreadable'
    ? { text: 'Price not read', title: 'Its price could not be read just now; it is read again on the next refresh.' }
    : { text: 'No market price', title: 'No market prices this coin, so it has no dollar value and is not in the total.' };
}
