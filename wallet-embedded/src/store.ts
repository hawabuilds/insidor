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
 *   - ★ An identity token near its end is renewed before it is sent (`freshSessionToken`). The
 *     vendor renews it only when asked; before 2026-11-11 nothing asked, so a phone left open
 *     past the token's life was refused by every service and its person told to sign in again.
 *
 * Sign-in is ours to draw (the owner, 2026-10-22: no vendor screens): Apple, Google and X leave for
 * the provider's own page and come back; email is two calls, a code sent and a code typed, each
 * answered with a closed word (`emailErrorOf`), never the vendor's message.
 *
 * What breaks if changed carelessly: there is no member here through which key material could
 * pass — no export, no import, no reveal. The vendor offers all three; this package uses none,
 * and a later change that wires one in has put a key one bug away from a log.
 */

import type { EmailCodeResult, EmailCodeSent, LinkOutcome, SendOutcome, SignInVia, Wallet, WalletIdentity, WalletState } from '@insidor/contracts/ports/wallet.ts';

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
  /** Leaves for the provider's own sign-in page (Apple, Google, X). Its outcome arrives through `Bridge.signInEnded`, after the page comes back. */
  signIn(via?: SignInVia): void;
  /** Email sign-in, step one: the vendor sends a code. Throws the vendor's error; `emailErrorOf` reads it. */
  sendEmailCode(email: string): Promise<void>;
  /** Email sign-in, step two. Resolves once the vendor accepted the code; throws the vendor's error otherwise. */
  loginWithEmailCode(code: string): Promise<void>;
  signOut(): Promise<void>;
  /** Opens the vendor's own export window for the embedded wallet. Resolves when it closes; carries nothing back. */
  showExport(): Promise<unknown>;
  /** Opens the vendor's own window to join an outside wallet. Its outcome arrives through `Bridge.linkEnded`. */
  linkWallet(): void;
  /** The vendor's signature on a transaction, from the embedded wallet. The key stays in the vendor's wallet. */
  signTransaction(payload: Uint8Array): Promise<Uint8Array>;
  /** Renews the session and answers the new identity token; null when the session itself is gone. */
  renewToken(): Promise<string | null>;
}

/** A token with less than this left is renewed before it is sent, so it cannot run out on the way. */
const RENEW_BEFORE_MS = 60_000;

/** When a token runs out, ms, read from its unverified `exp`; null when it carries none. The services verify; this only decides when to renew. */
export function tokenExpiresAt(token: string): number | null {
  try {
    const part = token.split('.')[1] ?? '';
    const exp = (JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Sends a signed transaction: the trade service, which broadcasts it. */
export type Broadcast = (signed: Uint8Array) => Promise<{ readonly ok: true; readonly ref: string } | { readonly ok: false; readonly why: string }>;

/**
 * A vendor error from the email sign-in, as one of our closed words — read from the vendor's code
 * field and nothing else, so its message never reaches a screen. Pure, and tested.
 */
export function emailErrorOf(e: unknown): 'wrong-code' | 'expired' | 'too-many' | 'invalid-email' | 'failed' {
  const code = typeof e === 'object' && e !== null ? (e as { privyErrorCode?: unknown }).privyErrorCode : undefined;
  if (code === 'invalid_credentials') return 'wrong-code';
  if (code === 'too_many_requests') return 'too-many';
  if (code === 'invalid_data' || code === 'disallowed_plus_email') return 'invalid-email';
  if (code === 'missing_or_invalid_token') return 'expired';
  return 'failed';
}

/** The vendor's ways of saying the person closed or declined its signing prompt. */
const DECLINED = /reject|declin|cancel|closed|exited/i;

export interface Bridge {
  snapshot(s: Snapshot): void;
  actions(a: Actions | null): void;
  /** A sign-in is under way that no tap here started: the provider's page came back and is being finished. */
  signInPending(): void;
  /** How a sign-in the person started ended: done, closed by them, or an error. */
  signInEnded(outcome: 'done' | 'closed' | 'error'): void;
  /** How joining an outside wallet ended. Only a word: the vendor's account object is not passed on. */
  linkEnded(outcome: 'linked' | 'closed' | 'error'): void;
}

/** The network every address here is on. The embedded wallet is created on mainnet only. */
const NETWORK = 'solana:mainnet';

export function embeddedWallet(options: { readonly broadcast?: Broadcast; readonly now?: () => number } = {}): { readonly wallet: Wallet; readonly bridge: Bridge } {
  const now = options.now ?? Date.now;
  let snap: Snapshot = { ready: false, signedIn: false, address: null };
  let act: Actions | null = null;
  /* One renewal at a time: a screen firing ten calls at once renews the session once, not ten times. */
  let renewing: Promise<string | null> | null = null;
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
    async sendEmailCode(email: string): Promise<EmailCodeSent> {
      if (act === null) return 'unavailable';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'invalid-email';
      try {
        await act.sendEmailCode(email.trim());
        return 'sent';
      } catch (e) {
        const word = emailErrorOf(e);
        return word === 'wrong-code' || word === 'expired' ? 'failed' : word;
      }
    },
    async signInWithEmailCode(code: string): Promise<EmailCodeResult> {
      if (act === null) return 'unavailable';
      if (!/^\d{6}$/.test(code)) return 'wrong-code';
      try {
        await act.loginWithEmailCode(code);
      } catch (e) {
        const word = emailErrorOf(e);
        return word === 'invalid-email' ? 'failed' : word;
      }
      /* The code was right: the snapshot that follows says signed in, and the wallet is made. */
      if (!(snap.signedIn && snap.address !== null)) attempt = 'pending';
      publish();
      return 'signed-in';
    },
    signer: () => null,
    sessionToken: () => (snap.signedIn ? (snap.token ?? null) : null),
    async freshSessionToken(force = false) {
      if (!snap.signedIn) return null;
      const held = snap.token ?? null;
      const exp = held === null ? null : tokenExpiresAt(held);
      if (!force && held !== null && (exp === null || exp - now() > RENEW_BEFORE_MS)) return held;
      const actions = act;
      if (actions === null) return held;
      renewing ??= actions
        .renewToken()
        .then((t) => {
          if (t !== null && snap.signedIn) snap = { ...snap, token: t };
          return t;
        })
        .catch(() => null)
        .finally(() => {
          renewing = null;
        });
      /* A renewal that could not be made sends what is held: the service's answer, not ours, says whether it still works. */
      const renewed = await renewing;
      return snap.signedIn ? (renewed ?? held) : null;
    },
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
        /* Closing the approve window arrives wrapped: the outer error says "failed to connect", and
           only its cause says the person exited. Both are read, so a cancel is never a failure. */
        const cause = e instanceof Error && e.cause instanceof Error ? ` ${e.cause.message}` : '';
        const said = e instanceof Error ? `${e.name} ${e.message}${cause}` : typeof e === 'string' ? e : '';
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
    signInPending() {
      if (snap.signedIn && snap.address !== null) return;
      attempt = 'pending';
      publish();
    },
    signInEnded(outcome) {
      attempt = outcome === 'done' ? (snap.signedIn ? 'none' : 'pending') : outcome;
      publish();
    },
  };

  return { wallet, bridge };
}
