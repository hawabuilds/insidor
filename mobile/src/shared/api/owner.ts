/**
 * THE OWNER'S CALLS — the client for services/social's owner routes. Every request carries the
 * sign-in token like any other social call; the server decides who the owner is from that token,
 * and refuses everyone else. Shapes and decoders are in wire/owner.ts.
 *
 * Its own file so the owner's controls can be found, and removed, in one place: nothing else in
 * the app sends a call.
 */

import { socialCall } from './people.ts';
import { decodeCalls, decodeCoinCheck, decodeHidden, decodeOwner, savedCallOf, type CallKind, type CoinCheckResult, type HiddenPost, type SavedCall } from './wire/owner.ts';

export type { CallKind, CoinCall, CoinCheckResult, HiddenCard, HiddenPost, NameCall, PastedCoin, PostCall, SavedCall } from './wire/owner.ts';

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

/** Which post a pasted coin is for: the card's own id, or the link the owner pasted. */
export type PostRef = { readonly itemId: string } | { readonly postUrl: string };

/** "Check": is the pasted address a coin, and what is it. Nothing is saved. */
export async function checkCoin(coin: string, post: PostRef): Promise<CoinCheckResult> {
  return decodeCoinCheck(await socialCall('POST', '/owner/coin-check', { coin, ...post }));
}

/** "Confirm": save "This is the coin" with the pasted address; a post we do not hold is queued too. */
export async function saveCoinLabel(coin: string, post: PostRef): Promise<SavedCall | null> {
  const reply = (await socialCall('POST', '/owner/coin-label', { coin, ...post })) as { saved?: unknown };
  return savedCallOf(reply.saved);
}
