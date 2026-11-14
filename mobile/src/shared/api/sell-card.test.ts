import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeSellCard } from './sell-card.ts';

test('★ a landed sell: numbers kept, unknowns null with their reason, never a zero', () => {
  const c = decodeSellCard({
    kind: 'read',
    mint: '67erkUmo51ktdapJ7Zi4DnGPK542hHdCRwSzXkVSpump',
    ticker: 'SIDEEYE',
    name: 'SIDE EYE DOG',
    soldAt: 1792761831455,
    boughtCapUsd: { v: 18542.17 },
    soldCapUsd: { v: 16990.18 },
    multiple: { v: 0.916 },
    profitSol: { v: null, why: 'bought_elsewhere' },
    post: { id: 'x:1', postedAt: 1792704278000, author: '@teeelatricee', authorPictureFile: 'df94874b9a4fcbbb8e9eda7c2f871da6', pictureFile: 'f6c9a08a0b96f1bd86b9c8af91630c58' },
  });
  assert.equal(c.kind, 'read');
  if (c.kind !== 'read') return;
  assert.deepEqual(c.multiple, { v: 0.916, why: null });
  assert.deepEqual(c.profitSol, { v: null, why: 'bought_elsewhere' });
  assert.equal(c.post?.author, '@teeelatricee');
  assert.equal(c.post?.pictureFile, 'f6c9a08a0b96f1bd86b9c8af91630c58');
});

test('a reason this build does not know reads as not recorded; a negative profit stays negative', () => {
  const c = decodeSellCard({ kind: 'read', mint: 'M', boughtCapUsd: { v: null, why: 'something_new' }, soldCapUsd: {}, multiple: 'x', profitSol: { v: -0.0059 }, post: null });
  assert.equal(c.kind, 'read');
  if (c.kind !== 'read') return;
  assert.deepEqual(c.boughtCapUsd, { v: null, why: 'not_recorded' });
  assert.deepEqual(c.soldCapUsd, { v: null, why: 'not_recorded' });
  assert.deepEqual(c.multiple, { v: null, why: 'not_recorded' });
  assert.deepEqual(c.profitSol, { v: -0.0059, why: null });
  assert.equal(c.post, null);
});

test('★ only our stored copies\' file names are kept; a link or a bad handle is dropped', () => {
  const c = decodeSellCard({ kind: 'read', mint: 'M', post: { postedAt: 'soon', author: 'Some Channel', authorPictureFile: 'https://pic.example/a.jpg', pictureFile: '../coin-logos/x', pictureUrl: 'javascript:x', authorPictureUrl: 'http://x' } });
  assert.equal(c.kind, 'read');
  if (c.kind !== 'read') return;
  assert.deepEqual(c.post, { postedAt: null, author: null, authorPictureFile: null, authorPictureUrl: null, pictureFile: null, pictureUrl: null });
});

test('pending is pending; anything else that is not a card is none', () => {
  assert.deepEqual(decodeSellCard({ kind: 'pending' }), { kind: 'pending' });
  assert.deepEqual(decodeSellCard({ kind: 'none', why: 'failed' }), { kind: 'none' });
  assert.deepEqual(decodeSellCard(null), { kind: 'none' });
});
