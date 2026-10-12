/**
 * The Portfolio tab's wording, apart from the screens so `node --test` holds it: what a holding's
 * profit says, and how an amount of a coin is written.
 *
 * ★ NO BUY HISTORY IS A DASH WITH ITS REASON. A number appears only when the server knows what
 * the coin cost; otherwise "— no buy history", or "— buy history not read" when the history
 * itself could not be read. Never zero, never a guess.
 */

import type { Holding } from '../../shared/api/index.ts';

export function profitLine(p: Holding['profit']): { readonly text: string; readonly tone: 'up' | 'down' | 'none' } {
  if (p.kind === 'none') return { text: p.why === 'history_unread' ? '— buy history not read' : '— no buy history', tone: 'none' };
  const abs = Math.abs(p.sol);
  const digits = abs > 0 && abs < 0.01 ? 4 : 3;
  const text = `${p.sol < 0 ? '−' : '+'}${abs.toFixed(digits)} SOL${p.partial ? ' on part' : ''}`;
  return { text, tone: p.sol < 0 ? 'down' : 'up' };
}

/** 1392353535035 with 6 decimals → "1.39M": enough to recognise, exact in the coin's page. */
export function compactAmount(amount: string, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  if (!Number.isFinite(n)) return '—';
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, suffix] of units) if (n >= size) return `${(n / size).toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
  return n >= 1 ? n.toFixed(2).replace(/\.?0+$/, '') : n.toPrecision(3);
}
