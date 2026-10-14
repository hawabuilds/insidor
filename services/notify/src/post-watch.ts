/**
 * WATCHING A POST (the owner, 2026-10-14: the star on a For You card and on the post sheet; the
 * post sheet's bell before it). The routes, and what a watch starts from.
 *
 *   GET    /post-watch                 { posts: [{ itemId, since }] }   my watched posts, newest first
 *   GET    /post-watch/:itemId    { watching }        whether I watch this post
 *   PUT    /post-watch/:itemId    { watching: true }  watch it
 *   DELETE /post-watch/:itemId    { watching: false } stop watching it
 *
 * What a watched post alerts on, and how fast, is watch.ts: every coin that comes to it — its proven
 * coin, its story's coin, a new coin in its list, a coin new on the mint stream with one of its
 * guessed names or its link — once per post and coin.
 *
 * ★ A WATCH STARTS FROM WHAT THE POST ALREADY SHOWS. The coins on the post's line and in its list
 * when the star is tapped are marked seen for this person at once (people.pipeline_seen, stream
 * `watch:<person>`), so starring a post that already has three coins sends nothing: the card shows
 * them. Only a coin that comes after is news.
 *
 * Apart from routes.ts because it is one feature with its own table (people.post_watch, 0068).
 * 0068's `notified_at` (one alert per post, the bell's rule) no longer decides anything: a watched
 * post alerts once per coin, which the seen stream holds.
 */

import type { Db } from './deliver.ts';
import { json, type Reply } from './http.ts';

const ITEM = /^[A-Za-z0-9:_\-.]{1,200}$/;

export interface ProvenCoin {
  readonly address: string;
  readonly ticker: string;
}

export const watchStream = (userId: string): string => `watch:${userId}`;

/** Every coin the post shows now: its line's coin and its list (the list needs 0078's grant; without it, the line alone). */
export async function coinsShown(db: Db, itemId: string): Promise<string[]> {
  const line = (await db.query<{ payload: unknown }>('select payload from public.rising_row where item_id = $1', [itemId])).map((r) => lineCoin(r.payload)?.address).filter((a): a is string => a !== undefined);
  let listed: string[] = [];
  try {
    listed = (await db.query<{ address: string }>(`select address from public.same_name_coin where subject_kind = 'post' and subject_id = $1`, [itemId])).map((r) => r.address);
  } catch (e) {
    if ((e as { code?: unknown }).code !== '42501') throw e;
  }
  return [...new Set([...line, ...listed])];
}

/** The coin on a post's line, whatever settled it (proven, the story's coin, the narrative's own); null when the line names none. */
export function lineCoin(payload: unknown): (ProvenCoin & { readonly linksPost: boolean; readonly posterBio: boolean; readonly storyCoin: boolean; readonly launchedAfterMs: number | null; readonly mcUsd: number | null; readonly name: string; readonly imageUrl: string | null; readonly mintedAtMs: number | null }) | null {
  const p = (typeof payload === 'string' ? JSON.parse(payload) : payload) as { coins?: { kind?: unknown; coin?: Record<string, unknown>; evidence?: Record<string, unknown> | null } } | null;
  const c = p?.coins;
  if (c === undefined || (c.kind !== 'one' && c.kind !== 'matched')) return null;
  const coin = c.coin ?? {};
  const address = coin['address'];
  if (typeof address !== 'string' || address === '') return null;
  const ev = c.evidence ?? {};
  const v = (x: unknown): number | null => {
    const n = typeof x === 'object' && x !== null ? (x as { v?: unknown }).v : x;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };
  const minted = coin['mintedAt'];
  return {
    address,
    ticker: typeof coin['ticker'] === 'string' ? coin['ticker'] : '',
    name: typeof coin['name'] === 'string' ? coin['name'] : '',
    linksPost: ev['linksPost'] === true,
    /* The poster's own profile names the coin (services/project post-match.ts, 0080). */
    posterBio: ev['posterBioNamesCoin'] === true,
    storyCoin: ev['storyCoin'] === true,
    launchedAfterMs: v(ev['launchedAfterMs']),
    mcUsd: v(coin['marketCapUsd']),
    imageUrl: typeof coin['imageUrl'] === 'string' && coin['imageUrl'].startsWith('https://') ? coin['imageUrl'] : null,
    mintedAtMs: typeof minted === 'object' && minted !== null && typeof (minted as { at?: unknown }).at === 'number' ? (minted as { at: number }).at : null,
  };
}

/** The routes; null when the path is not one of them. */
export async function postWatchRoute(db: Db, method: string, seg: readonly string[], userId: string): Promise<Reply | null> {
  if (seg[0] !== 'post-watch') return null;
  if (seg.length === 1 && method === 'GET') {
    const rows = await db.query<{ itemId: string; since: string }>('select item_id as "itemId", created_at as since from people.post_watch where user_id = $1 order by created_at desc limit 200', [userId]);
    return json(200, { posts: rows.map((r) => ({ itemId: r.itemId, since: new Date(r.since).getTime() })) });
  }
  if (seg.length !== 2) return null;
  let itemId: string;
  try {
    itemId = decodeURIComponent(seg[1] ?? '');
  } catch {
    return json(400, { error: 'bad request' });
  }
  if (!ITEM.test(itemId)) return json(400, { error: 'bad request' });
  if (method === 'GET') {
    const rows = await db.query('select 1 from people.post_watch where user_id = $1 and item_id = $2', [userId, itemId]);
    return json(200, { watching: rows.length > 0 });
  }
  if (method === 'PUT') {
    const fresh = await db.query('insert into people.post_watch (user_id, item_id) values ($1, $2) on conflict (user_id, item_id) do nothing returning 1', [userId, itemId]);
    /* What the post shows now is not news (see the header): seen at once, for this person. */
    if (fresh.length > 0) {
      const shown = await coinsShown(db, itemId);
      if (shown.length > 0) await db.query('insert into people.pipeline_seen (stream, key) select $1, unnest($2::text[]) on conflict do nothing', [watchStream(userId), shown.map((a) => `${itemId}|${a}`)]);
    }
    return json(200, { watching: true });
  }
  if (method === 'DELETE') {
    await db.query('delete from people.post_watch where user_id = $1 and item_id = $2', [userId, itemId]);
    return json(200, { watching: false });
  }
  return json(405, { error: 'method not allowed' });
}

