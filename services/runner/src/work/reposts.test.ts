/**
 * Short videos reposted on the text source: off, nothing is read; on, a fast text post's short
 * link is followed once and recorded, the video it leads to is read and credited to the x_repost
 * lane, and a link to another text post (a quote) is never read as a repost.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Item, ItemId, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { inMemoryMeter } from '@insidor/meter';

import type { Logger } from '../log.ts';
import { repostsPass, type RepostDeps } from './reposts.ts';

const NOW = 1_800_000_000_000 as Millis;
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;
const ON: Policy = { ...DEFAULT_POLICY, finders: { ...DEFAULT_POLICY.finders, reposts: { ...DEFAULT_POLICY.finders.reposts, on: true } } };

const source = (id: string, host: string): PlatformAdapter =>
  ({
    id,
    capabilities: { discovery: [] },
    parseLink: (url: string) => {
      const m = new RegExp(`^https://${host}/@(\\w+)/video/(\\d+)`).exec(url);
      return m?.[2] === undefined ? null : { kind: 'post' as const, sourceItemId: m[2], handle: m[1] };
    },
    estimate: () => ({ vendor: id, endpoint: 'lookup', usd: 0.004 }),
    lookup: async (ids: readonly string[]) => ({
      value: { items: ids.map((sid) => ({ itemId: `${id}:${sid}`, sourceItemId: sid, postedAt: NOW - 3_600_000 }) as unknown as Item), authors: [], cursor: null, hasMore: false },
      spend: { vendor: id, endpoint: 'lookup', unit: 'per-run', units: 1, usd: 0.004, at: NOW },
    }),
  }) as unknown as PlatformAdapter;

function deps(policy: Policy) {
  const followed: { shortUrl: string; target: string | null }[] = [];
  const credited: ItemId[] = [];
  let asked = 0;
  const d: RepostDeps = {
    finders: {
      shortLinksToFollow: async () => {
        asked += 1;
        return [{ itemId: 'txt:1', url: 'https://s.example/a' }, { itemId: 'txt:2', url: 'https://s.example/b' }];
      },
      recordShortLinks: async (rows) => void followed.push(...rows),
    },
    shortLinks: { source: 'txt', pattern: 'https://s\\.example/[a-z]+' },
    sources: () => [source('txt', 'text.example'), source('vid', 'video.example')],
    follow: async (url) => (url.endsWith('/a') ? 'https://video.example/@cat/video/7' : 'https://text.example/@dog/video/8'),
    items: { byIds: async () => new Map(), markFoundBy: async (ids) => void credited.push(...ids) },
    store: async (items) => items.length,
    meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: { vid: 1, txt: 1 }, softStop: 1, now: () => NOW }),
    mode: 'live',
    policy,
    log: quiet,
    now: () => NOW,
  };
  return { d, followed, credited, asked: () => asked };
}

test('★ off: no link is looked for', async () => {
  const off: Policy = { ...DEFAULT_POLICY, finders: { ...DEFAULT_POLICY.finders, reposts: { ...DEFAULT_POLICY.finders.reposts, on: false } } };
  const h = deps(off);
  await repostsPass(h.d);
  assert.equal(h.asked(), 0);
});

test('on: links followed and recorded, the short video read and credited, the quoted text post not', async () => {
  const h = deps(ON);
  const r = await repostsPass(h.d);
  assert.equal(h.followed.length, 2);
  assert.deepEqual(h.credited, ['vid:7']);
  assert.equal(r.videos, 1);
});
