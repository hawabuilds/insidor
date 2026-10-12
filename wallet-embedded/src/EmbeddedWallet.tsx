/**
 * THE ONE FILE THAT TALKS TO THE WALLET VENDOR'S SDK.
 *
 * Renders the vendor's provider — sign-in with X only, an embedded Solana wallet created for
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

import { PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { useEffect, type ReactNode } from 'react';

import type { Bridge } from './store.ts';

/** The vendor's code for a person closing the sign-in themselves. */
const CLOSED_BY_PERSON = 'exited_auth_flow';

export function EmbeddedWalletProvider({ appId, bridge, children }: { appId: string; bridge: Bridge; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['twitter'],
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

  /* The embedded wallet: the Solana wallet the vendor created for this user. */
  const embedded = (user?.linkedAccounts ?? []).find(
    (a) => a.type === 'wallet' && 'chainType' in a && a.chainType === 'solana' && 'walletClientType' in a && a.walletClientType === 'privy',
  );
  const address = embedded !== undefined && 'address' in embedded && typeof embedded.address === 'string' ? embedded.address : null;

  useEffect(() => {
    bridge.actions({ signIn: () => login(), signOut: () => logout() });
    return () => bridge.actions(null);
  }, [bridge, login, logout]);

  useEffect(() => {
    bridge.snapshot({ ready, signedIn: authenticated, address });
  }, [bridge, ready, authenticated, address]);

  return null;
}
