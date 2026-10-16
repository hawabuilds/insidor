/**
 * THE OTHER JUDGE, ASKED BESIDE THE LIVE ONE AND NEVER SHOWN (Policy.judge.shadow): every batch of
 * posts the live judge answered is sent, unchanged — the same posts, the same precedents, the same
 * learned block — to the judge that did not answer it, and both answers are kept side by side in
 * internal.judge_shadow (0089) for tools/judge-shadow-report.ts.
 *
 * Its own file, apart from the scorer, because nothing about it may touch the feed: it never
 * writes internal.post_judgement, never delays a live batch, and its failure is a log line. The
 * scorer only offers it each answered batch.
 *
 * ★ NEVER IN THE LIVE JUDGE'S WAY. `offer` returns at once; the shadow call runs on its own, at
 * most `maxInFlight` at a time, and a batch offered past that is skipped and counted. The open
 * model is about four times slower a post than the main judge, so on a busy pass it is skipped
 * rather than queued without end.
 *
 * ★ CAPPED PER UTC DAY, IN THE DATABASE. What the shadow spent today is read from the capped
 * lanes' ledger (0088, lane `judge_shadow`) before every call and added to after, so a restart
 * does not refill it; an unreadable ledger means no shadow call (fail closed, as the lanes do), and so
 * does a database without its table (0089): nothing is paid for that could not be kept.
 * It spends on the live book under its own endpoint, `judge-shadow`, so the outage alarm's count
 * of the live judge's calls (0087) never counts it. At the cap it stops for the day and says so once.
 *
 * ★ ONLY THE POST QUESTION. The kind question and the close-match hold are the same rules for both
 * models and are applied to the yes/no the report compares; asking the shadow the kind too would
 * double its spend for an answer that only matters after a yes.
 *
 * ★ A LIVE ANSWER FROM THE SHADOW'S OWN MODEL IS NOT SHADOWED. During a failover the live answer
 * came from the other model already; asking it again would compare a model with itself.
 *
 * ★ EVERY LIVE POST-QUESTION CALL IS OFFERED, not only the scorer's. The coin universe (work/
 * universe.ts) asks the same post judge about coin creators' posts and files live answers the feed
 * reads; on 2026-10-16 it was the only caller for the first hour after the shadow went out, while
 * the scorer waited on discovery, and the shadow wrote nothing.
 *
 * ★ EVERY REASON IT ASKS NOTHING IS SAID, ONCE, AT WARN: no table, an unreadable ledger, the cap,
 * the meter refusing, a failed call, nothing to store. The first batch it does store is said once at
 * info. A shadow that is silent and empty cannot be told from one never called.
 *
 * What breaks if changed carelessly: awaiting `offer` in the scorer. The live judge would then wait
 * on the slower model, which is exactly what the shadow was built not to do.
 */

import type { Millis } from '@insidor/contracts';
import type { ItemId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PgJudgeShadowRepo, ShadowPair } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from './log.ts';
import { ledgerDay, type LaneLedger } from './work/lane-ledger.ts';

/** The ledger endpoint the shadow's calls are metered under, for either model. */
export const SHADOW_ENDPOINT = 'judge-shadow';
/** Its row in the capped lanes' ledger (0088). */
export const SHADOW_LANE = 'judge_shadow';

/** One post the live judge answered, as the scorer sent it. */
export interface Offered {
  readonly itemId: ItemId;
  readonly subject: JudgeSubject;
  readonly live: JudgeOutcome;
}

export interface ShadowDeps {
  /** The shadow judge for the block in use (it follows each learned-block swap); null: none. */
  readonly port: () => JudgePort | null;
  /** Whether an answer's judge id is the shadow's own model's (such a live answer is not shadowed). */
  readonly ownAnswer: (judgeId: string) => boolean;
  readonly ledger: LaneLedger;
  readonly pairs: Pick<PgJudgeShadowRepo, 'record' | 'ready'>;
  readonly meter: Meter;
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
  /** Wall clock for the seconds a post; injectable for tests. */
  readonly clock?: () => number;
}

export interface Shadow {
  /** Offers one answered live batch; never waits and never throws. */
  offer(batch: readonly Offered[], liveSecondsPerPost: number | null): void;
  /** Resolves when every shadow call started so far has finished (tests, shutdown). */
  idle(): Promise<void>;
  readonly stats: { asked: number; skippedBusy: number; skippedCap: number; failed: number };
}

export function judgeShadow(deps: ShadowDeps): Shadow {
  const S = deps.policy.judge.shadow;
  const clock = deps.clock ?? (() => performance.now());
  const stats = { asked: 0, skippedBusy: 0, skippedCap: 0, failed: 0 };
  const running = new Set<Promise<void>>();
  let capSaidFor: string | null = null;
  let busySaid = false;
  /* Each reason it asks nothing (or stores nothing) is said once at warn; the first stored batch once at info. */
  const said = new Set<string>();
  const once = (key: string, msg: string, fields: Record<string, unknown> = {}): void => {
    if (said.has(key)) return;
    said.add(key);
    deps.log.warn(msg, fields);
  };

  /* Whether 0089 is applied: checked until it is, so no call is paid for with nowhere to keep its answers. */
  let tableReady = false;
  let tableSaid = false;

  async function run(port: JudgePort, batch: readonly Offered[], liveSecondsPerPost: number | null): Promise<void> {
    if (!tableReady) {
      tableReady = await deps.pairs.ready();
      if (!tableReady) {
        if (!tableSaid) deps.log.warn('judge shadow: internal.judge_shadow is missing (0089 not applied); nothing is asked until it is');
        tableSaid = true;
        return;
      }
    }
    const now = deps.now();
    const subjects = batch.map((b) => b.subject);
    const spent = await deps.ledger.spent(SHADOW_LANE, now);
    if (spent === null) {
      stats.skippedCap += batch.length;
      once('ledger', 'judge shadow: what it spent today cannot be read; it asks nothing until it can', { lane: SHADOW_LANE });
      return;
    }
    const estimate = port.estimate(subjects);
    if (spent + estimate.usd > S.dailyUsd) {
      stats.skippedCap += batch.length;
      if (capSaidFor !== ledgerDay(now)) {
        capSaidFor = ledgerDay(now);
        deps.log.info('judge shadow: stopped for the day at its cap', { spentUsd: Number(spent.toFixed(4)), capUsd: S.dailyUsd, asked: stats.asked });
      }
      return;
    }
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      stats.skippedCap += batch.length;
      once('meter', 'judge shadow: the live book refused its call; it asks nothing while that holds', { vendor: estimate.vendor, usd: estimate.usd });
      return;
    }
    const line = deps.meter.line(estimate.vendor);
    const t = clock();
    let outcomes: readonly JudgeOutcome[] | null = null;
    let failure: string | null = null;
    let usd = 0;
    try {
      const result = await port.judge(subjects, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (now + deps.policy.judge.timeoutMs * deps.policy.judge.maxAttempts) as Millis });
      outcomes = result.value;
      usd = result.spend.usd;
    } catch (e) {
      if (e instanceof BudgetRefused) {
        stats.skippedCap += batch.length;
        once('budget', 'judge shadow: the live book refused its call at the vendor edge', { err: errorText(e) });
        return;
      }
      failure = errorText(e);
      once('call', 'judge shadow: a call failed (later failures are counted, not logged)', { err: failure });
    }
    const seconds = (clock() - t) / 1000 / Math.max(1, batch.length);
    await deps.ledger.add(SHADOW_LANE, now, usd);
    stats.asked += batch.length;
    const pairs: ShadowPair[] = batch.flatMap((b, i): ShadowPair[] => {
      if (b.live.kind !== 'judged') return [];
      const l = b.live.judgement;
      const o = outcomes?.[i];
      const s = o?.kind === 'judged' ? o.judgement : null;
      if (s === null) stats.failed += 1;
      return [{
        itemId: String(b.itemId),
        askedAt: new Date(now),
        question: 'post',
        live: { judgeId: l.judgeId, promptId: l.promptId, coinable: l.coinable, confidence: l.confidence, lookedAt: l.lookedAt, name: l.proposedName, costUsd: l.costUsd, sPerPost: liveSecondsPerPost },
        shadow: s === null ? null : { judgeId: s.judgeId, promptId: s.promptId, coinable: s.coinable, confidence: s.confidence, lookedAt: s.lookedAt, name: s.proposedName },
        shadowCostUsd: s?.costUsd ?? (batch.length === 0 ? 0 : usd / batch.length),
        shadowSPerPost: outcomes === null ? null : seconds,
        shadowDetail: s !== null ? null : o?.kind === 'unavailable' ? o.detail : (failure ?? 'no outcome'),
      }];
    });
    if (outcomes !== null && outcomes.every((o) => o.kind !== 'judged')) once('unanswered', 'judge shadow: the other judge answered none of a batch (later ones are counted, not logged)', { reason: outcomes.find((o) => o.kind === 'unavailable')?.detail ?? null });
    try {
      await deps.pairs.record(pairs);
      if (pairs.length > 0 && !said.has('stored')) {
        said.add('stored');
        deps.log.info('judge shadow: first batch stored', { posts: pairs.length, usd });
      }
    } catch (e) {
      once('store', 'judge shadow: its answers could not be stored (later failures are not logged)', { posts: pairs.length, err: errorText(e) });
    }
  }

  return {
    stats,
    offer(batch, liveSecondsPerPost) {
      if (!S.on) return;
      const port = deps.port();
      if (port === null) return;
      const asked = batch.filter((b) => b.live.kind === 'judged' && !deps.ownAnswer(b.live.judgement.judgeId));
      if (asked.length === 0) return;
      if (running.size >= S.maxInFlight) {
        stats.skippedBusy += asked.length;
        if (!busySaid) {
          busySaid = true;
          deps.log.info('judge shadow: busy, skipping batches until a call finishes (counted)', { maxInFlight: S.maxInFlight });
        }
        return;
      }
      busySaid = false;
      const p = run(port, asked, liveSecondsPerPost)
        .catch((e: unknown) => once('threw', 'judge shadow: a shadow pass threw (later ones are not logged)', { err: errorText(e) }))
        .finally(() => running.delete(p));
      running.add(p);
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}
