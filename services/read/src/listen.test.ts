/**
 * The database listener, against a fake socket. No pg, no database, no network.
 *
 * The behaviour worth proving here is what happens when the database goes away — which is
 * exactly the behaviour you cannot exercise against a database that is up. The claim that
 * matters most is the last one: a listener that resubscribes and says nothing has silently
 * lost every frame that was announced while it was down, and NOTIFY has no replay to make
 * that good.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_CHANNEL, createNotifier, parseAnnouncement, type ListenSocket } from './listen.ts';
import { SILENT } from './log.ts';

interface FakeSocket extends ListenSocket {
  readonly listened: string[];
  connects: number;
  ends: number;
  /** Make the next connect fail, the way a database that is down does. */
  failConnect: string | null;
  /**
   * Make LISTEN fail while the connection SUCCEEDS. A different failure from `failConnect`
   * and the reason this field exists: the client is connected and holding a backend when it
   * happens, so whether it is ended is a question with a cost attached.
   */
  failListen: string | null;
  /** Deliver a notification, as Postgres would. */
  push(payload: string | null): void;
  /** Kill the connection, as a database restart does. */
  die(reason: string): void;
}

function fakeSocket(): FakeSocket {
  let onNotification: (payload: string | null) => void = () => {};
  let onClosed: (reason: string) => void = () => {};
  const socket: FakeSocket = {
    listened: [],
    connects: 0,
    ends: 0,
    failConnect: null,
    failListen: null,
    async connect() {
      socket.connects += 1;
      if (socket.failConnect !== null) throw new Error(socket.failConnect);
    },
    async listen(channel) {
      if (socket.failListen !== null) throw new Error(socket.failListen);
      socket.listened.push(channel);
    },
    onNotification: (h) => {
      onNotification = h;
    },
    onClosed: (h) => {
      onClosed = h;
    },
    async end() {
      socket.ends += 1;
    },
    push: (payload) => onNotification(payload),
    die: (reason) => onClosed(reason),
  };
  return socket;
}

/** Fast, deterministic backoff so the reconnect schedule is asserted rather than waited on. */
const FAST = { minBackoffMs: 1, maxBackoffMs: 2, random: () => 0 };

async function tick(ms = 5): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

test('an announcement in our shape is read; anything else is discarded', () => {
  assert.deepEqual(parseAnnouncement('{"view":"default","tick":42}'), { view: 'default', tick: 42 });

  /* Every one of these is reachable: LISTEN/NOTIFY has no privilege model in Postgres, so
     anything holding a connection can put any string on this channel. */
  assert.equal(parseAnnouncement(null), null);
  assert.equal(parseAnnouncement(''), null);
  assert.equal(parseAnnouncement('not json'), null);
  assert.equal(parseAnnouncement('[1,2,3]'), null);
  assert.equal(parseAnnouncement('"default"'), null);
  assert.equal(parseAnnouncement('{"view":"default"}'), null);
  assert.equal(parseAnnouncement('{"view":"","tick":1}'), null);
  assert.equal(parseAnnouncement('{"view":42,"tick":1}'), null);
  assert.equal(parseAnnouncement('{"view":"default","tick":"42"}'), null, 'a tick has to be a number');
  assert.equal(parseAnnouncement('{"view":"default","tick":1.5}'), null);
  assert.equal(parseAnnouncement('{"view":"default","tick":-1}'), null);
  assert.equal(parseAnnouncement(`{"view":"${'v'.repeat(500)}","tick":1}`), null, 'an unbounded view id');
});

test('starting subscribes on the one fixed channel and reports it is listening', async () => {
  const socket = fakeSocket();
  const events: string[] = [];
  const notifier = createNotifier(
    { open: () => socket, log: SILENT, onFrame: () => {}, onListening: () => events.push('up'), onLost: () => events.push('down') },
    FAST,
  );
  try {
    notifier.start();
    await tick();
    assert.deepEqual(socket.listened, [BOARD_CHANNEL]);
    assert.deepEqual(events, ['up']);
  } finally {
    await notifier.close();
  }
});

test('a well-formed announcement names the view; a forged one reaches nothing', async () => {
  const socket = fakeSocket();
  const frames: Array<{ view: string; tick: number }> = [];
  const notifier = createNotifier(
    { open: () => socket, log: SILENT, onFrame: (view, t) => frames.push({ view, tick: t }), onListening: () => {}, onLost: () => {} },
    FAST,
  );
  try {
    notifier.start();
    await tick();

    socket.push('{"view":"default","tick":42}');
    socket.push('drop table public.board_row');
    socket.push('{"view":"default","tick":"nope"}');
    socket.push(null);

    assert.deepEqual(frames, [{ view: 'default', tick: 42 }]);
  } finally {
    await notifier.close();
  }
});

test('★ a reconnect reports listening AGAIN, because notifications that fired while it was down are gone', async () => {
  const sockets: FakeSocket[] = [];
  const events: string[] = [];
  const notifier = createNotifier(
    {
      open: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      log: SILENT,
      onFrame: () => {},
      onListening: () => events.push('up'),
      onLost: () => events.push('down'),
    },
    FAST,
  );
  try {
    notifier.start();
    await tick();
    assert.deepEqual(events, ['up']);

    sockets[0]?.die('server closed the connection unexpectedly');
    await tick(20);

    /* Not ['up'] and not ['up','down']. The second 'up' is what makes every attached browser
       refetch; without it the read surface resumes a subscription and quietly serves a board
       that stopped being current during the outage. */
    assert.deepEqual(events, ['up', 'down', 'up']);
    assert.equal(sockets.length, 2, 'a closed pg Client cannot be reused; a fresh one is opened');
    assert.deepEqual(sockets[1]?.listened, [BOARD_CHANNEL]);
  } finally {
    await notifier.close();
  }
});

test('a database that is down is retried, and is never reported as listening', async () => {
  const sockets: FakeSocket[] = [];
  const events: string[] = [];
  const notifier = createNotifier(
    {
      open: () => {
        const s = fakeSocket();
        /* Down for the first two attempts, up on the third. */
        if (sockets.length < 2) s.failConnect = 'ECONNREFUSED';
        sockets.push(s);
        return s;
      },
      log: SILENT,
      onFrame: () => {},
      onListening: () => events.push('up'),
      onLost: () => events.push('down'),
    },
    FAST,
  );
  try {
    notifier.start();
    await tick(40);

    assert.ok(sockets.length >= 3, `expected retries, saw ${sockets.length} attempts`);
    /* No 'down' before the first 'up': the link was never up, so there was nothing to lose,
       and telling the browsers the stream dropped before it ever opened would be a lie. */
    assert.deepEqual(events, ['up']);
  } finally {
    await notifier.close();
  }
});

test('one dead connection schedules one reconnect, however many times it says it died', async () => {
  const sockets: FakeSocket[] = [];
  const events: string[] = [];
  const notifier = createNotifier(
    {
      open: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      log: SILENT,
      onFrame: () => {},
      onListening: () => events.push('up'),
      onLost: () => events.push('down'),
    },
    FAST,
  );
  try {
    notifier.start();
    await tick();

    /* A pg Client can emit both 'error' and 'end' for the same death, and a late error can
       arrive from a socket already replaced. Two losses for one death is two reconnect
       loops racing each other for the same subscription. */
    const first = sockets[0];
    first?.die('connection terminated');
    first?.die('connection terminated');
    first?.die('and again');
    await tick(20);

    assert.deepEqual(events, ['up', 'down', 'up']);
    assert.equal(sockets.length, 2);
  } finally {
    await notifier.close();
  }
});

test('closing stops the loop; a socket that dies afterwards reconnects nothing', async () => {
  const sockets: FakeSocket[] = [];
  const notifier = createNotifier(
    {
      open: () => {
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      log: SILENT,
      onFrame: () => {},
      onListening: () => {},
      onLost: () => {},
    },
    FAST,
  );
  notifier.start();
  await tick();
  await notifier.close();

  assert.equal(sockets[0]?.ends, 1, 'the listening connection was left open');
  sockets[0]?.die('after shutdown');
  await tick(20);
  assert.equal(sockets.length, 1, 'a reconnect was scheduled after close');
});

test('a notification arriving after close reaches nothing', async () => {
  const socket = fakeSocket();
  let frames = 0;
  const notifier = createNotifier(
    { open: () => socket, log: SILENT, onFrame: () => (frames += 1), onListening: () => {}, onLost: () => {} },
    FAST,
  );
  notifier.start();
  await tick();
  await notifier.close();

  socket.push('{"view":"default","tick":9}');
  assert.equal(frames, 0);
});

/* ── the two failures the reconnect loop had ──────────────────────────── */

test('★ a socket abandoned by the loop is ended, because a connected one holds a backend', async () => {
  /* THE FAILURE. `connect()` and `listen()` are two awaits and only the first one closes the
     connection when it throws. A pg Client whose LISTEN was refused — a role-level
     statement_timeout, a server that errors on the statement, a backend killed between the
     two calls — is CONNECTED, idle, and holding one of `max_connections`. The loop dropped
     the reference and opened another. At a floor of half a second that is a hundred and
     twenty leaked backends a minute, and the read surface then cannot serve the board it is
     still trying to subscribe to. Measured before the fix: twenty attempts, twenty connected
     sockets, zero ended. */
  const sockets: FakeSocket[] = [];
  const notifier = createNotifier(
    {
      open: () => {
        const s = fakeSocket();
        s.failListen = 'ERROR: canceling statement due to statement timeout';
        sockets.push(s);
        return s;
      },
      log: SILENT,
      onFrame: () => {},
      onListening: () => {},
      onLost: () => {},
    },
    FAST,
  );
  try {
    notifier.start();
    await tick(30);

    assert.ok(sockets.length >= 3, `expected retries, saw ${sockets.length}`);
    const leaked = sockets.filter((s) => s.connects > 0 && s.ends === 0);
    assert.deepEqual(leaked, [], `${leaked.length} sockets connected and were never ended`);
  } finally {
    await notifier.close();
  }
});

test('★ a subscription that keeps dying backs off; a durable one does not pay for it', async () => {
  /* THE OTHER FAILURE, AND THE MORE EXPENSIVE ONE. The backoff only ever guarded against a
     database that REFUSES connections. A database that ACCEPTS them and then drops them — a
     failover, a pooler recycling backends, an idle_session_timeout, a connection killer —
     subscribed successfully every time, so the attempt counter was reset every time and the
     delay never left the floor. Measured before the fix, against a backend terminated every
     150ms: thirty-one subscriptions in seven hundred milliseconds, every gap at the floor.

     What that costs is not the reconnects. Every successful subscribe is an `onListening`,
     stream.ts turns it into `ready` for every attached browser, and the app turns `ready`
     into an authoritative refetch of the whole board — correctly, because NOTIFY has no
     replay. Measured end to end against the running service: ONE browser issued fifteen full
     board reads in seven seconds of flapping. The bound belongs on the trigger.

     The reconnect delay is a real `setTimeout`, so the gaps below are wall clock. The clock
     that decides whether a subscription was DURABLE is injected separately, which is what
     lets the last third of this test state "an hour later" instead of waiting for one. */
  let uptimeClock = 1_000_000;
  const sockets: FakeSocket[] = [];
  const opens: number[] = [];

  const notifier = createNotifier(
    {
      open: () => {
        opens.push(Date.now());
        const s = fakeSocket();
        sockets.push(s);
        return s;
      },
      log: SILENT,
      onFrame: () => {},
      onListening: () => {},
      onLost: () => {},
    },
    /* `random: () => 1` takes the top of the jitter band, so the delay IS the ceiling and the
       schedule is a sequence rather than a distribution: 10, 20, 40, 80, 160. */
    { minBackoffMs: 10, maxBackoffMs: 10_000, stableMs: 30_000, random: () => 1, now: () => uptimeClock },
  );

  /* The wait is measured from the death to the reopen, not between reopens — the sleeps this
     test needs in order to observe anything would otherwise be counted as backoff. */
  const waits: number[] = [];
  const killAndWait = async (reason: string): Promise<void> => {
    const diedAt = Date.now();
    const before = opens.length;
    sockets[sockets.length - 1]?.die(reason);
    await tick(400);
    if (opens.length > before) waits.push((opens[before] as number) - diedAt);
  };

  try {
    notifier.start();
    await tick();

    /* Six flaps: subscribed, then dead a moment later, over and over, with no time passing on
       the uptime clock — which is what "it never stayed up" means. */
    for (let i = 0; i < 6; i += 1) await killAndWait('the backend went away');

    const flapping = [...waits];
    assert.ok(flapping.length >= 5, `expected several reconnects, saw ${JSON.stringify(flapping)}`);
    /* The floor is 10ms. Before the fix every gap sat on it; after it the schedule doubles,
       so by the fifth reconnect the wait is an order of magnitude past the floor. Asserted as
       a ratio rather than as exact milliseconds, because these are real timers. */
    const lastFlap = flapping[flapping.length - 1] as number;
    assert.ok(lastFlap > 100, `a flapping link must back off; the schedule was ${JSON.stringify(flapping)}`);

    /* ★ AND A HEALTHY LINK IS NOT PUNISHED FOR AN EARLIER BAD HOUR. A subscription that lasts
       past `stableMs` gives the counter back, so an ordinary database restart after a quiet
       week still reconnects at the floor rather than at the ceiling. That is the half of this
       rule that keeps "a restart is invisible" true, and without it the first fix would have
       traded one failure for another. */
    uptimeClock += 60_000;
    await killAndWait('a restart, after a long healthy stretch');

    const recovered = waits[waits.length - 1] as number;
    assert.equal(waits.length, flapping.length + 1, 'the durable subscription reconnected');
    assert.ok(
      recovered < lastFlap / 2,
      `a durable subscription must earn the floor back: waited ${recovered}ms, the flap was waiting ${lastFlap}ms`,
    );
  } finally {
    await notifier.close();
  }
});
