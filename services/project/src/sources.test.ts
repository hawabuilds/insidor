/**
 * THE SOURCE PROJECTION, tested against the rules it exists to hold.
 *
 * No database: `projectSourceHealth` and `projectSourceFeed` are pure, so a test is a
 * literal in and a literal out. Each block names the failure it guards against rather than
 * the function it calls.
 *
 * ★ THE THREE-WAY CALL ITSELF IS TESTED IN core/src/sources/state.test.ts, NOT HERE, and
 * these tests deliberately do not re-derive it — they assert that this file ASKS that rule
 * and publishes what it says. There is one place that decides whether a source is failing;
 * a second set of state assertions here would be a second opinion nobody compared, and the
 * branch two opinions drift toward is always `live`. What this file is uniquely responsible
 * for is everything else: what may be said out loud, what the label is allowed to be, and
 * that the word and the instant beside it can never disagree.
 *
 * THE FOUR RULES:
 *
 *   1. THE PAYLOAD CARRIES NO MACHINERY. `SourceHealth` arrives holding an environment
 *      variable name and a vendor's own error message. Neither may cross. This is the
 *      payload under the most pressure in the system to acquire an explanation, because it
 *      is the thing on screen that says something is wrong.
 *
 *   2. THE STATE AND THE INSTANT COME FROM THE SAME FIELD. A green pip over a dash, or a red
 *      one over a timestamp from a second ago, is the surface contradicting itself.
 *
 *   3. A LABEL IS BOUNDED AND STRIPPED BEFORE IT IS STORED — not before it is rendered. This
 *      one sits in the nav on every route, so an unbounded label does not merely look wrong,
 *      it pushes the rest of the nav off the screen.
 *
 *   4. AN EMPTY FRAME IS A REAL ANSWER AND COMMITS HAPPILY. It means we ingest from nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY, sourceId } from '@insidor/contracts';
import type { SourceHealth } from '@insidor/contracts';

import { projectSourceFeed, projectSourceHealth } from './project.ts';
import type { SourceOptions } from './project.ts';
import { FORBIDDEN_KEYS, FORBIDDEN_SUBSTRINGS, WireLeakError } from './wire.ts';

const T0 = 1_755_079_200_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** The bar the policy actually ships, read rather than retyped: a number typed twice drifts. */
const BAR = DEFAULT_POLICY.ingest.sourceFreshnessMs;

const options: SourceOptions = { nowMs: T0, policy: DEFAULT_POLICY };

/**
 * One recorded source.
 *
 * ★ THE TWO OPERATOR-TEXT FIELDS ARE POPULATED IN THE TESTS BELOW ON PURPOSE, and the censor
 * test then asserts they do not come out the other side. `configurationDetail` names an
 * environment variable and `lastFailureReason` is a vendor's own message kept whole; both
 * are real on a real row, and a fixture that always left them null would prove nothing about
 * whether the projection carries them.
 */
function health(over: Partial<SourceHealth> = {}): SourceHealth {
  return {
    source: sourceId('reddit'),
    configuration: 'configured',
    configurationDetail: null,
    configuredAt: T0 - 30 * HOUR,
    lastSuccessAt: T0 - MIN,
    lastFailureAt: null,
    lastFailureReason: null,
    consecutiveFailures: 0,
    ...over,
  };
}

const project = (over: Partial<SourceHealth> = {}, label = 'Reddit') =>
  projectSourceHealth(health(over), label, options);

/* ── rule 1: no machinery on the wire ─────────────────────────────────── */

test('★ the payload carries no machinery, on every branch, and the key list is pinned', () => {
  /* THE GAP THIS CLOSES. 0017 stores this payload on public.source_view, which is granted to
     the app role, and the column comment promises it is "already censored" — a promise
     nothing keeps unless this function runs the censor. And this is the payload most likely
     to acquire the thing it forbids: it is the element that says something is broken, so
     every instinct is to let it explain itself with a `reason`, a `threshold` it was measured
     against, a `verdict` about the vendor, or the vendor's own message.

     The key list is pinned as well as the words, because the censor cannot be provoked from
     this function's own construction — every field is written by name. What the pinning CAN
     do is make the day a fifth key is added a diff that has to come past a test naming all
     four. */
  for (const projected of [
    project(),
    project({ configuration: 'dormant', lastSuccessAt: null }),
    project({
      configuration: 'misconfigured',
      configurationDetail: 'REDDIT_CLIENT_SECRET is not set',
      lastFailureAt: T0,
      lastFailureReason: 'apify returned 500 with an html body',
      consecutiveFailures: 41,
    }),
  ]) {
    const flat = JSON.stringify(projected).toLowerCase();
    for (const word of [...FORBIDDEN_KEYS, ...FORBIDDEN_SUBSTRINGS]) {
      assert.equal(flat.includes(word), false, `the source payload leaked ${word}`);
    }
    /* ★ AND THE THREE SPECIFIC STRINGS, named rather than left to the generic sweep. The
       third record above carries a real environment variable, a real vendor message and a
       count of our own attempts — the exact three things this surface will be asked to show
       the first time somebody wants it to explain itself. */
    assert.equal(flat.includes('reddit_client_secret'), false, 'a variable name reached the wire');
    assert.equal(flat.includes('500'), false, "a vendor's own message reached the wire");
    assert.equal(flat.includes('41'), false, 'a count of our own attempts reached the wire');
    assert.deepEqual(Object.keys(projected).sort(), ['label', 'lastHeardAt', 'sourceId', 'state']);
  }
});

test('★ a vendor name reaching the label is refused here, not rendered later', () => {
  /* The sharp edge of this whole feature: the PLATFORM is what a user is told, and whoever
     resells us their data is ours. The censor matches forbidden substrings against VALUES as
     well as keys, so a label naming a reseller throws at the projection — one pip withheld,
     printed — rather than reaching a tooltip in somebody's browser. */
  assert.throws(() => project({}, 'via apify'), WireLeakError);
});

/* ── rule 2: the word and the instant agree ───────────────────────────── */

test('the published state is the one core decided, not a second opinion', () => {
  /* Three records whose states differ, asserted against `sourceState`'s own contract. If this
     file ever grows its own ladder these keep passing and the two spellings drift silently,
     which is why the interesting assertions here are the ones below about what TRAVELS. */
  assert.equal(project().state, 'live');
  assert.equal(project({ configuration: 'dormant', lastSuccessAt: null }).state, 'dormant');
  assert.equal(project({ configuration: 'misconfigured', configurationDetail: 'x' }).state, 'failing');
});

test('★ a dormant source keeps its last-answered instant', () => {
  /* Dormant is not amnesia. "We turned this off this morning" and "this never worked" are
     different sentences, and dropping the instant on the dormant branch would collapse them
     one level further down — the same collapse the three states exist to prevent, one layer
     late. */
  const projected = project({ configuration: 'dormant', lastSuccessAt: T0 - 6 * HOUR });
  assert.equal(projected.state, 'dormant');
  assert.deepEqual(projected.lastHeardAt, { at: T0 - 6 * HOUR });
});

test('★ never having answered stays an ABSENCE, and never becomes an age', () => {
  /* The absent instant is what lets a surface say "has never answered" instead of inventing
     a duration. Backfilling it from `configuredAt` — the obvious available number — would
     turn "this credential has never worked" into "it answered when we configured it", which
     is precisely backwards. */
  const projected = project({ lastSuccessAt: null });
  assert.deepEqual(projected.lastHeardAt, { at: null, why: 'not_read_yet' });
  assert.notEqual(projected.state, 'live', 'and it is certainly not live');
});

test('★ a non-finite instant degrades to an absence AND to a non-live state, together', () => {
  /* Both halves read `lastSuccessAt`, so a corrupt row produces "has never answered, and that
     is a fault" rather than a green pip with a dash under it. Read from two different fields
     they could disagree, and the disagreement would land exactly where it hurts. */
  const projected = project({ lastSuccessAt: Number.NaN });
  assert.deepEqual(projected.lastHeardAt, { at: null, why: 'not_read_yet' });
  assert.notEqual(projected.state, 'live');
});

test('the instant and the state stay consistent across the freshness boundary', () => {
  /* Pinned here because the boundary is where a surface most easily contradicts itself: one
     millisecond either side, the published instant is the same shape and only the word
     changes. */
  const live = project({ lastSuccessAt: T0 - BAR });
  const dead = project({ lastSuccessAt: T0 - BAR - 1 });
  assert.equal(live.state, 'live');
  assert.equal(dead.state, 'failing');
  assert.deepEqual(live.lastHeardAt, { at: T0 - BAR });
  assert.deepEqual(dead.lastHeardAt, { at: T0 - BAR - 1 }, 'the instant is published either way');
});

/* ── rule 3: a label is somebody else's string ────────────────────────── */

test('★ an over-long label is truncated before it is stored, not before it is rendered', () => {
  /* Bounded at the projection, so no rewrite of the client can put an unbounded string into
     a 58px nav. Twelve code points and an ellipsis; the ellipsis is what makes the
     truncation visible rather than silent. */
  assert.equal(project({}, 'A'.repeat(400)).label, `${'A'.repeat(12)}…`);
});

test('a label of control and bidi characters comes back empty, never as a placeholder', () => {
  /* Empty is the honest answer and the caller drops the source rather than rendering a shape
     with no word beside it. Inventing "Source 2" would be inventing a fact, and a fiction is
     labelled a fiction or it is not shown. The bidi override in particular is what would
     otherwise let a label reorder the text around it in the nav. */
  assert.equal(project({}, '​‮  ').label, '');
});

test('an astral label is cut on characters, so no lone surrogate reaches jsonb', () => {
  /* `Array.from` iterates code points. A `.slice()` here could cut between the two halves of
     one emoji and leave a lone surrogate, which is not representable in UTF-8 — Postgres
     refuses the jsonb cast, the transaction rolls back, and it rolls back again on every
     subsequent run for as long as that source is declared. */
  const label = project({}, '\u{1F642}'.repeat(40)).label;
  assert.equal(Array.from(label).length, 13, 'twelve characters and the ellipsis');
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label), false, 'no lone surrogate');
});

test('the source id travels as the render key and is never confused with the label', () => {
  const projected = project({ source: sourceId('tiktok') }, 'TikTok');
  assert.equal(projected.sourceId, 'tiktok');
  assert.equal(projected.label, 'TikTok');
});

/* ── rule 4: the frame ────────────────────────────────────────────────── */

test('★ an empty frame is a real answer and is committed happily', () => {
  /* It means we ingest from nothing at all. It is not a loading state and it is not a
     failure, and nothing on the path from here to the screen may treat it as one — the read
     service answers 200 with it, and the surface reads it as "nothing is ingesting", which
     over a board full of rows is the most important sentence on the page. */
  assert.deepEqual(projectSourceFeed(7, []), { tick: 7, sources: [] });
});

test('★ the frame keeps the order it was given and never sorts by severity', () => {
  /* The obvious sort is "problems first" and it is wrong here. These are shapes somebody
     glances at dozens of times a day, and an order that moved when a state moved would mean
     the pip they looked at is not the pip that was there a moment ago. A fixed order is what
     lets a reader learn the positions once and afterwards read the shapes. */
  const live = project();
  const failing = project({ source: sourceId('tiktok'), lastSuccessAt: null }, 'TikTok');
  const frame = projectSourceFeed(2, [live, failing]);
  assert.deepEqual(
    frame.sources.map((s) => s.sourceId),
    ['reddit', 'tiktok'],
    'the failing source is not promoted to the front',
  );
});
