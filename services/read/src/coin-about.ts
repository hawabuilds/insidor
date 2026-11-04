/**
 * GET /coin/:assetKey/about — what the token page's Info tab and its link buttons show beyond
 * the market: the coin's own links, the day's volume, liquidity and market cap, how many wallets
 * hold it, who created it and when, and the feed posts it is weighed against, with the evidence.
 *
 * WHERE EACH FACT COMES FROM, every one true whether or not Insidor exists:
 *   links          the market source's (its `info` block) first; then, for any kind it lacks,
 *                  the coin's launch metadata (public.coin_link, 0059). One per kind, never the
 *                  same link twice, only https. Each carries the real domain or handle as `label`,
 *                  which the page shows on a long press.
 *   volume, liquidity, market cap   the market source's deepest pool.
 *   holders        the market data source's token info; null with a reason when it does not say.
 *   creator, launchedAt   public.asset, as chainwatch recorded them.
 *   posts          feed posts that name this coin: a post whose own coin it is (its card's
 *                  `matched` link, with the card's evidence) and unsure posts whose "See N coins"
 *                  list holds it (public.same_name_coin, 0058), each with its narrative when it is
 *                  on one, and its views as its card last read them (the token page's viral
 *                  post is the most-viewed). Facts only: links this post, same picture,
 *                  launched this long after. A post whose PvP this coin is in (its card's
 *                  `racingCoins`) is listed too, carrying that race, for the page's "PvP" line.
 *   storyId        the narrative on the board whose coin this is (its settled coin first, else its
 *                  top coin, which the page then calls not checked), for the token page's narrative
 *                  card; null when no narrative on the board names it. Read from public.story_view,
 *                  the pages the board serves, so the card never opens a narrative that is gone.
 *
 * ★ ONLY FOR A COIN WE HOLD OR A SEARCH JUST RETURNED, as GET /coin/:id/market (market.ts), so
 * this route cannot be used to make us fetch an arbitrary address.
 * ★ AN OUTAGE IS NOT A NUMBER. A source that failed leaves its fields null with `why`, and the
 * page shows a dash with that reason; the links simply come from whichever source answered.
 *
 * What breaks if changed carelessly: the link filter. The app's censor throws on certain vendor
 * names inside ANY value (mobile/src/shared/api/wire/fields.ts), so one creator link naming one
 * would fail the whole reply; such a link is dropped here, never sent.
 */

import type { CoinProfile, ProfileLink } from '@insidor/market-dexscreener';

import type { Logger } from './log.ts';
import { ASSET_SQL } from './market.ts';
import { DEFAULT_POLICY } from '@insidor/contracts';
import { isShillText } from '@insidor/core';
import type { Db, Row } from './queries.ts';

/** Feed posts listed per coin. A coin named by more posts than this is rare; past it, the newest are not promised. */
export const POSTS_SHOWN = 10;

/** The coin's row: who made it, when, and its launch links. Searched coins may have none. */
export const ABOUT_SQL = `
select a.creator, a.minted_at, l.social_link, l.website, l.chat_link
  from public.asset a
  left join public.coin_link l on l.asset_key = a.asset_key
 where a.asset_key = $1`;

/**
 * Feed posts naming this coin, one row per post: its own coin (`own`), or on its same-name list.
 * `$1` the address. A post on both feeds appears once.
 */
export const POSTS_SQL = `
with named as (
  select distinct on (r.item_id) r.item_id, r.payload, true as own,
         (r.payload #>> '{coins,evidence,linksPost}')::boolean as links_post,
         (r.payload #>> '{coins,evidence,samePicture}')::boolean as same_picture,
         (r.payload #>> '{coins,evidence,launchedAfterMs}')::bigint as launched_after_ms
    from public.rising_row r
   where r.payload #>> '{coins,kind}' = 'matched' and r.payload #>> '{coins,coin,address}' = $1
  union all
  select distinct on (r.item_id) r.item_id, r.payload, false,
         c.links_post, c.same_picture, c.launched_after_ms
    from public.same_name_coin c
    join public.rising_row r on r.item_id = c.subject_id
   where c.subject_kind = 'post' and c.address = $1
  union all
  select distinct on (r.item_id) r.item_id, r.payload, false, null::boolean, null::boolean, null::bigint
    from public.rising_row r
   where r.payload #> '{coins,evidence,racingCoins}' @> jsonb_build_array(jsonb_build_object('address', $1::text))
)
select distinct on (n.item_id) n.item_id, n.payload, n.own, n.links_post, n.same_picture, n.launched_after_ms,
       s.payload ->> 'title' as story_title,
       (extract(epoch from i.first_seen_at) * 1000)::float8 as found_ms
  from named n
  left join public.item i on i.item_id = n.item_id
  left join public.story_view s on s.story_id = n.payload ->> 'storyId'
 order by n.item_id, n.own desc
 limit ${POSTS_SHOWN}`;

/**
 * ★ THE POST THE COIN ITSELF LINKS (the owner, 2026-11-04: $Donkey's launch linked @WatcherGuru's "Over
 * $900,000,000,000 added to the US stock market…", and the page showed an unrelated Shrek post instead):
 * the X status its launch links (public.coin_link, the creator's own claim), when we hold the post. Read
 * whether or not the post ever made a feed — that one was held as politics — so the coin's own post is
 * never missing from its page. `$1` the asset key.
 */
export const LINKED_POST_SQL = `
with l as (
  select substring(coalesce(social_link, '') || ' ' || coalesce(website, '') from '/status(?:es)?/([0-9]{15,20})') as sid
    from public.coin_link where asset_key = $1
)
select i.item_id, i.body, i.media, i.posted_at, i.first_seen_at, (i.counters #>> '{reach,value}')::float8 as reach, a.handle
  from l
  join public.item i on i.item_id = 'x:' || l.sid
  left join public.author a on a.author_key = i.author_key
 where l.sid is not null
 limit 1`;

/** A linked post's words on its card: the post's own, without trailing short links, at most this long. */
const LINKED_EXCERPT_CHARS = 140;

/** The coin's linked post (LINKED_POST_SQL) in the shape of the page's posts, marked as linked; null when none is held. */
export function linkedPostOf(r: Row | undefined): Record<string, unknown> | null {
  const id = text(r?.['item_id']);
  if (r === undefined || id === null) return null;
  const at = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : null);
  const posted = at(r['posted_at']);
  const found = at(r['first_seen_at']);
  const media = Array.isArray(r['media']) ? (r['media'] as Record<string, unknown>[]) : [];
  const handle = text(r['handle']);
  const body = (text(r['body']) ?? '').replace(/(\s*https?:\/\/t\.co\/\S+)+\s*$/u, '').trim();
  const reach = typeof r['reach'] === 'number' && Number.isFinite(r['reach']) && r['reach'] >= 0 ? r['reach'] : null;
  const sid = id.slice('x:'.length);
  return {
    postId: id,
    own: true,
    sourceLabel: 'X',
    authorLabel: handle === null ? '' : `@${handle}`,
    permalink: handle === null ? `https://x.com/i/status/${sid}` : `https://x.com/${handle}/status/${sid}`,
    excerpt: body.length > LINKED_EXCERPT_CHARS ? `${body.slice(0, LINKED_EXCERPT_CHARS - 1).trimEnd()}…` : body,
    thumbUrl: text(media[0]?.['uri']),
    postedAt: posted !== null && Number.isFinite(posted) ? { at: posted } : { at: null, why: 'not_reported' },
    foundAt: found !== null && Number.isFinite(found) ? { at: found } : null,
    views: reach === null ? { v: null, why: 'not_reported' } : { v: reach },
    story: null,
    evidence: { linksPost: true, samePicture: null, launchedAfterMs: null },
  };
}

/** The page's posts with the coin's linked post first: a feed card of it keeps its card and is marked linked. */
export function withLinkedPost(posts: readonly Record<string, unknown>[], linked: Record<string, unknown> | null): readonly Record<string, unknown>[] {
  if (linked === null) return posts;
  const card = posts.find((p) => p['postId'] === linked['postId']);
  const first = card === undefined ? linked : { ...card, evidence: { ...(card['evidence'] as Record<string, unknown>), linksPost: true } };
  return [first, ...posts.filter((p) => p['postId'] !== linked['postId'])];
}

/**
 * The board narrative this coin belongs to: one whose settled coin it is, else one whose top coin it
 * is. Eighty-odd pages, read whole; `$1` the address.
 */
export const COIN_STORY_SQL = `
select story_id
  from public.story_view
 where (payload #>> '{coins,kind}' = 'one' and payload #>> '{coins,coin,address}' = $1)
    or payload #>> '{topCoin,address}' = $1
 order by (payload #>> '{coins,kind}' = 'one' and payload #>> '{coins,coin,address}' = $1) desc, story_id
 limit 1`;

/**
 * ★ THE NARRATIVE ITS POSTS ARE IN (the owner, 2026-10-27: "if a narrative has formed show the narrative
 * below the chart"): when no narrative names this coin as its own, the board narrative that holds any of
 * the coin's posts, the most viewed. `$1` the posts' ids. None: the page shows the post.
 */
export const POSTS_STORY_SQL = `
select story_id
  from public.story_view
 where payload -> 'postIds' ?| $1::text[]
 order by (payload #>> '{viewsTotal,v}')::float8 desc nulls last, story_id
 limit 1`;

/** The kinds of link the page has a button for, in the page's order. */
export const LINK_KINDS = ['x', 'telegram', 'website', 'tiktok'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface AboutLink {
  readonly kind: LinkKind;
  readonly url: string;
  /** The real domain or handle, shown on a long press: "@coin", "t.me/coin", "coin.example". */
  readonly label: string;
}

/**
 * Words the app's censor refuses inside any value (mobile wire/fields.ts FORBIDDEN_SUBSTRINGS).
 * Kept in step by hand: the read service cannot import the app, and a link carrying one would
 * fail the whole reply on the phone.
 */
const REFUSED_IN_VALUES = ['propensity', 'policyhash', 'memescore', 'anthropic', 'apify', 'twitterapi', 'dexscreener', 'helius', 'rugcheck', 'supabase', 'pumpportal'];

/** What kind of link a URL is, by its host. Null for anything that is not https. */
export function linkKind(url: string): LinkKind | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^mobile\./, '');
  if (host === 'x.com' || host === 'twitter.com') return 'x';
  if (host === 't.me' || host === 'telegram.me' || host === 'telegram.org') return 'telegram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  return 'website';
}

/** The same link spelled two ways compares equal: case, `www.`, twitter.com for x.com, a trailing slash. */
function sameKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^twitter\.com$/, 'x.com');
    return `${host}${u.pathname.replace(/\/+$/, '').toLowerCase()}${u.search}`;
  } catch {
    return url;
  }
}

/** The handle or domain a person sees before they open the link. */
export function linkLabel(kind: LinkKind, url: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const first = u.pathname.split('/').filter((s) => s !== '')[0] ?? '';
  if ((kind === 'x' || kind === 'tiktok') && first !== '' && first !== 'i' && first !== 'intent') return `@${first.replace(/^@/, '')}`;
  if (kind === 'telegram' && first !== '') return `t.me/${first}`;
  return host;
}

/**
 * The market source's links, then the launch links for any kind it lacks; one per kind, in the
 * page's order, never the same link twice, only https, nothing the app's censor would refuse.
 */
export function mergeLinks(market: readonly ProfileLink[], launch: readonly (string | null)[]): readonly AboutLink[] {
  const byKind = new Map<LinkKind, string>();
  const seen = new Set<string>();
  const take = (url: string | null) => {
    if (url === null) return;
    const kind = linkKind(url.trim());
    if (kind === null || byKind.has(kind)) return;
    const clean = new URL(url.trim()).toString();
    const lowered = clean.toLowerCase();
    if (REFUSED_IN_VALUES.some((w) => lowered.includes(w))) return;
    const key = sameKey(clean);
    if (seen.has(key)) return;
    seen.add(key);
    byKind.set(kind, clean);
  };
  for (const l of market) if (l.kind !== 'discord') take(l.url);
  /* Every market link is in before the first launch link: a launch link only fills a gap. */
  for (const l of launch) take(l);
  return LINK_KINDS.flatMap((kind) => {
    const url = byKind.get(kind);
    return url === undefined ? [] : [{ kind, url, label: linkLabel(kind, url) }];
  });
}

export interface AboutDeps {
  readonly db: Db;
  readonly log: Logger;
  /** The market source's profile for one coin; null when it does not list it. Throws on an outage. */
  readonly profile: (address: string) => Promise<CoinProfile | null>;
  /** How many wallets hold it; null when the source does not say. Throws on an outage. */
  readonly holders: ((address: string) => Promise<number | null>) | null;
  readonly recent?: (address: string) => boolean;
}

const measured = (v: number | null | undefined, why: string) => (v === null || v === undefined || !Number.isFinite(v) ? { v: null, why } : { v });
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const fact = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const views = (v: unknown) => {
  const n = typeof v === 'object' && v !== null ? (v as Record<string, unknown>)['v'] : null;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? { v: n } : { v: null, why: 'not_reported' };
};

/** The card's race (`coins.evidence.racingCoins`), passed on as it is when it is a list of two or more. */
function racingCoinsOf(payload: Record<string, unknown>): { readonly racingCoins?: readonly unknown[] } {
  const coins = payload['coins'];
  const evidence = typeof coins === 'object' && coins !== null ? (coins as Record<string, unknown>)['evidence'] : null;
  const list = typeof evidence === 'object' && evidence !== null ? (evidence as Record<string, unknown>)['racingCoins'] : null;
  return Array.isArray(list) && list.length >= 2 ? { racingCoins: list } : {};
}

/** The post's own facts, read from its feed payload: only the fields the card already shows. */
function postOf(r: Row): Record<string, unknown> | null {
  const p = typeof r['payload'] === 'object' && r['payload'] !== null ? (r['payload'] as Record<string, unknown>) : null;
  const id = text(r['item_id']);
  if (p === null || id === null) return null;
  const after = r['launched_after_ms'] === null || r['launched_after_ms'] === undefined ? null : Number(r['launched_after_ms']);
  const storyId = text(p['storyId']);
  const title = text(r['story_title']);
  return {
    postId: id,
    own: r['own'] === true,
    sourceLabel: text(p['sourceLabel']) ?? '',
    authorLabel: text(p['authorLabel']) ?? '',
    permalink: text(p['permalink']),
    excerpt: text(p['excerpt']) ?? '',
    thumbUrl: text(p['thumbUrl']),
    postedAt: p['postedAt'] ?? null,
    /* When we first saved the post (public.item): the token chart's "caught it" mark. */
    foundAt: typeof r['found_ms'] === 'number' && Number.isFinite(r['found_ms']) ? { at: r['found_ms'] } : null,
    /* The post's views as its feed card last read them ({ v } or { v: null, why }): the token
       page leads with the most-viewed post, so a missing count must stay missing, not zero. */
    views: views(p['reach']),
    story: storyId !== null && title !== null ? { storyId, title } : null,
    evidence: {
      linksPost: fact(r['links_post']),
      samePicture: fact(r['same_picture']),
      launchedAfterMs: after !== null && Number.isFinite(after) ? after : null,
      /* ★ The post's PvP, as its card carries it (services/project one-coin-cards.ts): the token page
         says when another coin for the same post is ahead of this one. Market facts only. */
      ...racingCoinsOf(p),
    },
  };
}

/**
 * When the app first showed this coin as a post's matched coin, and the market cap the card showed
 * (0145 public.coin_notified; 0143 read the coin pushes, which not every phone gets): the token
 * chart's bubble. Before 0143 the view is missing and the answer is
 * none, never an error: the page draws its chart without it.
 */
export const NOTIFIED_SQL = `select (extract(epoch from notified_at) * 1000)::float8 as at, mc_usd from public.coin_notified where address = $1`;

export async function coinAbout(assetKey: string, deps: AboutDeps): Promise<{ readonly status: number; readonly body: string } | null> {
  const held = (await deps.db.query(ASSET_SQL, [assetKey]))[0];
  const searched = assetKey.startsWith('solana:') && deps.recent?.(assetKey.slice('solana:'.length)) === true;
  if ((held === undefined || held['chain'] !== 'solana' || typeof held['address'] !== 'string') && !searched) return null;
  const address = typeof held?.['address'] === 'string' ? held['address'] : assetKey.slice('solana:'.length);

  const [rows, posts, story, profile, holders, notified, linked] = await Promise.all([
    deps.db.query(ABOUT_SQL, [assetKey]),
    deps.db.query(POSTS_SQL, [address]),
    deps.db.query(COIN_STORY_SQL, [address]),
    deps.profile(address).then(
      (p) => ({ ok: true as const, p }),
      (e: unknown) => {
        deps.log.info('coin profile unavailable', { asset: assetKey, err: e instanceof Error ? e.message : String(e) });
        return { ok: false as const, p: null };
      },
    ),
    deps.holders === null
      ? Promise.resolve({ ok: false as const, n: null })
      : deps.holders(address).then(
          (n) => ({ ok: true as const, n }),
          () => ({ ok: false as const, n: null }),
        ),
    deps.db.query(NOTIFIED_SQL, [address]).catch(() => []),
    deps.db.query(LINKED_POST_SQL, [assetKey]).catch(() => []),
  ]);
  /* No narrative names the coin: the one its posts are in, if one has formed. */
  const postIds = posts.flatMap((r) => (typeof r['item_id'] === 'string' ? [r['item_id']] : []));
  const postsStory = text(story[0]?.['story_id']) !== null || postIds.length === 0 ? null : text((await deps.db.query(POSTS_STORY_SQL, [postIds]).catch(() => []))[0]?.['story_id']);
  const told = notified[0];
  const toldAt = typeof told?.['at'] === 'number' && Number.isFinite(told['at']) ? told['at'] : null;
  const toldCap = typeof told?.['mc_usd'] === 'number' && Number.isFinite(told['mc_usd']) && told['mc_usd'] > 0 ? told['mc_usd'] : null;
  const row = rows[0];
  const minted = row?.['minted_at'] instanceof Date ? row['minted_at'].getTime() : typeof row?.['minted_at'] === 'string' ? Date.parse(row['minted_at']) : null;
  const marketWhy = profile.ok ? 'not_reported' : 'unreadable';
  return {
    status: 200,
    body: JSON.stringify({
      links: mergeLinks(profile.p?.links ?? [], [text(row?.['social_link']), text(row?.['chat_link']), text(row?.['website'])]),
      volume24hUsd: measured(profile.p?.volume24hUsd, marketWhy),
      liquidityUsd: measured(profile.p?.liquidityUsd, marketWhy),
      marketCapUsd: measured(profile.p?.marketCapUsd, marketWhy),
      holders: measured(holders.n, holders.ok ? 'not_reported' : 'unreadable'),
      creator: text(row?.['creator']),
      launchedAt: minted !== null && Number.isFinite(minted) ? { at: minted } : { at: null, why: 'not_reported' },
      posts: withLinkedPost(
        posts.flatMap((r) => {
          const p = postOf(r);
          /* ★ NEVER A PROMOTION (the owner, 2026-11-04: "make sure we dont show promotional posts under
             chart"): a post whose own words name a coin (a cashtag, an address, "CA": core's shill
             rule) is someone selling it, not the viral post it was made for. The coin's own linked
             post is kept whatever it says: the coin claims it. */
          const linksIt = (p?.['evidence'] as { linksPost?: unknown } | undefined)?.linksPost === true;
          return p === null || (!linksIt && isShillText(String(p['excerpt'] ?? ''), DEFAULT_POLICY.attention)) ? [] : [p];
        }),
        linkedPostOf(linked[0]),
      ),
      storyId: text(story[0]?.['story_id']) ?? postsStory,
      /* When we first pushed it to phones and at what market cap; null when we never did. */
      notified: toldAt === null ? null : { at: toldAt, marketCapUsd: toldCap },
    }),
  };
}
