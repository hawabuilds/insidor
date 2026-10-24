/**
 * Coins pointing to posts, against stand-ins: every URL in a document is found (schemeless ones
 * too), each source's own parser names the post, a post we hold is not read, one we do not is read
 * once and stored, the link is recorded whatever the post's age, and only a qualifying post is
 * credited to the coin_link lane — a short video young enough, a text post with enough approvals.
 * Off, a pass does nothing and reads no table. A dry run records links and reads no post. A pass
 * with a coin logs one line even when the coin names no post. A named post that quotes or links
 * another account's post at least as widely seen is recorded and credited as that post, through it,
 * one hop and no further; a promotion on its own, or one whose original cannot be read, as before.
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

const adapter = (id: string, host: string, catchall: boolean, looked: string[][] = [], made: ReadonlyMap<string, Item> = new Map()): PlatformAdapter =>
  ({
    id,
    postLink: (sid: string, handle: string | null) => `https://${host}/${handle ?? 'i'}/status/${sid}`,
    capabilities: { discovery: catchall ? ['catchall'] : ['keyword'] },
    parseLink: (url: string) => {
      const m = new RegExp(`^https://${host}/@?(\\w+)/(?:status|video)/(\\d+)`).exec(url);
      return m?.[2] === undefined ? null : { kind: 'post' as const, sourceItemId: m[2], handle: m[1] };
    },
    estimate: (call: { sourceItemIds?: readonly string[] }) => ({ vendor: id, endpoint: 'lookup', usd: 0.004 * (call.sourceItemIds?.length ?? 1) }),
    lookup: async (ids: readonly string[]) => {
      looked.push([...ids]);
      const items = ids.map((sid) => made.get(`${id}:${sid}`) ?? item(`${id}:${sid}`, NOW - HOUR, 100));
      return { value: { items, authors: [], cursor: null, hasMore: false }, spend: { vendor: id, endpoint: 'lookup', unit: 'per-run', units: 1, usd: 0.004 * ids.length, at: NOW } };
    },
  }) as unknown as PlatformAdapter;

const item = (itemId: string, postedAt: number, approvals: number, o: { by?: string; views?: number; quotes?: string; refersTo?: string[]; text?: string } = {}): Item =>
  ({
    itemId, sourceItemId: itemId.split(':')[1], postedAt, authorKey: o.by ?? 'someone', text: o.text ?? '', rebroadcastOf: null, reproductionOf: o.quotes ?? null,
    ...(o.refersTo === undefined ? {} : { refersTo: o.refersTo }),
    counters: { approval: { value: approvals, fidelity: { kind: 'exact' }, observedAt: NOW }, ...(o.views === undefined ? {} : { reach: { value: o.views, fidelity: { kind: 'exact' }, observedAt: NOW } }) },
  }) as unknown as Item;

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

test('★ a text post under the approvals bar is credited when it is already past For You\'s views bar (@TocRadio, 84.5k views, 950 likes)', () => {
  const t = adapter('txt', 'text.example', true);
  const c = ON.finders.coinLinks;
  const seen = (views: number): Item => ({ ...item('txt:2113693141609886045', NOW - 98 * 60_000, 950), counters: { approval: { value: 950, fidelity: { kind: 'exact' }, observedAt: NOW }, reach: { value: views, fidelity: { kind: 'exact' }, observedAt: NOW } } }) as unknown as Item;
  assert.equal(creditable(seen(84_508), t, NOW, ON), true);
  assert.equal(creditable(seen(c.textMinReach - 1), t, NOW, ON), false);
});

function harness(o: { policy?: Policy; mode?: 'dry' | 'live'; held?: Item[]; made?: Item[]; refs?: Record<string, string[]>; keepsVia?: boolean } = {}) {
  const recorded: CoinPostLink[] = [];
  const credited: ItemId[] = [];
  const stored: Item[] = [];
  const looked: string[][] = [];
  let asked = 0;
  const made = new Map((o.made ?? []).map((i) => [String(i.itemId), i]));
  const v = adapter('vid', 'video.example', false, looked, made);
  const t = adapter('txt', 'text.example', true, looked, made);
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
      keepsVia: async () => o.keepsVia ?? true,
      promoFacts: async (ids) => new Map(ids.flatMap((id) => (held.has(id as ItemId) || made.has(id) ? [[id, { refersTo: o.refs?.[id] ?? null, handle: null }] as const] : []))),
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

test('a pass with a coin that names no post still logs its line', async () => {
  const h = harness();
  const lines: [string, Record<string, unknown>][] = [];
  const log = { ...quiet, info: (msg: string, f: Record<string, unknown>) => void lines.push([msg, f]) } as unknown as Logger;
  const r = await coinLinksPass({ ...h.deps, log, metadata: { read: async () => ({ kind: 'read', cid: 'c', metadata: { name: 'Cat', ticker: 'CAT', description: 'no links here', imageUri: null, links: { social: null, website: null, chat: null } } }) } });
  assert.equal(r.links, 0);
  assert.deepEqual(lines.map(([m, f]) => [m, f.coins, f.read, f.links, f.postsRead]), [['coins pointing to posts', 1, 1, 0, 0]]);
});

/* ── the viral post, not the promotion (0132) ───────────────────────── */

const VIEWS = ON.finders.coinLinks.textMinReach;
const rowsOf = (links: readonly CoinPostLink[]) => links.map((l) => [`${l.source}:${l.sourceItemId}`, l.via ?? null, l.link]).sort();

test('★ a promotion quoting the viral post: the original is read, linked through the promotion, and credited in its place', async () => {
  const promo = item('txt:22', NOW - HOUR, 3, { by: 'launcher', views: 15, quotes: 'txt:500' });
  const original = item('txt:500', NOW - 2 * HOUR, 9_000, { by: 'viral', views: 39 * VIEWS });
  const h = harness({ held: [promo], made: [original] });
  const r = await coinLinksPass(h.deps);
  assert.deepEqual(h.looked, [['11'], ['500']]);
  /* No row for the promotion: it is the original's `via`. */
  assert.deepEqual(rowsOf(h.recorded), [['txt:500', 'txt:22', 'https://text.example/i/status/500'], ['vid:11', null, 'https://video.example/@cat/video/11']]);
  assert.deepEqual([...h.credited].sort(), ['txt:500', 'vid:11']);
  assert.equal(r.followed, 1);
});

test("★ a promotion linking the viral post in its words: the linked post is the coin's", async () => {
  const promo = item('txt:22', NOW - HOUR, 3, { by: 'launcher', views: 15, text: '$CAT is live, the post: https://text.example/viral/status/600' });
  const original = item('txt:600', NOW - 2 * HOUR, 9_000, { by: 'viral', views: VIEWS });
  const h = harness({ held: [promo, original] });
  await coinLinksPass(h.deps);
  assert.deepEqual(rowsOf(h.recorded).find(([k]) => k === 'txt:600'), ['txt:600', 'txt:22', 'https://text.example/viral/status/600']);
  assert.equal(h.recorded.some((l) => l.sourceItemId === '22'), false);
  assert.ok(h.credited.includes('txt:600' as ItemId));
});

test('a promotion whose source recorded its links follows the first one', async () => {
  const promo = item('txt:22', NOW - HOUR, 3, { by: 'launcher', views: 15 });
  const h = harness({ held: [promo, item('txt:601', NOW - 2 * HOUR, 0, { by: 'a' }), item('txt:602', NOW - 2 * HOUR, 0, { by: 'b' })], refs: { 'txt:22': ['txt:601', 'txt:602'] } });
  await coinLinksPass(h.deps);
  assert.deepEqual(rowsOf(h.recorded).filter(([k]) => String(k).startsWith('txt')), [['txt:601', 'txt:22', 'https://text.example/i/status/601']]);
});

test('★ a promotion on its own is recorded and credited as it always was', async () => {
  const promo = item('txt:22', NOW - HOUR, 3, { by: 'launcher', views: VIEWS, text: 'just a coin, no links' });
  const h = harness({ held: [promo], refs: { 'txt:22': [] } });
  const r = await coinLinksPass(h.deps);
  assert.deepEqual(rowsOf(h.recorded), [['txt:22', null, 'https://text.example/dog/status/22'], ['vid:11', null, 'https://video.example/@cat/video/11']]);
  assert.ok(h.credited.includes('txt:22' as ItemId));
  assert.equal(r.followed, 0);
});

test("★ one hop only: the original's own quote is never followed", async () => {
  const promo = item('txt:22', NOW - HOUR, 3, { by: 'launcher', views: 15, quotes: 'txt:500' });
  const original = item('txt:500', NOW - 2 * HOUR, 9_000, { by: 'viral', views: VIEWS, quotes: 'txt:700' });
  const h = harness({ held: [promo], made: [original, item('txt:700', NOW - 3 * HOUR, 9_000, { by: 'older', views: 2 * VIEWS })] });
  await coinLinksPass(h.deps);
  assert.deepEqual(h.looked, [['11'], ['500']]);
  assert.deepEqual(rowsOf(h.recorded).filter(([k]) => String(k).startsWith('txt')).map(([k]) => k), ['txt:500']);
  assert.equal(h.credited.includes('txt:700' as ItemId), false);
});

test("the coin's own account quoting its own earlier promotion, or a big post quoting a small one, is not followed", async () => {
  for (const original of [item('txt:500', NOW - 2 * HOUR, 9_000, { by: 'launcher', views: 2 * VIEWS }), item('txt:500', NOW - 2 * HOUR, 9_000, { by: 'analyst', views: 10 })]) {
    const promo = item('txt:22', NOW - HOUR, 9_000, { by: 'launcher', views: VIEWS, quotes: 'txt:500' });
    const h = harness({ held: [promo, original] });
    await coinLinksPass(h.deps);
    assert.deepEqual(rowsOf(h.recorded).filter(([k]) => String(k).startsWith('txt')).map(([k, via]) => [k, via]), [['txt:22', null]]);
  }
});

test('an original we cannot read, or one too old by its id to credit or tie, leaves the promotion as it was', async () => {
  const promo = item('txt:22', NOW - HOUR, 3, { by: 'launcher', views: 15, quotes: 'txt:500' });
  const dry = harness({ held: [promo], mode: 'dry' });
  await coinLinksPass(dry.deps);
  assert.deepEqual(rowsOf(dry.recorded).filter(([k]) => String(k).startsWith('txt')).map(([k, via]) => [k, via]), [['txt:22', null]]);
  const old = harness({ held: [promo] });
  const t = { ...(old.deps.sources(() => null).find((a) => a.id === 'txt') as PlatformAdapter), postTimeFromId: () => (NOW - ON.finders.coinLinks.creditMaxAgeMs - ON.oneCoin.linkMaxAgeMs - HOUR) as Millis };
  await coinLinksPass({ ...old.deps, sources: () => [t] });
  assert.deepEqual(old.looked, []);
  assert.deepEqual(old.recorded.map((l) => [l.sourceItemId, l.via ?? null]), [['22', null]]);
});

test('before 0132 nothing is followed', async () => {
  const promo = item('txt:22', NOW - HOUR, 3, { by: 'launcher', views: 15, quotes: 'txt:500' });
  const h = harness({ held: [promo], made: [item('txt:500', NOW - 2 * HOUR, 9_000, { by: 'viral', views: VIEWS })], keepsVia: false });
  await coinLinksPass(h.deps);
  assert.deepEqual(h.looked, [['11']]);
  assert.equal(h.recorded.some((l) => l.sourceItemId === '500'), false);
});
