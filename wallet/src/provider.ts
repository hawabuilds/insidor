/**
 * THE UNTRUSTED EDGE. Everything a wallet extension hands us arrives here as `unknown`, and
 * only closed types leave.
 *
 * WHAT IT IS RESPONSIBLE FOR: the shape we require of an injected wallet provider, and the
 * four narrowing functions that turn whatever it actually returns into `AccountRef`,
 * `NetworkRef`, `WalletFailure` or bytes. Nothing else in this package is allowed to touch a
 * value that came from a provider.
 *
 * WHY IT IS ITS OWN FILE: because the guarantee it enforces is a single sentence that has to
 * be checkable by reading one screen — *no value produced by a wallet extension is ever
 * carried into our state, our render, or our logs.* Spread across the state machine and the
 * adapter, that sentence becomes four half-guarantees, and the one that gets relaxed under
 * deadline is always the one nobody could see whole.
 *
 * ★ WHAT BREAKS IF THIS IS CHANGED CARELESSLY.
 *
 *   1. ★ EVERY PROVIDER-FACING TYPE BELOW IS `unknown` ON PURPOSE, AND THAT IS THE WHOLE
 *      MECHANISM. A wallet extension is third-party code running in our page. Its return
 *      values and its errors may carry anything its author put there — decoration, internal
 *      state, in the worst case material a person would be ruined by seeing published. Typed
 *      as `unknown`, none of it can be rendered, stringified, spread into an object or
 *      concatenated into a message without first passing through a function in this file,
 *      and every function in this file returns either one of OUR values or null. Retyping
 *      `connect(): Promise<{ address: string }>` for convenience would look like tightening
 *      and would in fact remove the only thing stopping arbitrary vendor data from flowing
 *      straight through.
 *
 *   2. ★ ERRORS ARE READ FOR EXACTLY ONE SCALAR AND THE REST IS DISCARDED. `classify` looks
 *      at `code`, accepts it only if it is a number or a short string, and maps it through a
 *      fixed table to our own union. The message is never read. The stack is never read. The
 *      `cause` is never read. The object is never re-thrown, never logged, never attached to
 *      anything we keep. An unrecognised code is `internal`, not a passthrough — so the set
 *      of values that can escape this function is the four-member union and nothing larger,
 *      whatever the extension does.
 *
 *   3. ★ THE ACCOUNT IS BOUNDED, NOT VALIDATED. We refuse a reference that is empty, that
 *      carries control characters, or that is longer than any real one — because an
 *      unbounded string from a hostile page ends up in the nav, and the source indicator
 *      already learned that lesson the expensive way (features/sources/sources.ts). We do
 *      NOT check it against any settlement layer's address format: which formats are legal
 *      is a venue's knowledge, and a wallet adapter that rejected a valid account because it
 *      had the wrong idea about addresses would be worse than useless. Bounding is hygiene;
 *      validating would be a decision made in the wrong place.
 *
 *   4. ★ `sign` PASSES BYTES AND KEEPS NOTHING. The payload is not copied anywhere we
 *      retain, the returned signature is not stored, and neither is ever put in a message.
 *      There is no cache, no last-signature field and no approval memory, because every one
 *      of those is a way for one press of "approve" to authorise a second thing.
 *
 *   5. ★ EVERY FUNCTION HERE IS TOTAL, AND THAT IS A REPAIR RATHER THAN A FLOURISH. Notes 1
 *      and 2 above were written as if the only thing an extension controls is the VALUE it
 *      hands back. It also controls what happens when we READ one. `{ get address() { throw
 *      … } }` is an ordinary object, and it turned `readAccount` into a function that threw
 *      the extension's own error — message, stack and all — straight out through `connect()`,
 *      which the port promises never rejects. In the app that call is `void wallet.connect()`
 *      with no catch, so the browser printed the whole thing to the console as an unhandled
 *      rejection: precisely the leak this file exists to make impossible, arriving through
 *      the one door nobody had thought to shut. `provider.test.ts` now plants a secret in a
 *      throwing accessor and fails if any of it escapes.
 */

import type { AccountRef, NetworkRef, WalletFailure } from '@insidor/contracts/ports/wallet.ts';

/**
 * The narrow surface we require of whatever object a browser wallet injects.
 *
 * It is INJECTED rather than reached for, exactly as every adapter in this repository
 * injects `fetch`: the state machine and the adapter are then drivable by a plain object in
 * a test with no browser, no extension and no network. `discovery.ts` holds the one function
 * that goes looking for a real one.
 *
 * Every member is optional except `connect`, because extensions differ in what they publish
 * and an adapter that demanded the union of them all would refuse working wallets.
 */
export interface WalletProvider {
  /** Opens the wallet's own prompt. Whatever it resolves with is untrusted. */
  connect(): Promise<unknown>;
  /** Best-effort. Many extensions have no such member; absence is not a failure. */
  disconnect?(): Promise<unknown>;
  /** The current account, however this extension chooses to publish it. Untrusted. */
  readonly account?: unknown;
  /** The current network, however this extension chooses to publish it. Untrusted. */
  readonly network?: unknown;
  /** Bytes in, bytes out. The return is untrusted and is narrowed before it is believed. */
  signMessage?(payload: Uint8Array): Promise<unknown>;
  /** Change notification, if the extension offers it. */
  on?(event: string, listener: (payload: unknown) => void): void;
  off?(event: string, listener: (payload: unknown) => void): void;
}

/**
 * The longest account reference we will carry.
 *
 * Generous — the longest in common use is well under half this — because the cost of being
 * slightly too permissive is nothing and the cost of refusing a real account is a person who
 * cannot use the product. It exists to stop a megabyte of text reaching a render, not to
 * express a format.
 */
const MAX_ACCOUNT_CHARS = 128;

/** Same reasoning, one order smaller: a network reference is a short token or it is junk. */
const MAX_NETWORK_CHARS = 64;

/** Control characters and the bidirectional overrides, which can make text lie about itself. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * ★ THE GUARD THAT MAKES NOTE 5 TRUE: reading from an untrusted value cannot throw upward.
 *
 * Every expression that touches a provider-supplied object goes inside one of these. Three
 * ordinary JavaScript constructs let a third party run code during what looks like a plain
 * read — a getter on a property, a `toString` on an object being stringified, and a
 * `Symbol.hasInstance` on the right-hand side of `instanceof` — and every one of them is
 * reachable here. A throw from any of them is the EXTENSION'S error object, carrying its
 * message and its stack, and it would leave this file without ever passing through the
 * narrowing that is this file's entire purpose.
 *
 * ★ THE FALLBACK IS ALWAYS ONE OF OURS AND THE THROWN VALUE IS NEVER BOUND. There is no
 * `catch (e)` here on purpose: a binding is something a later edit can log, attach or
 * re-throw, and this is the one path where that costs a person money. What was thrown is not
 * inspected, not counted and not distinguished from any other failure — "we could not read
 * it" is the whole of what we learn, and it is the whole of what we say.
 *
 * Exported for `browser.ts`, which has the same problem with CALLS rather than reads — `on`,
 * `off` and `disconnect` are the extension's functions — and must not grow a second spelling
 * of this. It is deliberately not re-exported from `index.ts`: outside this package there is
 * nothing untrusted to guard, and a general-purpose "swallow everything" helper on the
 * surface is an invitation to use it where a failure should have been reported.
 */
export function quietly<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/**
 * A bounded, inert token or null.
 *
 * Whitespace-trimmed, because a leading space is invisible and would make two spellings of
 * one account compare unequal. Rejected outright rather than sanitised if it carries
 * anything unprintable: a reference we had to repair is a reference we do not understand,
 * and silently repairing it would mean showing a person an account that is not the one their
 * wallet named.
 */
function token(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  if (UNSAFE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Reads an account reference out of whatever the extension published.
 *
 * Three spellings are accepted because three are in common use — the bare string, a
 * `{ address }` object, and a `{ publicKey }` object whose value stringifies. Nothing deeper
 * is walked: an adapter that hunted recursively for something string-shaped would eventually
 * find the wrong thing and present it to a person as their account.
 */
export function readAccount(value: unknown): AccountRef | null {
  const direct = token(value, MAX_ACCOUNT_CHARS);
  if (direct !== null) return direct;
  if (typeof value !== 'object' || value === null) return null;
  /* ★ The whole walk is inside one guard, not just the `String()` call below. `bag['address']`
     is a property READ on an object a third party built, and a getter there runs their code —
     see note 5. The `toString` case was already guarded because it looks like a call; the two
     property reads were not, because they look like data. They are not. */
  return quietly(() => {
    const bag = value as Record<string, unknown>;
    const address = token(bag['address'], MAX_ACCOUNT_CHARS);
    if (address !== null) return address;
    /* Some extensions publish a key object with a `toString`. We call it and bound the result
       like any other untrusted string; we never read its bytes, and there is nothing secret in
       a public account reference. A `toString` that throws is a provider we do not understand,
       which is `null` — never an exception that would carry the thrower's words upward. */
    const publicKey = bag['publicKey'];
    if (typeof publicKey === 'string') return token(publicKey, MAX_ACCOUNT_CHARS);
    if (typeof publicKey === 'object' && publicKey !== null) {
      return token(String(publicKey), MAX_ACCOUNT_CHARS);
    }
    return null;
  }, null);
}

/**
 * The same discipline, for a value that IS a network — what an extension publishes at
 * `provider.network`. Two spellings; nothing walked.
 */
export function readNetwork(value: unknown): NetworkRef | null {
  const direct = token(value, MAX_NETWORK_CHARS);
  if (direct !== null) return direct;
  if (typeof value !== 'object' || value === null) return null;
  return quietly(() => {
    const bag = value as Record<string, unknown>;
    return token(bag['chain'], MAX_NETWORK_CHARS) ?? token(bag['network'], MAX_NETWORK_CHARS);
  }, null);
}

/**
 * ★ A NETWORK NAMED INSIDE A LARGER PAYLOAD, AND THE DIFFERENCE FROM `readNetwork` IS A BUG
 * THAT WAS REAL BEFORE IT WAS A COMMENT.
 *
 * The payloads that arrive from `connect()` and from an account-change notification are
 * primarily about an ACCOUNT. A bare string in one of them is the account — so calling
 * `readNetwork` on it accepted the account reference as a network name, and a wallet that
 * announced an account switch as a plain string reported itself as being on a network called
 * `Acct…`. Against a required network that is silently `wrong-network`; against none it is a
 * nonsense name rendered as a fact. `browser.test.ts` caught it.
 *
 * So: inside a payload, only an OBJECT may name a network, and it must name it in a field.
 */
export function networkWithin(value: unknown): NetworkRef | null {
  if (typeof value !== 'object' || value === null) return null;
  return readNetwork(value);
}

/**
 * ★ THE STANDARD PROVIDER CODES WE RECOGNISE, AND THE ONLY VALUES ALLOWED TO INFLUENCE WHAT
 * A PERSON IS TOLD.
 *
 * These four are from the browser provider convention every extension of consequence
 * follows, not from any one vendor: 4001 is a declined prompt, 4100 is a site that has not
 * been authorised, 4900 and 4901 are the wallet reporting itself disconnected. The string
 * spellings are here because some extensions send the name rather than the number.
 *
 * ★ 4001 MAPS TO `refused`, WHICH IS NOT A `WalletFailure`. That is the single most
 * important line in this file. A declined prompt is a person using their wallet correctly,
 * and the difference between "you cancelled" and "something went wrong" is the difference
 * between a product that respects a decision and one that tells a person their software is
 * broken when it is not.
 */
const CODES = new Map<string | number, WalletFailure | 'refused'>([
  [4001, 'refused'],
  ['4001', 'refused'],
  ['USER_REJECTED', 'refused'],
  [4100, 'unauthorized'],
  ['4100', 'unauthorized'],
  ['UNAUTHORIZED', 'unauthorized'],
  [4900, 'disconnected'],
  ['4900', 'disconnected'],
  [4901, 'disconnected'],
  ['4901', 'disconnected'],
  ['DISCONNECTED', 'disconnected'],
]);

/** A code longer than this is not a code. Bounded before it is used as a map key. */
const MAX_CODE_CHARS = 64;

/**
 * Turns whatever was thrown into one of our own values.
 *
 * ★ THE SET OF POSSIBLE RETURN VALUES IS FIXED BY THIS FILE AND CANNOT BE WIDENED BY THE
 * CALLER OF `connect()`. Read the body: the argument is inspected for one property, that
 * property is used only as a lookup key, and the result comes from the table above or is
 * `internal`. No branch returns anything derived from the argument's contents. That is what
 * makes "a vendor's error text can never reach a log" a property of the code rather than a
 * habit of whoever wrote the catch block.
 */
export function classify(thrown: unknown): WalletFailure | 'refused' {
  if (typeof thrown !== 'object' || thrown === null) return 'internal';
  /* ★ `.code` ON A THROWN OBJECT IS THE SINGLE MOST DANGEROUS READ IN THE PACKAGE, because it
     happens inside a `catch` — so a getter that throws replaces the error we had classified
     and neutered with the extension's own, at the exact moment nothing is left to catch it.
     `internal` is the honest answer to a code we could not even read. */
  return quietly<WalletFailure | 'refused'>(() => {
    const code = (thrown as { readonly code?: unknown }).code;
    if (typeof code === 'number') return CODES.get(code) ?? 'internal';
    if (typeof code === 'string' && code.length > 0 && code.length <= MAX_CODE_CHARS) {
      return CODES.get(code) ?? CODES.get(code.toUpperCase()) ?? 'internal';
    }
    return 'internal';
  }, 'internal');
}

/**
 * Bytes back from a signing request, or null.
 *
 * `Uint8Array` and `{ signature }` are both accepted; an array of numbers is not, because
 * turning one into bytes means deciding what to do with 300 and -1, and a signature we had
 * to interpret is not a signature. Null is returned rather than an exception for the reason
 * that governs this whole file: an exception here would be the extension's exception, and it
 * would carry the extension's words.
 */
export function readSignature(value: unknown): Uint8Array | null {
  /* `instanceof` is a call site too: a class with a `Symbol.hasInstance` runs code here. So
     even the type test goes inside the guard, and a signature we could not test is not a
     signature — which the caller reports as unreadable rather than as bytes. */
  return quietly<Uint8Array | null>(() => {
    if (value instanceof Uint8Array) return value;
    if (typeof value !== 'object' || value === null) return null;
    const inner = (value as { readonly signature?: unknown }).signature;
    return inner instanceof Uint8Array ? inner : null;
  }, null);
}
