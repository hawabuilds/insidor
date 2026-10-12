import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WalletState } from '@insidor/contracts/ports/wallet.ts';

import { gateFor } from '../../shared/sign-in.ts';

const s = (kind: WalletState['kind']): WalletState => (kind === 'connected' || kind === 'wrong-network' ? { kind, account: 'A', network: 'solana:mainnet' } : kind === 'failed' ? { kind, code: 'internal' } : { kind }) as WalletState;

test('★ with sign-in set up, only a signed-in person gets past the door, on every address', () => {
  assert.equal(gateFor({ configured: true, state: s('connected'), entered: false }), 'app');
  for (const kind of ['disconnected', 'refused', 'failed'] as const) {
    assert.equal(gateFor({ configured: true, state: s(kind), entered: true }), 'landing', `${kind} shows the door, even to someone signed in before`);
  }
  assert.equal(gateFor({ configured: true, state: s('unavailable'), entered: false }), 'landing', 'a first visit waits at the door while sign-in starts');
});

test('★ a returning person is held, never shown the door, while their session comes back', () => {
  assert.equal(gateFor({ configured: true, state: s('unavailable'), entered: true }), 'holding');
  assert.equal(gateFor({ configured: true, state: s('connecting'), entered: true }), 'holding');
  assert.equal(gateFor({ configured: true, state: s('connecting'), entered: false }), 'landing', 'mid sign-in from the door stays on the door');
});

test('a build with no sign-in is the demo: the door until Join now, then the sample screens', () => {
  assert.equal(gateFor({ configured: false, state: s('unavailable'), entered: false }), 'landing');
  assert.equal(gateFor({ configured: false, state: s('unavailable'), entered: true }), 'app');
});
