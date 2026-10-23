/**
 * THE OWNER'S CALLS — the client for services/social's owner routes. Every request carries the
 * sign-in token like any other social call; the server decides who the owner is from that token,
 * and refuses everyone else. Shapes and decoders are in wire/owner.ts.
 *
 * Its own file so the owner's controls can be found, and removed, in one place: nothing else in
 * the app sends a call.
 */

import { PeopleError, socialCall } from './people.ts';
import { decodeCalls, decodeCoinCheck, decodeHidden, decodeOwner, decodeSecondChance, savedCallOf, type CallKind, type CoinCheckResult, type HiddenPost, type SavedCall, type SecondChancePost } from './wire/owner.ts';

export type { CallKind, CoinCall, CoinCheckResult, HiddenCard, HiddenPost, NameCall, PastedCoin, PostCall, SavedCall, SecondChancePost } from './wire/owner.ts';

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

/**
 * Whether the signed-in person is the owner; null when the services could not be asked (a network
 * blip, a 5xx). The controls are drawn only on true either way, but "could not tell" must not be
 * "no": a no forgets the owner's hidden posts on this device (owner-store.ts `setOwner(false)`).
 */
export async function fetchIsOwner(): Promise<boolean | null> {
  try {
    return decodeOwner(await socialCall('GET', '/me/owner'));
  } catch (e) {
    return e instanceof PeopleError && e.status >= 400 && e.status < 500 ? false : null;
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

/** The For You posts that came in as a second chance after a "no": the owner's check list. */
export async function fetchSecondChance(): Promise<readonly SecondChancePost[]> {
  return decodeSecondChance(await socialCall('GET', '/owner/safety-net'));
}

/**
 * The owner's calls on a whole narrative (POST /owner/narrative): it is not one (hide it, and learn
 * from it), it is the same as another (merge), a post does not belong in it, some of its posts are
 * another story (split: they move to a new narrative), its coin is right or wrong. The server checks the owner from the token like every call here; a server that does not
 * take these calls yet answers 404, which the page says in words rather than pretending it saved.
 */
export type NarrativeAction = 'not_narrative' | 'merge' | 'remove_post' | 'split' | 'coin_right' | 'coin_wrong' | 'rename' | 'add_post' | 'meme_war';

export interface NarrativeCall {
  readonly action: NarrativeAction;
  readonly storyId: string;
  /** Merge: the narrative this one is the same as. */
  readonly intoStoryId?: string;
  /** Remove this post: the post. */
  readonly itemId?: string;
  /** Split: the posts that move to a new narrative (some, never all). */
  readonly itemIds?: readonly string[];
  /** Right coin or Wrong coin: the coin's address. */
  readonly coin?: string;
  /** Rename: the title the owner typed (at most 80 characters); it replaces the written one for good. */
  readonly title?: string;
  /** Add a post: the X or TikTok post's link; a post the server does not hold yet is read first. */
  readonly postUrl?: string;
  /** Twitter World War: the countries whose users are fighting (two to four), or none for "not a meme war". */
  readonly countries?: readonly string[];
}

/** Saves the call; throws a PeopleError, worded for the owner when the server has no such route yet (404). */
export async function saveNarrativeCall(c: NarrativeCall): Promise<void> {
  try {
    await socialCall('POST', '/owner/narrative', c);
  } catch (e) {
    if (e instanceof PeopleError && e.status === 404) throw new PeopleError(404, "Not saved: the server doesn't take narrative calls yet");
    throw e;
  }
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

/** Where a post was on the owner's screen: For You, a narrative page's posts, or its opened post sheet. */
export type SeenSurface = 'fyp' | 'narrative' | 'sheet';

/** One post the owner had on screen (for the app's two seconds) or opened, with when. */
export interface SeenPost {
  readonly itemId: string;
  readonly surface: SeenSurface;
  readonly onScreenAt?: number;
  readonly openedAt?: number;
}

/**
 * What was on the owner's screen (POST /owner/seen): saved for the owner only, never shown. `gone`
 * is a server without the route yet (404) or a sign-in that is not the owner's, so the app stops
 * sending; `failed` is worth a retry. `keepalive` for the batch sent as the page is hidden.
 */
export async function sendSeen(posts: readonly SeenPost[], keepalive = false): Promise<'ok' | 'gone' | 'failed'> {
  try {
    await socialCall('POST', '/owner/seen', { posts }, keepalive);
    return 'ok';
  } catch (e) {
    return e instanceof PeopleError && (e.status === 404 || e.status === 403) ? 'gone' : 'failed';
  }
}
