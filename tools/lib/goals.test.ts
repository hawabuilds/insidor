/**
 * The goals scorecard's arithmetic on made-up rows: the speed shares, "before the coin" counting only
 * chain-timed launches, quality kept apart from coins, the owner's calls against the +1 h coin,
 * pushes about us kept apart, the cost parts, and the trend's plain words. The SQL is exercised by
 * running tools/goals.ts against the database.
 * Run: node --test --experimental-strip-types tools/lib/goals.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { costPartOf, cut, goalLines, median, SECTIONS, trendWords, type FypRow, type GoalRows, type RanRow } from './goals.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 20, 19, 0);
const TODAY = Date.UTC(2026, 9, 20);
const none: GoalRows = { fyp: [], ran: [], match: [], pushes: [], spend: [] };
const fyp = (over: Partial<FypRow>): FypRow => ({ itemId: 'x:1', source: 'x', postedAtMs: 0, shownAtMs: 10 * MIN, label: null, gold: false, laterRan: false, ...over });
const ran = (over: Partial<RanRow>): RanRow => ({ itemId: 'x:1', coinAtMs: 60 * MIN, clock: 'chain', shownAtMs: null, ...over });
const line = (label: string) => {
  const l = SECTIONS.flatMap((s) => s.lines).find((x) => x.label === label);
  assert.ok(l, label);
  return l;
};

test('speed: median minutes from posting to For You, and the share within 15 / 30 / 60, each source apart', () => {
  const rows: GoalRows = { ...none, fyp: [fyp({ shownAtMs: 10 * MIN }), fyp({ shownAtMs: 20 * MIN }), fyp({ shownAtMs: 90 * MIN }), fyp({ source: 'tiktok', shownAtMs: 5 * MIN }), fyp({ postedAtMs: null })] };
  assert.equal(line('X: median minutes, posted to For You').cell(rows).text, '20 min');
  assert.equal(line('X: on For You within 15 min').cell(rows).text, '33% of 3', 'a post with no posted time is out of the share, never counted slow');
  assert.equal(line('X: on For You within 60 min').cell(rows).text, '67% of 3');
  assert.equal(line('TikTok: on For You within 15 min').cell(rows).text, '100% of 1');
  assert.equal(line('TikTok: median minutes, posted to For You').cell(none).text, '— (none)');
});

test('before the coin: only chain-timed launches decide "before", and the head start is theirs', () => {
  const rows: GoalRows = { ...none, ran: [ran({ shownAtMs: 30 * MIN }), ran({ shownAtMs: 90 * MIN }), ran({ shownAtMs: null }), ran({ clock: 'unknown', shownAtMs: 0 })] };
  assert.equal(line('posts whose coin ran').cell(rows).text, '4');
  assert.equal(line('on For You at all (before or after)').cell(rows).text, '75% of 4');
  assert.equal(line('on For You before the coin launched').cell(rows).text, '33% of 3', 'the second-hand launch time is left out, not guessed');
  assert.equal(line('median head start').cell(rows).text, '30 min');
});

test('quality is memeable, never coined: the coin share is its own line', () => {
  const rows: GoalRows = { ...none, fyp: [fyp({ label: 'not', gold: true }), fyp({ label: 'meme' }), fyp({ gold: true }), fyp({ laterRan: true })] };
  assert.equal(line('you tapped "Not a meme"').cell(rows).text, '25% of 4');
  assert.equal(line('you marked memeable (meme tap or gold sheet)').cell(rows).text, '50% of 4', 'his later "not" outweighs a gold sheet');
  assert.equal(line('for information: later got a coin that ran').cell(rows).text, '25% of 4');
  assert.equal(line('for information: later got a coin that ran').better, null, 'never scored better or worse');
});

test('coin match: the owner\'s calls, and the +1 h coin only where he made none', () => {
  const rows: GoalRows = {
    ...none,
    match: [
      { decidedAtMs: 0, verdict: 'right', plus1h: null },
      { decidedAtMs: 0, verdict: 'wrong', plus1h: null },
      { decidedAtMs: 0, verdict: 'never_weighed', plus1h: null },
      { decidedAtMs: 0, verdict: null, plus1h: true },
      { decidedAtMs: 0, verdict: null, plus1h: false },
      { decidedAtMs: 0, verdict: null, plus1h: null },
    ],
  };
  assert.equal(line('your calls: right / wrong / no pick').cell(rows).text, '1 / 1 / 1');
  assert.equal(line('no call: picked the biggest coin at +1h').cell(rows).text, '50% of 2', 'a pick with no +1 h reading is not measured');
});

test('notifications: pushes about us are apart, and per person is per person', () => {
  const rows: GoalRows = { ...none, pushes: [{ atMs: 0, userId: 'a', system: false, ran: true }, { atMs: 0, userId: 'a', system: false, ran: false }, { atMs: 0, userId: 'b', system: false, ran: false }, { atMs: 0, userId: 'a', system: true, ran: false }] };
  assert.equal(line('pushes about posts and coins').cell(rows).text, '3');
  assert.equal(line('per person').cell(rows).text, '1.5 (2 people)');
  assert.equal(line('about a coin that ran').cell(rows).text, '33% of 3');
  assert.equal(line('system notices (outages, suppliers, re-tunes, tests)').cell(rows).text, '1');
});

test('cost: each supplier in its part, anything unknown still in the total', () => {
  assert.equal(costPartOf('twitterapi.io'), 'x');
  assert.equal(costPartOf('together'), 'judge');
  assert.equal(costPartOf('scrapecreators'), 'tiktok');
  assert.equal(costPartOf('embed-service'), 'pictures');
  assert.equal(costPartOf('someone-new'), 'other');
  const rows: GoalRows = { ...none, spend: [{ dayMs: 0, part: 'x', usd: 2 }, { dayMs: 0, part: 'other', usd: 1.5 }] };
  assert.equal(line('X').cell(rows).text, '$2.00');
  assert.equal(line('total (with anything else)').cell(rows).text, '$3.50');
});

test('the trend: plain words, shares by points, sums as a day\'s average, and today never in it', () => {
  assert.equal(trendWords('minutes', 'down', { v: 30, text: '30 min' }, { v: 20, text: '20 min' }), 'better (30 min → 20 min)');
  assert.equal(trendWords('share', 'up', { v: 0.2, text: '20% of 10' }, { v: 0.22, text: '22% of 9' }), 'about the same (20% → 22%)');
  assert.equal(trendWords('share', 'down', { v: 0.2, text: '20% of 10' }, { v: 0.4, text: '40% of 9' }), 'worse (20% → 40%)');
  assert.equal(trendWords('usd', 'down', { v: 30, text: '$30.00' }, { v: 60, text: '$60.00' }), 'worse ($10.00 → $20.00 a day)');
  assert.equal(trendWords('count', null, { v: 3, text: '3' }, { v: 30, text: '30' }), 'up (1 → 10 a day)');
  assert.equal(trendWords('share', 'up', { v: null, text: '—' }, { v: 0.5, text: '50%' }), '— (not enough days)');

  /* Three slow posts in the earlier days, three fast in the later; today's very slow post is left out. */
  const rows: GoalRows = {
    ...none,
    fyp: [
      ...[6, 5, 4].map((d) => fyp({ postedAtMs: TODAY - d * DAY, shownAtMs: TODAY - d * DAY + 100 * MIN })),
      ...[3, 2, 1].map((d) => fyp({ postedAtMs: TODAY - d * DAY, shownAtMs: TODAY - d * DAY + 10 * MIN })),
      fyp({ postedAtMs: TODAY, shownAtMs: TODAY + 600 * MIN }),
    ],
  };
  const out = goalLines(rows, NOW);
  const speed = out.find((l) => l.startsWith('X: median minutes'));
  assert.ok(speed?.includes('600 min'), 'today is shown as a column');
  assert.ok(speed?.endsWith('better (100 min → 10 min)'));
  assert.ok(out[1]?.includes('10-20 so far'));
  assert.equal(cut(rows, TODAY, TODAY + DAY).fyp.length, 1);
});

test('median of an even count is the middle two\'s mean', () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});
