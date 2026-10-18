/**
 * The two logo sizes on real pictures: WebP, never larger than 256 and 64 pixels, the shape kept,
 * a small picture never enlarged, and bytes that are not a picture refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import sharp from 'sharp';

import { FULL_PX, logoSizes, NotAPicture, SMALL_PX } from './logo-sizes.ts';

const png = async (width: number, height: number) =>
  new Uint8Array(await sharp({ create: { width, height, channels: 3, background: '#9945FF' } }).png().toBuffer());

test('★ a large picture becomes a 256 and a 64 pixel WebP, its shape kept', async () => {
  const { full, small } = await logoSizes(await png(1000, 500));
  assert.equal(full.type, 'image/webp');
  assert.equal(small.type, 'image/webp');
  const f = await sharp(full.bytes).metadata();
  const s = await sharp(small.bytes).metadata();
  assert.deepEqual([f.format, f.width, f.height], ['webp', FULL_PX, FULL_PX / 2]);
  assert.deepEqual([s.format, s.width, s.height], ['webp', SMALL_PX, SMALL_PX / 2]);
});

test('a picture smaller than the size is not enlarged', async () => {
  const { full } = await logoSizes(await png(40, 40));
  const f = await sharp(full.bytes).metadata();
  assert.deepEqual([f.width, f.height], [40, 40]);
});

test('bytes that are not a picture are refused', async () => {
  await assert.rejects(logoSizes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])), NotAPicture);
});
