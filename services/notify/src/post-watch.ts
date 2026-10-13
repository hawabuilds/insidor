/**
 * THE POST SHEET'S BELL: watching one post for its coin, and the alert when that coin is proven.
 *
 *   GET    /post-watch/:itemId    { watching }        whether I have the bell on for this post
 *   PUT    /post-watch/:itemId    { watching: true }  bell on
 *   DELETE /post-watch/:itemId    { watching: false } bell off
 *
 * A coin is PROVEN for a post when the post's coin line on the feed is `one` (its narrative's own
 * coin) or `matched` (settled from the post's own evidence: "Links this post"). That is the line
 * the app draws as the post's coin with a Buy; `unsure`, `several` and the rest are not proven,
 * and never alert.
 *
 * ★ ONCE PER PERSON AND POST. people.post_watch.notified_at (0069) is set when the alert is
 * queued and never cleared, and the claim on (person, post_coin, post) backs it up. A post whose
 * coin was already proven when the bell was tapped is marked at once and sends nothing: the
 * sheet already shows that coin.
 *
 * ★ ONLY WHAT THE FEED HOLDS. The check reads the posts' current lines from public.rising_row; a
 * post that has left the feed is not read, so a coin proven after that is not alerted. Said
 * here rather than guessed around.
 *
 * Apart from routes.ts and pipeline.ts because it is one feature with its own table, and the
 * rule for "proven" must be the same in the route (already proven) and in the check (newly
 * proven): both use `provenCoin`.
 */

import { queue, type Db } from './deliver.ts';
import { posterPictures } from './faces.ts';
import { json, type Reply } from './http.ts';

const ITEM = /^[A-Za-z0-9:_\-.]{1,200}$/;

export interface ProvenCoin {
  readonly address: string;
  readonly ticker: string;
}

/** The post's own coin from its feed line, or null when it has none proven. */
export function provenCoin(payload: unknown): ProvenCoin | null {
  const p = (typeof payload === 'string' ? JSON.parse(payload) : payload) as { coins?: { kind?: unknown; coin?: { address?: unknown; ticker?: unknown } } } | null;
  const c = p?.coins;
  if (c === undefined || (c.kind !== 'one' && c.kind !== 'matched')) return null;
  const address = c.coin?.address;
  if (typeof address !== 'string' || address === '') return null;
  return { address, ticker: typeof c.coin?.ticker === 'string' ? c.coin.ticker : '' };
}

const lineOf = async (db: Db, itemId: string): Promise<unknown> =>
  (await db.query<{ payload: unknown }>('select payload from public.rising_row where item_id = $1 limit 1', [itemId]))[0]?.payload ?? null;

/** The three routes; null when the path is not one of them. */
export async function postWatchRoute(db: Db, method: string, seg: readonly string[], userId: string): Promise<Reply | null> {
  if (seg[0] !== 'post-watch' || seg.length !== 2) return null;
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
    const already = provenCoin(await lineOf(db, itemId)) !== null;
    await db.query(
      `insert into people.post_watch (user_id, item_id, notified_at) values ($1, $2, case when $3::boolean then now() end)
       on conflict (user_id, item_id) do nothing`,
      [userId, itemId, already],
    );
    return json(200, { watching: true });
  }
  if (method === 'DELETE') {
    await db.query('delete from people.post_watch where user_id = $1 and item_id = $2', [userId, itemId]);
    return json(200, { watching: false });
  }
  return json(405, { error: 'method not allowed' });
}

const tokenHref = (mint: string) => `/#/token/${encodeURIComponent(`solana:${mint}`)}`;

/** One pass: every watched post whose coin is now proven alerts its watchers, once. Returns how many were queued. */
export async function checkPostCoins(db: Db): Promise<number> {
  const rows = await db.query<{ userId: string; itemId: string; payload: unknown }>(
    `select distinct on (w.user_id, w.item_id) w.user_id as "userId", w.item_id as "itemId", r.payload
       from people.post_watch w join public.rising_row r on r.item_id = w.item_id
      where w.notified_at is null`,
  );
  const due = rows.flatMap((r) => {
    const coin = provenCoin(r.payload);
    return coin === null ? [] : [{ ...r, coin }];
  });
  if (due.length === 0) return 0;
  const pictures = await posterPictures(db, due.map((d) => d.itemId));
  for (const d of due) {
    const p = (typeof d.payload === 'string' ? JSON.parse(d.payload) : d.payload) as { authorLabel?: unknown; excerpt?: unknown };
    const excerpt = typeof p.excerpt === 'string' ? p.excerpt.slice(0, 80) : null;
    const facts = { symbol: d.coin.ticker, address: d.coin.address, author: typeof p.authorLabel === 'string' ? p.authorLabel : null, excerpt, ...(pictures.has(d.itemId) ? { picture: pictures.get(d.itemId) } : {}) };
    await queue(db, { userId: d.userId, kind: 'post_coin', subject: d.itemId, rung: 0, facts, href: tokenHref(d.coin.address) });
    await db.query('update people.post_watch set notified_at = now() where user_id = $1 and item_id = $2 and notified_at is null', [d.userId, d.itemId]);
  }
  return due.length;
}
