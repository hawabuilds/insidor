/**
 * THE CONNECTION STATE MACHINE, tested against the five rules it exists to hold.
 *
 * Every one of these is a rule whose obvious shortcut is wrong, and every one of them is a
 * rule that a well-meant refactor would take out without noticing:
 *
 *   1. ★ A REFUSAL IS NOT A FAILURE AND IS NOT STICKY.
 *   2. ★ A CHANGE NOTIFICATION MAY NOT CONNECT US.
 *   3. ★ AN ACCOUNT THAT GOES AWAY TAKES THE CONNECTION WITH IT.
 *   4. ★ THE THREE NETWORK OUTCOMES ARE THREE, NOT TWO.
 *   5. ★ `unavailable` IS DECIDED BY PROBING AND BY NOTHING ELSE.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';
import { WALLET_STATES } from '@insidor/contracts/ports/wallet.ts';

import { UNPROBED, next, settle } from './machine.ts';
import type { WalletEvent, WalletRules } from './machine.ts';

const OPEN: WalletRules = { requiredNetwork: null };
const PINNED: WalletRules = { requiredNetwork: 'net-a' };

const ACCOUNT = 'acct-0000000000000001';

/** Drives a sequence of events from the unprobed start. */
function run(events: readonly WalletEvent[], rules: WalletRules = OPEN): WalletState {
  return events.reduce<WalletState>((state, event) => next(state, event, rules), UNPROBED);
}

const present: WalletEvent = { kind: 'probed', present: true };
const absent: WalletEvent = { kind: 'probed', present: false };

test('probing is the only way into and out of unavailable', () => {
  assert.equal(run([absent]).kind, 'unavailable');
  assert.equal(run([absent, present]).kind, 'disconnected');
  /* Rule 5: a failure is never reported as "you have no wallet", and a missing extension is
     never reported as a fault. Neither event can reach the other's state. */
  assert.equal(run([absent, { kind: 'failed', code: 'internal' }]).kind, 'unavailable');
  assert.equal(run([present, { kind: 'failed', code: 'internal' }]).kind, 'failed');
});

test('finding a wallet does not connect us to it', () => {
  /* Discovery is not permission. Only a press connects. */
  assert.equal(run([present]).kind, 'disconnected');
});

test('a provider that disappears takes the connection with it', () => {
  const state = run([present, { kind: 'requested' }, { kind: 'opened', account: ACCOUNT, network: null }, absent]);
  assert.equal(state.kind, 'unavailable');
});

test('★ RULE 1 — a refusal is not a failure', () => {
  const state = run([present, { kind: 'requested' }, { kind: 'refused' }]);
  assert.equal(state.kind, 'refused');
  /* The type already makes this impossible; the assertion is here because somebody will
     eventually be tempted to give `refused` a code so the two can share a branch. */
  assert.ok(!('code' in state), 'refused must not carry a failure code');
});

test('★ RULE 1 — a refusal is not sticky: pressing again asks again', () => {
  const state = run([present, { kind: 'requested' }, { kind: 'refused' }, { kind: 'requested' }]);
  assert.equal(state.kind, 'connecting', 'somebody who changed their mind must be able to press again');
});

test('a failure is also not sticky', () => {
  const state = run([
    present,
    { kind: 'requested' },
    { kind: 'failed', code: 'unauthorized' },
    { kind: 'requested' },
  ]);
  assert.equal(state.kind, 'connecting');
});

test('★ RULE 2 — an account announced while disconnected does not connect us', () => {
  const state = run([present, { kind: 'changed', account: ACCOUNT, network: null }]);
  assert.equal(
    state.kind,
    'disconnected',
    'a page must not learn an account nobody chose to share with it',
  );
});

test('★ RULE 2 — nor while refused, connecting, failed or unavailable', () => {
  const announce: WalletEvent = { kind: 'changed', account: ACCOUNT, network: null };
  assert.equal(run([absent, announce]).kind, 'unavailable');
  assert.equal(run([present, { kind: 'requested' }, announce]).kind, 'connecting');
  assert.equal(run([present, { kind: 'requested' }, { kind: 'refused' }, announce]).kind, 'refused');
  assert.equal(
    run([present, { kind: 'failed', code: 'internal' }, announce]).kind,
    'failed',
  );
});

test('★ RULE 3 — an account that goes away is a disconnection, never a stale address', () => {
  const state = run([
    present,
    { kind: 'requested' },
    { kind: 'opened', account: ACCOUNT, network: null },
    { kind: 'changed', account: null, network: null },
  ]);
  assert.equal(state.kind, 'disconnected');
  assert.ok(!('account' in state), 'no reference may survive the connection that produced it');
});

test('a live connection follows the account it is switched to', () => {
  const state = run([
    present,
    { kind: 'requested' },
    { kind: 'opened', account: ACCOUNT, network: null },
    { kind: 'changed', account: 'acct-second', network: null },
  ]);
  assert.deepEqual(state, { kind: 'connected', account: 'acct-second', network: null });
});

test('★ RULE 4 — three network outcomes, and the third is not folded into either other', () => {
  /* Nobody told us which network to require: we report what the wallet said and claim
     nothing about it. */
  assert.deepEqual(settle(ACCOUNT, 'net-b', OPEN), {
    kind: 'connected',
    account: ACCOUNT,
    network: 'net-b',
  });
  /* Confirmed acceptable. */
  assert.deepEqual(settle(ACCOUNT, 'net-a', PINNED), {
    kind: 'connected',
    account: ACCOUNT,
    network: 'net-a',
  });
  /* Confirmed wrong — and both references are carried, because "wrong network" without
     saying which is a dead end for whoever has to fix it. */
  assert.deepEqual(settle(ACCOUNT, 'net-b', PINNED), {
    kind: 'wrong-network',
    account: ACCOUNT,
    required: 'net-a',
    reported: 'net-b',
  });
  /* ★ The one that is neither. A required network and a wallet that would not say is an
     unanswered question, and answering it in either direction invents a fact. */
  assert.deepEqual(settle(ACCOUNT, null, PINNED), {
    kind: 'failed',
    code: 'unreadable-network',
  });
});

test('an unreadable account is reported before an unreadable network', () => {
  /* Both are wrong at once; the one that has to be fixed first is the one reported, so
     nobody is sent to the network setting over an account we could not read. */
  assert.deepEqual(settle(null, null, PINNED), { kind: 'failed', code: 'unreadable-account' });
});

test('a wrong network can be corrected in place without reconnecting', () => {
  const state = run(
    [
      present,
      { kind: 'requested' },
      { kind: 'opened', account: ACCOUNT, network: 'net-b' },
      { kind: 'changed', account: ACCOUNT, network: 'net-a' },
    ],
    PINNED,
  );
  assert.equal(state.kind, 'connected');
});

test('closing returns to disconnected from every live state', () => {
  const close: WalletEvent = { kind: 'closed' };
  assert.equal(run([present, { kind: 'requested' }, { kind: 'opened', account: ACCOUNT, network: null }, close]).kind, 'disconnected');
  assert.equal(run([present, { kind: 'requested' }, close]).kind, 'disconnected');
  /* …but it cannot conjure a wallet that is not there. */
  assert.equal(run([absent, close]).kind, 'unavailable');
});

test('a non-event returns the same object, so no subscriber is woken for nothing', () => {
  const start = run([present]);
  assert.equal(next(start, { kind: 'probed', present: true }, OPEN), start);
  const refused = run([present, { kind: 'requested' }, { kind: 'refused' }]);
  assert.equal(next(refused, { kind: 'refused' }, OPEN), refused);
});

test('every declared state is reachable — the union has no ornamental members', () => {
  const reached = new Set<string>([
    run([absent]).kind,
    run([present]).kind,
    run([present, { kind: 'requested' }]).kind,
    run([present, { kind: 'requested' }, { kind: 'opened', account: ACCOUNT, network: null }]).kind,
    run([present, { kind: 'requested' }, { kind: 'refused' }]).kind,
    run(
      [present, { kind: 'requested' }, { kind: 'opened', account: ACCOUNT, network: 'net-b' }],
      PINNED,
    ).kind,
    run([present, { kind: 'failed', code: 'internal' }]).kind,
  ]);
  for (const kind of WALLET_STATES) {
    assert.ok(reached.has(kind), `${kind} is declared but nothing produces it`);
  }
});
