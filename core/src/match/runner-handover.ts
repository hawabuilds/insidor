/**
 * THE RUNNER HAND-OVER: a post's held coin gives the pick to a LATER coin of the same post that is
 * running now and trading three times its hour (the owner, 2026-10-24: a later coin that runs on a
 * post we already hold must not be stuck behind the first as a "copycat").
 *
 * Its own rule, beside `pickOneCoin` (one-coin.ts), because it asks a different question at a
 * different time. `pickOneCoin` judges a launch's first hour on net buying since launch, and a held
 * coin is handed over only to a rival with three times ITS LIFETIME buying — a bar a coin launched
 * hours later can never meet against a coin that already ran, so the post's pick sits on a dead coin
 * while the real runner trades. This compares the two coins' LAST HOUR only, on market readings,
 * whenever they land; the caller (services/runner work/runner-handover.ts) runs it over every held
 * pick of the last two days.
 *
 *   tied      only a coin the creators made for the post: a link to it (one hop through a promotion
 *             included) or its whole stated name. A coin that merely shares a name is the copycat
 *             problem itself and never takes a pick by this rule.
 *   later     launched after the held coin — or the very coin this rule last took the pick from
 *             (`handedFrom`): it may take it back, by this same test against the new one, and by no
 *             other. Three times each way means a swing of nine before the pick could move twice.
 *   running   its last hour reaches the dollar AND trade bars, and its cap the pick's own cap bar.
 *   ahead     its last hour's dollars are at least `ratio` times the held coin's.
 *
 * ★ AN UNREAD HOUR IS NOT A QUIET ONE. A held coin with no fresh reading, or a reading without its
 * hour, cannot be said to trade three times less than anything: the pick stays (`held_unread`). A
 * held coin whose launch time is unknown cannot be said to be earlier either (`held_undated`). A
 * rival with no hour is not running.
 *
 * What breaks if changed carelessly: dropping the cap bar. Measured on 24 Oct, seven of nine hand-
 * overs without it went to $3-6K coins that bots churned past $20,000 in their first hour and that
 * never passed $17K; each would have been pushed to everyone as the post's running coin.
 */

import type { MatchEvidence } from './one-coin.ts';

/** A coin's last hour from its newest fresh market reading, and that reading's cap. */
export interface CoinHour {
  readonly volume1hUsd: number;
  readonly trades1h: number;
  /** The reading's market cap; null when it gave none. */
  readonly capUsd: number | null;
}

export interface HandoverCoin {
  readonly address: string;
  /** Null when unknown. */
  readonly launchedAtMs: number | null;
  /** What ties it to the post (0113 candidate evidence). */
  readonly ties: readonly MatchEvidence[];
  /** Null: no fresh reading, or one without its hour. */
  readonly hour: CoinHour | null;
}

export interface HandoverHeld {
  readonly address: string;
  readonly launchedAtMs: number | null;
  readonly hour: CoinHour | null;
  /** The coin this rule last took the pick from, when this rule put the held coin there; else null. */
  readonly handedFrom: string | null;
}

export interface HandoverBars {
  readonly minVolume1hUsd: number;
  readonly minTrades1h: number;
  readonly minCapUsd: number;
  readonly ratio: number;
}

export type HandoverOutcome =
  | { readonly kind: 'hand_over'; readonly to: string; readonly from: string; readonly toHour: CoinHour; readonly fromHour: CoinHour }
  | { readonly kind: 'keep'; readonly reason: 'no_runner' | 'held_unread' | 'held_undated' | 'under_ratio' };

/** The ties that are the creators making the post's own coin, for this rule. */
const MADE_FOR_POST: readonly MatchEvidence[] = ['link', 'name_stated'];

/** Running by the bars: dollars AND trades in the hour, and the cap. No hour, or no cap, is not running. */
export function runsAt(hour: CoinHour | null, bars: HandoverBars): boolean {
  return hour !== null && hour.volume1hUsd >= bars.minVolume1hUsd && hour.trades1h >= bars.minTrades1h && hour.capUsd !== null && hour.capUsd >= bars.minCapUsd;
}

/** Whether the held coin hands its post's pick to one of `coins`, and to which: the busiest hour that qualifies. */
export function runnerHandover(held: HandoverHeld, coins: readonly HandoverCoin[], bars: HandoverBars): HandoverOutcome {
  const heldLaunch = held.launchedAtMs;
  const eligible = coins.filter(
    (c) =>
      c.address !== held.address &&
      c.ties.some((t) => MADE_FOR_POST.includes(t)) &&
      (c.address === held.handedFrom || (heldLaunch !== null && c.launchedAtMs !== null && c.launchedAtMs > heldLaunch)) &&
      runsAt(c.hour, bars),
  );
  if (eligible.length === 0) return { kind: 'keep', reason: heldLaunch === null && held.handedFrom === null ? 'held_undated' : 'no_runner' };
  if (held.hour === null) return { kind: 'keep', reason: 'held_unread' };
  const heldHour = held.hour;
  const best = [...eligible].sort((a, b) => (b.hour?.volume1hUsd ?? 0) - (a.hour?.volume1hUsd ?? 0) || a.address.localeCompare(b.address))[0];
  if (best === undefined || best.hour === null || best.hour.volume1hUsd < bars.ratio * heldHour.volume1hUsd) return { kind: 'keep', reason: 'under_ratio' };
  return { kind: 'hand_over', to: best.address, from: held.address, toHour: best.hour, fromHour: heldHour };
}
