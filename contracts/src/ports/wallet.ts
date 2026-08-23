/**
 * THE WALLET PORT — connection and account reference, and deliberately nothing wider.
 *
 * WHAT IT IS RESPONSIBLE FOR: saying, in a closed set of shapes, what the relationship
 * between this browser and a person's wallet currently is, and handing out an opaque
 * account reference when there is one. It is the whole vocabulary the app is allowed to
 * render, and it is the whole vocabulary an adapter is allowed to produce.
 *
 * WHY IT LIVES HERE AND NOT BESIDE THE ADAPTER: because it has to be the same shape on
 * both sides of a boundary that does not exist yet. `Signer` below is already the shape a
 * venue's `execute` takes (ports/venue.ts) — bytes in, bytes out, plus an opaque account
 * reference. Declaring the browser's wallet against the SAME interface means the day a
 * server-side executor is written, the browser already speaks its language and nothing has
 * to be renegotiated. A port defined in the adapter would have been a second dialect.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY — and this is the one path in the product
 *   where a bug costs a person money, so the bar is different.
 *
 *   1. ★ THERE IS NOWHERE IN THIS FILE TO PUT A KEY. No field's type is secret material,
 *      no method returns one, and there is no `export`, `reveal` or `seed` member. That is
 *      not a promise, it is the absence of a place to keep the promise in. Signing happens
 *      inside the person's wallet; we hand it bytes and receive bytes. If a future member
 *      would let key material pass through our process, the design is wrong — not the code
 *      that implements it. Widening `Signer`, or adding a member here that yields anything
 *      a signature could be reconstructed from, defeats the only structural guarantee this
 *      product has on this path.
 *
 *   2. ★ NO STATE CARRIES FREE TEXT. Every string in `WalletState` is either a member of a
 *      closed set declared in this file, or one of the two opaque references. That is what
 *      makes it impossible for a vendor's error message — which may contain anything at
 *      all, including material the vendor decorated it with — to reach a render, a log or a
 *      wire payload. Adding a `detail: string` to `failed` would look helpful and would
 *      quietly reopen that door. The failure taxonomy is a closed union for exactly this
 *      reason: if a new failure is worth telling a person about, it earns a CODE here and a
 *      sentence in the app, not a passthrough.
 *
 *   3. ★ REFUSAL IS NOT FAILURE, AND THE TYPE SAYS SO. `refused` is its own branch, not a
 *      `WalletFailure`. A person who declined a connection prompt has had a normal
 *      interaction with their own software, and telling them something is broken is both
 *      false and the fastest way to make them distrust the next prompt. Collapsing `refused`
 *      into `failed` would erase the distinction at the type level, and no amount of care in
 *      the UI would get it back.
 *
 *   4. ★ AN ACCOUNT REFERENCE IS NOT A NAME. `AccountRef` is opaque: never parsed here,
 *      never resolved to a display name, never validated against any particular settlement
 *      layer's address format — that is a venue's knowledge and belongs behind the venue
 *      port. A surface that renders it renders it truncated and as a reference, never in the
 *      slot where a person's name goes.
 *
 * WHAT IS DELIBERATELY ABSENT: submission, confirmation polling, and idempotency. All three
 * belong to whoever holds the receipt and can survive a closed browser tab, which is a
 * service and not a tab. A wallet that could also submit is a wallet that could submit
 * something the person never read.
 */

import type { Signer } from './venue.ts';

/**
 * An account, as the wallet names it. Opaque: compared for equality, truncated for display,
 * and never parsed, resolved or used as a label.
 */
export type AccountRef = string;

/**
 * Which network the wallet is pointed at. Opaque for the same reason `ChainId` is: naming
 * one here would make every other a special case. Only ever compared against the network a
 * deployment declared it requires — never interpreted.
 */
export type NetworkRef = string;

/**
 * ★ THE CLOSED FAILURE TAXONOMY. Four codes, each of which a person can act on differently,
 * and no fifth bucket that carries a vendor's words through.
 *
 * `internal` is deliberately one opaque bucket rather than a passthrough. Everything we
 * could not classify lands in it and says so plainly. The alternative — forwarding whatever
 * the wallet threw — is how the one string nobody audited ends up on screen.
 */
export const WALLET_FAILURES = [
  /** The wallet is present but has not authorised this site to talk to it. */
  'unauthorized',
  /** The wallet reports itself as disconnected, or went away mid-request. */
  'disconnected',
  /** It connected and gave us nothing usable as an account reference. */
  'unreadable-account',
  /**
   * This deployment declared a required network and the wallet would not say which one it
   * is on. Distinct from `wrong-network`: that one is a known mismatch, this one is an
   * unanswered question, and claiming either as the other would be inventing a fact.
   */
  'unreadable-network',
  /** Anything else. Named, counted, and carrying nothing from whoever caused it. */
  'internal',
] as const;

export type WalletFailure = (typeof WALLET_FAILURES)[number];

export const WALLET_STATES = [
  'unavailable',
  'disconnected',
  'connecting',
  'connected',
  'refused',
  'wrong-network',
  'failed',
] as const;

export type WalletStateKind = (typeof WALLET_STATES)[number];

/**
 * ★ SEVEN STATES, AND NO TWO OF THEM COLLAPSE.
 *
 * The count is the point. The surface this replaces was a boolean, and a boolean cannot
 * tell "you have no wallet extension" from "you pressed cancel" from "your wallet is on
 * another network" — three situations with three different next actions, one of which is
 * "nothing is wrong, carry on". Every state below exists because the sentence it earns is
 * one no other state's sentence would be true for.
 */
export type WalletState =
  /**
   * Nothing in this browser answers. The common case, and NOT a fault: most people do not
   * have a wallet extension installed, and a product that reads as broken to them is a
   * product that is broken for them.
   */
  | { readonly kind: 'unavailable' }
  /** A wallet is present and we are not connected to it. The resting state. */
  | { readonly kind: 'disconnected' }
  /** The wallet's own prompt is open. The only state in which a control may be inert. */
  | { readonly kind: 'connecting' }
  /**
   * Connected. `network` is null when the wallet does not report one AND this deployment
   * requires none — an unknown, recorded as an unknown, never defaulted to a plausible name.
   */
  | {
      readonly kind: 'connected';
      readonly account: AccountRef;
      readonly network: NetworkRef | null;
    }
  /** The person declined. A normal outcome of asking, and never dressed as an error. */
  | { readonly kind: 'refused' }
  /**
   * Connected, to a network this build cannot trade on. Both references are carried because
   * "wrong network" without saying which is a dead end for whoever has to fix it.
   */
  | {
      readonly kind: 'wrong-network';
      readonly account: AccountRef;
      readonly required: NetworkRef;
      readonly reported: NetworkRef;
    }
  /** Something went wrong, as one of four codes and nothing else. */
  | { readonly kind: 'failed'; readonly code: WalletFailure };

/**
 * THE PORT.
 *
 * ★ `connect` RESOLVES, IT NEVER REJECTS. A rejection would be an error object crossing
 * this boundary, and an error object is the one shape that carries arbitrary decoration
 * from whoever built it. Every outcome — including refusal and failure — comes back as a
 * `WalletState`, which cannot carry anything we did not name. A caller therefore has no
 * `catch` block in which to accidentally log a vendor's payload.
 *
 * ★ `signer` IS THE SEAM AND IT IS INTENTIONALLY NARROW. It hands back the `Signer` a venue
 * executor takes — an opaque account reference and `sign(bytes) => bytes` — and nothing
 * else. It returns null unless the wallet is connected on an acceptable network, so a
 * signature cannot be requested for an account we are not currently sure of. Nothing in the
 * app calls it: there is no executor to hand it to, and there will not be one until
 * submission, confirmation and idempotency exist in a service. Its narrowness is the proof
 * that capability, not custody, is what this side ever holds.
 */
export interface Wallet {
  /** The current state. Synchronous and cheap; safe to call on every render. */
  state(): WalletState;
  /** Fires on every transition. Returns the unsubscribe. */
  subscribe(listener: (state: WalletState) => void): () => void;
  /** Asks the wallet to connect. Resolves with the resulting state; never rejects. */
  connect(): Promise<WalletState>;
  /** Drops the connection on our side. Resolves even if the wallet has already gone. */
  disconnect(): Promise<void>;
  /** A signer for the connected account, or null. See the note above. */
  signer(): Signer | null;
}
