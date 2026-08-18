/**
 * The announcement, asserted against a fake `Db`. No database, no socket.
 *
 * Three claims are worth writing down: the payload is an identifier and not a board, the
 * channel name is a bound parameter rather than a piece of concatenated SQL, and a payload
 * that would exceed the Postgres cap fails with a sentence rather than taking the frame
 * down with a driver error.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_CHANNEL, NOTIFY_SQL, announceBoard, boardAnnouncement } from './notify.ts';

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function recordingDb(): { db: { query: (sql: string, params?: readonly unknown[]) => Promise<never[]> }; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params: params ?? [] });
        return [];
      },
    },
  };
}

test('the announcement carries the view id and the tick, and nothing else', async () => {
  const { db, calls } = recordingDb();
  await announceBoard(db, 'default', 412);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.sql, NOTIFY_SQL);
  assert.deepEqual(call.params, [BOARD_CHANNEL, '{"view":"default","tick":412}']);

  /* The shape the reader parses. Stated as an exact object so that adding a field here has
     to be a decision — a payload is not a place to put anything the reader could not
     already select for itself. */
  assert.deepEqual(JSON.parse(String(call.params[1])), { view: 'default', tick: 412 });
});

test('the channel name is a bound parameter, never concatenated into the statement', async () => {
  const { db, calls } = recordingDb();
  await announceBoard(db, 'default', 1);
  const call = calls[0];
  assert.ok(call);
  assert.ok(!call.sql.includes(BOARD_CHANNEL), 'the channel name reached the SQL text');
  assert.ok(!call.sql.includes('default'), 'the view id reached the SQL text');
  assert.equal(call.sql, 'select pg_notify($1, $2)');
});

test('a payload past the Postgres cap fails by name instead of taking the frame down', async () => {
  const { db, calls } = recordingDb();
  const enormous = 'v'.repeat(9_000);

  await assert.rejects(
    () => announceBoard(db, enormous, 1),
    (e: unknown) => e instanceof Error && e.message.includes('8000'),
  );
  assert.equal(calls.length, 0, 'the statement must not be attempted once we know it will abort');
});

test('the payload stays a tiny identifier as the tick grows', () => {
  assert.ok(boardAnnouncement('default', Number.MAX_SAFE_INTEGER).length < 100);
});
