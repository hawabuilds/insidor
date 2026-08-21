/**
 * The push-to-pull bridge, driven by a fake stream.
 *
 * What is under test is not "does it return the events". It is the four claims a
 * page makes about a window, because every one of them is a claim the coverage
 * log will treat as evidence: that the window started where the last one ended,
 * that it ends no later than the read did, that the page either covers it or
 * says it cannot, and that any interval nobody was listening to is named.
 *
 * A stream that got the events right and any one of those wrong looks perfect in
 * every log line and produces a coverage table that lies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { MintEvent } from '@insidor/contracts';

import { coldCursor, type MintCursor } from './cursor.ts';
import { createStreamFeed } from './stream-feed.ts';
import type { MintStream, StreamDrain, StreamOutage } from './stream.ts';

const FEED = 'solana-mints';
const T0 = 1_785_912_030_000;

function mint(address: string, seenAt: number): MintEvent {
  const mintedAt = { at: seenAt - 5_000, source: 'vendor_field', confidence: 'bounded', boundS: 5 } as const;
  return {
    asset: {
      ref: { chain: 'solana', address } as MintEvent['asset']['ref'],
      key: `solana:${address}` as MintEvent['asset']['key'],
      chain: 'solana' as MintEvent['asset']['chain'],
      venue: 'solana:pumpfun' as MintEvent['asset']['venue'],
      /* What a push transport delivers, which is what this file is a test of. The value
         is stamped by the venue adapter's stream decoder, not by this service — see the
         note there on why the transport-agnostic side must not hold a table mapping a
         configured transport name onto an origin. */
      origin: 'live_stream',
      mintedAt,
      symbol: null,
      name: null,
      imageUri: null,
      decimals: 6,
      creator: null,
      declaredSocial: {},
      firstSeenAt: seenAt,
    },
    venue: 'solana:pumpfun' as MintEvent['venue'],
    mintedAt,
    seenAt,
  };
}

interface FakeStream extends MintStream {
  next: StreamDrain;
  liveNow: boolean;
  liveFrom: number | null;
  stopped: boolean;
  drains: number[];
}

function fakeStream(): FakeStream {
  const s: FakeStream = {
    next: { events: [], limited: false, dropped: 0, outages: [] },
    liveNow: true,
    liveFrom: T0,
    stopped: false,
    drains: [],
    start: () => undefined,
    stop: () => {
      s.stopped = true;
    },
    live: () => s.liveNow,
    liveSince: () => s.liveFrom,
    drain: (limit) => {
      s.drains.push(limit);
      const taken = s.next;
      s.next = { events: [], limited: false, dropped: 0, outages: [] };
      return taken;
    },
    position: () => 'delivered=7',
  };
  return s;
}

function feedOf(stream: MintStream, clock: { now: number }) {
  const notes: string[] = [];
  const feed = createStreamFeed({
    feedId: FEED,
    stream,
    now: () => clock.now,
    note: (msg) => notes.push(msg),
  });
  return { feed, notes };
}

/**
 * A cursor left behind by a previous run, and the instant it stopped reading at.
 *
 * The instant is a separate constant because `MintCursor.readAt` is `Millis | null`
 * — null is a cold start, and that nullability is the whole reason a restart is
 * declarable at all — so arithmetic on `WARM.readAt` does not typecheck. The fix is
 * NOT a non-null assertion on the cursor: that would silence the one property this
 * file exists to exercise. It is to name the number once and build the cursor from
 * it, so `WARM` keeps the port's real type and the tests keep a number to do sums
 * with.
 */
const WARM_READ_AT = T0 - 30_000;
const WARM: MintCursor = { feedId: FEED, position: 'delivered=0', readAt: WARM_READ_AT };

/* ── the window ─────────────────────────────────────────────────────────── */

test('the first read after a restart starts where the previous run stopped', () => {
  // Starting at `now` instead would move the window past the restart, which
  // erases the one window a restart is guaranteed to have missed.
  const clock = { now: T0 };
  const stream = fakeStream();
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.equal(page.from, WARM.readAt);
    assert.equal(page.to, T0);
  });
});

test('a cold cursor starts at now, because there is no earlier window to claim', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = T0 - 1_000;
  const { feed } = feedOf(stream, clock);

  return feed.read(coldCursor(FEED), 100, new AbortController().signal).then((page) => {
    assert.equal(page.from, T0);
    assert.deepEqual(page.blind, [], 'nothing was missed: nothing was ever watched');
  });
});

test('each window starts where the last one ended, with no overlap and no hole', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  const { feed } = feedOf(stream, clock);
  const signal = new AbortController().signal;

  return feed
    .read(WARM, 100, signal)
    .then((first) => {
      clock.now = T0 + 3_000;
      return feed.read(first.cursor, 100, signal).then((second) => {
        assert.equal(second.from, first.to);
        assert.equal(second.to, T0 + 3_000);
      });
    });
});

test('★ a window is always strictly forward, even inside one millisecond', () => {
  // `internal.mint_coverage` carries `check (window_to > window_from)`. A read
  // that completes in the millisecond it started would fail that INSERT, turning
  // a fast cycle into an error and an error into a gap we invented.
  const clock = { now: T0 };
  const stream = fakeStream();
  const { feed } = feedOf(stream, clock);
  const signal = new AbortController().signal;

  return feed.read({ feedId: FEED, position: null, readAt: T0 }, 100, signal).then((page) => {
    assert.equal(page.from, T0);
    assert.ok(page.to > page.from);
  });
});

test('the cursor carries a non-null read instant, because the store refuses one without', () => {
  const clock = { now: T0 };
  const { feed } = feedOf(fakeStream(), clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.equal(page.cursor.readAt, page.to);
    assert.equal(page.cursor.feedId, FEED);
    assert.equal(page.cursor.position, 'delivered=7');
  });
});

/* ── the drain ──────────────────────────────────────────────────────────── */

test('a drain hands the buffered mints straight through', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.next = {
    events: [mint('A'.repeat(40), T0 - 900), mint('B'.repeat(40), T0 - 300)],
    limited: false,
    dropped: 0,
    outages: [],
  };
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.equal(page.mints.length, 2);
    assert.equal(page.pageFull, false);
    assert.deepEqual(stream.drains, [100], 'the limit reaches the buffer unchanged');
  });
});

test('a drain that hit its limit is a page that cannot prove it covered its window', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.next = { events: [mint('A'.repeat(40), T0)], limited: true, dropped: 0, outages: [] };
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 1, new AbortController().signal).then((page) => {
    assert.equal(page.pageFull, true);
  });
});

test('★ an overflow is a full page, which is how a lost event becomes a recorded gap', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.next = { events: [], limited: false, dropped: 12, outages: [] };
  const { feed, notes } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.equal(
      page.pageFull,
      true,
      'events were destroyed; a page of zero that reads as complete is the lie',
    );
    assert.ok(notes.some((n) => n.includes('overflowed')), 'and it is never silent');
  });
});

/* ── ★ the gaps ─────────────────────────────────────────────────────────── */

test('★ a clean read reports no blind window at all', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = WARM.readAt;
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.deepEqual(page.blind, [], 'an invented gap censors labels for nothing');
  });
});

test('★ the restart window is declared, even when it is shorter than the tolerance', () => {
  // `coverage.observed()` would also catch this — but only above the tolerance,
  // and the tolerance is about read CADENCE jitter. A four-second redeploy is
  // under it and genuinely lost four seconds of mints, because a stream has no
  // cursor to go back and fetch them with.
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = T0 - 26_000;
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.equal(page.blind.length, 1);
    assert.equal(page.blind[0]?.kind, 'not_watching');
    assert.equal(page.blind[0]?.fromMs, WARM.readAt, 'from where the previous run stopped');
    assert.equal(page.blind[0]?.toMs, T0 - 26_000, 'to when this one came live');
  });
});

test('the restart window is declared once, not on every read', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = T0 - 26_000;
  const { feed } = feedOf(stream, clock);
  const signal = new AbortController().signal;

  return feed.read(WARM, 100, signal).then((first) => {
    assert.equal(first.blind.length, 1);
    clock.now = T0 + 3_000;
    return feed.read(first.cursor, 100, signal).then((second) => {
      assert.deepEqual(second.blind, [], 'the same hole must not be counted twice');
    });
  });
});

test('a cold start declares no restart window', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = T0 - 1_000;
  const { feed } = feedOf(stream, clock);

  return feed.read(coldCursor(FEED), 100, new AbortController().signal).then((page) => {
    assert.deepEqual(page.blind, []);
  });
});

test('a socket that came live BEFORE the previous run stopped declares nothing', () => {
  // Not a real ordering, but a clock skew or a duplicated deploy could produce
  // it, and a backwards window fails the coverage row's forward check.
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = WARM_READ_AT - 5_000;
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.deepEqual(page.blind, []);
  });
});

test('★ a reconnect between two reads becomes a blind window, and the mints still flow', () => {
  // Both reads succeeded, on time. There is no silence for `coverage.observed()`
  // to measure, so without this the window is recorded as watched and every coin
  // minted inside it becomes a coin that "did not appear".
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = WARM.readAt;
  const outage: StreamOutage = {
    fromMs: T0 - 20_000,
    toMs: T0 - 8_000,
    detail: 'mint stream was not delivering for 12000ms',
  };
  stream.next = { events: [mint('A'.repeat(40), T0 - 2_000)], limited: false, dropped: 0, outages: [outage] };
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.equal(page.blind.length, 1);
    // Its own kind, not `not_watching`: gap_reason is written as
    // `${kind}: ${detail}` and the watchdog reads that prefix AS the kind, so a
    // socket that dropped mid-run has to be filterable apart from a redeploy.
    assert.equal(page.blind[0]?.kind, 'stream_disconnect');
    assert.equal(page.blind[0]?.fromMs, T0 - 20_000);
    assert.equal(page.blind[0]?.toMs, T0 - 8_000);
    assert.equal(page.blind[0]?.detail, outage.detail);
    assert.equal(page.mints.length, 1, 'the buffered mints go out on the same cycle');
    assert.ok(page.to > page.from, 'and the window is still a window');
  });
});

test('a zero-width outage is discarded rather than written', () => {
  // The coverage row it would become fails `window_to > window_from`, and one
  // bad window would fail the whole cycle — including the mints on the page.
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveFrom = WARM.readAt;
  stream.next = {
    events: [],
    limited: false,
    dropped: 0,
    outages: [{ fromMs: T0 - 5_000, toMs: T0 - 5_000, detail: 'no width' }],
  };
  const { feed, notes } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then((page) => {
    assert.deepEqual(page.blind, []);
    assert.ok(notes.some((n) => n.includes('no width')));
  });
});

/* ── ★ refusing to claim a window we were not watching ──────────────────── */

test('★ a read while the socket is down FAILS rather than returning an empty page', () => {
  // An empty page is a successful read: it extends the watermark, advances the
  // cursor, writes coverage over the window and keeps the health endpoint
  // answering 200. A process whose socket died an hour ago would report itself
  // healthy while writing an hour of rows claiming it watched a dead stream.
  const clock = { now: T0 };
  const stream = fakeStream();
  stream.liveNow = false;
  stream.liveFrom = null;
  const { feed } = feedOf(stream, clock);

  return feed.read(WARM, 100, new AbortController().signal).then(
    () => assert.fail('a disconnected stream must not report a covered window'),
    (e: unknown) => {
      assert.match(String(e), /not connected/);
      assert.deepEqual(stream.drains, [], 'and the buffered mints are left where they are');
    },
  );
});

test('★ a socket that goes half-open between two reads gets no page at all', () => {
  /*
   * The nastiest failure this transport has, modelled at the seam where it
   * matters. A half-open socket is TCP-alive and delivering nothing, so it is
   * the transport's own staleness check — asked through `live()` — that notices,
   * and the ONLY thing standing between that discovery and a coverage row is
   * the order these two calls happen in.
   *
   * `live()` is therefore not a cached flag here: it reports the staleness the
   * first time it is asked, exactly as the real stream does. If this feed ever
   * drained first and asked afterwards, the page below would come back empty,
   * clean, and covering a window nobody was listening to — and the supervisor
   * would write it as observed with `gap = false`.
   */
  const clock = { now: T0 };
  const stream = fakeStream();
  let asked = 0;
  stream.live = () => {
    asked += 1;
    // The socket was already silent; the question is what makes us notice.
    stream.liveNow = false;
    return false;
  };

  const { feed } = feedOf(stream, clock);
  return feed.read(WARM, 100, new AbortController().signal).then(
    () => assert.fail('a stream that has just been found dead must not report a covered window'),
    (e: unknown) => {
      assert.match(String(e), /not connected/);
      assert.equal(asked, 1, 'liveness is consulted');
      assert.deepEqual(
        stream.drains,
        [],
        'and consulted BEFORE the drain, so the buffered mints are not spent on a page we discard',
      );
    },
  );
});

test('a failed read does not move the feed window, so the next success measures the hole', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  const { feed } = feedOf(stream, clock);
  const signal = new AbortController().signal;

  return feed.read(WARM, 100, signal).then((first) => {
    stream.liveNow = false;
    clock.now = T0 + 3_000;
    return feed.read(first.cursor, 100, signal).then(
      () => assert.fail('expected a refusal'),
      () => {
        stream.liveNow = true;
        clock.now = T0 + 40_000;
        return feed.read(first.cursor, 100, signal).then((third) => {
          assert.equal(third.from, first.to, 'the window still starts at the last SUCCESS');
          assert.equal(third.to, T0 + 40_000);
        });
      },
    );
  });
});

/* ── shutdown ───────────────────────────────────────────────────────────── */

test('★ aborting stops the socket, so the process can actually exit', () => {
  // The signal handed to `read` is the shutdown controller. A socket and its
  // reconnect timer keep a Node process alive after the loop ends, and the
  // answer to that upstairs is a grace timer that exits non-zero and leaves an
  // open run row.
  const clock = { now: T0 };
  const stream = fakeStream();
  const { feed } = feedOf(stream, clock);
  const ac = new AbortController();

  return feed.read(WARM, 100, ac.signal).then(() => {
    assert.equal(stream.stopped, false);
    ac.abort();
    assert.equal(stream.stopped, true);
  });
});

test('a read on an already-aborted signal stops the socket and refuses', () => {
  const clock = { now: T0 };
  const stream = fakeStream();
  const { feed } = feedOf(stream, clock);
  const ac = new AbortController();
  ac.abort();

  return feed.read(WARM, 100, ac.signal).then(
    () => assert.fail('expected a refusal'),
    () => {
      assert.equal(stream.stopped, true);
    },
  );
});

test('the feed reports the transport it actually is', () => {
  const { feed } = feedOf(fakeStream(), { now: T0 });
  assert.equal(feed.transport, 'stream');
  assert.equal(feed.id, FEED);
});
