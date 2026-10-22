/**
 * WHAT A PROFILE SAYS, apart from the screens so `node --test` holds it: the Follow button's three
 * states, the mutual followers line, the stats strip's three cells, the move under the portfolio
 * total, a created coin's age, and how long the coin lists run before "Show all".
 *
 * Its own file because these are decisions, not layout: the owner approved each wording
 * (direction B, 2026-10-22), and a screen that worked them out inline would drift from the next.
 *
 * ★ A STAT WE CANNOT SAY IS A DASH WITH ITS REASON UNDER IT, NEVER 0. Zero coins caught is a fact
 * and shows 0; a best catch with nothing bought here to measure from is "—" over "Not bought here";
 * a portfolio its owner hid is "—" over "Hidden" on every cell, never an empty strip that reads as
 * nothing caught.
 *
 * ★ FOLLOW BACK ONLY WHEN THEY FOLLOW YOU AND YOU DO NOT FOLLOW THEM. Following wins: once you
 * follow, whatever they do, the button is the outline "Following".
 *
 * What breaks if changed carelessly: the mutuals count includes the people pictured. "Followed by
 * @a and 4 others" is five people; counting the others as the total would say one too many.
 */

import type { CatchStat, Catches } from '../../shared/api/index.ts';
import { signedUsd } from '../portfolio/wallet-view.ts';

/* ── the Follow button ──────────────────────────────────────────────── */

export type FollowButton = { readonly label: 'Follow' | 'Follow back' | 'Following'; readonly solid: boolean } | null;

/** None on your own profile; solid purple to follow, outline once you do. */
export function followButton(p: { readonly isMe: boolean; readonly iFollow: boolean; readonly followsMe: boolean }): FollowButton {
  if (p.isMe) return null;
  if (p.iFollow) return { label: 'Following', solid: false };
  return { label: p.followsMe ? 'Follow back' : 'Follow', solid: true };
}

/* ── "Followed by @a and 4 others" ──────────────────────────────────── */

interface Mutual {
  readonly handle: string | null;
  readonly name: string | null;
}

const who = (m: Mutual): string => (m.handle !== null ? `@${m.handle}` : (m.name ?? 'someone'));

/** The line under the counts; null when nobody you follow follows them. `count` is everyone in common, pictured or not. */
export function mutualsLine(m: { readonly count: number; readonly people: readonly Mutual[] } | null | undefined): string | null {
  if (m == null || m.count <= 0 || m.people.length === 0) return null;
  const a = m.people[0]!;
  const b = m.people[1];
  if (m.count === 1) return `Followed by ${who(a)}`;
  if (m.count === 2 && b !== undefined) return `Followed by ${who(a)} and ${who(b)}`;
  return `Followed by ${who(a)} and ${plural(m.count - 1)}`;
}

const plural = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'other' : 'others'}`;

/* ── the stats strip ────────────────────────────────────────────────── */

export interface StatCell {
  readonly label: 'Caught early' | 'Best catch' | 'Hit rate';
  /** The figure, or "—". */
  readonly value: string;
  /** Under a dash, why; null under a figure. */
  readonly reason: string | null;
}

const REASON: Readonly<Record<string, string>> = {
  none_caught: 'None yet',
  no_entry: 'Not bought here',
  no_market: 'No price now',
  not_read_yet: 'Not read yet',
};

/** "164×", "2.5×": whole above ten, one place under it. */
export function multipleWords(x: number): string {
  return `${x >= 10 ? Math.round(x).toLocaleString('en-US') : (Math.floor(x * 10) / 10).toFixed(1).replace(/\.0$/, '')}×`;
}

function cell(label: StatCell['label'], s: CatchStat, figure: (n: number) => string): StatCell {
  return s.known ? { label, value: figure(s.amount), reason: null } : { label, value: '—', reason: REASON[s.why] ?? 'Not read yet' };
}

/**
 * The three cells. `catches` null while loading (dashes with no reason yet); `hidden` when the
 * owner turned off "Show my trades" (every cell says so); `noWallet` when there is no wallet to read.
 */
export function statCells(catches: Catches | null, state: 'shown' | 'hidden' | 'no_wallet' = 'shown'): readonly StatCell[] {
  const labels = ['Caught early', 'Best catch', 'Hit rate'] as const;
  if (state !== 'shown') return labels.map((label) => ({ label, value: '—', reason: state === 'hidden' ? 'Hidden' : 'No wallet yet' }));
  if (catches === null) return labels.map((label) => ({ label, value: '—', reason: null }));
  if (catches.kind === 'unavailable') return labels.map((label) => ({ label, value: '—', reason: 'Not read yet' }));
  return [
    cell('Caught early', catches.caughtEarly, (n) => n.toLocaleString('en-US')),
    cell('Best catch', catches.bestCatch, multipleWords),
    cell('Hit rate', catches.hitRate, (n) => `${Math.round(n * 100)}%`),
  ];
}

/* ── the portfolio's move, dollars only ─────────────────────────────── */

export type ProfileRange = '1d' | '1w' | '1m' | '3m' | 'all';

export const PROFILE_RANGES: readonly { readonly key: ProfileRange; readonly label: string }[] = [
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: 'all', label: 'All' },
];

const RANGE_WORDS: Readonly<Record<ProfileRange, string>> = { '1d': 'today', '1w': 'this week', '1m': 'this month', '3m': 'in 3 months', all: 'all time' };

/** "+$412.80 this week": first point to the live total, in dollars. Null with fewer than two points. */
export function moveLine(points: readonly { readonly value: number }[] | null, range: ProfileRange): { readonly text: string; readonly tone: 'up' | 'down' } | null {
  if (points === null || points.length < 2) return null;
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const usd = last - first;
  return { text: `${signedUsd(usd)} ${RANGE_WORDS[range]}`, tone: usd < 0 ? 'down' : 'up' };
}

/** The portfolio total in whole dollars and cents ("$8,214.32"): the one number the screen is about, never shortened. */
export function totalWords(m: { readonly known: true; readonly amount: number } | { readonly known: false }): string {
  return m.known ? `$${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

/* ── created coins ──────────────────────────────────────────────────── */

/** "Launched 3d ago"; "Launched on Insidor" when the time is unknown. */
export function launchedWords(at: number | null, now: number): string {
  if (at === null) return 'Launched on Insidor';
  const ms = Math.max(0, now - at);
  if (ms < 3_600_000) return `Launched ${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (ms < 86_400_000) return `Launched ${Math.floor(ms / 3_600_000)}h ago`;
  return `Launched ${Math.floor(ms / 86_400_000)}d ago`;
}

/* ── how long a list runs ───────────────────────────────────────────── */

/** Rows shown before "Show all". */
export const SHOWN_FIRST = 6;

export function firstRows<T>(rows: readonly T[], all: boolean): { readonly rows: readonly T[]; readonly more: number } {
  if (all || rows.length <= SHOWN_FIRST) return { rows, more: 0 };
  return { rows: rows.slice(0, SHOWN_FIRST), more: rows.length - SHOWN_FIRST };
}
