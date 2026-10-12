/**
 * The backfill's note about a shared sound: no source can find a sound's first use yet, so
 * a story whose posts share one says so in the log rather than skipping it silently.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { Logger } from '../log.ts';
import { backfillStories } from './backfill.ts';

const NOW = 1_800_000_000_000 as Millis;
const T = sourceId('tt');
const STORY = storyId('dance');

function post(n: number, formats: readonly string[]): Item {
  return {
    itemId: itemId(T, `${n}`), source: T, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(T, `a${n}`),
    postedAt: NOW, firstSeenAt: NOW, lang: 'en', text: '', media: [], counters: {}, fingerprints: [],
    rebroadcastOf: null, reproductionOf: null, formatIds: formats, rawRef: `tt/${n}`,
  };
}

test('★ posts sharing a sound are noted, by story, as not followed yet', async () => {
  const lines: { msg: string; fields: unknown }[] = [];
  const log: Logger = { info: (msg, fields) => void lines.push({ msg, fields }), warn: () => undefined, error: () => undefined, child: () => log };
  const posts = [post(1, ['sound:7']), post(2, ['sound:7', 'effect:3']), post(3, ['effect:9'])];
  await backfillStories({
    platforms: { has: () => false, get: () => { throw new Error('no source'); } },
    stories: {
      membersForStories: async () => new Map([[STORY, posts.map((p) => ({ storyId: STORY, itemId: p.itemId, authorKey: p.authorKey, source: T, postedAt: NOW, joinedAt: NOW, evidence: { kind: 'seed' as const } }))]]),
      byId: async () => null,
    },
    names: { latest: async () => new Map() },
    items: { byIds: async (ids) => new Map(posts.filter((p) => ids.includes(p.itemId)).map((p) => [p.itemId, p])) },
    backfill: { due: async () => [STORY], countSince: async () => 0, markPosts: async () => undefined, record: async () => undefined },
    store: async () => 0,
    meter: { mayspend: () => true } as unknown as Meter,
    mode: 'live',
    policy: DEFAULT_POLICY,
    log,
    now: () => NOW,
  });
  const note = lines.find((l) => l.msg.startsWith('members share a sound'));
  assert.deepEqual(note?.fields, { story: STORY, formats: ['sound:7'] }, 'only the format two posts share');
});
