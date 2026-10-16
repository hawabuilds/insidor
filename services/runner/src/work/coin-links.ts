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
 * ★ FOR LEARNING FIRST, FEED SECOND (the owner, 2026-10-15). The link record is what the lead-time
 * report and the learned words read: it is written for every link, whatever the post's age. A post
 * is credited to the `coin_link` lane — which only queues it for the judge, never shows it — when it
 * was under `creditMaxAgeMs` old at the launch, and a post of a source with a catch-all search only
 * at `textMinApprovals` approvals: most coins name a text post nobody saw. The judge and the hold
 * then decide, as for any post; a coin naming a post does not make it a meme.
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
import { itemId } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { CoinPostLink, PgCoinUniverseRepo, PgFinderRepo, PgItemRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
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
  readonly finders: Pick<PgFinderRepo, 'freshUnread' | 'recordLinks'>;
  readonly coins: Pick<PgCoinUniverseRepo, 'recordMetadata'>;
  readonly metadata: MetadataReader;
  readonly declared?: DeclaredReader;
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
  readonly links: number;
  readonly postsRead: number;
  readonly credited: number;
  readonly usd: number;
  /** Seconds from each linking coin's launch to its link being recorded: what "within seconds" measures. */
  readonly secondsAfterLaunch: readonly number[];
}

const EMPTY: CoinLinkResult = { coins: 0, read: 0, links: 0, postsRead: 0, credited: 0, usd: 0, secondsAfterLaunch: [] };

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
  return (item.counters.approval?.value ?? 0) >= c.textMinApprovals;
}

/**
 * The posts we hold of `wanted`, and up to `limit` of the rest read by id and stored: priced first,
 * checked against the source's line, skipped on a dry run. A read that fails leaves its posts
 * unread; the caller's record of them stands. Shared with the reposts finder.
 */
export async function readMissing(
  deps: Pick<CoinLinkDeps, 'items' | 'store' | 'meter' | 'mode' | 'log' | 'now'>,
  wanted: ReadonlyMap<string, { readonly adapter: PlatformAdapter; readonly sourceItemId: string }>,
  limit: number,
  what: string,
): Promise<{ readonly items: Map<string, Item>; readonly usd: number; readonly postsRead: number }> {
  const held = await deps.items.byIds([...wanted.keys()].map((k) => k as ItemId));
  const items = new Map<string, Item>([...held].map(([k, v]) => [String(k), v]));
  let usd = 0;
  let postsRead = 0;
  const missing = [...wanted.entries()].filter(([k]) => !items.has(k)).slice(0, limit);
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
  if (fresh.length === 0) return EMPTY;

  const handles = new Map<string, string>();
  const sources = deps.sources((source, id) => handles.get(`${source}:${id}`) ?? null);

  /* 1. Each new coin's document, read now, `concurrency` at a time. */
  const named: { coin: (typeof fresh)[number]; posts: Awaited<ReturnType<typeof postsNamed>> }[] = [];
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
  if (named.length === 0) {
    const none = { ...EMPTY, coins: fresh.length, read };
    deps.log.info('coins pointing to posts', { ...none, secondsAfterLaunch: undefined, medianSecondsAfterLaunch: null });
    return none;
  }

  /* 2. The links, recorded for every post named, whatever its age. */
  const at = deps.now();
  const links: CoinPostLink[] = named.flatMap(({ coin, posts }) =>
    posts.map((p) => ({ assetKey: coin.assetKey, address: coin.address, source: String(p.adapter.id), sourceItemId: p.sourceItemId, link: p.url, mintedAt: coin.mintedAt })),
  );
  await deps.finders.recordLinks(links, at);
  const secondsAfterLaunch = named.flatMap(({ coin }) => (coin.mintedAt === null ? [] : [Math.round((at - coin.mintedAt) / 1000)]));

  /* 3. The posts we do not hold, read by id; then every named post credited if it qualifies. */
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
  const { items, usd, postsRead } = await readMissing(deps, byPost, c.readsPerPass, 'posts named by new coins');

  const credit: ItemId[] = [];
  for (const [key, p] of byPost) {
    const item = items.get(key);
    if (item !== undefined && creditable(item, p.adapter, p.launchedAt, deps.policy)) credit.push(itemId(p.adapter.id, p.sourceItemId));
  }
  if (deps.mode === 'live' && credit.length > 0) await deps.items.markFoundBy(credit, 'coin_link', deps.now());

  const result = { coins: fresh.length, read, links: links.length, postsRead, credited: credit.length, usd, secondsAfterLaunch };
  deps.log.info('coins pointing to posts', { ...result, secondsAfterLaunch: undefined, medianSecondsAfterLaunch: median(secondsAfterLaunch) });
  return result;
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
};
