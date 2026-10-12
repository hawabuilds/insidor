/**
 * WHERE A NARRATIVE STARTED, EVEN IF WE CAUGHT IT LATE.
 *
 * Once a story is promoted, follow its posts' quotes back to the posts they quote, and those
 * posts' quotes in turn, up to `backfill.maxReproductionHops`. Each fetched post is stored like any
 * arrival and noted as fetched for this story (internal.item_backfill); GROUP then decides
 * it against this story alone, with the quote as lineage, by its ordinary rules. This file
 * fetches; it never joins anything itself.
 *
 * Once per story, and again only when the story has gained members since (the repo's `due`).
 * Every lookup is priced first, checked against the posts line, skipped on a dry run, and
 * what the backfill cost is recorded with it.
 *
 * What breaks if changed carelessly: a failed lookup records nothing, so the story is tried
 * again on the next pass rather than marked done with a hole in it. Recording a failure as a
 * finished backfill would leave the story's start unfound until it next gained a member.
 */

import type { Author, Item, ItemId, Millis, SourceId, StoryId } from '@insidor/contracts';
import { parseItemId } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';
import type { PgBackfillRepo, PgItemRepo, PgStoryRepo } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

export interface BackfillDeps {
  readonly platforms: Pick<PlatformRegistry, 'has' | 'get'>;
  readonly stories: Pick<PgStoryRepo, 'membersForStories'>;
  readonly items: Pick<PgItemRepo, 'byIds'>;
  readonly backfill: Pick<PgBackfillRepo, 'due' | 'countSince' | 'markPosts' | 'record'>;
  /** Store fetched posts as arrivals: the accounts, the posts, their first reading. */
  readonly store: (items: readonly Item[], authors: readonly Author[]) => Promise<number>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface BackfillResult {
  readonly stories: number;
  readonly fetched: number;
  readonly usd: number;
}

const DAY_MS = 86_400_000;
/** How long one lookup may take before it is abandoned. */
const LOOKUP_DEADLINE_MS = 60_000;

/** One quote to follow: the post we want, and the post of ours that quoted it. */
interface Want {
  readonly target: ItemId;
  readonly from: ItemId;
}

export async function backfillStories(deps: BackfillDeps): Promise<BackfillResult> {
  const now = deps.now();
  const done = await deps.backfill.countSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis);
  const room = Math.min(deps.policy.backfill.storiesPerPass, deps.policy.backfill.storiesPerDay - done);
  if (room <= 0) return { stories: 0, fetched: 0, usd: 0 };

  const due = await deps.backfill.due(room);
  let fetched = 0;
  let usd = 0;
  let stories = 0;
  for (const storyId of due) {
    const one = await backfillOne(deps, storyId, now);
    if (one === null) continue;
    stories += 1;
    fetched += one.fetched;
    usd += one.usd;
  }
  return { stories, fetched, usd };
}

async function backfillOne(deps: BackfillDeps, storyId: StoryId, now: Millis): Promise<{ fetched: number; usd: number } | null> {
  const members = (await deps.stories.membersForStories([storyId])).get(storyId) ?? [];
  const known = await deps.items.byIds(members.map((m) => m.itemId));

  let frontier = await unknownTargets(deps, [...known.values()]);
  let fetched = 0;
  let usd = 0;
  for (let hop = 1; hop <= deps.policy.backfill.maxReproductionHops && frontier.length > 0; hop += 1) {
    const room = deps.policy.backfill.maxReproducedPosts - fetched;
    if (room <= 0) break;
    const batch = frontier.slice(0, room);
    const got = await fetchQuoted(deps, storyId, batch, now);
    if (got === null) return null;
    fetched += got.items.length;
    usd += got.usd;
    frontier = await unknownTargets(deps, got.items);
  }

  if (deps.mode === 'dry') return { fetched: 0, usd: 0 };
  await deps.backfill.record({ storyId, at: now, membersAt: members.length, quotedPosts: fetched, costUsd: usd });
  deps.log.info('story backfilled', { story: storyId, members: members.length, quotedPosts: fetched, usd });
  return { fetched, usd };
}

/** The posts these quote that we do not have yet. */
async function unknownTargets(deps: BackfillDeps, posts: readonly Item[]): Promise<readonly Want[]> {
  const wants = posts.flatMap((p) => (p.reproductionOf === null ? [] : [{ target: p.reproductionOf, from: p.itemId }]));
  if (wants.length === 0) return [];
  const have = await deps.items.byIds(wants.map((w) => w.target));
  const seen = new Set<ItemId>();
  return wants.filter((w) => {
    if (have.has(w.target) || seen.has(w.target)) return false;
    seen.add(w.target);
    return true;
  });
}

/**
 * Fetch one hop's quoted posts, per source. Null when the hop could not be completed — a
 * refused budget or a failed call — so the story is not recorded as backfilled.
 */
async function fetchQuoted(
  deps: BackfillDeps,
  storyId: StoryId,
  wants: readonly Want[],
  now: Millis,
): Promise<{ items: readonly Item[]; usd: number } | null> {
  const bySource = new Map<SourceId, Want[]>();
  for (const want of wants) {
    const parsed = parseItemId(want.target);
    if (parsed === null) continue;
    const list = bySource.get(parsed.source) ?? [];
    list.push(want);
    bySource.set(parsed.source, list);
  }

  const items: Item[] = [];
  let usd = 0;
  for (const [source, list] of bySource) {
    if (!deps.platforms.has(source)) continue;
    const adapter = deps.platforms.get(source);
    if (adapter.lookup === undefined) {
      deps.log.info('this source cannot fetch a post by id; its quotes are not followed', { source });
      continue;
    }
    const ids = list.flatMap((w) => parseItemId(w.target)?.sourceItemId ?? []);
    const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: ids });
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.info('backfill paused for budget; the story is tried again later', { story: storyId, source, wouldSpendUsd: estimate.usd });
      return null;
    }
    if (deps.mode === 'dry') {
      deps.log.info('DRY RUN — quoted posts to fetch, not fetched', { story: storyId, source, posts: ids.length, wouldSpendUsd: estimate.usd });
      continue;
    }

    try {
      const line = deps.meter.line(estimate.vendor);
      const result = await adapter.lookup(ids, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (now + LOOKUP_DEADLINE_MS) as Millis });
      usd += result.spend.usd;
      const fetched = result.value.items;
      if (fetched.length > 0) {
        await deps.store(fetched, result.value.authors);
        const from = new Map(list.map((w) => [w.target, w.from]));
        await deps.backfill.markPosts(
          fetched.map((item) => ({ itemId: item.itemId, reachedFrom: from.get(item.itemId) ?? null })),
          storyId,
          'quote',
          now,
        );
      }
      items.push(...fetched);
    } catch (e) {
      deps.log.error('backfill lookup failed; the story is tried again later', { story: storyId, source, err: errorText(e) });
      return null;
    }
  }
  return { items, usd };
}
