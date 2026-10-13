/** The owner's early warning: logged and queued once per supplier, level and UTC day; logged only with no owner. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { OwnerAlert } from '@insidor/store';

import type { Logger, LogFields } from './log.ts';
import { highestReached, raiseFor, supplierWarnings, type OwnerQueue } from './supplier-warnings.ts';

const WARN_AT = [0.8, 0.95];
const DAY1 = Date.UTC(2026, 9, 13, 9);
const DAY2 = Date.UTC(2026, 9, 14, 0, 1);

function harness(opts: { wallets?: readonly string[]; profiles?: readonly string[] } = {}) {
  const spent: Record<string, number> = { posts: 0, judge: 0 };
  const caps: Record<string, number> = { posts: 11.25, judge: 8 };
  const warns: { msg: string; fields: LogFields | undefined }[] = [];
  const queued: { userId: string; alert: OwnerAlert }[] = [];
  let now = DAY1;
  const log: Logger = {
    info: () => undefined,
    warn: (msg, fields) => warns.push({ msg, fields }),
    error: () => undefined,
    child: () => log,
  };
  const owner: OwnerQueue = {
    ownerIds: async () => opts.profiles ?? ['owner-1'],
    queue: async (userId, alert) => void queued.push({ userId, alert }),
  };
  const w = supplierWarnings({
    roles: [
      { role: 'posts', vendor: 'v-posts' },
      { role: 'judge', vendor: 'v-judge' },
    ],
    line: (vendor) => {
      const k = vendor === 'v-judge' ? 'judge' : 'posts';
      return { capUsd: caps[k] ?? 0, spentUsd: spent[k] ?? 0 };
    },
    warnAt: WARN_AT,
    buffer: 1.25,
    ownerWallets: opts.wallets ?? ['OwnerWa11et'],
    owner,
    log,
    now: () => now,
  });
  return { w, spent, warns, queued, setNow: (t: number) => (now = t) };
}

test('the highest level reached, and nothing below the first or on a line with no cap', () => {
  assert.equal(highestReached({ capUsd: 8, spentUsd: 6.39 }, WARN_AT), null);
  assert.equal(highestReached({ capUsd: 8, spentUsd: 6.4 }, WARN_AT), 0.8);
  assert.equal(highestReached({ capUsd: 8, spentUsd: 7.9 }, WARN_AT), 0.95);
  assert.equal(highestReached({ capUsd: 0, spentUsd: 1 }, WARN_AT), null);
});

test('★ crossing 80% logs one line and queues one alert for the owner, with the facts and the day in its subject', async () => {
  const h = harness();
  h.spent['judge'] = 6.4;
  await h.w.check();
  assert.equal(h.warns.length, 1);
  assert.equal(h.warns[0]?.msg, 'supplier line at 80%: judge $6.40 of $8.00; raise it by $13.50');
  assert.deepEqual(h.queued, [
    {
      userId: 'owner-1',
      alert: { kind: 'supplier_warning', subject: 'supplier|judge|2026-10-13', rung: 80, facts: { role: 'judge', share: 0.8, spentUsd: 6.4, capUsd: 8, projectedUsd: 6.4 / 0.375, raiseByUsd: 13.5 }, href: '/#/alerts' },
    },
  ]);
});

test('★ once per level a day: the next minutes say nothing, 95% fires once, the next day starts again', async () => {
  const h = harness();
  h.spent['judge'] = 6.5;
  await h.w.check();
  await h.w.check();
  assert.equal(h.warns.length, 1);
  assert.equal(h.queued.length, 1);
  h.spent['judge'] = 7.7;
  await h.w.check();
  await h.w.check();
  assert.deepEqual(h.queued.map((q) => q.alert.rung), [80, 95]);
  assert.equal(h.warns.length, 2);
  h.setNow(DAY2);
  h.spent['judge'] = 6.5;
  await h.w.check();
  assert.deepEqual(h.queued.map((q) => q.alert.subject), ['supplier|judge|2026-10-13', 'supplier|judge|2026-10-13', 'supplier|judge|2026-10-14']);
});

test('a day that boots already past 95% says 95% only; the 80% is spent with it', async () => {
  const h = harness();
  h.spent['posts'] = 11;
  await h.w.check();
  await h.w.check();
  assert.deepEqual(h.warns.map((x) => x.msg), ['supplier line at 95%: posts $11.00 of $11.25; raise it by $25.50']);
  assert.deepEqual(h.queued.map((q) => q.alert.rung), [95]);
});

test('★ no OWNER_WALLET: the warning is logged and nothing is queued', async () => {
  const h = harness({ wallets: [] });
  h.spent['judge'] = 7;
  await h.w.check();
  assert.equal(h.warns.length, 1);
  assert.equal(h.queued.length, 0);
});

test('★ no owner profile yet: logged once, and queued the minute the owner has signed in', async () => {
  const profiles: string[] = [];
  const h = harness({ profiles });
  h.spent['judge'] = 7;
  await h.w.check();
  await h.w.check();
  assert.equal(h.warns.length, 1, 'the log line is not repeated while waiting for a profile');
  assert.equal(h.queued.length, 0);
  profiles.push('owner-1');
  await h.w.check();
  await h.w.check();
  assert.deepEqual(h.queued.map((q) => q.userId), ['owner-1']);
});

test('★ the raise carries the day at its rate plus the buffer, in quarters, and is zero when the line already does', () => {
  /* 09:00 UTC: three eighths of the day gone. $3 spent projects $8; with a quarter's buffer $10. */
  assert.deepEqual(raiseFor({ capUsd: 6, spentUsd: 3 }, DAY1, 1.25), { projectedUsd: 8, raiseByUsd: 4 });
  assert.deepEqual(raiseFor({ capUsd: 10, spentUsd: 3 }, DAY1, 1.25), { projectedUsd: 8, raiseByUsd: 0 });
  /* A minute into the day is read as an hour, never as a day's spend in a minute. */
  assert.equal(raiseFor({ capUsd: 1, spentUsd: 0.1 }, DAY2, 1.25).projectedUsd, 2.4000000000000004);
});
