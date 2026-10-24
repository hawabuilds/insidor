/**
 * THE RUNNER HAND-OVER, IN THE RUNNER (Policy.runnerLink.handover, core match/runner-handover.ts):
 * every held post pick of the last two days, looked at again with the later coins made for the post
 * whenever the market reader's readings land, and handed to one that runs at three times the held
 * coin's hour — with the change recorded (coin_pick_change) and the evidence kept on the pick.
 *
 * Why its own step and not the one-coin rule's: that rule judges only posts with a candidate found in
 * the last hour (`openCandidates`), and on lifetime net buying, so a coin that starts running hours
 * after the first coin — or keeps running after its own first hour — never moves the pick. This step
 * reads the picks themselves, and the coins' last hour only. It runs inside the one-coin pass
 * (work/one-coin.ts), at its own slower cadence, so it shares the pass's supervised loop and its
 * process.
 *
 * One pass, DB only (no call, no cost):
 *   picks      the held post picks written within Policy.runnerLink.running.pickWithinMs
 *   coins      every candidate of those posts (0113), with what ties it
 *   hours      each coin's newest reading within Policy.market.readingFreshnessMs: dollars and trades
 *              in its last hour (0127), and its cap
 *   decide     core `runnerHandover` on the saved-post push's bars (Policy.notify.savedPost), the
 *              pick's cap bar (Policy.oneCoin.minCapUsd) and its hand-over ratio
 *              (Policy.oneCoin.handOverRatio) — never on a post the owner made a coin call on
 *   write      the new pick, `runner_handover` in its evidence with both coins' hours; the push is
 *              services/notify launch.ts, which reads that evidence
 *
 * ★ THE PICK IS THIS RULE'S FROM THEN ON. A pick this step wrote is passed over by the one-coin
 * rule (work/one-coin.ts `heldByRunner`): it would judge the coin on its first hour's buying again and
 * hand the pick straight back to the coin that bought more back then. Only this step moves it again —
 * to a later runner, or back to the coin it came from by the same test.
 *
 * What breaks if changed carelessly: dropping the owner-call check. His "Right coin" on a post is
 * truth; a coin running past it would put the rule over his word on every card that shows the pick.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { runnerHandover, type CoinHour, type HandoverBars, type HandoverCoin, type MatchEvidence } from '@insidor/core';
import type { CandidateRow, PickWrite, StoredPick } from '@insidor/store';

import type { Logger } from '../log.ts';

/** The held picks looked at a pass, at most: about a thousand are held over two days (24 Oct). */
const PICKS_READ = 3_000;

/** The evidence word a hand-over by this rule leaves on the pick (core `MatchEvidence` is the tie's, this is the reason). */
export const RUNNER_HANDOVER = 'runner_handover';

export interface RunnerHandoverDeps {
  readonly heldPostPicks: (sinceMs: number, limit: number) => Promise<readonly StoredPick[]>;
  readonly candidatesOf: (itemIds: readonly string[]) => Promise<readonly CandidateRow[]>;
  readonly lastHours: (addresses: readonly string[], sinceMs: number) => Promise<ReadonlyMap<string, CoinHour>>;
  /** The posts of these ids whose newest coin call is not "cleared". Absent: none. */
  readonly ownerCalled?: (itemIds: readonly string[]) => Promise<ReadonlySet<string>>;
  readonly writePicks: (picks: readonly PickWrite[], previous: ReadonlyMap<string, StoredPick>, mode: 'shadow' | 'live', nowMs: number) => Promise<number>;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => number;
}

export interface Handover {
  readonly itemId: string;
  readonly from: string;
  readonly to: string;
  readonly fromHour: CoinHour;
  readonly toHour: CoinHour;
}

/** Whether this rule put the stored pick where it is. */
export const heldByRunner = (p: StoredPick | undefined): boolean => p?.outcome === 'picked' && p.evidence[RUNNER_HANDOVER] === true;

const tiesOf = (r: CandidateRow): MatchEvidence[] => {
  const t = r.evidence['ties'];
  return Array.isArray(t) ? t.filter((x): x is MatchEvidence => typeof x === 'string') : [];
};

/** The bars, every one from a field the owner already set. */
export const handoverBars = (P: Policy): HandoverBars => ({
  minVolume1hUsd: P.notify.savedPost.minVolume1hUsd,
  minTrades1h: P.notify.savedPost.minTrades1h,
  minCapUsd: P.oneCoin.minCapUsd,
  ratio: P.oneCoin.handOverRatio,
});

/** One pass. Returns the hand-overs written. */
export async function runnerHandoverPass(deps: RunnerHandoverDeps): Promise<readonly Handover[]> {
  const P = deps.policy;
  if (!P.runnerLink.handover.on) return [];
  const now = deps.now();
  const held = await deps.heldPostPicks(now - P.runnerLink.running.pickWithinMs, PICKS_READ);
  if (held.length === 0) return [];
  const rows = await deps.candidatesOf(held.map((p) => p.subjectId));
  const byPost = new Map<string, CandidateRow[]>();
  for (const r of rows) byPost.set(r.itemId, [...(byPost.get(r.itemId) ?? []), r]);
  /* Only a post with a later coin made for it is worth an hour read. */
  const subjects = held.filter((p) => (byPost.get(p.subjectId) ?? []).some((r) => r.address !== p.address && tiesOf(r).some((t) => t === 'link' || t === 'name_stated')));
  if (subjects.length === 0) return [];
  const called = deps.ownerCalled === undefined ? new Set<string>() : await deps.ownerCalled(subjects.map((p) => p.subjectId));
  const open = subjects.filter((p) => !called.has(p.subjectId));
  const addresses = [...new Set(open.flatMap((p) => [p.address ?? '', ...(byPost.get(p.subjectId) ?? []).map((r) => r.address)]).filter((a) => a !== ''))];
  const hours = await deps.lastHours(addresses, now - P.market.readingFreshnessMs);
  const bars = handoverBars(P);

  const out: Handover[] = [];
  const writes: PickWrite[] = [];
  for (const p of open) {
    if (p.address === null) continue;
    const cands = byPost.get(p.subjectId) ?? [];
    const own = cands.find((r) => r.address === p.address);
    const from = heldByRunner(p) && typeof p.evidence['handedOverFrom'] === 'string' ? (p.evidence['handedOverFrom'] as string) : null;
    const coins: HandoverCoin[] = cands.map((r) => ({ address: r.address, launchedAtMs: r.launchedAtMs, ties: tiesOf(r), hour: hours.get(r.address) ?? null }));
    const o = runnerHandover({ address: p.address, launchedAtMs: own?.launchedAtMs ?? null, hour: hours.get(p.address) ?? null, handedFrom: from }, coins, bars);
    if (o.kind !== 'hand_over') continue;
    const ties = coins.find((c) => c.address === o.to)?.ties ?? [];
    out.push({ itemId: p.subjectId, from: o.from, to: o.to, fromHour: o.fromHour, toHour: o.toHour });
    writes.push({
      subjectId: p.subjectId,
      address: o.to,
      outcome: 'picked',
      decidedAtMs: now,
      evidence: {
        mode: P.oneCoin.mode,
        basis: 'market_readings',
        reason: RUNNER_HANDOVER,
        [RUNNER_HANDOVER]: true,
        handedOverFrom: o.from,
        ties,
        toVolume1hUsd: o.toHour.volume1hUsd,
        toTrades1h: o.toHour.trades1h,
        toCapUsd: o.toHour.capUsd,
        fromVolume1hUsd: o.fromHour.volume1hUsd,
        fromTrades1h: o.fromHour.trades1h,
        fromCapUsd: o.fromHour.capUsd,
        standings: [],
      },
      basis: 'market_readings',
    });
  }
  if (writes.length > 0) {
    await deps.writePicks(writes, new Map(held.map((p) => [p.subjectId, p] as const)), P.oneCoin.mode, now);
    for (const h of out) deps.log.info('runner hand-over', { itemId: h.itemId, from: h.from, to: h.to, fromVolume1hUsd: h.fromHour.volume1hUsd, toVolume1hUsd: h.toHour.volume1hUsd, toCapUsd: h.toHour.capUsd });
  }
  return out;
}
