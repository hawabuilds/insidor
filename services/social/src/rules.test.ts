import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { blockedWord, cleanBody, parseSubject, proofLinkOf } from './rules.ts';

const MINT = 'FerryHorn1111111111111111111111111111111pump';

test('a comment is about a narrative, a coin or a post, and nothing else', () => {
  assert.deepEqual(parseSubject('story:st_ferry'), { kind: 'story', id: 'st_ferry' });
  assert.deepEqual(parseSubject(`coin:solana:${MINT}`), { kind: 'coin', id: MINT });
  assert.deepEqual(parseSubject('post:x:1823'), { kind: 'post', id: 'x:1823' });
  assert.equal(parseSubject('user:abc'), null);
  assert.equal(parseSubject('coin:not-a-mint'), null);
});

test('★ a link is read for what it could prove: an X post and whose, a transaction, or just a link', () => {
  assert.deepEqual(proofLinkOf('https://x.com/Hawa/status/1823'), { kind: 'x_post', handle: 'hawa' });
  assert.deepEqual(proofLinkOf('https://twitter.com/hawa/status/1823?s=20'), { kind: 'x_post', handle: 'hawa' });
  const sig = '5'.repeat(88);
  assert.deepEqual(proofLinkOf(`https://solscan.io/tx/${sig}`), { kind: 'tx', signature: sig });
  assert.deepEqual(proofLinkOf('https://example.com/a'), { kind: 'other' });
  assert.equal(proofLinkOf('http://x.com/a/status/1'), null, 'only https');
  assert.equal(proofLinkOf('javascript:alert(1)'), null);
});

test('the word filter catches whole words in any case, and not innocent words that contain them', () => {
  assert.equal(blockedWord('you RETARD'), true);
  assert.equal(blockedWord('retardant on the fire'), false);
  assert.equal(blockedWord('kys lol'), true);
  assert.equal(blockedWord('a normal comment about $FERRY'), false);
});

test('a body is trimmed, never empty, never over the limit', () => {
  assert.equal(cleanBody('  hi  ', 10), 'hi');
  assert.equal(cleanBody('   ', 10), null);
  assert.equal(cleanBody('x'.repeat(11), 10), null);
  assert.equal(cleanBody(5, 10), null);
});
