/**
 * A FEED POST'S OWN COIN, DECIDED BY EVIDENCE — and the post's name ideas for Create.
 *
 * rising.ts has, for each post on a feed, the coins its name search kept (internal.coin_lookup).
 * This module gathers what we hold about each of those coins against that post and hands it to
 * core's `matchPostCoin`, which answers confident (one coin) or unsure (a ranked list):
 *
 *   links      the coin's metadata document (internal.coin_metadata, read by the universe loop)
 *              — its social link, website, chat link and description — carries the post's id
 *              or its picture's. Unread metadata is "not known", never "no".
 *   picture    the post's vector against the coin's (internal.image_embedding, embedded by the
 *              runner's coin-match step), and the judge's same-subject answer on a borderline
 *              pair (internal.image_pair_check). Read here, decided by core's bars.
 *   timing     the coin's launch (public.coin_name, else public.asset) against the post's time.
 *   name       the judge's names for the subject against the coin's name and ticker.
 *
 * ★ ONLY THE FACTS LEAVE. The similarity, the judge's answer and the rule's reason stay here;
 * the wire carries "links this post", "same picture" and "launched 12m after" (wire.ts
 * `WireCoinEvidence`), true or unknown, and the list's order.
 *
 * Name ideas: core's `nameIdeas` over the judge's proposed and alternate names, with the brand
 * names below dropped. Written to public.post_name_idea for the read service, which adds
 * whether each ticker is free when a person opens Create.
 *
 * What breaks if changed carelessly: the bars. They must equal the gold eval's
 * (eval/src/gold/match-eval.ts MATCH_BARS), which measured this rule's wrong links on the gold
 * set; a bar changed here alone ships a rule nobody measured.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { matchPostCoin, nameIdeas, pictureVerdict, type CoinSide, type MatchBars, type NameIdea, type PostCoinMatch } from '@insidor/core';
import type { Db } from '@insidor/store';

import { pictureOf } from './db.ts';
import type { WireCoinEvidence } from './wire.ts';

/* ★ POLICY NUMBERS, to move into contracts/src/policy.ts (the session owner adds them). The
     timing window and the grace are already policy (universe.matchWindowMs, origin.launchAllowanceMs).
     MIN_LINK_ID_LENGTH  a post id shorter than this is never looked for in a coin's links.
     MIN_VARIANT_LENGTH  a looser spelling of a name counts only from this many letters.
     MIN_TICKER, MAX_TICKER, MAX_NAME_IDEAS  the owner's sheet: 3 to 10 capitals, at most 5 ideas. */
export const MIN_LINK_ID_LENGTH = 8;
export const MIN_VARIANT_LENGTH = 4;
export const MIN_TICKER = 3;
export const MAX_TICKER = 10;
export const MAX_NAME_IDEAS = 5;

export function matchBars(p: Policy = DEFAULT_POLICY): MatchBars {
  return { launchAllowanceMs: p.origin.launchAllowanceMs, windowMs: p.universe.matchWindowMs, minLinkIdLength: MIN_LINK_ID_LENGTH, minVariantLength: MIN_VARIANT_LENGTH };
}

/**
 * Brand names a coin must not be named: a coin under someone's trademark invites the takedown
 * and the lawsuit, and the judge sometimes names the product in the picture rather than the
 * subject. Lower-cased, written as one word; matched as a whole name, a word of it, or two or
 * three neighbouring words run together ("Six Flags Goliath" is SIXFLAGS). Not a complete list —
 * the judge's prompt carries the rule; this catches the ones it lets through most often. Only
 * words that are a brand and nothing else: "apple", "subway" or "target" would drop real
 * subjects.
 */
const BRANDS: ReadonlySet<string> = new Set([
  'iphone', 'ipad', 'macbook', 'google', 'microsoft', 'amazon', 'netflix', 'disney', 'disneyland', 'pixar', 'marvel',
  'nike', 'adidas', 'puma', 'gucci', 'prada', 'chanel', 'louisvuitton', 'hermes', 'rolex', 'balenciaga', 'crocs',
  'coca', 'cola', 'cocacola', 'pepsi', 'fanta', 'gatorade', 'mcdonalds', 'mcdonald', 'starbucks', 'kfc', 'burgerking',
  'wendys', 'tacobell', 'popeyes', 'chipotle', 'dominos', 'dunkin', 'costco', 'ikea', 'walmart', 'tesla', 'spacex',
  'samsung', 'sony', 'playstation', 'xbox', 'nintendo', 'pokemon', 'pikachu', 'lego', 'barbie', 'hotwheels', 'hellokitty',
  'sanrio', 'ferrari', 'lamborghini', 'porsche', 'bmw', 'mercedes', 'toyota', 'chatgpt', 'openai', 'nvidia', 'facebook',
  'instagram', 'whatsapp', 'tiktok', 'youtube', 'twitter', 'snapchat', 'discord', 'twitch', 'reddit', 'spotify', 'uber',
  'airbnb', 'doordash', 'fedex', 'redbull', 'doritos', 'cheetos', 'skittles', 'oreo', 'nutella', 'shrek', 'minecraft',
  'fortnite', 'roblox', 'sixflags', 'universalstudios', 'seaworld', 'legoland', 'wwe', 'nfl', 'nba', 'fifa', 'gopro',
]);

const words = (s: string): string[] => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w !== '');

/** A name that is, or contains as a word or as neighbouring words run together, a brand on the list. */
export function isBrand(name: string): boolean {
  const ws = words(name);
  const runs = ws.flatMap((w, i) => [w, w + (ws[i + 1] ?? ''), w + (ws[i + 1] ?? '') + (ws[i + 2] ?? '')]);
  return runs.some((r) => BRANDS.has(r)) || BRANDS.has(ws.join(''));
}

/** The Create sheet's ideas for one post, from the judge's names, brands dropped. */
export function postNameIdeas(proposedName: string | null, alternateNames: readonly string[]): readonly NameIdea[] {
  const keep = (n: string) => !isBrand(n);
  return nameIdeas(proposedName !== null && keep(proposedName) ? proposedName : null, alternateNames.filter(keep), { minTicker: MIN_TICKER, maxTicker: MAX_TICKER, maxIdeas: MAX_NAME_IDEAS });
}

/** A post's coins, weighed: the decision and each coin's facts in the list's order. */
export interface PostMatch {
  readonly decision: PostCoinMatch;
  /** In `byEvidence` order; the projector writes this order to public.same_name_coin. */
  readonly evidence: readonly (WireCoinEvidence & { readonly address: string })[];
}

interface PostRow {
  item_id: string;
  source_item_id: string;
  posted_at: Date | string | null;
  first_seen_at: Date | string;
  media: unknown;
  proposed_name: string | null;
  alternate_names: string[] | null;
}

interface CoinRow {
  item_id: string;
  address: string;
  name: string | null;
  ticker: string | null;
  launched_at: Date | string | null;
  outcome: string | null;
  social_link: string | null;
  website: string | null;
  chat_link: string | null;
  description: string | null;
  similarity: number | string | null;
  same_subject: 'yes' | 'no' | 'unsure' | null;
}

const ms = (v: Date | string | null): Millis | null => {
  if (v === null) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? (t as Millis) : null;
};

/** An X picture's media key is its file's stem; a link to the picture carries it. */
function pictureIds(media: unknown): string[] {
  const uri = pictureOf(media)?.uri ?? null;
  const stem = uri === null ? undefined : /\/([A-Za-z0-9_-]{8,})\.(?:jpe?g|png|webp|gif)(?:$|[?#])/i.exec(uri)?.[1];
  return stem === undefined ? [] : [stem];
}

/** The judge's newest names for each post, and the post's own time and ids. */
async function loadPosts(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, PostRow>> {
  const rows = await db.query<PostRow>(
    `select i.item_id, i.source_item_id, i.posted_at, i.first_seen_at, i.media, j.proposed_name, j.alternate_names
       from public.item i
       left join lateral (
              select pj.proposed_name, pj.alternate_names from internal.post_judgement pj
               where pj.item_id = i.item_id order by pj.judged_at desc, pj.id desc limit 1
            ) j on true
      where i.item_id = any($1::text[])`,
    [[...itemIds]],
  );
  return new Map(rows.map((r) => [r.item_id, r]));
}

/**
 * Each post's listed coins with every fact we hold: name and launch (coin_name, else asset),
 * the metadata document's links, the picture similarity on the coin's current picture, and
 * the judge's answer on that pair.
 */
async function loadCoins(db: Db, pairs: readonly { itemId: string; address: string }[], space: string): Promise<readonly CoinRow[]> {
  if (pairs.length === 0) return [];
  return db.query<CoinRow>(
    `select p.item_id, p.address, coalesce(n.name, a.name) as name, coalesce(n.ticker, a.symbol) as ticker,
            coalesce(a.minted_at, n.launched_at) as launched_at,
            m.outcome, m.social_link, m.website, m.chat_link, m.description,
            pic.similarity, pic.same_subject
       from unnest($1::text[], $2::text[]) as p(item_id, address)
       left join public.coin_name n on n.address = p.address
       left join public.asset a on a.address = p.address
       left join internal.coin_metadata m on m.asset_key = a.asset_key
       left join lateral (
              select 1 - (ae.embedding <=> ie.embedding) as similarity,
                     (select c.answer from internal.image_pair_check c
                       where c.uri_a = least(ae.uri, ie.uri) and c.uri_b = greatest(ae.uri, ie.uri)
                       order by c.checked_at desc limit 1) as same_subject
                from internal.image_embedding ae
                join internal.image_embedding ie on ie.subject_kind = 'item' and ie.subject_id = p.item_id and ie.space = ae.space
               where ae.subject_kind = 'asset' and ae.subject_id = a.asset_key and ae.space = $3
                 and ae.uri = coalesce(m.image_uri, a.image_uri)
               order by similarity desc
               limit 1
            ) pic on true`,
    [pairs.map((x) => x.itemId), pairs.map((x) => x.address), space],
  );
}

/**
 * Every post's coins weighed by the rule. `lists` is each post's name-search coins (rising.ts
 * loadPostLookups); a post without any is absent from the result.
 */
export async function weighPostCoins(db: Db, lists: ReadonlyMap<string, readonly string[]>, p: Policy = DEFAULT_POLICY): Promise<ReadonlyMap<string, PostMatch>> {
  const ids = [...lists.keys()];
  const posts = await loadPosts(db, ids);
  const pairs = [...lists].flatMap(([itemId, addresses]) => addresses.map((address) => ({ itemId, address })));
  const coins = await loadCoins(db, pairs, p.group.image.space);
  const byPost = new Map<string, CoinRow[]>();
  for (const c of coins) byPost.set(c.item_id, [...(byPost.get(c.item_id) ?? []), c]);

  const bars = matchBars(p);
  const matches = new Map<string, PostMatch>();
  for (const [itemId, rows] of byPost) {
    const post = posts.get(itemId);
    if (post === undefined) continue;
    const names = [post.proposed_name, ...(post.alternate_names ?? [])].filter((n): n is string => n !== null && n.trim() !== '');
    const sides: CoinSide[] = rows.map((r) => ({
      address: r.address,
      name: r.name,
      ticker: r.ticker,
      launchedAt: ms(r.launched_at),
      links: r.outcome === 'read' ? [r.social_link, r.website, r.chat_link, r.description].filter((l): l is string => l !== null) : null,
      samePicture: pictureVerdict(r.similarity === null ? null : Number(r.similarity), r.same_subject === 'yes' ? true : r.same_subject === 'no' ? false : null, p.group.image),
    }));
    const decision = matchPostCoin(
      { postedAt: ms(post.posted_at) ?? ms(post.first_seen_at), linkIds: [post.source_item_id, ...pictureIds(post.media)], names },
      sides,
      bars,
    );
    const evidence = decision.kind === 'none' ? [] : decision.ranked.map((e) => ({ address: e.address, linksPost: e.linksPost, samePicture: e.samePicture, launchedAfterMs: e.launchedAfterMs }));
    matches.set(itemId, { decision, evidence });
  }
  return matches;
}

/** Each post's name ideas, from the judge's newest names for it. */
export async function loadNameIdeas(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly NameIdea[]>> {
  if (itemIds.length === 0) return new Map();
  const posts = await loadPosts(db, itemIds);
  return new Map([...posts].map(([id, post]) => [id, postNameIdeas(post.proposed_name, post.alternate_names ?? [])]));
}

/** Every shown post's ideas, replacing the last run's, in the caller's transaction. */
export async function writeNameIdeas(db: Db, ideas: ReadonlyMap<string, readonly NameIdea[]>): Promise<number> {
  await db.query(`delete from public.post_name_idea`);
  const ids: string[] = [];
  const positions: number[] = [];
  const names: string[] = [];
  const tickers: string[] = [];
  for (const [id, list] of ideas) {
    list.forEach((idea, i) => {
      ids.push(id);
      positions.push(i);
      names.push(idea.name.slice(0, 64));
      tickers.push(idea.ticker);
    });
  }
  if (ids.length === 0) return 0;
  await db.query(
    `insert into public.post_name_idea (item_id, position, name, ticker)
     select * from unnest($1::text[], $2::int[], $3::text[], $4::text[])`,
    [ids, positions, names, tickers],
  );
  return ids.length;
}
