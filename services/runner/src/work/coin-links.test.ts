/**
 * Coins pointing to posts, against stand-ins: every URL in a document is found (schemeless ones
 * too), each source's own parser names the post, a post we hold is not read, one we do not is read
 * once and stored, the link is recorded whatever the post's age, and only a qualifying post is
 * credited to the coin_link lane — a short video young enough, a text post with enough approvals.
 * Off, a pass does nothing and reads no table. A dry run records links and reads no post.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Item, ItemId, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { inMemoryMeter } from '@insidor/meter';
import type { CoinPostLink, FreshCoin } from '@insidor/store';

import type { Logger } from '../log.ts';
import { coinLinksPass, creditable, postsNamed, urlsIn, type CoinLinkDeps } from './coin-links.ts';

const NOW = 1_800_000_000_000 as Millis;
const HOUR = 3_600_000;
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;
const ON: Policy = { ...DEFAULT_POLICY, finders: { ...DEFAULT_POLICY.finders, coinLinks: { ...DEFAULT_POLICY.finders.coinLinks, on: true } } };

const adapter = (id: string, host: string, catchall: boolean, looked: string[][] = []): PlatformAdapter =>
  ({
    id,
    capabilities: { discovery: catchall ? ['catchall'] : ['keyword'] },
    parseLink: (url: string) => {
      const m = new RegExp(`^https://${host}/@?(\\w+)/(?:status|video)/(\\d+)`).exec(url);
      return m?.[2] === undefined ? null : { kind: 'post' as const, sourceItemId: m[2], handle: m[1] };
    },
    estimate: (call: { sourceItemIds?: readonly string[] }) => ({ vendor: id, endpoint: 'lookup', usd: 0.004 * (call.sourceItemIds?.length ?? 1) }),
    lookup: async (ids: readonly string[]) => {
      looked.push([...ids]);
      const items = ids.map((sid) => item(`${id}:${sid}`, NOW - HOUR, 100));
      return { value: { items, authors: [], cursor: null, hasMore: false }, spend: { vendor: id, endpoint: 'lookup', unit: 'per-run', units: 1, usd: 0.004 * ids.length, at: NOW } };
    },
  }) as unknown as PlatformAdapter;

const item = (itemId: string, postedAt: number, approvals: number): Item =>
  ({ itemId, sourceItemId: itemId.split(':')[1], postedAt, counters: { approval: { value: approvals, fidelity: { kind: 'exact' }, observedAt: NOW } } }) as unknown as Item;

test('every link in a document is found, a schemeless one too, trailing punctuation dropped', () => {
  const urls = urlsIn({ description: 'the video: video.example/@cat/video/123, and https://text.example/dog/status/456.', links: { social: 'https://text.example/dog/status/789', website: null, chat: null } });
  assert.deepEqual([...urls].sort(), ['https://text.example/dog/status/456', 'https://text.example/dog/status/789', 'https://video.example/@cat/video/123']);
});

test("each source's own parser names the post; a short link is followed first; a dead one is skipped", async () => {
  const v = adapter('vid', 'video.example', false);
  const follow = async (url: string) => (url === 'https://short.example/a' ? 'https://video.example/@cat/video/9' : url === 'https://short.example/dead' ? null : url);
  const named = await postsNamed(['https://short.example/a', 'https://short.example/dead', 'https://elsewhere.example/x'], [v], follow);
  assert.deepEqual(named.map((p) => [p.sourceItemId, p.handle]), [['9', 'cat']]);
});

test('a short video is credited when it was young at the launch; a text post only at its approvals bar', () => {
  const v = adapter('vid', 'video.example', false);
  const t = adapter('txt', 'text.example', true);
  const c = ON.finders.coinLinks;
  assert.equal(creditable(item('vid:1', NOW - HOUR, 0), v, NOW, ON), true);
  assert.equal(creditable(item('vid:1', NOW - c.creditMaxAgeMs - HOUR, 0), v, NOW, ON), false);
  assert.equal(creditable(item('txt:1', NOW - HOUR, c.textMinApprovals - 1), t, NOW, ON), false);
  assert.equal(creditable(item('txt:1', NOW - HOUR, c.textMinApprovals), t, NOW, ON), true);
  assert.equal(creditable(item('vid:1', NOW - HOUR, 0), v, null, ON), false);
});

function harness(o: { policy?: Policy; mode?: 'dry' | 'live'; held?: Item[] } = {}) {
  const recorded: CoinPostLink[] = [];
  const credited: ItemId[] = [];
  const stored: Item[] = [];
  const looked: string[][] = [];
  let asked = 0;
  const v = adapter('vid', 'video.example', false, looked);
  const t = adapter('txt', 'text.example', true, looked);
  const coins: FreshCoin[] = [{ assetKey: 'a1', address: 'COIN1', metadataUri: 'ipfs://doc1', mintedAt: (NOW - 4_000) as Millis }];
  const held = new Map((o.held ?? []).map((i) => [i.itemId, i]));
  const deps: CoinLinkDeps = {
    finders: {
      freshUnread: async () => {
        asked += 1;
        return coins;
      },
      recordLinks: async (links) => {
        recorded.push(...links);
        return links.length;
      },
    },
    coins: { recordMetadata: async () => {} },
    metadata: {
      read: async () => ({ kind: 'read', cid: 'c', metadata: { name: 'Cat', ticker: 'CAT', description: 'https://video.example/@cat/video/11', imageUri: null, links: { social: 'https://text.example/dog/status/22', website: null, chat: null } } }),
    },
    sources: () => [v, t],
    follow: async (url) => url,
    items: {
      byIds: async (ids) => new Map(ids.flatMap((id) => (held.has(id) ? [[id, held.get(id)!] as const] : []))),
      markFoundBy: async (ids) => void credited.push(...ids),
    },
    store: async (items) => {
      stored.push(...items);
      return items.length;
    },
    meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: { vid: 1, txt: 1 }, softStop: 1, now: () => NOW }),
    mode: o.mode ?? 'live',
    policy: o.policy ?? ON,
    log: quiet,
    now: () => NOW,
  };
  return { deps, recorded, credited, stored, looked, asked: () => asked };
}

test('★ off (the default until the owner switches it on), a pass does nothing and reads no table', async () => {
  const h = harness({ policy: DEFAULT_POLICY.finders.coinLinks.on ? { ...DEFAULT_POLICY, finders: { ...DEFAULT_POLICY.finders, coinLinks: { ...DEFAULT_POLICY.finders.coinLinks, on: false } } } : DEFAULT_POLICY });
  const r = await coinLinksPass(h.deps);
  assert.equal(r.coins, 0);
  assert.equal(h.asked(), 0);
});

test('a launch: links recorded seconds after it, the unheld post read once and stored, qualifying posts credited', async () => {
  const h = harness({ held: [item('txt:22', NOW - HOUR, 50)] });
  const r = await coinLinksPass(h.deps);
  assert.deepEqual(h.recorded.map((l) => `${l.source}:${l.sourceItemId}`).sort(), ['txt:22', 'vid:11']);
  assert.deepEqual(h.looked, [['11']]);
  assert.deepEqual(h.stored.map((i) => i.itemId), ['vid:11']);
  /* The held text post has 50 approvals: linked, never credited. */
  assert.deepEqual(h.credited, ['vid:11']);
  assert.deepEqual(r.secondsAfterLaunch, [4]);
});

test('a dry run records the links and reads and credits nothing', async () => {
  const h = harness({ mode: 'dry' });
  await coinLinksPass(h.deps);
  assert.equal(h.recorded.length, 2);
  assert.deepEqual(h.looked, []);
  assert.deepEqual(h.credited, []);
});
