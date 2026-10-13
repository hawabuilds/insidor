/**
 * A post's replies and quote posts: the two queries, the cutoff, the cap, the root post dropped,
 * the nested profile text read, and every page billed with the vendor's floor. No network, no key.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Millis } from '@insidor/contracts';
import type { Meter, Spend } from '@insidor/contracts/ports/meter.ts';

import type { XClient } from './client.ts';
import { xPlatform } from './index.ts';
import { responseQuery, toResponse } from './responses.ts';

const AT = 1_800_000_000_000 as Millis;
const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 } as const;

function recordingMeter(): { meter: Meter; spends: Spend[] } {
  const spends: Spend[] = [];
  const meter = {
    mayspend: () => true,
    record: (s: Spend) => void spends.push(s),
    spentUsd: () => 0,
    line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
  } as unknown as Meter;
  return { meter, spends };
}

const post = (id: string, text: string, bio = '') => ({
  id,
  text,
  createdAt: 'Tue Aug 05 07:00:30 +0000 2026',
  author: { userName: `u${id}`, name: `N${id}`, description: '', profile_bio: { description: bio } },
});

test('the queries: conversation for replies, quoted id for quotes, the cutoff in seconds', () => {
  assert.equal(responseQuery('replies', '123', null), 'conversation_id:123');
  assert.equal(responseQuery('quotes', '123', 5_000 as Millis), 'quoted_tweet_id:123 until_time:4');
  assert.throws(() => responseQuery('replies', '1 OR x', null), RangeError);
});

test('the profile text is the nested bio, and a post with no id is not a response', () => {
  const r = toResponse(post('9', 'gm $CAT', 'memecoin degen'));
  assert.equal(r?.authorBio, 'memecoin degen');
  assert.equal(r?.authorHandle, 'u9');
  assert.equal(r?.at, Date.UTC(2026, 7, 5, 7, 0, 30));
  assert.equal(toResponse({ text: 'no id' }), null);
});

test('★ capped, the root dropped, cut said, and every page billed at least one post', async () => {
  const asked: string[] = [];
  const client: XClient = {
    search: async (query, cursor) => {
      asked.push(`${query}|${cursor ?? ''}`);
      if (query.startsWith('conversation_id')) {
        return cursor === null
          ? { items: [post('100', 'the root'), post('1', 'a'), post('2', 'b')], cursor: 'c1', hasMore: true }
          : { items: [post('3', 'c'), post('4', 'd')], cursor: 'c2', hasMore: true };
      }
      return { items: [], cursor: null, hasMore: false };
    },
    lookup: async () => [],
  };
  const { meter, spends } = recordingMeter();
  const x = xPlatform({ client, meter, now: () => AT });
  const read = await x.responses!('100', { maxReplies: 3, maxReproductions: 5, untilMs: null }, budget);

  assert.deepEqual(read.value.replies.map((r) => r.sourceItemId), ['1', '2', '3']);
  assert.equal(read.value.repliesCut, true, 'the vendor had more than the cap');
  assert.equal(read.value.reproductions.length, 0);
  assert.equal(read.value.reproductionsCut, false);
  assert.deepEqual(asked, ['conversation_id:100|', 'conversation_id:100|c1', 'quoted_tweet_id:100|']);
  assert.deepEqual(spends.map((s) => s.units), [3, 2, 1], 'the empty quote page is billed the floor');
  assert.ok(spends.every((s) => s.endpoint === 'responses'));
  assert.ok(Math.abs(read.spend.usd - 6 * 0.00015) < 1e-12);
});

test('the estimate is whole pages of each kind', () => {
  const { meter } = recordingMeter();
  const x = xPlatform({ client: { search: async () => ({ items: [], cursor: null, hasMore: false }), lookup: async () => [] }, meter, now: () => AT });
  const e = x.estimateResponses!({ maxReplies: 20, maxReproductions: 20, untilMs: null });
  assert.equal(e.estUnits, 40);
});
