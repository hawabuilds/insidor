/**
 * The Receive sheet's QR code against an independent encoder: the matrix below is what the
 * `qrcode` package (1.5.4, level M, mask 2) draws for a real Solana address, recorded once. Ours must
 * match it module for module, so a wrong table cannot pass as a square that only looks right.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { qrMatrix } from './qr.ts';

const ADDRESS = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
/* qrcode 1.5.4, errorCorrectionLevel M, maskPattern 2: version 4, 33 by 33. */
const REFERENCE = [
  '111111100000110111111011101111111',
  '100000100011111101001010101000001',
  '101110101011010001110000001011101',
  '101110101010101110011110101011101',
  '101110101110010101100100101011101',
  '100000101101000111001000001000001',
  '111111101010101010101010101111111',
  '000000001101000100000110100000000',
  '101111100110010111000111001111100',
  '011110010010001000101101010001110',
  '110100101101000100101100100000010',
  '000101001110101010010111000001110',
  '001011111100000000110100010011001',
  '010001001101111110001110001001111',
  '011111111000000001110110010000000',
  '011111001001001010111100001011100',
  '000011100010101001010011000110101',
  '100101001110111111111001111000001',
  '010111101100101101000010111100110',
  '011000001110101111111001011101111',
  '111101101100101110001111100100111',
  '101111001110100100100000011001111',
  '100001101111110111001010010000100',
  '101101000001111100100100001101100',
  '101011101000000101101011111110011',
  '000000001100001010011110100010101',
  '111111100110001100101101101011010',
  '100000101111001010011111100011110',
  '101110101110010100100100111110001',
  '101110101101001111001011100001101',
  '101110101000010000110100011000100',
  '100000100101011010011110100111100',
  '111111101101100000010111101010010',
];

test('★ an address draws the same QR code as an independent encoder, module for module', () => {
  const m = qrMatrix(ADDRESS, 2);
  assert.ok(m !== null);
  assert.deepEqual(m.map((row) => row.map((d) => (d ? '1' : '0')).join('')), REFERENCE);
});

test('the chosen mask still makes a readable square: the right size, three finder patterns, the dark module', () => {
  const m = qrMatrix(ADDRESS);
  assert.ok(m !== null);
  assert.equal(m.length, 33);
  const finder = (x: number, y: number) => m[y]![x] && m[y + 6]![x + 6] && !m[y + 1]![x + 1] && m[y + 3]![x + 3];
  assert.ok(finder(0, 0) && finder(26, 0) && finder(0, 26));
  assert.equal(m[33 - 8]![8], true);
});

test('text past version 10 is refused rather than drawn wrong', () => {
  assert.equal(qrMatrix('x'.repeat(300)), null);
});
