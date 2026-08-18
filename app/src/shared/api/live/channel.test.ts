/**
 * The live channel's transport rules, against a fake EventSource. No browser, no socket.
 *
 * The first test is the one this file exists for. Everything else here is machinery that
 * keeps it true when the network misbehaves.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLiveChannel, type EventStream, type LiveHandlers } from './channel.ts';

interface FakeStream extends EventStream {
  closed: number;
  /** Deliver one server event, as EventSource would. */
  emit(type: string, data?: string): void;
}

function fakeStream(): FakeStream {
  const listeners = new Map<string, Array<(data: string) => void>>();
  return {
    closed: 0,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? [];
      set.push(listener);
      listeners.set(type, set);
    },
    close() {
      this.closed += 1;
    },
    emit(type, data = '') {
      for (const l of listeners.get(type) ?? []) l(data);
    },
  };
}

interface Log {
  readonly events: string[];
  readonly handlers: LiveHandlers;
  readonly ticks: unknown[];
  readonly patches: unknown[];
}

function recording(): Log {
  const events: string[] = [];
  const ticks: unknown[] = [];
  const patches: unknown[] = [];
  return {
    events,
    ticks,
    patches,
    handlers: {
      onTick: (raw) => {
        events.push('tick');
        ticks.push(raw);
      },
      onPatch: (raw) => {
        events.push('patch');
        patches.push(raw);
      },
      onSubscribed: () => events.push('subscribed'),
      onDropped: () => events.push('dropped'),
    },
  };
}

/** A factory that hands out a fresh stream per connect and remembers them all. */
function streams(): { open: (url: string) => EventStream; all: FakeStream[]; urls: string[] } {
  const all: FakeStream[] = [];
  const urls: string[] = [];
  return {
    all,
    urls,
    open: (url) => {
      urls.push(url);
      const s = fakeStream();
      all.push(s);
      return s;
    },
  };
}

test('★ every ready fires onSubscribed, including the fiftieth — broadcast has no replay', () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/stream/board/default', log.handlers, f.open);
  try {
    const stream = f.all[0];
    assert.ok(stream);

    stream.emit('ready');
    stream.emit('error');
    stream.emit('ready');
    stream.emit('error');
    stream.emit('ready');

    /* Three subscribes, three refetch triggers. A transport that reported only the first —
       an `if (!alreadySubscribed)` — would resume after each outage having silently missed
       every frame published during it, which is the exact bug this wiring exists for. */
    assert.deepEqual(log.events, ['subscribed', 'dropped', 'subscribed', 'dropped', 'subscribed']);
  } finally {
    channel.close();
  }
});

test('an open socket is not a subscription: onSubscribed waits for the server to say ready', () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/x', log.handlers, f.open);
  try {
    /* Headers arrived and nothing else. The server's own database subscription may be down,
       in which case this socket is perfectly healthy and completely useless. */
    f.all[0]?.emit('open');
    assert.deepEqual(log.events, []);

    f.all[0]?.emit('ready');
    assert.deepEqual(log.events, ['subscribed']);
  } finally {
    channel.close();
  }
});

test('a hold reports dropped without closing anything, because the socket is fine', () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/x', log.handlers, f.open);
  try {
    f.all[0]?.emit('ready');
    f.all[0]?.emit('hold');
    assert.deepEqual(log.events, ['subscribed', 'dropped']);
    assert.equal(f.all[0]?.closed, 0, 'a hold is the server losing its feed, not the socket dying');
    assert.equal(f.all.length, 1, 'a hold must not provoke a reconnect');

    f.all[0]?.emit('ready');
    assert.deepEqual(log.events, ['subscribed', 'dropped', 'subscribed']);
  } finally {
    channel.close();
  }
});

test('a failure before the first subscribe is not reported as a lost connection', () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/x', log.handlers, f.open);
  try {
    f.all[0]?.emit('error');
    f.all[0]?.emit('error');
    /* Nothing was ever subscribed, so nothing was lost. "The connection dropped" about a
       connection that never existed would put a broken-stream warning over a board that is
       simply not streaming. */
    assert.deepEqual(log.events, []);
  } finally {
    channel.close();
  }
});

test('frames and patches are handed over parsed and undecoded', () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/x', log.handlers, f.open);
  try {
    f.all[0]?.emit('frame', '{"tick":7,"order":["a"],"rows":[]}');
    f.all[0]?.emit('row', '{"id":"a","fields":{}}');

    assert.deepEqual(log.ticks, [{ tick: 7, order: ['a'], rows: [] }]);
    assert.deepEqual(log.patches, [{ id: 'a', fields: {} }]);
  } finally {
    channel.close();
  }
});

test('a decoder that throws is not swallowed, because a leak must not become a dropped frame', () => {
  const f = streams();
  const channel = createLiveChannel(
    '/x',
    {
      onTick: () => {
        throw new Error('wire: internal vocabulary reached the client');
      },
      onPatch: () => {},
      onSubscribed: () => {},
      onDropped: () => {},
    },
    f.open,
  );
  try {
    assert.throws(() => f.all[0]?.emit('frame', '{"tick":1}'), /internal vocabulary/);
  } finally {
    channel.close();
  }
});

test('★ a socket that has gone silent is torn down and reopened, and that forces a refetch', async () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/x', log.handlers, f.open, { silenceMs: 25 });
  try {
    f.all[0]?.emit('ready');
    assert.deepEqual(log.events, ['subscribed']);

    /* A half-open connection answers every liveness check and delivers nothing: the socket
       is open, EventSource has no reason to reconnect, and no frame will ever arrive again.
       Silence is the only symptom, so silence is what is watched. */
    await new Promise<void>((resolve) => setTimeout(resolve, 40));

    assert.deepEqual(log.events, ['subscribed', 'dropped']);

    assert.equal(f.all[0]?.closed, 1, 'the dead socket was left open');
    assert.equal(f.all.length, 2, 'no fresh stream was opened');

    f.all[1]?.emit('ready');
    assert.deepEqual(log.events, ['subscribed', 'dropped', 'subscribed']);
  } finally {
    channel.close();
  }
});

test('a beat is liveness only: it keeps the watchdog quiet and reaches no handler', async () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/x', log.handlers, f.open, { silenceMs: 30 });
  try {
    f.all[0]?.emit('ready');
    for (let i = 0; i < 5; i += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 12));
      f.all[0]?.emit('beat');
    }
    assert.deepEqual(log.events, ['subscribed'], 'a beating socket was treated as silent');
    assert.equal(f.all.length, 1);
  } finally {
    channel.close();
  }
});

test('close is idempotent, stops the stream, and stops the watchdog', async () => {
  const log = recording();
  const f = streams();
  const channel = createLiveChannel('/x', log.handlers, f.open, { silenceMs: 10 });
  f.all[0]?.emit('ready');

  /* StrictMode double-invokes effects in development — open, close, open — so a close that
     did not really stop the stream would leave two channels attached in every dev session
     and every refetch would happen twice. */
  channel.close();
  channel.close();
  assert.equal(f.all[0]?.closed, 1);

  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  assert.equal(f.all.length, 1, 'the watchdog reopened a channel that was closed');
});

test('the url names the view being streamed', () => {
  const f = streams();
  const channel = createLiveChannel('/stream/board/default', recording().handlers, f.open);
  channel.close();
  assert.deepEqual(f.urls, ['/stream/board/default']);
});
