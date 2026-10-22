import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';

import { gateFor } from '../../shared/sign-in.ts';

const s = (kind: WalletState['kind']): WalletState => (kind === 'connected' || kind === 'wrong-network' ? { kind, account: 'A', network: 'solana:mainnet' } : kind === 'failed' ? { kind, code: 'internal' } : { kind }) as WalletState;

test('★ with sign-in set up, only a signed-in person gets past the door, on every address', () => {
  assert.equal(gateFor({ configured: true, state: s('connected'), entered: false, access: 'in', signUp: 'done' }), 'app');
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
  assert.equal(first('in'), 'holding', 'let in: a moment while sign-up is asked about');
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

test('★ let in is not signed up: a step left is the sign-up screens; finished, or not readable, is the app', () => {
  const inWith = (signUp: 'unknown' | 'needed' | 'done' | 'unchecked') => gateFor({ configured: true, state: s('connected'), entered: false, access: 'in', signUp });
  assert.equal(inWith('unknown'), 'holding');
  assert.equal(inWith('needed'), 'onboarding');
  assert.equal(inWith('done'), 'app', 'a member who finished before, on a new phone');
  assert.equal(inWith('unchecked'), 'app', 'never held at a screen for a read that failed');
  assert.equal(gateFor({ configured: true, state: s('connected'), entered: true, access: 'unknown', signUp: 'needed' }), 'app', 'a browser let in before is never sent back');
  assert.equal(gateFor({ configured: true, state: s('connected'), entered: false, access: 'out', signUp: 'needed' }), 'invite', 'the invite gate comes first');
  assert.equal(gateFor({ configured: true, state: s('connected'), entered: false, access: 'waiting', signUp: 'needed' }), 'waitlist');
});
