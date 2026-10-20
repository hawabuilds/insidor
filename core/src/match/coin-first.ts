/**
 * THE COIN-FIRST ROUTE'S TWO DECISIONS (Policy.rising.coinFirst): what the runner does next for a post
 * a running coin's own link ties (`coinFirstStep`), and whether For You takes it (`coinFirstAdmits`).
 *
 * Its own file beside one-coin.ts because it is a way onto For You, not a way to pick a coin: it READS
 * the one-coin rule's pick and never changes it. The runner (services/runner work/coin-first.ts) and
 * the projector (services/project coin-first.ts) both call these, so the post the route pays to judge
 * and the post it lets in are held to the same age bound.
 *
 * ★ THE TIE IS THE COIN'S OWN LINK, ONE HOP. The coin's metadata names the post, or names a post that
 * reposts or quotes it — the caller resolves that hop from the linked post's own `reproduction_of` /
 * `rebroadcast_of`, never further (one-coin.ts says why: a chain ties a coin to whatever went viral
 * first). The post must have been at most `maxPostAgeAtLaunchMs` old at the coin's launch (the
 * owner's 48 hours, `oneCoin.linkMaxAgeMs`), and not posted more than `launchAllowanceMs` after it
 * (clock skew: a coin cannot name a post that did not exist).
 *
 * ★ THE JUDGE'S YES AND THE RUNNING COIN, BOTH. A link proves people made a coin of the post, not that
 * the post is memeable: the judge decides that, as for any post, and the caller holds it to the same
 * yes (rising.ts `postRoute`). And a yes alone is not enough: replayed over 13-20 Oct, the posts
 * coins linked that the judge said yes to came to about 1,650 a day, 3% of which ever had a coin that
 * ran. So the post joins only when the one-coin rule PICKED a coin that ties it this way — that
 * coin, and no other, is then the card's coin.
 *
 * ★ AN UNKNOWN IS NOT A PASS. No post time, no launch time, no pick: the route does nothing.
 *
 * What breaks if changed carelessly: `admittedAtMs`. A post joins by this route once; a post that
 * left For You (the window, the owner's call) is not put back by the same coin on the next frame.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

export interface CoinFirstBars {
  readonly maxPostAgeAtLaunchMs: number;
  readonly launchAllowanceMs: number;
  readonly admitWithinMs: number;
}

export const coinFirstBars = (p: Policy): CoinFirstBars => ({
  maxPostAgeAtLaunchMs: p.oneCoin.linkMaxAgeMs,
  launchAllowanceMs: p.origin.launchAllowanceMs,
  admitWithinMs: p.rising.coinFirst.admitWithinMs,
});

/** Whether a coin launched at `launchedAtMs` may bring a post posted at `postedAtMs` by this route. */
export function inRouteAge(postedAtMs: number | null, launchedAtMs: number | null, bars: Pick<CoinFirstBars, 'maxPostAgeAtLaunchMs' | 'launchAllowanceMs'>): boolean {
  if (postedAtMs === null || launchedAtMs === null) return false;
  const after = launchedAtMs - postedAtMs;
  return after >= -bars.launchAllowanceMs && after <= bars.maxPostAgeAtLaunchMs;
}

/** A post a running coin's link ties, as the runner holds it. */
export interface CoinFirstTarget {
  readonly held: boolean;
  /** Null when the post is not held, or its source gave no time. */
  readonly postedAtMs: number | null;
  readonly launchedAtMs: number;
  /** The post question has an answer (any answer: the route asks once). */
  readonly judged: boolean;
  /** Some lane already credits it, so For You reads it. */
  readonly credited: boolean;
  readonly fetchAsked: boolean;
  readonly judgeAsked: boolean;
}

/**
 * What the runner does next: read it by id (`fetch`), ask the judge (`judge`), credit it so For You
 * reads it (`credit`), or nothing — `wait` (asked, no answer yet), `done`, `gone` (read once and the
 * source returned nothing), `out_of_age` (too old at the launch, or no time to tell).
 */
export type CoinFirstStep = 'fetch' | 'judge' | 'credit' | 'wait' | 'done' | 'gone' | 'out_of_age';

export function coinFirstStep(t: CoinFirstTarget, bars: Pick<CoinFirstBars, 'maxPostAgeAtLaunchMs' | 'launchAllowanceMs'>): CoinFirstStep {
  if (!t.held) return t.fetchAsked ? 'gone' : 'fetch';
  if (!inRouteAge(t.postedAtMs, t.launchedAtMs, bars)) return 'out_of_age';
  if (!t.judged) return t.judgeAsked ? 'wait' : 'judge';
  return t.credited ? 'done' : 'credit';
}

/** A coin tying the post by its own link or one hop, with its launch. */
export interface CoinFirstTie {
  readonly address: string;
  readonly launchedAtMs: number | null;
}

export interface CoinFirstAdmitFacts {
  readonly postedAtMs: number | null;
  /** The one-coin rule's pick for the post now; null when it has none. */
  readonly pick: { readonly outcome: 'picked' | 'waiting' | 'none'; readonly address: string | null } | null;
  readonly ties: readonly CoinFirstTie[];
  /** When a frame first let it in by this route; null when never. */
  readonly admittedAtMs: number | null;
  /** On For You already (feed membership): it stays as any member does. */
  readonly member: boolean;
}

/**
 * Whether the route lets the post onto For You now (the judge's yes is the caller's): the pick is a
 * coin that ties it, launched within the age bound, and either it is already a member or the coin
 * launched within `admitWithinMs` and the route never let it in before.
 */
export function coinFirstAdmits(f: CoinFirstAdmitFacts, nowMs: number, bars: CoinFirstBars): boolean {
  if (f.pick === null || f.pick.outcome !== 'picked' || f.pick.address === null) return false;
  const address = f.pick.address;
  const tie = f.ties.find((t) => t.address === address);
  if (tie === undefined || !inRouteAge(f.postedAtMs, tie.launchedAtMs, bars)) return false;
  if (f.member) return true;
  return f.admittedAtMs === null && tie.launchedAtMs !== null && nowMs - tie.launchedAtMs <= bars.admitWithinMs;
}

/** The earliest-launched of the coins tying a post (the lower address on a tie); null when none has a launch time. */
export function firstTie(ties: readonly CoinFirstTie[]): CoinFirstTie | null {
  const known = ties.filter((t) => t.launchedAtMs !== null);
  return known.sort((a, b) => (a.launchedAtMs ?? 0) - (b.launchedAtMs ?? 0) || a.address.localeCompare(b.address))[0] ?? null;
}
