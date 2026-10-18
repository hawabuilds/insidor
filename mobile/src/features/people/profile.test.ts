/**
 * A profile's wallet, read strictly: it comes only with a shown portfolio and a Solana address,
 * and a private profile that still carries a wallet is refused rather than drawn.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeProfileWallet } from '../../shared/api/people.ts';

test("★ a profile's wallet comes only with a shown portfolio; a private one carrying a wallet is refused", () => {
  const card = { userId: 'u', handle: 'h', portfolio: 'shown', wallet: '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY' };
  assert.equal(decodeProfileWallet(card).wallet, card.wallet);
  assert.equal(decodeProfileWallet({ ...card, portfolio: 'private', wallet: null }).portfolio, 'private');
  assert.throws(() => decodeProfileWallet({ ...card, portfolio: 'private' }), 'private with a wallet');
  assert.throws(() => decodeProfileWallet({ ...card, wallet: 'not an address' }));
  assert.throws(() => decodeProfileWallet({ ...card, portfolio: undefined }), 'an old server without the field');
});
