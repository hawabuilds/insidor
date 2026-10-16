/** The open judge account's low-credit alarm: the line is two days of spend or $5; low once, topped up once; an unread balance makes no claim. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { CREDIT_FLOOR_USD, creditLine, creditWatch } from './open-credit.ts';
import type { Logger } from './log.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const T = Date.UTC(2026, 9, 16, 20, 0);

function watch(): { left: { usd: number | Error }; daily: { usd: number | Error }; notices: { subject: string; state: string; facts: Record<string, unknown> }[]; w: ReturnType<typeof creditWatch>; at: { ms: number } } {
  const left = { usd: 40 as number | Error };
  const daily = { usd: 2.7 as number | Error };
  const at = { ms: T };
  const notices: { subject: string; state: string; facts: Record<string, unknown> }[] = [];
  const w = creditWatch({
    vendor: 'openrouter',
    remaining: async () => (left.usd instanceof Error ? Promise.reject(left.usd) : left.usd),
    dailyUsd: async () => (daily.usd instanceof Error ? Promise.reject(daily.usd) : daily.usd),
    alerts: { notice: (_v, subject, state, facts) => notices.push({ subject, state, facts: { ...facts } }) },
    log: quiet,
    now: () => at.ms,
  });
  return { left, daily, notices, w, at };
}

test('the line: two days of the last day of spend, never under $5', () => {
  assert.equal(creditLine(0), CREDIT_FLOOR_USD);
  assert.equal(creditLine(1.6), 5, 'a quiet day: the floor');
  assert.equal(creditLine(2.7), 5.4, "today's measured spend on the account");
  assert.equal(creditLine(8), 16);
});

test('★ low once, silent while it stays low, topped up once — and not back at the line itself', async () => {
  const x = watch();
  await x.w.check();
  assert.equal(x.notices.length, 0, '$40 against a $5.40 line: fine');
  x.left.usd = 5.2;
  await x.w.check();
  assert.deepEqual(x.notices.map((n) => [n.subject, n.state, n.facts['usd'], n.facts['lineUsd'], n.facts['dailyUsd']]), [['credit|openrouter|2026-10-16', 'low', 5.2, 5.4, 2.7]]);
  for (const usd of [4, 3, 6, 6.7]) {
    x.left.usd = usd;
    await x.w.check();
  }
  assert.equal(x.notices.length, 1, 'still low, or over the line but under 1.25x of it: nothing more');
  x.at.ms += 24 * 60 * 60_000;
  x.left.usd = 25;
  await x.w.check();
  assert.deepEqual(x.notices.slice(1).map((n) => [n.subject, n.state, n.facts['usd']]), [['credit|openrouter|back|2026-10-16', 'topped', 25]]);
  await x.w.check();
  assert.equal(x.notices.length, 2);
});

test('an unread balance makes no claim: it never fires, and never clears a low', async () => {
  const x = watch();
  x.left.usd = new Error('the account answered 401');
  await x.w.check();
  assert.equal(x.notices.length, 0);
  x.left.usd = 1;
  await x.w.check();
  x.left.usd = new Error('timeout');
  await x.w.check();
  assert.equal(x.w.lowSince(), '2026-10-16');
  assert.equal(x.notices.length, 1);
});

test('an unread day of spend: the floor alone is the line', async () => {
  const x = watch();
  x.daily.usd = new Error('database down');
  x.left.usd = 5.2;
  await x.w.check();
  assert.equal(x.notices.length, 0, '$5.20 is over the $5 floor');
  x.left.usd = 4.9;
  await x.w.check();
  assert.equal(x.notices[0]?.facts['lineUsd'], 5);
});
