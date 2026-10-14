import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoin, decodeCoinLink } from './api/decode.ts';
import { coinStatus, evidenceFacts, oneCoinLine, postCoinStatus, seeCoinsLabel, settledCoins } from './coin-status.ts';

const coin = (over: Record<string, unknown> = {}) =>
  decodeCoin({
    coinId: 'c', ticker: 'FERRY', name: 'Ferry', address: 'SAMPLE', venueLabel: 'pump.fun', imageUrl: null,
    mintedAt: { at: null }, priceUsd: { v: 1 }, marketCapUsd: { v: 1 }, marketCapBasis: null,
    liquidityUsd: { v: null }, priceChange24h: { v: null }, tradable: true, ...over,
  });

test('no coin offers to create one', () => {
  assert.deepEqual(coinStatus({ kind: 'none' }), { line: 'No coin yet', action: { kind: 'create' } });
});

test('an unsure match has no button at all, and says why', () => {
  const s = coinStatus({ kind: 'unsure', claimCount: 4 });
  assert.equal(s.action, null);
  assert.match(s.line, /can't tell/);
});

test('one coin is a buy only when the server says it can be traded', () => {
  assert.equal(coinStatus({ kind: 'one', coin: coin() }).action?.kind, 'buy');
  assert.equal(coinStatus({ kind: 'one', coin: coin({ tradable: false }) }).action, null);
});

test('several coins are something to look at, never a buy of one of them', () => {
  const s = coinStatus({ kind: 'several', coins: [coin(), coin({ coinId: 'd' })] });
  assert.deepEqual(s, { line: '2 coins on pump.fun', action: { kind: 'view', count: 2 } });
});

test('an unsure match gives up no coin', () => {
  assert.deepEqual(settledCoins({ kind: 'unsure', claimCount: 9 }), []);
});

test('★ before the name has been searched there is no "No coin yet" and no Create, only a dash', () => {
  const s = coinStatus(decodeCoinLink({ kind: 'pending' }));
  assert.equal(s.action, null);
  assert.match(s.line, /^— /);
  assert.doesNotMatch(s.line, /No coin yet/);
});

test('a post\'s confident coin line: ticker and market cap; an unread cap is left out, never "$0"', () => {
  assert.equal(oneCoinLine(coin({ marketCapUsd: { v: 42_000 } })), '$FERRY, $42K market cap');
  assert.equal(oneCoinLine(coin({ marketCapUsd: { v: null, why: 'no_market' } })), '$FERRY');
  assert.equal(oneCoinLine(coin({ tradable: false })), "$FERRY, $1 market cap, can't be traded yet");
});

test('★ a post that could not be checked says so, with no button: no Create, no guess', () => {
  assert.deepEqual(coinStatus({ kind: 'unchecked' }), { line: "Couldn't check", action: null });
});

/* ── the For You card's four states (postCoinStatus) ── */

test('★ a confident match on a post card: Buy, with the ticker and market cap on the line', () => {
  const s = postCoinStatus({ kind: 'one', coin: coin({ marketCapUsd: { v: 42_000 } }) });
  assert.equal(s.line, '$FERRY, $42K market cap');
  assert.deepEqual(s.actions.map((a) => a.kind), ['buy']);
});

test('★ an unsure post card keeps its sentence and offers "See N coins" and Create, never Buy', () => {
  const s = postCoinStatus({ kind: 'unsure', claimCount: 3 });
  assert.equal(s.line, "3 coins use this name. We can't tell which one came from here.");
  assert.deepEqual(s.actions, [{ kind: 'see', count: 3, more: false }, { kind: 'create' }]);
  assert.equal(s.actions.some((a) => a.kind === 'buy'), false);
});

test('★ a count the search cut short is said as "10+", on the line and on the button', () => {
  const s = postCoinStatus(decodeCoinLink({ kind: 'unsure', claimCount: 10, more: true }));
  assert.match(s.line, /^10\+ coins use this name/);
  assert.deepEqual(s.actions[0], { kind: 'see', count: 10, more: true });
  assert.equal(seeCoinsLabel(10, true), 'See 10+ coins');
  assert.equal(seeCoinsLabel(3, false), 'See 3 coins');
  assert.equal(seeCoinsLabel(1, false), 'See 1 coin');
});

test('★ no coin on a post card: "No coin yet" and Create; not looked up yet: a dash and nothing', () => {
  assert.deepEqual(postCoinStatus({ kind: 'none' }), { line: 'No coin yet', actions: [{ kind: 'create' }] });
  const pending = postCoinStatus({ kind: 'pending' });
  assert.match(pending.line, /^— /);
  assert.deepEqual(pending.actions, []);
  assert.deepEqual(postCoinStatus({ kind: 'unchecked' }), { line: "Couldn't check", actions: [] });
});

test('a narrative\'s unsure line still has no button: the list is a feed card\'s', () => {
  assert.equal(coinStatus({ kind: 'unsure', claimCount: 3 }).action, null);
});

test("a post's own coin shows its line, Buy, and why as facts only — an unknown is never said", () => {
  const status = postCoinStatus({ kind: 'matched', coin: coin(), evidence: { linksPost: true, samePicture: null, launchedAfterMs: 720_000 } });
  assert.deepEqual(status.actions.map((a) => a.kind), ['buy']);
  assert.deepEqual(status.facts, ['Links this post', 'Launched 12m after']);
  assert.deepEqual(evidenceFacts({ linksPost: false, samePicture: true, launchedAfterMs: -7_200_000 }), ['Same picture', 'Launched 2h before']);
  assert.deepEqual(postCoinStatus({ kind: 'matched', coin: coin({ tradable: false }), evidence: { linksPost: null, samePicture: null, launchedAfterMs: null } }).actions, []);
});

test('★ the owner\'s coin for the story says "Coin for this story", never "Links this post" unless the post proves it', () => {
  assert.deepEqual(evidenceFacts({ linksPost: null, samePicture: null, launchedAfterMs: 720_000, storyCoin: true }), ['Coin for this story', 'Launched 12m after']);
  assert.deepEqual(evidenceFacts({ linksPost: true, samePicture: null, launchedAfterMs: null, storyCoin: true }), ['Links this post']);
});

test("a coin the poster's own profile names says so, as a fact beside the others", async () => {
  const { decodeCoinEvidence } = await import('./api/decode.ts');
  const e = decodeCoinEvidence({ linksPost: null, samePicture: null, launchedAfterMs: 3_600_000, posterBioNamesCoin: true });
  assert.deepEqual(evidenceFacts(e), ["The poster's bio names this coin", 'Launched 1h after']);
  assert.equal(decodeCoinEvidence({ linksPost: null, samePicture: null, launchedAfterMs: null, posterBioNamesCoin: false }).posterBio, undefined, 'only a literal true is said');
});
