/**
 * THE OWNER NAMES A POST'S COIN BY ITS ADDRESS: "Paste contract address" in the "Which coin?"
 * sheet, and "Add a missed post" on For You.
 *
 *   POST /owner/coin-check { coin, itemId?, postUrl? }   is it a coin, and what is it (no write)
 *   POST /owner/coin-label { coin, itemId?, postUrl? }   save "This is the coin" with that address
 *
 * The post is `itemId` when the owner is on its card, or the link the owner pasted (`postUrl`):
 * an X or TikTok post link, turned into the id the runner stores it under.
 *
 * ★ OWNER ONLY. owner.ts checked the signed sign-in against Policy.owner before handing over;
 * `ref` is that answer. Nothing here is reachable by anyone else.
 *
 * ★ NOTHING IS SAVED FOR A COIN NOBODY KNOWS. A save checks the address again (coin-check.ts) and
 * refuses with "Can't find this coin" when no source knows it, or 503 when none could be read —
 * so a label never names an address that was never a coin.
 *
 * ★ WHAT A SAVE WRITES, ALL OF IT THROUGH TABLES THIS SERVICE MAY ALREADY WRITE:
 *   - internal.owner_feedback: a coin call `right` with the address, newest row so it replaces any
 *     earlier coin call on the post. The projector shows that coin as the post's own for everyone
 *     (services/project owner-calls.ts), the re-tune puts the post in hand gold and the coin
 *     matching test (tools/retune.ts, tools/lib/coin-match-fit.ts).
 *   - internal.missed_post, when the post is not stored yet: queued for the runner, which reads
 *     it, stores it and counts it in the missed set (services/runner work/missed-posts.ts).
 *   The coin itself is added to our coin list by the runner (work/owner-coins.ts), which reads
 *   every current `right` label whose coin we do not hold: this service has no write on coins.
 *
 * What breaks if changed carelessly: `postIdOf`. The id must be the one the runner stores the post
 * under (`x:<status id>`, `tiktok:<video id>`); any other spelling labels a post that never
 * exists, and the label silently does nothing.
 */

import type { Person } from '@insidor/contracts/ports/people.ts';

import type { CoinCheck, CoinPreview } from './coin-check.ts';
import { json, type Reply } from './http.ts';

export type { CoinCheck } from './coin-check.ts';

interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<R[]>;
}

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ITEM_ID = /^[A-Za-z0-9_:.\-]{1,200}$/;
const MAX_URL = 500;
const X_HOSTS = new Set(['x.com', 'twitter.com']);

/** The id the runner stores a post under, from its link; null for a link that is not a post. */
export function postIdOf(link: string): string | null {
  if (link.length > MAX_URL) return null;
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www|mobile|m)\./, '');
  if (X_HOSTS.has(host)) {
    const id = /^\/[^/]+\/status(?:es)?\/(\d{5,25})(?:\/|$)/.exec(u.pathname)?.[1];
    return id === undefined ? null : `x:${id}`;
  }
  if (host === 'tiktok.com') {
    const id = /\/video\/(\d{5,25})(?:\/|$)/.exec(u.pathname)?.[1];
    return id === undefined ? null : `tiktok:${id}`;
  }
  return null;
}

/** A pasted address, trimmed; the chain's prefix allowed. Null when it is not one. */
export function mintOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().replace(/^solana:/, '');
  return MINT.test(m) ? m : null;
}

interface Post {
  readonly itemId: string;
  readonly url: string | null;
  /** When it was posted, in ms; null when we do not hold it or it has no time. */
  readonly postedAt: number | null;
  readonly stored: boolean;
}

async function postOf(db: Db, body: Record<string, unknown>): Promise<Post | string> {
  const url = typeof body['postUrl'] === 'string' && body['postUrl'].trim() !== '' ? body['postUrl'].trim() : null;
  const given = typeof body['itemId'] === 'string' && body['itemId'].trim() !== '' ? body['itemId'].trim() : null;
  if (given !== null && !ITEM_ID.test(given)) return 'That post id is not one we hold.';
  const fromUrl = url === null ? null : postIdOf(url);
  if (url !== null && fromUrl === null) return 'Paste the full link to an X or TikTok post.';
  const itemId = given ?? fromUrl;
  if (itemId === null) return 'Say which post: paste its link.';
  const [row] = await db.query<{ at: number | null }>(
    `select (extract(epoch from coalesce(posted_at, first_seen_at)) * 1000)::float8 as at from public.item where item_id = $1`,
    [itemId],
  );
  return { itemId, url, postedAt: row?.at ?? null, stored: row !== undefined };
}

/** The launch against the post: positive is after it. Null when either time is unknown. */
const afterPost = (coin: CoinPreview, post: Post): number | null => (coin.launchedAt === null || post.postedAt === null ? null : coin.launchedAt - post.postedAt);

const bad = (error: string, status = 400): Reply => json(status, { error });

export interface OwnerCoinDeps {
  readonly db: Db;
  readonly coinCheck?: CoinCheck;
}

export async function ownerCoinRoute(method: string, sub: 'coin-check' | 'coin-label', body: unknown, me: Person, ref: string, deps: OwnerCoinDeps): Promise<Reply> {
  if (method !== 'POST') return bad('method not allowed', 405);
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const mint = mintOf(b['coin']);
  if (mint === null) return bad("That isn't a Solana address: 32 to 44 letters and numbers, without 0, O, I or l.");
  const post = await postOf(deps.db, b);
  if (typeof post === 'string') return bad(post);
  if (deps.coinCheck === undefined) return bad("Checking a coin isn't set up on this server.", 503);

  let coin: CoinPreview | null;
  try {
    coin = await deps.coinCheck.read(mint);
  } catch {
    return bad("The coin sources couldn't be read just now. Nothing was saved; try again.", 503);
  }
  if (coin === null) return json(sub === 'coin-check' ? 200 : 404, { found: false, error: "Can't find this coin" });
  const after = afterPost(coin, post);

  if (sub === 'coin-check') {
    return json(200, { found: true, coin, post: { itemId: post.itemId, postedAt: post.postedAt, stored: post.stored }, launchedAfterMs: after });
  }

  /* Not stored yet: the runner must read it, so the owner's link is needed, and it joins the missed set. */
  let queued = false;
  if (!post.stored) {
    if (post.url === null) return bad("This post isn't in our system yet: paste its link too.");
    await deps.db.query(`insert into internal.missed_post (url, owner_ref) values ($1, $2) on conflict (owner_ref, url) do nothing`, [post.url, ref]);
    queued = true;
  }
  const line = coin.ticker !== null ? `$${coin.ticker}` : (coin.name ?? mint.slice(0, 6));
  const [saved] = await deps.db.query(
    `insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, coin_address, note, shown)
     values ($1, $2, 'coin_match', $3, 'right', $4, $5, $6::jsonb)
     returning subject_kind as kind, item_id as "itemId", verdict as call, coin_address as coin, name, ticker,
       better_name as "betterName", note, (extract(epoch from created_at) * 1000)::float8 as at`,
    [ref, me.userId, post.itemId, mint, 'pasted address', JSON.stringify({ line, coinId: `solana:${mint}` })],
  );
  return json(201, { saved: saved ?? null, queued, coin, launchedAfterMs: after });
}
