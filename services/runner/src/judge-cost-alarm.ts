/**
 * THE OWNER'S JUDGE COST ALARM (`notify.judgeCost`, the owner 2026-10-20): every `everyMs`, the
 * post judge's average cost a call over the last hour against the median of the same average over
 * the seven days before; past `factor` times it, an `outage` alert for the owner through the same
 * OwnerQueue the disk, bill and language-drop alarms use, at most once every `quietMs`.
 *
 * ★ WHY. On 2026-10-20 from 06:00 to 11:00 London the judge's booked cost a call ran at four to
 * seven times normal, at the same number of calls, for five hours. The day's line still had room,
 * so the supplier warnings (which watch a share of the line) said nothing, and the judge was
 * answering, so the outage alarm said nothing either. Only a cost a call, against its own normal,
 * shows a judge that is still working and suddenly dear.
 *
 * ★ READ FROM THE LEDGER, BY ENDPOINT. internal.spend holds one row per judge call with what it was
 * booked at: the host's own figure when a reply came back, the call's pessimistic estimate when none
 * did (a call cut off by our timeout may still have been billed). Both count: a run of lost calls
 * is the expensive thing this alarm exists to see. Every vendor under the judge's endpoint counts,
 * so a judge moved to another host is still compared with itself; refusals booked at $0 do not.
 *
 * ★ THE MEDIAN OF HOURS, NOT OF CALLS. The last hour's figure is an average over its calls, so it
 * is compared with averages over hours: a call's own cost moves with how many posts it carried,
 * and a median of single calls would sit below every hour's average. Hours with fewer than
 * `minCalls` calls are left out of both sides; with fewer than `minBaselineHours` such hours the
 * judge is too new to have a normal, and nothing is said.
 *
 * ★ AT MOST ONCE EVERY `quietMs`. In this process, by the time of the last alert. Across a restart,
 * by the alert's subject, which names the `quietMs` block of the clock it fell in: the deliverer's
 * claim drops a second queue of it. A restart just after a block boundary may push once more inside
 * six hours; a table to close that gap was not worth a migration.
 *
 * What breaks if changed carelessly: a subject without the block pushes once ever; buckets counted
 * from a clock hour rather than from now make "the last hour" anything from one to sixty minutes.
 */

import type { JudgeCostPolicy } from '@insidor/contracts/policy.ts';
import type { CallBucket } from '@insidor/store';

import { errorText, type Logger } from './log.ts';
import type { OwnerQueue } from './supplier-warnings.ts';

export interface JudgeCostReading {
  /** `over`: past the factor; `normal`: not; `unsure`: too few calls in the hour or too few hours behind it to say. */
  readonly state: 'over' | 'normal' | 'unsure';
  readonly calls: number;
  readonly usd: number;
  readonly perCallUsd: number | null;
  readonly medianUsd: number | null;
  readonly baselineHours: number;
}

/** The middle of the values, or the mean of the two middle ones; null for none. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * The rule, on buckets of `windowMs` counted back from now (bucket 0 the last): bucket 0 against
 * the median average of buckets 1 to `baselineMs / windowMs`, each with at least `minCalls` calls.
 */
export function judgeCostReading(buckets: readonly CallBucket[], p: JudgeCostPolicy): JudgeCostReading {
  const back = Math.floor(p.baselineMs / p.windowMs);
  const last = buckets.find((b) => b.ago === 0);
  const calls = last?.calls ?? 0;
  const usd = last?.usd ?? 0;
  const perCallUsd = calls === 0 ? null : usd / calls;
  const baseline = buckets.filter((b) => b.ago >= 1 && b.ago <= back && b.calls >= p.minCalls).map((b) => b.usd / b.calls);
  const medianUsd = median(baseline);
  const reading = { calls, usd, perCallUsd, medianUsd, baselineHours: baseline.length };
  if (calls < p.minCalls || perCallUsd === null || medianUsd === null || baseline.length < p.minBaselineHours || !(medianUsd > 0)) return { ...reading, state: 'unsure' };
  return { ...reading, state: perCallUsd > p.factor * medianUsd ? 'over' : 'normal' };
}

export interface JudgeCostAlarmDeps {
  readonly policy: JudgeCostPolicy;
  /** The judge endpoint's billed calls in buckets back from `toMs` (store PgSpendRepo.callBuckets). */
  readonly buckets: (fromMs: number, toMs: number, bucketMs: number) => Promise<readonly CallBucket[]>;
  /** OWNER_WALLET; empty: logged only. */
  readonly ownerWallets: readonly string[];
  readonly owner: OwnerQueue;
  readonly log: Logger;
  readonly now: () => number;
}

const iso = (ms: number): string => new Date(ms).toISOString();
/* Dollars a call are fractions of a cent: four places say them; the ratio to one. */
const usd4 = (x: number): number => Math.round(x * 10_000) / 10_000;
const one = (x: number): number => Math.round(x * 10) / 10;

export function judgeCostAlarm(deps: JudgeCostAlarmDeps): { readonly check: () => Promise<number> } {
  /* The alert this process last raised: its subject, when, what it said, and whether it reached the owner. */
  let told: { readonly subject: string; readonly at: number; readonly facts: Record<string, unknown>; delivered: boolean } | null = null;

  const deliver = async (t: NonNullable<typeof told>): Promise<number> => {
    if (deps.ownerWallets.length === 0) return 0;
    try {
      const ids = await deps.owner.ownerIds(deps.ownerWallets);
      for (const userId of ids) await deps.owner.queue(userId, { kind: 'outage', subject: t.subject, rung: 0, facts: t.facts, href: '/#/alerts' });
      /* No profile yet: not marked, so the next pass inside the quiet period tries again. */
      if (ids.length > 0) t.delivered = true;
      return ids.length;
    } catch (e) {
      deps.log.error('a judge cost alert could not be queued; trying again next pass', { subject: t.subject, err: errorText(e) });
      return 0;
    }
  };

  return {
    /** One pass: read, compare, queue when over and not told within `quietMs`. Returns how many alerts were queued. Never throws. */
    async check() {
      const p = deps.policy;
      if (!p.on) return 0;
      const now = deps.now();
      let reading: JudgeCostReading;
      try {
        reading = judgeCostReading(await deps.buckets(now - p.windowMs - p.baselineMs, now, p.windowMs), p);
      } catch (e) {
        deps.log.warn('the judge cost alarm could not read the ledger; trying again next pass', { err: errorText(e) });
        return 0;
      }
      if (reading.state !== 'over' || reading.perCallUsd === null || reading.medianUsd === null) return 0;
      /* Inside the quiet period: nothing new, only a retry of an alert that has not reached the owner. */
      if (told !== null && now - told.at < p.quietMs) return told.delivered ? 0 : deliver(told);
      const facts = {
        what: 'judge-cost',
        perCallUsd: usd4(reading.perCallUsd),
        medianUsd: usd4(reading.medianUsd),
        ratio: one(reading.perCallUsd / reading.medianUsd),
        factor: p.factor,
        calls: reading.calls,
        usd: Math.round(reading.usd * 100) / 100,
        windowMinutes: p.windowMs / 60_000,
        baselineDays: p.baselineMs / 86_400_000,
        at: iso(now),
      };
      told = { subject: `judge-cost|${iso(Math.floor(now / p.quietMs) * p.quietMs)}`, at: now, facts, delivered: false };
      deps.log.error(`the judge cost $${facts.perCallUsd} a call over the last ${facts.windowMinutes} minutes, ${facts.ratio} times its median of $${facts.medianUsd}`, { ...facts, subject: told.subject, alert: deps.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : 'queued for the owner' });
      return deliver(told);
    },
  };
}
