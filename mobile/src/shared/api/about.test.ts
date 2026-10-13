/**
 * The About read's decoder: only https links of the four kinds get through, an absent number is
 * pending with its reason, and an evidence fact that is not a literal boolean is unknown.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoinAbout } from './about.ts';
import { WireLeakError } from './decode.ts';

test('★ only https links of the page\'s four kinds; numbers pending with their reason, never zero', () => {
  const a = decodeCoinAbout({
    links: [
      { kind: 'x', url: 'https://x.com/coin', label: '@coin' },
      { kind: 'x', url: 'javascript:alert(1)', label: 'x' },
      { kind: 'discord', url: 'https://discord.gg/x', label: 'discord' },
    ],
    volume24hUsd: { v: null, why: 'unreadable' },
    holders: { v: 12 },
    posts: [{ postId: 'x:1', own: true, evidence: { linksPost: 'yes', samePicture: true, launchedAfterMs: 60_000 } }],
  });
  assert.deepEqual(a.links.map((l) => l.url), ['https://x.com/coin']);
  assert.deepEqual(a.volume24hUsd, { known: false, pending: 'unreadable' });
  assert.deepEqual(a.liquidityUsd, { known: false, pending: 'not_reported' });
  assert.deepEqual(a.holders, { known: true, amount: 12 });
  assert.deepEqual(a.posts[0]?.evidence, { linksPost: null, samePicture: true, launchedAfterMs: 60_000 });
});

test('a reply carrying an internal word is refused loudly, not drawn', () => {
  assert.throws(() => decodeCoinAbout({ links: [], score: 3 }), WireLeakError);
});
