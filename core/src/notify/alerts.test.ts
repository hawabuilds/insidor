/** The alert rules: once per level, off means nothing, quiet hours and the hourly limit only withhold the push. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { ALERT_KINDS, defaultPrefs, deliveryFor, groupDue, highestMilestone, isQuiet, LIST_ONLY, normalisePrefs, OWNER_ALARM_KINDS, PUSHED_KINDS, pacedScope, pacingOf, spentWith, UNCOUNTED_PUSH_KINDS, underDailyAllowance, type AlertPrefs } from './alerts.ts';

const P = DEFAULT_POLICY.notify;
const base = defaultPrefs(P);
const NOON = 720;
const at = (kind: (typeof ALERT_KINDS)[number], prefs: AlertPrefs = base, pushedLastHour = 0, devices = 1, localMinutes: number | null = NOON) => deliveryFor({ kind, prefs, localMinutes, pushedLastHour, devices });

test("★ each level fires once: only the highest crossed, and the ones below are spent with it", () => {
  const on = [2, 5, 10];
  assert.equal(highestMilestone(1.9, on, [], P), null);
  assert.equal(highestMilestone(6, on, [], P), 5, '3× is not switched on, 5× is the highest crossed');
  assert.deepEqual(spentWith(5, on), [2, 5]);
  assert.equal(highestMilestone(6, on, spentWith(5, on), P), null, 'the same level never fires twice');
  assert.equal(highestMilestone(12, on, spentWith(5, on), P), 10);
});

test('★ switching an alert type off stops it, and mute stops everything', () => {
  for (const kind of ALERT_KINDS) if (kind !== 'watchlist_multiple' && kind !== 'coin_picked') assert.notEqual(at(kind).kind, 'skip', `${kind} is on by default`);
  assert.deepEqual(at('watchlist_multiple'), { kind: 'skip', why: 'off' }, "Trador's default: the watchlist is off until switched on");
  const off = normalisePrefs({ ...base, on: { ...base.on, rising: false, holdings: false } }, P);
  assert.deepEqual(at('rising_post', off), { kind: 'skip', why: 'off' });
  assert.deepEqual(at('holding_multiple', off), { kind: 'skip', why: 'off' });
  assert.equal(at('coin_launched', off).kind, 'push', 'the others carry on');
  assert.deepEqual(at('follow', { ...base, muted: true }), { kind: 'skip', why: 'muted' });
});

test('★ the hourly limit holds: past it, the alert is listed and not pushed', () => {
  assert.equal(at('coin_launched', base, P.defaultPerHour - 1).kind, 'push');
  assert.deepEqual(at('coin_launched', base, P.defaultPerHour), { kind: 'list', why: 'hourly-limit' });
  assert.equal(normalisePrefs({ perHour: 1_000 }, P).perHour, P.maxPerHour, 'nobody sets a limit above the ceiling');
});

test('a rank-up is list-only, quiet hours withhold the push, and no device means listed', () => {
  assert.deepEqual(at('rank_up'), { kind: 'list', why: 'list-only' });
  const quiet = normalisePrefs({ quietStart: '22:00', quietEnd: '07:00', timezone: 'UTC' }, P);
  assert.equal(isQuiet(23 * 60, quiet), true, 'wraps midnight');
  assert.equal(isQuiet(NOON, quiet), false);
  assert.deepEqual(at('coin_launched', quiet, 0, 1, 3 * 60), { kind: 'list', why: 'quiet' });
  assert.equal(isQuiet(null, quiet), false, 'an unknown zone is never quiet');
  assert.deepEqual(at('coin_launched', base, 0, 0), { kind: 'list', why: 'no-device' });
});

test("Trador's defaults: the watchlist starts off, a bad multiple is dropped, and multiples are never empty", () => {
  assert.equal(base.on.watchlist, false);
  assert.deepEqual(normalisePrefs({ multiples: [7, 5] }, P).multiples, [5]);
  assert.deepEqual(normalisePrefs({ multiples: [] }, P).multiples, [...P.defaultMultiples]);
});

test("★ a supplier warning is on for everyone with no switch to lose it, and the hourly limit never holds it", () => {
  assert.deepEqual(at('supplier_warning'), { kind: 'push' }, 'on by default');
  const allOff = normalisePrefs({ ...base, on: Object.fromEntries(Object.keys(base.on).map((k) => [k, false])) as never }, P);
  assert.deepEqual(at('supplier_warning', allOff), { kind: 'push' }, 'no switch on the settings screen turns it off');
  assert.deepEqual(at('supplier_warning', base, P.maxPerHour + 1), { kind: 'push' }, 'past the hourly limit it is still pushed');
  assert.deepEqual(at('supplier_warning', { ...base, muted: true }), { kind: 'skip', why: 'muted' }, 'mute is the owner\'s own choice and still holds');
  const quiet = normalisePrefs({ quietStart: '22:00', quietEnd: '07:00', timezone: 'UTC' }, P);
  assert.deepEqual(at('supplier_warning', quiet, 0, 1, 3 * 60), { kind: 'list', why: 'quiet' }, 'quiet hours list it and withhold the push');
});

test('a supplier billing alert is the same alarm: no switch, past the hourly limit, mute still holds', () => {
  const allOff = normalisePrefs({ ...base, on: Object.fromEntries(Object.keys(base.on).map((k) => [k, false])) as never }, P);
  assert.deepEqual(at('supplier_account', allOff), { kind: 'push' });
  assert.deepEqual(at('supplier_account', base, P.maxPerHour + 1), { kind: 'push' });
  assert.deepEqual(at('supplier_account', { ...base, muted: true }), { kind: 'skip', why: 'muted' });
});

test('★ one push (2026-10-20): only a coin launched for a For You post reaches the phone; every other kind is listed', () => {
  for (const kind of ALERT_KINDS) {
    const d = at(kind);
    if (kind === 'coin_picked' || kind === 'watchlist_multiple') assert.deepEqual(d, { kind: 'skip', why: 'off' }, `${kind} is off until switched on`);
    else if (PUSHED_KINDS.includes(kind) || OWNER_ALARM_KINDS.includes(kind)) assert.deepEqual(d, { kind: 'push' }, kind);
    else assert.deepEqual(d, { kind: 'list', why: 'list-only' }, `${kind} is listed, not pushed`);
  }
  for (const kind of ['starred_first_coin', 'reply', 'holding_multiple', 'holding_down', 'creator_buyers', 'starred_speed', 'starred_big_account', 'blowing_up', 'story_post', 'follow', 'comment_useful'] as const) assert.deepEqual(at(kind), { kind: 'list', why: 'list-only' }, kind);
  assert.deepEqual(deliveryFor({ kind: 'follow', prefs: base, localMinutes: NOON, pushedLastHour: 0, devices: 1, grouped: true }), { kind: 'list', why: 'list-only' }, 'a group of follows is listed, not pushed');
  assert.ok(LIST_ONLY.includes('rank_up'), 'the bell\'s quiet list is unchanged');
  assert.equal(base.on.launches, true, 'on for everyone, nothing to star');
  const alarmsOff = { ...P, launch: { ...P.launch, ownerAlarmsPush: false } };
  assert.deepEqual(deliveryFor({ kind: 'outage', prefs: base, localMinutes: NOON, pushedLastHour: 0, devices: 1, policy: alarmsOff }), { kind: 'list', why: 'list-only' }, 'the owner\'s alarms follow their switch');
  assert.deepEqual(deliveryFor({ kind: 'outage', prefs: base, localMinutes: NOON, pushedLastHour: 0, devices: 1, policy: P }), { kind: 'push' });
});

test('★ every pick (policy.v235): off for everyone; switched on, pushed past the hourly limit and any daily cap, using up none of the other pushes', () => {
  assert.equal(base.on.everyPick, false, 'off until the person chooses it');
  assert.deepEqual(at('coin_picked'), { kind: 'skip', why: 'off' });
  const on = normalisePrefs({ ...base, on: { ...base.on, everyPick: true } }, P);
  assert.deepEqual(at('coin_picked', on), { kind: 'push' });
  assert.deepEqual(at('coin_picked', on, P.maxPerHour + 1), { kind: 'push' }, 'a busy hour does not drop a pick they asked for');
  assert.equal(pacingOf('coin_picked', P), null, 'no daily cap');
  assert.ok(UNCOUNTED_PUSH_KINDS.includes('coin_picked'), 'and it uses up none of their other pushes');
  assert.deepEqual(at('coin_picked', { ...on, muted: true }), { kind: 'skip', why: 'muted' });
});

test('★ a saved post always pushes (2026-10-24): past the hourly limit, never under a daily cap, still muted and quiet by choice', () => {
  assert.deepEqual(at('watched_first_coin'), { kind: 'push' });
  assert.deepEqual(at('watched_first_coin', base, P.maxPerHour + 1), { kind: 'push' }, 'a busy hour does not hold it back');
  assert.equal(pacingOf('watched_first_coin', P), null, 'no daily cap of its own');
  assert.deepEqual(deliveryFor({ kind: 'watched_first_coin', prefs: base, localMinutes: NOON, pushedLastHour: 0, devices: 1, policy: P, ofKind: { lastDay: P.launch.perDay, sinceLastMs: 0 } }), { kind: 'push' }, 'a full day of launch pushes does not hold it back');
  assert.ok(UNCOUNTED_PUSH_KINDS.includes('watched_first_coin'), 'and it uses up none of the person\'s allowance');
  assert.deepEqual(at('watched_first_coin', { ...base, muted: true }), { kind: 'skip', why: 'muted' });
  const quiet = normalisePrefs({ quietStart: '22:00', quietEnd: '07:00', timezone: 'UTC' }, P);
  assert.deepEqual(at('watched_first_coin', quiet, 0, 1, 3 * 60), { kind: 'list', why: 'quiet' });
});

test('★ the launch push: at most launch.perDay a day, no gap between two', () => {
  const d = (lastDay: number, sinceLastMs: number | null) => deliveryFor({ kind: 'coin_launched', prefs: base, localMinutes: NOON, pushedLastHour: 0, devices: 1, policy: P, ofKind: { lastDay, sinceLastMs } });
  assert.deepEqual(d(0, null), { kind: 'push' });
  assert.deepEqual(d(P.launch.perDay - 1, 0), { kind: 'push' }, 'a second coin a minute later still goes');
  assert.deepEqual(d(P.launch.perDay, 0), { kind: 'list', why: 'daily-limit' });
});

test('the paced kinds keep their rules for the list (blowing up three a day, a narrative\'s speed by its gap)', () => {
  const rule = pacingOf('blowing_up', P);
  assert.ok(rule !== null);
  assert.equal(underDailyAllowance({ lastDay: P.blowingUp.perDay, sinceLastMs: P.blowingUp.minGapMs * 2 }, rule), false, 'three in the day already');
  assert.equal(underDailyAllowance({ lastDay: 1, sinceLastMs: P.blowingUp.minGapMs - 1 }, rule), false, 'too soon after the last');
  assert.equal(underDailyAllowance({ lastDay: 9, sinceLastMs: P.starredSpeed.gapMs }, pacingOf('starred_speed', P)!), true, 'a narrative\'s speed has a gap, no day count');
  assert.equal(pacedScope('n-x:1|x:2'), 'n-x:1');
  assert.equal(pacingOf('reply', P), null);
});

test('a group is due once its oldest member waited, and its last push was long enough ago', () => {
  const rule = { waitMs: 10, gapMs: 100 };
  assert.equal(groupDue(9, null, rule), false);
  assert.equal(groupDue(10, null, rule), true);
  assert.equal(groupDue(50, 99, rule), false);
  assert.equal(groupDue(50, 100, rule), true);
});
