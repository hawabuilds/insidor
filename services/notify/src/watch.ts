/**
 * A WATCHED POST'S COIN, WITHIN SECONDS (the owner, 2026-10-14: "the moment a coin matching a
 * watched post launches or is found … notify me within seconds").
 *
 * Every few seconds (Policy.notify.watchLoopMs), for every post someone watches (people.post_watch):
 *
 *   1. its line's coin — proven from the post, or the coin the owner confirmed for its story
 *   2. its coin list ("See 3 coins"), every coin in it, as the projector writes it
 *   3. every coin the mint stream stored since the last look (public.asset; the mint watcher stores
 *      a coin about five seconds after it is made), matched against the post's guessed names and
 *      tickers (public.post_name_idea, the namer's guesses first) and, for a coin whose metadata
 *      document we can read, the post's own id in it (its link)
 *
 * Each coin is news ONCE per person and post: remembered in people.pipeline_seen under
 * `watch:<person>` as "post|coin", whether or not the push went (a switch that is off must not
 * re-queue the same coin every five seconds). What the post already showed when the star was
 * tapped was marked seen then (post-watch.ts).
 *
 * "Watchlist: coin launched" when the coin was made after the watch began (a coin new on the mint
 * stream is always one); "Watchlist: coin found" for a coin that already existed and is newly tied
 * to the post. Both open the coin's page.
 *
 * ★ PICTURES ARE NOT MATCHED HERE, AND THAT IS SAID, NOT HIDDEN. Comparing a new coin's picture with
 * the post's needs the picture model, a paid call per coin; the projector does it on its own
 * schedule (same_picture in the coin list), and a coin it ties to a watched post by picture alerts
 * from step 2 then. So a coin with a new name and only the post's picture is heard about when the
 * projector next compares pictures, not in seconds.
 *
 * ★ NAMES MATCH WHOLE, NEVER IN PART. A coin matches a guess when its ticker or its name, letters
 * and digits only, is the guess's — and the guess has at least Policy.notify.watchMinNameChars of
 * them. Three-letter tickers are taken all day by chance.
 *
 * Cost: our own tables, plus one free read of a new coin's metadata document (at most
 * Policy.notify.watchMetadataPerPass a look), only while someone watches a post that has an id to
 * look for. No paid call.
 */

import type { NotifyPolicy } from '@insidor/contracts/policy.ts';

import { coinFacts, type Quotes } from './coin-facts.ts';
import { queue, type Db } from './deliver.ts';
import { tokenHref } from './pipeline.ts';
import { lineCoin, watchStream } from './post-watch.ts';

export interface WatchPorts {
  readonly policy: NotifyPolicy;
  readonly now: () => number;
  readonly quotes?: Quotes;
  /** A coin's metadata document as text, or null when it cannot be read in time. */
  readonly fetchText?: (url: string) => Promise<string | null>;
}

/** Where the last look stopped on the mint stream (in memory: a restart looks back a couple of minutes, and the seen stream stops repeats). */
export interface WatchState {
  cursor: string | null;
}

/* ── pure ─────────────────────────────────────────────────────────── */

/** Letters and digits only, lower case: "$GOLIATH", "Goliath!" and "goliath" are one name. */
export const normName = (v: string | null | undefined): string => (v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Whether a new coin carries one of the post's guessed names or tickers, whole. */
export function nameMatches(coin: { readonly symbol: string | null; readonly name: string | null }, guesses: readonly { readonly name: string; readonly ticker: string }[], minChars: number): boolean {
  const symbol = normName(coin.symbol);
  const name = normName(coin.name);
  for (const g of guesses) {
    const t = normName(g.ticker);
    const n = normName(g.name);
    if (t.length >= minChars && (t === symbol || t === name)) return true;
    if (n.length >= minChars && (n === name || n === symbol)) return true;
  }
  return false;
}

/** The post's own id as its link carries it ("x:2110…" → "2110…"); null when it has none long enough to be unique. */
export function postIdOf(itemId: string): string | null {
  const id = itemId.slice(itemId.indexOf(':') + 1);
  return /^\d{10,}$/.test(id) ? id : null;
}

/** Whether a coin's metadata document carries the post's id, as a whole number (its link, its site, its words). */
export const carriesPost = (text: string, postId: string): boolean => new RegExp(`(^|\\D)${postId}(\\D|$)`).test(text);

/* ── the database around it ───────────────────────────────────────── */

interface Watch {
  readonly userId: string;
  readonly itemId: string;
  readonly since: number;
}
interface Post {
  readonly author: string | null;
  readonly excerpt: string | null;
  readonly image: string | null;
  readonly picture: string | null;
  readonly storyId: string | null;
  readonly payload: unknown;
}
interface Fresh {
  readonly address: string;
  readonly symbol: string | null;
  readonly name: string | null;
  readonly metadata: string | null;
  /** Off the live stream (made seconds ago), not the backfill of older coins. */
  readonly live: boolean;
}

const https = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2_000 ? v : null);
const denied = (e: unknown): boolean => (e as { code?: unknown }).code === '42501';

async function postsOf(db: Db, itemIds: readonly string[]): Promise<Map<string, Post>> {
  const items = await db.query<{ itemId: string; body: string | null; media: unknown; handle: string | null; picture: string | null }>(
    `select i.item_id as "itemId", i.body, i.media, a.handle, a.picture_url as picture
       from public.item i left join public.author a on a.author_key = i.author_key where i.item_id = any($1::text[])`,
    [[...itemIds]],
  );
  const lines = await db.query<{ itemId: string; payload: Record<string, unknown> }>(
    `select distinct on (item_id) item_id as "itemId", payload from public.rising_row where item_id = any($1::text[]) order by item_id, feed_id = 'fyp' desc`,
    [[...itemIds]],
  );
  const lineOf = new Map(lines.map((l) => [l.itemId, typeof l.payload === 'string' ? (JSON.parse(l.payload) as Record<string, unknown>) : l.payload]));
  const out = new Map<string, Post>();
  for (const id of itemIds) {
    const item = items.find((i) => i.itemId === id);
    const line = lineOf.get(id) ?? null;
    const media = Array.isArray(item?.media) ? (item.media as { uri?: unknown; kind?: unknown }[]) : [];
    out.set(id, {
      author: typeof line?.['authorLabel'] === 'string' ? line['authorLabel'] : item?.handle ? `@${item.handle}` : null,
      excerpt: typeof line?.['excerpt'] === 'string' ? line['excerpt'] : (item?.body ?? null),
      /* The card's picture (a video's preview frame), else the post's first picture. */
      image: https(line?.['thumbUrl']) ?? https(media.find((m) => m.kind === 'image')?.uri),
      picture: https(item?.picture),
      storyId: typeof line?.['storyId'] === 'string' ? line['storyId'] : null,
      payload: line,
    });
  }
  return out;
}

async function listed(db: Db, itemIds: readonly string[]): Promise<{ itemId: string; address: string }[]> {
  try {
    return await db.query<{ itemId: string; address: string }>(`select subject_id as "itemId", address from public.same_name_coin where subject_kind = 'post' and subject_id = any($1::text[])`, [[...itemIds]]);
  } catch (e) {
    if (denied(e)) return [];
    throw e;
  }
}

async function guessesOf(db: Db, itemIds: readonly string[]): Promise<Map<string, { name: string; ticker: string }[]>> {
  const out = new Map<string, { name: string; ticker: string }[]>();
  try {
    for (const g of await db.query<{ itemId: string; name: string; ticker: string }>(`select item_id as "itemId", name, ticker from public.post_name_idea where item_id = any($1::text[])`, [[...itemIds]])) {
      out.set(g.itemId, [...(out.get(g.itemId) ?? []), { name: g.name, ticker: g.ticker }]);
    }
  } catch (e) {
    if (!denied(e)) throw e;
  }
  return out;
}

/** The coins the mint stream stored since the last look, oldest first, and where this look stops. */
async function freshCoins(db: Db, state: WatchState, now: number): Promise<Fresh[]> {
  const from = state.cursor ?? new Date(now - 120_000).toISOString();
  const rows = await db.query<{ address: string; symbol: string | null; name: string | null; social: Record<string, unknown> | null; origin: string; seen: string }>(
    `select address, symbol, name, declared_social as social, origin, to_char(first_seen_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as seen
       from public.asset where origin in ('live_stream', 'backfill') and first_seen_at > $1::timestamptz order by first_seen_at limit 1000`,
    [from],
  );
  const last = rows[rows.length - 1];
  state.cursor = last?.seen ?? from;
  return rows.map((r) => ({ address: r.address, symbol: r.symbol, name: r.name, metadata: https(r.social?.['metadata']), live: r.origin === 'live_stream' }));
}

/** One look. Returns how many alerts were queued. */
export async function checkWatched(db: Db, ports: WatchPorts, state: WatchState): Promise<number> {
  const P = ports.policy;
  const watches = (await db.query<{ userId: string; itemId: string; since: string }>('select user_id as "userId", item_id as "itemId", created_at as since from people.post_watch')).map(
    (w): Watch => ({ userId: w.userId, itemId: w.itemId, since: new Date(w.since).getTime() }),
  );
  const fresh = await freshCoins(db, state, ports.now());
  if (watches.length === 0) return 0;
  const itemIds = [...new Set(watches.map((w) => w.itemId))];
  const posts = await postsOf(db, itemIds);

  /* post → coins tied to it this look, and whether each came off the mint stream. */
  const tied = new Map<string, Map<string, boolean>>();
  const tie = (itemId: string, address: string, minted: boolean) => {
    const m = tied.get(itemId) ?? new Map<string, boolean>();
    m.set(address, (m.get(address) ?? false) || minted);
    tied.set(itemId, m);
  };
  for (const id of itemIds) {
    const line = lineCoin(posts.get(id)?.payload ?? null);
    if (line !== null) tie(id, line.address, false);
  }
  for (const l of await listed(db, itemIds)) tie(l.itemId, l.address, false);

  if (fresh.length > 0) {
    const guesses = await guessesOf(db, itemIds);
    const unmatched: Fresh[] = [];
    for (const c of fresh) {
      let hit = false;
      for (const id of itemIds) {
        if (nameMatches(c, guesses.get(id) ?? [], P.watchMinNameChars)) {
          tie(id, c.address, c.live);
          hit = true;
        }
      }
      if (!hit && c.metadata !== null) unmatched.push(c);
    }
    /* The link: the post's own id in a new coin's metadata document. Free reads, capped per look. */
    const withIds = itemIds.flatMap((id) => {
      const postId = postIdOf(id);
      return postId === null ? [] : [{ id, postId }];
    });
    if (ports.fetchText !== undefined && withIds.length > 0) {
      const fetchText = ports.fetchText;
      const docs = await Promise.all(unmatched.slice(0, P.watchMetadataPerPass).map(async (c) => ({ c, text: await fetchText(c.metadata ?? '').catch(() => null) })));
      for (const { c, text } of docs) {
        if (text === null) continue;
        for (const w of withIds) if (carriesPost(text, w.postId)) tie(w.id, c.address, c.live);
      }
    }
  }
  if (tied.size === 0) return 0;

  /* What each watcher has already heard about. */
  const streams = [...new Set(watches.map((w) => watchStream(w.userId)))];
  const seenRows = await db.query<{ stream: string; key: string }>('select stream, key from people.pipeline_seen where stream = any($1::text[])', [streams]);
  const seen = new Set(seenRows.map((r) => `${r.stream}#${r.key}`));
  const due = watches.flatMap((w) => [...(tied.get(w.itemId) ?? new Map<string, boolean>())].filter(([address]) => !seen.has(`${watchStream(w.userId)}#${w.itemId}|${address}`)).map(([address, minted]) => ({ w, address, minted })));
  if (due.length === 0) return 0;

  const coins = await coinFacts(db, ports.quotes, due.map((d) => d.address));
  const storyIds = [...new Set([...posts.values()].flatMap((p) => (p.storyId === null ? [] : [p.storyId])))];
  const titles = new Map(
    storyIds.length === 0 ? [] : (await db.query<{ storyId: string; title: string }>(`select story_id as "storyId", coalesce(payload ->> 'title', '') as title from public.story_view where story_id = any($1::text[])`, [storyIds])).map((t) => [t.storyId, t.title] as const),
  );
  const now = ports.now();
  for (const { w, address, minted } of due) {
    const post = posts.get(w.itemId);
    const coin = coins.get(address);
    const line = lineCoin(post?.payload ?? null);
    const madeAt = coin?.mintedAtMs ?? (line?.address === address ? line.mintedAtMs : null);
    const launched = minted || (madeAt !== null && madeAt >= w.since);
    const subject = post?.storyId ? (titles.get(post.storyId) ?? '') : '';
    const facts: Record<string, unknown> = {
      found: launched ? 'launched' : 'found',
      symbol: coin?.symbol ?? (line?.address === address ? line.ticker : '') ?? '',
      address,
      author: post?.author ?? null,
      excerpt: post?.excerpt ?? null,
      ...(subject === '' ? {} : { subject }),
      ageMs: madeAt === null ? null : Math.max(0, now - madeAt),
      mcUsd: coin?.mcUsd ?? (line?.address === address ? line.mcUsd : null),
      change24h: coin?.change24h ?? null,
      image: post?.image ?? null,
      logo: coin?.logo ?? null,
      ...(post?.picture ? { picture: post.picture } : {}),
    };
    await queue(db, { userId: w.userId, kind: 'watch_coin', subject: `${w.itemId}|${address}`, rung: 0, facts, href: tokenHref(address) });
    await db.query('insert into people.pipeline_seen (stream, key) values ($1, $2) on conflict do nothing', [watchStream(w.userId), `${w.itemId}|${address}`]);
  }
  return due.length;
}
