/**
 * The owner's judge cost alarm (judge-cost-alarm.ts): the last hour's cost a call against the
 * median hour of the week before, nothing said on too little history or too few calls, and at most
 * one alert every quiet period — replayed on the ledger's own hours of 2026-10-20.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { CallBucket, OwnerAlert } from '@insidor/store';

import { judgeCostAlarm, judgeCostReading, median } from './judge-cost-alarm.ts';
import type { Logger } from './log.ts';

const P = DEFAULT_POLICY.notify.judgeCost;
const H = 3_600_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/** The ledger's judge hours of 2026-10-19 09:00 to 2026-10-20 05:00 London, newest last: calls and average $ a call. */
const NORMAL: readonly (readonly [number, number])[] = [
  [150, 0.00168], [158, 0.00103], [98, 0.001], [90, 0.00098], [161, 0.00131], [219, 0.00135], [196, 0.0013], [189, 0.00135],
  [151, 0.00126], [92, 0.00126], [137, 0.0014], [89, 0.00116], [124, 0.00127], [82, 0.00134], [187, 0.00174], [128, 0.00153],
  [196, 0.00184], [189, 0.00155], [133, 0.00131],
];

/** Buckets back from now: the last hour first (ago 0), then `history` newest first. */
const buckets = (last: readonly [number, number], history: readonly (readonly [number, number])[] = NORMAL): CallBucket[] =>
  [last, ...[...history].reverse()].map(([calls, per], ago) => ({ ago, calls, usd: calls * per }));

test('the median is the middle value, or the mean of the two middle ones', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('★ the hours of 2026-10-20: 07:00 at $0.00957 a call is over twice the median; 05:00 and 11:00 are not', () => {
  const spike = judgeCostReading(buckets([119, 0.00957]), P);
  assert.equal(spike.state, 'over');
  assert.equal(spike.baselineHours, NORMAL.length);
  assert.ok(spike.medianUsd !== null && Math.abs(spike.medianUsd - 0.00131) < 1e-9);
  assert.equal(judgeCostReading(buckets([133, 0.00131]), P).state, 'normal');
  assert.equal(judgeCostReading(buckets([185, 0.00142]), P).state, 'normal');
  /* Exactly twice is not past it. */
  assert.equal(judgeCostReading(buckets([100, 2 * 0.00131]), P).state, 'normal');
});

test('too few calls in the hour, or too few hours behind it, says nothing', () => {
  assert.equal(judgeCostReading(buckets([P.minCalls - 1, 0.02]), P).state, 'unsure');
  assert.equal(judgeCostReading(buckets([119, 0.00957], NORMAL.slice(0, P.minBaselineHours - 1)), P).state, 'unsure');
  /* Quiet hours of the week before are left out of the median, not counted as cheap ones. */
  const withQuiet = judgeCostReading(buckets([119, 0.00957], [...NORMAL, [3, 0.0001], [2, 0.0001]]), P);
  assert.equal(withQuiet.baselineHours, NORMAL.length);
  assert.equal(judgeCostReading([], P).state, 'unsure');
});

test('★ the alarm queues one outage alert with the numbers, and none again inside the quiet period', async () => {
  const queued: OwnerAlert[] = [];
  const now = { ms: Date.UTC(2026, 9, 20, 6, 30) };
  let last: readonly [number, number] = [119, 0.00957];
  const asked: number[][] = [];
  const alarm = judgeCostAlarm({
    policy: P,
    buckets: async (from, to, size) => {
      asked.push([from, to, size]);
      return buckets(last);
    },
    ownerWallets: ['W'],
    owner: { ownerIds: async () => ['u1'], queue: async (_u, a) => void queued.push(a) },
    log: quiet,
    now: () => now.ms,
  });
  assert.equal(await alarm.check(), 1);
  assert.deepEqual(asked[0], [now.ms - P.windowMs - P.baselineMs, now.ms, P.windowMs]);
  assert.equal(queued[0]?.kind, 'outage');
  assert.equal(queued[0]?.subject, 'judge-cost|2026-10-20T06:00:00.000Z');
  assert.deepEqual(
    { what: queued[0]?.facts['what'], perCallUsd: queued[0]?.facts['perCallUsd'], medianUsd: queued[0]?.facts['medianUsd'], ratio: queued[0]?.facts['ratio'], calls: queued[0]?.facts['calls'] },
    { what: 'judge-cost', perCallUsd: 0.0096, medianUsd: 0.0013, ratio: 7.3, calls: 119 },
  );
  /* Every pass of the next six hours: still over, nothing queued. */
  for (let k = 1; k * P.everyMs < P.quietMs; k += 1) {
    now.ms += P.everyMs;
    assert.equal(await alarm.check(), 0);
  }
  /* Six hours on and still over: told again. */
  now.ms = Date.UTC(2026, 9, 20, 6, 30) + P.quietMs;
  assert.equal(await alarm.check(), 1);
  assert.equal(queued.length, 2);
  assert.equal(queued[1]?.subject, 'judge-cost|2026-10-20T12:00:00.000Z');
  /* Normal again: nothing. */
  last = [185, 0.00142];
  now.ms += P.quietMs;
  assert.equal(await alarm.check(), 0);
});

test('with no owner profile yet the alert is tried again inside the quiet period; a ledger it cannot read says nothing', async () => {
  const queued: OwnerAlert[] = [];
  let ids: string[] = [];
  const now = { ms: Date.UTC(2026, 9, 20, 7) };
  const alarm = judgeCostAlarm({
    policy: P,
    buckets: async () => buckets([119, 0.00957]),
    ownerWallets: ['W'],
    owner: { ownerIds: async () => ids, queue: async (_u, a) => void queued.push(a) },
    log: quiet,
    now: () => now.ms,
  });
  assert.equal(await alarm.check(), 0);
  ids = ['u1'];
  now.ms += P.everyMs;
  assert.equal(await alarm.check(), 1);
  now.ms += P.everyMs;
  assert.equal(await alarm.check(), 0, 'delivered once');
  assert.equal(queued.length, 1);

  const broken = judgeCostAlarm({ policy: P, buckets: async () => Promise.reject(new Error('reset')), ownerWallets: ['W'], owner: { ownerIds: async () => ['u1'], queue: async () => undefined }, log: quiet, now: () => now.ms });
  assert.equal(await broken.check(), 0);
  const off = judgeCostAlarm({ policy: { ...P, on: false }, buckets: async () => buckets([119, 0.00957]), ownerWallets: ['W'], owner: { ownerIds: async () => ['u1'], queue: async () => undefined }, log: quiet, now: () => now.ms });
  assert.equal(await off.check(), 0);
});
