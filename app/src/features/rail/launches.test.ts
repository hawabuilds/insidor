/**
 * THE LAUNCHES RAIL, ASSERTED.
 *
 * There is no rendering test here because there is no DOM in this test runner — the same
 * situation `board-order.test.ts` describes, and the same response: everything the rail
 * DECIDES lives in `launches.ts`, so all of it is reachable from a test, and `LiveRail.tsx`
 * is left holding a fetch loop and some JSX. What a component cannot be tested for is
 * covered at the end of this file by asserting on its source, which is a grep and is
 * honest about being one.
 *
 * The four failures being guarded against:
 *   - a bounded mint time rendered as though it were a reading;
 *   - a missing market cap rendered as $0;
 *   - a failed request rendered as an empty market;
 *   - a token name reaching the DOM as anything other than text.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { ReadError } from '../../shared/api/index.ts';
import type { Launch } from '../../shared/api/index.ts';
import { launchAge, launchRows, railView } from './launches.ts';

const T0 = 1_755_079_200_000;
const SECOND = 1_000;
const MIN = 60 * SECOND;

function launch(over: Partial<Launch> = {}): Launch {
  return {
    launchId: 'solana:9xJersey',
    ticker: 'JERSEY',
    name: 'jersey',
    address: '9xJerseyA1qP2mNvKdRt7sZbFgHyCwXeUoTiLkMnPq',
    venueLabel: 'Pump.fun',
    mintedAt: { known: true, at: T0 - 3 * MIN },
    mintedAtBoundS: 20,
    marketCapUsd: { known: false, pending: 'no_market' },
    marketCapBasis: null,
    ...over,
  };
}

/* ── ★ the age, and what we are entitled to claim about it ────────────── */

test('★ a bounded mint time renders with a tilde and states the bound in words', () => {
  const { age, label } = launchAge(launch({ mintedAtBoundS: 20 }), T0);
  assert.equal(age.kind, 'value');
  assert.equal(age.text, '~3m');
  assert.equal(label, 'minted about 3m ago, give or take 20s');
});

test('★ an exact mint time renders plain, so the tilde means something', () => {
  /* If everything carried a tilde it would be decoration. The only rows entitled to a bare
     age are the ones a chain confirmation landed for, which is what 0005's
     `exact_requires_real_source` exists to police on the far side. */
  const { age, label } = launchAge(launch({ mintedAtBoundS: null }), T0);
  assert.equal(age.text, '3m');
  assert.equal(label, 'minted 3m ago');
});

test('★ an unknown mint time is a dash, never "0s"', () => {
  /* The specific failure this product cannot afford: an age of zero reads as brand new, so
     the coins we know least about would sort to the top of a list whose entire subject is
     earliness. */
  const { age, label } = launchAge(
    launch({ mintedAt: { known: false, pending: 'not_read_yet' }, mintedAtBoundS: null }),
    T0,
  );
  assert.equal(age.kind, 'pending');
  assert.notEqual(age.text, '0s');
  assert.equal(label, 'reading');
});

test('a mint time in the future is unreadable, not a negative age', () => {
  const { age } = launchAge(launch({ mintedAt: { known: true, at: T0 + 5 * MIN } }), T0);
  assert.equal(age.kind, 'pending');
  if (age.kind === 'pending') assert.equal(age.reason, 'unreadable');
});

test('a bound smaller than a second is still stated, never rounded away to nothing', () => {
  const { label } = launchAge(launch({ mintedAtBoundS: 1 }), T0);
  assert.equal(label, 'minted about 3m ago, give or take 1s');
});

test('★ a fractional bound rounds UP, so the caveat is never deleted while the tilde stays', () => {
  /* `formatDuration` floors, which is right for an age and wrong for a bound: half a second
     phrased as "give or take 0s" is an exact time wearing an apology. Our own projector
     floors this at one second, so this fires only against a server that does not — and the
     safe direction for a bound is always wider than it is. */
  const { age, label } = launchAge(launch({ mintedAtBoundS: 0.4 }), T0);
  assert.equal(age.text, '~3m', 'still bounded, so still a tilde');
  assert.equal(label, 'minted about 3m ago, give or take 1s');
  assert.equal(label.includes('0s'), false);
});

/* ── the rows ─────────────────────────────────────────────────────────── */

test('★ a coin with no market shows a dash, never $0', () => {
  const [row] = launchRows([launch()], T0);
  assert.equal(row?.cap.kind, 'pending');
  assert.notEqual(row?.cap.text, '$0');
  if (row?.cap.kind === 'pending') assert.equal(row.cap.reason, 'no_market');
});

test('a coin with a market shows the cap', () => {
  const [row] = launchRows([launch({ marketCapUsd: { known: true, amount: 31_400 } })], T0);
  assert.deepEqual(row?.cap, { kind: 'value', text: '$31.4K' });
});

test('the address is shown truncated and the row never holds the whole thing', () => {
  const [row] = launchRows([launch()], T0);
  assert.equal(row?.address, '9xJe…MnPq');
  assert.equal(row?.address.includes('A1qP2mNvKdRt'), false);
});

test('a short address is shown whole rather than mangled into an ellipsis', () => {
  const [row] = launchRows([launch({ address: 'abc' })], T0);
  assert.equal(row?.address, 'abc');
});

test('a coin with no ticker gets the placeholder tile and an empty ticker', () => {
  /* Not the address, not the name, not the first letter of either — an unknown ticker
     renders as nothing, because anything else would look like a ticker to a person
     deciding what to buy. */
  const [row] = launchRows([launch({ ticker: '' })], T0);
  assert.equal(row?.ticker, '');
  assert.equal(row?.tile, '?');
});

test('a tile takes a whole code point, not half a surrogate pair', () => {
  const [row] = launchRows([launch({ ticker: '🚀MOON' })], T0);
  assert.equal(row?.tile, '🚀');
});

test('★ the order is the server\'s and nothing here sorts it', () => {
  /* Newest first was decided by the projector against mint times this package cannot read.
     A client-side sort would be a second opinion about the one thing the rail claims. */
  const rows = launchRows(
    [
      launch({ launchId: 'solana:c', mintedAt: { known: true, at: T0 - 30 * MIN } }),
      launch({ launchId: 'solana:a', mintedAt: { known: true, at: T0 - 1 * MIN } }),
      launch({ launchId: 'solana:b', mintedAt: { known: true, at: T0 - 10 * MIN } }),
    ],
    T0,
  );
  assert.deepEqual(rows.map((r) => r.key), ['solana:c', 'solana:a', 'solana:b']);
});

test('the list is capped, and the cap keeps the newest rather than the cheapest', () => {
  const many = Array.from({ length: 90 }, (_, i) => launch({ launchId: `solana:${i}` }));
  const rows = launchRows(many, T0);
  assert.ok(rows.length < many.length, 'the rail is a scroller, not an archive');
  assert.equal(rows[0]?.key, 'solana:0', 'the cap is applied after the order, not before it');
});

/* ── ★ the four states, and that none of them looks like another ──────── */

test('before the first read there are no rows, no count and no invented card', () => {
  const view = railView({ feed: null, failure: null, lastOkAt: null, now: T0 });
  assert.deepEqual(view.rows, []);
  assert.equal(view.live, false);
  assert.equal(view.count, '—', 'a dash, because we do not have a count — not a zero');
  assert.equal(view.notice, null);
  assert.notEqual(view.empty, null, 'the shape is on screen and it says what is happening');
});

test('a frame with rows is live, counted, and carries no banner', () => {
  const view = railView({
    feed: { tick: 4, launches: [launch(), launch({ launchId: 'solana:b' })] },
    failure: null,
    lastOkAt: T0 - 4 * SECOND,
    now: T0,
  });
  assert.equal(view.rows.length, 2);
  assert.equal(view.count, '2');
  assert.equal(view.live, true);
  assert.equal(view.notice, null);
  assert.equal(view.empty, null);
});

test('★ the header count is the FRAME\'s, not the number of rows that fit', () => {
  /* The regression this guards: the count was read off the capped render list, so a frame
     of forty-one mints was announced as thirty — and the empty branch reads this number out
     loud as a statement about the world ("no coins minted in the window"), which makes a
     count that silently means "rows in the DOM" a claim about the market that is wrong. */
  const many = Array.from({ length: 41 }, (_, i) => launch({ launchId: `solana:${i}` }));
  const view = railView({ feed: { tick: 3, launches: many }, failure: null, lastOkAt: T0, now: T0 });
  assert.equal(view.count, '41', 'the count is what the feed reported');
  assert.ok(view.rows.length < many.length, 'and the rail still renders only what it holds');
});

test('★ a list shorter than its frame says so, so the last row is not read as the last mint', () => {
  const many = Array.from({ length: 41 }, (_, i) => launch({ launchId: `solana:${i}` }));
  const view = railView({ feed: { tick: 3, launches: many }, failure: null, lastOkAt: T0, now: T0 });
  assert.notEqual(view.overflow, null);
  assert.match(view.overflow ?? '', /Showing the newest 30 of 41/);
  /* Not amber and not a fault: nothing is wrong, so it must not arrive as a notice. */
  assert.equal(view.notice, null);
});

test('a frame that fits carries no overflow line at all', () => {
  const view = railView({
    feed: { tick: 3, launches: [launch(), launch({ launchId: 'solana:b' })] },
    failure: null,
    lastOkAt: T0,
    now: T0,
  });
  assert.equal(view.overflow, null);
  assert.equal(view.count, '2');
});

test('★ the status says when we last asked, and never says the feed is live', () => {
  /* There is no live channel behind this — it is a poll — and a pill reading "feed live"
     over a six second interval is the same lie rail.module.css refuses for the pip. */
  const view = railView({ feed: { tick: 1, launches: [launch()] }, failure: null, lastOkAt: T0 - 4 * SECOND, now: T0 });
  assert.equal(view.status, 'updated 4s ago');
  assert.equal(view.status.includes('live'), false);
  assert.equal(view.status.includes('stream'), false);
});

test('★ an empty frame is a real zero under an empty card — a quiet market, not a fault', () => {
  const view = railView({ feed: { tick: 7, launches: [] }, failure: null, lastOkAt: T0, now: T0 });
  assert.deepEqual(view.rows, []);
  assert.equal(view.count, '0', 'we asked, we got an answer, and the answer was none');
  assert.equal(view.live, true);
  assert.equal(view.notice, null, 'nothing is wrong, so nothing amber');
  assert.notEqual(view.empty, null);
});

test('★ a failed first read is a NOTICE, not an empty rail', () => {
  /* The whole reason the error state exists: a rail that renders nothing on a 500 is
     indistinguishable from a rail over a market where nothing is being minted, and the
     second one is a legitimate answer. */
  const view = railView({ feed: null, failure: new ReadError('/launches/default', 500), lastOkAt: null, now: T0 });
  assert.deepEqual(view.rows, []);
  assert.equal(view.live, false);
  assert.equal(view.count, '—');
  assert.notEqual(view.notice, null);
  assert.equal(view.empty, null, 'an empty card here would claim the market is quiet');
  assert.match(view.notice?.detail ?? '', /could not ask/);
});

test('a 404 says the feed has never been projected, which is a different fact', () => {
  const view = railView({ feed: null, failure: new ReadError('/launches/default', 404), lastOkAt: null, now: T0 });
  assert.match(view.notice?.headline ?? '', /No launches feed has been projected/);
});

test('★ a failure never puts the error\'s own words on the screen', () => {
  /* A ReadError would only be unhelpful; anything else could carry a hostname, a stack, or
     a fragment of a payload somebody minted. So the sentences are chosen here and the error
     object is read for its status and nothing else. */
  const nasty = new Error('permission denied for table market_reading at pg://user:pw@host');
  const view = railView({ feed: null, failure: nasty, lastOkAt: null, now: T0 });
  const shown = `${view.status} ${view.notice?.headline ?? ''} ${view.notice?.detail ?? ''}`;
  for (const word of ['permission', 'market_reading', 'pg://', 'host']) {
    assert.equal(shown.includes(word), false, `the rail leaked ${word}`);
  }
});

test('a failure on top of rows we hold keeps the rows and says they are not updating', () => {
  /* Blanking them would throw away true information because a LATER request failed. The
     rows were real when they were read; what has changed is that they are no longer being
     refreshed, and that is what the banner says. */
  const view = railView({
    feed: { tick: 4, launches: [launch()] },
    failure: new ReadError('/launches/default', 503),
    lastOkAt: T0 - 8 * SECOND,
    now: T0,
  });
  assert.equal(view.rows.length, 1);
  assert.equal(view.live, false, 'the pip goes out the moment we stop being current');
  assert.match(view.notice?.headline ?? '', /stopped answering/);
});

test('★ a frame nobody has been able to refresh stops claiming to be live', () => {
  /* Not every failure throws. A run of very slow responses leaves `failure` null and the
     last frame in place, and a rail that kept pulsing through it would be claiming currency
     it does not have. */
  const view = railView({
    feed: { tick: 4, launches: [launch()] },
    failure: null,
    lastOkAt: T0 - 5 * MIN,
    now: T0,
  });
  assert.equal(view.live, false);
  assert.notEqual(view.notice, null);
  assert.equal(view.rows.length, 1, 'the rows are still true, they are just not fresh');
});

/* ── ★ the component, greped ──────────────────────────────────────────── */

/**
 * The component's source with its comments removed.
 *
 * Stripping them is not cosmetic: the comments in `LiveRail.tsx` explain at length that the
 * rail must never build an `href` from a token name, so a grep that cannot tell an
 * explanation from an instruction fails on the very prose that documents the rule. This is
 * the same reason `store/src/migrations.test.ts` strips comments before looking for a DROP.
 */
const RAIL_TSX = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'LiveRail.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ');

test('★ the rail renders token metadata as TEXT: no markup, no link, no image', () => {
  /* A token's name, symbol and address are typed by whoever minted the coin. A grep is a
     poor tool and it is the only one available without a DOM, so it is aimed at the exact
     constructs that would turn one of those strings into something the browser executes or
     fetches. The projection already bounds and strips them; this is the second door. */
  assert.equal(RAIL_TSX.includes('dangerouslySetInnerHTML'), false);
  assert.equal(/\bhref\s*=/.test(RAIL_TSX), false, 'no anchor, so no URL built from a name');
  assert.equal(/\bsrc\s*=/.test(RAIL_TSX), false, 'no <img>, so no request to a chosen host');
  assert.equal(/\bwindow\.open\b/.test(RAIL_TSX), false);
  assert.equal(/\binnerHTML\b/.test(RAIL_TSX), false);
});

test('the rail makes no product judgement of its own', () => {
  /* Everything the tab decides is in launches.ts, where these tests can reach it. A
     comparison appearing in the component would be a rule nothing above can assert. */
  assert.equal(/[<>]=?\s*\d/.test(RAIL_TSX), false);
});
