/**
 * THE WORDS ON A CALL'S ROW AND ON THE HEADLINE CARD, apart from Calls.tsx so `node --test` can hold
 * them. A call is measured from the moment we told people (the owner, 2026-11-14: "it should be
 * showing x's from when we notified users"), so the row says when that was against the coin's launch
 * ("Notified 3m after launch") and the money it ran from and to ("$12K → $1.2M").
 *
 * What breaks if changed carelessly: the start of the money line. It is the market cap we told people
 * (services/read calls.ts), so the arrow reads "from what you were told, to the peak"; a line that
 * started at the launch price would claim a run nobody we told could have caught.
 */

import { formatDuration } from '../../shared/format/duration.ts';
import { compactMoney } from '../../shared/format/number.ts';
import type { CallRow, CallsRecord, CallsWindow } from '../../shared/api/index.ts';

/** How close to the launch still reads as "at launch" rather than "0s after". */
const AT_LAUNCH_MS = 60_000;

/** "Notified 3m after launch", or "Notified at launch" within a minute of it. */
export function notifiedLine(r: Pick<CallRow, 'notifiedAt' | 'mintedAt'>): string {
  const gap = r.notifiedAt - r.mintedAt;
  if (gap < AT_LAUNCH_MS) return 'Notified at launch';
  return `Notified ${formatDuration(gap)} after launch`;
}

/** 2,268x, 89x, 9.4x: whole numbers from 10x up, one decimal under it, never rounded up. */
export function multipleText(x: number): string {
  if (x >= 10) return `${Math.floor(x).toLocaleString('en-US')}x`;
  return `${(Math.floor(x * 10) / 10).toFixed(1)}x`;
}

/** A thin space: the arrow keeps its air without widening the line. */
const THIN = ' ';

/** "$12K → $1.2M", from the cap we told people to the peak. */
export function moneyLine(r: Pick<CallRow, 'startUsd' | 'peakUsd'>): string | null {
  if (r.startUsd === null || r.peakUsd === null) return null;
  return `$${compactMoney(r.startUsd)}${THIN}→${THIN}$${compactMoney(r.peakUsd)}`;
}

/** The line under a call's dash: why it has no multiple. */
export function missingLine(r: Pick<CallRow, 'missing'>): string {
  return r.missing === 'thin_trading' ? 'Little money traded' : 'Price not recorded';
}

/** The headline card's eyebrow: "Best call this week", "this month", "of all time". */
export function bestLabel(w: CallsWindow): string {
  return w === 'week' ? 'Best call this week' : w === 'month' ? 'Best call this month' : 'Best call of all time';
}

export interface StatCell {
  readonly label: string;
  readonly value: string;
}

/** The headline card's three figures: the calls, how many at least doubled, how many went 10x or more. */
export function recordCells(r: CallsRecord): readonly StatCell[] {
  return [
    { label: 'Calls', value: r.calls.toLocaleString('en-US') },
    { label: '2x or more', value: r.twoX.toLocaleString('en-US') },
    { label: '10x or more', value: r.tenX.toLocaleString('en-US') },
  ];
}
