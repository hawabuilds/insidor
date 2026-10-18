/**
 * The portfolio's wording, apart from the screens so `node --test` holds it: what a holding's gain
 * says, how an amount is written, the line under the total, and the SOL row's value. Shared by the
 * Portfolio tab and a profile's portfolio, so a holding reads the same wherever it is shown.
 *
 * ★ A GAIN IS SIGNED DOLLARS, "+$17.40" / "−$47.80", THE SIGN PART OF THE NUMBER. It is the gain
 * in SOL at today's SOL price (services/read wallet.ts); without a SOL price it is said in SOL
 * instead, never dropped to zero.
 *
 * ★ NO GAIN IS A PLAIN DASH; ITS REASON IS SAID ONCE, UNDER THE LIST. A row stays short ("—"); the
 * reason is in the row's `title` and in the one note on the screen ("Gains count coins bought in
 * Insidor."), with a second sentence only when our record of trades could not be read.
 */

import type { Holding, Portfolio } from '../../shared/api/index.ts';
import type { BalancePoint } from './balance-points.ts';

export function profitLine(p: Holding['profit']): { readonly text: string; readonly tone: 'up' | 'down' | 'none'; readonly title: string } {
  if (p.kind === 'none') {
    return p.why === 'history_unread'
      ? { text: '—', tone: 'none', title: 'Our record of your trades could not be read just now.' }
      : { text: '—', tone: 'none', title: 'Not bought in Insidor, so there is no price paid to measure against.' };
  }
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

/** The chart window's words, as the line under the total says them. */
export const RANGE_WORDS = { '1d': 'today', '1w': 'this week', '1m': 'this month', all: 'all time' } as const;

/**
 * "+$8.10 (+0.92%) this week": first point to the live total. Null with fewer than two points or a
 * first value of nothing, where a share cannot be said; the chart's place says why.
 */
export function rangeLine(points: readonly BalancePoint[] | null, range: keyof typeof RANGE_WORDS): { readonly text: string; readonly tone: 'up' | 'down' } | null {
  if (points === null || points.length < 2) return null;
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  if (!(first > 0) || !Number.isFinite(last)) return null;
  const usd = last - first;
  const pct = (usd / first) * 100;
  return { text: `${signedUsd(usd)} (${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(2)}%) ${RANGE_WORDS[range]}`, tone: usd < 0 ? 'down' : 'up' };
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
