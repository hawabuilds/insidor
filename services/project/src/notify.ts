/**
 * THE ANNOUNCEMENT. One statement, sent inside the frame's own transaction.
 *
 * The projector commits a board and exits. Nothing downstream knows a new frame exists,
 * so the read surface either polls the tick column forever or the browser sits on the
 * frame it fetched at first paint. This file is the third option: `pg_notify` on a fixed
 * channel, carrying the view id and the new tick, which the read service is LISTENing on.
 *
 * ★ IT GOES INSIDE `withTransaction` AND THAT IS THE WHOLE SAFETY ARGUMENT. Postgres
 * queues a notification at COMMIT, never before — a listener cannot receive it during the
 * open transaction, and a ROLLBACK discards it with everything else. So this announcement
 * can never name a frame the read service is not yet able to SELECT, and a projection that
 * fails announces nothing. There is no coordination to write, no ordering to get right,
 * and no window in which a client refetches a board that does not exist yet. Moving this
 * one line to after the commit would create all three.
 *
 * ★ THE PAYLOAD IS AN IDENTIFIER, NEVER THE BOARD. Postgres caps a notification payload
 * at 8000 bytes and a board frame is orders of magnitude past that, so a payload carrying
 * rows would fail — not on a synthetic test, on the first real board. It carries the two
 * facts the reader needs to act: WHICH view moved, and to WHICH tick. The reader re-reads
 * the frame through the same SELECT it already serves, under the same app credential, with
 * the same censored payloads. Nothing about what the browser can see passes through here.
 *
 * ★ AND THE PAYLOAD IS NOT TRUSTED ON THE OTHER SIDE. LISTEN/NOTIFY has no privilege model
 * in Postgres at all — no GRANT LISTEN, no object to grant on — so any role that can open a
 * connection can forge a notification on any channel. That is acceptable here for exactly
 * one reason: the payload carries nothing the reader could not already read, and the worst a
 * forged notify buys is one extra SELECT of a board that is public to that connection
 * anyway. It must stay that way. Never put a value in this payload that its reader could
 * not otherwise obtain, because the channel is not an authorization boundary and cannot be
 * made into one.
 *
 * The launches rail gets no announcement. It is polled, on its own cadence, and its tick is
 * deliberately independent of the board's — see main.ts. A second channel would be a second
 * thing to keep in step for a rail that already refreshes every few seconds.
 */

import type { Db } from '@insidor/store';

/**
 * The one channel name, as a constant, because a channel name is a SQL IDENTIFIER and
 * cannot be a bound parameter. A per-view channel would mean interpolating a view id into
 * a `LISTEN` statement on the read side, and "a path parameter is never interpolated into
 * SQL" is a property that service tests rather than promises. The view id goes in the
 * payload, where it is data. (Identifiers also truncate at 63 bytes, which would make
 * per-view channels quietly collide.)
 *
 * services/read/src/listen.ts holds the same string. They are two constants rather than a
 * shared import on purpose: services/read declares no workspace dependency at all, and that
 * absence is its safety argument — it cannot import @insidor/store, so it cannot open a
 * privileged pool. A duplicated seven-character string is the cheaper half of that trade.
 */
export const BOARD_CHANNEL = 'insidor_board';

/**
 * Parameterised in BOTH arguments. `pg_notify(text, text)` is the function form of NOTIFY
 * precisely because the statement form takes an identifier and cannot be bound; using the
 * function means neither the channel nor the payload is ever concatenated into SQL.
 */
export const NOTIFY_SQL = 'select pg_notify($1, $2)';

/**
 * Postgres' hard limit on a notification payload. Exceeding it aborts the transaction with
 * `payload string too long` — which, inside `withTransaction`, means losing the whole frame.
 */
const PAYLOAD_MAX_BYTES = 8_000;

/**
 * What the read service parses. Two fields, both scalars, both already public.
 *
 * `tick` is a JSON number rather than a string because the reader compares it to the tick
 * it is serving; a bigint that has outgrown a float64 would be a board that has been
 * projected nine quadrillion times, and the read side range-checks it anyway.
 */
export function boardAnnouncement(viewId: string, tick: number): string {
  return JSON.stringify({ view: viewId, tick });
}

/**
 * Announce a committed board frame. Call inside the transaction that wrote it.
 *
 * The length check throws rather than truncating or skipping, and the reason is that
 * Postgres would abort the transaction anyway: a payload past the cap does not degrade to a
 * missing notification, it takes the frame down. Failing here turns that into a sentence
 * naming the view id, instead of a driver error thirty lines from anything that mentions
 * this file. It can only fire on a view id nobody would configure — the caller's is a
 * module constant — which is exactly why it should not be a silent branch.
 */
export async function announceBoard(db: Db, viewId: string, tick: number): Promise<void> {
  const payload = boardAnnouncement(viewId, tick);
  const size = Buffer.byteLength(payload, 'utf8');
  if (size > PAYLOAD_MAX_BYTES) {
    throw new Error(
      `the board announcement for view '${viewId}' is ${size} bytes and Postgres caps a ` +
        `notification payload at ${PAYLOAD_MAX_BYTES}. The payload carries only the view id ` +
        'and the tick, so this means the view id itself is enormous; shorten it rather than ' +
        'trimming the payload, because a truncated view id would announce the wrong board.',
    );
  }
  await db.query(NOTIFY_SQL, [BOARD_CHANNEL, payload]);
}
