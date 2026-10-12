/**
 * THE ONE FILE THAT TALKS TO THE WALLET VENDOR'S SDK.
 *
 * Renders the vendor's provider — sign-in with X or Google, an embedded Solana wallet created for
 * anyone who signs in without one — and one invisible component that reads the vendor's hooks
 * and writes three facts into the store (store.ts): ready, signed in, the embedded wallet's
 * address. Everything the app sees goes through the wallet port; nothing here is exported for a
 * screen to call.
 *
 * ★ NO KEY EVER. The vendor offers exporting the embedded wallet's key and importing a key; this
 * package uses neither, and there is no screen for either. The address is read from the user's
 * linked accounts (the embedded wallet is the one the vendor itself created), so the vendor's
 * chain entry point, and a chain library with it, is never loaded.
 *
 * What breaks if changed carelessly: the error code. The sign-in's own "the person closed it"
 * is `refused`; every other code is `failed` with no detail. Passing the vendor's code through
 * would put a vendor string where the port promises none can go.
 */

import { PrivyProvider, useLogin, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, type ReactNode } from 'react';

import type { Bridge } from './store.ts';

/** The vendor's code for a person closing the sign-in themselves. */
const CLOSED_BY_PERSON = 'exited_auth_flow';

export function EmbeddedWalletProvider({ appId, bridge, children }: { appId: string; bridge: Bridge; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['twitter', 'google'],
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
        appearance: { theme: 'dark', accentColor: '#9945FF', walletChainType: 'solana-only' },
      }}
    >
      <VendorBridge bridge={bridge} />
      {children}
    </PrivyProvider>
  );
}

function VendorBridge({ bridge }: { bridge: Bridge }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const { login } = useLogin({
    onComplete: () => bridge.signInEnded('done'),
    onError: (code: unknown) => bridge.signInEnded(code === CLOSED_BY_PERSON ? 'closed' : 'error'),
  });

  /* Straight to one provider when the front door named it; the vendor's own sheet otherwise. */
  const { initOAuth } = useLoginWithOAuth({
    onComplete: () => bridge.signInEnded('done'),
    onError: (code: unknown) => bridge.signInEnded(code === CLOSED_BY_PERSON ? 'closed' : 'error'),
  });

  /* The embedded wallet: the Solana wallet the vendor created for this user. */
  const embedded = (user?.linkedAccounts ?? []).find(
    (a) => a.type === 'wallet' && 'chainType' in a && a.chainType === 'solana' && 'walletClientType' in a && a.walletClientType === 'privy',
  );
  const address = embedded !== undefined && 'address' in embedded && typeof embedded.address === 'string' ? embedded.address : null;

  /* Signing: the vendor's Solana wallet for this address. Signs only; sending is the caller's. */
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const signer = wallets.find((w) => w.address === address) ?? null;

  useEffect(() => {
    bridge.actions({
      signIn: (via) => {
        if (via === undefined) login();
        else void initOAuth({ provider: via === 'x' ? 'twitter' : 'google' }).catch(() => bridge.signInEnded('error'));
      },
      signOut: () => logout(),
      signTransaction: async (payload) => {
        if (signer === null) throw new Error('no embedded wallet to sign with');
        const { signedTransaction } = await signTransaction({ transaction: payload, wallet: signer, chain: 'solana:mainnet' });
        return signedTransaction;
      },
    });
    return () => bridge.actions(null);
  }, [bridge, login, initOAuth, logout, signer, signTransaction]);

  /* Who signed in, as the vendor reports it: the X account, or the Google account's name. A
     Google email is never passed on — it is not a name, and nothing here needs it. */
  const x = user?.twitter;
  const name = x?.name ?? user?.google?.name ?? null;
  const handle = x?.username ?? null;
  const pictureUrl = x?.profilePictureUrl ?? null;

  useEffect(() => {
    bridge.snapshot({ ready, signedIn: authenticated, address, identity: { name, handle, pictureUrl } });
  }, [bridge, ready, authenticated, address, name, handle, pictureUrl]);

  return null;
}
