/**
 * The pooler-mode guard in client.ts, asserted without a database.
 *
 * WHAT IS UNDER TEST: a pool that holds a session advisory lock can never end up behind
 * the transaction-mode pooler, where the lock would be released at the end of the
 * statement that took it and the singleton guard would go on reading as held. Pools are
 * created lazily (nothing connects until the first query), so the refusals are observable
 * here; both of them throw before a socket is opened.
 *
 * What breaks if this is loosened: the runner's and chainwatch's singleton guards, with no
 * error anywhere — two runners draining one queue is the failure the lock exists to stop.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPool, DB_ROLE, withAdvisoryLock } from './client.ts';

const SESSION = 'postgres://u:pw@pooler.example:5432/db';
const TRANSACTION = 'postgres://u:pw@pooler.example:6543/db';

test('a pool for stateless work may use the transaction pooler, for every role', async () => {
  for (const [role, key] of [
    [DB_ROLE.app, 'DATABASE_URL_APP'],
    [DB_ROLE.service, 'DATABASE_URL_SERVICE'],
    [DB_ROLE.internal, 'DATABASE_URL_INTERNAL'],
  ] as const) {
    const pool = createPool(role, { env: { [key]: TRANSACTION } });
    await pool.end();
  }
});

test('★ a pool that will hold a session lock refuses the transaction pooler at boot', () => {
  assert.throws(
    () => createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: TRANSACTION }, session: true }),
    /DATABASE_URL_INTERNAL points at the transaction-mode pooler/,
  );
});

test('★ withAdvisoryLock refuses a transaction-mode pool before it connects', async () => {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: TRANSACTION } });
  await assert.rejects(() => withAdvisoryLock(pool, 1, async () => true), /transaction-mode pool/);
  await pool.end();
});

test('a session-mode lock pool opens, and a smaller max is honoured but never a larger one', async () => {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: SESSION }, session: true, max: 1 });
  assert.equal(pool.options.max, 1);
  await pool.end();
  const wide = createPool(DB_ROLE.app, { env: { DATABASE_URL_APP: SESSION }, max: 50 });
  assert.ok(wide.options.max <= 3);
  await wide.end();
});
