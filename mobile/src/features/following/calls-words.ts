/**
 * THE WORDS ON A CALL'S ROW AND ON THE STRIP, apart from Calls.tsx so `node --test` can hold them.
 * The owner's cut (2026-11-14, after many rounds of "too much writing"): under the ticker only how
 * early we saw the post against the coin's launch ("2h before launch"), and under the multiple only
 * the money it ran from and to ("$19K → $590K"). Nothing that needs a header to be understood.
 *
 * What breaks if changed carelessly: the start of the money line. It is the market cap we told people
 * (services/read calls.ts); a line that started at the launch price would claim a run nobody we told
 * could have caught. And "before launch" is our sighting of the POST, not of the coin.
 */

import { formatDuration } from '../../shared/format/duration.ts';
import { compactMoney } from '../../shared/format/number.ts';
import type { CallRow, CallsRecord } from '../../shared/api/index.ts';

/** How close to the launch still reads as "at launch" rather than "0s before". */
const AT_LAUNCH_MS = 60_000;

/**
 * "2h before launch", "4h after launch" or "At launch": when we first had the post on For You against
 * the coin's mint. A call whose sighting was never recorded says how long ago we told people instead.
 */
export function launchLine(r: Pick<CallRow, 'foundAt' | 'mintedAt' | 'notifiedAt'>, nowMs: number): string {
  if (r.foundAt === null) return `${formatDuration(Math.max(0, nowMs - r.notifiedAt))} ago`;
  const lead = r.foundAt - r.mintedAt;
  if (Math.abs(lead) < AT_LAUNCH_MS) return 'At launch';
  return `${formatDuration(Math.abs(lead))} ${lead < 0 ? 'before' : 'after'} launch`;
}

/** 2,268x, 89x, 9.4x: whole numbers from 10x up, one decimal under it, never rounded up. */
export function multipleText(x: number): string {
  if (x >= 10) return `${Math.floor(x).toLocaleString('en-US')}x`;
  return `${(Math.floor(x * 10) / 10).toFixed(1)}x`;
}

/** A thin space: the arrow keeps its air without widening the line. */
const THIN = ' ';

/** "$19K → $590K", from the cap we told people to the peak. */
export function moneyLine(r: Pick<CallRow, 'startUsd' | 'peakUsd'>): string | null {
  if (r.startUsd === null || r.peakUsd === null) return null;
  return `$${compactMoney(r.startUsd)}${THIN}→${THIN}$${compactMoney(r.peakUsd)}`;
}

/** The line under a call's dash: why it has no multiple. */
export function missingLine(r: Pick<CallRow, 'missing'>): string {
  return r.missing === 'thin_trading' ? 'Little money traded' : 'Price not recorded';
}

export interface StatCell {
  readonly label: string;
  readonly value: string;
  /** The best multiple is green, as a price that went up; the counts are white. */
  readonly up: boolean;
}

/** The strip: the calls, how many at least doubled, how many went 10x or more, and the best. A missing best is a dash. */
export function recordCells(r: CallsRecord): readonly StatCell[] {
  return [
    { label: 'Calls', value: r.calls.toLocaleString('en-US'), up: false },
    { label: '2x or more', value: r.twoX.toLocaleString('en-US'), up: false },
    { label: '10x or more', value: r.tenX.toLocaleString('en-US'), up: false },
    { label: 'Best', value: r.best === null ? '—' : multipleText(r.best), up: r.best !== null && r.best > 1 },
  ];
}
