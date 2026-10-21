/**
 * The two post-picture sizes on real pictures: WebP at the policy's sizes, the shape kept, a small
 * picture never enlarged, and bytes that are not a picture refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import sharp from 'sharp';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { NotAPicture } from './logo-sizes.ts';
import { postPicSizes } from './post-pic-sizes.ts';

const P = DEFAULT_POLICY.postPictures;
const jpeg = async (width: number, height: number) =>
  new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#5B8DEF' } }).jpeg().toBuffer());

test('★ a tall cover becomes the lists\' and the sheet\'s WebP, its shape kept', async () => {
  const { card, sheet } = await postPicSizes(await jpeg(1080, 1920), P);
  const c = await sharp(card.bytes).metadata();
  const s = await sharp(sheet.bytes).metadata();
  assert.equal(card.type, 'image/webp');
  assert.deepEqual([c.format, c.width, c.height], ['webp', Math.round((P.cardPx * 1080) / 1920), P.cardPx]);
  assert.deepEqual([s.format, s.width, s.height], ['webp', Math.round((P.sheetPx * 1080) / 1920), P.sheetPx]);
});

test('a picture smaller than the sheet size is not enlarged', async () => {
  const { sheet } = await postPicSizes(await jpeg(500, 800), P);
  const s = await sharp(sheet.bytes).metadata();
  assert.deepEqual([s.width, s.height], [500, 800]);
});

test('bytes that are not a picture are refused', async () => {
  await assert.rejects(postPicSizes(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), P), NotAPicture);
});
