/**
 * Number formatting for a dense terminal.
 *
 * Every function here takes `Measured` and not `number`. That is the whole point: there is
 * no entry point that accepts a raw number-or-null, so "what should I show when it's
 * missing?" is not a question a caller gets to answer badly. It was answered once, here,
 * and the answer is never 0.
 *
 * All output is intended for JetBrains Mono with tabular figures — see ui/Num.tsx. Widths
 * are chosen so a column does not reflow when 9.9K becomes 10.0K, because a table that
 * shifts sideways every tick is unreadable regardless of what the numbers say.
 */

import type { Measured } from './measure.ts';
import type { Rendered } from './rendered.ts';
import { pendingRendered, value } from './rendered.ts';

const THOUSAND = 1_000;
const MILLION = 1_000_000;
const BILLION = 1_000_000_000;

/** 1234 → "1.23K". Three significant figures, fixed width, no locale grouping. */
function compact(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a < THOUSAND) return `${sign}${Math.round(a)}`;
  const [div, suffix] =
    a < MILLION ? [THOUSAND, 'K'] : a < BILLION ? [MILLION, 'M'] : [BILLION, 'B'];
  const scaled = a / div;
  /* Under 10 gets two decimals, under 100 gets one, above that none — so the rendered
     string is always four or five characters wide whatever the magnitude. */
  const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  return `${sign}${scaled.toFixed(decimals)}${suffix}`;
}

/** A count of people or posts or reads. Never money. */
export function formatCount(m: Measured): Rendered {
  return m.known ? value(compact(m.amount)) : pendingRendered(m.pending);
}

/** A dollar amount at market-cap or liquidity scale. */
export function formatUsd(m: Measured): Rendered {
  return m.known ? value(`$${compact(m.amount)}`) : pendingRendered(m.pending);
}

/**
 * A unit price, which on this product is routinely a number like 0.0000000412 and is
 * meaningless rounded to two decimals. Below a cent we switch to significant figures rather
 * than decimal places, so a price never renders as "$0.00" — which is a zero by another
 * name, and the exact failure this module exists to prevent.
 */
export function formatPrice(m: Measured): Rendered {
  if (!m.known) return pendingRendered(m.pending);
  const a = Math.abs(m.amount);
  if (a === 0) return value('$0');
  if (a >= 1) return value(`$${m.amount.toFixed(2)}`);
  if (a >= 0.01) return value(`$${m.amount.toFixed(4)}`);
  return value(`$${m.amount.toPrecision(3)}`);
}

/** Basis points, as the venue reports them. Shown as a percentage because users read that. */
export function formatBps(m: Measured): Rendered {
  if (!m.known) return pendingRendered(m.pending);
  const pct = m.amount / 100;
  return value(`${pct < 10 ? pct.toFixed(2) : pct.toFixed(1)}%`);
}

/** A share of a whole, given as a fraction in [0,1]. */
export function formatPercent(m: Measured): Rendered {
  if (!m.known) return pendingRendered(m.pending);
  return value(`${(m.amount * 100).toFixed(1)}%`);
}

/**
 * A signed change. Returns the sign in the text, because colour alone is not a signal a
 * colour-blind user can read and because `ui/Delta.tsx` is only permitted to colour by sign.
 */
export function formatDelta(m: Measured): Rendered {
  if (!m.known) return pendingRendered(m.pending);
  const sign = m.amount > 0 ? '+' : m.amount < 0 ? '-' : '';
  return value(`${sign}${compact(Math.abs(m.amount))}`);
}

/**
 * A signed change that is ALREADY a percentage: -7.86 renders as "-7.9%".
 *
 * Separate from `formatPercent`, which takes a fraction in [0,1] and multiplies — and
 * that is exactly why this exists rather than reusing it. The two spellings of "a
 * percentage" differ by a factor of a hundred, both look plausible on a screen, and the
 * one column where the mistake matters most is the one this formats. Wiring the wrong
 * one in would render a 7.86% fall as 786%, or a coin that doubled as 2%.
 *
 * One decimal place at every magnitude, so the column does not reflow when 9.9 becomes
 * 10.1. The sign is in the TEXT and not only in the colour, because colour alone is not
 * a signal a colour-blind user can read.
 */
export function formatDeltaPercent(m: Measured): Rendered {
  if (!m.known) return pendingRendered(m.pending);
  const sign = m.amount > 0 ? '+' : m.amount < 0 ? '-' : '';
  return value(`${sign}${Math.abs(m.amount).toFixed(1)}%`);
}
