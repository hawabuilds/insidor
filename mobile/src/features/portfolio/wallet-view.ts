/**
 * The portfolio's wording, apart from the screens so `node --test` holds it: what a holding's gain
 * says, and how an amount of a coin is written. Shared by the Portfolio tab and a profile's
 * portfolio, so a holding reads the same wherever it is shown (Trador's HoldingRow).
 *
 * ★ A GAIN IS TRADOR'S SIGNED DOLLARS, "+$16.52" / "−$3.10", THE SIGN PART OF THE NUMBER. It is
 * the gain in SOL at today's SOL price (services/read wallet.ts); without a SOL price it is said in
 * SOL instead, never dropped to zero. A gain on only the part bought here keeps Trador's wording
 * in `title`: "Covers only the part of this holding with a known purchase price."
 *
 * ★ NOT BOUGHT HERE IS A DASH WITH ITS REASON. Trador draws nothing where it has no cost; Insidor
 * says "— not bought in Insidor", or "— trades not read" when the record could not be read. Never
 * zero, never a guess.
 */

import type { Holding } from '../../shared/api/index.ts';

export function profitLine(p: Holding['profit']): { readonly text: string; readonly tone: 'up' | 'down' | 'none'; readonly title: string } {
  if (p.kind === 'none') {
    return p.why === 'history_unread'
      ? { text: '— trades not read', tone: 'none', title: 'Our record of your trades could not be read just now.' }
      : { text: '— not bought in Insidor', tone: 'none', title: 'Only buys made in Insidor have a known price here.' };
  }
  const sign = (v: number) => (v < 0 ? '−' : '+');
  const tone = p.sol < 0 ? 'down' : 'up';
  const title = p.partial ? 'Covers only the part of this holding with a known purchase price.' : 'Current value minus what you paid.';
  if (p.usd.known) {
    const abs = Math.abs(p.usd.amount);
    const digits = abs > 0 && abs < 0.01 ? 4 : 2;
    return { text: `${sign(p.usd.amount)}$${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`, tone, title };
  }
  const abs = Math.abs(p.sol);
  return { text: `${sign(p.sol)}${abs.toFixed(abs > 0 && abs < 0.01 ? 4 : 3)} SOL`, tone, title };
}

/** 1392353535035 with 6 decimals → "1.39M": enough to recognise, exact in the coin's page. */
export function compactAmount(amount: string, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  if (!Number.isFinite(n)) return '—';
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, suffix] of units) if (n >= size) return `${(n / size).toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
  return n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toPrecision(3);
}
