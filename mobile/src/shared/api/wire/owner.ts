/**
 * THE OWNER'S CALLS, AS THE PHONE APP HOLDS THEM — the replies of services/social's owner routes
 * (services/social/src/owner.ts), decoded. Apart from the client so tests can run them.
 *
 * ★ A REPLY THAT IS NOT THE SHAPE IS NOT AN ANSWER. `{ owner: true }` is the only thing that draws
 * the owner's controls; anything else — a missing key, a string "true", a failed call — is false.
 * The server refuses every owner route to anyone else anyway: this only decides what is drawn.
 *
 * ★ A CALL IS ONE OF A CLOSED LIST PER KIND. A call the app does not know (a new kind on the
 * server, a typo) is dropped from the list rather than drawn as something it is not.
 *
 * What breaks if changed carelessly: `hiddenPostOf` keeps only https links from `shown`. The card
 * facts are the owner's own client's copy, saved beside the call; they are drawn, so a link that
 * is not https is not a link.
 */

export type CallKind = 'post' | 'coin_match' | 'name';
export type PostCall = 'meme' | 'not';
/** `cleared` is "Remove my label": the owner takes back a coin call; it is no call from then on. */
export type CoinCall = 'right' | 'wrong' | 'none' | 'cleared';
export type NameCall = 'up' | 'down';

const CALLS: Readonly<Record<CallKind, readonly string[]>> = {
  post: ['meme', 'not'],
  coin_match: ['right', 'wrong', 'none', 'cleared'],
  name: ['up', 'down'],
};

/** One saved call: what it was about, what the owner said, and when. */
export interface SavedCall {
  readonly kind: CallKind;
  readonly itemId: string;
  readonly call: string;
  /** The coin's address the owner says is this item's; null when none was named. */
  readonly coin: string | null;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly betterName: string | null;
  readonly note: string | null;
  readonly at: number;
}

/** The card as it was when the owner hid it: enough to draw it in "Hidden by me". */
export interface HiddenCard {
  readonly excerpt: string | null;
  readonly authorLabel: string | null;
  readonly sourceLabel: string | null;
  readonly permalink: string | null;
  readonly thumbUrl: string | null;
}

export interface HiddenPost {
  readonly itemId: string;
  readonly note: string | null;
  readonly at: number;
  readonly card: HiddenCard;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const link = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && s.startsWith('https://') ? s : null;
};
const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function decodeOwner(raw: unknown): boolean {
  return isObj(raw) && raw['owner'] === true;
}

export function savedCallOf(raw: unknown): SavedCall | null {
  if (!isObj(raw)) return null;
  const kind = (['post', 'coin_match', 'name'] as const).find((k) => k === raw['kind']);
  const itemId = str(raw['itemId']);
  const call = str(raw['call']);
  const at = time(raw['at']);
  if (kind === undefined || itemId === null || call === null || at === null || !CALLS[kind].includes(call)) return null;
  return { kind, itemId, call, coin: str(raw['coin']), name: str(raw['name']), ticker: str(raw['ticker']), betterName: str(raw['betterName']), note: str(raw['note']), at };
}

export function decodeCalls(raw: unknown): readonly SavedCall[] {
  const list = isObj(raw) && Array.isArray(raw['calls']) ? raw['calls'] : [];
  return list.flatMap((c) => {
    const call = savedCallOf(c);
    return call === null ? [] : [call];
  });
}

export function hiddenPostOf(raw: unknown): HiddenPost | null {
  if (!isObj(raw)) return null;
  const itemId = str(raw['itemId']);
  const at = time(raw['at']);
  if (itemId === null || at === null) return null;
  const shown = isObj(raw['shown']) ? raw['shown'] : {};
  return {
    itemId,
    note: str(raw['note']),
    at,
    card: {
      excerpt: str(shown['excerpt']),
      authorLabel: str(shown['authorLabel']),
      sourceLabel: str(shown['sourceLabel']),
      permalink: link(shown['permalink']),
      thumbUrl: link(shown['thumbUrl']),
    },
  };
}

export function decodeHidden(raw: unknown): readonly HiddenPost[] {
  const list = isObj(raw) && Array.isArray(raw['posts']) ? raw['posts'] : [];
  return list.flatMap((p) => {
    const post = hiddenPostOf(p);
    return post === null ? [] : [post];
  });
}

/** The newest call per item (and per name, for names), as the server's list already is. */
export function callsByItem(calls: readonly SavedCall[]): ReadonlyMap<string, SavedCall> {
  const out = new Map<string, SavedCall>();
  for (const c of calls) {
    const key = c.kind === 'name' ? `${c.itemId}\u0000${c.name ?? ''}` : c.itemId;
    const held = out.get(key);
    if (held === undefined || held.at <= c.at) out.set(key, c);
  }
  return out;
}

/** A coin the owner pasted by its address, as the service read it. Every number may be missing. */
export interface PastedCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly logoUrl: string | null;
  readonly marketCapUsd: number | null;
  readonly highestMarketCapUsd: number | null;
  /** Why the highest is missing, in words; null when it is there. */
  readonly highestWhy: string | null;
  readonly launchedAt: number | null;
}

/** "Check": the coin, or that no source knows it; and its launch against the post. */
export type CoinCheckResult =
  | { readonly found: false }
  | { readonly found: true; readonly coin: PastedCoin; readonly launchedAfterMs: number | null; readonly postStored: boolean };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function decodeCoinCheck(raw: unknown): CoinCheckResult {
  if (!isObj(raw) || raw['found'] !== true || !isObj(raw['coin'])) return { found: false };
  const c = raw['coin'];
  const address = str(c['address']);
  if (address === null) return { found: false };
  const post = isObj(raw['post']) ? raw['post'] : {};
  return {
    found: true,
    coin: {
      address,
      name: str(c['name']),
      ticker: str(c['ticker']),
      logoUrl: link(c['logoUrl']),
      marketCapUsd: num(c['marketCapUsd']),
      highestMarketCapUsd: num(c['highestMarketCapUsd']),
      highestWhy: str(c['highestWhy']),
      launchedAt: num(c['launchedAt']),
    },
    launchedAfterMs: num(raw['launchedAfterMs']),
    postStored: post['stored'] === true,
  };
}
