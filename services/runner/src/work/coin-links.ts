/**
 * COINS POINTING TO POSTS, WITHIN SECONDS OF A LAUNCH: a new coin's metadata document read at
 * once, every post it names recorded as the coin's (internal.coin_post_link, 0083), and a named
 * post we do not hold read by id and stored.
 *
 * Its own step on a five-second loop (loops/coin-links.ts) rather than a part of the universe
 * loop, which reads metadata a minute at a time and took a median three minutes after a launch
 * (p90 19 hours, behind its retries) on 2026-10-15. The universe loop still reads every coin this
 * step does not reach; a coin read here has its metadata row, so the universe loop goes straight
 * to its origin check.
 *
 * ★ WHICHEVER STEP READS THE DOCUMENT FIRST, THE COIN GETS ITS LINKS (2026-10-25). This step takes
 * only coins with no metadata row, so a coin the universe loop read first — it got there before this
 * step, or this step's own read failed and the universe loop's retry succeeded — was never linked:
 * "Nuggets" named a promotion of a viral post and was never priced or shown on it; 878 coins naming
 * an X post in the three days to 25 Oct (1.6%), about half of them retries. The universe loop now
 * hands every document it reads to this step (work/coin-link-hand-off.ts, in process: both loops are
 * one runner), and the next pass treats it exactly as one read here — links, the promotion followed,
 * the credit — from the fields as read, never fetching the document again. A hand-off rather than a
 * second query: "metadata read lately, no link row" costs 85-900 ms over 430,000 metadata rows every
 * five seconds, and as most coins name no post it would pick the same coins each pass unless a
 * migration marked them checked. A handed coin is taken once; the universe loop re-reads only a
 * failed document, at most `metadataAttempts` times, so no post read is spent over and over. What is
 * lost: a coin handed in the minute before a restart, or not taken within `lookbackMs` (counted and
 * logged).
 *
 * ★ FOR LEARNING FIRST, FEED SECOND (the owner, 2026-10-15). The link record is what the lead-time
 * report and the learned words read: it is written for every link, whatever the post's age. A post
 * is credited to the `coin_link` lane — which only queues it for the judge, never shows it — when it
 * was under `creditMaxAgeMs` old at the launch, and a post of a source with a catch-all search only
 * at `textMinApprovals` approvals — or `textMinReach` views: most coins name a text post nobody saw,
 * but a post already past For You's views bar when a coin names it is one people saw. @TocRadio
 * (23 Oct, 84.5k views, 950 likes) was stored by a coin's link 98 minutes after it was posted, under
 * the approvals bar, and so never became a For You candidate whatever the judge said; it was the
 * origin of a coin that ran to millions. The judge and the hold then decide, as for any post; a coin
 * naming a post does not make it a meme.
 *
 * ★ THE VIRAL POST, NOT THE PROMOTION (the owner, 2026-10-24: "just bring in the viral post and link
 * the coin rather than the promotion post"). The post a coin names is often its launcher's promotion
 * ("$X is live…") quoting the viral post, re-sharing it or linking it by URL: 8,087 of the 21,740
 * posts coins named over 21-24 Oct. Once the named post is held, the post it points at (core
 * match/coin-origin.ts `promoPointsAt`, one hop: re-share, quote, then its first link) is read by id
 * if we do not hold it — the same priced read, at most `readsPerPass` more, and only while its id's
 * own time says it is young enough to be credited or tied — and, when it is another account's and at
 * least as widely seen (`promoFollows`), the link is recorded coin → original with the promotion as
 * its `via` (0132), and the ORIGINAL is credited under the same age, approvals and reach rules, on its
 * own numbers. The promotion gets no link row and no credit then: every reader of the links takes a
 * row as the coin's post. A promotion that points at nothing, or at a post we cannot read or do not
 * follow, is recorded and credited as it always was. Before 0132 nothing is followed.
 *
 * ★ THE FIRST COIN IS THE POST'S. Copycats link the same viral post; core's post-coin rule proves
 * the earliest-launched one, and the project service finds them all through this table.
 *
 * What breaks if changed carelessly: reading a post is the only paid step here, priced first and
 * checked against its supplier line on the live meter; a dry run records links and reads nothing.
 * Reading every named text post (5,000 a day) would be cheap to read and dear to judge, which is
 * why the credit, not the read, carries the approvals bar. Every pass that had a coin to read logs
 * one line (coins, read, links, posts read): a pass that found nothing once said nothing, and 18
 * hours of no links (the stream down, every coin polled) looked the same as a quiet market.
 */

import type { Author, Item, ItemId, Millis } from '@insidor/contracts';
import { promoFollows, promoPointsAt } from '@insidor/core';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { CoinPostLink, FreshCoin, PgCoinUniverseRepo, PgFinderRepo, PgItemRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { CoinLinkHandOff, HandedCoin } from './coin-link-hand-off.ts';
import { readCoinMetadata, type DeclaredReader, type MetadataReader, type ReadMetadata } from './universe.ts';

/** A link in a document's text: http(s) up to whitespace or a closing quote or bracket. */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>)\]]+/gi;
/* A bare host path people paste without the scheme. */
const BARE_LINK = /(?<![/\w.@])((?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s"'<>)\]]+)/gi;
const CALL_DEADLINE_MS = 60_000;

export interface FollowedLink {
  /** The URL a shortened link leads to; the same URL when it is not a short link; null when it led nowhere. Throws on a failed request. */
  (url: string): Promise<string | null>;
}

export interface CoinLinkDeps {
  readonly finders: Pick<PgFinderRepo, 'freshUnread' | 'recordLinks' | 'keepsVia' | 'promoFacts'>;
  readonly coins: Pick<PgCoinUniverseRepo, 'recordMetadata'>;
  readonly metadata: MetadataReader;
  readonly declared?: DeclaredReader;
  /** The coins the universe loop read first (the header's hand-off). Absent: only coins with no metadata row. */
  readonly handOff?: CoinLinkHandOff;
  /** The sources, built on the live meter with `handles` answering a post addressed by URL. */
  readonly sources: (handles: (source: string, sourceItemId: string) => string | null) => readonly PlatformAdapter[];
  /** A source's own short-link form expanded (a short video's share link); identity for any other URL. */
  readonly follow: FollowedLink;
  readonly items: Pick<PgItemRepo, 'byIds' | 'markFoundBy'>;
  readonly store: (items: readonly Item[], authors: readonly Author[]) => Promise<number>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface CoinLinkResult {
  readonly coins: number;
  readonly read: number;
  /** Coins another step read first, taken from the hand-off with the fields it read. */
  readonly handed: number;
  readonly links: number;
  readonly postsRead: number;
  readonly credited: number;
  /** Named posts taken through to the post they quote, re-share or link (the header's promotion rule). */
  readonly followed: number;
  readonly usd: number;
  /** Seconds from each linking coin's launch to its link being recorded: what "within seconds" measures. */
  readonly secondsAfterLaunch: readonly number[];
}

const EMPTY: CoinLinkResult = { coins: 0, read: 0, handed: 0, links: 0, postsRead: 0, credited: 0, followed: 0, usd: 0, secondsAfterLaunch: [] };

/** Every URL in a metadata document's links and description, scheme added where it was left off. */
export function urlsIn(m: Pick<ReadMetadata, 'description' | 'links'>): readonly string[] {
  const out = new Set<string>();
  for (const text of [m.links.social, m.links.website, m.links.chat, m.description]) {
    if (text === null || text.trim() === '') continue;
    for (const hit of text.match(URL_IN_TEXT) ?? []) out.add(hit.replace(/[.,;:!?]+$/, ''));
    const schemeless = text.replace(URL_IN_TEXT, ' ');
    for (const hit of schemeless.match(BARE_LINK) ?? []) out.add(`https://${hit.replace(/[.,;:!?]+$/, '')}`);
  }
  return [...out];
}

/** The posts a set of URLs names, through each source's own link parser. */
export async function postsNamed(
  urls: readonly string[],
  sources: readonly PlatformAdapter[],
  follow: FollowedLink,
): Promise<readonly { readonly adapter: PlatformAdapter; readonly sourceItemId: string; readonly handle: string | null; readonly url: string }[]> {
  const out = new Map<string, { adapter: PlatformAdapter; sourceItemId: string; handle: string | null; url: string }>();
  for (const raw of urls) {
    let url: string | null;
    try {
      url = await follow(raw);
    } catch {
      continue;
    }
    if (url === null) continue;
    for (const adapter of sources) {
      const link = adapter.parseLink?.(url) ?? null;
      if (link?.kind !== 'post') continue;
      const key = `${adapter.id}:${link.sourceItemId}`;
      if (!out.has(key)) out.set(key, { adapter, sourceItemId: link.sourceItemId, handle: link.handle ?? null, url });
      break;
    }
  }
  return [...out.values()];
}

/** Whether a post found through a coin is queued for the judge (the header's credit rule). */
export function creditable(item: Item, adapter: PlatformAdapter, launchedAt: Millis | null, policy: Policy): boolean {
  const c = policy.finders.coinLinks;
  if (item.postedAt === null || launchedAt === null || launchedAt - item.postedAt > c.creditMaxAgeMs) return false;
  if (!adapter.capabilities.discovery.includes('catchall')) return true;
  return (item.counters.approval?.value ?? 0) >= c.textMinApprovals || (item.counters.reach?.value ?? 0) >= c.textMinReach;
}

/**
 * The posts we hold of `wanted`, and up to `limit` of the rest read by id and stored: priced first,
 * checked against the source's line, skipped on a dry run. A read that fails leaves its posts
 * unread; the caller's record of them stands. Shared with the reposts finder. The posts of
 * `reread` are read even when held (the coin-first route reads a post again for its links).
 */
export async function readMissing(
  deps: Pick<CoinLinkDeps, 'items' | 'store' | 'meter' | 'mode' | 'log' | 'now'>,
  wanted: ReadonlyMap<string, { readonly adapter: PlatformAdapter; readonly sourceItemId: string }>,
  limit: number,
  what: string,
  reread: ReadonlySet<string> = new Set(),
): Promise<{ readonly items: Map<string, Item>; readonly usd: number; readonly postsRead: number }> {
  const held = await deps.items.byIds([...wanted.keys()].map((k) => k as ItemId));
  const items = new Map<string, Item>([...held].map(([k, v]) => [String(k), v]));
  let usd = 0;
  let postsRead = 0;
  const missing = [...wanted.entries()].filter(([k]) => !items.has(k) || reread.has(k)).slice(0, limit);
  const bySource = new Map<PlatformAdapter, string[]>();
  for (const [, p] of missing) bySource.set(p.adapter, [...(bySource.get(p.adapter) ?? []), p.sourceItemId]);
  for (const [adapter, list] of bySource) {
    if (adapter.lookup === undefined) continue;
    const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: list });
    const where = { source: String(adapter.id), posts: list.length };
    if (deps.mode === 'dry') {
      deps.log.info(`DRY RUN — ${what} priced, not read`, { ...where, wouldSpendUsd: estimate.usd });
      continue;
    }
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.info(`${what} wait: the line is spent for today`, where);
      continue;
    }
    try {
      const line = deps.meter.line(estimate.vendor);
      const result = await adapter.lookup(list, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (deps.now() + CALL_DEADLINE_MS) as Millis });
      usd += result.spend.usd;
      if (result.value.items.length > 0) await deps.store(result.value.items, result.value.authors);
      for (const item of result.value.items) items.set(String(item.itemId), item);
      postsRead += result.value.items.length;
    } catch (e) {
      if (!(e instanceof BudgetRefused)) deps.log.warn(`${what} could not be read; tried again when named again`, { ...where, err: errorText(e) });
    }
  }
  return { items, usd, postsRead };
}

export async function coinLinksPass(deps: CoinLinkDeps): Promise<CoinLinkResult> {
  const c = deps.policy.finders.coinLinks;
  if (!c.on) return EMPTY;
  const now = deps.now();
  const fresh = await deps.finders.freshUnread((now - c.lookbackMs) as Millis, c.perPass);
  /* A launch this step can read first goes first; the coins read elsewhere take the room left. */
  const taken = deps.handOff?.take(c.perPass - fresh.length, now) ?? { coins: [], expired: 0 };
  if (taken.expired > 0) deps.log.warn('coins read elsewhere dropped before their links were looked at', { expired: taken.expired });
  if (fresh.length === 0 && taken.coins.length === 0) return EMPTY;
  try {
    return await linkPass(deps, fresh, taken.coins);
  } catch (e) {
    deps.handOff?.putBack(taken.coins);
    throw e;
  }
}

async function linkPass(deps: CoinLinkDeps, fresh: readonly FreshCoin[], handed: readonly HandedCoin[]): Promise<CoinLinkResult> {
  const c = deps.policy.finders.coinLinks;
  const handles = new Map<string, string>();
  const sources = deps.sources((source, id) => handles.get(`${source}:${id}`) ?? null);

  /* 1. Each new coin's document, read now, `concurrency` at a time. */
  const named: { coin: FreshCoin; posts: Awaited<ReturnType<typeof postsNamed>> }[] = [];
  let read = 0;
  for (let i = 0; i < fresh.length; i += c.concurrency) {
    await Promise.all(
      fresh.slice(i, i + c.concurrency).map(async (coin) => {
        const m = await readCoinMetadata(deps, coin, deps.now());
        if (m === null) return;
        read += 1;
        const posts = await postsNamed(urlsIn(m), sources, deps.follow);
        if (posts.length > 0) named.push({ coin, posts });
      }),
    );
  }
  /* …and each coin read elsewhere, from the fields as read: its document is not fetched again. */
  for (const h of handed) {
    const posts = await postsNamed(urlsIn(h.metadata), sources, deps.follow);
    if (posts.length > 0) named.push({ coin: h.coin, posts });
  }
  if (named.length === 0) {
    const none = { ...EMPTY, coins: fresh.length + handed.length, read, handed: handed.length };
    deps.log.info('coins pointing to posts', { ...none, secondsAfterLaunch: undefined, medianSecondsAfterLaunch: null });
    return none;
  }

  /* 2. Each named post once, against the earliest launch among this pass's coins naming it. */
  const byPost = new Map<string, { adapter: PlatformAdapter; sourceItemId: string; launchedAt: Millis | null }>();
  for (const { coin, posts } of named) {
    for (const p of posts) {
      const key = `${p.adapter.id}:${p.sourceItemId}`;
      if (p.handle !== null) handles.set(key, p.handle);
      const had = byPost.get(key);
      /* The earliest launch among this pass's coins: the credit's age is against the first coin. */
      if (had === undefined || (coin.mintedAt !== null && (had.launchedAt === null || coin.mintedAt < had.launchedAt))) byPost.set(key, { adapter: p.adapter, sourceItemId: p.sourceItemId, launchedAt: coin.mintedAt });
    }
  }

  /* 3. The named posts we do not hold, read by id; then the posts the held ones point at, one hop. */
  const first = await readMissing(deps, byPost, c.readsPerPass, 'posts named by new coins');
  const followed = (await deps.finders.keepsVia()) ? await followPromotions(deps, sources, handles, byPost, first.items) : NOT_FOLLOWED;

  /* 4. The links, for every post named whatever its age: a promotion followed is recorded as its original, through it. */
  const at = deps.now();
  const links: CoinPostLink[] = named.flatMap(({ coin, posts }) => {
    const rows = new Map<string, CoinPostLink>();
    const row = (key: string, source: string, sourceItemId: string, link: string, via: string | null): void => {
      if (!rows.has(key)) rows.set(key, { assetKey: coin.assetKey, address: coin.address, source, sourceItemId, link, mintedAt: coin.mintedAt, ...(via === null ? {} : { via }) });
    };
    /* The posts the document names outright first: an original it also names stands as named. */
    for (const p of posts) {
      const key = `${p.adapter.id}:${p.sourceItemId}`;
      if (!followed.to.has(key)) row(key, String(p.adapter.id), p.sourceItemId, p.url, null);
    }
    for (const p of posts) {
      const key = `${p.adapter.id}:${p.sourceItemId}`;
      const o = followed.to.get(key);
      if (o !== undefined) row(o.key, String(o.adapter.id), o.sourceItemId, o.link, key);
    }
    return [...rows.values()];
  });
  await deps.finders.recordLinks(links, at);
  const secondsAfterLaunch = named.flatMap(({ coin }) => (coin.mintedAt === null ? [] : [Math.round((at - coin.mintedAt) / 1000)]));

  /* 5. Each post a link now names credited if it qualifies: an original in its promotion's place. */
  const credits = new Map<string, { adapter: PlatformAdapter; launchedAt: Millis | null }>();
  for (const [key, p] of byPost) {
    const o = followed.to.get(key);
    const target = o === undefined ? key : o.key;
    const had = credits.get(target);
    if (had === undefined || (p.launchedAt !== null && (had.launchedAt === null || p.launchedAt < had.launchedAt))) credits.set(target, { adapter: o?.adapter ?? p.adapter, launchedAt: p.launchedAt });
  }
  const credit: ItemId[] = [];
  for (const [key, p] of credits) {
    const item = first.items.get(key) ?? followed.items.get(key);
    if (item !== undefined && creditable(item, p.adapter, p.launchedAt, deps.policy)) credit.push(item.itemId);
  }
  if (deps.mode === 'live' && credit.length > 0) await deps.items.markFoundBy(credit, 'coin_link', deps.now());

  const result = {
    coins: fresh.length + handed.length, read, handed: handed.length, links: links.length, postsRead: first.postsRead + followed.postsRead, credited: credit.length,
    followed: followed.to.size, usd: first.usd + followed.usd, secondsAfterLaunch,
  };
  deps.log.info('coins pointing to posts', { ...result, secondsAfterLaunch: undefined, medianSecondsAfterLaunch: median(secondsAfterLaunch) });
  return result;
}

/** The post a named post is taken through to: its key, source and id, and the link recorded for it. */
export interface Original {
  readonly key: string;
  readonly adapter: PlatformAdapter;
  readonly sourceItemId: string;
  readonly link: string;
}

export interface Followed {
  /** By the named post's key. */
  readonly to: ReadonlyMap<string, Original>;
  /** The originals held, read or not, by key. */
  readonly items: ReadonlyMap<string, Item>;
  readonly usd: number;
  readonly postsRead: number;
}

const NOT_FOLLOWED: Followed = { to: new Map(), items: new Map(), usd: 0, postsRead: 0 };

/* Links in a post's own words are read as written: following a short link would be a request per post. */
const AS_WRITTEN: FollowedLink = async (url) => url;

/**
 * The header's promotion rule over this pass's held named posts: each one's re-share, quote or first
 * link (its source's link record, else the post links in its own words), read by id when we do not
 * hold it and its id says it is young enough to matter, and kept when core `promoFollows` takes it
 * and its source can address it. One hop: an original's own quote or link is never looked at.
 */
export async function followPromotions(
  deps: Pick<CoinLinkDeps, 'finders' | 'items' | 'store' | 'meter' | 'mode' | 'log' | 'now' | 'policy'>,
  sources: readonly PlatformAdapter[],
  handles: Map<string, string>,
  byPost: ReadonlyMap<string, { readonly launchedAt: Millis | null }>,
  held: ReadonlyMap<string, Item>,
): Promise<Followed> {
  const c = deps.policy.finders.coinLinks;
  const keys = [...byPost.keys()].filter((k) => held.has(k));
  if (keys.length === 0) return NOT_FOLLOWED;
  const told = await deps.finders.promoFacts(keys);

  /* 1. What each points at, and through which hop. */
  const pointed = new Map<string, { key: string; adapter: PlatformAdapter; sourceItemId: string; hop: 'repost' | 'quote' | 'link'; url: string | null }>();
  for (const key of keys) {
    const item = held.get(key) as Item;
    const refs = item.refersTo ?? told.get(key)?.refersTo ?? null;
    const inWords = refs !== null ? [] : await postsNamed(urlsIn({ description: item.text, links: { social: null, website: null, chat: null } }), sources, AS_WRITTEN);
    const next = promoPointsAt({ ...factsOf(key, item), links: refs ?? inWords.map((p) => `${p.adapter.id}:${p.sourceItemId}`) });
    if (next === null) continue;
    const at = next.itemId.indexOf(':');
    const adapter = sources.find((a) => String(a.id) === next.itemId.slice(0, at));
    if (adapter === undefined) continue;
    const written = inWords.find((p) => `${p.adapter.id}:${p.sourceItemId}` === next.itemId);
    if (written !== undefined && written.handle !== null) handles.set(next.itemId, written.handle);
    pointed.set(key, { key: next.itemId, adapter, sourceItemId: next.itemId.slice(at + 1), hop: next.hop, url: written?.url ?? null });
  }
  if (pointed.size === 0) return NOT_FOLLOWED;

  /* 2. Read what we do not hold — only an original that could still be credited or tied: past both ages by its id's own time, neither. */
  const maxAgeMs = Math.max(c.creditMaxAgeMs, deps.policy.oneCoin.linkMaxAgeMs);
  const wanted = new Map<string, { adapter: PlatformAdapter; sourceItemId: string }>();
  for (const [promo, o] of pointed) {
    const launchedAt = byPost.get(promo)?.launchedAt ?? null;
    const postedAt = o.adapter.postTimeFromId?.(o.sourceItemId) ?? null;
    if (launchedAt === null || postedAt === null || launchedAt - postedAt <= maxAgeMs) wanted.set(o.key, { adapter: o.adapter, sourceItemId: o.sourceItemId });
  }
  const read = await readMissing(deps, wanted, c.readsPerPass, 'posts that coin-named posts point at');
  const items = new Map<string, Item>(read.items);
  const rest = [...new Set([...pointed.values()].map((o) => o.key))].filter((k) => !items.has(k));
  for (const [k, v] of await deps.items.byIds(rest as ItemId[])) items.set(String(k), v);
  const theirs = await deps.finders.promoFacts([...items.keys()]);

  /* 3. Kept when another account's and at least as widely seen, and its source can address it. */
  const to = new Map<string, Original>();
  for (const [promo, o] of pointed) {
    const original = items.get(o.key);
    if (original === undefined) continue;
    if (!promoFollows(factsOf(promo, held.get(promo) as Item), { authorKey: String(original.authorKey), reach: original.counters.reach?.value ?? null }, o.hop)) continue;
    const link = o.url ?? o.adapter.postLink?.(o.sourceItemId, theirs.get(o.key)?.handle ?? handles.get(o.key) ?? null) ?? null;
    if (link !== null) to.set(promo, { key: o.key, adapter: o.adapter, sourceItemId: o.sourceItemId, link });
  }
  return { to, items, usd: read.usd, postsRead: read.postsRead };
}

const factsOf = (key: string, item: Item) => ({
  itemId: key,
  authorKey: String(item.authorKey),
  reach: item.counters.reach?.value ?? null,
  rebroadcastOf: item.rebroadcastOf ?? null,
  reproductionOf: item.reproductionOf ?? null,
  links: [] as readonly string[],
});

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
};
