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
 * coin page's post, and both are rows on a feed.
 *
 * ★ A NUMBER WE COULD NOT READ IS A DASH WITH WHY, NEVER ZERO. A coin the market source does not
 * list has no market anyone reports (`no_market`); an outage is `not_read_yet`; the order puts
 * every coin with an unknown cap after every coin with a known one, never at the bottom as $0.
 *
 * What breaks if changed carelessly: `picture_url` arrives through `to_jsonb(a)`, so this reads the
 * same before and after migration 0067 adds the column; naming the column directly would make every
 * sheet a 500 until the migration ran. And a video's file is passed on only when it is an https mp4
 * link the source serves unsigned: anything else would be a blank player.
 */

import type { CoinQuote } from '@insidor/market-dexscreener';

import type { Logger } from './log.ts';
import type { Db, Row } from './queries.ts';

/** The post on whichever feed holds it, For You first. */
export const SHEET_POST_SQL = `
select r.payload, i.first_seen_at, i.media, a.display_name, a.follower_count::text as follower_count,
       to_jsonb(a) ->> 'picture_url' as picture_url
  from public.rising_row r
  join public.item i on i.item_id = r.item_id
  left join public.author a on a.author_key = i.author_key
 where r.item_id = $1
 order by (r.feed_id = 'fyp') desc
 limit 1`;

/** The promoted narrative the post is in, if any: the Narrative tile's name and link. */
export const SHEET_STORY_SQL = `
select m.story_id, v.payload ->> 'title' as title
  from public.story_member m
  join public.story s on s.story_id = m.story_id and s.state = 'promoted' and s.merged_into is null and s.origin = 'observed'
  join public.story_view v on v.story_id = m.story_id
 where m.item_id = $1
 order by m.joined_at asc
 limit 1`;

/** A narrative's title by id, when the post's coin link names a narrative it is not first a member of. */
export const SHEET_TITLE_SQL = `select payload ->> 'title' as title from public.story_view where story_id = $1`;

/** The coins written beside the post (or its narrative), in the projector's order. */
export const SHEET_LIST_SQL = `
select address from public.same_name_coin
 where (subject_kind = 'post' and subject_id = $1) or (subject_kind = 'story' and subject_id = $2)
 order by position asc`;

/** What we hold of each coin: its full row while it lasts, the name index after. */
export const SHEET_COINS_SQL = `
select n.address, coalesce(a.symbol, n.ticker) as symbol, coalesce(a.name, n.name) as name, a.image_uri,
       coalesce(a.minted_at, n.launched_at) as minted_at
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

  async function build(itemId: string): Promise<SheetReply> {
    const row = (await deps.db.query(SHEET_POST_SQL, [itemId]))[0];
    if (row === undefined) return json(404, { error: 'not found' });
    const payload = rec(row['payload']);
    const storyRow = (await deps.db.query(SHEET_STORY_SQL, [itemId]))[0];
    const storyId = str(payload['storyId']) ?? str(storyRow?.['story_id']);

    const link = linkedAddresses(payload['coins']);
    const listed = (await deps.db.query(SHEET_LIST_SQL, [itemId, storyId ?? ''])).flatMap((r) => str(r['address']) ?? []);
    const addresses = [...new Set([...link.addresses, ...listed])].slice(0, SHEET_COINS_MAX);
    const held = new Map((addresses.length === 0 ? [] : await deps.db.query(SHEET_COINS_SQL, [addresses])).map((r) => [str(r['address']) ?? '', r] as const));

    let quotes: ReadonlyMap<string, CoinQuote> = new Map();
    let marketDown = false;
    if (deps.quotes !== null && addresses.length > 0) {
      try {
        quotes = await deps.quotes.quotes(addresses);
      } catch (e) {
        marketDown = true;
        deps.log.info('post sheet market unavailable', { err: e instanceof Error ? e.message : String(e) });
      }
    }
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
    const linkCoin = rec(rec(payload['coins'])['coin']);
    const coins = addresses.map((address) => {
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
        marketCapUsd: measured(q?.marketCapUsd, unlisted),
        changePct24h: measured(q?.change.h24, unlisted),
        /* Bonded only on the source's word; a coin it does not list is not said to be either. */
        bonded: q === null ? null : q.bonded,
        proven: address === link.proven,
      };
    });
    const cap = (c: (typeof coins)[number]) => c.marketCapUsd.v;
    coins.sort((a, b) => {
      const [x, y] = [cap(a), cap(b)];
      if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
      return y - x;
    });

    const followers = row['follower_count'] === null || row['follower_count'] === undefined ? null : Number(row['follower_count']);
    return json(200, {
      post: payload,
      author: {
        name: str(row['display_name']),
        pictureUrl: https(row['picture_url']),
        followers: measured(followers, 'not_reported'),
      },
      foundAt: instant(ms(row['first_seen_at']), 'not_reported'),
      media: sheetMedia(row['media']),
      /* `story` on the wire, as coin-about.ts sends it: the app's censor refuses the other word as a key. */
      story: storyId === null ? null : { storyId, title: str(storyRow?.['story_id']) === storyId ? str(storyRow?.['title']) : str((await deps.db.query(SHEET_TITLE_SQL, [storyId]))[0]?.['title']) },
      coinName: sharedName(coins),
      sourcesMissing: marketDown ? 1 : 0,
      coins,
    });
  }

  return {
    /** GET /post/:id/sheet. Kept `keepMs` per post, so a sheet opened twice costs one market read. */
    async sheet(itemId: string): Promise<SheetReply> {
      if (itemId === '' || itemId.length > 200) return json(400, { error: 'bad request' });
      const now = deps.now();
      for (const [k, v] of kept) if (now - v.at >= deps.keepMs) kept.delete(k);
      const held = kept.get(itemId);
      if (held !== undefined) return held.reply;
      const reply = await build(itemId);
      if (reply.status === 200) kept.set(itemId, { at: now, reply });
      return reply;
    },
  };
}

export type PostSheet = ReturnType<typeof createPostSheet>;
