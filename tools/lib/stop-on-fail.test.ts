/**
 * `runStop`: a re-tune's gradings pay exactly as before until one fails, and nothing after.
 * Meters in memory, no database, no judge. Replays the 27 Oct shape: one grading rejects on an
 * embedding outage while its sibling is still asking.
 * Run: node --test --experimental-strip-types tools/lib/stop-on-fail.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Meter, Spend } from '../../contracts/src/ports/meter.ts';
import { inMemoryMeter } from '../../adapters/meter/spend/src/index.ts';
import { runStop } from './stop-on-fail.ts';

const AT = 1_800_036_000_000;
const now = () => AT;
const spend = (usd: number): Spend => ({ vendor: 'openrouter', endpoint: 'judge-open', unit: 'per-call', units: 1, usd, at: AT });
const tick = () => new Promise<void>((r) => setImmediate(r));

/* A grading as gradePosts spends: ask the meter before each call, record after, `calls` times. */
async function grading(m: Meter, calls: number, usd: number, failAt: number | null = null): Promise<number> {
  let made = 0;
  for (let k = 0; k < calls; k++) {
    await tick();
    if (failAt === k) throw new Error('voyage unavailable at POST /v1/multimodalembeddings: responded 503');
    if (!m.mayspend('openrouter', usd)) throw new Error('refused');
    m.record(spend(usd));
    made++;
  }
  return made;
}

test('★ no failure: the wrapped meter answers, records and refuses exactly as the meter', async () => {
  const plain = inMemoryMeter({ dailyCapUsd: 0.05, softStop: 1, now });
  const inner = inMemoryMeter({ dailyCapUsd: 0.05, softStop: 1, now });
  const stop = runStop();
  const wrapped = stop.meter(inner);
  for (let k = 0; k < 8; k++) {
    assert.equal(wrapped.mayspend('openrouter', 0.01), plain.mayspend('openrouter', 0.01), `call ${k}`);
    if (plain.mayspend('openrouter', 0.01)) { plain.record(spend(0.01)); wrapped.record(spend(0.01)); }
    assert.deepEqual(wrapped.line('openrouter'), plain.line('openrouter'));
    assert.equal(wrapped.spentUsd(), plain.spentUsd());
  }
  const [a, b] = await Promise.all([stop.watch(grading(stop.meter(inMemoryMeter({ dailyCapUsd: 9, softStop: 1, now })), 20, 0.003)), stop.watch(grading(stop.meter(inMemoryMeter({ dailyCapUsd: 9, softStop: 1, now })), 30, 0.003))]);
  assert.deepEqual([a, b], [20, 30], 'both gradings make every call');
  assert.equal(stop.stopped(), false);
});

test('★ one grading fails: the run fails with that same error, and the sibling stops paying', async () => {
  const before = inMemoryMeter({ dailyCapUsd: 9, softStop: 1, now });
  const after = inMemoryMeter({ dailyCapUsd: 9, softStop: 1, now });
  /* Without the stop (as before): the sibling's every call is paid after the run has failed. */
  const old = await Promise.all([grading(inMemoryMeter({ dailyCapUsd: 9, softStop: 1, now }), 50, 0.003, 3), grading(before, 200, 0.003)]).catch((e: unknown) => e);
  assert.match(String(old), /503/);
  while (before.entries().length < 200) await tick();
  /* With it. */
  const stop = runStop();
  const now2 = await Promise.all([stop.watch(grading(stop.meter(inMemoryMeter({ dailyCapUsd: 9, softStop: 1, now })), 50, 0.003, 3)), stop.watch(grading(stop.meter(after), 200, 0.003))]).catch((e: unknown) => e);
  assert.match(String(now2), /503/, 'the same first error decides the run');
  for (let k = 0; k < 20; k++) await tick();
  assert.equal(stop.stopped(), true);
  assert.ok(after.entries().length <= 4, `the sibling stopped within a call of the failure (${after.entries().length} calls, against ${before.entries().length})`);
});

test('a refused call is not a failure: a grading that returns does not stop its siblings', async () => {
  const stop = runStop();
  const tight = stop.meter(inMemoryMeter({ dailyCapUsd: 0.006, softStop: 1, now }));
  /* Spends its line and comes back short (gradePosts leaves those posts unanswered and returns). */
  const short = stop.watch((async () => { let n = 0; while (tight.mayspend('openrouter', 0.003)) { tight.record(spend(0.003)); n++; } return n; })());
  const other = stop.watch(grading(stop.meter(inMemoryMeter({ dailyCapUsd: 9, softStop: 1, now })), 10, 0.003));
  assert.deepEqual(await Promise.all([short, other]), [2, 10]);
  assert.equal(stop.stopped(), false);
});
