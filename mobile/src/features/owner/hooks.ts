/**
 * The owner's hooks: whether this sign-in is the owner, what the owner just did, and the owner's
 * saved calls on the items in view.
 *
 * ★ ASKED ONCE PER SIGN-IN. `/me/owner` is read when the wallet connects and forgotten when it
 * disconnects, so a second person signing in on the same phone never inherits the controls. Until
 * the answer arrives the controls are not drawn: not-yet-known is treated as not the owner.
 */

import { useEffect, useSyncExternalStore } from 'react';

import { fetchCalls, fetchIsOwner, type CallKind } from '../../shared/api/owner.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { ownerStore, type OwnerState } from './owner-store.ts';

let asked: Promise<void> | null = null;

export function useOwnerState(): OwnerState {
  return useSyncExternalStore(ownerStore.subscribe, ownerStore.get, ownerStore.get);
}

/** True only when the services said this sign-in is the owner. */
export function useIsOwner(): boolean {
  const { state } = useWallet();
  const connected = state.kind === 'connected';
  const owner = useOwnerState().owner;
  useEffect(() => {
    if (!connected) {
      asked = null;
      if (ownerStore.get().owner !== null) ownerStore.setOwner(null);
      return;
    }
    if (asked === null) asked = fetchIsOwner().then((yes) => ownerStore.setOwner(yes));
  }, [connected]);
  return owner === true;
}

/** Reads the owner's saved calls on these items into the store, when the owner is looking. */
export function useSavedCalls(kind: CallKind, itemIds: readonly string[], owner: boolean): void {
  const key = owner ? itemIds.slice(0, 100).join(',') : '';
  useEffect(() => {
    if (key === '') return;
    let live = true;
    fetchCalls(kind, key.split(',')).then(
      (calls) => {
        if (live) ownerStore.remember(calls);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [kind, key]);
}
