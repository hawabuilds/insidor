/**
 * Each test induces one of the four failures the watchdog exists for. The
 * detection time this buys is under three minutes, against the seven hours the
 * build being replaced managed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkSnapshot, createAlertGate, DEFAULT_THRESHOLDS } from './checks.ts';
import type { WatchSnapshot } from './snapshot.ts';

const NOW = 1_800_000_000_000;
const CADENCES = { admit: 60_000, track: 30_000, chainwatch: 20_000 };

function snapshot(patch: Partial<WatchSnapshot>): WatchSnapshot {
  return {
    takenAt: NOW,
    stages: [],
    openRuns: [],
    recentGaps: [],
    feeds: [],
    compression: [],
    ...patch,
  };
}

test('a healthy pipeline produces nothing', () => {
  const alerts = checkSnapshot(
    snapshot({
      stages: [
        { stage: 'admit', lastSuccessAt: NOW - 30_000, lastFinishedAt: NOW - 30_000, lastOutcome: 'ok' },
        { stage: 'track', lastSuccessAt: NOW - 10_000, lastFinishedAt: NOW - 10_000, lastOutcome: 'empty' },
      ],
      feeds: [{ feedId: 'mints', lastSuccessAt: NOW - 20_000 }],
    }),
    CADENCES,
  );
  assert.deepEqual(alerts, []);
});

test('W1: a stage erroring every cycle is stale, not healthy', () => {
  // The trap: it IS producing run rows, every minute, on time. A rule that
  // looked at "last run" instead of "last SUCCESSFUL run" would call this fine.
  const alerts = checkSnapshot(
    snapshot({
      stages: [
        { stage: 'admit', lastSuccessAt: NOW - 400_000, lastFinishedAt: NOW - 5_000, lastOutcome: 'error' },
      ],
    }),
    CADENCES,
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.key, 'W1:admit');
  assert.equal(alerts[0]?.severity, 'page');
});

test("W1: 'ran and found nothing' is NOT an outage", () => {
  const alerts = checkSnapshot(
    snapshot({
      stages: [
        { stage: 'admit', lastSuccessAt: NOW - 30_000, lastFinishedAt: NOW - 30_000, lastOutcome: 'empty' },
      ],
    }),
    CADENCES,
  );
  assert.deepEqual(alerts, [], 'empty is a successful run and must not page anyone');
});

test('W1: a stage that has never succeeded is reported, not skipped', () => {
  const alerts = checkSnapshot(
    snapshot({
      stages: [{ stage: 'track', lastSuccessAt: null, lastFinishedAt: null, lastOutcome: null }],
    }),
    CADENCES,
  );
  assert.equal(alerts[0]?.key, 'W1-never:track');
});

test('W1: a stage nobody configured a cadence for is reported as unmonitored', () => {
  const alerts = checkSnapshot(
    snapshot({
      stages: [{ stage: 'requalify', lastSuccessAt: NOW, lastFinishedAt: NOW, lastOutcome: 'ok' }],
    }),
    CADENCES,
  );
  assert.equal(alerts[0]?.key, 'W1-unknown:requalify');
});

test('W2: a run row that never closed is a killed process', () => {
  const alerts = checkSnapshot(
    snapshot({
      openRuns: [{ runId: '9912', stage: 'group', host: 'railway-a', startedAt: NOW - 900_000 }],
    }),
    CADENCES,
  );
  assert.equal(alerts[0]?.key, 'W2:9912');
  assert.match(alerts[0]?.detail ?? '', /killed/);
});

test('W2: a run inside the ten-minute window is just work in progress', () => {
  const alerts = checkSnapshot(
    snapshot({
      openRuns: [{ runId: '9913', stage: 'group', host: 'railway-a', startedAt: NOW - 60_000 }],
    }),
    CADENCES,
  );
  assert.deepEqual(alerts, []);
});

test('W3: a recorded coverage gap wider than three minutes pages', () => {
  const alerts = checkSnapshot(
    snapshot({
      recentGaps: [
        { feedId: 'mints', kind: 'not_watching', fromMs: NOW - 900_000, toMs: NOW - 600_000 },
      ],
    }),
    CADENCES,
  );
  assert.equal(alerts[0]?.key, `W3:mints:${NOW - 900_000}`);
  assert.match(alerts[0]?.detail ?? '', /unmeasurable/);
});

test('W3: a gap that is still open is caught while it is happening', () => {
  const alerts = checkSnapshot(
    snapshot({ feeds: [{ feedId: 'mints', lastSuccessAt: NOW - 240_000 }] }),
    CADENCES,
  );
  assert.equal(alerts[0]?.key, 'W3-open:mints');
});

test('W4: the funnel changing shape is a warning, not a page', () => {
  const alerts = checkSnapshot(
    snapshot({ compression: [{ stage: 'group', thisWeek: 12, lastWeek: 3 }] }),
    CADENCES,
  );
  assert.equal(alerts[0]?.key, 'W4:group');
  assert.equal(alerts[0]?.severity, 'warn');
});

test('W4: a move inside the band is ignored, in both directions', () => {
  const up = checkSnapshot(
    snapshot({ compression: [{ stage: 'group', thisWeek: 6, lastWeek: 3 }] }),
    CADENCES,
  );
  const down = checkSnapshot(
    snapshot({ compression: [{ stage: 'group', thisWeek: 3, lastWeek: 6 }] }),
    CADENCES,
  );
  assert.deepEqual(up, []);
  assert.deepEqual(down, []);
});

test('thresholds are parameters, so the rules can be exercised at any scale', () => {
  const strict = { ...DEFAULT_THRESHOLDS, maxOpenRunMs: 1_000 };
  const alerts = checkSnapshot(
    snapshot({ openRuns: [{ runId: '1', stage: 'rank', host: 'h', startedAt: NOW - 5_000 }] }),
    CADENCES,
    strict,
  );
  assert.equal(alerts.length, 1);
});

test('the same condition does not page every single poll', () => {
  const gate = createAlertGate(600_000);
  const alert = { key: 'W1:admit', severity: 'page' as const, title: 't', detail: 'd' };

  assert.equal(gate.admit([alert], NOW).length, 1, 'first sighting is sent');
  assert.equal(gate.admit([alert], NOW + 60_000).length, 0, 'still firing, already told you');
  assert.equal(gate.admit([alert], NOW + 700_000).length, 1, 'and re-sent once it has been a while');
});

test('a condition that clears announces that it cleared', () => {
  const gate = createAlertGate(600_000);
  const alert = { key: 'W1:admit', severity: 'page' as const, title: 't', detail: 'd' };

  gate.admit([alert], NOW);
  assert.deepEqual(gate.recovered([alert], NOW + 1_000), [], 'still firing');
  assert.deepEqual(gate.recovered([], NOW + 2_000), ['W1:admit']);
  assert.equal(gate.admit([alert], NOW + 3_000).length, 1, 'and a recurrence is a fresh page');
});
