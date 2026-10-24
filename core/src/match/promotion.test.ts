/**
 * A promotion: a post pointing at another account's post seen at least as widely, under For You's
 * views bar itself, with the original held. Its coin is the original's when the original was young
 * at the launch, and only while running when it was old.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { PromoFacts } from './coin-origin.ts';
import { promotionAge, promotionMaxAgeMs, promotionOf, promotionRevives, type PromotedOriginal } from './promotion.ts';

const BARS = { ownReach: DEFAULT_POLICY.rising.fypMinReach };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const promo = (over: Partial<PromoFacts> = {}): PromoFacts => ({ itemId: 'x:promo', authorKey: 'a:caller', reach: 0, rebroadcastOf: null, reproductionOf: null, links: [], ...over });
const holding = (...posts: PromotedOriginal[]) => (id: string) => posts.find((p) => p.itemId === id);
const original = (over: Partial<PromotedOriginal> = {}): PromotedOriginal => ({ itemId: 'x:viral', authorKey: 'a:prtygal', reach: 69_258_087, postedAtMs: 0, ...over });

test('★ the Infinitidigits case: a 0-view quote of a 69M-view post is a promotion of it', () => {
  assert.equal(promotionOf(promo({ reproductionOf: 'x:viral' }), holding(original()), BARS)?.itemId, 'x:viral');
});

test('a link to the viral post counts as a quote does; a re-share is always one', () => {
  assert.equal(promotionOf(promo({ links: ['x:viral'] }), holding(original()), BARS)?.itemId, 'x:viral');
  assert.equal(promotionOf(promo({ rebroadcastOf: 'x:viral', reach: 500 }), holding(original({ reach: 10 })), BARS)?.itemId, 'x:viral');
});

test('★ a commentary quote that went viral itself is not a promotion, whatever it quotes', () => {
  assert.equal(promotionOf(promo({ reproductionOf: 'x:viral', reach: 514_644 }), holding(original({ reach: 1_691_125 })), BARS), null);
});

test('a big post quoting a smaller one, the same account, and a post we do not hold are not promotions', () => {
  assert.equal(promotionOf(promo({ reproductionOf: 'x:viral', reach: 30_000 }), holding(original({ reach: 1_000 })), BARS), null);
  assert.equal(promotionOf(promo({ reproductionOf: 'x:viral' }), holding(original({ authorKey: 'a:caller' })), BARS), null);
  assert.equal(promotionOf(promo({ reproductionOf: 'x:unheld' }), holding(original()), BARS), null);
  assert.equal(promotionOf(promo(), holding(original()), BARS), null);
});

test('an unknown reach on either side follows, as the coin-link step does', () => {
  assert.equal(promotionOf(promo({ reproductionOf: 'x:viral', reach: null }), holding(original({ reach: null })), BARS)?.itemId, 'x:viral');
});

test('the original is young up to the coin-link age at the launch; unknown is old', () => {
  const max = promotionMaxAgeMs(DEFAULT_POLICY);
  assert.equal(max, 3 * DAY);
  assert.equal(promotionAge(0, max, DEFAULT_POLICY), 'young');
  assert.equal(promotionAge(0, max + 1, DEFAULT_POLICY), 'old');
  assert.equal(promotionAge(null, max, DEFAULT_POLICY), 'old');
  assert.equal(promotionAge(0, null, DEFAULT_POLICY), 'old');
});

test('★ an old original comes back only while its coin runs by the saved-post bars, within a day of the launch', () => {
  const now = 10 * DAY;
  const hour = { volume1hUsd: 49_193, trades1h: 1_441, readAtMs: now - 60_000 };
  assert.equal(promotionRevives(now - HOUR, hour, now, DEFAULT_POLICY), true);
  assert.equal(promotionRevives(now - 2 * DAY, hour, now, DEFAULT_POLICY), false);
  assert.equal(promotionRevives(now - HOUR, { ...hour, volume1hUsd: 19_999 }, now, DEFAULT_POLICY), false);
  assert.equal(promotionRevives(now - HOUR, { ...hour, trades1h: 19 }, now, DEFAULT_POLICY), false);
  assert.equal(promotionRevives(now - HOUR, { ...hour, readAtMs: now - HOUR }, now, DEFAULT_POLICY), false);
  assert.equal(promotionRevives(now - HOUR, null, now, DEFAULT_POLICY), false);
  assert.equal(promotionRevives(null, hour, now, DEFAULT_POLICY), false);
});
