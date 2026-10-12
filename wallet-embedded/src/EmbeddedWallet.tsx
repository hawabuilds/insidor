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

import { PrivyProvider, useLogin, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, useRef, type ReactNode } from 'react';

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

  /* The embedded wallet: the Solana wallet the vendor created for this user. */
  const embedded = (user?.linkedAccounts ?? []).find(
    (a) => a.type === 'wallet' && 'chainType' in a && a.chainType === 'solana' && 'walletClientType' in a && a.walletClientType === 'privy',
  );
  const { wallets, ready: walletsReady } = useWallets();
  const address = embedded !== undefined && 'address' in embedded && typeof embedded.address === 'string' ? embedded.address : (wallets[0]?.address ?? null);

  /*
   * ★ SIGNED IN WITH NO WALLET IS NOT A STATE TO WAIT IN. The vendor makes the wallet on sign-in,
   * but an account that signed in before Solana wallets were switched on, or whose creation
   * failed, comes back with none — and the store would say "connecting" for ever, the door stuck
   * on Loading. So it is made here, once; if that fails, the person is signed out and told sign-in
   * did not finish, and Join now is offered again.
   */
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || address !== null || creating.current) return;
    creating.current = true;
    createWallet()
      .catch(async () => {
        await logout().catch(() => undefined);
        bridge.signInEnded('error');
      })
      .finally(() => {
        creating.current = false;
      });
  }, [ready, authenticated, walletsReady, address, createWallet, logout, bridge]);

  /* Signing: the vendor's Solana wallet for this address. Signs only; sending is the caller's. */
  const { signTransaction } = useSignTransaction();
  const signer = wallets.find((w) => w.address === address) ?? null;

  useEffect(() => {
    bridge.actions({
      /* Always the vendor's own sign-in sheet, as Trador opens it — narrowed to the one provider
         the front door named. Its headless OAuth call is not used: it skips the sheet, takes a
         different route through the provider, and is not what Trador runs. */
      signIn: (via) => login(via === undefined ? undefined : { loginMethods: [via === 'x' ? 'twitter' : 'google'] }),
      signOut: () => logout(),
      signTransaction: async (payload) => {
        if (signer === null) throw new Error('no embedded wallet to sign with');
        const { signedTransaction } = await signTransaction({ transaction: payload, wallet: signer, chain: 'solana:mainnet' });
        return signedTransaction;
      },
    });
    return () => bridge.actions(null);
  }, [bridge, login, logout, signer, signTransaction]);

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
