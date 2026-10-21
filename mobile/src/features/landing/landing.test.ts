import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';

import { gateFor } from '../../shared/sign-in.ts';

const s = (kind: WalletState['kind']): WalletState => (kind === 'connected' || kind === 'wrong-network' ? { kind, account: 'A', network: 'solana:mainnet' } : kind === 'failed' ? { kind, code: 'internal' } : { kind }) as WalletState;

test('★ with sign-in set up, only a signed-in person gets past the door, on every address', () => {
  assert.equal(gateFor({ configured: true, state: s('connected'), entered: false, access: 'in' }), 'app');
  for (const kind of ['disconnected', 'refused', 'failed'] as const) {
    assert.equal(gateFor({ configured: true, state: s(kind), entered: true }), 'landing', `${kind} shows the door, even to someone signed in before`);
  }
  assert.equal(gateFor({ configured: true, state: s('unavailable'), entered: false }), 'landing', 'a first visit waits at the door while sign-in starts');
});

test('★ a returning person goes straight in, never shown the door, while their session comes back', () => {
  assert.equal(gateFor({ configured: true, state: s('unavailable'), entered: true }), 'app');
  assert.equal(gateFor({ configured: true, state: s('connecting'), entered: true }), 'app');
  assert.equal(gateFor({ configured: true, state: s('connecting'), entered: false }), 'landing', 'mid sign-in from the door stays on the door');
});

test('a build with no sign-in is the demo: the door until Join now, then the sample screens', () => {
  assert.equal(gateFor({ configured: false, state: s('unavailable'), entered: false }), 'landing');
  assert.equal(gateFor({ configured: false, state: s('unavailable'), entered: true }), 'app');
});

test('★ invite only: a first sign-in is held, then let in, sent to the code box, or shown their place', () => {
  const first = (access: 'unknown' | 'in' | 'out' | 'waiting' | 'unchecked') => gateFor({ configured: true, state: s('connected'), entered: false, access });
  assert.equal(first('unknown'), 'holding', 'a moment while access is asked, never the app');
  assert.equal(first('in'), 'app');
  assert.equal(first('out'), 'invite', 'no access and no good code: the door with the code box');
  assert.equal(first('waiting'), 'waitlist');
  assert.equal(first('unchecked'), 'unchecked', 'could not ask is not a no');
  assert.equal(gateFor({ configured: true, state: s('connected'), entered: false }), 'holding', 'not asked yet is a hold');
});

test('★ a browser let in before goes straight in, whatever the access check is doing', () => {
  for (const access of ['unknown', 'out', 'unchecked'] as const) {
    assert.equal(gateFor({ configured: true, state: s('connected'), entered: true, access }), 'app', access);
  }
  assert.equal(gateFor({ configured: true, state: s('disconnected'), entered: false, access: 'in' }), 'landing', 'signed out is the door, access or not');
});
