import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WireLeakError, decodeBoardTick, decodeCoinLink, decodeStory } from './decode.ts';
import { fixtureBoard, fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';

const row = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'r1',
  title: 't',
  summary: ['a', 'b'],
  thumbUrl: null,
  reach: { v: null, why: 'not_reported' },
  spark: { points: [{ atMs: 1, value: null }], windowMs: 10 },
  momentum: 'rising',
  marketCapUsd: { v: null },
  priceChange24h: { v: null },
  firstSeenAt: { at: null },
  coins: { kind: 'none' },
  isNew: false,
  ...extra,
});

test('an internal word in a payload throws at the boundary rather than being dropped', () => {
  assert.throws(() => decodeBoardTick({ tick: 1, order: [], rows: [row({ score: 0.9 })] }), WireLeakError);
  assert.throws(() => decodeBoardTick({ tick: 1, order: [], rows: [row({ narrative: 'x' })] }), WireLeakError);
});

test('an absence decodes to pending with its reason, and a censored point stays null', () => {
  const tick = decodeBoardTick({ tick: 1, order: ['r1'], rows: [row()] });
  const r = tick.rows[0];
  assert.deepEqual(r?.reach, { known: false, pending: 'not_reported' });
  assert.deepEqual(r?.firstSeenAt, { known: false, pending: 'not_read_yet' });
  assert.equal(r?.spark.points[0]?.value, null);
});

test('an unsure match carries no coin, even if the server sends one', () => {
  const link = decodeCoinLink({ kind: 'unsure', claimCount: 3, coin: { coinId: 'x' } });
  assert.deepEqual(link, { kind: 'unsure', claimCount: 3 });
  assert.deepEqual(decodeCoinLink({ kind: 'unsure', claimCount: 10, more: true }), { kind: 'unsure', claimCount: 10, more: true }, '"at least", only from a literal true');
  assert.deepEqual(decodeCoinLink({ kind: 'unsure', claimCount: 3, more: 'yes' }), { kind: 'unsure', claimCount: 3 });
});

test('a board that does not state its provenance is unstated, never observed', () => {
  assert.deepEqual(decodeBoardTick({ tick: 1, order: [], rows: [] }).provenance, { kind: 'unstated' });
});

test('every fixture decodes through the same decoder as the network', () => {
  const tick = decodeBoardTick(fixtureBoard());
  assert.ok(tick.rows.length >= 8);
  for (const id of [...tick.order, ...sampleNarrativeIds()]) decodeStory(fixtureStory(id));
  assert.equal(fixtureStory('nope'), null);
});

test('the fixtures cover the hard cases, not just the happy one', () => {
  const kinds = new Set(decodeBoardTick(fixtureBoard()).rows.map((r) => r.coins.kind));
  assert.deepEqual([...kinds].sort(), ['none', 'one', 'several', 'unsure']);
  const rows = decodeBoardTick(fixtureBoard()).rows;
  assert.ok(rows.some((r) => !r.reach.known), 'a row with no view count');
  assert.ok(rows.some((r) => !r.firstSeenAt.known), 'a row with no known age');
  assert.ok(rows.some((r) => r.coins.kind === 'one' && !r.coins.coin.tradable), 'a coin that cannot be traded');
});

test('no sample address could be mistaken for a real one', () => {
  for (const id of [...decodeBoardTick(fixtureBoard()).order, ...sampleNarrativeIds()]) {
    const s = decodeStory(fixtureStory(id));
    const coins = s.coins.kind === 'one' ? [s.coins.coin] : s.coins.kind === 'several' ? s.coins.coins : [];
    for (const c of coins) assert.match(c.address, /^SAMPLE/);
  }
});

test('★ the earliest post decodes with its author; "started by" only from a known proof', () => {
  const id = decodeBoardTick(fixtureBoard()).order[0] ?? '';
  const raw = fixtureStory(id) as Record<string, unknown>;
  const at = 1_800_000_000_000;
  const started = decodeStory({ ...raw, earliestPost: { at, authorLabel: '@firstpost', permalink: 'https://example.invalid/1', startedBy: 'quoted' } });
  assert.deepEqual(started.earliestPost, { known: true, at, authorLabel: '@firstpost', permalink: 'https://example.invalid/1', startedBy: 'quoted' });
  const guessed = decodeStory({ ...raw, earliestPost: { at, authorLabel: '@x', permalink: null, startedBy: 'probably' } });
  assert.equal(guessed.earliestPost.known && guessed.earliestPost.startedBy, null, 'an unknown proof is dropped, never shown');
  assert.deepEqual(decodeStory({ ...raw, earliestPost: { at: null, why: 'not_reported' } }).earliestPost, { known: false, pending: 'not_reported' });
  assert.deepEqual(decodeStory({ ...raw, earliestPost: undefined }).earliestPost, { known: false, pending: 'not_read_yet' }, 'an older server: a dash, not a post');
});

test('★ a coin\'s origin decodes with its post; a post after launch stays "after launch"; anything unknown is a dash', () => {
  const coin = (origin: unknown) => decodeCoinLink({ kind: 'one', coin: { coinId: 'c', ticker: 'T', name: 'T', address: 'a', venueLabel: 'v', imageUrl: null, mintedAt: { at: 1 }, priceUsd: { v: 1 }, marketCapUsd: { v: 1 }, marketCapBasis: null, liquidityUsd: { v: 1 }, priceChange24h: { v: 1 }, tradable: true, origin } });
  const one = (origin: unknown) => {
    const link = coin(origin);
    return link.kind === 'one' ? link.coin.origin : null;
  };
  const after = one({ kind: 'afterLaunch', post: { authorLabel: '@whitehouse', permalink: null, postedAt: { at: 5 } }, offset: { v: 7_200_000 } });
  assert.equal(after?.kind, 'afterLaunch');
  assert.deepEqual(after?.kind === 'afterLaunch' ? after.offset : null, { known: true, amount: 7_200_000 });
  assert.deepEqual(one({ kind: 'probably', post: {} }), { kind: 'unknown', pending: 'not_read_yet' }, 'an unknown kind is never shown as an origin');
  assert.deepEqual(one(undefined), { kind: 'unknown', pending: 'not_read_yet' }, 'an older server: a dash');
});
