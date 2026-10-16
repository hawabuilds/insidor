/**
 * The runner's side of the short-video source's second vendor: the route is configured from policy,
 * a switch to the backup and back each reach the owner's queue once, a low balance is said once a
 * day, and a balance of zero moves the work before a call has to fail.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { secondVendorWatch } from './second-vendor.ts';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as never;

function fixture(credits: number | null) {
  const notices: { subject: string; state: string; facts: Record<string, unknown> }[] = [];
  const failed: { reason: string; billing: boolean | undefined }[] = [];
  let listener: ((e: never) => void) | null = null;
  let configured: unknown = null;
  const watch = secondVendorWatch({
    vendor: 'second',
    backup: 'first',
    route: {
      configure: (s) => (configured = s),
      failed: (_now, reason, billing) => failed.push({ reason, billing }),
      onSwitch: (l) => ((listener = l as never), () => {}),
    },
    credits: () => (credits === null ? null : { credits, at: 0 }),
    alerts: { notice: (_v, subject, state, facts) => notices.push({ subject, state, facts: { ...facts } }) },
    names: { first: { supplier: 'First' } },
    policy: DEFAULT_POLICY,
    log: quiet,
  });
  return { watch, notices, failed, emit: (e: unknown) => listener!(e as never), configured: () => configured };
}

test('configured from policy; a switch and a return each go to the owner once', () => {
  const f = fixture(null);
  const c = f.configured() as { on: boolean; backupUntilMs: number };
  assert.equal(c.on, DEFAULT_POLICY.feed.secondVendor.on);
  assert.equal(c.backupUntilMs, Date.parse(DEFAULT_POLICY.feed.secondVendor.backupUntil));
  f.emit({ kind: 'backup', reason: 'HTTP 500', at: 0 });
  f.emit({ kind: 'back', at: 60_000, backupSince: 0 });
  assert.deepEqual(f.notices.map((n) => n.state), ['backup', 'back']);
  assert.equal(f.notices[0]?.facts['backup'], 'First');
});

test('a low balance is said with the day in its subject; zero moves the work at once', () => {
  const low = fixture(120);
  low.watch.checkBalance(Date.parse('2026-10-16T05:00:00Z'));
  assert.equal(low.notices[0]?.subject, 'low|second|2026-10-16');
  assert.equal(low.failed.length, 0);
  const none = fixture(0);
  none.watch.checkBalance(0);
  assert.deepEqual(none.failed, [{ reason: 'credits spent', billing: true }]);
  const plenty = fixture(25_000);
  plenty.watch.checkBalance(0);
  assert.equal(plenty.notices.length, 0);
});
