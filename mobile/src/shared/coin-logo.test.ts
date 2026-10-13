/**
 * The coin logo's order: our copy, then the launchpad's copy for its own coins, then the coin's own
 * picture (through a chain of gateways when it is content-addressed), then the letter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { IPFS_GATEWAYS, logoGradient, logoLetter, logoSources, pictureChain } from './coin-logo.ts';

const A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

test('★ our copy first, built from the address; then the coin\'s own picture', () => {
  assert.deepEqual(logoSources(A, 'https://gw.example/ipfs/x', 'https://store.example/coin-logos'), ['https://store.example/coin-logos/' + A, 'https://gw.example/ipfs/x']);
});

test('without storage configured, or without an address, only the coin\'s own picture', () => {
  assert.deepEqual(logoSources(A, 'https://gw.example/ipfs/x', ''), ['https://gw.example/ipfs/x']);
  assert.deepEqual(logoSources(null, null, 'https://store.example'), []);
  assert.deepEqual(logoSources('../etc', null, 'https://store.example'), []);
});

const CID = 'bafkreighm2xtaqmkgdgk5ysv5dc6tek6uvzjktv7f42ean7det7cr4qfde';

test('★ an IPFS picture is tried on its own host, then each gateway, resized first where the gateway can', () => {
  const chain = pictureChain(`https://own.example/ipfs/${CID}`);
  assert.equal(chain[0], `https://own.example/ipfs/${CID}`);
  assert.equal(chain[1], `https://pump.mypinata.cloud/ipfs/${CID}?img-width=256&img-height=256&img-format=webp`);
  for (const g of IPFS_GATEWAYS) assert.ok(chain.includes(`${g}/ipfs/${CID}`));
  assert.deepEqual(pictureChain(`ipfs://${CID}`).slice(-3), IPFS_GATEWAYS.slice(1).map((g) => `${g}/ipfs/${CID}`));
});

test('a picture that names no content id is itself, a local preview included', () => {
  assert.deepEqual(pictureChain('https://cdn.example/p.webp'), ['https://cdn.example/p.webp']);
  assert.deepEqual(pictureChain('blob:https://insidor.app/1'), ['blob:https://insidor.app/1']);
  assert.deepEqual(logoSources(A, `ipfs://${CID}`, 'https://store.example').slice(0, 2), ['https://store.example/' + A, `https://pump.mypinata.cloud/ipfs/${CID}?img-width=256&img-height=256&img-format=webp`]);
});

test('the letter is the ticker\'s first, and a coin keeps one colour', () => {
  assert.equal(logoLetter('$wif'), 'W');
  assert.equal(logoLetter(null), '?');
  assert.equal(logoGradient(A), logoGradient(A));
});

const P = 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump';

test('★ a launchpad coin: our copy, then the launchpad\'s resized copy, then its own picture', () => {
  assert.deepEqual(logoSources(P, `ipfs://${CID}`, 'https://store.example/coin-logos').slice(0, 3), [
    'https://store.example/coin-logos/' + P,
    `https://images.pump.fun/coin-image/${P}?variant=256x256`,
    `https://pump.mypinata.cloud/ipfs/${CID}?img-width=256&img-height=256&img-format=webp`,
  ]);
});

test('★ a launchpad coin with no picture in its reply still has a real source before the letter', () => {
  assert.deepEqual(logoSources(P, null, ''), [`https://images.pump.fun/coin-image/${P}?variant=256x256`]);
  assert.deepEqual(logoSources(P, null, 'https://store.example'), ['https://store.example/' + P, `https://images.pump.fun/coin-image/${P}?variant=256x256`]);
});

test('★ any other coin is never sent to the launchpad\'s image service, whose placeholder would hide the letter', () => {
  assert.ok(logoSources(A, null, 'https://store.example').every((u) => !u.includes('images.pump.fun')));
  assert.ok(logoSources('../pump', null, '').length === 0);
});
