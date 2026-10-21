/**
 * GET /post/:id/sheet — everything the phone's post sheet shows about one feed post, in one
 * reply: the post as the feed projected it (with the sheet's own facts: its view readings, views
 * a minute, $tickers in its replies), who posted it (name, picture, followers), when we found it,
 * its playable video, the narrative it is in, and every coin with its name, highest market cap
 * first, each with its logo, launch, whether it has bonded, its market cap and its 24h move.
 *
 * Its own file beside same-name.ts, not inside it: "See N coins" lists an unsure post's coins in
 * the evidence order and nothing else, while this lists every post's coins by market cap with the
 * proven one marked. Two lists with two orders are two routes, so neither can drift into the other.
 *
 * WHERE EACH PART COMES FROM, and why this process may read it: the post and its sheet facts from
 * public.rising_row (the projector read observation and the crypto reads, which this role cannot);
 * the author's name, picture and count from public.author; the found time and media from
 * public.item; the coins from public.same_name_coin and the post's own coin link, their names and
 * launches from public.coin_name and public.asset. Market numbers come from the market source's
 * keyless token read, once per post per `keepMs`, the same read the Portfolio tab prices with.
 *
 * ★ ONLY A POST ON A FEED. A post no feed holds is a 404: the sheet opens from a card or from a
 * coin page's post, and both are rows on a feed — the frame, or the infinite scroll's members
 * (SHEET_MEMBER_SQL).
 *
 * ★ A NUMBER WE COULD NOT READ IS A DASH WITH WHY, NEVER ZERO. A coin the market source does not
 * list has no market anyone reports (`no_market`); an outage is `not_read_yet`; the order puts
 * every coin with an unknown cap after every coin with a known one, never at the bottom as $0.
 *
 * The same object answers GET /story/:id/sheet (story-sheet.ts), the narrative page's posts and
 * coins, because its coins must be priced by the same read and kept the same minute as here.
 *
 * What breaks if changed carelessly: `picture_url` arrives through `to_jsonb(a)`, so this reads the
 * same before and after migration 0067 adds the column; naming the column directly would make every
 * sheet a 500 until the migration ran. And a video's file is passed on only when it is an https mp4
 * link the source serves unsigned: anything else would be a blank player.
 */

import type { CoinQuote } from '@insidor/market-dexscreener';

import type { Logger } from './log.ts';
import type { Db, Row } from './queries.ts';
import { buildStoryPosts, buildStorySheet } from './story-sheet.ts';
import { fileOf, pictureFiles } from './post-pics.ts';
import { withTranslations } from './translations.ts';

/** The post on whichever feed holds it, For You first. */
export const SHEET_POST_SQL = `
select r.payload, i.first_seen_at, i.media, a.display_name, a.follower_count::text as follower_count,
       to_jsonb(a) ->> 'picture_url' as picture_url, to_jsonb(a) ->> 'picture_copy' as picture_copy
  from public.rising_row r
  join public.item i on i.item_id = r.item_id
  left join public.author a on a.author_key = i.author_key
 where r.item_id = $1
 order by (r.feed_id = 'fyp') desc
 limit 1`;

/**
 * A post that has left the frame but is still on the infinite scroll (0075 public.feed_post): its
 * last projected card, so a tap on an old card opens its sheet. Read only when the frame does not
 * hold the post; a database without 0075 makes this a 404, as before.
 */
export const SHEET_MEMBER_SQL = `
select f.payload, i.first_seen_at, i.media, a.display_name, a.follower_count::text as follower_count,
       to_jsonb(a) ->> 'picture_url' as picture_url, to_jsonb(a) ->> 'picture_copy' as picture_copy
  from public.feed_post f
  join public.item i on i.item_id = f.item_id
  left join public.author a on a.author_key = i.author_key
 where f.item_id = $1 and f.withdrawn_at is null and f.payload is not null
 order by (f.feed_id = 'fyp') desc
 limit 1`;

/**
 * The narrative the post is in, if any: the Narrative tile's name and link, and how many posts its
 * page lists. From public.story_post (0093), the projector's own answer written with the board, so
 * the tile, the card's tag and the page name the same narrative and the same count.
 */
export const SHEET_STORY_SQL = `
select p.story_id, p.title, p.posts, v.payload ->> 'thumbUrl' as thumb_url, true as listed
  from public.story_post p
  left join public.story_view v on v.story_id = p.story_id
 where p.item_id = $1`;

/**
 * Before 0093 there is no public.story_post: the promoted, observed story the post joined first,
 * as before. Read only when the table is missing.
 */
export const SHEET_STORY_LEGACY_SQL = `
select m.story_id, v.payload ->> 'title' as title, jsonb_array_length(coalesce(v.payload -> 'evidence', '[]'::jsonb)) as posts, false as listed
  from public.story_member m
  join public.story s on s.story_id = m.story_id and s.state = 'promoted' and s.merged_into is null and s.origin = 'observed'
  join public.story_view v on v.story_id = m.story_id
 where m.item_id = $1
 order by m.joined_at asc
 limit 1`;

/** A narrative's title and post count by id, when the post's coin link names a narrative it is not listed in. */
export const SHEET_TITLE_SQL = `select payload ->> 'title' as title, coalesce((payload ->> 'postCount')::int, jsonb_array_length(coalesce(payload -> 'evidence', '[]'::jsonb))) as posts from public.story_view where story_id = $1`;

/** The first statement, or the second when the first's table does not exist yet (42P01). */
export async function readOr(db: Db, sql: string, legacy: string, params: readonly unknown[]): Promise<readonly Row[]> {
  try {
    return await db.query(sql, params);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return db.query(legacy, params);
    throw e;
  }
}

/** The coins written beside the post (or its narrative), in the projector's order. */
export const SHEET_LIST_SQL = `
select address from public.same_name_coin
 where (subject_kind = 'post' and subject_id = $1) or (subject_kind = 'story' and subject_id = $2)
 order by position asc`;

/**
 * What we hold of each coin: its full row while it lasts, the name index after. With where its
 * launch time came from (0005's minted_at_source and bound), because the narrative page and the
 * post sheet print it to the minute as the proof of who was first: see `launchClock`.
 */
export const SHEET_COINS_SQL = `
select n.address, coalesce(a.symbol, n.ticker) as symbol, coalesce(a.name, n.name) as name, a.image_uri,
       coalesce(a.minted_at, n.launched_at) as minted_at,
       case when a.minted_at is null then null else a.minted_at_source end as minted_at_source,
       case when a.minted_at is null then null else a.minted_at_bound_s end as minted_at_bound_s
  from public.coin_name n
  left join public.asset a on a.chain = 'solana' and a.address = n.address
 where n.address = any($1)`;

/** The most coins one sheet lists; the market source answers this many in one read. */
export const SHEET_COINS_MAX = 30;

export interface PostSheetDeps {
  readonly db: Db;
  readonly log: Logger;
  /** The market source's keyless token read (dexscreener `quotes`); null: every cap is a dash. */
  readonly quotes: { quotes(addresses: readonly string[]): Promise<ReadonlyMap<string, CoinQuote>> } | null;
  /** Pictures from the chain for coins we hold none for; null without an RPC. */
  readonly images: ((mints: readonly string[]) => Promise<ReadonlyMap<string, string>>) | null;
  readonly keepMs: number;
  readonly now: () => number;
}

export interface SheetReply {
  readonly status: number;
  readonly body: string;
}

type Measured = { readonly v: number } | { readonly v: null; readonly why: string };
type Instant = { readonly at: number } | { readonly at: null; readonly why: string };

/** One coin as a sheet sends it. */
export interface SheetCoinOut {
  readonly coinId: string;
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  readonly launchedAt: Instant;
  /** Whose clock `launchedAt` is: see `launchClock`. */
  readonly launchClock: LaunchClock;
  readonly marketCapUsd: Measured;
  readonly changePct24h: Measured;
  readonly bonded: boolean | null;
  readonly proven: boolean;
}

/**
 * ★ WHOSE CLOCK A COIN'S LAUNCH TIME IS. The screens print it to the minute beside "Found", as the
 * proof that we were early, so they must know when it is the chain's own time:
 *
 *   chain    the create transaction's block time (minted_at_source chain_rpc)
 *   unknown  anything else: the launchpad's own stamp, a live launch notice's arrival, an
 *            aggregator's pair time (minutes off, sometimes days), or a time kept in the name index
 *            after the coin's own row was swept. Shown as not known.
 *
 * ★ ONLY THE BLOCK TIME (the owner, 2026-10-18: "'launched' must be the block time of the create
 * transaction on chain. Never use any other time"). Until then a live notice printed as "within"
 * a few seconds; on the Tesla Roadster's coin it was 4.6 s before the block, the same minute, and
 * still not the chain's time. `within` stays in the type so an older phone reads a reply either
 * way; the server no longer sends it. The runner fills the block time for the coins the narrative
 * pages name (Policy.narrative.launchClock).
 */
export type LaunchClock = { readonly kind: 'chain' } | { readonly kind: 'within'; readonly withinS: number } | { readonly kind: 'unknown' };

export function launchClock(source: unknown, _boundS?: unknown): LaunchClock {
  return source === 'chain_rpc' ? { kind: 'chain' } : { kind: 'unknown' };
}

const json = (status: number, value: unknown): SheetReply => ({ status, body: JSON.stringify(value) });
const rec = (v: unknown): Row => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const measured = (v: number | null | undefined, why: string): Measured => (v === null || v === undefined || !Number.isFinite(v) ? { v: null, why } : { v });
const instant = (at: number | null, why: string): Instant => (at === null ? { at: null, why } : { at });
const ms = (v: unknown): number | null => {
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const https = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && s.startsWith('https://') ? s : null;
};

/**
 * The post's media: its first video with a playable file, else its first picture; null when neither.
 *
 * ★ A GIF GOES OUT AS A PICTURE WITH A FILE (`kind: 'image'`, a `playUrl`, `loops: true`): a short
 * silent clip the app plays muted and looping, with no player controls, the way the source shows
 * it. A stored clip marked `loops`, or one stored before that mark with a file and no length (the
 * source gives every real video its length), is one. A real video keeps `kind: 'video'`.
 */
export function sheetMedia(raw: unknown): { readonly kind: 'video' | 'image'; readonly posterUrl: string; readonly playUrl: string | null; readonly loops: boolean; readonly width: number | null; readonly height: number | null; readonly durationMs: number | null } | null {
  const entries = (Array.isArray(raw) ? raw : []).map(rec);
  const shape = (e: Row, playUrl: string | null) => {
    const posterUrl = https(e['uri']);
    if (posterUrl === null) return null;
    const loops = playUrl !== null && (e['loops'] === true || num(e['durationMs']) === null);
    const video = !loops && (e['kind'] === 'video' || typeof e['durationMs'] === 'number');
    return { kind: video ? ('video' as const) : ('image' as const), posterUrl, playUrl, loops, width: num(e['width']), height: num(e['height']), durationMs: num(e['durationMs']) };
  };
  for (const e of entries) {
    const play = https(e['playUri']);
    if (play !== null && /\.mp4(\?|$)/i.test(play)) {
      const m = shape(e, play);
      if (m !== null) return m;
    }
  }
  for (const e of entries) {
    const m = shape(e, null);
    if (m !== null) return m;
  }
  return null;
}

/** The addresses the post's own coin link names: its matched or narrative coin, or a narrative's several. */
export function linkedAddresses(coins: unknown): { readonly proven: string | null; readonly addresses: readonly string[] } {
  const c = rec(coins);
  const kind = str(c['kind']);
  if (kind === 'matched' || kind === 'one') {
    const a = str(rec(c['coin'])['address']);
    return { proven: a, addresses: a === null ? [] : [a] };
  }
  if (kind === 'several') return { proven: null, addresses: (Array.isArray(c['coins']) ? c['coins'] : []).flatMap((x) => str(rec(x)['address']) ?? []) };
  return { proven: null, addresses: [] };
}

/** The name the coins share, as the sheet says it ("Top Goliath coin"): the most shared name, then the oldest. */
export function sharedName(coins: readonly { readonly name: string | null; readonly ticker: string | null }[]): string | null {
  const counts = new Map<string, number>();
  for (const c of coins) {
    const n = (c.name ?? c.ticker ?? '').trim();
    if (n !== '') counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function createPostSheet(deps: PostSheetDeps) {
  const kept = new Map<string, { readonly at: number; readonly reply: SheetReply }>();

  async function memberRow(itemId: string): Promise<Row | undefined> {
    try {
      return (await deps.db.query(SHEET_MEMBER_SQL, [itemId]))[0];
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return undefined;
      throw e;
    }
  }

  async function build(itemId: string): Promise<SheetReply> {
    const row = (await deps.db.query(SHEET_POST_SQL, [itemId]))[0] ?? (await memberRow(itemId));
    if (row === undefined) return json(404, { error: 'not found' });
    /* The post's English when it was written in another language (translations.ts, 0081). */
    /* Sent together: both are read by the post's id alone, and each round trip crosses a sea. */
    /* And our copies of the card's and the media's picture (post-pics.ts, 0119), by the links in hand. */
    const media = sheetMedia(row['media']);
    const [translated, storyRows, files] = await Promise.all([
      withTranslations(deps.db, [row['payload']]),
      readOr(deps.db, SHEET_STORY_SQL, SHEET_STORY_LEGACY_SQL, [itemId]),
      pictureFiles(deps.db, [rec(row['payload'])['thumbUrl'], media?.posterUrl].filter((l): l is string => typeof l === 'string')),
    ]);
    const thumbFile = fileOf(files, rec(row['payload'])['thumbUrl']);
    const payload: Row = { ...rec(translated[0]), ...(thumbFile !== undefined ? { thumbFile } : {}) };
    const storyRow = storyRows[0];
    const storyId = str(payload['storyId']) ?? str(storyRow?.['story_id']);

    const link = linkedAddresses(payload['coins']);
    const storyThumb = https(storyRow?.['thumb_url']);
    const [listedRows, storyFiles] = await Promise.all([deps.db.query(SHEET_LIST_SQL, [itemId, storyId ?? '']), storyThumb === null ? new Map<string, string>() : pictureFiles(deps.db, [storyThumb])]);
    const listed = listedRows.flatMap((r) => str(r['address']) ?? []);
    const addresses = [...new Set([...link.addresses, ...listed])].slice(0, SHEET_COINS_MAX);
    const { coins, marketDown } = await coinsFor(addresses, link.proven, rec(rec(payload['coins'])['coin']));

    const followers = row['follower_count'] === null || row['follower_count'] === undefined ? null : Number(row['follower_count']);
    /* The narrative's name and how many posts it lists, for "Part of the … narrative, 12 posts". */
    const titled = storyId === null ? null : str(storyRow?.['story_id']) === storyId ? storyRow : (await deps.db.query(SHEET_TITLE_SQL, [storyId]))[0];
    return json(200, {
      post: payload,
      author: {
        name: str(row['display_name']),
        pictureUrl: https(row['picture_url']),
        /* Our copy's file name (0079): the app tries `author-pics/<name>` first; the link may have expired. */
        pictureFile: typeof row['picture_copy'] === 'string' && /^[0-9a-f]{32}$/.test(row['picture_copy']) ? row['picture_copy'] : null,
        followers: measured(followers, 'not_reported'),
      },
      foundAt: instant(ms(row['first_seen_at']), 'not_reported'),
      /* `posterFile`: our copy of the picture, which the app loads first at the sheet's size. */
      media: media === null ? null : { ...media, ...(fileOf(files, media.posterUrl) !== undefined ? { posterFile: fileOf(files, media.posterUrl) } : {}) },
      /* `story` on the wire, as coin-about.ts sends it: the app's censor refuses the other word as a key. */
      story: storyId === null ? null : { storyId, title: str(titled?.['title']), posts: num(Number(titled?.['posts'] ?? NaN)) },
      /* The "Part of a story" card: only a narrative the board lists now (public.story_post), with its picture. */
      storyCard: storyRow?.['listed'] === true && str(storyRow['story_id']) !== null
        ? { storyId: str(storyRow['story_id']), title: str(storyRow['title']), posts: num(Number(storyRow['posts'] ?? NaN)), thumbUrl: storyThumb, ...(fileOf(storyFiles, storyThumb) !== undefined ? { thumbFile: fileOf(storyFiles, storyThumb) } : {}) }
        : null,
      coinName: sharedName(coins),
      sourcesMissing: marketDown ? 1 : 0,
      coins,
    });
  }

  /**
   * Every coin in `addresses` as a sheet shows it, highest market cap first, a coin with no cap
   * after every coin with one. `linkCoin` is what the post's or narrative's own link said of its
   * coin, kept for a coin the name index does not hold. The post sheet and the narrative page's
   * sheet (story-sheet.ts) both price their coins here, so one coin reads the same on both.
   */
  async function coinsFor(addresses: readonly string[], proven: string | null, linkCoin: Row): Promise<{ readonly coins: SheetCoinOut[]; readonly marketDown: boolean }> {
    /* The coins we hold and the market's quotes, asked at once: neither needs the other. */
    let marketDown = false;
    const [heldRows, quotes] = await Promise.all([
      addresses.length === 0 ? Promise.resolve([]) : deps.db.query(SHEET_COINS_SQL, [addresses]),
      deps.quotes === null || addresses.length === 0
        ? Promise.resolve(new Map<string, CoinQuote>() as ReadonlyMap<string, CoinQuote>)
        : deps.quotes.quotes(addresses).catch((e: unknown) => {
            marketDown = true;
            deps.log.info('post sheet market unavailable', { err: e instanceof Error ? e.message : String(e) });
            return new Map<string, CoinQuote>() as ReadonlyMap<string, CoinQuote>;
          }),
    ]);
    const held = new Map(heldRows.map((r) => [str(r['address']) ?? '', r] as const));
    const pictures = new Map<string, string>();
    const missing = addresses.filter((a) => str(held.get(a)?.['image_uri']) === null);
    if (deps.images !== null && missing.length > 0) {
      try {
        for (const [a, i] of await deps.images(missing)) pictures.set(a, i);
      } catch (e) {
        deps.log.info('coin pictures unavailable', { err: e instanceof Error ? e.message : String(e) });
      }
    }

    /* A coin the link names but the index does not hold keeps what the link itself said. */
    const coins = addresses.map((address): SheetCoinOut => {
      const h = held.get(address);
      const q = quotes.get(address) ?? null;
      const fromLink = str(linkCoin['address']) === address ? linkCoin : null;
      const name = str(h?.['name']) ?? q?.name ?? str(fromLink?.['name']);
      const ticker = str(h?.['symbol']) ?? q?.ticker ?? str(fromLink?.['ticker']);
      const launched = ms(h?.['minted_at']) ?? num(rec(fromLink?.['mintedAt'])['at']);
      const unlisted = q !== null ? 'not_reported' : marketDown || deps.quotes === null ? 'not_read_yet' : 'no_market';
      return {
        coinId: `solana:${address}`,
        address,
        name,
        ticker,
        imageUrl: str(h?.['image_uri']) ?? pictures.get(address) ?? str(fromLink?.['imageUrl']),
        launchedAt: instant(launched, 'not_reported'),
        launchClock: h === undefined ? { kind: 'unknown' } : launchClock(h['minted_at_source'], h['minted_at_bound_s']),
        marketCapUsd: measured(q?.marketCapUsd, unlisted),
        changePct24h: measured(q?.change.h24, unlisted),
        /* Bonded only on the source's word; a coin it does not list is not said to be either. */
        bonded: q === null ? null : q.bonded,
        proven: address === proven,
      };
    });
    coins.sort((a, b) => {
      const [x, y] = [a.marketCapUsd.v, b.marketCapUsd.v];
      if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
      return y - x;
    });
    return { coins, marketDown };
  }

  /** One reply kept `keepMs` per key, so a sheet opened twice costs one market read. */
  async function keep(key: string, make: () => Promise<SheetReply>): Promise<SheetReply> {
    const now = deps.now();
    for (const [k, v] of kept) if (now - v.at >= deps.keepMs) kept.delete(k);
    const held = kept.get(key);
    if (held !== undefined) return held.reply;
    const reply = await make();
    if (reply.status === 200) kept.set(key, { at: now, reply });
    return reply;
  }

  return {
    /** GET /post/:id/sheet. */
    async sheet(itemId: string): Promise<SheetReply> {
      if (itemId === '' || itemId.length > 200) return json(400, { error: 'bad request' });
      return keep(`post:${itemId}`, () => build(itemId));
    },
    /** GET /story/:id/sheet: the narrative page's posts, their readings and its coins (story-sheet.ts). */
    async story(storyId: string): Promise<SheetReply> {
      if (storyId === '' || storyId.length > 200) return json(400, { error: 'bad request' });
      return keep(`story:${storyId}`, () => buildStorySheet(storyId, { db: deps.db, coinsFor }));
    },
    /** GET /story/:id/sheet?posts=a,b: the cards of chosen posts of the narrative (story-sheet.ts). */
    async storyPosts(storyId: string, ids: readonly string[]): Promise<SheetReply> {
      if (storyId === '' || storyId.length > 200) return json(400, { error: 'bad request' });
      return keep(`story:${storyId}:${ids.join(',')}`, () => buildStoryPosts(storyId, ids, { db: deps.db }));
    },
  };
}

export type PostSheet = ReturnType<typeof createPostSheet>;
