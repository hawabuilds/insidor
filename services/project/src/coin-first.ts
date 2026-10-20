/**
 * THE COIN-FIRST ROUTE ON FOR YOU (Policy.rising.coinFirst): which posts the route may let in this frame,
 * and the record that it did.
 *
 * Its own file because it is a third way past For You's gates beside the view bar and the coin's vouch
 * (rising.ts), with its own reads — the route's record (0116), every coin tying each post, the pick —
 * and its own write. rising.ts asks `coinFirstLets` per post; the frames call `recordAdmitted` with
 * the posts they actually put on For You by this route alone.
 *
 * What it lets past: the view bar, the order model's score bar (a view-fed number a post found by its
 * coin has barely any readings for), For You's six hours and the junk bar — the owner, 2026-10-20:
 * "forget the views bar; if the judge says yes, it joins". What it does not: the judge's yes (the
 * safety net's `net` route is not a yes), the owner's "No coin is from this" or a coin he called
 * wrong, the variety rule, the cut. And only in Policy.oneCoin.mode 'live', where the pick is the
 * card's coin: in shadow the route would put a post up without the coin that brought it.
 *
 * ★ ONLY THE ORIGINAL (0118). The runner records the coin's linked post as a `pointer` when it points
 * at the viral post or is a launcher's own; the route lets in only the original it walked to, never
 * a pointer — the owner, 2026-10-20: the original viral post, not the launcher's explanation of it.
 *
 * What breaks if changed carelessly: recording a post the route did not put up alone. The launch
 * push treats a recorded post as coin-first (services/notify launch.ts) and would push a coin that
 * launched before a post For You took on its views.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { coinFirstAdmits, coinFirstBars, type CoinFirstTie } from '@insidor/core';
import { PgCoinFirstRepo, type CoinFirstRecord, type Db } from '@insidor/store';

/** The route's posts this frame may let in, with every coin tying each. */
export interface CoinFirstFrame {
  readonly records: ReadonlyMap<string, CoinFirstRecord>;
  readonly ties: ReadonlyMap<string, readonly CoinFirstTie[]>;
}

export const NO_COIN_FIRST: CoinFirstFrame = { records: new Map(), ties: new Map() };

/** Whether the route is in force: switched on, and the pick is what the cards show. */
export const coinFirstOn = (policy: Policy = DEFAULT_POLICY): boolean => policy.rising.coinFirst.on && policy.oneCoin.mode === 'live';

/**
 * The route's posts whose coin launched within `admitWithinMs`, and those of `members` (For You's
 * members: a post the route let in keeps its place as any member does) — or only the posts of
 * `only`, for a frame over a few — each with every coin tying it. Nothing when the route is off.
 */
export async function loadCoinFirst(db: Db, nowMs: number, policy: Policy = DEFAULT_POLICY, only: readonly string[] | null = null, members: readonly string[] = []): Promise<CoinFirstFrame> {
  if (!coinFirstOn(policy)) return NO_COIN_FIRST;
  const repo = new PgCoinFirstRepo(db);
  const since = (nowMs - policy.rising.coinFirst.admitWithinMs) as Millis;
  const rows = await repo.records(only === null ? since : null, only ?? members);
  const memberSet = new Set(members);
  /* ★ A pointer (0118: the coin's linked post that only pointed at the original, or a launcher's own) is never the route's. */
  const fresh = rows.filter((r) => r.role !== 'pointer' && (r.launchedAtMs >= since || (r.admittedAtMs !== null && (only !== null || memberSet.has(r.itemId)))));
  if (fresh.length === 0) return NO_COIN_FIRST;
  const ties = await repo.ties(fresh.map((r) => r.itemId));
  return { records: new Map(fresh.map((r) => [r.itemId, r] as const)), ties };
}

/** The facts about one post the route reads in a frame. */
export interface CoinFirstPost {
  readonly itemId: string;
  readonly postedAtMs: number | null;
  /** The judge said yes (not the safety net) and the owner did not turn it down. */
  readonly judgedYes: boolean;
  readonly pick: { readonly outcome: 'picked' | 'waiting' | 'none'; readonly address: string | null } | null;
  readonly member: boolean;
  /** The owner said "No coin is from this" on the post. */
  readonly ownerNone: boolean;
  /** The coins the owner called wrong for the post. */
  readonly wrong: ReadonlySet<string>;
}

/** Whether the route lets this post onto For You now (core `coinFirstAdmits`, with the owner's word over it). */
export function coinFirstLets(p: CoinFirstPost, frame: CoinFirstFrame, nowMs: number, policy: Policy = DEFAULT_POLICY): boolean {
  const record = frame.records.get(p.itemId);
  if (record === undefined || record.role === 'pointer' || !p.judgedYes || p.ownerNone) return false;
  if (p.pick?.address !== null && p.pick?.address !== undefined && p.wrong.has(p.pick.address)) return false;
  return coinFirstAdmits({ postedAtMs: p.postedAtMs, pick: p.pick, ties: frame.ties.get(p.itemId) ?? [], admittedAtMs: record.admittedAtMs, member: p.member }, nowMs, coinFirstBars(policy));
}

/** The posts a frame put on For You by the route alone: `admitted_at` set once (0116). */
export async function recordAdmitted(db: Db, itemIds: readonly string[], nowMs: number): Promise<void> {
  if (itemIds.length === 0) return;
  await new PgCoinFirstRepo(db).admitted(itemIds, nowMs as Millis);
}
