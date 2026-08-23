/**
 * Query rendering, and the proof that the vendor applied the one part of it that
 * carries a correctness claim.
 *
 * ★ THIS FILE IS WHERE THE ANTI-CONTAMINATION CUTOFF STOPS BEING A COMMENT. Until
 * now `until_time:` was rendered by a line nothing tested — on the only source in
 * this repository capable of a blind historical run, which makes it the only place
 * where the port's ★ can actually be honoured or quietly broken.
 *
 * No network: the client is a plain object, and every refusal below is reached
 * without one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Item, Millis } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { NotImplemented } from '@insidor/vendor-kit';

import { billedUnits } from './capabilities.ts';
import type { SearchPage, XClient } from './client.ts';
import { CutoffNotHonoured, cutoffSecond, requireCutoffHonoured, searchPage, toSearchQuery } from './discover.ts';
import { toItem } from './to-item.ts';

const AT = 1_800_000_000_000;

const query = (over: Partial<DiscoveryQuery> = {}): DiscoveryQuery => ({
  mode: 'keyword',
  term: 'chillguy',
  sinceMs: null,
  untilMs: null,
  limit: 25,
  cursor: null,
  ...over,
});

/** A vendor payload stamped at a chosen instant. */
const post = (id: string, postedAtMs: number | null): unknown => ({
  id,
  text: `post ${id}`,
  likeCount: 1,
  ...(postedAtMs === null ? {} : { createdAt: new Date(postedAtMs).toUTCString() }),
});

const clientReturning = (pageValue: SearchPage): XClient => ({
  search: async () => pageValue,
  lookup: async () => {
    throw new Error('not used');
  },
});

const itemsFrom = (raws: readonly unknown[]): readonly Item[] => raws.map((raw) => toItem(raw, AT));

/* ── rendering ────────────────────────────────────────────────────────── */

test('a keyword and an account render into this vendor\'s own operators', () => {
  assert.equal(toSearchQuery(query()), 'chillguy');
  assert.equal(toSearchQuery(query({ term: 'chill guy' })), '"chill guy"');
  assert.equal(toSearchQuery(query({ mode: 'account', term: 'someone' })), 'from:someone');
});

test('a mode this source cannot express is an error, never an empty page', () => {
  // An empty result reads downstream as "nothing is happening", which is the failure
  // the capability list exists to design out.
  assert.throws(() => toSearchQuery(query({ mode: 'hashtag' })), NotImplemented);
  assert.throws(() => toSearchQuery(query({ mode: 'catalog' })), NotImplemented);
  assert.throws(() => toSearchQuery(query({ term: '   ' })), NotImplemented);
});

test('★ the lower bound uses since_time:, not the day-granularity operator the vendor disowned', () => {
  // The vendor's own warning names the datetime form of `since:`/`until:` as
  // unsupported. `since_time:` takes unix seconds, is exact, and is symmetric with
  // the ceiling one line below it.
  const rendered = toSearchQuery(query({ sinceMs: 1_800_000_000_500 }));
  assert.ok(rendered.includes('since_time:1800000000'));
  assert.equal(rendered.includes('since:'), false, 'the day-granularity spelling is still being sent');
});

test('the lower bound rounds outward, because being too WIDE on a floor is safe', () => {
  // Extra OLD items cannot know about anything that happened later. Being too narrow
  // would silently hide real posts, which is the direction that costs recall invisibly.
  const sinceMs = 1_800_000_000_999;
  const rendered = toSearchQuery(query({ sinceMs }));
  assert.ok(rendered.includes(`since_time:${Math.floor(sinceMs / 1000)}`));
});

/* ── ★ the cutoff ─────────────────────────────────────────────────────── */

test('★ the ceiling is rendered one whole second BELOW the instant we mean', () => {
  // The operator takes whole seconds and its inclusivity AT the boundary second is
  // undocumented, so the last provably-safe value is the second before. The cost is
  // under two seconds of recall; the alternative is a verification tolerance, and a
  // tolerance is a hole with a number on it.
  assert.equal(cutoffSecond(1_800_000_000_000), 1_799_999_999);
  assert.equal(cutoffSecond(1_800_000_000_500), 1_799_999_999);
  assert.equal(cutoffSecond(1_800_000_000_999), 1_799_999_999);
  // Never negative, whatever nonsense arrives.
  assert.equal(cutoffSecond(0), 0);

  const rendered = toSearchQuery(query({ untilMs: 1_800_000_000_500 }));
  assert.ok(rendered.includes('until_time:1799999999'));
});

test('★ the cutoff is pushed into the QUERY, never applied to the response', () => {
  // Filtering after the fact still spends budget on results we must not look at, and
  // a result that reached this process has already had the chance to leak.
  const rendered = toSearchQuery(query({ sinceMs: 1_700_000_000_000, untilMs: 1_800_000_000_000 }));
  assert.equal(rendered, 'chillguy since_time:1700000000 until_time:1799999999');
});

test('★ an item published at or after the cutoff FAILS the page — it is not filtered out', () => {
  // This is the port's ★ made real. Filtering keeps the passing items and proceeds on
  // a set chosen after the fact; this returns nothing and fails the call, so nothing
  // that arrived after the cutoff can reach a decision.
  const untilMs = 1_800_000_000_000;
  const items = itemsFrom([post('1', untilMs - 60_000), post('2', untilMs)]);

  assert.throws(
    () => requireCutoffHonoured(items, untilMs),
    (error: unknown) => {
      assert.ok(error instanceof CutoffNotHonoured);
      assert.equal(error.sourceItemId, '2');
      assert.equal(error.postedAt, untilMs);
      assert.equal(error.untilMs, untilMs);
      // The message has to tell whoever reads it that past runs are suspect, because
      // the failure it names is retroactive.
      assert.ok(error.message.includes('contaminated'));
      return true;
    },
  );
});

test('★ CutoffNotHonoured is neither an outage nor a shape error, and that is deliberate', () => {
  // Retrying produces the same contaminated page, so a caller that retries on
  // unavailability would spend money in a loop for nothing; and the shape is fine, so
  // pointing the next reader at a schema change sends them to the wrong file.
  const untilMs = 1_800_000_000_000;
  try {
    requireCutoffHonoured(itemsFrom([post('2', untilMs + 1)]), untilMs);
    assert.fail('the breach was accepted');
  } catch (error) {
    assert.ok(error instanceof CutoffNotHonoured);
    assert.equal(error.name, 'CutoffNotHonoured');
    assert.equal(String(error.source), 'x');
  }
});

test('★ an item we cannot DATE fails the page too, under a cutoff', () => {
  // Everywhere else an unknown is carried as an unknown. Here it cannot be: the claim
  // being made about the whole page is that nothing in it is from after the instant,
  // and an item with no readable timestamp is one we cannot make that claim about.
  const untilMs = 1_800_000_000_000;
  assert.throws(
    () => requireCutoffHonoured(itemsFrom([post('3', null)]), untilMs),
    (error: unknown) => {
      assert.ok(error instanceof CutoffNotHonoured);
      assert.equal(error.postedAt, null);
      return true;
    },
  );
});

test('an undateable item is perfectly fine when there is NO cutoff', async () => {
  // The strictness above is bought by the cutoff and must not leak into live
  // discovery, where an unparseable date is just a null timestamp on one item.
  const client = clientReturning({ items: [post('3', null)], cursor: null, hasMore: false });
  const result = await searchPage(client, query(), AT);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.postedAt, null);
});

test('★ a page that honours the cutoff passes through untouched', async () => {
  const untilMs = 1_800_000_000_000;
  const client = clientReturning({
    items: [post('1', untilMs - 3_600_000), post('2', untilMs - 1)],
    cursor: 'NEXT',
    hasMore: true,
  });
  const result = await searchPage(client, query({ untilMs }), AT);
  assert.equal(result.items.length, 2);
  assert.equal(result.cursor, 'NEXT');
  assert.equal(result.hasMore, true);
});

test('★ a breach fails the call rather than returning the items that passed', async () => {
  const untilMs = 1_800_000_000_000;
  const client = clientReturning({
    items: [post('1', untilMs - 1), post('2', untilMs + 60_000)],
    cursor: 'NEXT',
    hasMore: true,
  });
  await assert.rejects(searchPage(client, query({ untilMs }), AT), CutoffNotHonoured);
});

/* ── what a page costs ────────────────────────────────────────────────── */

test('★ a call that returns NOTHING still books a whole unit', async () => {
  // The vendor charges a floor per request — "even if no data returned" — and
  // reporting items.length booked $0.00 against a real charge. The understatement
  // lands entirely on empty calls, which is the tracking path, which is where the
  // money is.
  assert.equal(billedUnits(0), 1);
  assert.equal(billedUnits(1), 1);
  assert.equal(billedUnits(20), 20);

  const client = clientReturning({ items: [], cursor: null, hasMore: false });
  const result = await searchPage(client, query(), AT);
  assert.equal(result.units, 1, 'an empty page was booked as free');
});

test('units are measured from the response, not from the limit we asked for', async () => {
  const client = clientReturning({ items: [post('1', AT - 1), post('2', AT - 1)], cursor: null, hasMore: false });
  const result = await searchPage(client, query({ limit: 100 }), AT);
  assert.equal(result.units, 2);
});

test('the page is sliced to the limit, which caps translation and not correctness', async () => {
  const raws = [post('1', AT - 1), post('2', AT - 1), post('3', AT - 1)];
  const client = clientReturning({ items: raws, cursor: null, hasMore: false });
  const result = await searchPage(client, query({ limit: 2 }), AT);
  assert.equal(result.items.length, 2);
  // Billed for what came back, not for what we kept: the vendor charged for three.
  assert.equal(result.units, 3);
});

test('hasMore comes from the vendor and is never inferred from the page size', async () => {
  const client = clientReturning({ items: [], cursor: 'MORE', hasMore: true });
  const result = await searchPage(client, query(), AT);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.items, []);
});

/* ── the query the client is actually handed ──────────────────────────── */

test('the rendered query, not the raw term, is what reaches the client', async () => {
  const seen: { query: string | null; cursor: string | null } = { query: null, cursor: null };
  const client: XClient = {
    search: async (q, cursor) => {
      seen.query = q;
      seen.cursor = cursor;
      return { items: [], cursor: null, hasMore: false };
    },
    lookup: async () => [],
  };
  const untilMs: Millis = 1_800_000_000_000;
  await searchPage(client, query({ cursor: 'PAGE2', untilMs }), AT);
  assert.equal(seen.query, `chillguy until_time:${cutoffSecond(untilMs)}`);
  assert.equal(seen.cursor, 'PAGE2');
});
