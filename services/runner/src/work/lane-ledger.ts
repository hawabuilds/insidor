/**
 * THE CAPPED LANES' LEDGER, AS THE RUNNER USES IT: what a lane has spent today, read before it
 * asks, and what it just spent, added after (internal.lane_spend, 0088; `LaneCapPolicy`).
 *
 * Its own file because two lanes in two loops use it — the text source's middle lane
 * (work/discover.ts) and the short-video learned-tag lane (work/search-words.ts) — and both must
 * fail the same way.
 *
 * ★ IT FAILS CLOSED. A ledger that cannot be read answers null, and a lane that gets null does
 * not ask: before 0088 is applied, or while the database is away, the lane loses finds and never
 * spends money it cannot count. A failed write is logged and the money stays spent at the vendor;
 * the next read is then low by that ask, which is the one way this can overrun, by one ask.
 *
 * The day is the UTC day, the same day the live book's meter counts.
 *
 * What breaks if changed carelessly: answering 0 for an unreadable ledger would let every restart
 * spend the lane's whole cap again.
 */

import type { Millis } from '@insidor/contracts';
import type { PgLaneSpendRepo } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

/**
 * The capped lanes, by the name their finds are credited under (0088), and the judge's shadow
 * (judge-shadow.ts, Policy.judge.shadow), which keeps its day's spend in the same ledger for the
 * same reason: a restart must not hand it a fresh day's money. So do For You's view readings
 * (work/readings.ts, Policy.feed.readings). The table holds any lane name.
 */
export type CappedLane = 'middle' | 'learned_tag' | 'judge_shadow' | 'readings' | 'judge_early';

export interface LaneLedger {
  /** Dollars the lane has recorded today, or null when that cannot be read (do not ask). */
  spent(lane: CappedLane, now: Millis): Promise<number | null>;
  /** Adds what an ask cost (its search bill and the judging it brings in) to today's row. */
  add(lane: CappedLane, now: Millis, usd: number): Promise<void>;
}

/** The UTC date of an instant, as the ledger keys its rows. */
export const ledgerDay = (now: Millis): string => new Date(now).toISOString().slice(0, 10);

export function laneLedger(repo: Pick<PgLaneSpendRepo, 'spent' | 'add'>, log: Logger): LaneLedger {
  return {
    async spent(lane, now) {
      try {
        return await repo.spent(lane, ledgerDay(now));
      } catch (e) {
        log.warn('a capped lane cannot read what it spent today; it asks nothing until it can', { lane, err: errorText(e) });
        return null;
      }
    },
    async add(lane, now, usd) {
      try {
        await repo.add(lane, ledgerDay(now), usd, new Date(now));
      } catch (e) {
        log.error('a capped lane could not record what it spent; the next read is low by this ask', { lane, usd, err: errorText(e) });
      }
    },
  };
}

/** A ledger in memory, for tests and dry runs. */
export function memoryLaneLedger(start: Partial<Record<CappedLane, number>> = {}): LaneLedger & { readonly totals: Map<string, number> } {
  const totals = new Map<string, number>();
  return {
    totals,
    spent: async (lane, now) => totals.get(`${ledgerDay(now)}:${lane}`) ?? start[lane] ?? 0,
    add: async (lane, now, usd) => void totals.set(`${ledgerDay(now)}:${lane}`, (totals.get(`${ledgerDay(now)}:${lane}`) ?? start[lane] ?? 0) + Math.max(0, usd)),
  };
}
