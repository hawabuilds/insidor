/**
 * THE PROPERTY UNDER TEST IS THAT `failing` IS REACHABLE.
 *
 * A three-way call is easy to write so that the third value never actually happens —
 * define `failing` narrowly enough and a genuinely broken source reads as live
 * forever, which is worse than having two states, because now there is a red pip
 * somebody trusts and it never lights. So most of what follows is a broken source
 * arriving by a different road each time: a wrong key, a hung socket, a loop that
 * stopped asking, a corrupt row, a skewed clock. Every one of them must come out
 * `failing`.
 *
 * The boundaries are pinned exactly, in both directions, because "one millisecond
 * over the bar" is the only place the rule can be off by one and the only place a
 * later edit can quietly move it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { sourceId } from '@insidor/contracts/ids.ts';
import type { SourceHealth } from '@insidor/contracts/source.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { liveCount, sourceState } from './state.ts';

const POLICY = DEFAULT_POLICY;
const BAR = POLICY.ingest.sourceFreshnessMs;
const FAILURE_BAR = POLICY.ingest.failingAfterFailures;

const NOW = 1_800_000_000_000 as Millis;

/** A configured source that answered a moment ago. Every test edits one field. */
const healthy: SourceHealth = {
  source: sourceId('example'),
  configuration: 'configured',
  configurationDetail: null,
  configuredAt: (NOW - 86_400_000) as Millis,
  lastSuccessAt: (NOW - 1_000) as Millis,
  lastFailureAt: null,
  lastFailureReason: null,
  consecutiveFailures: 0,
};

const at = (overrides: Partial<SourceHealth>): SourceHealth => ({ ...healthy, ...overrides });

/* ── the three states, by their own road ───────────────────────────────── */

test('a configured source that just answered is live', () => {
  assert.equal(sourceState(healthy, NOW, POLICY), 'live');
});

test('no credential is DORMANT, and stays dormant however old the row is', () => {
  // Dormancy is not time-sensitive: a source nobody turned on does not become
  // broken by sitting there. If this decayed to `failing`, a runner that stopped
  // writing would light a fault over every source the owner deliberately left off.
  const dormant = at({
    configuration: 'dormant',
    configurationDetail: 'EXAMPLE_KEY',
    lastSuccessAt: null,
    configuredAt: 0 as Millis,
  });
  assert.equal(sourceState(dormant, NOW, POLICY), 'dormant');
  assert.equal(sourceState(dormant, (NOW + 10 * BAR) as Millis, POLICY), 'dormant');
});

test('half a credential is FAILING, never dormant', () => {
  // Somebody turned it on and got it wrong. Calling that "not turned on" agrees
  // with the person who believes it is running.
  const half = at({ configuration: 'misconfigured', configurationDetail: 'EXAMPLE_SECRET is not set' });
  assert.equal(sourceState(half, NOW, POLICY), 'failing');
});

test('configured and never answered is FAILING, not live and not dormant', () => {
  // The shape a wrong key makes on day one. There is no age to show beside it,
  // which is what lets a surface say "has never answered" rather than invent one.
  assert.equal(sourceState(at({ lastSuccessAt: null }), NOW, POLICY), 'failing');
});

/* ── the fast road: it refuses every call ──────────────────────────────── */

test('the failure bar is exact in both directions', () => {
  const under = at({ consecutiveFailures: FAILURE_BAR - 1, lastFailureAt: NOW });
  const on = at({ consecutiveFailures: FAILURE_BAR, lastFailureAt: NOW });
  assert.equal(sourceState(under, NOW, POLICY), 'live', 'one short of the bar is still a blip');
  assert.equal(sourceState(on, NOW, POLICY), 'failing', 'the bar itself is failing');
});

test('a source failing fast does not have to wait out the freshness window', () => {
  // This is the case the freshness bar alone cannot catch, and the reason there are
  // two numbers: every call is refused instantly, so the last SUCCESS is recent and
  // stays recent for half an hour while nothing at all is working.
  const wrongKey = at({ lastSuccessAt: NOW as Millis, consecutiveFailures: FAILURE_BAR });
  assert.equal(sourceState(wrongKey, NOW, POLICY), 'failing');
});

/* ── the slow roads: nothing errors, and nothing works ─────────────────── */

test('the freshness bar is exact in both directions', () => {
  const onBar = at({ lastSuccessAt: (NOW - BAR) as Millis });
  const overBar = at({ lastSuccessAt: (NOW - BAR - 1) as Millis });
  assert.equal(sourceState(onBar, NOW, POLICY), 'live', 'the bar is a duration it is allowed to reach');
  assert.equal(sourceState(overBar, NOW, POLICY), 'failing', 'one millisecond past it is failing');
});

test('a source whose calls hang is FAILING, with a failure count of zero', () => {
  // A call that never returns never errors. A rule that only counted failures would
  // read this as healthy forever, which is precisely why it is not the only rule.
  const hung = at({ lastSuccessAt: (NOW - 2 * BAR) as Millis, consecutiveFailures: 0 });
  assert.equal(sourceState(hung, NOW, POLICY), 'failing');
});

test('a source nobody is asking any more is FAILING', () => {
  // The loop that calls it died. Nothing about the source itself is wrong, and the
  // board is still missing everything it would have carried — which is the fact the
  // reader needs, and is not "the world went quiet".
  const abandoned = at({ lastSuccessAt: (NOW - 7 * 86_400_000) as Millis, consecutiveFailures: 0 });
  assert.equal(sourceState(abandoned, NOW, POLICY), 'failing');
});

/* ── recovery ──────────────────────────────────────────────────────────── */

test('a source recovers the moment a call succeeds again', () => {
  // The success resets the count, which is what makes one bar mean the same thing on
  // every source. Without the reset a source that had a bad hour in March would read
  // failing for the rest of its life.
  const broken = at({
    consecutiveFailures: FAILURE_BAR + 2,
    lastFailureAt: (NOW - 60_000) as Millis,
    lastFailureReason: 'the vendor said no',
    lastSuccessAt: (NOW - 3 * BAR) as Millis,
  });
  assert.equal(sourceState(broken, NOW, POLICY), 'failing');

  const recovered = at({ ...broken, consecutiveFailures: 0, lastSuccessAt: NOW });
  assert.equal(sourceState(recovered, NOW, POLICY), 'live');
  // and the failure it had is still on the record — recovery is not amnesia.
  assert.equal(recovered.lastFailureReason, 'the vendor said no');
});

/* ── the ways a naive version returns `live` by accident ───────────────── */

test('a future success is not a success', () => {
  // A clock skewed forward makes the silence negative, which passes any
  // `silence <= bar` test forever and would make the source unfalsifiably live.
  const skewed = at({ lastSuccessAt: (NOW + 60_000) as Millis });
  assert.equal(sourceState(skewed, NOW, POLICY), 'failing');
});

test('an unreadable instant is not evidence of health', () => {
  // NaN makes every comparison false, so a naive version falls through every failing
  // branch and returns `live`: a corrupt row would light the pip green.
  assert.equal(sourceState(at({ lastSuccessAt: Number.NaN as Millis }), NOW, POLICY), 'failing');
  assert.equal(sourceState(at({ lastSuccessAt: Infinity as Millis }), NOW, POLICY), 'failing');
});

test('an unreadable failure count is not evidence of health', () => {
  assert.equal(sourceState(at({ consecutiveFailures: Number.NaN }), NOW, POLICY), 'failing');
});

/* ── counting ──────────────────────────────────────────────────────────── */

test('a dark source is never counted as a live one, whichever kind of dark', () => {
  // The rule the whole build turns on: absence of a source is not absence of
  // activity on it, so a source that was never asked cannot be added to the number
  // of sources that answered.
  assert.equal(liveCount(['live', 'dormant', 'failing']), 1);
  assert.equal(liveCount(['dormant', 'dormant', 'failing']), 0);
  assert.equal(liveCount([]), 0);
  assert.equal(liveCount(['live', 'live', 'live']), 3);
});
