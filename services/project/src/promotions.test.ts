/**
 * A promotion's coin on its original: carried on the card where the original has no pick of its own,
 * one coin an original (running first, then the first launched), an old original only while running;
 * and the running route pulling the original back in the promotion's place.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Db } from '@insidor/store';

import type { CardPick } from './one-coin-cards.ts';
import { carriedBy, carriedPick, withCarried, type PromotedPick } from './promotions.ts';
import { loadRunningPicks } from './running-picks.ts';

const NOW = Date.UTC(2026, 9, 24, 13, 34);
const MIN = 60_000;
const DAY = 1_440 * MIN;
const LIGHT_BABY = 'x:2111846924005327220';
const INFINITIDIGITS = 'x:2113969117409534379';
const BI = '9f2geiAhhEy1KFFTFpeBTa7oLPHrcXxr7ksDShDpump';

/* @Infinitidigits' quote of @prtygal777's "Light Baby" (69M views, 18 Oct), picked $BI (launched 24 Oct 12:27). */
const promoted = (o: Partial<PromotedPick> = {}): PromotedPick => ({
  promoId: INFINITIDIGITS,
  original: { itemId: LIGHT_BABY, authorKey: 'x:prtygal777', reach: 69_258_087, postedAtMs: Date.UTC(2026, 9, 18, 15, 48) },
  address: BI,
  launchedAtMs: Date.UTC(2026, 9, 24, 12, 27),
  age: 'old',
  revives: true,
  originalJudgedYes: true,
  ...o,
});

test('★ an old original carries the coin only while it runs; a young one always', () => {
  assert.equal(carriedBy([promoted()]).get(LIGHT_BABY)?.address, BI);
  assert.equal(carriedBy([promoted({ revives: false })]).size, 0, 'old and quiet: nothing shown, nothing carried');
  assert.equal(carriedBy([promoted({ age: 'young', revives: false })]).get(LIGHT_BABY)?.address, BI);
});

test('one coin an original: the running one, then the first launched', () => {
  const quiet = promoted({ promoId: 'x:p1', address: 'EARLY', age: 'young', revives: false, launchedAtMs: NOW - 2 * DAY });
  const later = promoted({ promoId: 'x:p2', address: 'LATER', age: 'young', revives: false, launchedAtMs: NOW - DAY });
  assert.equal(carriedBy([later, quiet]).get(LIGHT_BABY)?.address, 'EARLY');
  assert.equal(carriedBy([quiet, promoted({ promoId: 'x:p3' })]).get(LIGHT_BABY)?.address, BI);
});

test('★ the card: the original takes the coin with no tie claimed, and keeps a pick of its own', () => {
  const p = carriedPick(promoted());
  assert.deepEqual({ ...p, launchedAfterMs: Math.round((p.launchedAfterMs ?? 0) / DAY) }, { address: BI, outcome: 'picked', ties: [], launchedAfterMs: 6 });
  const carried = carriedBy([promoted()]);
  const waiting: CardPick = { address: null, outcome: 'waiting', ties: [], launchedAfterMs: null };
  assert.equal(withCarried(new Map([[LIGHT_BABY, waiting]]), carried, [LIGHT_BABY]).get(LIGHT_BABY)?.address, BI);
  const own: CardPick = { address: 'OWN', outcome: 'picked', ties: ['link'], launchedAfterMs: 0 };
  assert.equal(withCarried(new Map([[LIGHT_BABY, own]]), carried, [LIGHT_BABY]).get(LIGHT_BABY)?.address, 'OWN');
  assert.equal(withCarried(new Map(), carried, []).size, 0, 'only the cards of this frame');
});

/* One recent pick as the running route reads it. */
const pickRow = (itemId: string, o: Record<string, unknown> = {}) => ({
  item_id: itemId, address: BI, judged_yes: true, cap: 40_912, vol: 207_302, trades: 7_250, at: new Date(NOW - 2 * MIN).toISOString(), reach: 0, posted: new Date(NOW - 73 * MIN).toISOString(), ...o,
});
const dbOf = (rows: readonly unknown[]): Db => ({ query: async () => rows }) as unknown as Db;

test('★ the running route pulls the original back in its promotion\'s place, on the original\'s own yes', async () => {
  const promos = new Map([[INFINITIDIGITS, promoted()]]);
  const back = await loadRunningPicks(dbOf([pickRow(INFINITIDIGITS)]), NOW, undefined, null, promos);
  assert.deepEqual([...back.keys()], [LIGHT_BABY]);
  const unjudged = await loadRunningPicks(dbOf([pickRow(INFINITIDIGITS)]), NOW, undefined, null, new Map([[INFINITIDIGITS, promoted({ originalJudgedYes: false })]]));
  assert.equal(unjudged.size, 0, 'the promotion\'s yes is not the original\'s');
  const quiet = await loadRunningPicks(dbOf([pickRow(INFINITIDIGITS)]), NOW, undefined, null, new Map([[INFINITIDIGITS, promoted({ revives: false })]]));
  assert.equal(quiet.size, 0, 'an old original whose coin does not run by the saved-post bars stays away');
  const plain = await loadRunningPicks(dbOf([pickRow('x:other')]), NOW, undefined, null, promos);
  assert.deepEqual([...plain.keys()], ['x:other'], 'a post that is no promotion is pulled as before');
});
