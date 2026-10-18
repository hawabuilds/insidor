/**
 * The owner's disk and bill alerts (disk-model.ts, disk-alarm.ts): the host's grow rule replayed
 * from the samples (90% grows by half, once in four hours), the 80% crossing once per disk size,
 * the bill billed on the provisioned disk by the hour and projected with the grows still to come,
 * and the alarm queueing each once and nothing old.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { OwnerAlert } from '@insidor/store';

import { diskAlarm } from './disk-alarm.ts';
import { GB, growthOf, projectBill, replayDisk, type SizeSample } from './disk-model.ts';
import type { Logger } from './log.ts';

const P = DEFAULT_POLICY.store;
const H = 3_600_000;
const START = Date.UTC(2026, 9, 1);
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/** Hourly samples from `from`, the database at `gb(i)` GB at hour i. */
const hourly = (from: number, hours: number, gb: (i: number) => number, files: number | null = 1): SizeSample[] =>
  Array.from({ length: hours }, (_, i) => ({ atMs: from + i * H, dbBytes: gb(i) * GB, storageBytes: files === null ? null : files * GB }));

test('the disk grows by half where a sample reaches 90%, at most once in four hours, and 80% is crossed once per size', () => {
  const r = replayDisk(hourly(START, 10, (i) => [4, 6.5, 7.3, 7.4, 11, 11, 11, 11, 11, 11][i] ?? 11), P.disk);
  assert.deepEqual(r.grows.map((g) => [g.atMs, g.fromGb, g.toGb]), [[START + 2 * H, 8, 12], [START + 6 * H, 12, 18]]);
  /* 6.5 of 8 is 81%: crossed. 7.3 grows the disk first (61% of 12). 11 of 12 is 92% (a grow must wait
     four hours): crossed at the new size. Then 18: 61%, re-armed. */
  assert.deepEqual(r.crossings.map((c) => [c.atMs, c.provisionedGb]), [[START + H, 8], [START + 4 * H, 12]]);
  assert.equal(r.provisionedGb, 18);
});

test('growth per day needs six hours of samples', () => {
  assert.equal(growthOf(hourly(START, 5, (i) => 4 + i * 0.01), 7), null);
  const g = growthOf(hourly(START, 25, (i) => 4 + i * 0.01), 7);
  assert.ok(g !== null && Math.abs(g.bytesPerDay / GB - 0.24) < 1e-9);
});

test('the bill is the provisioned disk by the hour, with the grows projected before month end; unreadable files are unknown, not $0', () => {
  /* Flat at 4 GB: nothing over the 8 included. */
  const flat = projectBill(hourly(START, 48, () => 4), START + 47 * H, P);
  assert.equal(flat.diskUsd, 0);
  assert.equal(flat.storageUsd, 0);
  assert.equal(flat.totalUsd, P.bill.planUsd + P.bill.computeNetUsd);
  /* 7 GB growing 0.5 GB a day from 1 Oct: 90% of 8 is 7.2, so 12 GB from 10:00 on 1 Oct; 10.8 GB
     (90% of 12) about 8 Oct, 18 GB; 16.2 GB about 19 Oct, 27 GB. About 12 GB-months over the 8. */
  const growing = projectBill(hourly(START, 24, (i) => 7 + (0.5 * i) / 24), START + 23 * H, P);
  assert.equal(growing.diskEndGb, 27);
  assert.deepEqual(growing.grows.map((g) => g.toGb), [18, 27]);
  assert.ok(growing.diskUsd > 1.3 && growing.diskUsd < 1.7, `disk ${growing.diskUsd}`);
  assert.equal(projectBill(hourly(START, 10, () => 4, null), START + 9 * H, P).storageUsd, null);
});

test('the alarm queues a recent crossing, a grow and the month bill once each, and never an old one', async () => {
  const rows: SizeSample[] = hourly(START, 6, (i) => [4, 6.5, 7.3, 7.3, 7.3, 7.3][i] ?? 7.3);
  const queued: OwnerAlert[] = [];
  const now = { ms: START + 5 * H };
  /* A $40 line, so plan and compute alone are over it whatever the live line is set to. */
  const alarm = diskAlarm({
    policy: { ...P, bill: { ...P.bill, alertOverUsd: 40 } },
    sample: async () => undefined,
    samples: async () => rows,
    ownerWallets: ['w'],
    owner: { ownerIds: async () => ['owner'], queue: async (_u, a) => void queued.push(a) },
    log: quiet,
    now: () => now.ms,
  });
  await alarm.check();
  /* The crossing at hour 1 is four hours old (over the three-hour window); the grow at hour 2 is three: also out. The bill is over $40 on plan and compute alone. */
  assert.deepEqual(queued.map((a) => a.subject), ['bill|2026-10']);
  /* 11 GB at hour 6: the disk grows to 18 (four hours after the last grow). 14.5 of 18 at hour 7: 81%. */
  rows.push({ atMs: START + 6 * H, dbBytes: 11 * GB, storageBytes: GB }, { atMs: START + 7 * H, dbBytes: 14.5 * GB, storageBytes: GB });
  now.ms = START + 7 * H;
  await alarm.check();
  await alarm.check();
  const at = (h: number) => new Date(START + h * H).toISOString();
  assert.deepEqual(queued.map((a) => a.subject), ['bill|2026-10', `disk|over|18|${at(7)}`, `disk|grew|18|${at(6)}`]);
  assert.ok(queued.every((a) => a.kind === 'outage'));
});
