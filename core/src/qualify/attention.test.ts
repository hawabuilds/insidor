/**
 * Crypto attention as facts: cashtags, CA, address-shaped strings, coin words and crypto accounts,
 * counted from responses the way a reader scrolling them would count.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { ResponsePost } from '@insidor/contracts/ports/responses.ts';

import { addressesIn, attentionFacts, cashtagsIn, hasCryptoSignal, isCryptoAccount, saysCa } from './attention.ts';

const P = DEFAULT_POLICY.attention;
const ADDR = '6omoGgUH5zDgd5Xwf3K7u56qn1JgMnV9njaNCAejpump';

const r = (id: string, text: string, at: number | null, who: Partial<ResponsePost> = {}): ResponsePost => ({
  sourceItemId: id,
  at: at as ResponsePost['at'],
  text,
  authorHandle: `user${id}`,
  authorName: null,
  authorBio: null,
  ...who,
});

test('cashtags: a sign then a letter, in capitals, never a price or a link', () => {
  assert.deepEqual(cashtagsIn('@x $chibi and $AOP, $5k, US$ https://t.co/$FAKE', P), ['CHIBI', 'AOP']);
  assert.deepEqual(cashtagsIn('$A alone is too short', P), []);
});

test('addresses: the address alphabet at its lengths, or a hex address; never a word or a link path', () => {
  assert.deepEqual(addressesIn(`$AOP still early ${ADDR} go`, P), [ADDR]);
  assert.deepEqual(addressesIn(`chain:${ADDR}`, P), [ADDR]);
  assert.deepEqual(addressesIn('0x' + 'ab12'.repeat(10), P), ['0x' + 'ab12'.repeat(10)]);
  assert.deepEqual(addressesIn('https://example.org/' + ADDR, P), []);
  assert.deepEqual(addressesIn('Supercalifragilisticexpialidociousandmorewordsjoined', P), []);
});

test('CA in the contract sense, not the state', () => {
  assert.equal(saysCa('CA: abc'), true);
  assert.equal(saysCa('drop the CA'), true);
  assert.equal(saysCa('ca:'), true);
  assert.equal(saysCa('Los Angeles, CA'), false);
  assert.equal(saysCa('I can call'), false);
});

test('a crypto account by its own words, or by what it posted', () => {
  assert.equal(isCryptoAccount(r('1', 'lol', 1, { authorHandle: 'onchain_vol' }), P), true);
  assert.equal(isCryptoAccount(r('2', 'lol', 1, { authorBio: 'Memecoin degen, NFA' }), P), true);
  assert.equal(isCryptoAccount(r('3', 'buy $CAT', 1), P), true);
  assert.equal(isCryptoAccount(r('4', 'so cute', 1, { authorBio: 'solution architect' }), P), false);
});

test('★ the facts, and the earliest response carrying the strict signal', () => {
  const f = attentionFacts(
    {
      replies: [r('1', 'cute dog', 50), r('2', '$DOG to the moon', 40), r('3', 'is there a coin?', 10), r('4', `CA ${ADDR}`, 30)],
      reproductions: [r('5', 'look', 20, { authorBio: 'crypto trader' }), r('6', 'look', 5)],
      repliesCut: true,
      reproductionsCut: false,
    },
    P,
  );
  assert.deepEqual(f.cashtags, { DOG: 1 });
  assert.equal(f.coinWordResponses, 1, 'coin; "moon" is not a coin word');
  assert.equal(f.caMentions, 1);
  assert.equal(f.addresses, 1);
  assert.equal(f.cryptoReproducers, 1);
  assert.equal(f.cryptoRepliers, 2, 'the cashtag and the address posters');
  assert.equal(f.firstSignalAt, 20, 'the crypto reproducer, before the address and the cashtag; the coin word alone is not the strict signal');
  assert.equal(f.repliesCut, true);
  assert.equal(hasCryptoSignal(f), true);
});

test('no responses: no signal, and no time', () => {
  const f = attentionFacts({ replies: [], reproductions: [], repliesCut: false, reproductionsCut: false }, P);
  assert.equal(hasCryptoSignal(f), false);
  assert.equal(f.firstSignalAt, null);
});
