/**
 * The funnel's order on made-up posts: each post lands at the first step that lost it, the
 * deadline is the first coin or 20% of the line, and an answer is held to its own block's cutoff.
 * The SQL is exercised by running tools/scorecard.ts against the database.
 * Run: node --test --experimental-strip-types tools/lib/funnel.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '../../contracts/src/policy.ts';
import { funnelDay, place, type FunnelAnswer, type FunnelPost } from './funnel.ts';

const M = 60_000;
const H = 60 * M;
const yes = (atMs: number, confidence = 0.95): FunnelAnswer => ({ atMs, judgeId: 'judge:anthropic/claude-haiku-4-5@x', kind: false, coinable: true, confidence, lookedAt: 'text', proposedName: 'CAT' });
/* Posted at 0, 30k views at 10 minutes (clears the early growth path), 100k at 2 h (20% of the X line), 600k at 6 h. */
const post = (over: Partial<FunnelPost>): FunnelPost => ({
  itemId: 'x:1', source: 'x', postedAtMs: 0, why: ['coined'],
  reach: [{ atMs: 10 * M, reach: 30_000 }, { atMs: 2 * H, reach: 100_000 }, { atMs: 6 * H, reach: 600_000 }],
  foundAtMs: 5 * M, lanes: ['all'], coinAtMs: null, answers: [yes(12 * M)], shownAtMs: 15 * M, ...over,
});

test('a post every gate passed in time is shown early; one shown after its deadline is "other"', () => {
  assert.equal(place(post({}), []).step, 'shown early');
  assert.equal(place(post({ shownAtMs: 3 * H }), []).step, 'other');
  assert.equal(place(post({ shownAtMs: null }), []).step, 'other');
});

test('never found: no search lane, and a coin link is not a find', () => {
  assert.equal(place(post({ foundAtMs: null, lanes: [] }), []).step, 'never found');
  assert.match(place(post({ foundAtMs: null, lanes: ['coin_link'] }), []).detail, /coin_link/);
});

test('found too late: after its first coin, or already at 20% of the line when found', () => {
  assert.equal(place(post({ coinAtMs: 4 * M }), []).step, 'found too late');
  assert.equal(place(post({ foundAtMs: 2 * H }), []).step, 'found too late');
});

test('★ the first step that lost it counts: a post the views bar held is not the judge\'s, even with no answer', () => {
  const slow = post({ reach: [{ atMs: 3 * H, reach: 100_000 }, { atMs: 9 * H, reach: 600_000 }], answers: [] });
  assert.equal(place(slow, []).step, 'views bar');
  assert.equal(place(post({ answers: [] }), []).step, 'judge said no');
  assert.equal(place(post({ answers: [{ ...yes(12 * M), coinable: false }] }), []).step, 'judge said no');
  assert.equal(place(post({ answers: [yes(3 * H)] }), []).step, 'judge said no');
});

test('★ an answer is held to the block applied when it was given, and a held kind holds it', () => {
  const at = post({ answers: [yes(12 * M, 0.8)] });
  assert.equal(place(at, []).step, 'shown early');
  assert.equal(place(at, [{ atMs: 0, cutoff: 0.9, chosenOn: null }]).step, 'judge said no');
  assert.equal(place(at, [{ atMs: 20 * M, cutoff: 0.9, chosenOn: null }]).step, 'shown early');
  const sport: FunnelAnswer = { ...yes(13 * M), kind: true, proposedName: P.judge.heldKinds[0] ?? 'AD' };
  assert.equal(place(post({ answers: [yes(12 * M), sport] }), []).step, 'judge said no');
});

test('a day counts every step, zeros included', () => {
  const d = funnelDay('d', [place(post({}), []), place(post({ foundAtMs: null, lanes: [] }), [])]);
  assert.equal(d.n, 2);
  assert.equal(d.counts['shown early'], 1);
  assert.equal(d.counts['never found'], 1);
  assert.equal(d.counts['views bar'], 0);
});
