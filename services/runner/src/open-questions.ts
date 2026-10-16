/**
 * THE NAMER, THE TRANSLATOR AND THE SAME-SUBJECT QUESTION WITH A SECOND MODEL BEHIND EACH: the
 * failover of judge-failover.ts, for the three ports that are not judging ports (contracts
 * ports/names.ts, ports/translate.ts, and `sameSubject` on ports/judge.ts).
 *
 * Its own file because judge-failover.ts reads failure out of judging outcomes (`unavailable`),
 * and these ports say it differently: a names or translate call that failed comes back `absent`
 * for every post in it; a same-subject question whose host failed throws (adapters
 * openai-compatible questions.ts says why its null cannot carry that). The decision itself is the
 * same and is not restated here: judge-failover.ts's header holds it — what counts as a failure,
 * the rest after one, the longer rest after a billing refusal, the deadline, and that a budget
 * refusal is rethrown, never handed to the other model.
 *
 * ★ ONE MEMORY PER PRIMARY SUPPLIER. The caller passes the FailoverState shared by every question
 * the same primary answers, so an outage seen by the namer rests the translator too — one
 * supplier being down is one fact, not three.
 *
 * ★ THE RECORD SAYS WHO ANSWERED. A name guess or translation the other model gave carries its
 * `model`, which the work files store in place of the port's own. A same-subject answer cannot
 * (its port returns a bare word), so a pair answered by the backup is filed under the primary's
 * judge id; the ledger, by vendor, still says who was paid.
 *
 * What breaks if changed carelessly: only the posts the first model left `absent` are put to the
 * second, and merged back by ref. Asking the second about all of them would pay twice and could
 * overwrite a good answer with a worse one.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgePort, SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';
import type { Budget, Metered, Spend } from '@insidor/contracts/ports/meter.ts';
import type { NameOutcome, NamePort } from '@insidor/contracts/ports/names.ts';
import type { TranslateOutcome, TranslatePort } from '@insidor/contracts/ports/translate.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { mergeSpend } from '@insidor/meter';
import { BILLING_REFUSAL, BudgetRefused, OutOfCredit } from '@insidor/vendor-kit';

import type { FailoverState } from './judge-failover.ts';
import { errorText, type Logger } from './log.ts';

export interface PairDeps<P> {
  readonly primary: P;
  /** The other model; null: the primary alone. */
  readonly fallback: P | null;
  readonly state: FailoverState;
  readonly policy: Policy['judge']['failover'];
  /** How the log names the two (roles, never a vendor). */
  readonly names: { readonly primary: string; readonly fallback: string };
  readonly question: string;
  readonly log: Logger;
  readonly now: () => number;
  readonly wait?: (ms: number) => { readonly done: Promise<void>; readonly cancel: () => void };
}

const realWait = (ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
};

type Tried<T> = { readonly ok: true; readonly r: Metered<T> } | { readonly ok: false; readonly r: Metered<T> | null; readonly why: string; readonly credit: boolean };

/** The two models' shared rest and log, as judge-failover.ts keeps them. */
function pairMemory<P>(deps: PairDeps<P>) {
  const wait = deps.wait ?? realWait;
  return {
    /** One call raced against the deadline; `failed` reads a failure out of an answer that came. */
    async attempt<T>(call: () => Promise<Metered<T>>, failed: (value: T) => string | null): Promise<Tried<T>> {
      const timer = wait(deps.policy.deadlineMs);
      const p = call();
      p.catch(() => undefined);
      try {
        const raced = await Promise.race([p.then((r) => ({ r })), timer.done.then(() => null)]);
        if (raced === null) return { ok: false, r: null, why: `no reply within ${Math.round(deps.policy.deadlineMs / 1000)} s`, credit: false };
        const why = failed(raced.r.value);
        return why === null ? { ok: true, r: raced.r } : { ok: false, r: raced.r, why, credit: why.includes(BILLING_REFUSAL) };
      } catch (e) {
        if (e instanceof BudgetRefused) throw e;
        return { ok: false, r: null, why: errorText(e), credit: e instanceof OutOfCredit || errorText(e).includes(BILLING_REFUSAL) };
      } finally {
        timer.cancel();
      }
    },
    resting: (): boolean => deps.now() < deps.state.restingUntil,
    rest(why: string, credit: boolean): void {
      const t = deps.now();
      const already = t < deps.state.restingUntil;
      deps.state.restingUntil = t + (credit ? deps.policy.creditCoolDownMs : deps.policy.coolDownMs);
      deps.state.reason = why;
      if (!already) {
        deps.state.outages += 1;
        deps.log.warn('failover: the primary model failed a call; the other model answers while it rests', { question: deps.question, from: deps.names.primary, to: deps.names.fallback, reason: why, billing: credit, restMs: deps.state.restingUntil - t, outages: deps.state.outages });
      }
    },
    recovered(): void {
      if (deps.state.reason === null) return;
      deps.log.info('failover: the primary model answered again', { question: deps.question, from: deps.names.fallback, to: deps.names.primary, handedOver: deps.state.handedOver });
      deps.state.reason = null;
      deps.state.restingUntil = 0;
    },
  };
}

/** For a batch port whose failed call is `absent` for every post: the reason, or null. */
function allAbsent(outcomes: readonly { readonly kind: string; readonly detail?: string }[]): string | null {
  if (outcomes.length === 0 || outcomes.some((o) => o.kind !== 'absent')) return null;
  return outcomes[0]?.detail ?? 'no answer';
}

/**
 * The batch question (names or translate) behind one port: the primary first, the posts it left
 * absent to the other when the whole call failed; the other first while the primary rests.
 */
function batchFailover<S extends { readonly ref: string }, O extends { readonly kind: string; readonly ref: string; readonly detail?: string }>(
  deps: PairDeps<unknown>,
  ask: (which: 'primary' | 'fallback', subjects: readonly S[], budget: Budget) => Promise<Metered<readonly O[]>>,
  stamp: (o: O) => O,
): (subjects: readonly S[], budget: Budget) => Promise<Metered<readonly O[]>> {
  const mem = pairMemory(deps);
  return async (subjects, budget) => {
    if (subjects.length === 0) return ask('primary', subjects, budget);
    const order: readonly ['primary' | 'fallback', 'primary' | 'fallback'] = mem.resting() ? ['fallback', 'primary'] : ['primary', 'fallback'];
    const first = await mem.attempt(() => ask(order[0], subjects, budget), allAbsent);
    if (first.ok) {
      if (order[0] === 'primary') mem.recovered();
      else deps.state.handedOver += 1;
      return order[0] === 'fallback' ? { ...first.r, value: first.r.value.map(stamp) } : first.r;
    }
    if (order[0] === 'primary') mem.rest(first.why, first.credit);
    else deps.log.warn('failover: the other model failed too while the primary rests; asking the primary', { question: deps.question, reason: first.why });
    const byRef = new Map<string, O>((first.r?.value ?? []).map((o) => [o.ref, o]));
    const left = subjects.filter((s) => (byRef.get(s.ref)?.kind ?? 'absent') === 'absent');
    const second = await mem.attempt(() => ask(order[1], left, budget), allAbsent);
    if (order[1] === 'fallback') deps.state.handedOver += 1;
    else if (second.ok) mem.recovered();
    if (!second.ok) deps.log.error('failover: both models failed this call; its posts wait', { question: deps.question, first: first.why, second: second.why, posts: left.length });
    for (const o of second.r?.value ?? []) if (o.kind !== 'absent' || !byRef.has(o.ref)) byRef.set(o.ref, order[1] === 'fallback' ? stamp(o) : o);
    const spends = [first.r?.spend, second.r?.spend].filter((x): x is Spend => x !== undefined);
    const at = deps.now();
    const value = subjects.map((s) => byRef.get(s.ref) ?? ({ kind: 'absent', ref: s.ref, detail: second.ok ? 'no outcome' : second.why } as unknown as O));
    const head = spends[0];
    return { value, spend: mergeSpend(spends, { vendor: head?.vendor ?? 'none', endpoint: head?.endpoint ?? deps.question, unit: 'per-call', estUnits: 1, at: at as never }, 'per-call') };
  };
}

/** The namer with the other model behind it (see the header). */
export function failoverNamer(deps: PairDeps<NamePort>): NamePort {
  const { primary, fallback } = deps;
  if (fallback === null || !deps.policy.on) return primary;
  const guess = batchFailover<Parameters<NamePort['guess']>[0][number], NameOutcome>(
    deps,
    (which, s, b) => (which === 'primary' ? primary : fallback).guess(s, b),
    (o) => (o.kind === 'guessed' ? { ...o, model: o.model ?? fallback.model } : o),
  );
  return { id: primary.id, promptId: primary.promptId, model: primary.model, guess };
}

/** The translator with the other model behind it (see the header). */
export function failoverTranslator(deps: PairDeps<TranslatePort>): TranslatePort {
  const { primary, fallback } = deps;
  if (fallback === null || !deps.policy.on) return primary;
  const translate = batchFailover<Parameters<TranslatePort['translate']>[0][number], TranslateOutcome>(
    deps,
    (which, s, b) => (which === 'primary' ? primary : fallback).translate(s, b),
    (o) => (o.kind === 'absent' ? o : { ...o, model: o.model ?? fallback.model }),
  );
  return { id: primary.id, promptId: primary.promptId, model: primary.model, translate };
}

/** The same-subject part of a judge port. */
export type SameSubjectPart = Required<Pick<JudgePort, 'id' | 'sameSubjectPromptId' | 'estimateSameSubject' | 'sameSubject'>>;

/**
 * The same-subject question with the other model behind it. A throw or no reply in time is a
 * failure and rests the primary; a null (no usable answer: an unreadable picture, a garbled reply)
 * is put to the other model too, but rests nobody — no supplier was shown to be down.
 */
export function failoverSameSubject(deps: PairDeps<SameSubjectPart>): SameSubjectPart {
  const { primary, fallback } = deps;
  if (fallback === null || !deps.policy.on) return primary;
  const mem = pairMemory(deps);
  return {
    id: primary.id,
    sameSubjectPromptId: primary.sameSubjectPromptId,
    estimateSameSubject: () => primary.estimateSameSubject(),
    async sameSubject(a: MediaRef, b: MediaRef, budget: Budget): Promise<Metered<SameSubjectAnswer | null>> {
      const order = mem.resting() ? ([fallback, primary] as const) : ([primary, fallback] as const);
      const spends: Spend[] = [];
      let lastWhy = 'no answer';
      for (const [i, port] of order.entries()) {
        const tried = await mem.attempt(() => port.sameSubject(a, b, budget), () => null);
        if (tried.r !== null) spends.push(tried.r.spend);
        if (tried.ok && tried.r.value !== null) {
          if (port === primary) mem.recovered();
          else deps.state.handedOver += 1;
          return { value: tried.r.value, spend: spends.length === 1 ? tried.r.spend : mergeSpend(spends, { ...tried.r.spend, estUnits: 1 }, 'per-call') };
        }
        if (!tried.ok) {
          lastWhy = tried.why;
          if (port === primary) mem.rest(tried.why, tried.credit);
        }
        if (i === order.length - 1 && !tried.ok) deps.log.warn('failover: neither model answered a same-subject question', { question: deps.question, reason: lastWhy });
      }
      const at = deps.now();
      const head = spends[0];
      if (head === undefined && lastWhy !== 'no answer') throw new Error(`same-subject: both models failed: ${lastWhy}`);
      return { value: null, spend: mergeSpend(spends, { vendor: head?.vendor ?? 'none', endpoint: head?.endpoint ?? 'same-subject', unit: 'per-call', estUnits: 1, at: at as never }, 'per-call') };
    },
  };
}
