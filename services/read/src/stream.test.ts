/**
 * The live channel, against a fake response and a fake database. No socket, no port, no pg.
 *
 * Each test is one claim the transport has to keep, and they are the claims that only show
 * up in production if nobody writes them down here: every attach forces a refetch, a
 * disconnected client stops costing anything, a client that has stopped reading is dropped
 * rather than buffered for, and a burst of announcements is one read rather than a read per
 * announcement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SILENT } from './log.ts';
import { BOARD_ROWS_SQL, BOARD_VIEW_SQL, type Row } from './queries.ts';
import { createBoardStream, type StreamSink } from './stream.ts';

/** Lets the promise chain inside `publish` run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

interface FakeSink extends StreamSink {
  readonly chunks: string[];
  head: { status: number; headers: Readonly<Record<string, string>> } | null;
  ended: string | null;
  destroyed: boolean;
  /** What `write` returns. False is a socket whose buffer is full. */
  accepting: boolean;
  fire(event: 'close' | 'drain' | 'error'): void;
  /** Every chunk written, joined — the byte stream the browser would see. */
  text(): string;
}

function fakeSink(): FakeSink {
  const listeners = new Map<string, (() => void)[]>();
  const sink: FakeSink = {
    chunks: [],
    head: null,
    ended: null,
    destroyed: false,
    accepting: true,
    writeHead(status, headers) {
      sink.head = { status, headers };
    },
    write(chunk) {
      sink.chunks.push(chunk);
      return sink.accepting;
    },
    end(chunk) {
      sink.ended = chunk ?? '';
    },
    destroy() {
      sink.destroyed = true;
    },
    on(event, listener) {
      const set = listeners.get(event) ?? [];
      set.push(listener);
      listeners.set(event, set);
    },
    fire(event) {
      for (const l of listeners.get(event) ?? []) l();
    },
    text: () => sink.chunks.join(''),
  };
  return sink;
}

interface FakeDb {
  query(sql: string, params: readonly unknown[]): Promise<readonly Row[]>;
  readonly calls: string[];
  tick: number;
}

function fakeDb(views: readonly string[] = ['default']): FakeDb {
  const db: FakeDb = {
    calls: [],
    tick: 41,
    async query(sql, params) {
      db.calls.push(sql);
      const viewId = String(params[0]);
      if (sql === BOARD_VIEW_SQL) return views.includes(viewId) ? [{ tick: String(db.tick) }] : [];
      if (sql === BOARD_ROWS_SQL) return [{ story_id: 'st_ferry', payload: { id: 'st_ferry' } }];
      return [];
    },
  };
  return db;
}

const CORS = { 'cache-control': 'no-store', vary: 'origin' } as const;

test('only GET /stream/board/:viewId is a stream request', () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  try {
    assert.equal(stream.match('GET', '/stream/board/default'), 'default');
    assert.equal(stream.match('GET', '/stream/board/default?x=1'), 'default');
    assert.equal(stream.match('GET', '/stream/board/a%2Fb'), 'a/b', 'the id is decoded once, after the split');
    assert.equal(stream.match('POST', '/stream/board/default'), null);
    assert.equal(stream.match('GET', '/board/default'), null);
    assert.equal(stream.match('GET', '/stream/board'), null);
    assert.equal(stream.match('GET', '/stream/board/a/b'), null);
    assert.equal(stream.match('GET', '/stream/board/%zz'), null, 'a malformed escape is not a stream request');
  } finally {
    stream.close();
  }
});

test('★ every attach forces a refetch: the ready event is sent on connect and on reconnect', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  try {
    stream.linkUp();

    const first = fakeSink();
    await stream.attach(first, 'default', CORS);
    assert.equal(first.head?.status, 200);
    assert.equal(first.head?.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(first.head?.headers['cache-control'], 'no-store', 'the stream must not be cacheable either');
    assert.equal(first.head?.headers['vary'], 'origin');
    assert.equal(first.head?.headers['x-accel-buffering'], 'no');
    assert.match(first.text(), /retry: \d+/);
    assert.match(first.text(), /event: ready\ndata: 1\n\n/);

    /* The reconnect. A second attach is what EventSource does after a drop, and it has to
       produce the same refetch trigger — resuming without one is the bug this exists for. */
    const second = fakeSink();
    await stream.attach(second, 'default', CORS);
    assert.match(second.text(), /event: ready\ndata: 1\n\n/);
  } finally {
    stream.close();
  }
});

test('a client attaching while the listener is down is told so, not shown a live pip', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  try {
    const sink = fakeSink();
    await stream.attach(sink, 'default', CORS);
    assert.match(sink.text(), /event: hold\ndata: 1\n\n/);
    assert.doesNotMatch(sink.text(), /event: ready/);
  } finally {
    stream.close();
  }
});

test('the listener coming back tells every client to refetch, because NOTIFY has no replay', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  try {
    const a = fakeSink();
    const b = fakeSink();
    await stream.attach(a, 'default', CORS);
    await stream.attach(b, 'default', CORS);

    stream.linkUp();
    assert.match(a.text(), /event: ready/);
    assert.match(b.text(), /event: ready/);

    stream.linkDown();
    assert.equal((a.text().match(/event: hold/g) ?? []).length, 2, 'attached with hold, then told again');
  } finally {
    stream.close();
  }
});

test('an unknown view is a 404 the client can parse, never an empty stream', async () => {
  const stream = createBoardStream({ db: fakeDb(['default']), log: SILENT });
  try {
    const sink = fakeSink();
    await stream.attach(sink, 'nope', CORS);
    assert.equal(sink.head?.status, 404);
    assert.equal(sink.head?.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(sink.ended, '{"error":"not found"}');
    assert.equal(stream.size(), 0);
  } finally {
    stream.close();
  }
});

test('a published frame carries the committed board and reaches only that view', async () => {
  const stream = createBoardStream({ db: fakeDb(['default', 'other']), log: SILENT });
  try {
    stream.linkUp();
    const mine = fakeSink();
    const theirs = fakeSink();
    await stream.attach(mine, 'default', CORS);
    await stream.attach(theirs, 'other', CORS);

    stream.publish('default');
    await settle();

    const frame = /event: frame\ndata: (.*)\n\n/.exec(mine.text());
    assert.ok(frame?.[1], 'no frame reached the subscriber');
    assert.deepEqual(JSON.parse(frame[1]), {
      tick: 41,
      order: ['st_ferry'],
      rows: [{ id: 'st_ferry' }],
    });
    assert.doesNotMatch(theirs.text(), /event: frame/, 'a frame reached a view that did not change');
  } finally {
    stream.close();
  }
});

test('many clients on one view cost one read, not one read each', async () => {
  const db = fakeDb();
  const stream = createBoardStream({ db, log: SILENT });
  try {
    stream.linkUp();
    const sinks = [fakeSink(), fakeSink(), fakeSink(), fakeSink(), fakeSink()];
    for (const sink of sinks) await stream.attach(sink, 'default', CORS);
    assert.equal(stream.size(), 5);

    db.calls.length = 0;
    stream.publish('default');
    await settle();

    assert.deepEqual(db.calls, [BOARD_VIEW_SQL, BOARD_ROWS_SQL], 'the frame was read more than once');
    for (const sink of sinks) assert.match(sink.text(), /event: frame/);
  } finally {
    stream.close();
  }
});

test('a burst of announcements collapses into one rebuild, not one read per announcement', async () => {
  const db = fakeDb();
  const stream = createBoardStream({ db, log: SILENT });
  try {
    stream.linkUp();
    const sink = fakeSink();
    await stream.attach(sink, 'default', CORS);

    db.calls.length = 0;
    stream.publish('default');
    stream.publish('default');
    stream.publish('default');
    stream.publish('default');
    await settle();

    /* One read in flight plus exactly one rebuild for everything that arrived during it.
       Four reads for four announcements is how a live channel becomes a load generator. */
    assert.equal(db.calls.filter((c) => c === BOARD_ROWS_SQL).length, 2);
  } finally {
    stream.close();
  }
});

test('nobody watching a view means a forged announcement buys zero reads', async () => {
  const db = fakeDb();
  const stream = createBoardStream({ db, log: SILENT });
  try {
    stream.publish('default');
    stream.publish('anything-at-all');
    await settle();
    assert.deepEqual(db.calls, []);
  } finally {
    stream.close();
  }
});

test('a client that disconnects stops receiving and stops being counted', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  try {
    stream.linkUp();
    const gone = fakeSink();
    const stays = fakeSink();
    await stream.attach(gone, 'default', CORS);
    await stream.attach(stays, 'default', CORS);
    assert.equal(stream.size(), 2);

    gone.fire('close');
    assert.equal(stream.size(), 1);

    const before = gone.chunks.length;
    stream.publish('default');
    await settle();

    assert.equal(gone.chunks.length, before, 'a frame was written to a socket that is gone');
    assert.match(stays.text(), /event: frame/);
  } finally {
    stream.close();
  }
});

test('a socket error drops the client rather than reaching the process', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  try {
    const sink = fakeSink();
    await stream.attach(sink, 'default', CORS);
    sink.fire('error');
    assert.equal(stream.size(), 0);
    assert.equal(sink.destroyed, true);
  } finally {
    stream.close();
  }
});

test('★ a client that stops reading is coalesced to one pending frame, then disconnected', async () => {
  const db = fakeDb();
  const stream = createBoardStream({ db, log: SILENT }, { maxBehind: 2 });
  try {
    stream.linkUp();
    const slow = fakeSink();
    await stream.attach(slow, 'default', CORS);

    /* The socket buffer fills. Everything from here is queued, and only one chunk may be. */
    slow.accepting = false;
    stream.publish('default');
    await settle();
    const afterFirst = slow.chunks.length;

    for (let i = 0; i < 2; i += 1) {
      db.tick += 1;
      stream.publish('default');
      await settle();
    }
    assert.equal(slow.chunks.length, afterFirst, 'chunks were written to a blocked socket');
    assert.equal(stream.size(), 1, 'disconnected before the client was actually far behind');

    /* Past the bound it is disconnected, and that is not data loss: EventSource reconnects
       and the ready-on-attach forces the authoritative refetch. */
    db.tick += 1;
    stream.publish('default');
    await settle();
    assert.equal(stream.size(), 0);
    assert.equal(slow.destroyed, true);
  } finally {
    stream.close();
  }
});

test('a drained socket receives the newest held frame and nothing older', async () => {
  const db = fakeDb();
  const stream = createBoardStream({ db, log: SILENT }, { maxBehind: 50 });
  try {
    stream.linkUp();
    const sink = fakeSink();
    await stream.attach(sink, 'default', CORS);

    sink.accepting = false;
    db.tick = 100;
    stream.publish('default');
    await settle();
    db.tick = 101;
    stream.publish('default');
    await settle();
    db.tick = 102;
    stream.publish('default');
    await settle();

    sink.accepting = true;
    sink.fire('drain');

    /* 100 went out before the socket blocked. 101 was displaced by 102 and is simply gone —
       an older committed board is worth nothing once a newer one exists, and the tick jump
       from 100 to 102 is what makes the client refetch rather than believe it kept up. */
    const frames = [...sink.text().matchAll(/event: frame\ndata: (.*)\n\n/g)].map(
      (m) => JSON.parse(m[1] ?? '{}') as { tick: number },
    );
    assert.deepEqual(frames.map((f) => f.tick), [100, 102], 'a blocked client was sent a backlog');
  } finally {
    stream.close();
  }
});

test('at capacity a client is refused with an answer it can retry, not a stream that starves', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT }, { maxClients: 1 });
  try {
    await stream.attach(fakeSink(), 'default', CORS);
    const refused = fakeSink();
    await stream.attach(refused, 'default', CORS);
    assert.equal(refused.head?.status, 503);
    assert.equal(refused.ended, '{"error":"too many streams"}');
    assert.equal(stream.size(), 1);
  } finally {
    stream.close();
  }
});

test('★ the ceiling holds when every client arrives at once, which is the only time it matters', async () => {
  /* THE FAILURE THIS IS WRITTEN AGAINST. `attach` awaits a view-existence read before it
     adds anybody to `subscribers`, so a client that arrives during that round trip measures
     a set that does not contain any of the clients arriving beside it. The test above passes
     because it attaches one at a time; a reconnect storm does not. Measured before the fix:
     a cap of eight admitted two hundred, and refused none — the ceiling was absent in exactly
     the event it exists for, which is the read surface restarting and every EventSource in
     the fleet reconnecting in the same millisecond.

     The slow `db` is the whole test. With an instant one the await still yields, but the
     window is a microtask and the interleaving is luck; five milliseconds makes it certain. */
  const slow = {
    query: async (sql: string, params: readonly unknown[]) => {
      await new Promise((r) => setTimeout(r, 5));
      return fakeDb().query(sql, params);
    },
  };
  const stream = createBoardStream({ db: slow, log: SILENT }, { maxClients: 8 });
  try {
    const sinks = Array.from({ length: 200 }, () => fakeSink());
    await Promise.all(sinks.map((s) => stream.attach(s, 'default', CORS)));

    assert.equal(stream.size(), 8, 'the ceiling must bound a storm, not just a queue');
    /* And the rest get the truthful answer rather than a socket that opens and starves —
       every one of them, so nothing is left holding a response that was never written. */
    assert.equal(sinks.filter((s) => s.head?.status === 503).length, 192);
    assert.equal(sinks.filter((s) => s.head?.status === 200).length, 8);
  } finally {
    stream.close();
  }
});

test('a refused or unknown view gives its reservation back rather than holding a slot', async () => {
  /* The other half of counting attaches in flight: if the reservation outlived a 404 the
     ceiling would erode by one on every request for a view that does not exist, and a
     surface that had answered five hundred 404s would refuse everybody forever. */
  const stream = createBoardStream({ db: fakeDb(), log: SILENT }, { maxClients: 2 });
  try {
    for (let i = 0; i < 20; i += 1) {
      const missing = fakeSink();
      await stream.attach(missing, 'nosuchview', CORS);
      assert.equal(missing.head?.status, 404);
    }
    const good = fakeSink();
    await stream.attach(good, 'default', CORS);
    assert.equal(good.head?.status, 200);
    assert.equal(stream.size(), 1);
  } finally {
    stream.close();
  }
});

test('a read that fails answers opaquely and names nothing', async () => {
  const stream = createBoardStream(
    { db: { query: async () => { throw new Error('permission denied for table observation'); } }, log: SILENT },
    {},
  );
  try {
    const sink = fakeSink();
    await stream.attach(sink, 'default', CORS);
    assert.equal(sink.head?.status, 500);
    assert.equal(sink.ended, '{"error":"server error"}');
    assert.ok(!String(sink.ended).includes('observation'));
  } finally {
    stream.close();
  }
});

test('the heartbeat is a named event, so a silent socket is visible to the client', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT }, { heartbeatMs: 5 });
  try {
    const sink = fakeSink();
    await stream.attach(sink, 'default', CORS);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    assert.match(sink.text(), /event: beat\ndata: 1\n\n/);
  } finally {
    stream.close();
  }
});

test('closing the hub ends every stream', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  const a = fakeSink();
  const b = fakeSink();
  await stream.attach(a, 'default', CORS);
  await stream.attach(b, 'default', CORS);
  stream.close();
  assert.equal(stream.size(), 0);
  assert.equal(a.ended, '');
  assert.equal(b.ended, '');
});

test('no event carries an id, because there is no replay to promise', async () => {
  const stream = createBoardStream({ db: fakeDb(), log: SILENT });
  try {
    stream.linkUp();
    const sink = fakeSink();
    await stream.attach(sink, 'default', CORS);
    stream.publish('default');
    await settle();
    assert.doesNotMatch(sink.text(), /^id:/m, 'an id invites Last-Event-ID catch-up, which does not exist');
  } finally {
    stream.close();
  }
});
