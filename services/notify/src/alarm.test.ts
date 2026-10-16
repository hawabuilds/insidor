/** The owner's outage alarm: once when it starts, once when it is back, never per pass; a quiet system never fires; Thursday replayed. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { PushMessage, PushSender } from '@insidor/contracts/ports/people.ts';

import { alarmMemory, allJudgesReading, backupReading, BACKUP_MIN_CALLS, checkAlarms, databaseReading, DB_UNREADABLE_MS, fypReading, FYP_SILENT_MS, judgeReading, JUDGE_MIN_CALLS, stepAlarms, streamReading, STREAM_SILENT_MS, type Tracked } from './alarm.ts';
import type { Db } from './deliver.ts';
import { alertText } from './text.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 15, 22, 19);

test('★ For You: down once at 45 minutes, silent while it stays down, back once when a newer post is shown', () => {
  let tracked: Tracked = new Map();
  const pass = (lastShown: number, now: number) => {
    const r = stepAlarms(tracked, [fypReading(lastShown, now)!], now);
    tracked = r.next;
    return r.events.map((e) => [e.state, e.subject]);
  };
  assert.deepEqual(pass(T0, T0 + 44 * MIN), [], 'a 44-minute gap is healthy');
  assert.deepEqual(pass(T0, T0 + 45 * MIN), [['down', 'fyp|2026-10-15T22:19:00.000Z']]);
  for (let m = 46; m < 130; m += 1) assert.deepEqual(pass(T0, T0 + m * MIN), [], `no repeat at minute ${m}`);
  const newPost = T0 + 129 * MIN;
  assert.deepEqual(pass(newPost, T0 + 130 * MIN), [['back', 'fyp|back|2026-10-15T22:19:00.000Z']]);
  assert.deepEqual(pass(newPost, T0 + 131 * MIN), []);
});

test('For You with no post ever shown makes no claim either way', () => {
  assert.equal(fypReading(null, T0), null);
});

test('★ judge: asked and nothing answered is down; a quiet judge (no calls) never is; calls stopping is not "back"', () => {
  const lastPaid = T0 - 1 * MIN;
  assert.equal(judgeReading({ calls: 0, answered: 0, lastAnsweredMs: lastPaid }).down, false, 'quiet: nothing asked');
  assert.equal(judgeReading({ calls: JUDGE_MIN_CALLS - 1, answered: 0, lastAnsweredMs: lastPaid }).down, false, 'too few to say');
  assert.equal(judgeReading({ calls: 40, answered: 3, lastAnsweredMs: lastPaid }).down, false, 'some refused, some answered: working');

  let tracked: Tracked = new Map();
  const pass = (r: { calls: number; answered: number; lastAnsweredMs: number | null }, now: number) => {
    const s = stepAlarms(tracked, [judgeReading(r)], now);
    tracked = s.next;
    return s.events.map((e) => [e.state, e.subject, e.facts['minutes'] ?? null]);
  };
  assert.deepEqual(pass({ calls: 81, answered: 0, lastAnsweredMs: lastPaid }, T0 + 15 * MIN), [['down', 'judge|2026-10-15T22:18:00.000Z', null]]);
  assert.deepEqual(pass({ calls: 250, answered: 0, lastAnsweredMs: lastPaid }, T0 + 60 * MIN), []);
  /* The runner dies mid-outage: no calls at all. Still down, and no "back". */
  assert.deepEqual(pass({ calls: 0, answered: 0, lastAnsweredMs: lastPaid }, T0 + 70 * MIN), []);
  /* The look-back loses the last paid call (an outage over a day): still no "back". */
  assert.deepEqual(pass({ calls: 0, answered: 0, lastAnsweredMs: null }, T0 + 25 * 60 * MIN), []);
  /* A paid call: back, once, with how long since the last paid one. */
  const paidAgain = T0 + 25 * 60 * MIN + 2 * MIN;
  assert.deepEqual(pass({ calls: 12, answered: 4, lastAnsweredMs: paidAgain }, paidAgain + MIN), [['back', 'judge|back|2026-10-15T22:18:00.000Z', 1504]]);
  assert.deepEqual(pass({ calls: 12, answered: 4, lastAnsweredMs: paidAgain }, paidAgain + 2 * MIN), []);
});

test('coin stream: down after 15 minutes with no watched window, back on a newer one (Thursday: 07:13 to 01:01)', () => {
  const stopped = Date.UTC(2026, 9, 15, 7, 13, 47);
  let tracked: Tracked = new Map();
  const pass = (lastRead: number, now: number) => {
    const s = stepAlarms(tracked, [streamReading(lastRead, now)!], now);
    tracked = s.next;
    return s.events.map((e) => [e.state, e.facts['minutes']]);
  };
  assert.deepEqual(pass(stopped, stopped + STREAM_SILENT_MS - MIN), []);
  assert.deepEqual(pass(stopped, stopped + STREAM_SILENT_MS), [['down', 15]]);
  assert.deepEqual(pass(stopped, stopped + 17 * 60 * MIN), []);
  const back = Date.UTC(2026, 9, 16, 1, 1, 30);
  assert.deepEqual(pass(back, back + MIN), [['back', 1069]]);
  assert.equal(alertText('outage', { what: 'stream', state: 'down', minutes: 15, lastAt: new Date(stopped).toISOString() }).title, 'The live coin stream has stopped for 15 minutes');
});

test('database: down after every read failed for 10 minutes, back on the first read', () => {
  let tracked: Tracked = new Map();
  const pass = (failingSince: number | null, now: number) => {
    const s = stepAlarms(tracked, [databaseReading(failingSince, now)], now);
    tracked = s.next;
    return s.events.map((e) => e.state);
  };
  assert.deepEqual(pass(null, T0), []);
  assert.deepEqual(pass(T0, T0 + DB_UNREADABLE_MS - MIN), []);
  assert.deepEqual(pass(T0, T0 + DB_UNREADABLE_MS), ['down']);
  assert.deepEqual(pass(T0, T0 + DB_UNREADABLE_MS + 5 * MIN), []);
  assert.deepEqual(pass(null, T0 + DB_UNREADABLE_MS + 6 * MIN), ['back']);
});

test("the pushes read in the owner's plain words", () => {
  assert.deepEqual(alertText('outage', { what: 'fyp', state: 'down', minutes: 45, lastAt: '2026-10-15T22:19:08.000Z' }), {
    title: 'For You has had no new post for 45 minutes',
    body: 'Nothing new has reached For You since 22:19 UTC. Posts are not being found, judged or shown.',
  });
  assert.deepEqual(alertText('outage', { what: 'fyp', state: 'back', minutes: 130 }), { title: 'For You has new posts again', body: 'A new post reached For You after 2h without one.' });
  assert.deepEqual(alertText('outage', { what: 'judge', state: 'down', calls: 81, windowMinutes: 15, lastAt: '2026-10-15T22:17:44.000Z' }), {
    title: 'The judge has stopped answering',
    body: 'The judge was asked 81 times in the last 15 minutes and no supplier answered a post. New posts are not judged until one answers. Last answer 22:17 UTC.',
  });
  assert.deepEqual(alertText('outage', { what: 'database', state: 'down', minutes: 10 }).title, 'Insidor cannot read its database');
});

/* ── the pass around it ── */

interface Fake {
  db: Db;
  queued: { userId: string; kind: string; subject: string }[];
  set: (s: Partial<{ lastShown: number | null; calls: number; paid: number; lastPaid: number | null; backupCalls: number; backupAnswered: number; backupLast: number | null; fail: boolean; before0087: boolean; before0092: boolean }>) => void;
}

function fake(): Fake {
  let st = { lastShown: T0 as number | null, calls: 30, paid: 30, lastPaid: T0 as number | null, backupCalls: 0, backupAnswered: 0, backupLast: null as number | null, fail: false, before0087: false, before0092: false };
  const queued: Fake['queued'] = [];
  const db: Db = {
    async query<R>(sql: string, params?: readonly unknown[]): Promise<R[]> {
      if (st.fail) throw new Error('connection terminated');
      if (sql.includes('public.feed_post')) {
        if (st.before0087) throw Object.assign(new Error('permission denied'), { code: '42501' });
        return [{ at: st.lastShown === null ? null : new Date(st.lastShown) }] as R[];
      }
      if (sql.includes('coin_stream_read_at')) {
        if (st.before0087) throw Object.assign(new Error('function does not exist'), { code: '42883' });
        return [{ at: null }] as R[];
      }
      if (sql.includes('internal.judge_lines')) {
        if (st.before0087 || st.before0092) throw Object.assign(new Error('function does not exist'), { code: '42883' });
        const at = (ms: number | null) => (ms === null ? null : new Date(ms));
        return [
          { vendor: 'anthropic', calls: st.calls, answered: st.paid, last_answered_at: at(st.lastPaid) },
          { vendor: 'openrouter', calls: st.backupCalls, answered: st.backupAnswered, last_answered_at: at(st.backupLast) },
        ] as R[];
      }
      if (sql.includes('internal.judge_pay')) {
        if (st.before0087) throw Object.assign(new Error('function does not exist'), { code: '42883' });
        return [{ calls: st.calls, paid: st.paid, last_paid_at: st.lastPaid === null ? null : new Date(st.lastPaid) }] as R[];
      }
      if (sql.includes('people.profile')) return [{ userId: 'owner-1' }] as R[];
      if (sql.includes('people.push_subscription')) return [{ endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a' }] as R[];
      if (sql.includes('people.alert_queue')) {
        queued.push({ userId: String(params?.[0]), kind: String(params?.[1]), subject: String(params?.[2]) });
        return [];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  return { db, queued, set: (s) => (st = { ...st, ...s }) };
}

function pushes(): { sender: PushSender; sent: PushMessage[] } {
  const sent: PushMessage[] = [];
  return { sent, sender: { configured: true, publicKey: 'p', send: async (_t, m) => (sent.push(m), 'sent') } };
}

test('★ Thursday night replayed through the pass: one push each way per condition, the owner only', async () => {
  const f = fake();
  const p = pushes();
  let now = T0;
  const mem = alarmMemory();
  const deps = { db: f.db, now: () => now, ownerWallets: ['OwnerWa11et'], primaryJudgeVendor: 'anthropic', push: p.sender, ttlS: 60, log: () => undefined };

  await checkAlarms(deps, mem);
  assert.equal(f.queued.length, 0, 'healthy: nothing');

  /* 22:18 the judge is refused; 22:19 the last post shows. */
  f.set({ calls: 81, paid: 0, lastPaid: T0 - MIN });
  for (let m = 1; m <= 130; m += 1) {
    now = T0 + m * MIN;
    await checkAlarms(deps, mem);
  }
  assert.deepEqual(f.queued.map((q) => [q.kind, q.subject]), [
    ['outage', 'judge|2026-10-15T22:18:00.000Z'],
    ['outage', 'fyp|2026-10-15T22:19:00.000Z'],
  ]);

  /* 00:21 the judge is paid again; 00:28 a post shows. */
  f.set({ calls: 30, paid: 5, lastPaid: now });
  now += MIN;
  await checkAlarms(deps, mem);
  f.set({ lastShown: now });
  now += MIN;
  await checkAlarms(deps, mem);
  now += MIN;
  await checkAlarms(deps, mem);
  assert.deepEqual(f.queued.slice(2).map((q) => q.subject), ['judge|back|2026-10-15T22:18:00.000Z', 'fyp|back|2026-10-15T22:19:00.000Z']);
  assert.ok(f.queued.every((q) => q.userId === 'owner-1'));
  assert.equal(p.sent.length, 0, 'with a database, everything goes through the queue');
});

test('★ a restart mid-outage queues the same subject again, so the claim drops it', async () => {
  const f = fake();
  const p = pushes();
  f.set({ lastShown: T0 });
  const deps = { db: f.db, now: () => T0 + 50 * MIN, ownerWallets: ['w'], primaryJudgeVendor: 'anthropic', push: p.sender, ttlS: 60, log: () => undefined };
  await checkAlarms(deps, alarmMemory());
  await checkAlarms(deps, alarmMemory());
  assert.equal(f.queued.length, 2);
  assert.equal(f.queued[0]?.subject, f.queued[1]?.subject);
});

test('★ the database unreadable: pushed straight to the devices last read, once; back through the queue', async () => {
  const f = fake();
  const p = pushes();
  let now = T0;
  const mem = alarmMemory();
  const deps = { db: f.db, now: () => now, ownerWallets: ['w'], primaryJudgeVendor: 'anthropic', push: p.sender, ttlS: 60, log: () => undefined };
  await checkAlarms(deps, mem);
  f.set({ fail: true });
  for (let m = 1; m <= 30; m += 1) {
    now = T0 + m * MIN;
    await checkAlarms(deps, mem);
  }
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0]?.title, 'Insidor cannot read its database');
  f.set({ fail: false });
  now += MIN;
  await checkAlarms(deps, mem);
  assert.deepEqual(f.queued.map((q) => q.subject.split('|').slice(0, 2).join('|')), ['database|back']);
});

test('before migration 0087: every read is skipped, and that is not the database down', async () => {
  const f = fake();
  const p = pushes();
  f.set({ before0087: true });
  const mem = alarmMemory();
  const lines: string[] = [];
  for (let m = 0; m < 30; m += 1) {
    await checkAlarms({ db: f.db, now: () => T0 + m * MIN, ownerWallets: ['w'], primaryJudgeVendor: 'anthropic', push: p.sender, ttlS: 60, log: (_l, msg) => void lines.push(msg) }, mem);
  }
  assert.equal(f.queued.length + p.sent.length, 0);
  assert.equal(mem.failingSince, null);
  assert.equal(lines.filter((l) => l.includes('not available yet')).length, 4, 'each said once: fyp, judge_lines, judge_pay, stream');
});

test('FYP_SILENT_MS is the owner\'s 45 minutes', () => {
  assert.equal(FYP_SILENT_MS, 45 * MIN);
});

/* ── the judge by answers, every supplier, and the backup (0092) ── */

test('★ the judge by every supplier: the main judge failing while the backup answers is no alarm; neither answering is', () => {
  const at = T0 - MIN;
  const lines = (main: [number, number], other: [number, number]) => [
    { vendor: 'anthropic', calls: main[0], answered: main[1], lastAnsweredMs: main[1] > 0 ? T0 : at },
    { vendor: 'openrouter', calls: other[0], answered: other[1], lastAnsweredMs: other[1] > 0 ? T0 : null },
  ];
  /* Friday 19:30 UTC as it was: the main judge called and answering nothing, the open model answering. */
  assert.equal(allJudgesReading(lines([57, 0], [12, 72])).down, false);
  assert.equal(backupReading(lines([57, 0], [12, 72]), 'anthropic').down, false);
  /* Both failing: the judge is down, and the backup failed too. */
  assert.equal(allJudgesReading(lines([40, 0], [20, 0])).down, true);
  assert.equal(backupReading(lines([40, 0], [20, 0]), 'anthropic').down, true);
  /* The backup not asked (the main judge fine): no claim about it. */
  assert.equal(backupReading(lines([40, 300], [0, 0]), 'anthropic').down, false);
  assert.equal(backupReading(lines([0, 0], [BACKUP_MIN_CALLS - 1, 0]), 'anthropic').down, false, 'too few to say');
  /* Whichever is primary: with the open model primary, the Anthropic judge is the backup. */
  assert.equal(backupReading(lines([40, 0], [20, 90]), 'openrouter').down, true);
});

test('★ through the pass: the backup failing too pushes once, and once when it answers again', async () => {
  const f = fake();
  const p = pushes();
  let now = T0;
  const mem = alarmMemory();
  const deps = { db: f.db, now: () => now, ownerWallets: ['w'], primaryJudgeVendor: 'anthropic', push: p.sender, ttlS: 60, log: () => undefined };
  f.set({ lastShown: null });
  /* The main judge refused; the backup answering, then failing too. */
  f.set({ calls: 40, paid: 0, lastPaid: T0 - 30 * MIN, backupCalls: 20, backupAnswered: 50, backupLast: T0 });
  await checkAlarms(deps, mem);
  assert.deepEqual(f.queued.map((q) => q.subject), [], 'backup answering: nothing');
  f.set({ backupAnswered: 0 });
  for (let m = 1; m <= 10; m += 1) {
    now = T0 + m * MIN;
    await checkAlarms(deps, mem);
  }
  /* The judge's mark is the last answer from any supplier: the backup's, at 22:19. */
  assert.deepEqual(f.queued.map((q) => q.subject), ['judge|2026-10-15T22:19:00.000Z', 'backup|2026-10-15T22:19:00.000Z']);
  f.set({ backupAnswered: 8, backupLast: now });
  now += MIN;
  await checkAlarms(deps, mem);
  assert.deepEqual(f.queued.slice(2).map((q) => q.subject), ['judge|back|2026-10-15T22:19:00.000Z', 'backup|back|2026-10-15T22:19:00.000Z']);
  assert.deepEqual(alertText('outage', { what: 'backup', state: 'down', calls: 20, windowMinutes: 15, lastAt: '2026-10-15T22:19:00.000Z' }), {
    title: 'The backup judge failed too',
    body: 'The main judge is failing, and the backup was asked 20 times in the last 15 minutes and answered no post. Posts the main judge cannot answer are not judged. Last answer 22:19 UTC.',
  });
});

test('before 0092 the judge is read from 0087 (paid calls), and there is no backup reading', async () => {
  const f = fake();
  const p = pushes();
  const logs: string[] = [];
  f.set({ before0092: true, lastShown: null, calls: 81, paid: 0, lastPaid: T0 - MIN });
  const deps = { db: f.db, now: () => T0 + 15 * MIN, ownerWallets: ['w'], primaryJudgeVendor: 'anthropic', push: p.sender, ttlS: 60, log: (_l: string, m: string) => void logs.push(m) };
  await checkAlarms(deps, alarmMemory());
  assert.deepEqual(f.queued.map((q) => q.subject), ['judge|2026-10-15T22:18:00.000Z']);
  assert.ok(logs.some((m) => m.includes('not available yet')));
});
