/**
 * THE FEED JUDGE WITH A SECOND SUPPLIER BEHIND IT: a judge port that asks the primary judge and,
 * when the primary cannot answer a batch, asks the other one at once (Policy.judge.failover).
 *
 * Its own file, apart from both adapters, because the decision "this supplier is down" is about
 * the two of them together: either adapter alone can only say its own call failed. The scorer is
 * handed one port and never knows which model answered — each answer names its own judge id, so
 * the projector holds it to that model's cutoff (Policy.judge.cutoffs) and the record says who.
 *
 * ★ WHAT COUNTS AS THE PRIMARY FAILING A BATCH. The call threw (anything but a budget refusal); or
 * no reply came within `deadlineMs` (the whole batch, the adapter's own retries included); or not
 * one post in the batch was answered and at least one came back unavailable for a reason other
 * than a video with no frame to show — which is how both adapters report a refused or failed call.
 * A batch with some answers and a few gaps is NOT a failure: those posts wait and are asked again
 * next pass, as before. A video with no frame is never a failure: no model could judge it.
 *
 * ★ THE PRIMARY RESTS, THEN IS TRIED AGAIN. After a failure the other judge answers every batch for
 * `coolDownMs`, or `creditCoolDownMs` when the failure was a billing refusal (an empty account
 * waits for a person). Then the primary is asked again; one answered batch ends the outage. While
 * it rests, a batch the other judge fails too is put to the primary anyway: when both are failing
 * the feed loses nothing by asking, and whichever answers first carries it.
 *
 * ★ THE ALARMS STILL SEE THE PRIMARY'S SUPPLIER. A billing refusal is reported by the adapter that
 * received it (vendor-kit onOutOfCredit → billing-alerts.ts) before it reaches this file, and the
 * primary's failed calls are still metered at $0 under its own endpoint, which the outage alarm's
 * judge-pay check reads (0087). Nothing here swallows a signal; it only stops the feed waiting.
 *
 * ★ A BUDGET REFUSAL IS NOT A FAILURE. The meter refusing a call is the day's money being spent, not
 * the supplier being down; asking the other judge would spend the same book. It is rethrown, and
 * the scorer pauses as it always has.
 *
 * What breaks if changed carelessly: a late primary reply after the deadline is dropped, never
 * merged — its posts were already answered by the other judge, and filing both would give a post
 * two answers in one pass. Its cost is still metered by its adapter when it lands.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Budget, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import { NO_FRAME } from '@insidor/judge-anthropic';
import { mergeSpend } from '@insidor/meter';
import { BILLING_REFUSAL, BudgetRefused, OutOfCredit } from '@insidor/vendor-kit';

import { errorText, type Logger } from './log.ts';

/** One pair of judges' shared memory: when the primary may be asked again, and what happened. Shared by the post and kind questions, since one supplier serves both. */
export interface FailoverState {
  restingUntil: number;
  /** Why the primary is resting; null when it is not. */
  reason: string | null;
  /** Batches the other judge answered for the primary, since the process started. */
  handedOver: number;
  /** Times the primary was put to rest, since the process started. */
  outages: number;
}

export const failoverState = (): FailoverState => ({ restingUntil: 0, reason: null, handedOver: 0, outages: 0 });

export interface FailoverDeps {
  readonly primary: JudgePort;
  /** The other judge; null: the primary alone, exactly as before. */
  readonly fallback: JudgePort | null;
  readonly state: FailoverState;
  readonly policy: Policy['judge']['failover'];
  /** How the log names the two (the roles, never a vendor's name in an alert). */
  readonly names: { readonly primary: string; readonly fallback: string };
  /** Which question this pair answers, for the log. */
  readonly question: string;
  readonly log: Logger;
  readonly now: () => number;
  /** Resolves after `ms`; injectable so a test does not wait. */
  readonly wait?: (ms: number) => { readonly done: Promise<void>; readonly cancel: () => void };
}

type Attempt =
  | { readonly ok: true; readonly result: Metered<readonly JudgeOutcome[]> }
  | { readonly ok: false; readonly result: Metered<readonly JudgeOutcome[]> | null; readonly why: string; readonly credit: boolean };

const realWait = (ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
};

/** Why a batch's outcomes say the call failed, or null when they do not (see the header). */
export function batchFailure(outcomes: readonly JudgeOutcome[]): string | null {
  if (outcomes.length === 0 || outcomes.some((o) => o.kind === 'judged')) return null;
  const failed = outcomes.find((o) => o.kind === 'unavailable' && o.detail !== NO_FRAME);
  return failed?.kind === 'unavailable' ? failed.detail : null;
}

/** The subjects to put to the other judge: every one without an answer, except a video with no frame. */
const unanswered = (subjects: readonly JudgeSubject[], outcomes: readonly JudgeOutcome[] | null): JudgeSubject[] =>
  subjects.filter((_, i) => {
    const o = outcomes?.[i];
    return o === undefined || (o.kind === 'unavailable' && o.detail !== NO_FRAME);
  });

export function failoverJudge(deps: FailoverDeps): JudgePort {
  const { primary, fallback, state, policy, log } = deps;
  if (fallback === null || !policy.on) return primary;
  const wait = deps.wait ?? realWait;

  async function attempt(port: JudgePort, subjects: readonly JudgeSubject[], budget: Budget): Promise<Attempt> {
    const timer = wait(policy.deadlineMs);
    const call = port.judge(subjects, budget);
    /* A reply after the deadline is dropped (see the header); its rejection must not go unhandled. */
    call.catch(() => undefined);
    try {
      const raced = await Promise.race([call.then((r) => ({ r })), timer.done.then(() => null)]);
      if (raced === null) return { ok: false, result: null, why: `no reply within ${Math.round(policy.deadlineMs / 1000)} s`, credit: false };
      const why = batchFailure(raced.r.value);
      return why === null ? { ok: true, result: raced.r } : { ok: false, result: raced.r, why, credit: why.includes(BILLING_REFUSAL) };
    } catch (e) {
      if (e instanceof BudgetRefused) throw e;
      return { ok: false, result: null, why: errorText(e), credit: e instanceof OutOfCredit || errorText(e).includes(BILLING_REFUSAL) };
    } finally {
      timer.cancel();
    }
  }

  /** `first`'s answers, with the ones it lacked taken from `second` (asked about `asked` only). */
  function merged(subjects: readonly JudgeSubject[], first: Metered<readonly JudgeOutcome[]> | null, asked: readonly JudgeSubject[], second: Attempt | null): Metered<readonly JudgeOutcome[]> {
    const fromSecond = new Map<string, JudgeOutcome>();
    asked.forEach((s, i) => {
      const o = second?.result?.value[i];
      if (o !== undefined) fromSecond.set(String(s.storyId), o);
    });
    const value = subjects.map((s, i): JudgeOutcome => {
      const o = fromSecond.get(String(s.storyId)) ?? first?.value[i];
      return o ?? { kind: 'unavailable', storyId: s.storyId, detail: second !== null && !second.ok ? second.why : 'no outcome' };
    });
    const spends: Spend[] = [first?.spend, second?.result?.spend].filter((x): x is Spend => x !== undefined);
    const at = deps.now() as Millis;
    const est = primary.estimate([]);
    return { value, spend: mergeSpend(spends, { vendor: est.vendor, endpoint: est.endpoint, unit: 'per-call', estUnits: 1, at }, 'per-call') };
  }

  /** Puts the primary to rest after a failure, saying so once per outage. */
  function rest(why: string, credit: boolean, posts: number): void {
    const t = deps.now();
    const resting = t < state.restingUntil;
    state.restingUntil = t + (credit ? policy.creditCoolDownMs : policy.coolDownMs);
    state.reason = why;
    if (!resting) {
      state.outages += 1;
      log.warn('judge failover: the primary judge failed a batch; the other judge answers while it rests', {
        question: deps.question,
        from: deps.names.primary,
        to: deps.names.fallback,
        reason: why,
        billing: credit,
        posts,
        restMs: state.restingUntil - t,
        outages: state.outages,
      });
    }
  }

  return {
    id: primary.id,
    promptId: primary.promptId,
    maxBatch: Math.min(primary.maxBatch, fallback.maxBatch),
    estimate: (subjects) => primary.estimate(subjects),

    async judge(subjects, budget) {
      if (subjects.length === 0) return primary.judge(subjects, budget);
      /* The primary is resting: the other judge first; the primary only if that fails too. */
      if (deps.now() < state.restingUntil) {
        const other = await attempt(fallback, subjects, budget);
        if (other.ok) {
          state.handedOver += 1;
          return other.result;
        }
        log.warn('judge failover: the other judge failed too while the primary rests; asking the primary', { question: deps.question, reason: other.why, resting: state.reason });
        const asked = unanswered(subjects, other.result?.value ?? null);
        const back = await attempt(primary, asked, budget);
        if (back.ok) {
          log.info('judge failover: the primary judge answered again', { question: deps.question, from: deps.names.fallback, to: deps.names.primary, handedOver: state.handedOver });
          state.restingUntil = 0;
          state.reason = null;
        }
        return merged(subjects, other.result, asked, back);
      }
      const wasResting = state.reason !== null;
      const first = await attempt(primary, subjects, budget);
      if (first.ok) {
        if (wasResting) {
          log.info('judge failover: the primary judge answered again', { question: deps.question, from: deps.names.fallback, to: deps.names.primary, handedOver: state.handedOver });
          state.reason = null;
        }
        return first.result;
      }
      rest(first.why, first.credit, subjects.length);
      const asked = unanswered(subjects, first.result?.value ?? null);
      const second = await attempt(fallback, asked, budget);
      state.handedOver += 1;
      if (!second.ok) log.error('judge failover: both judges failed this batch; its posts wait', { question: deps.question, primary: first.why, other: second.why, posts: asked.length });
      return merged(subjects, first.result, asked, second);
    },
  };
}
