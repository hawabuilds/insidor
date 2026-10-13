/** The alert rules: once per level, off means nothing, quiet hours and the hourly limit only withhold the push. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { ALERT_KINDS, defaultPrefs, deliveryFor, highestMilestone, isQuiet, normalisePrefs, spentWith, type AlertPrefs } from './alerts.ts';

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
  for (const kind of ALERT_KINDS) if (kind !== 'watchlist_multiple') assert.notEqual(at(kind).kind, 'skip', `${kind} is on by default`);
  assert.deepEqual(at('watchlist_multiple'), { kind: 'skip', why: 'off' }, "Trador's default: the watchlist is off until switched on");
  const off = normalisePrefs({ ...base, on: { ...base.on, rising: false, holdings: false } }, P);
  assert.deepEqual(at('rising_post', off), { kind: 'skip', why: 'off' });
  assert.deepEqual(at('holding_multiple', off), { kind: 'skip', why: 'off' });
  assert.equal(at('follow', off).kind, 'push', 'the others carry on');
  assert.deepEqual(at('follow', { ...base, muted: true }), { kind: 'skip', why: 'muted' });
});

test('★ the hourly limit holds: past it, the alert is listed and not pushed', () => {
  assert.equal(at('graduated', base, P.defaultPerHour - 1).kind, 'push');
  assert.deepEqual(at('graduated', base, P.defaultPerHour), { kind: 'list', why: 'hourly-limit' });
  assert.equal(normalisePrefs({ perHour: 1_000 }, P).perHour, P.maxPerHour, 'nobody sets a limit above the ceiling');
});

test('a rank-up is list-only, quiet hours withhold the push, and no device means listed', () => {
  assert.deepEqual(at('rank_up'), { kind: 'list', why: 'list-only' });
  const quiet = normalisePrefs({ quietStart: '22:00', quietEnd: '07:00', timezone: 'UTC' }, P);
  assert.equal(isQuiet(23 * 60, quiet), true, 'wraps midnight');
  assert.equal(isQuiet(NOON, quiet), false);
  assert.deepEqual(at('follow', quiet, 0, 1, 3 * 60), { kind: 'list', why: 'quiet' });
  assert.equal(isQuiet(null, quiet), false, 'an unknown zone is never quiet');
  assert.deepEqual(at('follow', base, 0, 0), { kind: 'list', why: 'no-device' });
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
