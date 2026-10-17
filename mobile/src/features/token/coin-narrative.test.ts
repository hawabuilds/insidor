import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AboutPost, Story } from '../../shared/api/index.ts';
import { narrativeCardFacts, narrativeIdFor } from './coin-narrative.ts';

const post = (id: string, views: number | null, storyId: string | null): AboutPost => ({
  postId: id,
  own: false,
  sourceLabel: 'X',
  authorLabel: '@a',
  permalink: null,
  excerpt: 'x',
  thumbUrl: null,
  postedAt: { known: false, pending: 'not_reported' } as never,
  views: views === null ? { known: false, pending: 'not_reported' } : { known: true, amount: views },
  story: storyId === null ? null : { storyId, title: 't' },
  evidence: { linksPost: null, samePicture: null, launchedAfterMs: null },
});

test("the read service's narrative for the coin comes first, then the most-viewed naming post's", () => {
  assert.equal(narrativeIdFor(null), null);
  assert.equal(narrativeIdFor({ storyId: 'n-1', posts: [post('a', 9, 'n-2')] }), 'n-1');
  assert.equal(narrativeIdFor({ storyId: null, posts: [post('a', 5, 'n-3'), post('b', 9, 'n-2')] }), 'n-2');
  assert.equal(narrativeIdFor({ storyId: null, posts: [post('b', 9, null), post('a', 5, 'n-3')] }), 'n-3');
  assert.equal(narrativeIdFor({ storyId: null, posts: [post('b', 9, null)] }), null);
});

const story = (coins: Story['coins'], extra: Partial<Story> = {}): Story =>
  ({
    id: 'n-1',
    title: 'GTA 6',
    coins,
    postCount: 6,
    evidence: [],
    reach: { known: false, pending: 'not_reported' },
    viewsTotal: { known: true, amount: 1_300_000 },
    viewsGained1h: { known: true, amount: 84_000 },
    ...extra,
  }) as unknown as Story;

test('the card says the facts, and Story coin only for the narrative\'s own settled coin', () => {
  const own = story({ kind: 'one', coin: { address: 'AAA' } } as never);
  assert.deepEqual(narrativeCardFacts(own, 'AAA'), { title: 'GTA 6', posts: '6 posts', views: '1.3M views', gain: '+84K 1h', coin: 'story' });
  assert.equal(narrativeCardFacts(own, 'BBB').coin, 'unchecked');
  assert.equal(narrativeCardFacts(story({ kind: 'pending' } as never), 'AAA').coin, 'unchecked');
});

test('a part the narrative did not carry is left out, never zero', () => {
  const f = narrativeCardFacts(story({ kind: 'none' } as never, { viewsTotal: null, viewsGained1h: null, postCount: 1 }), 'AAA');
  assert.equal(f.views, null);
  assert.equal(f.gain, null);
  assert.equal(f.posts, '1 post');
});
