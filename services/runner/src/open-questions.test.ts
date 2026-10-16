/** The namer, the translator and the same-subject question with a second model behind each: a failed call goes to the other at once and the primary rests; only the absent posts are re-asked; the answer says which model gave it; a budget refusal is not swallowed. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { NameOutcome, NamePort, NameSubject } from '@insidor/contracts/ports/names.ts';
import type { TranslateOutcome, TranslatePort } from '@insidor/contracts/ports/translate.ts';
import { BudgetRefused } from '@insidor/vendor-kit';

import { failoverState } from './judge-failover.ts';
import type { Logger } from './log.ts';
import { failoverNamer, failoverSameSubject, failoverTranslator, type SameSubjectPart } from './open-questions.ts';

const lines: string[] = [];
const log: Logger = { info: (m) => void lines.push(m), warn: (m) => void lines.push(m), error: (m) => void lines.push(m), child: () => log };
const policy = { on: true, deadlineMs: 1_000, coolDownMs: 60_000, creditCoolDownMs: 600_000 };
const budget = { capUsd: 10, spentUsd: 0, maxCalls: null, deadline: 0 } as never;
const spend = (vendor: string) => ({ vendor, endpoint: 'names', unit: 'per-call' as const, units: 1, usd: 0.01, at: 0 as never });
const never = () => ({ done: new Promise<void>(() => undefined), cancel: () => undefined });
const subj = (ref: string): NameSubject => ({ ref, text: ref, picture: null, examples: [] });

type Do = 'answer' | 'refuse' | 'credit' | 'throw' | 'budget' | 'half';
function namer(model: string, does: () => Do, asked: string[][]): NamePort {
  return {
    id: `names:${model}`,
    promptId: 'names@p',
    model,
    async guess(s) {
      asked.push(s.map((x) => x.ref));
      const d = does();
      if (d === 'throw') throw new Error('socket hang up');
      if (d === 'budget') throw new BudgetRefused(model, 'names', 'spent' as never);
      const value = s.map((x, i): NameOutcome =>
        d === 'answer' || (d === 'half' && i === 0)
          ? { kind: 'guessed', ref: x.ref, guesses: [{ name: model, ticker: model.toUpperCase() }], seen: null }
          : { kind: 'absent', ref: x.ref, detail: d === 'credit' ? 'refused for billing: credit balance too low' : d === 'half' ? 'no usable answer for this post' : 'answered 503' });
      return { value, spend: spend(model) };
    },
  };
}

test('a refused names call goes to the other model at once; its answers carry its model; the primary rests, then is asked again', async () => {
  let clock = 0;
  let primaryDoes: Do = 'refuse';
  const pa: string[][] = [];
  const fa: string[][] = [];
  const state = failoverState();
  const n = failoverNamer({ primary: namer('open', () => primaryDoes, pa), fallback: namer('backup', () => 'answer', fa), state, policy, names: { primary: 'open', fallback: 'backup' }, question: 'names', log, now: () => clock, wait: never });
  const r = await n.guess([subj('a'), subj('b')], budget);
  assert.deepEqual(r.value.map((o) => (o.kind === 'guessed' ? o.model : o.kind)), ['backup', 'backup']);
  assert.equal(r.spend.usd, 0.02);
  assert.equal(state.outages, 1);
  /* Resting: the other answers first, and the primary is not asked. */
  clock = 30_000;
  await n.guess([subj('c')], budget);
  assert.equal(pa.length, 1);
  /* Rested: the primary again; its answer carries no model of its own (the port's). */
  clock = 61_000;
  primaryDoes = 'answer';
  const back = await n.guess([subj('d')], budget);
  assert.equal(back.value[0]?.kind === 'guessed' ? back.value[0].model : 'x', undefined);
  assert.equal(state.reason, null);
});

test('a names call with some answers is not a failure: the gaps wait, the other model is not asked', async () => {
  const fa: string[][] = [];
  const n = failoverNamer({ primary: namer('open', () => 'half', []), fallback: namer('backup', () => 'answer', fa), state: failoverState(), policy, names: { primary: 'open', fallback: 'backup' }, question: 'names', log, now: () => 0, wait: never });
  const r = await n.guess([subj('a'), subj('b')], budget);
  assert.deepEqual(r.value.map((o) => o.kind), ['guessed', 'absent']);
  assert.equal(fa.length, 0);
});

test('a thrown call, or one past the deadline, goes to the other; a billing refusal rests the primary longer', async () => {
  const state = failoverState();
  const n = failoverNamer({ primary: namer('open', () => 'credit', []), fallback: namer('backup', () => 'answer', []), state, policy, names: { primary: 'open', fallback: 'backup' }, question: 'names', log, now: () => 0, wait: never });
  await n.guess([subj('a')], budget);
  assert.equal(state.restingUntil, policy.creditCoolDownMs);
  const hanging: NamePort = { ...namer('open', () => 'answer', []), guess: () => new Promise(() => undefined) };
  const fired = () => ({ done: Promise.resolve(), cancel: () => undefined });
  const late = failoverNamer({ primary: hanging, fallback: namer('backup', () => 'answer', []), state: failoverState(), policy, names: { primary: 'open', fallback: 'backup' }, question: 'names', log, now: () => 0, wait: fired });
  const r = await late.guess([subj('a')], budget);
  assert.equal(r.value[0]?.kind === 'guessed' ? r.value[0].model : null, 'backup');
  const throws = failoverNamer({ primary: namer('open', () => 'throw', []), fallback: namer('backup', () => 'answer', []), state: failoverState(), policy, names: { primary: 'open', fallback: 'backup' }, question: 'names', log, now: () => 0, wait: never });
  assert.equal((await throws.guess([subj('a')], budget)).value[0]?.kind, 'guessed');
});

test('a budget refusal is rethrown, never handed to the other model; no fallback is the primary itself', async () => {
  const fa: string[][] = [];
  const n = failoverNamer({ primary: namer('open', () => 'budget', []), fallback: namer('backup', () => 'answer', fa), state: failoverState(), policy, names: { primary: 'open', fallback: 'backup' }, question: 'names', log, now: () => 0, wait: never });
  await assert.rejects(n.guess([subj('a')], budget), BudgetRefused);
  assert.equal(fa.length, 0);
  const alone = namer('open', () => 'answer', []);
  assert.equal(failoverNamer({ primary: alone, fallback: null, state: failoverState(), policy, names: { primary: 'open', fallback: 'none' }, question: 'names', log, now: () => 0 }), alone);
});

test('both failing: every post stays absent with the reason, and the log says so', async () => {
  lines.length = 0;
  const n = failoverNamer({ primary: namer('open', () => 'refuse', []), fallback: namer('backup', () => 'refuse', []), state: failoverState(), policy, names: { primary: 'open', fallback: 'backup' }, question: 'names', log, now: () => 0, wait: never });
  const r = await n.guess([subj('a')], budget);
  assert.equal(r.value[0]?.kind, 'absent');
  assert.ok(lines.some((l) => l.includes('both models failed')));
});

test('the translator: a refused call is answered by the other, and both kinds of answer carry its model', async () => {
  const t = (model: string, ok: boolean): TranslatePort => ({
    id: `translate:${model}`,
    promptId: 'translate@p',
    model,
    async translate(s) {
      const value = s.map((x, i): TranslateOutcome => (!ok ? { kind: 'absent', ref: x.ref, detail: 'answered 503' } : i === 0 ? { kind: 'translated', ref: x.ref, from: 'pt', text: 'hi' } : { kind: 'kept', ref: x.ref, from: 'en' }));
      return { value, spend: spend(model) };
    },
  });
  const tr = failoverTranslator({ primary: t('open', false), fallback: t('backup', true), state: failoverState(), policy, names: { primary: 'open', fallback: 'backup' }, question: 'translate', log, now: () => 0, wait: never });
  const r = await tr.translate([{ ref: 'a', text: 'oi' }, { ref: 'b', text: 'hello' }], budget);
  assert.deepEqual(r.value.map((o) => (o.kind === 'absent' ? null : o.model)), ['backup', 'backup']);
  assert.equal(tr.model, 'open');
});

test('the same-subject question: a throw goes to the other and rests the primary; a null is asked of the other but rests nobody', async () => {
  const part = (id: string, does: () => 'yes' | 'null' | 'throw', asked: string[]): SameSubjectPart => ({
    id,
    sameSubjectPromptId: 'same-subject@p',
    estimateSameSubject: () => ({ vendor: id, endpoint: 'same-subject', unit: 'per-call', estUnits: 1, usd: 0.001 }),
    async sameSubject() {
      asked.push(id);
      const d = does();
      if (d === 'throw') throw new Error('answered 503');
      return { value: d === 'yes' ? 'yes' : null, spend: { vendor: id, endpoint: 'same-subject', unit: 'per-call', units: 1, usd: 0.001, at: 0 as never } };
    },
  });
  const img = { kind: 'image' as const, uri: 'https://x/a.jpg', width: null, height: null, durationMs: null };
  const asked: string[] = [];
  const state = failoverState();
  let primaryDoes: 'yes' | 'null' | 'throw' = 'null';
  const q = failoverSameSubject({ primary: part('open', () => primaryDoes, asked), fallback: part('backup', () => 'yes', asked), state, policy, names: { primary: 'open', fallback: 'backup' }, question: 'same-subject', log, now: () => 0, wait: never });
  assert.equal((await q.sameSubject(img, img, budget)).value, 'yes');
  assert.deepEqual(asked, ['open', 'backup']);
  assert.equal(state.outages, 0);
  primaryDoes = 'throw';
  const r = await q.sameSubject(img, img, budget);
  assert.equal(r.value, 'yes');
  assert.equal(state.outages, 1);
  /* Both throwing: the caller sees the throw (work/image-pairs.ts logs it; the pair carries no evidence). */
  const both = failoverSameSubject({ primary: part('open', () => 'throw', []), fallback: part('backup', () => 'throw', []), state: failoverState(), policy, names: { primary: 'open', fallback: 'backup' }, question: 'same-subject', log, now: () => 0, wait: never });
  await assert.rejects(both.sameSubject(img, img, budget));
});
