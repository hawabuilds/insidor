/**
 * THE WALLET PORT, KEPT AS A STORE THE VENDOR'S HOOKS WRITE INTO — pure, no SDK, no DOM.
 *
 * The vendor's SDK is React hooks: sign-in state, the embedded wallet's address, a login modal.
 * The port (contracts/src/ports/wallet.ts) is a plain object any screen can read. This file is
 * the seam between them: `bridge` is written by the one component that calls the hooks
 * (EmbeddedWallet.tsx); `wallet` is what the app holds. Kept apart so every rule below is tested
 * with no SDK, no browser and no network.
 *
 * The rules, each the port's own:
 *   - `connect` opens the sign-in and RESOLVES with the outcome; it never rejects.
 *   - Closing the sign-in is `refused` — a person's normal choice, never a failure.
 *   - A vendor error becomes `failed: internal`; its message never reaches a state.
 *   - Signed in but the embedded wallet not yet created is `connecting`, not connected.
 *   - `signer()` is null in this phase: nothing signs until the trade path exists (Phase 5),
 *     and a signer handed out before then is a capability nobody asked for.
 *
 * What breaks if changed carelessly: there is no member here through which key material could
 * pass — no export, no import, no reveal. The vendor offers all three; this package uses none,
 * and a later change that wires one in has put a key one bug away from a log.
 */

import type { LinkOutcome, SendOutcome, SignInVia, Wallet, WalletIdentity, WalletState } from '@insidor/contracts/ports/wallet.ts';

/** What the vendor's hooks say, reduced to the three facts the port needs. */
export interface Snapshot {
  /** The SDK has finished starting. Before this nothing is known. */
  readonly ready: boolean;
  readonly signedIn: boolean;
  /** The embedded wallet's address; null while it is being created, or when signed out. */
  readonly address: string | null;
  /** The X account signed in with: name, handle, picture. Null when signed out. */
  readonly identity?: WalletIdentity | null;
  /** The provider's signed identity token, for our own services; null when signed out. */
  readonly token?: string | null;
  /** Outside wallets joined for viewing, by address. */
  readonly linked?: readonly string[];
}

export interface Actions {
  /** Opens the vendor's sign-in — the chosen method, or all of them. Its outcome arrives through `Bridge.signInEnded`. */
  signIn(via?: SignInVia): void;
  signOut(): Promise<void>;
  /** Opens the vendor's own export window for the embedded wallet. Resolves when it closes; carries nothing back. */
  showExport(): Promise<unknown>;
  /** Opens the vendor's own window to join an outside wallet. Its outcome arrives through `Bridge.linkEnded`. */
  linkWallet(): void;
  /** The vendor's signature on a transaction, from the embedded wallet. The key stays in the vendor's wallet. */
  signTransaction(payload: Uint8Array): Promise<Uint8Array>;
}

/** Sends a signed transaction: the trade service, which broadcasts it. */
export type Broadcast = (signed: Uint8Array) => Promise<{ readonly ok: true; readonly ref: string } | { readonly ok: false; readonly why: string }>;

/** The vendor's ways of saying the person closed or declined its signing prompt. */
const DECLINED = /reject|declin|cancel|closed|exited/i;

export interface Bridge {
  snapshot(s: Snapshot): void;
  actions(a: Actions | null): void;
  /** How a sign-in the person started ended: done, closed by them, or an error. */
  signInEnded(outcome: 'done' | 'closed' | 'error'): void;
  /** How joining an outside wallet ended. Only a word: the vendor's account object is not passed on. */
  linkEnded(outcome: 'linked' | 'closed' | 'error'): void;
}

/** The network every address here is on. The embedded wallet is created on mainnet only. */
const NETWORK = 'solana:mainnet';

export function embeddedWallet(options: { readonly broadcast?: Broadcast } = {}): { readonly wallet: Wallet; readonly bridge: Bridge } {
  let snap: Snapshot = { ready: false, signedIn: false, address: null };
  let act: Actions | null = null;
  /* The outcome of the last sign-in attempt, shown until the snapshot says something newer. */
  let attempt: 'none' | 'pending' | 'closed' | 'error' = 'none';
  let current: WalletState = { kind: 'unavailable' };
  const listeners = new Set<(s: WalletState) => void>();
  const waiters: ((s: WalletState) => void)[] = [];
  const linkWaiters: ((o: LinkOutcome) => void)[] = [];

  function derive(): WalletState {
    if (act === null) return { kind: 'unavailable' };
    if (snap.signedIn && snap.address !== null) return { kind: 'connected', account: snap.address, network: NETWORK };
    if (snap.signedIn || attempt === 'pending') return { kind: 'connecting' };
    if (attempt === 'closed') return { kind: 'refused' };
    if (attempt === 'error') return { kind: 'failed', code: 'internal' };
    return snap.ready ? { kind: 'disconnected' } : { kind: 'unavailable' };
  }

  function publish(): void {
    const next = derive();
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    for (const listener of [...listeners]) {
      try {
        listener(current);
      } catch {
        /* One subscriber failing must not starve the others. */
      }
    }
    if (current.kind !== 'connecting') for (const resolve of waiters.splice(0)) resolve(current);
  }

  const wallet: Wallet = {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async connect(via?: SignInVia) {
      if (current.kind === 'connected' || act === null) return current;
      const settled = new Promise<WalletState>((resolve) => waiters.push(resolve));
      attempt = 'pending';
      publish();
      try {
        act.signIn(via);
      } catch {
        attempt = 'error';
        publish();
      }
      return settled;
    },
    async disconnect() {
      attempt = 'none';
      try {
        await act?.signOut();
      } catch {
        /* Gone on our side either way: the next snapshot says what the vendor thinks. */
      }
      publish();
    },
    signer: () => null,
    sessionToken: () => (snap.signedIn ? (snap.token ?? null) : null),
    linkedWallets: () => (snap.signedIn ? (snap.linked ?? []) : []),
    linkWallet() {
      if (current.kind !== 'connected' || act === null) return Promise.resolve<LinkOutcome>('unavailable');
      return new Promise<LinkOutcome>((resolve) => {
        linkWaiters.push(resolve);
        try {
          act?.linkWallet();
        } catch {
          for (const w of linkWaiters.splice(0)) w('failed');
        }
      });
    },
    identity: () => (snap.signedIn ? snap.identity ?? null : null),
    /* Whatever the vendor's call resolves with is dropped here: the port answers with a word, never a value. */
    async showKeyExport() {
      if (current.kind !== 'connected' || act === null) return 'unavailable';
      try {
        await act.showExport();
        return 'shown';
      } catch {
        return 'failed';
      }
    },
    async signAndSendTransaction(payload): Promise<SendOutcome> {
      const actions = act;
      const broadcast = options.broadcast;
      if (current.kind !== 'connected' || actions === null || broadcast === undefined) return { kind: 'unavailable' };
      let signed: Uint8Array;
      try {
        signed = await actions.signTransaction(payload);
      } catch (e) {
        /* The vendor's words are not kept: only whether the person declined. */
        const said = e instanceof Error ? `${e.name} ${e.message}` : typeof e === 'string' ? e : '';
        return DECLINED.test(said) ? { kind: 'refused' } : { kind: 'failed', code: 'internal' };
      }
      try {
        const sent = await broadcast(signed);
        return sent.ok ? { kind: 'sent', ref: sent.ref } : { kind: 'not-sent', why: sent.why };
      } catch {
        return { kind: 'not-sent', why: 'The network could not be reached. Nothing was sent; try again.' };
      }
    },
  };

  const bridge: Bridge = {
    snapshot(s) {
      const linkedChanged = JSON.stringify(s.linked ?? []) !== JSON.stringify(snap.linked ?? []);
      snap = s;
      if (s.signedIn && s.address !== null) attempt = 'none';
      publish();
      /* A wallet joined or dropped changes no state, but the screens listing wallets must hear it. */
      if (linkedChanged) for (const listener of [...listeners]) listener(current);
    },
    linkEnded(outcome) {
      const word: LinkOutcome = outcome === 'linked' ? 'linked' : outcome === 'closed' ? 'refused' : 'failed';
      for (const w of linkWaiters.splice(0)) w(word);
    },
    actions(a) {
      act = a;
      publish();
    },
    signInEnded(outcome) {
      attempt = outcome === 'done' ? (snap.signedIn ? 'none' : 'pending') : outcome;
      publish();
    },
  };

  return { wallet, bridge };
}
