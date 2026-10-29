/** The round-the-clock health check: the shared bars, and one push when a bar breaks and one when it is back — never one a pass. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { stepAlarms, type Tracked } from './alarm.ts';
import type { Db } from './deliver.ts';
import { checkHealth, HEALTH_LOOP_MS, healthMemory, healthReadings, type HealthId, type HealthSeen } from './health-alarm.ts';
import { judgingBroken, logoFailPct, logosBroken, picturesBroken, tapeBroken } from './health-bars.ts';
import { alertText } from './text.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 29, 1, 0);

test('the bars: tools/health.ts\'s lines, read the same way', () => {
  assert.equal(picturesBroken(200), false);
  assert.equal(picturesBroken(402), true, 'storage over its allowance');
  assert.equal(picturesBroken(0), true, 'no answer at all');
  assert.equal(picturesBroken(null), false, 'no stored logo to try: no claim');
  assert.equal(logoFailPct(0, 0), 0);
  assert.equal(logoFailPct(6, 10), 60);
  assert.equal(logosBroken(6, 10), true);
  assert.equal(logosBroken(5, 10), false, 'exactly half is not over half');
  assert.equal(logosBroken(4, 4), false, 'too few copies to say');
  assert.equal(tapeBroken(0), true);
  assert.equal(tapeBroken(null), true, 'the read service not answering empties the strip too');
  assert.equal(tapeBroken(3), false);
  assert.equal(judgingBroken(9), true);
  assert.equal(judgingBroken(10), false);
});

/** Passes every five minutes over a timeline; returns [minute, state, id] for each push. */
function run(timeline: (minute: number) => HealthSeen, minutes: number): (readonly [number, string, string])[] {
  let tracked: Tracked = new Map();
  const badSince = new Map<HealthId, number>();
  const out: (readonly [number, string, string])[] = [];
  for (let m = 0; m <= minutes; m += HEALTH_LOOP_MS / MIN) {
    const now = T0 + m * MIN;
    const s = stepAlarms(tracked, healthReadings(timeline(m), badSince, now), now);
    tracked = s.next;
    for (const e of s.events) out.push([m, e.state, e.subject]);
  }
  return out;
}

test('★ pictures (2026-10-29 replayed): down on the second broken pass, silent for 13 hours, back once', () => {
  const pushes = run((m) => ({ pictureStatus: m >= 10 && m < 13 * 60 ? 402 : 200 }), 14 * 60);
  assert.deepEqual(pushes, [
    [15, 'down', 'pictures|2026-10-29T01:10:00.000Z'],
    [13 * 60, 'back', 'pictures|back|2026-10-29T01:10:00.000Z'],
  ]);
});

test('pictures: one failed fetch between good ones is a blip, not an outage', () => {
  assert.deepEqual(run((m) => ({ pictureStatus: m === 20 || m === 40 ? 0 : 200 }), 60), []);
});

test('★ the Tape: empty for under 30 minutes says nothing; 30 minutes is down, once; coins again is back, once', () => {
  assert.deepEqual(run((m) => ({ tapeCoins: m >= 10 && m < 35 ? 0 : 8 }), 120), [], 'a quiet 25 minutes');
  assert.deepEqual(run((m) => ({ tapeCoins: m >= 10 && m < 120 ? (m % 10 === 0 ? null : 0) : 8 }), 180), [
    [40, 'down', 'tape|2026-10-29T01:10:00.000Z'],
    [120, 'back', 'tape|back|2026-10-29T01:10:00.000Z'],
  ]);
});

test('logo copies and judging: down on the first pass over the bar (their windows already span an hour and half an hour)', () => {
  assert.deepEqual(run((m) => ({ logos: m >= 30 && m < 90 ? { failed: 40, copies: 50 } : { failed: 2, copies: 50 } }), 120), [
    [30, 'down', 'logos|2026-10-29T01:30:00.000Z'],
    [90, 'back', 'logos|back|2026-10-29T01:30:00.000Z'],
  ]);
  assert.deepEqual(run((m) => ({ judged: m >= 30 && m < 60 ? 3 : 140 }), 120), [
    [30, 'down', 'judged|2026-10-29T01:30:00.000Z'],
    [60, 'back', 'judged|back|2026-10-29T01:30:00.000Z'],
  ]);
});

test('a condition not read this pass keeps what it was: no "back" for a read that was skipped', () => {
  assert.deepEqual(run((m) => (m >= 30 && m < 60 ? {} : { judged: m < 30 ? 2 : 50 }), 90), [
    [0, 'down', 'judged|2026-10-29T01:00:00.000Z'],
    [60, 'back', 'judged|back|2026-10-29T01:00:00.000Z'],
  ]);
});

test('the texts say what was seen', () => {
  assert.deepEqual(alertText('outage', { what: 'pictures', state: 'down', status: 402, minutes: 5, lastAt: '2026-10-29T01:10:00.000Z' }), {
    title: 'Coin pictures are not loading',
    body: 'Picture storage answers 402 for a stored coin logo since 01:10 UTC. Coin logos, poster and post pictures are blank in the app.',
  });
  assert.match(alertText('outage', { what: 'pictures', state: 'back', minutes: 770 }).body, /^Picture storage answers again after .+\.$/);
  assert.equal(alertText('outage', { what: 'logos', state: 'down', failed: 40, copies: 50, windowMinutes: 60 }).body, '40 of 50 coin-logo copies in the last 60 minutes failed. New coins show without their picture.');
  assert.equal(alertText('outage', { what: 'tape', state: 'down', coins: 0, minutes: 30 }).title, 'The Tape has been empty for 30 minutes');
  assert.equal(alertText('outage', { what: 'tape', state: 'down', coins: null, minutes: 30 }).title, 'The Tape cannot be read');
  assert.equal(alertText('outage', { what: 'judged', state: 'down', judged: 3, windowMinutes: 30 }).title, 'Judging has stopped');
  assert.equal(alertText('outage', { what: 'judged', state: 'back', minutes: 30 }).title, 'Posts are judged again');
});

/* ── the pass around it ── */

interface World {
  copies: number;
  failed: number;
  stored: string | null;
  judged: number;
  pictureStatus: number;
  tape: number | 'down';
  before0152: boolean;
  dbDown: boolean;
}

function fake(): { db: Db; fetch: typeof globalThis.fetch; queued: { userId: string; kind: string; subject: string }[]; fetched: string[]; set: (w: Partial<World>) => void } {
  let w: World = { copies: 40, failed: 1, stored: 'Coin111pump', judged: 120, pictureStatus: 200, tape: 6, before0152: false, dbDown: false };
  const queued: { userId: string; kind: string; subject: string }[] = [];
  const fetched: string[] = [];
  const db: Db = {
    async query<R>(sql: string, params?: readonly unknown[]): Promise<R[]> {
      if (w.dbDown) throw new Error('connection terminated');
      if (sql.includes('internal.picture_health')) {
        if (w.before0152) throw Object.assign(new Error('function does not exist'), { code: '42883' });
        return [{ copies: w.copies, failed: w.failed, stored_address: w.stored }] as R[];
      }
      if (sql.includes('internal.judged_since')) {
        if (w.before0152) throw Object.assign(new Error('function does not exist'), { code: '42883' });
        return [{ n: w.judged }] as R[];
      }
      if (sql.includes('people.profile')) {
        assert.deepEqual(params?.[0], ['OwnerWa11et'], 'only the owner\'s wallets are looked up');
        return [{ userId: 'owner-1' }] as R[];
      }
      if (sql.includes('people.alert_queue')) {
        queued.push({ userId: String(params?.[0]), kind: String(params?.[1]), subject: String(params?.[2]) });
        return [];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  const fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    fetched.push(u);
    if (u.includes('/coin-logos/')) return new Response('img', { status: w.pictureStatus });
    if (u.endsWith('/running/coins')) {
      if (w.tape === 'down') throw new Error('connect ECONNREFUSED');
      return Response.json({ coins: Array.from({ length: w.tape }, (_, i) => ({ ticker: `C${i}` })) });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof globalThis.fetch;
  return { db, fetch, queued, fetched, set: (s) => (w = { ...w, ...s }) };
}

test('★ through the pass: storage cut off, one push to the owner when it starts and one when it ends', async () => {
  const f = fake();
  let now = T0;
  const mem = healthMemory();
  const deps = { db: f.db, now: () => now, fetch: f.fetch, pictureBase: 'https://pics.example', readUrl: 'https://read.example', ownerWallets: ['OwnerWa11et'], log: () => undefined };
  const pass = async (): Promise<void> => {
    await checkHealth(deps, mem);
    now += HEALTH_LOOP_MS;
  };

  await pass();
  assert.equal(f.queued.length, 0, 'healthy: nothing');
  assert.ok(f.fetched.includes('https://pics.example/coin-logos/Coin111pump'), 'the newest stored logo is fetched where the app fetches it');

  f.set({ pictureStatus: 402 });
  for (let i = 0; i < 12 * 13; i += 1) await pass();
  assert.deepEqual(f.queued, [{ userId: 'owner-1', kind: 'outage', subject: 'pictures|2026-10-29T01:05:00.000Z' }]);

  f.set({ pictureStatus: 200 });
  await pass();
  await pass();
  assert.deepEqual(f.queued.map((q) => q.subject), ['pictures|2026-10-29T01:05:00.000Z', 'pictures|back|2026-10-29T01:05:00.000Z']);
});

test('no owner wallet: nothing is queued for anyone', async () => {
  const f = fake();
  f.set({ judged: 0 });
  await checkHealth({ db: f.db, now: () => T0, fetch: f.fetch, pictureBase: 'p', readUrl: 'r', ownerWallets: [], log: () => undefined }, healthMemory());
  assert.equal(f.queued.length, 0);
});

test('before 0152: the database reads are skipped, logged once, and the Tape is still watched', async () => {
  const f = fake();
  f.set({ before0152: true, tape: 'down' });
  const logs: string[] = [];
  let now = T0;
  const mem = healthMemory();
  const deps = { db: f.db, now: () => now, fetch: f.fetch, pictureBase: 'p', readUrl: 'https://read.example', ownerWallets: ['OwnerWa11et'], log: (_l: string, msg: string) => void logs.push(msg) };
  for (let i = 0; i <= 6; i += 1) {
    await checkHealth(deps, mem);
    now += HEALTH_LOOP_MS;
  }
  assert.deepEqual(f.queued.map((q) => q.subject), ['tape|2026-10-29T01:00:00.000Z']);
  assert.equal(logs.filter((m) => m.includes('not available yet')).length, 2, 'one line per missing read, not one a pass');
  assert.ok(!f.fetched.some((u) => u.includes('/coin-logos/')), 'no stored logo known, so no picture fetch');
});

test('a database that cannot be read fails the pass and changes nothing (the outage alarm\'s database check says so)', async () => {
  const f = fake();
  const mem = healthMemory();
  f.set({ dbDown: true, judged: 0 });
  await assert.rejects(checkHealth({ db: f.db, now: () => T0, fetch: f.fetch, pictureBase: 'p', readUrl: 'r', ownerWallets: ['OwnerWa11et'], log: () => undefined }, mem));
  assert.equal(mem.tracked.size, 0);
  assert.equal(mem.badSince.size, 0);
});
