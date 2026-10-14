/**
 * The addresses a poster's profile names: written out, or as the last part of a link to a coin page.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { bioAddresses } from './poster-bio.ts';

const P = DEFAULT_POLICY.attention;
const CA = 'AMQ8BusAhpwbt3ufSCTi4k3BEQ7AecX9u12Jnk6Spump';

describe('bioAddresses', () => {
  it('reads an address written out in the profile (a real one, 2026-10-14)', () => {
    assert.deepEqual(bioAddresses([`${CA}\n\nX: DikshitHardik\nAlso: DikshitHardik1`], P), [CA]);
  });
  it('★ reads an address that is only inside a link, which a reply read would drop', () => {
    assert.deepEqual(bioAddresses([`my coin https://example.com/coin/${CA}?ref=me`], P), [CA]);
    assert.deepEqual(bioAddresses([`example.com/token/${CA}`], P), [CA]);
  });
  it('finds nothing in a plain profile, and each address once across every text the account showed', () => {
    assert.deepEqual(bioAddresses(['Mama of 4 strength-testing miracles. Support link below', ''], P), []);
    assert.deepEqual(bioAddresses([CA, `CA: ${CA}`], P), [CA]);
  });
});
