/**
 * SUBSCRIBING TO THE WALLET, ONCE.
 *
 * WHAT IT IS RESPONSIBLE FOR: turning the port's `state()` / `subscribe()` pair into a React
 * value. That is the whole file, and it is a file rather than four lines inside the shell
 * because the shell and the buy panel must read the SAME frame — two subscriptions are two
 * frames, and the pair could show a connected chip above a panel still saying no wallet is
 * connected. `features/sources` holds one frame in one hook for exactly this reason.
 *
 * ★ WHY `useSyncExternalStore` AND NOT `useState` + `useEffect`: because the adapter's state
 * can change between render and effect — a wallet can be disconnected from the extension's
 * own window while React is mid-commit — and the effect-based spelling renders the stale
 * value for one frame. One frame of a stale account reference is one frame of a fact that
 * has stopped being true, which is the class of lie this codebase is arranged against. It
 * also requires the adapter to return the SAME object when nothing changed, which
 * `wallet/src/browser.ts` does deliberately; a new object per read here would be an infinite
 * render loop rather than a subtle bug, which is the failure mode to prefer.
 *
 * ★ NOTHING IS CACHED AND NOTHING IS PERSISTED. There is no local copy of the account
 * reference, no `localStorage`, no "reconnect on reload". The wallet is the only authority on
 * whether it is connected, and a remembered connection is a claim we could not check.
 */

import { useCallback, useSyncExternalStore } from 'react';

import type { Wallet, WalletState } from '@insidor/contracts/ports/wallet.ts';

export function useWalletState(wallet: Wallet): WalletState {
  /* Both are wrapped rather than passed straight through, so this hook holds for any
     implementation of the port — including one whose members are prototype methods that
     would lose their receiver when detached. The port promises nothing about that, so we do
     not rely on it. */
  const subscribe = useCallback(
    (onChange: () => void) => wallet.subscribe(onChange),
    [wallet],
  );
  const snapshot = useCallback(() => wallet.state(), [wallet]);
  return useSyncExternalStore(subscribe, snapshot);
}
