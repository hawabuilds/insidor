/** ★ No coin or post score ever reaches alert text: every kind is fed facts poisoned with scores, and none comes out. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ALERT_KINDS } from '@insidor/core';

import { alertText } from './text.ts';

const POISON = { score: 0.97, confidence: 0.88, memeScore: 91, heat: 7.5, probability: 0.61, rank: 'goat', who: '@hawa', excerpt: 'nice call', symbol: 'FERRY', multiple: 5, positionUsd: 1234.5, percent: 92.4, source: 'X', author: '@nordkyst_ferge', views: 41_000, title: 'Ferry horn goes viral' };
const FORBIDDEN = [/0\.97/, /0\.88/, /\b91\b/, /7\.5/, /0\.61/, /score/i, /confidence/i, /probab/i, /heat/i, /pump/i, /moon/i, /will\b/i];

test('★ every alert kind reads only its own facts: no score, probability or prediction gets through', () => {
  for (const kind of ALERT_KINDS) {
    const { title, body } = alertText(kind, POISON);
    for (const bad of FORBIDDEN) assert.ok(!bad.test(`${title} ${body}`), `${kind}: "${title} / ${body}" matched ${bad}`);
  }
});

test('the facts read as facts', () => {
  assert.deepEqual(alertText('holding_multiple', POISON), { title: '$FERRY is up 5x since you bought', body: 'Your position is worth $1.2K' });
  assert.deepEqual(alertText('graduating_soon', POISON), { title: '$FERRY is close to graduating', body: '92% of the way through its curve' });
  assert.deepEqual(alertText('rising_post', POISON), { title: 'Rising on X', body: 'A post by @nordkyst_ferge: 41K views' });
  assert.deepEqual(alertText('rank_up', { rank: 'analyst' }), { title: 'You reached Analyst', body: 'Holders liked your calls.' });
  assert.deepEqual(alertText('comment_useful', { count: 3, excerpt: 'FERRY has a horn now' }), { title: '3 people found your comment useful', body: 'FERRY has a horn now' });
  assert.deepEqual(alertText('post_coin', { symbol: 'FERRY', author: '@ferrycat', excerpt: 'the ferry cat' }), { title: '$FERRY is proven from a post you watch', body: 'A post by @ferrycat: the ferry cat' });
  assert.deepEqual(alertText('comment_useful', { count: 1 }), { title: 'Someone found your comment useful', body: 'A holder liked your comment.' });
  assert.deepEqual(alertText('rising_post', {}), { title: 'Rising on social', body: 'A post by someone is rising.' }, 'a missing fact is said plainly, never a zero');
});

test("a supplier warning names the role and the money, and says so plainly when a number is missing", () => {
  assert.deepEqual(alertText('supplier_warning', { role: 'judge', share: 0.8, spentUsd: 6.4, capUsd: 8 }), { title: 'Judge at 80% of its daily line', body: '$6.40 of $8.00 spent today (UTC).' });
  assert.deepEqual(alertText('supplier_warning', { role: 'short video', share: 0.95, spentUsd: 2.86, capUsd: 3 }), { title: 'Short video at 95% of its daily line', body: '$2.86 of $3.00 spent today (UTC).' });
  assert.deepEqual(alertText('supplier_account', { supplier: 'Anthropic', uses: 'the judge', reason: 'credit balance too low', state: 'refused' }), {
    title: 'Anthropic out of credit (the judge)',
    body: 'Anthropic refused a call for billing: credit balance too low. Top up its account; work using it is paused until then.',
  });
  assert.deepEqual(alertText('supplier_account', { supplier: 'Apify', uses: 'short videos', state: 'recovered' }), {
    title: 'Apify is answering again',
    body: 'Apify (short videos) accepted a call again; work using it has resumed.',
  });
  assert.deepEqual(alertText('supplier_account', {}).title, 'A supplier out of credit');
  assert.deepEqual(alertText('supplier_warning', {}), { title: 'A supplier at a warning share of its daily line', body: 'Its spend today reached that share of the line.' });
});

test("a re-tune summary says applied or kept, each test as passed-of-tested, and a dash for a test nobody could run", () => {
  assert.deepEqual(alertText('retune_summary', { applied: true, goldPassed: 30, goldN: 41, negativePassed: 1, negativeN: 90, missedPassed: 3, missedN: 4, taps: 5, missed: 2, names: 1, added: 6, removed: 2 }), {
    title: 'Judge examples updated',
    body: 'Hand gold 30/41, live non-memes 1/90, missed 3/4 passed. From 5 taps, 2 missed posts, 1 name calls; +6 −2 examples.',
  });
  assert.deepEqual(alertText('retune_summary', { applied: false, goldPassed: 20, goldN: 41, negativePassed: 0, negativeN: 90, missedPassed: 0, missedN: 0, taps: 1, missed: 0, names: 0, added: 1, removed: 0, why: 'gold 20/41 is under 65%' }), {
    title: 'Judge examples kept',
    body: 'Hand gold 20/41, live non-memes 0/90, missed – passed. From 1 taps, 0 missed posts, 0 name calls; +1 −0 examples. Kept the current examples: gold 20/41 is under 65%.',
  });
  assert.deepEqual(
    alertText('retune_summary', { applied: false, goldPassed: 30, goldN: 41, negativePassed: 1, negativeN: 90, missedPassed: 3, missedN: 4, autoPassed: 40, autoN: 77, regressions: 1, taps: 1, missed: 0, names: 0, added: 1, removed: 0, why: '1 missed post caught now would fail: x:1' }).body,
    'Hand gold 30/41, live non-memes 1/90, missed 3/4 passed. Auto gold 40/77 (not a gate). 1 missed post caught now would fail. From 1 taps, 0 missed posts, 0 name calls; +1 −0 examples. Kept the current examples: 1 missed post caught now would fail: x:1.',
  );
  assert.match(alertText('retune_summary', { applied: true, missReasons: { never_found: 2, rejected: 1 } }).body, /Missed today: never found 2, rejected 1\.$/);
});

test("a re-tune summary carries the order model's refit: each signal's weight, and each held-out group before and after", () => {
  const order = {
    orderApplied: false, orderWhy: 'held-out gold is put above a non-meme 65% of the time, against 77% with today\'s rules',
    orderSignals: [{ signal: 'looked_picture', weight: -2.13 }, { signal: 'judge_held_kind', weight: -1.49 }, { signal: 'picture', weight: 0.79 }],
    orderHandBefore: 3, orderHandAfter: 3, orderHandN: 3, orderNegBefore: 22, orderNegAfter: 22, orderNegN: 48, orderMissedBefore: 0, orderMissedAfter: 0, orderMissedN: 0,
  };
  assert.match(
    alertText('retune_summary', { applied: true, ...order }).body,
    / Order model kept \(held-out gold is put above a non-meme 65% of the time, against 77% with today's rules\)\. Signals: judged on picture -2\.13, held kind -1\.49, picture match \+0\.79\. Held out: hand gold 3→3\/3, non-memes 22→22\/48, missed –\.$/,
  );
  assert.match(alertText('retune_summary', { applied: true, orderApplied: true, orderSignals: [] }).body, /Order model updated\. Signals: –\./);
  assert.match(alertText('retune_summary', { applied: true, orderApplied: false, orderWhy: 'the order model could not be fitted: timeout' }).body, /Order model kept: the order model could not be fitted: timeout\.$/);
  assert.doesNotMatch(alertText('retune_summary', { applied: true }).body, /Order model/, 'no refit in the facts, no sentence');
});

test('a re-tune summary counts the taps it tested as well as the ones it taught', () => {
  assert.match(alertText('retune_summary', { applied: false, taps: 58, tapsTested: 121, missed: 5, names: 0, added: 1, removed: 0 }).body, /From 58 taps \(121 more taps tested\), 5 missed posts/);
});
