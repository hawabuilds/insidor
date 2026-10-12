/**
 * The port's rules, driven through the bridge with no SDK: connect resolves with the outcome;
 * closing the sign-in is refused, not failed; signed in without a wallet yet is connecting; a
 * vendor error is `internal` with nothing of the vendor's in it; and nothing hands out a signer.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { embeddedWallet, type Broadcast } from './store.ts';

function setup(opts: { broadcast?: Broadcast; sign?: (p: Uint8Array) => Promise<Uint8Array> } = {}) {
  const { wallet, bridge } = embeddedWallet(opts.broadcast === undefined ? {} : { broadcast: opts.broadcast });
  const calls: string[] = [];
  bridge.actions({
    signIn: (via?: string) => void calls.push(via === undefined ? 'signIn' : `signIn:${via}`),
    signOut: async () => void calls.push('signOut'),
    signTransaction: opts.sign ?? (async (p) => {
      calls.push('sign');
      return new Uint8Array([...p, 9]);
    }),
  });
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

test('★ sign and send: signed by the wallet, sent by the caller, and the signature comes back', async () => {
  const sent: number[][] = [];
  const { wallet, bridge, calls } = setup({ broadcast: async (signed) => { sent.push([...signed]); return { ok: true, ref: 'SIG' }; } });
  assert.deepEqual(await wallet.signAndSendTransaction(new Uint8Array([1])), { kind: 'unavailable' }, 'not connected: nothing to sign with');
  bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1' });
  assert.deepEqual(await wallet.signAndSendTransaction(new Uint8Array([1, 2])), { kind: 'sent', ref: 'SIG' });
  assert.deepEqual(sent, [[1, 2, 9]]);
  assert.deepEqual(calls, ['sign']);
});

test('★ a person declining is refused, not failed; and nothing is sent', async () => {
  let sends = 0;
  const { wallet, bridge } = setup({
    broadcast: async () => { sends += 1; return { ok: true, ref: 'x' }; },
    sign: async () => { throw new Error('User rejected the request'); },
  });
  bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1' });
  assert.deepEqual(await wallet.signAndSendTransaction(new Uint8Array([1])), { kind: 'refused' });
  assert.equal(sends, 0);
});

test('signed but not taken by the network says why; with no way to send, there is no signing at all', async () => {
  const declined = setup({ broadcast: async () => ({ ok: false, why: 'Blockhash expired.' }) });
  declined.bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1' });
  assert.deepEqual(await declined.wallet.signAndSendTransaction(new Uint8Array([1])), { kind: 'not-sent', why: 'Blockhash expired.' });
  const nowhere = setup();
  nowhere.bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1' });
  assert.deepEqual(await nowhere.wallet.signAndSendTransaction(new Uint8Array([1])), { kind: 'unavailable' });
  assert.deepEqual(nowhere.calls, [], 'never asked to sign');
});

test('who signed in: the X account\'s name, handle and picture, and nothing once signed out', () => {
  const { wallet, bridge } = setup();
  bridge.snapshot({ ready: true, signedIn: true, address: 'Addr1', identity: { name: 'Mercury', handle: 'mercury', pictureUrl: null } });
  assert.deepEqual(wallet.identity(), { name: 'Mercury', handle: 'mercury', pictureUrl: null });
  bridge.snapshot({ ready: true, signedIn: false, address: null, identity: { name: 'Mercury', handle: 'mercury', pictureUrl: null } });
  assert.equal(wallet.identity(), null);
});

test('sign-in can go straight to the method the person chose', async () => {
  const { wallet, calls } = setup();
  void wallet.connect('google');
  void wallet.connect('x');
  assert.deepEqual(calls.slice(0, 1), ['signIn:google']);
});
