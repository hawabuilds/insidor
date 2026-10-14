/** ★ No coin or post score ever reaches alert text: every kind is fed facts poisoned with scores, and none comes out. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { ALERT_KINDS } from '@insidor/core';

import { alertText, cutWords, possessive, span } from './text.ts';

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
  assert.deepEqual(alertText('rising_post', POISON), { title: 'New on FYP', body: '@nordkyst_ferge: nice call 41K views' });
  assert.deepEqual(alertText('rising_post', { source: 'X', author: '@a', views: 41_000 }), { title: 'Rising on X', body: 'A post by @a: 41K views' }, 'facts queued before the new wording read as before');
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
  assert.match(
    alertText('retune_summary', { applied: true, coinMatchApplied: true, coinGoldN: 23, coinGoldProven: 7, coinGoldWrong: 0, coinGoldLikelyBefore: 0, coinGoldLikelyAfter: 1, coinLabelsN: 2, coinLabelsRightBefore: 1, coinLabelsRightAfter: 1, coinLabelsWrong: 0 }).body,
    /Coin matching refitted\. Held-out gold: 7\/23 proven, 0 wrong, likely 0→1\. Your coin labels: 1→1\/2 right, 0 wrong\.$/,
  );
  assert.match(alertText('retune_summary', { applied: true, coinMatchApplied: false, coinMatchWhy: 'the coin match could not be refitted: timeout' }).body, /Coin matching kept: the coin match could not be refitted: timeout\.$/);
  assert.doesNotMatch(alertText('retune_summary', { applied: true }).body, /Coin matching/, 'no coin refit in the facts, no sentence');
});

test('a re-tune summary counts the taps it tested as well as the ones it taught', () => {
  assert.match(alertText('retune_summary', { applied: false, taps: 58, tapsTested: 121, missed: 5, names: 0, added: 1, removed: 0 }).body, /From 58 taps \(121 more taps tested\), 5 missed posts/);
});

/* The owner's own examples (2026-10-14), word for word: the first line the title, the second the body. */
test("★ the owner's examples, exactly", () => {
  assert.deepEqual(alertText('rising_post', { author: '@rawsalerts', excerpt: 'Goliath at Six Flags closed after a man died yesterday', views: 751_000, gain: 38_000, gainMinutes: 5 }), {
    title: 'New on FYP',
    body: '@rawsalerts: Goliath at Six Flags closed after a man died… 751K views, +38K in 5m',
  });
  assert.deepEqual(alertText('fyp_coin', { symbol: 'GOLIATH', author: '@rawsalerts', launchedAfterMs: 33 * 60_000, mcUsd: 12_000 }), {
    title: 'Coin launched for this post',
    body: "$GOLIATH launched 33m after @rawsalerts' post. $12K MC. Tap to buy.",
  });
  assert.deepEqual(alertText('fyp_proven', { symbol: 'argon', author: '@OfficialLoganK', subject: 'Gemini 4 Argon', launchedAfterMs: 2 * 60_000, mcUsd: 4_100 }), {
    title: 'Coin links this post',
    body: "$argon links @OfficialLoganK's Gemini 4 Argon post. Launched 2m after. $4.1K MC.",
  });
  assert.deepEqual(alertText('watch_coin', { found: 'found', symbol: 'VOID', author: '@blackscats', excerpt: 'the void is falling', mcUsd: 86_000, change24h: 64.2 }), {
    title: 'Watchlist: coin found',
    body: '"the void is falling" (@blackscats) now has a coin: $VOID, $86K MC, up 64%.',
  });
  assert.deepEqual(alertText('watch_coin', { found: 'launched', symbol: 'FALCON', author: null, subject: 'SpaceX Falcon 9', ageMs: 60_000, mcUsd: 3_000 }), {
    title: 'Watchlist: coin launched',
    body: "$FALCON just launched for the SpaceX Falcon 9 post you're watching. 1m old, $3K MC.",
  });
  assert.deepEqual(alertText('story_post', { story: 'GTA 6', author: '@Rockstar', symbol: 'GTA', mcUsd: 410_000, mine: true }), {
    title: 'Coin for this story',
    body: 'GTA 6: new post from @Rockstar is on FYP. Your coin $GTA is $410K MC.',
  });
  assert.deepEqual(alertText('push_test', {}), { title: 'Test', body: 'Notifications are working.' });
});

test('a fact we do not have is left out of the sentence, never a 0 or a dash; one $ only', () => {
  assert.deepEqual(alertText('rising_post', { author: '@a', excerpt: 'short words', views: null }), { title: 'New on FYP', body: '@a: short words' });
  assert.deepEqual(alertText('rising_post', { author: '@a', excerpt: 'short words', views: 9_000, gain: 0, gainMinutes: 5 }), { title: 'New on FYP', body: '@a: short words 9K views' });
  assert.deepEqual(alertText('fyp_coin', { symbol: '$$GOLIATH', author: '@rawsalerts', launchedAfterMs: null }), { title: 'Coin found for this post', body: "$GOLIATH has the name of @rawsalerts' post. Tap to buy." });
  assert.deepEqual(alertText('fyp_coin', { symbol: 'OLD', author: '@cat', launchedAfterMs: -3 * 3_600_000, mcUsd: 2_500_000 }), { title: 'Coin found for this post', body: "$OLD launched 3h before @cat's post. $2.5M MC. Tap to buy." });
  assert.deepEqual(alertText('fyp_proven', { symbol: 'X1', author: '@dog' }), { title: 'Coin links this post', body: "$X1 links @dog's post." });
  assert.deepEqual(alertText('fyp_proven', { symbol: 'AKITA', author: '@nikkei', bio: true, launchedAfterMs: 72 * 60_000 }), { title: 'Coin links this post', body: "@nikkei's bio names $AKITA. Launched 1h after." }, 'a profile proof is said as the profile, never as a link');
  assert.deepEqual(alertText('watch_coin', { found: 'launched', symbol: 'NEW', author: '@dogs' }), { title: 'Watchlist: coin launched', body: "$NEW just launched for @dogs' post you're watching." });
  assert.deepEqual(alertText('watch_coin', { found: 'found', symbol: 'V', author: '@b' }), { title: 'Watchlist: coin found', body: "@b's post now has a coin: $V." });
  assert.deepEqual(alertText('story_post', { author: '@R', symbol: 'GTA' }), { title: 'Coin for this story', body: 'New post from @R is on FYP. Its coin $GTA.' });
  for (const kind of ['rising_post', 'fyp_coin', 'fyp_proven', 'story_post', 'watch_coin', 'push_test'] as const) {
    const { title, body } = alertText(kind, { symbol: 'A', author: '@b', excerpt: 'c' });
    assert.ok(!/·|\$\$|\b0 views|–|NaN|undefined|null/.test(`${title} ${body}`), `${kind}: ${title} / ${body}`);
  }
});

test('the small rules: possessive, cut words, spans', () => {
  assert.equal(possessive('@rawsalerts'), "@rawsalerts'");
  assert.equal(possessive('@Rockstar'), "@Rockstar's");
  assert.equal(cutWords('FORTNITE IS COMING TO LINUX • Easy Anti-Cheat\'s Linux support couldn\'t protect games…', 50), 'FORTNITE IS COMING TO LINUX • Easy Anti-Cheat\'s…');
  assert.equal(cutWords('was already cut by the feed…', 50), 'was already cut by the feed…');
  assert.equal(cutWords('   ', 50), null);
  assert.equal(span(20_000), '1m');
  assert.equal(span(33 * 60_000), '33m');
  assert.equal(span(5 * 3_600_000), '5h');
  assert.equal(span(72 * 3_600_000), '3d');
});
