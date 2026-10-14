/**
 * THE TWO EDGES THE SOCIAL AND ALERT SERVICES NEED FROM OUTSIDE: who is asking (a sign-in token,
 * checked), and a push to a device. Ports, so both services are tested against stand-ins and the
 * sign-in provider and push protocol live in adapters/.
 *
 * ★ A PERSON IS WHAT THE SIGN-IN PROVIDER SIGNED, NOTHING THE BROWSER SAID. `verify` returns
 * the handle, name, picture and wallets from a token whose signature checked out; a token that
 * does not check out is null, never a person with blanks. The services take a wallet address
 * from here and nowhere else, so nobody can claim to hold a coin through someone else's wallet.
 *
 * ★ NO KEY CROSSES THIS PORT. A wallet is an address and a kind. There is no field for a key.
 */

export interface PersonWallet {
  readonly address: string;
  /** `embedded`: made at sign-in, signs trades. `linked`: an outside wallet joined for viewing only. */
  readonly kind: 'embedded' | 'linked';
}

export interface Person {
  /** The sign-in provider's stable id for this person. */
  readonly userId: string;
  /** The sign-in account's handle, without the @; null when the sign-in has none. */
  readonly handle: string | null;
  readonly name: string | null;
  readonly pictureUrl: string | null;
  readonly wallets: readonly PersonWallet[];
}

export interface IdentityCheck {
  /** The person a token proves, or null for any token that is missing, expired or not signed. Never rejects. */
  verify(token: string): Promise<Person | null>;
}

export interface PushTarget {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** An in-app path, always starting with "/". */
  readonly url: string;
  /** The big picture under the text (the post's picture or video frame); https only. Shown where the platform draws one. */
  readonly image?: string | null;
  /** The small picture beside the text (the poster's face or the coin's logo); https only. */
  readonly icon?: string | null;
  /** One notification per tag on a device: a second send with the same tag replaces, never stacks. */
  readonly tag?: string;
}

/** `gone`: the device unsubscribed; drop it. `failed`: try another time. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

export interface PushSender {
  readonly configured: boolean;
  /** The public half of the server's push key, for the browser to subscribe with. */
  readonly publicKey: string | null;
  send(target: PushTarget, message: PushMessage, ttlS: number): Promise<PushOutcome>;
}
