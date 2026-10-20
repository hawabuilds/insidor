/**
 * The accounts the account watch asks (Policy.feed.accountWatch): on one source, the accounts with
 * at least so many posts that a coin named within a short time of the post, inside a lookback, and
 * that reached a views figure — most such posts first. What to do with the list (group it, ask it,
 * how often) is the caller's (services/runner/src/work/account-watch.ts).
 *
 * Its own repository because it is the one read that lane makes, and it joins the coin links
 * (internal.coin_post_link, 0083) to posts and accounts, which no other repository joins. Read-only.
 *
 * ★ A POST COUNTS ONCE, HOWEVER MANY COINS NAME IT, and only while a coin was launched no earlier
 * than the post and within `coinWithinMs` after it (the coin-link rule's two days): a coin launched
 * a week later names an old post, which says nothing about how soon this account's next post will
 * be coined. The views are the post's newest stored reading, as the feed shows them, so a bot
 * account that names its own posts in its own coins (hundreds of coined posts, a few hundred views
 * each) is never on the list. An account with no stored handle cannot be asked and is not here.
 *
 * What breaks if changed carelessly: dropping the views bar fills the list with those bots and
 * spends the lane's day on their posts; dropping `origin = 'observed'` lets a seeded fiction be
 * asked about on a paid line; dropping the repost filter credits the reposter with the original.
 */

import type { Db } from '../client.ts';

export interface WatchAccount {
  /** The account's handle on the source, as last stored, without '@'. */
  readonly handle: string;
  /** Its posts that met the bar inside the lookback. */
  readonly coinedPosts: number;
}

export class PgWatchAccountRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async coinedAccounts(args: {
    readonly source: string;
    readonly minReach: number;
    readonly minPosts: number;
    readonly coinedSinceMs: number;
    readonly coinWithinMs: number;
    readonly limit: number;
  }): Promise<readonly WatchAccount[]> {
    if (args.limit <= 0) return [];
    const rows = await this.#db.query<{ handle: string; posts: string | number }>(
      `select a.handle, count(distinct i.item_id) as posts
         from internal.coin_post_link l
         join public.item i on i.item_id = l.source || ':' || l.source_item_id
         join public.author a on a.author_key = i.author_key
        where l.source = $1
          and l.minted_at >= $4
          and l.minted_at >= i.posted_at
          and l.minted_at <= i.posted_at + ($5::bigint * interval '1 millisecond')
          and i.origin = 'observed'
          and i.rebroadcast_of is null
          and (i.counters->'reach'->>'value')::double precision >= $2
          and a.handle is not null and a.handle <> ''
        group by a.handle
       having count(distinct i.item_id) >= $3
        order by posts desc, a.handle
        limit $6`,
      [args.source, args.minReach, args.minPosts, new Date(args.coinedSinceMs), Math.round(args.coinWithinMs), args.limit],
    );
    return rows.map((r) => ({ handle: r.handle, coinedPosts: Number(r.posts) }));
  }
}
