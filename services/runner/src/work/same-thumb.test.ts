import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gifThumbOf, sameThumbKeys } from './same-thumb.ts';

const CAT = 'a5c3f0e1b2d49687';
const OTHER = '5a3c0f1e2b4d6978';

test('★ two uploads of one GIF, thumbnails hashed alike, share one key (the boxing cat)', () => {
  const keys = new Map([['p1', 'x-gif:HWtl'], ['p2', 'x-gif:HWtl'], ['p3', 'x-gif:HWtK'], ['p4', 'x-gif:Zzz']]);
  const thumbs = new Map([['p1', 'u1'], ['p2', 'u1'], ['p3', 'u2'], ['p4', 'u3']]);
  const out = sameThumbKeys(keys, thumbs, new Map([['u1', CAT], ['u2', CAT], ['u3', OTHER]]), 0);
  assert.equal(out.get('p1'), 'x-gif:HWtK');
  assert.equal(out.get('p3'), 'x-gif:HWtK');
  assert.equal(out.get('p2'), out.get('p3'));
  assert.equal(out.get('p4'), 'x-gif:Zzz');
});

test('a near-flat thumbnail (a black first frame) never joins another', () => {
  const keys = new Map([['a', 'x-gif:A'], ['b', 'x-gif:B']]);
  const thumbs = new Map([['a', 'ua'], ['b', 'ub']]);
  const out = sameThumbKeys(keys, thumbs, new Map([['ua', '0000000000000001'], ['ub', '0000000000000001']]), 0);
  assert.equal(out.get('a'), 'x-gif:A');
  assert.equal(out.get('b'), 'x-gif:B');
});

test('a key with no hash yet, or one bit too far, keeps its own key', () => {
  const keys = new Map([['a', 'x-gif:A'], ['b', 'x-gif:B'], ['c', 'x-video:1']]);
  const thumbs = new Map([['a', 'ua'], ['b', 'ub']]);
  const near = (BigInt(`0x${CAT}`) ^ 1n).toString(16).padStart(16, '0');
  assert.equal(sameThumbKeys(keys, thumbs, new Map([['ua', CAT]]), 0).get('a'), 'x-gif:A');
  assert.equal(sameThumbKeys(keys, thumbs, new Map([['ua', CAT], ['ub', near]]), 0).get('b'), 'x-gif:B');
  assert.equal(sameThumbKeys(keys, thumbs, new Map([['ua', CAT], ['ub', near]]), 1).get('b'), 'x-gif:A');
  assert.equal(sameThumbKeys(keys, thumbs, new Map(), 0).get('c'), 'x-video:1');
});

test('only a looping video is a GIF thumbnail', () => {
  assert.equal(gifThumbOf([{ uri: 'https://pbs.example/t/k.jpg', kind: 'video', loops: true }]), 'https://pbs.example/t/k.jpg');
  assert.equal(gifThumbOf([{ uri: 'https://pbs.example/t/k.jpg', kind: 'video', loops: false }]), null);
  assert.equal(gifThumbOf([{ uri: 'https://pbs.example/m/k.jpg', kind: 'image' }]), null);
  assert.equal(gifThumbOf(null), null);
});
