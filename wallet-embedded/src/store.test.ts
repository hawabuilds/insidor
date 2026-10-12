/**
 * The port's rules, driven through the bridge with no SDK: connect resolves with the outcome;
 * closing the sign-in is refused, not failed; signed in without a wallet yet is connecting; a
 * vendor error is `internal` with nothing of the vendor's in it; and nothing hands out a signer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { embeddedWallet } from './store.ts';

function setup() {
  const { wallet, bridge } = embeddedWallet();
  const calls: string[] = [];
  bridge.actions({ signIn: () => void calls.push('signIn'), signOut: async () => void calls.push('signOut') });
  bridge.snapshot({ ready: true, signedIn: false, address: null });
  return { wallet, bridge, calls };
}

test('with no sign-in configured, the wallet is unavailable and connect asks nothing', async () => {
  const { wallet } = embeddedWallet();
  assert.deepEqual(wallet.state(), { kind: 'unavailable' });
  assert.deepEqual(await wallet.connect(), { kind: 'unavailable' });
});

test('★ connect opens the sign-in and resolves connected once the embedded wallet exists', async () => {
  const { wallet, bridge, calls } = setup();
  const result = wallet.connect();
  assert.deepEqual(calls, ['signIn']);
  assert.equal(wallet.state().kind, 'connecting');
  bridge.snapshot({ ready: true, signedIn: true, address: null });
  assert.equal(wallet.state().kind, 'connecting', 'signed in, wallet still being created');
  bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1111' });
  assert.deepEqual(await result, { kind: 'connected', account: 'Addr1111', network: 'solana:mainnet' });
});

test('★ closing the sign-in is refused, never a failure', async () => {
  const { wallet, bridge } = setup();
  const result = wallet.connect();
  bridge.signInEnded('closed');
  assert.deepEqual(await result, { kind: 'refused' });
});

test('★ a vendor error is failed: internal, and carries nothing of the vendor\'s', async () => {
  const { wallet, bridge } = setup();
  const result = wallet.connect();
  bridge.signInEnded('error');
  assert.deepEqual(await result, { kind: 'failed', code: 'internal' });
});

test('★ nothing hands out a signer in this phase, connected or not', async () => {
  const { wallet, bridge } = setup();
  bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1111' });
  assert.equal(wallet.state().kind, 'connected');
  assert.equal(wallet.signer(), null);
});

test('disconnect signs out, and the state follows the vendor back to disconnected', async () => {
  const { wallet, bridge, calls } = setup();
  bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1111' });
  await wallet.disconnect();
  assert.ok(calls.includes('signOut'));
  bridge.snapshot({ ready: true, signedIn: false, address: null });
  assert.equal(wallet.state().kind, 'disconnected');
});

test('a throwing subscriber does not starve the others', () => {
  const { wallet, bridge } = setup();
  const seen: string[] = [];
  wallet.subscribe(() => {
    throw new Error('boom');
  });
  wallet.subscribe((s) => void seen.push(s.kind));
  bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1111' });
  assert.deepEqual(seen, ['connected']);
});
