/**
 * THE ONE FILE THAT TALKS TO THE WALLET VENDOR'S SDK.
 *
 * Renders the vendor's provider and one invisible component that reads the vendor's hooks and
 * writes what the app needs into the store (store.ts): ready, signed in, the embedded wallet's
 * address, who signed in. Everything the app sees goes through the wallet port; nothing here is
 * exported for a screen to call.
 *
 * ★ NO VENDOR SCREEN IN SIGN-UP OR TRADING (the owner, 2026-10-22). Sign-in is drawn by the app
 * (mobile features/landing and features/onboarding) and done here with the vendor's headless calls:
 * email with `useLoginWithEmail` (sendCode, loginWithCode), and Apple, Google and X with
 * `useLoginWithOAuth` (initOAuth), which leaves for the provider's own page and finishes when the
 * page comes back with this component mounted. The embedded Solana wallet is made on sign-in with
 * no screen (`createOnLogin`, and `useCreateWallet` as the net). `showWalletUIs: false` turns the
 * vendor's approve window off for every signature, so the app's own Buy and Sell pop-ups are the
 * only confirmation a person sees. The vendor's login modal (`useLogin`) is no longer used.
 *
 * ★ NO KEY EVER. Export opens the vendor's own window (`useExportWallet`), which draws the key in a
 * frame on the vendor's domain — the one vendor screen left, on purpose; our code is handed nothing
 * and passes nothing on. The address is read from the user's linked accounts (the embedded wallet
 * is the one the vendor itself created).
 *
 * What breaks if changed carelessly: the error codes. A vendor error becomes one of the port's
 * closed words (store.ts `emailErrorOf`, `signInEnded`); passing the vendor's text through would
 * put a vendor string where the port promises none can go. And `showWalletUIs`: turned back on, a
 * second confirmation appears over our own pop-ups, and the earlier crash note below applies again.
 */

import { PrivyProvider, useIdentityToken, useLinkAccount, useLoginWithEmail, useLoginWithOAuth, usePrivy } from '@privy-io/react-auth';
import { defaultSolanaRpcsPlugin, toSolanaWalletConnectors, useCreateWallet, useExportWallet, useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useEffect, useRef, type ReactNode } from 'react';

import type { Bridge } from './store.ts';

/** The vendor's code for a person closing the sign-in themselves. */
const CLOSED_BY_PERSON = 'exited_auth_flow';
/** The vendor's codes for a person saying no on the provider's own page. */
const DENIED_BY_PERSON = new Set([CLOSED_BY_PERSON, 'oauth_user_denied']);
/** The provider's page each of our buttons leaves for. */
const PROVIDER = { x: 'twitter', google: 'google', apple: 'apple' } as const;
/** The provider's page came back to us: the address carries the vendor's state and code. */
const RETURNING = typeof window !== 'undefined' && /[?&]privy_oauth_(state|code)=/.test(window.location.search);
/** How long a returning sign-in may take to finish before the door says it did not. */
const RETURN_WAIT_MS = 20_000;

/* Made once: a new connectors object each render would restart the vendor's wallet discovery. */
const CONNECTORS = toSolanaWalletConnectors();

/*
 * ★ THE APPROVE WINDOW NEEDS A NETWORK CONNECTION, OR IT CRASHES THE WHOLE APP. The vendor's
 * approve screen asks for its chain's connection while it draws (to simulate the transaction and
 * show the fee and balance), and with none configured it throws "No RPC configuration found for
 * chain solana:mainnet" in the middle of rendering. Nothing catches that inside the vendor's window,
 * so React unmounts the app: the screen goes black and no approve window is ever seen. That was
 * Buy, Sell, quick buy and Create, all at once (2026-10-14). Trador hit the same thing and passes
 * its own connections (`solana.rpcs`, through its own /api/rpc); we have no browser-facing RPC, and
 * the approve window only reads, so this uses the vendor's own hosted connection for this app. The
 * trade service still sends every transaction; this connection never broadcasts anything of ours.
 * Made once: the vendor re-registers its plugins whenever the array changes.
 */
const PLUGINS = [defaultSolanaRpcsPlugin()];

export function EmbeddedWalletProvider({ appId, bridge, children }: { appId: string; bridge: Bridge; children: ReactNode }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        /* Our own sign-in screens use these four; each must be switched on in the vendor's dashboard too. */
        loginMethods: ['email', 'apple', 'google', 'twitter'],
        /* Made on sign-in with no screen; the vendor's approve window is off (see the header). */
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
        /* Outside wallets are joined for viewing only, through the vendor's own connect window. */
        externalWallets: { solana: { connectors: CONNECTORS } },
        plugins: PLUGINS,
        appearance: { theme: 'dark', accentColor: '#9945FF', walletChainType: 'solana-only', walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'] },
      }}
    >
      <VendorBridge bridge={bridge} />
      {children}
    </PrivyProvider>
  );
}

function VendorBridge({ bridge }: { bridge: Bridge }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const ended = {
    onComplete: () => bridge.signInEnded('done'),
    onError: (code: unknown) => bridge.signInEnded(typeof code === 'string' && DENIED_BY_PERSON.has(code) ? 'closed' : 'error'),
  };
  const { initOAuth, state: oauth } = useLoginWithOAuth(ended);
  const { sendCode, loginWithCode } = useLoginWithEmail(ended);

  /* Back from the provider's page: connecting while the vendor finishes, never the door flashing,
     and an error if it never does. */
  const signedInNow = useRef(authenticated);
  signedInNow.current = authenticated;
  useEffect(() => {
    if (!RETURNING) return;
    bridge.signInPending();
    const t = setTimeout(() => {
      if (!signedInNow.current) bridge.signInEnded('error');
    }, RETURN_WAIT_MS);
    return () => clearTimeout(t);
  }, [bridge]);
  /* Finished: the vendor's state and code are taken off the address, so a reload is not a second return. */
  useEffect(() => {
    if (!RETURNING || !(authenticated || oauth.status === 'error')) return;
    const url = new URL(window.location.href);
    for (const k of [...url.searchParams.keys()]) if (k.startsWith('privy_oauth_')) url.searchParams.delete(k);
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [authenticated, oauth.status]);
  useEffect(() => {
    if (oauth.status === 'error') {
      const code = (oauth.error as { privyErrorCode?: unknown } | null)?.privyErrorCode;
      bridge.signInEnded(typeof code === 'string' && DENIED_BY_PERSON.has(code) ? 'closed' : 'error');
    }
  }, [oauth, bridge]);

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
  const { exportWallet } = useExportWallet();
  const { identityToken } = useIdentityToken();
  const { linkWallet } = useLinkAccount({
    onSuccess: () => bridge.linkEnded('linked'),
    onError: (code: unknown) => bridge.linkEnded(code === CLOSED_BY_PERSON ? 'closed' : 'error'),
  });
  /* Outside Solana wallets joined to this account: addresses only, for viewing. */
  const linked = (user?.linkedAccounts ?? []).flatMap((a) =>
    a.type === 'wallet' && 'chainType' in a && a.chainType === 'solana' && 'walletClientType' in a && a.walletClientType !== 'privy' && 'address' in a && typeof a.address === 'string' ? [a.address] : [],
  );
  const linkedKey = linked.join(',');
  const signer = wallets.find((w) => w.address === address) ?? null;

  useEffect(() => {
    bridge.actions({
      /* Leaves for the provider's own page; nothing is drawn by the vendor. With no method named
         (a Sign in button inside the app), X, as the door offered first before sign-up. */
      signIn: (via) => {
        initOAuth({ provider: PROVIDER[via ?? 'x'] }).catch(() => bridge.signInEnded('error'));
      },
      sendEmailCode: (email) => sendCode({ email }),
      loginWithEmailCode: (code) => loginWithCode({ code }),
      signOut: () => logout(),
      showExport: () => (address === null ? Promise.reject(new Error('no embedded wallet')) : exportWallet({ address })),
      linkWallet: () => linkWallet({ walletChainType: 'solana-only' }),
      signTransaction: async (payload) => {
        if (signer === null) throw new Error('no embedded wallet to sign with');
        const { signedTransaction } = await signTransaction({ transaction: payload, wallet: signer, chain: 'solana:mainnet' });
        return signedTransaction;
      },
    });
    return () => bridge.actions(null);
  }, [bridge, initOAuth, sendCode, loginWithCode, logout, signer, signTransaction, exportWallet, linkWallet, address]);

  /* Who signed in, as the vendor reports it: the X account, or the Google account's name. An
     email address is never passed on — it is not a name, and nothing here needs it. */
  const x = user?.twitter;
  const name = x?.name ?? user?.google?.name ?? null;
  const handle = x?.username ?? null;
  const pictureUrl = x?.profilePictureUrl ?? null;

  useEffect(() => {
    bridge.snapshot({ ready, signedIn: authenticated, address, identity: { name, handle, pictureUrl }, token: identityToken, linked: linkedKey === '' ? [] : linkedKey.split(',') });
  }, [bridge, ready, authenticated, address, name, handle, pictureUrl, identityToken, linkedKey]);

  return null;
}
