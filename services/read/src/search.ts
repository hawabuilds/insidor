/**
 * GET /search?q= — the Search tab. A person's term, searched at the moment they type it: our
 * own narratives and posts, our own chainwatch coins, and the market data sources' coins on the
 * launchpad. No new table; every answer is held in memory for a minute.
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
 * may then be opened as a token page for `openableMs`; nothing else widens the market route.
 */

import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import type { SearchPolicy } from '@insidor/contracts/policy.ts';
import { mergeHits } from '@insidor/core';
import type { MarketData } from '@insidor/market-geckoterminal';

import type { Logger } from './log.ts';
import type { Db, Row } from './queries.ts';

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

export const POST_SEARCH_SQL = `
select distinct on (payload ->> 'id') payload
  from public.rising_row
 where payload ->> 'excerpt' ilike $1 escape '\\'
 order by payload ->> 'id'
 limit $2`;

/* Chainwatch's own coins, from the name index (0037), which outlives each coin's full row: a coin
   deleted by the keep rule is still found here, and its picture is used only while the full row
   lasts. Exact ticker or exact name only — the index holds every launch ever, and a fuzzy match
   over it is not a list. */
export const ASSET_SEARCH_SQL = `
select n.address, n.ticker as symbol, n.name, a.image_uri, n.launched_at as minted_at
  from public.coin_name n
  left join public.asset a on a.chain = 'solana' and a.address = n.address
 where upper(n.ticker) = $1 or lower(n.name) = lower($3)
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

/* A coin's facts by address: its full row while it lasts, the name index after. */
export const ASSET_FACTS_SQL = `
select n.address, coalesce(a.symbol, n.ticker) as symbol, coalesce(a.name, n.name) as name, a.image_uri,
       coalesce(a.minted_at, n.launched_at) as minted_at
  from public.coin_name n
  left join public.asset a on a.chain = 'solana' and a.address = n.address
 where n.address = $1`;

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
  readonly now: () => number;
}

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

  async function run(term: string, now: number): Promise<SearchReply> {
    const p = deps.policy;
    const like = likePattern(term);
    const ticker = term.toUpperCase();

    const [storyRows, historyRows, postRows, assetRows, answers] = await Promise.all([
      deps.db.query(STORY_SEARCH_SQL, [like, ticker, LIVE_VIEW, p.storiesShown + 1]),
      deps.db.query(HISTORY_SEARCH_SQL, [like, ticker, p.storiesShown + 1]),
      deps.db.query(POST_SEARCH_SQL, [like, p.postsShown + 1]),
      deps.db.query(ASSET_SEARCH_SQL, [ticker, p.coinsShown, term]),
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

    /* ── posts: live from the feeds, historical from matching narratives' own evidence ── */
    const lower = term.toLowerCase();
    const live = postRows.map((r) => rec(r['payload']));
    const historical = stories.flatMap((s) => s.evidence).filter((e) => (str(e['excerpt']) ?? '').toLowerCase().includes(lower));
    const seen = new Set<string>();
    const posts = [...live.map((r) => ({ r, live: true })), ...historical.map((r) => ({ r, live: false }))].flatMap(({ r, live: isLive }) => {
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
    });

    /* ── coins ── */
    const failed = deps.sources.filter((_, i) => answers[i]?.status === 'rejected').map((s) => s.name);
    for (const [i, a] of answers.entries()) {
      if (a.status === 'rejected') deps.log.info('coin search source unavailable', { source: deps.sources[i]?.name, err: a.reason instanceof Error ? a.reason.message : String(a.reason) });
    }
    const read = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value] : []));
    const ours: CoinSearchHit[] = assetRows.flatMap((r) => {
      const address = str(r['address']);
      if (address === null) return [];
      const minted = r['minted_at'] instanceof Date ? r['minted_at'].getTime() : null;
      return [{ address, name: str(r['name']), ticker: str(r['symbol']), venue: 'curve' as const, marketAddress: null, createdAt: minted, marketCapUsd: null, imageUrl: str(r['image_uri']), source: 'chainwatch' }];
    });
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
      const term = normaliseTerm(rawTerm, deps.policy);
      if (term === null) return json(400, { error: 'bad request' });
      if (!allow(client, now)) return json(429, { error: 'slow down' });
      const key = term.toLowerCase();
      const held = kept.get(key);
      if (held !== undefined) return held.reply;
      const reply = await run(term, now);
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

    /** A coin a recent search returned, by address; null when none did. Widens the market route by exactly this. */
    recent(address: string): CoinSearchHit | null {
      const held = openable.get(address);
      return held !== undefined && deps.now() - held.at < deps.policy.openableMs ? held.hit : null;
    },

    /**
     * GET /coin/:assetKey — the facts a token page opened from search shows: what the search
     * said, or what chainwatch recorded (its full row, or the name index once that is gone).
     * Neither: a 404, never an invented coin.
     */
    async facts(assetKey: string): Promise<SearchReply | null> {
      const address = assetKey.startsWith('solana:') ? assetKey.slice('solana:'.length) : null;
      if (address === null) return null;
      const hit = this.recent(address);
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
