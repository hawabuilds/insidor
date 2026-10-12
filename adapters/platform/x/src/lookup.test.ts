/**
 * Whole posts by id — what the backfill follows a quote with. The same lookup as the
 * tracking path, read into Items: a quote keeps its pointer, the author comes back with it,
 * and an id the vendor did not answer is absent rather than invented. No network, no key.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';

import type { XClient } from './client.ts';
import { xPlatform } from './index.ts';
import { PLAIN, QUOTE } from './__fixtures__/posts.ts';

const AT = 1_800_000_000_000 as Millis;
const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 } as const;
const recorded: number[] = [];
const meter = {
  mayspend: () => true,
  record: (s: { usd: number }) => void recorded.push(s.usd),
  spentUsd: () => 0,
  line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
} as unknown as Meter;

test('★ a looked-up quote keeps its pointer, brings its author, and a missing id stays missing', async () => {
  let asked: readonly string[] = [];
  const client: XClient = {
    search: async () => ({ items: [], cursor: null, hasMore: false }),
    lookup: async (ids) => {
      asked = ids;
      return [QUOTE, PLAIN];
    },
  };
  const x = xPlatform({ client, meter, now: () => AT });
  const result = await x.lookup!(['quote', 'plain', 'deleted'], budget);

  assert.deepEqual(asked, ['quote', 'plain', 'deleted']);
  assert.equal(result.value.items.length, 2, 'the deleted post is absent, not an empty Item');
  const quote = result.value.items.find((i) => i.reproductionOf !== null);
  assert.equal(quote?.reproductionOf, 'x:1823456789012345678');
  assert.ok(result.value.authors.length > 0);
  assert.equal(result.value.hasMore, false);
  assert.ok(result.spend.usd > 0, 'and it was billed through the meter like any lookup');
});
