/**
 * THE POST SHEET'S AND THE FOR YOU CARD'S DECISIONS, apart from the screens so `node --test` can
 * hold them: how much a post's views grew lately and over how long, the "Found 2m" and "Coin 33m"
 * tags, a coin's age, and which line a card's coin area says. The views chart's own rules are in
 * views-chart.ts.
 *
 * ★ EVERY NUMBER IS BETWEEN TWO OF OUR OWN READINGS, AND SAYS ITS SPAN. Readings are taken every
 * few minutes, not every five: the gain is measured from the reading nearest five minutes before
 * the newest, and labelled with the minutes that really separate them ("+38K 7m"). It is never
 * interpolated, and a reading the source rounded away (null) is never used.
 *
 * What breaks if changed carelessly: the card's coin line follows `postCoinStatus` (shared/coin-
 * status.ts) for which states exist; this file only words them the way the design does. A Buy is
 * offered only for a post's own coin (`one` or `matched`), never for an unsure list.
 */

import type { Coin, CoinEvidence, PostCoinLink } from '../../shared/api/index.ts';
import type { Instant } from '../../shared/format/measure.ts';
import { compact } from '../../shared/format/number.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The span the views change aims at, and the nearest and farthest a reading may be from it. */
export const GAIN_TARGET_MS = 5 * MINUTE;
export const GAIN_MIN_MS = 2 * MINUTE;
export const GAIN_MAX_MS = 15 * MINUTE;

export interface Reading {
  readonly atMs: number;
  readonly value: number | null;
}

/** "+38K" over `minutes`: the newest counted reading against the one nearest five minutes before it. */
export function recentGain(readings: readonly Reading[]): { readonly gain: number; readonly minutes: number } | null {
  const counted = readings.filter((r): r is { atMs: number; value: number } => r.value !== null).sort((a, b) => a.atMs - b.atMs);
  const newest = counted[counted.length - 1];
  if (newest === undefined) return null;
  let best: { atMs: number; value: number } | null = null;
  for (const r of counted) {
    const back = newest.atMs - r.atMs;
    if (back < GAIN_MIN_MS || back > GAIN_MAX_MS) continue;
    if (best === null || Math.abs(back - GAIN_TARGET_MS) < Math.abs(newest.atMs - best.atMs - GAIN_TARGET_MS)) best = r;
  }
  if (best === null) return null;
  return { gain: newest.value - best.value, minutes: Math.round((newest.atMs - best.atMs) / MINUTE) };
}

/** "+38K" or "-2K"; null when there is no gain to state. */
export function gainText(g: { readonly gain: number } | null): string | null {
  if (g === null) return null;
  return `${g.gain >= 0 ? '+' : ''}${compact(g.gain)}`;
}

/** Minutes, hours or days between two instants, one unit: "2m", "3h", "2d". */
export function span(ms: number): string {
  const a = Math.max(0, ms);
  if (a < HOUR) return `${Math.max(1, Math.round(a / MINUTE))}m`;
  if (a < 2 * DAY) return `${Math.round(a / HOUR)}h`;
  return `${Math.round(a / DAY)}d`;
}

/** "Found 2m": how long after it was posted we found it; null when either time is unknown. */
export function foundTag(postedAt: Instant, foundAt: Instant): string | null {
  if (!postedAt.known || !foundAt.known) return null;
  return `Found ${span(foundAt.at - postedAt.at)}`;
}

/**
 * When the first coin with the name launched after the post: "Coin 33m". Coins launched before the
 * post are not counted (they cannot have come from it); null when none launched after it.
 */
export function firstCoinAfter(postedAt: Instant, launches: readonly Instant[]): number | null {
  if (!postedAt.known) return null;
  const after = launches.flatMap((l) => (l.known && l.at >= postedAt.at ? [l.at] : []));
  return after.length === 0 ? null : Math.min(...after);
}

export function coinTag(postedAt: Instant, firstCoinAt: number | null): string | null {
  if (!postedAt.known || firstCoinAt === null) return null;
  return `Coin ${span(firstCoinAt - postedAt.at)}`;
}

/** "5h old"; null when the launch is unknown. */
export function ageText(launchedAt: Instant, now: number): string | null {
  if (!launchedAt.known || now < launchedAt.at) return null;
  return `${span(now - launchedAt.at)} old`;
}

/** "+182%" or "-4%"; one decimal under ten. */
export function pctText(pct: number): string {
  const a = Math.abs(pct);
  const n = a < 10 ? a.toFixed(1).replace(/\.0$/, '') : String(Math.round(a));
  return `${pct >= 0 ? '+' : '-'}${n}%`;
}

/** "1.9M followers", "1 follower". */
export function followersText(n: number): string {
  return `${compact(n)} ${n === 1 ? 'follower' : 'followers'}`;
}

/* ── the For You card's coin area ────────────────────────────────────── */

export type CardFoot =
  /** The post's own coin: ticker and cap, why it is the post's, and a purple Buy (opens the post sheet). */
  | { readonly kind: 'proven'; readonly coin: Coin; readonly why: string }
  /** Coins use the name and none is proven: "8 coins, none proven" and Choose coin (opens the post sheet). */
  | { readonly kind: 'choose'; readonly line: string }
  /** No coin with the name: "No coin yet" and Create. */
  | { readonly kind: 'create' }
  /** A narrative with several coins: the line, and View coins (opens the narrative). */
  | { readonly kind: 'several'; readonly line: string }
  /** No button: still checking, or the check failed. */
  | { readonly kind: 'line'; readonly line: string };

/** Why a post's own coin is its own, in the card's words: the facts, or that its narrative names it. */
export function provenWhy(coins: PostCoinLink, facts: (e: CoinEvidence) => readonly string[]): string {
  if (coins.kind === 'matched') return facts(coins.evidence).join(', ') || 'Proven from this post';
  return "This narrative's coin";
}

export function cardFoot(coins: PostCoinLink, facts: (e: CoinEvidence) => readonly string[]): CardFoot {
  switch (coins.kind) {
    case 'one':
    case 'matched':
      return { kind: 'proven', coin: coins.coin, why: provenWhy(coins, facts) };
    case 'unsure': {
      if (coins.claimCount === 0) return { kind: 'create' };
      const n = `${coins.claimCount}${coins.more === true ? '+' : ''}`;
      return { kind: 'choose', line: coins.claimCount === 1 && coins.more !== true ? '1 coin, not proven' : `${n} coins, none proven` };
    }
    case 'none':
      return { kind: 'create' };
    case 'several':
      return { kind: 'several', line: `${coins.coins.length} coins` };
    case 'pending':
      return { kind: 'line', line: 'Still checking for a coin' };
    case 'unchecked':
      return { kind: 'line', line: "Couldn't check for a coin" };
  }
}
