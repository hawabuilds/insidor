/** A token only makes a person when its signature, issuer, audience and expiry check out; the person comes from the signed claims. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

import { personFromClaims, privyIdentity } from './index.ts';

const EMBEDDED = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';
const PHANTOM = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
/* Recorded from an identity token's claims, with the values changed. */
const LINKED = JSON.stringify([
  { type: 'twitter_oauth', subject: '1', username: 'hawa', name: 'Hawa', profile_picture_url: 'https://pbs.twimg.com/a.jpg' },
  { type: 'google_oauth', subject: '2', email: 'someone@example.com', name: 'Hawa G' },
  { type: 'wallet', address: EMBEDDED, chain_type: 'solana', wallet_client_type: 'privy' },
  { type: 'wallet', address: PHANTOM, chain_type: 'solana', wallet_client_type: 'phantom' },
  { type: 'wallet', address: '0xabc', chain_type: 'ethereum', wallet_client_type: 'metamask' },
]);

test('★ the person is read from the signed claims: X handle, name, picture, and wallets by kind; never an email', () => {
  const p = personFromClaims({ sub: 'did:privy:abc', linked_accounts: LINKED });
  assert.deepEqual(p, {
    userId: 'did:privy:abc',
    handle: 'hawa',
    name: 'Hawa',
    pictureUrl: 'https://pbs.twimg.com/a.jpg',
    wallets: [{ address: EMBEDDED, kind: 'embedded' }, { address: PHANTOM, kind: 'linked' }],
  });
  assert.ok(!JSON.stringify(p).includes('example.com'));
  assert.equal(personFromClaims({ linked_accounts: LINKED }), null, 'no subject, no person');
});

test('★ only a token signed by the provider, for our app, unexpired, makes a person', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'ES256', kid: 'k' }] });
  const identity = privyIdentity({ appId: 'app-1', keys });
  const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'k' }).setIssuer(opts.iss ?? 'privy.io').setAudience(opts.aud ?? 'app-1').setSubject('did:privy:abc').setIssuedAt().setExpirationTime(opts.exp ?? '1h').sign(privateKey);
  assert.equal((await identity.verify(await sign({ linked_accounts: LINKED })))?.handle, 'hawa');
  assert.equal(await identity.verify(await sign({}, { aud: 'someone-else' })), null);
  assert.equal(await identity.verify(await sign({}, { iss: 'evil' })), null);
  assert.equal(await identity.verify(await sign({}, { exp: '-1m' })), null);
  const { privateKey: other } = await generateKeyPair('ES256');
  const forged = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'k' }).setIssuer('privy.io').setAudience('app-1').setSubject('did:privy:abc').setExpirationTime('1h').sign(other);
  assert.equal(await identity.verify(forged), null, 'signed by anyone else');
  assert.equal(await identity.verify('not a token'), null);
});
