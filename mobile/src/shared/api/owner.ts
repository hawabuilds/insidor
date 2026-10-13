/**
 * THE OWNER'S CALLS — the client for services/social's owner routes. Every request carries the
 * sign-in token like any other social call; the server decides who the owner is from that token,
 * and refuses everyone else. Shapes and decoders are in wire/owner.ts.
 *
 * Its own file so the owner's controls can be found, and removed, in one place: nothing else in
 * the app sends a call.
 */

import { socialCall } from './people.ts';
import { decodeCalls, decodeHidden, decodeOwner, savedCallOf, type CallKind, type HiddenPost, type SavedCall } from './wire/owner.ts';

export type { CallKind, CoinCall, HiddenCard, HiddenPost, NameCall, PostCall, SavedCall } from './wire/owner.ts';

/** What the owner saw when making a call: the card's facts, or the coin line. */
export type Shown = Readonly<Record<string, string | number | boolean | null>>;

export interface NewCall {
  readonly kind: CallKind;
  readonly itemId: string;
  readonly call: string;
  readonly coin?: string | null;
  readonly name?: string | null;
  readonly ticker?: string | null;
  readonly betterName?: string | null;
  readonly note?: string | null;
  readonly shown?: Shown | null;
}

/** Whether the signed-in person is the owner. Any failure is "no": the controls are not drawn. */
export async function fetchIsOwner(): Promise<boolean> {
  try {
    return decodeOwner(await socialCall('GET', '/me/owner'));
  } catch {
    return false;
  }
}

export async function saveCall(c: NewCall): Promise<SavedCall | null> {
  const reply = (await socialCall('POST', '/owner/feedback', c)) as { saved?: unknown };
  return savedCallOf(reply.saved);
}

export async function fetchCalls(kind: CallKind, itemIds: readonly string[]): Promise<readonly SavedCall[]> {
  if (itemIds.length === 0) return [];
  return decodeCalls(await socialCall('GET', `/owner/feedback?kind=${kind}&items=${itemIds.map(encodeURIComponent).join(',')}`));
}

export async function fetchHidden(): Promise<readonly HiddenPost[]> {
  return decodeHidden(await socialCall('GET', '/owner/hidden'));
}
