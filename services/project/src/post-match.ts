/**
 * A FEED POST'S OWN COIN, DECIDED BY EVIDENCE — and the post's name ideas for Create.
 *
 * rising.ts has, for each post on a feed, the coins its name search kept (internal.coin_lookup).
 * This module widens that list, gathers what we hold about each candidate against the post, and
 * hands it to core's `matchPostCoin`, which answers PROVEN (one coin, a Buy), or a ranked list
 * whose first coin may be LIKELY (never a Buy), or none:
 *
 *   candidates  the name search's coins; the coins whose address was posted under the post
 *               (internal.crypto_attention `_addresses`); the coins whose logo's perceptual hash is
 *               within `postCoin.widenHashDistance` of the post's picture, over every coin minted
 *               in the window (internal.image_hash, 0070); and the mint stream's own coins whose
 *               name or ticker is a short form, misspelling or longer form of the subject's names
 *   links       the coin's metadata document (internal.coin_metadata) — its social link, website,
 *               chat link and description — names the post, or the poster's account. Unread
 *               metadata is "not known", never "no".
 *   picture     the embedding's similarity on the coin's picture (internal.image_embedding, by the
 *               runner's coin-match step) and the two pictures' hash distance. Near-identical by
 *               either is "same picture"; the judge's borderline "same subject" leaves it unknown.
 *   words       the coin's description against the post's own words
 *   address     the poster's own account, or others, posted the coin's address under the post
 *   timing      the coin's launch (public.coin_name, else public.asset) against the post's time.
 *   name        the judge's names for the subject against the coin's name and ticker.
 *   weights     the newest re-tune refit (internal.coin_match_fit, 0070), else Policy.postCoin.
 *
 * ★ ONLY THE FACTS LEAVE. The similarity, the hash distance, the score and the rule's reason stay
 * here; the wire carries "links this post", "same picture", "launched 12m after" and "the poster
 * posted its address" (wire.ts `WireCoinEvidence`), true or unknown, and the list's order.
 *
 * ★ BEFORE 0070 every read of the new tables answers nothing and the match runs on what it had: no
 * hash is "not compared", no refit is the policy's weights.
 *
 * Name ideas: core's `nameIdeas` over the judge's proposed and alternate names, with the brand
 * names below dropped. Written to public.post_name_idea for the read service, which adds
 * whether each ticker is free when a person opens Create.
 *
 * What breaks if changed carelessly: the bars. They come from the policy object the gold eval reads
 * too (eval/src/gold/match-eval.ts `matchBarsOf`), so the rule that ships is the rule measured; a
 * bar set here alone ships a rule nobody measured.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy, type PostCoinWeights } from '@insidor/contracts/policy.ts';
import { compactName, guessesFirst, matchPostCoin, nameIdeas, nameMatch, postPictureVerdict, type CoinSide, type MatchBars, type NameIdea, type PostCoinMatch } from '@insidor/core';
import { missingTable, PgCryptoAttentionRepo, PgImageHashRepo, PgNameGuessRepo, type Db } from '@insidor/store';

import { pictureOf } from './db.ts';
import type { WireCoinEvidence } from './wire.ts';

/* ★ POLICY NUMBERS, to move into contracts/src/policy.ts (the session owner adds them).
     MIN_TICKER, MAX_TICKER, MAX_NAME_IDEAS  the owner's sheet: 3 to 10 capitals, at most 5 ideas. */
export const MIN_TICKER = 3;
export const MAX_TICKER = 10;
export const MAX_NAME_IDEAS = 5;
/** The hash the runner writes (services/runner picture-hash.ts HASH_VERSION); another is never compared. */
const HASH_VERSION = 'dct64-1';

/** The match's bars from the policy, with the re-tune's weights and likely bar when it has refitted. */
export function matchBars(p: Policy = DEFAULT_POLICY, fit: { readonly weights: PostCoinWeights; readonly likelyMinShare: number } | null = null): MatchBars {
  const pc = p.postCoin;
  return {
    launchAllowanceMs: p.origin.launchAllowanceMs,
    windowMs: p.universe.matchWindowMs,
    minLinkIdLength: pc.minLinkIdLength,
    minVariantLength: pc.minVariantLength,
    sameHashDistance: pc.sameHashDistance,
    pictureFloor: pc.pictureFloor,
    timingHalfLifeMin: pc.timingHalfLifeMin,
    descriptionMinWord: pc.descriptionMinWord,
    likelyMinShare: fit?.likelyMinShare ?? pc.likelyMinShare,
    weights: fit?.weights ?? pc.weights,
    closePicture: p.group.image.likely,
  };
}

/** The newest refit of the weights (0070), or null: none yet, or the table not there. */
export async function loadFit(db: Db): Promise<{ readonly weights: PostCoinWeights; readonly likelyMinShare: number } | null> {
  try {
    const rows = await db.query<{ weights: PostCoinWeights; likely_min_share: number }>(
      `select weights, likely_min_share from internal.coin_match_fit order by fitted_at desc limit 1`,
    );
    const r = rows[0];
    return r === undefined ? null : { weights: { ...DEFAULT_POLICY.postCoin.weights, ...r.weights }, likelyMinShare: Number(r.likely_min_share) };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
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
  'fortnite', 'roblox', 'gta', 'grandtheftauto', 'streetfighter', 'callofduty', 'sixflags', 'universalstudios', 'seaworld', 'legoland', 'wwe', 'nfl', 'nba', 'fifa', 'gopro',
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
  body: string | null;
  handle: string | null;
  proposed_name: string | null;
  alternate_names: string[] | null;
}

interface CoinRow {
  item_id: string;
  address: string;
  name: string | null;
  ticker: string | null;
  image_uri: string | null;
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
    `select i.item_id, i.source_item_id, i.posted_at, i.first_seen_at, i.media, i.body, au.handle, j.proposed_name, j.alternate_names
       from public.item i
       left join public.author au on au.author_key = i.author_key
       left join lateral (
              select pj.proposed_name, pj.alternate_names from internal.post_judgement pj
               where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
               order by pj.judged_at desc, pj.id desc limit 1
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
            coalesce(m.image_uri, a.image_uri) as image_uri,
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
 * The mint stream's own coins, minted in each post's window, whose name or ticker holds a form of
 * the subject's names: what a market search months later, or a crowded name, does not return.
 * The SQL is a wide first cut (the names' first `minVariantLength` letters); core's `nameMatch`
 * keeps the short forms, misspellings and longer forms, newest first.
 */
async function nameCandidates(db: Db, posts: readonly { itemId: string; postedAt: Millis; names: readonly string[]; text: string | null }[], p: Policy): Promise<ReadonlyMap<string, readonly string[]>> {
  const pc = p.postCoin;
  const out = new Map<string, string[]>();
  for (const post of posts) {
    const stems = [...new Set(post.names.map((n) => compactName(n.replace(/^\s*the\s+/i, ''))).filter((n) => n.length >= pc.minVariantLength).map((n) => n.slice(0, pc.minVariantLength)))];
    if (stems.length === 0) continue;
    const rows = await db.query<{ address: string; name: string | null; symbol: string | null }>(
      `select a.address, a.name, a.symbol
         from public.asset a
        where a.minted_at between $1::timestamptz - make_interval(secs => $3::double precision / 1000)
                              and $1::timestamptz + make_interval(secs => $4::double precision / 1000)
          and (lower(regexp_replace(coalesce(a.name, ''), '[^a-zA-Z0-9]', '', 'g')) like any ($2::text[])
               or lower(regexp_replace(coalesce(a.symbol, ''), '[^a-zA-Z0-9]', '', 'g')) like any ($2::text[]))
        order by a.minted_at desc
        limit $5`,
      [new Date(post.postedAt).toISOString(), stems.map((s) => `%${s}%`), p.origin.launchAllowanceMs, p.universe.matchWindowMs, pc.nameCandidatesPerPost * pc.nameCandidatesPerPost],
    );
    const kept = rows.filter((r) => nameMatch(post.names, { name: r.name, ticker: r.symbol }, pc, post.text) !== 'none').slice(0, pc.nameCandidatesPerPost).map((r) => r.address);
    if (kept.length > 0) out.set(post.itemId, kept);
  }
  return out;
}

const bitsApart = (a: string, b: string): number => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x > 0n; x >>= 1n) n += Number(x & 1n);
  return n;
};

/**
 * Every post's coins weighed by the rule. `lists` is each post's name-search coins (rising.ts
 * loadPostLookups), empty when the search found none; the candidates are widened here. A post
 * with no candidate at all is absent from the result.
 */
export async function weighPostCoins(
  db: Db,
  lists: ReadonlyMap<string, readonly string[]>,
  p: Policy = DEFAULT_POLICY,
  opts: { readonly ignoreFit?: boolean; readonly guesses?: ReadonlyMap<string, readonly { readonly name: string; readonly ticker: string }[]> } = {},
): Promise<ReadonlyMap<string, PostMatch>> {
  const ids = [...lists.keys()];
  const posts = await loadPosts(db, ids);
  const pc = p.postCoin;
  /* ★ THE NAMER'S GUESSES JOIN THE JUDGE'S NAMES (internal.name_guess, 0076): each of its top five
     names and tickers is searched in the mint stream and weighed as a name, the judge's first. None
     until the namer's switch is on (Policy.names.on); the re-tune may hand its own (`guesses`). */
  const guesses = opts.guesses ?? (await new PgNameGuessRepo(db).top(ids));
  const namesOf = (post: PostRow) => {
    const all = [post.proposed_name, ...(post.alternate_names ?? []), ...(guesses.get(post.item_id) ?? []).flatMap((g) => [g.name, g.ticker])];
    const seen = new Set<string>();
    return all.filter((n): n is string => {
      if (n === null || n.trim() === '') return false;
      const k = compactName(n);
      if (k === '' || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const timed = [...posts.values()].flatMap((post) => {
    const at = ms(post.posted_at) ?? ms(post.first_seen_at);
    return at === null ? [] : [{ post, at }];
  });

  /* Widen: addresses posted under the post, coins with its picture, the mint stream's names. */
  const replies = await new PgCryptoAttentionRepo(db).addressesFor(ids);
  const hashes = new PgImageHashRepo(db);
  const pictured = timed.flatMap(({ post, at }) => {
    const uri = pictureOf(post.media)?.uri ?? null;
    return uri === null ? [] : [{ itemId: post.item_id, uri, postedAt: at }];
  });
  const neighbours = await hashes.neighbours(pictured, p.origin.launchAllowanceMs, p.universe.matchWindowMs, pc.widenHashDistance, pc.pictureCandidatesPerPost, HASH_VERSION);
  const named = await nameCandidates(db, timed.map(({ post, at }) => ({ itemId: post.item_id, postedAt: at, names: namesOf(post), text: post.body })), p);
  const wide = new Map<string, Set<string>>([...lists].map(([id, xs]) => [id, new Set(xs)]));
  const add = (id: string, address: string) => wide.get(id)?.add(address);
  for (const [id, list] of replies) for (const a of list) add(id, a.address);
  for (const n of neighbours) add(n.itemId, n.address);
  for (const [id, xs] of named) for (const a of xs) add(id, a);

  const pairs = [...wide].flatMap(([itemId, addresses]) => [...addresses].map((address) => ({ itemId, address })));
  /* An address posted under a post that is no coin we hold has no row: it is dropped here. */
  const coins = (await loadCoins(db, pairs, p.group.image.space)).filter((c) => c.launched_at !== null || c.name !== null || c.ticker !== null);
  const pictureHashes = await hashes.hashesOf([...new Set([...pictured.map((x) => x.uri), ...coins.flatMap((c) => (c.image_uri === null ? [] : [c.image_uri]))])], HASH_VERSION);
  const byPost = new Map<string, CoinRow[]>();
  for (const c of coins) byPost.set(c.item_id, [...(byPost.get(c.item_id) ?? []), c]);

  /* The re-tune weighs with the weights it is testing (`ignoreFit`); the feed with the newest refit. */
  const bars = matchBars(p, opts.ignoreFit === true ? null : await loadFit(db));
  const matches = new Map<string, PostMatch>();
  for (const [itemId, rows] of byPost) {
    const post = posts.get(itemId);
    if (post === undefined) continue;
    const postPicture = pictureOf(post.media)?.uri ?? null;
    const postHash = postPicture === null ? undefined : pictureHashes.get(postPicture);
    const posted = replies.get(itemId);
    const sides: CoinSide[] = rows.map((r) => {
      const coinHash = r.image_uri === null ? undefined : pictureHashes.get(r.image_uri);
      const said = posted?.find((a) => a.address === r.address);
      return {
        address: r.address,
        name: r.name,
        ticker: r.ticker,
        launchedAt: ms(r.launched_at),
        links: r.outcome === 'read' ? [r.social_link, r.website, r.chat_link, r.description].filter((l): l is string => l !== null) : null,
        samePicture: postPictureVerdict(r.similarity === null ? null : Number(r.similarity), r.same_subject, p.group.image),
        pictureSimilarity: r.similarity === null ? null : Number(r.similarity),
        hashDistance: postHash === undefined || coinHash === undefined ? null : bitsApart(postHash, coinHash),
        description: r.outcome === 'read' ? r.description : null,
        addressByAuthor: posted === undefined ? null : (said?.byAuthor ?? false),
        addressByOthers: posted === undefined ? null : (said?.byOthers ?? 0),
        tradingJump: null,
      };
    });
    const decision = matchPostCoin(
      { postedAt: ms(post.posted_at) ?? ms(post.first_seen_at), linkIds: [post.source_item_id, ...pictureIds(post.media)], names: namesOf(post), author: post.handle, text: post.body },
      sides,
      bars,
    );
    const evidence = decision.kind === 'none'
      ? []
      : decision.ranked.map((e) => ({ address: e.address, linksPost: e.linksPost, samePicture: e.samePicture, launchedAfterMs: e.launchedAfterMs, posterPostedAddress: e.addressByAuthor }));
    matches.set(itemId, { decision, evidence });
  }
  return matches;
}

/**
 * Each post's name ideas: the namer's first `names.createIdeas` guesses (0076, brands dropped as
 * for the judge's), then the judge's newest names for it. A post the namer has not guessed (off,
 * not yet, or before 0076) gets the judge's names alone, as before.
 */
export async function loadNameIdeas(db: Db, itemIds: readonly string[], p: Policy = DEFAULT_POLICY): Promise<ReadonlyMap<string, readonly NameIdea[]>> {
  if (itemIds.length === 0) return new Map();
  const posts = await loadPosts(db, itemIds);
  const guessed = await new PgNameGuessRepo(db).top(itemIds);
  const bars = { minTicker: MIN_TICKER, maxTicker: MAX_TICKER, maxIdeas: MAX_NAME_IDEAS, lead: p.names.createIdeas };
  return new Map([...posts].map(([id, post]) => [id, guessesFirst((guessed.get(id) ?? []).filter((g) => !isBrand(g.name) && !isBrand(g.ticker)), postNameIdeas(post.proposed_name, post.alternate_names ?? []), bars)]));
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
