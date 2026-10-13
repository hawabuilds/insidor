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
 *                  on one. Facts only: links this post, same picture, launched this long after.
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
)
select distinct on (n.item_id) n.item_id, n.payload, n.own, n.links_post, n.same_picture, n.launched_after_ms,
       s.payload ->> 'title' as story_title
  from named n
  left join public.story_view s on s.story_id = n.payload ->> 'storyId'
 order by n.item_id, n.own desc
 limit ${POSTS_SHOWN}`;

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
    story: storyId !== null && title !== null ? { storyId, title } : null,
    evidence: { linksPost: fact(r['links_post']), samePicture: fact(r['same_picture']), launchedAfterMs: after !== null && Number.isFinite(after) ? after : null },
  };
}

export async function coinAbout(assetKey: string, deps: AboutDeps): Promise<{ readonly status: number; readonly body: string } | null> {
  const held = (await deps.db.query(ASSET_SQL, [assetKey]))[0];
  const searched = assetKey.startsWith('solana:') && deps.recent?.(assetKey.slice('solana:'.length)) === true;
  if ((held === undefined || held['chain'] !== 'solana' || typeof held['address'] !== 'string') && !searched) return null;
  const address = typeof held?.['address'] === 'string' ? held['address'] : assetKey.slice('solana:'.length);

  const [rows, posts, profile, holders] = await Promise.all([
    deps.db.query(ABOUT_SQL, [assetKey]),
    deps.db.query(POSTS_SQL, [address]),
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
  ]);
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
      posts: posts.flatMap((r) => {
        const p = postOf(r);
        return p === null ? [] : [p];
      }),
    }),
  };
}
