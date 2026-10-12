/**
 * The wallet, for any screen that needs to know about it — the port and nothing else.
 *
 * main.tsx makes it (sign-in with X or Google, through @insidor/wallet-embedded) and hands it down here.
 * A screen reads its state; only the Wallet tab connects or disconnects. Nothing that decides a
 * button about a coin reads it: connecting a wallet never makes a button appear or change.
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Wallet, WalletState } from '@insidor/contracts/ports/wallet.ts';

const UNAVAILABLE: WalletState = { kind: 'unavailable' };
const WalletContext = createContext<Wallet | null>(null);

export function WalletProvider({ wallet, children }: { wallet: Wallet | null; children: ReactNode }) {
  return <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>;
}

export function useWallet(): { readonly wallet: Wallet | null; readonly state: WalletState } {
  const wallet = useContext(WalletContext);
  const state = useSyncExternalStore(
    (listener) => (wallet === null ? () => undefined : wallet.subscribe(listener)),
    () => (wallet === null ? UNAVAILABLE : wallet.state()),
  );
  return { wallet, state };
}
