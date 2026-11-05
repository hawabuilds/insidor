/**
 * GET /search?q= — the Search tab. A person's term, searched at the moment they type it: our
 * own narratives and posts (every post ever on For You or in a narrative, at any age), our own
 * chainwatch coins, and the market data sources' coins on the launchpad. No new table; every
 * answer is held in memory for a minute.
 *
 * ★ SEARCH IS A LIST, NEVER A LINK. A coin in this reply is a coin with that name, and nothing
 * more. A coin is labelled as matched to a narrative only when the narrative's own page already
 * names it — the pipeline's confident match, read from the projection, never decided here. A
 * post found by search carries no narrative and no coin, so the screen has nothing to put a Buy
 * button on. Search hits never reach the coin universe from here: that is the background
 * lookup's job (runner/src/work/coin-lookup.ts), which puts them through the strict checks.
 *
 * ★ ONLY OBSERVED ROWS. A seeded narrative is a fiction and a fixture coin is a fiction; a
 * surface that says "this exists" filters to what was observed, as the product rule says.
 *
 * ★ AN OUTAGE IS NOT AN EMPTY LIST. Both sources down is `{ kind: 'unavailable' }`, shown as a
 * dash with a reason. One source down is still a list, with that source named as missing.
 *
 * ★ A PICTURE IS THE COIN'S OWN, NEVER A SOURCE'S COPY. A market source hosts its copy under its
 * own name, and a vendor's name reaching the screen is a leak the app's decoder refuses. The
 * picture is the one in the coin's metadata: ours when chainwatch read it, else the chain's.
 *
 * What breaks if changed carelessly: the per-client limit and the one-minute cache are what keep
 * two free sources answering. A term reaches a source at most once a minute however many people
 * type it, and one client cannot type faster than `perClient` a minute. A coin a search returned
 * may then be opened as a token page for `openableMs`; so may a coin a token page asked for by its
 * address that a market source lists (`open`, a held coin we never indexed), under its own limit;
 * an address pasted into Search that no search source lists goes through that same lookup and
 * limit (`addressIn`). Nothing else widens the market route.
 *
 * GET /post/:id/names and GET /ticker/:symbol/coins live here too (name-ideas.ts): the Create
 * sheet's name chips and whether each ticker is free, searched through the same cache and limit.
 * GET /post/:id/coins lives here too (same-name.ts): an unsure feed post's same-named coins, with
 * their market read by the same sources, the same per-client limit and the same pictures rule.
 * Its coins are ones we already hold by name, so it widens nothing; it only remembers what the
 * market said so a coin opened from the list shows the same facts as one opened from Search.
 */

import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import type { SearchPolicy } from '@insidor/contracts/policy.ts';
import { mergeHits } from '@insidor/core';
import { CURVE_DEX_IDS, type CoinQuote } from '@insidor/market-dexscreener';
import type { MarketData } from '@insidor/market-geckoterminal';

import type { Logger } from './log.ts';
import type { Db, Row } from './queries.ts';
import { freeFirst, ideasFrom, NAME_IDEAS_SQL, TICKER_COINS_SHOWN, TICKER_COINS_SQL, tickerAddresses, tickerUse } from './name-ideas.ts';
import { heldCoins, namesToSearch, SAME_NAME_SQL, withMarket } from './same-name.ts';

/** The board whose rows count as live (routes.ts BOARD_VIEW is the client's; the projector writes one). */
const LIVE_VIEW = 'default';

export const STORY_SEARCH_SQL = `
select s.story_id, s.payload, (b.story_id is not null) as live
  from public.story_view s
  left join public.board_row b on b.story_id = s.story_id and b.view_id = $3
 where s.payload #>> '{provenance,kind}' = 'observed'
   and (s.payload ->> 'title' ilike $1 escape '\\'
        or upper(s.payload #>> '{coins,coin,ticker}') = $2
        or exists (select 1
                     from jsonb_array_elements(case when jsonb_typeof(s.payload #> '{coins,coins}') = 'array'
                                                    then s.payload #> '{coins,coins}' else '[]'::jsonb end) c
                    where upper(c ->> 'ticker') = $2))
 order by live desc, s.story_id desc
 limit $4`;

/*
 * ★ A POST IS FOUND AT ANY AGE (the owner, 2026-10-24: "I still want them searchable regardless of
 * age"). Every post that was ever on For You (0075 public.feed_post) and every post a narrative
 * lists (0093 public.story_post), plus the frame showing now, by its words or by their English
 * (0081 public.post_translation), newest posted first. A post the owner called not a meme is
 * withdrawn from the scroll and is withdrawn from here too.
 *
 * The words are the post row's own `body`: the card's excerpt is cut at 280 characters, and on
 * 2026-10-24 no For You post matched a term in its excerpt that its body did not. The members are
 * picked from narrow columns and only the page's own cards are then read whole, so no card's JSON
 * is opened to be searched. A narrative's post with no For You card is shown as its narrative
 * lists it (the story's evidence row), the same fields a card carries.
 *
 * What breaks if changed carelessly: the cost. There is no text index: the members are a few
 * thousand (4,500 on 2026-10-24, growing a few hundred a day) and each is one primary-key read of
 * its post row, measured at 100–250 ms; a match over all of public.item (277,000 rows) would need
 * a trigram index, and so would this once the members reach tens of thousands. `live` is the frame
 * holding the post now.
 */
export const POST_SEARCH_SQL = `
with member as (
  select r.item_id from public.rising_row r
  union
  select f.item_id from public.feed_post f where f.feed_id = 'fyp' and f.withdrawn_at is null and f.payload is not null
  union
  select s.item_id from public.story_post s
    join public.story_view v on v.story_id = s.story_id and v.payload #>> '{provenance,kind}' = 'observed'
),
hit as (
  select m.item_id, coalesce(i.posted_at, i.first_seen_at) as at
    from member m
    join public.item i on i.item_id = m.item_id
    left join public.post_translation t on t.item_id = m.item_id
   where (i.body ilike $1 escape '\\' or t.text_en ilike $1 escape '\\')
     and not exists (select 1 from public.feed_post w where w.item_id = m.item_id and w.withdrawn_at is not null)
   order by at desc nulls last, m.item_id
   limit $2
)
select coalesce(
         (select r.payload - 'sheet' from public.rising_row r where r.item_id = h.item_id limit 1),
         (select f.payload - 'sheet' from public.feed_post f where f.feed_id = 'fyp' and f.item_id = h.item_id and f.payload is not null),
         (select e.value
            from public.story_post s
            join public.story_view v on v.story_id = s.story_id
            cross join lateral jsonb_array_elements(case when jsonb_typeof(v.payload -> 'evidence') = 'array' then v.payload -> 'evidence' else '[]'::jsonb end) e
           where s.item_id = h.item_id and e.value ->> 'evidenceId' = h.item_id
           limit 1)) as payload,
       exists (select 1 from public.rising_row r where r.item_id = h.item_id) as live
  from hit h
 order by h.at desc nulls last, h.item_id`;

/* Chainwatch's own coins, from the name index (0037), which outlives each coin's full row: a coin
   deleted by the keep rule is still found here, and its picture is used only while the full row
   lasts. Exact ticker or exact name only — the index holds every launch ever, and a fuzzy match
   over it is not a list. A ticker its creator wrote with the dollar sign ("$NANA": 310 of the
   42,000 launches on 2026-10-24) is that ticker: the person's dollar sign is stripped from the
   term, so without the second spelling a fresh launch named so was never found. */
export const ASSET_SEARCH_SQL = `
select n.address, n.ticker as symbol, n.name, a.image_uri, n.launched_at as minted_at
  from public.coin_name n
  left join public.asset a on a.chain = 'solana' and a.address = n.address
 where upper(n.ticker) in ($1, '$' || $1) or lower(n.name) = lower($3)
 order by n.launched_at desc nulls last
 limit $2`;

/* Past narratives (0038) by name, or by the ticker of one of their coins. */
export const HISTORY_SEARCH_SQL = `
select h.narrative_id, h.title, h.origin_post, h.origin_gap, h.first_coin_at, h.peak_market_cap_usd
  from public.history_narrative h
 where h.title ilike $1 escape '\\'
    or exists (select 1 from public.history_coin c join public.coin_name n on n.address = c.address
                where c.narrative_id = h.narrative_id and upper(n.ticker) = $2)
 order by h.peak_market_cap_usd desc nulls last
 limit $3`;

/* Which listed coins a past narrative names, and that narrative, so a coin shows where it came from. */
export const HISTORY_BY_COIN_SQL = `
select c.address, h.narrative_id, h.title, h.origin_post, h.origin_gap, h.first_coin_at, h.peak_market_cap_usd
  from public.history_coin c
  join public.history_narrative h on h.narrative_id = c.narrative_id
 where c.address = any($1)`;

/* The ticker check on Create: how many coins we have seen with this ticker (0037's name index). */
export const TICKER_COUNT_SQL = `select count(*)::int as n, min(launched_at) as first from public.coin_name where upper(ticker) = upper($1)`;

/* Pictures we already hold for coins a source listed: the metadata's own link, read by chainwatch. */
export const ASSET_IMAGES_SQL = `
select address, image_uri from public.asset where chain = 'solana' and address = any($1) and image_uri is not null`;

/* A coin's facts by address: its full row while it lasts, the name index after. Either one is
   enough, the same two the market route accepts (market.ts ASSET_SQL): a coin a post sheet or a
   narrative lists is always in one of them, and its page must open from any tap on it.
   ★ Its picture: the asset row's, else the one its launch metadata declares (0168 public.coin_picture,
   the owner 2026-11-05: $COGE showed a letter though its metadata names a picture). */
export const ASSET_FACTS_SQL = `
select q.address, coalesce(a.symbol, n.ticker) as symbol, coalesce(a.name, n.name) as name,
       coalesce(a.image_uri, (select p.image_uri from public.coin_picture p where p.asset_key = 'solana:' || q.address)) as image_uri,
       coalesce(a.minted_at, n.launched_at) as minted_at
  from (select $1::text as address) q
  left join public.coin_name n on n.address = q.address
  left join public.asset a on a.chain = 'solana' and a.address = q.address
 where n.address is not null or a.address is not null
 limit 1`;

export interface NamedSearch {
  readonly name: string;
  readonly source: CoinSearch;
}

export interface SearchDeps {
  readonly db: Db;
  readonly log: Logger;
  readonly policy: SearchPolicy;
  readonly sources: readonly NamedSearch[];
  /** A curve's progress from its account, 0..1. Null: no chain configured, progress is a dash. */
  readonly curveProgress: ((address: string) => Promise<number | null>) | null;
  /** Pictures from the chain's metadata, many coins a call. Null: a coin we do not hold has none. */
  readonly images: ((mints: readonly string[]) => Promise<ReadonlyMap<string, string>>) | null;
  /** Price history, for a matched narrative's peak. Null: the peak is a dash. */
  readonly market: Pick<MarketData, 'coin'> | null;
  /**
   * One coin by its address, from a market source: listed somewhere, with its own picture; null
   * when no source lists it. Throws on an outage. Absent: a coin we never indexed cannot be opened
   * by its address alone (see `open`).
   */
  readonly lookup?: ((address: string) => Promise<CoinSearchHit | null>) | null;
  readonly now: () => number;
}

/**
 * A coin looked up by its address, as a hit `open` remembers: what the pair source said of its
 * deepest pair. Its launch time only for a coin still on its curve, where the pair's creation IS
 * the launch; a pool's creation is not the coin's, so it is left unknown rather than misdated.
 * Null when the source does not list it.
 */
export function coinHitFromQuote(address: string, q: CoinQuote | undefined, imageUrl: string | null): CoinSearchHit | null {
  if (q === undefined) return null;
  const venue = q.pair?.dex != null && CURVE_DEX_IDS.has(q.pair.dex) ? 'curve' : 'pool';
  return {
    address,
    name: q.name,
    ticker: q.ticker,
    venue,
    marketAddress: q.pair?.address ?? null,
    createdAt: venue === 'curve' ? (q.pair?.createdAt ?? null) : null,
    marketCapUsd: q.marketCapUsd,
    imageUrl,
    source: 'lookup',
  };
}

/** A Solana address, as a token page's id carries it. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Coins opened by address alone, a minute, for everyone together: each is one market source call. */
export const OPENS_PER_MINUTE = 30;

export interface SearchReply {
  readonly status: number;
  readonly body: string;
}

type Measured = { readonly v: number } | { readonly v: null; readonly why: string };
type Instant = { readonly at: number } | { readonly at: null; readonly why: string };

const measured = (v: number | null | undefined, why: string): Measured => (v === null || v === undefined || !Number.isFinite(v) ? { v: null, why } : { v });
const instant = (at: number | null | undefined, why: string): Instant => (at === null || at === undefined || !Number.isFinite(at) ? { at: null, why } : { at });

const json = (status: number, value: unknown): SearchReply => ({ status, body: JSON.stringify(value) });

/** `%` and `_` typed by a person are characters, not wildcards. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * ★ A COIN IS FOUND BY ITS ADDRESS, PASTED BARE OR IN A LINK (the owner, 2026-10-24: "I want to be
 * able to search any pump.fun coin in search and buy"). A Solana address, with or without a
 * dollar sign, or a market page's link that names one — pump.fun/coin/<mint>, dexscreener.com/
 * solana/<pair> — gives that address; anything else is null and is searched as words. The last
 * address-shaped part of a link's path is taken, so a trailing tab or query does not hide it.
 *
 * An address is longer than `maxTermLength`, which is why it is read before the term is: that
 * limit is for words, and refusing an address was "bad request" for every pasted coin.
 */
export function addressIn(raw: string | null): string | null {
  if (raw === null) return null;
  const t = raw.trim().replace(/^\$+/, '');
  if (ADDRESS.test(t)) return t;
  if (t.length > MAX_LINK || /\s/.test(t)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  if (!url.hostname.includes('.')) return null;
  const parts = url.pathname.split('/').filter((x) => x !== '');
  for (let i = parts.length - 1; i >= 0; i--) if (ADDRESS.test(parts[i] ?? '')) return parts[i] ?? null;
  return null;
}

/** The longest link read for an address: a market page's link with its tracking tail. */
const MAX_LINK = 300;

/** "$jim " → "jim". A ticker is typed with or without its dollar sign. */
export function normaliseTerm(raw: string | null, policy: SearchPolicy): string | null {
  if (raw === null) return null;
  const term = raw.trim().replace(/^\$+/, '').replace(/\s+/g, ' ');
  if (term.length < policy.minTermLength || term.length > policy.maxTermLength) return null;
  return term;
}

interface StoryHit {
  readonly storyId: string;
  readonly title: string;
  readonly thumbUrl: string | null;
  readonly live: boolean;
  readonly settled: readonly { readonly address: string; readonly coinId: string; readonly mintedAt: number | null; readonly price: number | null; readonly cap: number | null }[];
  readonly coinsKind: string;
  readonly earliestPostAt: number | null;
  readonly evidence: readonly Row[];
}

const rec = (v: unknown): Row => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function storyHit(row: Row): StoryHit | null {
  const p = rec(row['payload']);
  const storyId = str(row['story_id']);
  const title = str(p['title']);
  if (storyId === null || title === null) return null;
  const coins = rec(p['coins']);
  const kind = str(coins['kind']) ?? 'none';
  const list = kind === 'one' ? [coins['coin']] : kind === 'several' ? arr(coins['coins']) : [];
  return {
    storyId,
    title,
    thumbUrl: str(p['thumbUrl']),
    live: row['live'] === true,
    coinsKind: kind,
    settled: list.flatMap((c) => {
      const coin = rec(c);
      const address = str(coin['address']);
      const coinId = str(coin['coinId']);
      if (address === null || coinId === null) return [];
      return [{ address, coinId, mintedAt: num(rec(coin['mintedAt'])['at']), price: num(rec(coin['priceUsd'])['v']), cap: num(rec(coin['marketCapUsd'])['v']) }];
    }),
    earliestPostAt: num(rec(p['earliestPost'])['at']),
    evidence: arr(p['evidence']).map(rec),
  };
}

/** A past narrative as the Search tab shows it: its timeline, with a typed reason for any gap. */
function pastNarrative(r: Row) {
  const post = r['origin_post'] === null || r['origin_post'] === undefined ? null : rec(r['origin_post']);
  const firstCoin = r['first_coin_at'] instanceof Date ? r['first_coin_at'].getTime() : null;
  return {
    storyId: null,
    narrativeId: str(r['narrative_id']),
    title: str(r['title']) ?? '',
    thumbUrl: null,
    live: false,
    firstPostAt: instant(post === null ? null : num(post['postedAt']), 'not_reported'),
    firstCoinAt: instant(firstCoin, 'not_reported'),
    peakMarketCapUsd: measured(typeof r['peak_market_cap_usd'] === 'number' ? r['peak_market_cap_usd'] : null, 'not_read_yet'),
    originPost: post === null ? null : {
      authorLabel: str(post['authorLabel']) ?? '',
      permalink: str(post['permalink']),
      postedAt: instant(num(post['postedAt']), 'not_reported'),
      afterLaunch: post['afterLaunch'] === true,
    },
    originGap: str(r['origin_gap']),
  };
}

/** Why there is no first coin: none was minted, or we have not finished looking. */
function firstCoinWhy(kind: string): string {
  return kind === 'none' ? 'not_minted' : 'not_read_yet';
}

export function createSearch(deps: SearchDeps) {
  const kept = new Map<string, { readonly at: number; readonly reply: SearchReply }>();
  const calls = new Map<string, number[]>();
  const openable = new Map<string, { readonly at: number; readonly hit: CoinSearchHit }>();
  /* What the sources said about a name, for `keepMs`: a sheet opened twice costs one search. */
  const named = new Map<string, { readonly at: number; readonly hits: readonly (readonly CoinSearchHit[])[]; readonly failed: number }>();
  /* Each post's list reply, for `keepMs`, like a search's. */
  const lists = new Map<string, { readonly at: number; readonly reply: SearchReply }>();
  /* What a lookup by address said, for `keepMs`: the coin, or null when nothing lists it. An outage is not kept. */
  const looked = new Map<string, { readonly at: number; readonly hit: CoinSearchHit | null }>();
  const opens: number[] = [];
  const opening = new Map<string, Promise<CoinSearchHit | null>>();

  /** True when this client may search now; records the search when it may. */
  function allow(client: string, now: number): boolean {
    const recent = (calls.get(client) ?? []).filter((t) => now - t < deps.policy.windowMs);
    if (recent.length >= deps.policy.perClient) {
      calls.set(client, recent);
      return false;
    }
    recent.push(now);
    calls.set(client, recent);
    return true;
  }

  function sweep(now: number): void {
    for (const [k, v] of kept) if (now - v.at >= deps.policy.keepMs) kept.delete(k);
    for (const [k, v] of openable) if (now - v.at >= deps.policy.openableMs) openable.delete(k);
    for (const [k, v] of calls) if (v.every((t) => now - t >= deps.policy.windowMs)) calls.delete(k);
    for (const [k, v] of named) if (now - v.at >= deps.policy.keepMs) named.delete(k);
    for (const [k, v] of lists) if (now - v.at >= deps.policy.keepMs) lists.delete(k);
    for (const [k, v] of looked) if (now - v.at >= deps.policy.keepMs) looked.delete(k);
  }

  /** A coin a recent search returned, by address; null when none did. */
  function recent(address: string): CoinSearchHit | null {
    const held = openable.get(address);
    return held !== undefined && deps.now() - held.at < deps.policy.openableMs ? held.hit : null;
  }

  /**
   * ★ A COIN SOMEONE HOLDS OPENS, EVEN ONE WE NEVER INDEXED (the owner, 2026-10-21: Laura, in
   * his Portfolio, would not open: our launch feed had missed it, so it was in neither the
   * universe nor the name index, and no search had listed it). When a token page asks for a coin
   * we hold no row of, it is looked up by its address on a market source, once; a coin the
   * source lists becomes openable exactly as a search hit does (`recent`), with what the source
   * said about it. Nothing is written: the read service holds no write credential, and adding a
   * coin to the universe stays the runner's lookup's job. An address typed or pasted into Search
   * that no search source lists is looked up the same way, under the same limit.
   *
   * Bounded so a page cannot be used to make us fetch arbitrary addresses: only a well-formed
   * address, each answer kept `keepMs` (listed or not), and at most `OPENS_PER_MINUTE` lookups a
   * minute for everyone. The coin as the source lists it, now openable; null when nothing lists it,
   * the source is down or the minute's lookups are spent.
   */
  async function lookUp(address: string): Promise<CoinSearchHit | null> {
    if (!ADDRESS.test(address) || deps.lookup === undefined || deps.lookup === null) return null;
    const now = deps.now();
    sweep(now);
    const held = looked.get(address);
    if (held !== undefined) return held.hit;
    /* The page asks for its facts and its chart at once: both wait on one lookup. */
    const running = opening.get(address);
    if (running !== undefined) return running;
    while (opens.length > 0 && now - (opens[0] ?? 0) >= deps.policy.windowMs) opens.shift();
    if (opens.length >= OPENS_PER_MINUTE) return null;
    opens.push(now);
    const lookup = deps.lookup;
    const job = (async () => {
      let hit: CoinSearchHit | null;
      try {
        hit = await lookup(address);
      } catch (e) {
        deps.log.info('coin lookup by address unavailable', { err: e instanceof Error ? e.message : String(e) });
        return null;
      }
      looked.set(address, { at: now, hit });
      if (hit !== null) openable.set(address, { at: now, hit });
      return hit;
    })().finally(() => opening.delete(address));
    opening.set(address, job);
    return job;
  }

  /** True when a token page may open this coin: a search returned it, or a lookup finds it listed. */
  async function openAddress(address: string): Promise<boolean> {
    if (!ADDRESS.test(address)) return false;
    return recent(address) !== null || (await lookUp(address)) !== null;
  }

  /** The sources' answers for a name: each source's hits, and how many sources failed. */
  async function searchName(term: string, now: number): Promise<{ readonly hits: readonly (readonly CoinSearchHit[])[]; readonly failed: number }> {
    const key = term.toLowerCase();
    const held = named.get(key);
    if (held !== undefined) return held;
    const answers = await Promise.allSettled(deps.sources.map((s) => s.source.search(term)));
    for (const [i, a] of answers.entries()) {
      if (a.status === 'rejected') deps.log.info('coin search source unavailable', { source: deps.sources[i]?.name, err: a.reason instanceof Error ? a.reason.message : String(a.reason) });
    }
    const out = {
      at: now,
      hits: answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value.hits] : [])),
      failed: answers.filter((a) => a.status === 'rejected').length,
    };
    named.set(key, out);
    return out;
  }

  async function sameName(itemId: string, now: number): Promise<SearchReply> {
    const held = heldCoins(await deps.db.query(SAME_NAME_SQL, [itemId]));
    if (held === null) return json(404, { error: 'not found' });

    const answers = await Promise.all(namesToSearch(held.coins).map((t) => searchName(t, now)));
    const mine = new Set(held.coins.map((c) => c.address));
    const listed = new Map<string, CoinSearchHit>();
    for (const h of mergeHits(answers.flatMap((a) => a.hits))) if (mine.has(h.address)) listed.set(h.address, h);
    const coins = withMarket(held.coins, listed);
    /* A source that failed on every name searched is missing; one that failed on some is too. */
    const sourcesMissing = answers.reduce((m, a) => Math.max(m, a.failed), 0);

    const curves = new Map<string, Measured>();
    if (deps.curveProgress !== null) {
      const reader = deps.curveProgress;
      const toRead = coins.flatMap(({ hit }) => (hit !== null && hit.venue === 'curve' && hit.marketAddress !== null ? [hit] : [])).slice(0, deps.policy.curvesRead);
      await Promise.all(toRead.map(async (h) => {
        try {
          curves.set(h.address, measured(await reader(h.marketAddress ?? ''), 'unreadable'));
        } catch {
          curves.set(h.address, measured(null, 'not_read_yet'));
        }
      }));
    }

    const pictures = new Map<string, string>(held.coins.flatMap((c) => (c.imageUrl === null ? [] : [[c.address, c.imageUrl] as const])));
    const missing = held.coins.filter((c) => c.imageUrl === null).map((c) => c.address);
    if (deps.images !== null && missing.length > 0) {
      try {
        for (const [a, i] of await deps.images(missing)) pictures.set(a, i);
      } catch (e) {
        deps.log.info('coin pictures unavailable', { err: e instanceof Error ? e.message : String(e) });
      }
    }

    const items = coins.map(({ held: c, hit }) => {
      const launched = c.launchedAt ?? hit?.createdAt ?? null;
      const imageUrl = pictures.get(c.address) ?? null;
      /* Remembered as Search remembers its hits, so the coin's page shows these same facts. A
         coin no source listed is not: its page reads what we hold of it, as from Search. */
      if (hit !== null) openable.set(c.address, { at: now, hit: { ...hit, name: c.name ?? hit.name, ticker: c.ticker ?? hit.ticker, createdAt: launched, imageUrl } });
      return {
        coinId: `solana:${c.address}`,
        address: c.address,
        name: c.name ?? hit?.name ?? null,
        ticker: c.ticker ?? hit?.ticker ?? null,
        imageUrl,
        /* Unlisted while a source was down is "not read", never "no market". */
        marketCapUsd: measured(hit?.marketCapUsd, hit !== null ? 'not_reported' : sourcesMissing > 0 ? 'not_read_yet' : 'no_market'),
        launchedAt: instant(launched, 'not_reported'),
        /* A coin no source listed has no market anyone reports: where it trades is not known. */
        venue: hit === null ? null : hit.venue,
        curveProgress: hit !== null && hit.venue === 'curve' ? (curves.get(c.address) ?? measured(null, deps.curveProgress === null ? 'not_reported' : 'not_read_yet')) : null,
        matched: null,
        evidence: c.evidence,
      };
    });
    return json(200, { kind: 'read', more: held.more, sourcesMissing, items });
  }

  async function peakOf(story: StoryHit): Promise<Measured> {
    const coin = story.settled[0];
    if (deps.market === null || coin === undefined) return measured(null, story.settled.length === 0 ? firstCoinWhy(story.coinsKind) : 'not_reported');
    /* Market cap is price times supply; the supply is read off the coin's own two numbers. */
    if (coin.price === null || coin.cap === null || coin.price <= 0) return measured(null, 'not_reported');
    try {
      const m = await deps.market.coin(coin.address, '6h');
      if (m.candles === null) return measured(null, 'unreadable');
      const high = Math.max(...m.candles.map((c) => c.h ?? 0));
      return measured(high > 0 ? high * (coin.cap / coin.price) : null, 'no_market');
    } catch (e) {
      deps.log.info('peak unavailable', { err: e instanceof Error ? e.message : String(e) });
      return measured(null, 'not_read_yet');
    }
  }

  /**
   * One search. `address` set: the term is that coin's address (or a market page's pair address),
   * and the reply is that one coin and the posts that quote it — no narrative is named by an
   * address, and a source's fuzzy neighbours are not the coin.
   */
  async function run(term: string, now: number, address: string | null): Promise<SearchReply> {
    const p = deps.policy;
    const like = likePattern(term);
    const ticker = term.toUpperCase();
    const none = Promise.resolve<readonly Row[]>([]);

    const [storyRows, historyRows, postRows, assetRows, answers] = await Promise.all([
      address !== null ? none : deps.db.query(STORY_SEARCH_SQL, [like, ticker, LIVE_VIEW, p.storiesShown + 1]),
      address !== null ? none : deps.db.query(HISTORY_SEARCH_SQL, [like, ticker, p.storiesShown + 1]),
      deps.db.query(POST_SEARCH_SQL, [like, p.postsShown + 1]),
      address !== null ? deps.db.query(ASSET_FACTS_SQL, [address]) : deps.db.query(ASSET_SEARCH_SQL, [ticker, p.coinsShown, term]),
      Promise.allSettled(deps.sources.map((s) => s.source.search(term))),
    ]);

    /* ── narratives ── */
    const stories = storyRows.map(storyHit).filter((s): s is StoryHit => s !== null);
    const shownStories = stories.slice(0, p.storiesShown);
    const peakFor = shownStories.find((s) => !s.live && s.settled.length > 0) ?? null;
    const peak = peakFor === null ? null : await peakOf(peakFor);
    const narratives = shownStories.map((s) => {
      const firstCoin = s.settled.reduce<number | null>((m, c) => (c.mintedAt === null ? m : m === null ? c.mintedAt : Math.min(m, c.mintedAt)), null);
      return {
        storyId: s.storyId,
        title: s.title,
        thumbUrl: s.thumbUrl,
        live: s.live,
        firstPostAt: instant(s.earliestPostAt, 'not_read_yet'),
        firstCoinAt: instant(firstCoin, s.settled.length === 0 ? firstCoinWhy(s.coinsKind) : 'not_reported'),
        peakMarketCapUsd: s === peakFor && peak !== null ? peak : measured(null, s.settled.length === 0 ? firstCoinWhy(s.coinsKind) : 'not_read_yet'),
        originPost: null,
        originGap: null,
      };
    });

    /* ── posts: every post ever on For You or in a narrative, then matching narratives' own evidence ── */
    const lower = term.toLowerCase();
    const found = postRows.map((r) => ({ r: rec(r['payload']), live: r['live'] === true }));
    const historical = stories.flatMap((s) => s.evidence).filter((e) => (str(e['excerpt']) ?? '').toLowerCase().includes(lower));
    const seen = new Set<string>();
    const posts = [...found, ...historical.map((r) => ({ r, live: false }))].flatMap(({ r, live: isLive }) => {
      const key = str(r['permalink']) ?? str(r['id']) ?? str(r['evidenceId']);
      const excerpt = str(r['excerpt']);
      const authorLabel = str(r['authorLabel']);
      if (key === null || excerpt === null || authorLabel === null || seen.has(key)) return [];
      seen.add(key);
      /* Deliberately NOT carried: the post's narrative and its coin. Search is a list. */
      return [{
        id: key,
        sourceLabel: str(r['sourceLabel']) ?? '',
        authorLabel,
        permalink: str(r['permalink']),
        excerpt,
        thumbUrl: str(r['thumbUrl']),
        postedAt: rec(r['postedAt'])['at'] === undefined ? instant(null, 'not_reported') : (r['postedAt'] as Instant),
        live: isLive,
      }];
    }).sort((a, b) => (b.postedAt.at ?? 0) - (a.postedAt.at ?? 0)); // newest posted first; an unknown time last

    /* ── coins ── */
    const failed = deps.sources.filter((_, i) => answers[i]?.status === 'rejected').map((s) => s.name);
    for (const [i, a] of answers.entries()) {
      if (a.status === 'rejected') deps.log.info('coin search source unavailable', { source: deps.sources[i]?.name, err: a.reason instanceof Error ? a.reason.message : String(a.reason) });
    }
    let read: { readonly hits: readonly CoinSearchHit[]; readonly capped: boolean }[] = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value] : []));
    const ours: CoinSearchHit[] = assetRows.flatMap((r) => {
      const a = str(r['address']);
      if (a === null) return [];
      const minted = r['minted_at'] instanceof Date ? r['minted_at'].getTime() : null;
      return [{ address: a, name: str(r['name']), ticker: str(r['symbol']), venue: 'curve' as const, marketAddress: null, createdAt: minted, marketCapUsd: null, imageUrl: str(r['image_uri']), source: 'chainwatch' }];
    });
    if (address !== null) {
      /* The coin itself, or the coin whose pair this is (a market page's link names the pair). */
      read = read.map((r) => ({ capped: false, hits: r.hits.filter((h) => h.address === address || h.marketAddress === address) }));
      /* No search source lists it: the token page's own lookup by address, under its own limit. */
      if (!read.some((r) => r.hits.length > 0)) {
        const found = await lookUp(address);
        if (found !== null) read = [...read, { hits: [found], capped: false }];
      }
    }
    const listed = new Set(read.flatMap((r) => r.hits.map((h) => h.address)));
    const merged = mergeHits([...read.map((r) => r.hits), ours]);
    const matched = new Map<string, { storyId: string | null; title: string }>(shownStories.flatMap((s) => s.settled.map((c) => [c.address, { storyId: s.storyId, title: s.title }] as const)));
    const ranked = [...merged].sort((a, b) => (b.marketCapUsd ?? -1) - (a.marketCapUsd ?? -1)).slice(0, p.coinsShown);

    /* A listed coin a past narrative names shows that narrative too, even when the term did not
       match the narrative's own name: today's market cap and where it came from, together. */
    const past = new Map<string, ReturnType<typeof pastNarrative>>();
    for (const r of historyRows) {
      const n = pastNarrative(r);
      if (n.narrativeId !== null) past.set(n.narrativeId, n);
    }
    if (ranked.length > 0) {
      for (const r of await deps.db.query(HISTORY_BY_COIN_SQL, [ranked.map((h) => h.address)])) {
        const n = pastNarrative(r);
        const a = str(r['address']);
        if (n.narrativeId === null || a === null) continue;
        if (!past.has(n.narrativeId)) past.set(n.narrativeId, n);
        if (!matched.has(a)) matched.set(a, { storyId: null, title: n.title });
      }
    }
    const pastShown = [...past.values()].slice(0, Math.max(0, p.storiesShown - narratives.length));

    const curves = new Map<string, Measured>();
    if (deps.curveProgress !== null) {
      const reader = deps.curveProgress;
      const toRead = ranked.filter((h) => h.venue === 'curve' && h.marketAddress !== null && listed.has(h.address)).slice(0, p.curvesRead);
      await Promise.all(toRead.map(async (h) => {
        try {
          curves.set(h.address, measured(await reader(h.marketAddress ?? ''), 'unreadable'));
        } catch {
          curves.set(h.address, measured(null, 'not_read_yet'));
        }
      }));
    }

    const pictures = new Map<string, string>();
    const listedRanked = ranked.filter((h) => listed.has(h.address)).map((h) => h.address);
    if (listedRanked.length > 0) {
      for (const r of await deps.db.query(ASSET_IMAGES_SQL, [listedRanked])) {
        const a = str(r['address']);
        const i = str(r['image_uri']);
        if (a !== null && i !== null) pictures.set(a, i);
      }
      const missing = listedRanked.filter((a) => !pictures.has(a));
      if (deps.images !== null && missing.length > 0) {
        try {
          for (const [a, i] of await deps.images(missing)) pictures.set(a, i);
        } catch (e) {
          deps.log.info('coin pictures unavailable', { err: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    const pictured = ranked.map((h) => ({ ...h, imageUrl: listed.has(h.address) ? (pictures.get(h.address) ?? null) : h.imageUrl }));
    for (const h of pictured) openable.set(h.address, { at: now, hit: h });

    const coins = read.length === 0 && ours.length === 0 && deps.sources.length > 0
      ? { kind: 'unavailable' as const }
      : {
          kind: 'read' as const,
          capped: read.some((r) => r.capped) || merged.length > p.coinsShown,
          sourcesMissing: failed.length,
          items: pictured.map((h) => {
            const isListed = listed.has(h.address);
            return {
              coinId: `solana:${h.address}`,
              address: h.address,
              name: h.name,
              ticker: h.ticker,
              imageUrl: h.imageUrl,
              marketCapUsd: measured(h.marketCapUsd, isListed ? 'not_reported' : 'no_market'),
              launchedAt: instant(h.createdAt, 'not_reported'),
              /* A coin only we hold has no market anyone lists: where it trades is not known. */
              venue: isListed ? h.venue : null,
              curveProgress: isListed && h.venue === 'curve' ? (curves.get(h.address) ?? measured(null, deps.curveProgress === null ? 'not_reported' : 'not_read_yet')) : null,
              matched: matched.get(h.address) ?? null,
            };
          }),
        };

    return json(200, {
      term,
      narratives: { capped: stories.length > p.storiesShown || narratives.length + past.size > p.storiesShown, items: [...narratives, ...pastShown] },
      posts: { capped: postRows.length > p.postsShown || posts.length > p.postsShown, items: posts.slice(0, p.postsShown) },
      coins,
    });
  }

  return {
    /** The whole route. `client` is who is asking, for the per-client limit. */
    async search(rawTerm: string | null, client: string): Promise<SearchReply> {
      const now = deps.now();
      sweep(now);
      const address = addressIn(rawTerm);
      const term = address ?? normaliseTerm(rawTerm, deps.policy);
      if (term === null) return json(400, { error: 'bad request' });
      if (!allow(client, now)) return json(429, { error: 'slow down' });
      /* An address is case-sensitive: two that differ only in case are two coins. */
      const key = address !== null ? `address:${address}` : term.toLowerCase();
      const held = kept.get(key);
      if (held !== undefined) return held.reply;
      const reply = await run(term, now, address);
      kept.set(key, { at: now, reply });
      return reply;
    },

    /**
     * GET /ticker/:symbol — how many coins Insidor has seen use this ticker. Only what we have seen:
     * the screen says "among the coins Insidor has seen", never "nobody has".
     */
    async ticker(raw: string, client: string): Promise<SearchReply> {
      const symbol = raw.trim().replace(/^\$+/, '');
      if (symbol === '' || symbol.length > 10) return json(400, { error: 'bad request' });
      if (!allow(client, deps.now())) return json(429, { error: 'slow down' });
      const rows = await deps.db.query(TICKER_COUNT_SQL, [symbol]);
      return json(200, { ticker: symbol, seen: Number(rows[0]?.['n'] ?? 0) });
    },

    /** GET /post/:id/coins — an unsure feed post's same-named coins (same-name.ts). 404 when it is not unsure on a feed. */
    async postCoins(itemId: string, client: string): Promise<SearchReply> {
      const now = deps.now();
      sweep(now);
      if (itemId === '' || itemId.length > 200) return json(400, { error: 'bad request' });
      const kept = lists.get(itemId);
      if (kept !== undefined) return kept.reply;
      if (!allow(client, now)) return json(429, { error: 'slow down' });
      const reply = await sameName(itemId, now);
      if (reply.status === 200) lists.set(itemId, { at: now, reply });
      return reply;
    },

    /** GET /post/:id/names — a feed post's name ideas for Create, each with whether its ticker is free (name-ideas.ts). */
    async postNames(itemId: string, client: string): Promise<SearchReply> {
      const now = deps.now();
      sweep(now);
      if (itemId === '' || itemId.length > 200) return json(400, { error: 'bad request' });
      const key = `names:${itemId}`;
      const held = lists.get(key);
      if (held !== undefined) return held.reply;
      if (!allow(client, now)) return json(429, { error: 'slow down' });
      const ideas = ideasFrom(await deps.db.query(NAME_IDEAS_SQL, [itemId]));
      if (ideas.length === 0) return json(404, { error: 'not found' });
      const items = await Promise.all(
        ideas.map(async (idea) => {
          const [indexed, answer] = await Promise.all([deps.db.query(TICKER_COINS_SQL, [idea.ticker, TICKER_COINS_SHOWN + 1]), searchName(idea.ticker, now)]);
          const addresses = tickerAddresses(idea.ticker, indexed.flatMap((r) => str(r['address']) ?? []), answer.hits.flat());
          return { ...idea, use: tickerUse(addresses, answer.failed, indexed.length > TICKER_COINS_SHOWN) };
        }),
      );
      const reply = json(200, { items: freeFirst(items) });
      lists.set(key, { at: now, reply });
      return reply;
    },

    /** GET /ticker/:symbol/coins — the coins using exactly this ticker: what "Taken by 3 coins" opens. */
    async tickerCoins(raw: string, client: string): Promise<SearchReply> {
      const now = deps.now();
      sweep(now);
      const symbol = raw.trim().replace(/^\$+/, '').toUpperCase();
      if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return json(400, { error: 'bad request' });
      const key = `ticker-coins:${symbol}`;
      const held = lists.get(key);
      if (held !== undefined) return held.reply;
      if (!allow(client, now)) return json(429, { error: 'slow down' });
      const [indexed, answer] = await Promise.all([deps.db.query(TICKER_COINS_SQL, [symbol, TICKER_COINS_SHOWN + 1]), searchName(symbol, now)]);
      const hits = new Map(mergeHits(answer.hits).filter((h) => (h.ticker ?? '').toUpperCase() === symbol).map((h) => [h.address, h] as const));
      const ours = new Map(indexed.flatMap((r) => {
        const a = str(r['address']);
        const minted = r['minted_at'] instanceof Date ? r['minted_at'].getTime() : null;
        return a === null ? [] : [[a, { name: str(r['name']), ticker: str(r['symbol']), imageUrl: str(r['image_uri']), launchedAt: minted }] as const];
      }));
      const addresses = [...new Set([...ours.keys(), ...hits.keys()])];
      const items = addresses
        .map((address) => {
          const o = ours.get(address);
          const hit = hits.get(address) ?? null;
          const launched = o?.launchedAt ?? hit?.createdAt ?? null;
          if (hit !== null) openable.set(address, { at: now, hit: { ...hit, createdAt: launched, imageUrl: o?.imageUrl ?? null } });
          return {
            coinId: `solana:${address}`,
            address,
            name: o?.name ?? hit?.name ?? null,
            ticker: o?.ticker ?? hit?.ticker ?? null,
            /* The coin's own picture, never a source's copy (the header's rule). */
            imageUrl: o?.imageUrl ?? null,
            marketCapUsd: measured(hit?.marketCapUsd, hit !== null ? 'not_reported' : answer.failed > 0 ? 'not_read_yet' : 'no_market'),
            launchedAt: instant(launched, 'not_reported'),
            venue: hit === null ? null : hit.venue,
            curveProgress: null,
            matched: null,
          };
        })
        .sort((a, b) => (b.launchedAt.at ?? 0) - (a.launchedAt.at ?? 0))
        .slice(0, TICKER_COINS_SHOWN);
      const reply = json(200, { kind: 'read', more: addresses.length > TICKER_COINS_SHOWN || indexed.length > TICKER_COINS_SHOWN, sourcesMissing: answer.failed, items });
      lists.set(key, { at: now, reply });
      return reply;
    },

    /** A coin a recent search returned, by address; null when none did. Widens the market route by exactly this. */
    recent,

    /** A token page's coin we hold no row of, looked up by its address (`openAddress`). True when it may now be opened. */
    async open(assetKey: string): Promise<boolean> {
      const address = assetKey.startsWith('solana:') ? assetKey.slice('solana:'.length) : null;
      return address !== null && openAddress(address);
    },

    /**
     * GET /coin/:assetKey — the facts a token page opened from search shows: what the search
     * said, or what chainwatch recorded (its full row, or the name index once that is gone).
     * Neither: a 404, never an invented coin.
     */
    async facts(assetKey: string): Promise<SearchReply | null> {
      const address = assetKey.startsWith('solana:') ? assetKey.slice('solana:'.length) : null;
      if (address === null) return null;
      const hit = recent(address);
      if (hit !== null) {
        return json(200, {
          coinId: assetKey, address, name: hit.name, ticker: hit.ticker, imageUrl: hit.imageUrl,
          marketCapUsd: measured(hit.marketCapUsd, 'not_reported'),
          launchedAt: instant(hit.createdAt, 'not_reported'),
          venue: hit.source === 'chainwatch' ? null : hit.venue,
        });
      }
      const rows = await deps.db.query(ASSET_FACTS_SQL, [address]);
      const r = rows[0];
      if (r === undefined) return null;
      return json(200, {
        coinId: assetKey, address, name: str(r['name']), ticker: str(r['symbol']), imageUrl: str(r['image_uri']),
        marketCapUsd: measured(null, 'not_read_yet'),
        launchedAt: instant(r['minted_at'] instanceof Date ? r['minted_at'].getTime() : null, 'not_reported'),
        venue: null,
      });
    },
  };
}

export type Search = ReturnType<typeof createSearch>;
