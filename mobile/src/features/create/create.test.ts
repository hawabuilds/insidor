import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEV_BUY_DEFAULT, FIRST_SHEET, cleanTicker, costLine, devBuyLamports, feeRate, firstFill, firstLinks, otherIdeas, presetsWithin,
  shareOnX, suggestTicker, tickerCheck, tickerUseLine, useOfList, type Idea,
} from './create-form.ts';

const IDEAS: readonly Idea[] = [
  { name: 'Jimothy', ticker: 'JIM', use: { kind: 'free' } },
  { name: 'Raccoon', ticker: 'COON', use: { kind: 'taken', count: 3, more: false } },
  { name: 'Trash Panda', ticker: 'PANDA', use: { kind: 'unknown' } },
];

test('a short name suggests its last word, a long title its first', () => {
  assert.equal(suggestTicker('Grim Reaper'), 'REAPER');
  assert.equal(suggestTicker('Jimothy'), 'JIMOTHY');
  assert.equal(suggestTicker('Jimothy Heads To DC'), 'JIMOTHY');
});

test('a ticker is capitals and digits, ten at most', () => {
  assert.equal(cleanTicker('$fer-ry 2!'), 'FERRY2');
  assert.equal(cleanTicker('abcdefghijklmnop'), 'ABCDEFGHIJ');
  assert.equal(suggestTicker('  '), '');
});

test('the fields open on the top idea; with no ideas, on the title', () => {
  assert.deepEqual(firstFill(IDEAS, 'Jimothy Heads To DC'), { name: 'Jimothy', ticker: 'JIM' });
  assert.deepEqual(firstFill([], 'Jimothy Heads To DC'), { name: 'Jimothy Heads To DC', ticker: 'JIMOTHY' });
});

test('the chips are the other ideas: the one in the fields is not repeated, the server order is kept', () => {
  assert.deepEqual(otherIdeas(IDEAS, 'JIM').map((i) => i.ticker), ['COON', 'PANDA']);
  assert.deepEqual(otherIdeas(IDEAS, 'COON').map((i) => i.ticker), ['JIM', 'PANDA']);
  assert.deepEqual(otherIdeas(IDEAS, 'TYPED').map((i) => i.ticker), ['JIM', 'COON', 'PANDA']);
  assert.deepEqual(otherIdeas([], 'JIM'), []);
});

test('★ the ticker line: Free only when every source answered, Taken opens the list, never Free on an outage', () => {
  assert.deepEqual(tickerCheck('JIM', { kind: 'read', use: { kind: 'free' } }), { text: 'Free', opens: false });
  assert.deepEqual(tickerCheck('JIM', { kind: 'read', use: { kind: 'taken', count: 3, more: false } }), { text: 'Taken by 3 coins', opens: true });
  assert.deepEqual(tickerCheck('JIM', { kind: 'read', use: { kind: 'unknown' } }), { text: "Couldn't check", opens: false });
  assert.deepEqual(tickerCheck('JIM', { kind: 'failed' }), { text: "Couldn't check", opens: false });
  assert.deepEqual(tickerCheck('JIM', { kind: 'checking' }), { text: 'Checking', opens: false });
  assert.deepEqual(tickerCheck('', { kind: 'checking' }), { text: 'Pick a ticker', opens: false });
});

test('a typed ticker gets the server rule from its coin list', () => {
  assert.deepEqual(useOfList({ items: [], more: false, sourcesMissing: 0 }), { kind: 'free' });
  assert.deepEqual(useOfList({ items: [], more: false, sourcesMissing: 1 }), { kind: 'unknown' });
  assert.deepEqual(useOfList({ items: [1, 2], more: true, sourcesMissing: 1 }), { kind: 'taken', count: 2, more: true });
});

test('the ticker words in the server\'s three answers', () => {
  assert.equal(tickerUseLine({ kind: 'free' }), 'Free');
  assert.equal(tickerUseLine({ kind: 'unknown' }), "Couldn't check");
  assert.equal(tickerUseLine({ kind: 'taken', count: 1, more: false }), 'Taken by 1 coin');
  assert.equal(tickerUseLine({ kind: 'taken', count: 10, more: true }), 'Taken by 10+ coins');
});

test('★ dev buy presets are Trador\'s 0, 0.5, 1, 2, start at 0, and one above the cap is not offered', () => {
  assert.equal(DEV_BUY_DEFAULT, 0);
  assert.deepEqual(presetsWithin(2_000_000_000n), [0, 0.5, 1, 2]);
  assert.deepEqual(presetsWithin(1_000_000_000n), [0, 0.5, 1]);
  assert.deepEqual(presetsWithin(0n), [0]);
});

test('a typed dev buy wins over the preset, and anything not an amount of SOL is refused', () => {
  assert.equal(devBuyLamports(0, ''), 0n);
  assert.equal(devBuyLamports(0.5, ''), 500_000_000n);
  assert.equal(devBuyLamports(2, '0.25'), 250_000_000n);
  assert.equal(devBuyLamports(1, '0'), 0n);
  assert.equal(devBuyLamports(0, '1.2.3'), null);
  assert.equal(devBuyLamports(0, '0.0000000001'), null);
});

test('★ the cost line is the measured sum, or a dash with a reason, never a guess', () => {
  assert.equal(costLine({ kind: 'measured', lamports: [5_000, 4_000_000, 2_000_000] }), 'Launch cost about 0.0060 SOL');
  assert.equal(costLine({ kind: 'measuring' }), 'Launch cost — measuring');
  assert.equal(costLine({ kind: 'unread' }), "Launch cost — couldn't be read");
  assert.equal(costLine({ kind: 'signed-out' }), 'Launch cost — sign in to see it');
  assert.equal(costLine({ kind: 'off' }), 'Launch cost — not live yet');
});

test('★ More options start closed', () => {
  assert.equal(FIRST_SHEET.more, false);
  assert.equal(FIRST_SHEET.coinsOpen, false);
});

test('the post link is prefilled as the X link when the post is on X, else as the website', () => {
  assert.deepEqual(firstLinks('https://x.com/a/status/1'), { twitter: 'https://x.com/a/status/1', telegram: '', website: '' });
  assert.deepEqual(firstLinks('https://www.reddit.com/r/a/comments/b'), { twitter: '', telegram: '', website: 'https://www.reddit.com/r/a/comments/b' });
  assert.deepEqual(firstLinks(null), { twitter: '', telegram: '', website: '' });
});

test('Share on X carries the coin\'s page', () => {
  const url = shareOnX('JIM', 'https://insidor.app/#/token/solana%3Aabc');
  assert.ok(url.startsWith('https://x.com/intent/post?text='));
  assert.ok(url.includes(`url=${encodeURIComponent('https://insidor.app/#/token/solana%3Aabc')}`));
});

test('★ the creator fee is written from the chain\'s number, never a constant', () => {
  assert.equal(feeRate(30), '0.30% of every trade');
  assert.equal(feeRate(55), '0.55% of every trade');
});

test('★ TRADING off means no create path: the sheet is the Coming soon one', async () => {
  const { tradingOn } = await import('../../shared/trading.ts');
  assert.equal(tradingOn({}), false);
  assert.equal(tradingOn({ VITE_TRADING: 'yes' }), false);
});
