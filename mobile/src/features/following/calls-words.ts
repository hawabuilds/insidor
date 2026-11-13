/**
 * THE WORDS ON A CALL'S ROW AND ON THE RECORD STRIP, apart from Calls.tsx so `node --test` can hold
 * them. The owner's wording (2026-11-13): the left of a row says only WHEN we found it, against the
 * coin ("Found 41m before the coin"); the right says only the MONEY, the multiple over "$5K → $2.06M".
 * "Before launch" was unclear and mixed time and price on one line.
 *
 * What breaks if changed carelessly: the start of the money line. It is the LAUNCH price for a call
 * found before the coin existed, and the price when we found it otherwise (services/read calls.ts);
 * a line that said "when found" for an early call would name a price that never existed.
 */

import { formatDuration } from '../../shared/format/duration.ts';
import { compactMoney } from '../../shared/format/number.ts';
import type { CallRow, CallsRecord } from '../../shared/api/index.ts';

/** How close to the launch still reads as "at launch" rather than "0s after". */
const AT_LAUNCH_MS = 60_000;

/** "Found 41m before the coin", "Found 3m after the coin", or "Found as the coin launched". */
export function foundLine(r: Pick<CallRow, 'foundAt' | 'mintedAt'>): string {
  const gap = r.mintedAt - r.foundAt;
  if (Math.abs(gap) < AT_LAUNCH_MS) return 'Found as the coin launched';
  return `Found ${formatDuration(gap)} ${gap > 0 ? 'before' : 'after'} the coin`;
}

/** 2,268x, 89x, 9.4x: whole numbers from 10x up, one decimal under it. */
export function multipleText(x: number): string {
  if (x >= 10) return `${Math.round(x).toLocaleString('en-US')}x`;
  return `${(Math.floor(x * 10) / 10).toFixed(1)}x`;
}

/** "$5K → $20.6M", from the start's market cap to the peak's. */
export function moneyLine(r: Pick<CallRow, 'startUsd' | 'peakUsd'>): string | null {
  if (r.startUsd === null || r.peakUsd === null) return null;
  return `$${compactMoney(r.startUsd)} → $${compactMoney(r.peakUsd)}`;
}

/** The line under a call's dash: why it has no multiple. */
export function missingLine(r: Pick<CallRow, 'missing'>): string {
  return r.missing === 'thin_trading' ? 'Little money traded' : 'Price not recorded';
}

export interface StatCell {
  readonly label: string;
  readonly value: string;
}

/** The record strip: the calls, how many went 10x or more, the share found before the coin, the best. A missing number is a dash. */
export function recordCells(r: CallsRecord): readonly StatCell[] {
  return [
    { label: 'Calls', value: r.calls.toLocaleString('en-US') },
    { label: 'Went 10x+', value: r.tenX.toLocaleString('en-US') },
    { label: 'Found early', value: r.earlyShare === null ? '—' : `${Math.round(r.earlyShare * 100)}%` },
    { label: 'Best', value: r.best === null ? '—' : multipleText(r.best) },
  ];
}
