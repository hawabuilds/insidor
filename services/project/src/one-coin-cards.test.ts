/**
 * The live card's coin line: the pick with its facts and "Coin for this post", or Create — with the
 * same-name count kept for the owner only — and a post not judged yet left as its search left it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { liveCoinLine, type CardPick } from './one-coin-cards.ts';
import type { WireCoin, WirePostCoinLink } from './wire.ts';

const coin = { address: 'PICK', ticker: 'PAN' } as unknown as WireCoin;
const unsure: WirePostCoinLink = { kind: 'unsure', claimCount: 4 };
const picked = (o: Partial<CardPick> = {}): CardPick => ({ address: 'PICK', outcome: 'picked', ties: ['link', 'name_judge'], launchedAfterMs: 120_000, ...o });

test('★ a picked coin is the card\'s one coin, with the facts that hold and "picked"', () => {
  const line = liveCoinLine(unsure, picked(), coin, { count: 4, more: false }, new Set());
  assert.deepEqual(line, { kind: 'matched', coin, evidence: { linksPost: true, samePicture: null, launchedAfterMs: 120_000, picked: true } });
});

test('★ no pick is Create: the count only for the owner, none when nothing uses the name', () => {
  assert.deepEqual(liveCoinLine(unsure, picked({ outcome: 'waiting', address: null }), null, { count: 4, more: true }, new Set()), { kind: 'unsure', claimCount: 4, more: true });
  assert.deepEqual(liveCoinLine({ kind: 'none' }, picked({ outcome: 'none', address: null }), null, { count: 0, more: false }, new Set()), { kind: 'none' });
  /* A proven coin by today's evidence that the rule did not pick is not shown: the pick is the coin. */
  const proven: WirePostCoinLink = { kind: 'matched', coin, evidence: { linksPost: true, samePicture: null, launchedAfterMs: 1 } };
  assert.equal(liveCoinLine(proven, picked({ outcome: 'waiting', address: null }), null, { count: 2, more: false }, new Set()).kind, 'unsure');
});

test('a coin the owner called wrong is never the pick shown; a coin we cannot project waits', () => {
  assert.equal(liveCoinLine(unsure, picked(), coin, { count: 4, more: false }, new Set(['PICK'])).kind, 'unsure');
  assert.equal(liveCoinLine(unsure, picked(), null, { count: 4, more: false }, new Set()).kind, 'unsure');
});

test('a post not judged yet keeps "still checking" and "Couldn\'t check"; never a guessed Create', () => {
  assert.deepEqual(liveCoinLine({ kind: 'pending' }, undefined, null, { count: 0, more: false }, new Set()), { kind: 'pending' });
  assert.deepEqual(liveCoinLine({ kind: 'unchecked' }, undefined, null, { count: 0, more: false }, new Set()), { kind: 'unchecked' });
});
