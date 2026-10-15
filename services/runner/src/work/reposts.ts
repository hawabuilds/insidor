/**
 * SHORT VIDEOS REPOSTED ON THE TEXT SOURCE: a text post we already hold that is climbing fast,
 * and links a short video, leads us to the video — read by id and credited to the `x_repost` lane.
 *
 * The text source stores a post's links only in their shortened form, so the link is followed once
 * (free: the short-link host's own redirect, never the page behind it) and recorded in
 * internal.short_link (0083), so no link is followed twice. Measured 2026-10-15 on 400 held text
 * posts: 474 short links, 9 to a short video, about 2%; a day of held posts carries a few hundred.
 *
 * Its own step because it reads what the text searches already paid for and spends only on the
 * video it finds: one read by id each. The judge and the hold decide the video like any post.
 *
 * What breaks if changed carelessly: only posts climbing fast (`minApprovalsPerMinute` over their
 * age at the last reading, under `maxAgeMs` old) have their links followed. Following every link
 * of every held post is still free but tens of thousands of requests a day to one host, which is
 * how a free host stops answering.
 */

import type { Item, ItemId, Millis } from '@insidor/contracts';
import { itemId } from '@insidor/contracts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { PgFinderRepo } from '@insidor/store';

import { readMissing, type CoinLinkDeps } from './coin-links.ts';

export interface RepostDeps extends Pick<CoinLinkDeps, 'sources' | 'follow' | 'items' | 'store' | 'meter' | 'mode' | 'policy' | 'log' | 'now'> {
  readonly finders: Pick<PgFinderRepo, 'shortLinksToFollow' | 'recordShortLinks'>;
  /** The text source and its short-link pattern (the registry's SHORT_LINKS). */
  readonly shortLinks: { readonly source: string; readonly pattern: string };
}

export interface RepostResult {
  readonly followed: number;
  readonly videos: number;
  readonly postsRead: number;
  readonly credited: number;
  readonly usd: number;
}

const EMPTY: RepostResult = { followed: 0, videos: 0, postsRead: 0, credited: 0, usd: 0 };

export async function repostsPass(deps: RepostDeps): Promise<RepostResult> {
  const r = deps.policy.finders.reposts;
  if (!r.on) return EMPTY;
  const now = deps.now();
  const links = await deps.finders.shortLinksToFollow(deps.shortLinks.source, deps.shortLinks.pattern, (now - r.maxAgeMs) as Millis, r.maxAgeMs, r.minApprovalsPerMinute, r.linksPerPass);
  if (links.length === 0) return EMPTY;

  const handles = new Map<string, string>();
  /* Every source but the text source itself: a text post linking another text post is a quote, not a repost. */
  const sources = deps.sources((source, id) => handles.get(`${source}:${id}`) ?? null).filter((a) => String(a.id) !== deps.shortLinks.source);

  const followed: { shortUrl: string; target: string | null; itemId: string }[] = [];
  const wanted = new Map<string, { adapter: PlatformAdapter; sourceItemId: string }>();
  for (let i = 0; i < links.length; i += r.concurrency) {
    await Promise.all(
      links.slice(i, i + r.concurrency).map(async (l) => {
        let target: string | null = null;
        try {
          target = await deps.follow(l.url);
        } catch {
          /* A link whose host did not answer, or a share link that led to no post: recorded as
             leading nowhere, so it is not followed again every pass. */
        }
        followed.push({ shortUrl: l.url, target, itemId: l.itemId });
        if (target === null) return;
        for (const adapter of sources) {
          const link = adapter.parseLink?.(target) ?? null;
          if (link?.kind !== 'post') continue;
          const key = `${adapter.id}:${link.sourceItemId}`;
          if (link.handle !== undefined) handles.set(key, link.handle);
          wanted.set(key, { adapter, sourceItemId: link.sourceItemId });
          break;
        }
      }),
    );
  }
  await deps.finders.recordShortLinks(followed, now);
  if (wanted.size === 0) return { ...EMPTY, followed: followed.length };

  const { items, usd, postsRead } = await readMissing(deps, wanted, r.readsPerPass, 'short videos reposted on the text source');
  const credit: ItemId[] = [];
  for (const [key, p] of wanted) {
    const item: Item | undefined = items.get(key);
    if (item?.postedAt !== null && item?.postedAt !== undefined && deps.now() - item.postedAt <= r.creditMaxAgeMs) credit.push(itemId(p.adapter.id, p.sourceItemId));
  }
  if (deps.mode === 'live' && credit.length > 0) await deps.items.markFoundBy(credit, 'x_repost', deps.now());
  const result = { followed: followed.length, videos: wanted.size, postsRead, credited: credit.length, usd };
  deps.log.info('short videos reposted on the text source', result);
  return result;
}
