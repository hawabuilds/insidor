/**
 * Numbers for a phone screen.
 *
 * NOT a copy of the desktop app's `number.ts`, and the difference is deliberate. The desktop
 * board is a dense table in a monospace face, so its formatter pads every figure to a fixed
 * width ("41.0K") to stop columns reflowing each tick. This app shows one figure per row in a
 * proportional face, where "41.0K" is a decimal that says nothing and costs width the row
 * does not have. So: one decimal under ten of a unit, none above — "2.4M", "41K", "681K".
 *
 * What did NOT change is the rule that matters. Every function takes `Measured` and not
 * `number`, so an absence renders as the pending glyph with its reason and never as 0.
 */

import type { Measured } from './measure.ts';
import type { Rendered } from './rendered.ts';
import { pendingRendered, value } from './rendered.ts';

const UNITS: readonly (readonly [number, string])[] = [
  [1_000_000_000, 'B'],
  [1_000_000, 'M'],
  [1_000, 'K'],
];

/** 41_200 → "41K", 2_440_000 → "2.4M", 999 → "999". Rounding never produces "1000K". */
export function compact(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  for (let i = 0; i < UNITS.length; i += 1) {
    const [size, suffix] = UNITS[i] ?? [1, ''];
    if (a < size) continue;
    const scaled = a / size;
    const text = scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled));
    /* 999_600 is "1000K" by the arithmetic above, which is a unit boundary the reader has to
       do in their head. Promote it to the next unit instead. */
    const bigger = UNITS[i - 1];
    if (text === '1000' && bigger !== undefined) return `${sign}1${bigger[1]}`;
    return `${sign}${text}${suffix}`;
  }
  return `${sign}${Math.round(a)}`;
}

/** A count of people or posts. Never money. */
export function formatCount(m: Measured): Rendered {
  return m.known ? value(compact(m.amount)) : pendingRendered(m.pending);
}

/** Dollars at market-cap or liquidity scale: "$4.3K". */
export function formatUsd(m: Measured): Rendered {
  if (!m.known) return pendingRendered(m.pending);
  /* A real amount under a cent is never "$0", which is a zero by another name. */
  if (m.amount > 0 && m.amount < 0.01) return value('<$0.01');
  return value(`$${compact(m.amount)}`);
}

/**
 * A unit price, which on this product is routinely something like 0.0000043.
 *
 * Two significant figures, written out in full rather than in exponent form — "4.3e-6" is
 * correct and unreadable on a phone. Never rounded to "$0.00", which is a zero by another
 * name.
 */
export function formatPrice(m: Measured): Rendered {
  if (!m.known) return pendingRendered(m.pending);
  const a = Math.abs(m.amount);
  if (a === 0) return value('$0');
  if (a >= 1) return value(`$${m.amount.toFixed(2)}`);
  const digits = Math.min(20, Math.max(2, 1 - Math.floor(Math.log10(a))));
  return value(`$${m.amount.toFixed(digits)}`);
}

/**
 * A change that is already a percentage: 12.43 → "12.4%".
 *
 * Unsigned on purpose. The direction is carried by the ▲/▼ glyph the caller puts in front of
 * it, and by colour — never by colour alone, because a colour-blind reader cannot see it.
 * `direction` says which glyph; a change of exactly zero, or an unknown one, has none.
 */
export function formatChangePercent(m: Measured): {
  readonly text: Rendered;
  readonly direction: 'up' | 'down' | 'flat' | null;
} {
  if (!m.known) return { text: pendingRendered(m.pending), direction: null };
  const direction = m.amount > 0 ? 'up' : m.amount < 0 ? 'down' : 'flat';
  return { text: value(`${Math.abs(m.amount).toFixed(1)}%`), direction };
}
