/**
 * WHO IS ASKING — Privy's identity token, checked. The phone app sends the token Privy gave it at
 * sign-in; this verifies its signature against Privy's published keys for our app, its issuer,
 * audience and expiry, and reads the person from its `linked_accounts` claim: the X account
 * (handle, name, picture), a Google name, and the Solana wallets.
 *
 * ★ ONLY A SIGNED TOKEN MAKES A PERSON. A token that fails any check is null. Nothing the
 * browser says about itself is used — not a handle, not a wallet — so a like is checked against
 * the voter's own wallet, which the sign-in provider vouched for.
 *
 * ★ A GOOGLE EMAIL IS NEVER READ INTO A PERSON. It is in the token; it is not a name, and no
 * screen needs it.
 *
 * What breaks if changed carelessly: the wallet kind. Only Privy's own embedded wallet is
 * `embedded`; anything joined from outside (Phantom) is `linked`, for viewing. Trading reads the
 * allowlist, never this, but the Portfolio's Send is offered only for the embedded one.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import type { IdentityCheck, Person, PersonWallet } from '@insidor/contracts/ports/people.ts';

const ISSUER = 'privy.io';
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Claims = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The person in a verified token's claims. Pure, so it is tested on recorded claims. */
export function personFromClaims(claims: Claims): Person | null {
  const userId = str(claims['sub']);
  if (userId === null) return null;
  let accounts: unknown = claims['linked_accounts'];
  if (typeof accounts === 'string') {
    try {
      accounts = JSON.parse(accounts);
    } catch {
      accounts = [];
    }
  }
  const list = Array.isArray(accounts) ? (accounts as Claims[]) : [];
  const x = list.find((a) => a['type'] === 'twitter_oauth');
  const google = list.find((a) => a['type'] === 'google_oauth');
  const wallets: PersonWallet[] = list
    .filter((a) => a['type'] === 'wallet' && a['chain_type'] === 'solana' && typeof a['address'] === 'string' && ADDRESS.test(a['address']))
    .map((a) => ({ address: a['address'] as string, kind: a['wallet_client_type'] === 'privy' ? 'embedded' : 'linked' }));
  return {
    userId,
    handle: str(x?.['username'])?.replace(/^@/, '') ?? null,
    name: str(x?.['name']) ?? str(google?.['name']) ?? null,
    pictureUrl: str(x?.['profile_picture_url']),
    wallets,
  };
}

export function privyIdentity(cfg: { readonly appId: string; readonly keys?: JWTVerifyGetKey }): IdentityCheck {
  const keys = cfg.keys ?? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${encodeURIComponent(cfg.appId)}/jwks.json`));
  return {
    async verify(token) {
      if (token.trim() === '') return null;
      try {
        const { payload } = await jwtVerify(token, keys, { issuer: ISSUER, audience: cfg.appId, algorithms: ['ES256'] });
        return personFromClaims(payload as Claims);
      } catch {
        return null;
      }
    },
  };
}
