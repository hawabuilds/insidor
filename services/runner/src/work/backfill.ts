/**
 * WHERE A NARRATIVE STARTED, EVEN IF WE CAUGHT IT LATE.
 *
 * Once a story is promoted, two looks back:
 *
 *   quotes   follow its posts' quotes back to the posts they quote, and those posts' quotes
 *            in turn, up to `backfill.maxReproductionHops`.
 *   search   one search for the name the judge gave the story, for posts published before
 *            the earliest one we hold, at most `backfill.searchResultCap` of them.
 *
 * Each fetched post is stored like any arrival and noted as fetched for this story
 * (internal.item_backfill); GROUP then decides it against this story alone — a quoted post
 * with the quote as lineage, a search result on its text and picture — by its ordinary
 * rules. This file fetches; it never joins anything itself.
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
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import type { JudgementRepo } from '@insidor/contracts/ports/store.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';
import type { PgBackfillRepo, PgItemRepo, PgStoryRepo } from '@insidor/store';

import { NotImplemented } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

export interface BackfillDeps {
  readonly platforms: Pick<PlatformRegistry, 'has' | 'get'>;
  readonly stories: Pick<PgStoryRepo, 'membersForStories' | 'byId'>;
  /** The judge's name for each story — what the search back looks for. */
  readonly names: Pick<JudgementRepo, 'latest'>;
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

  const searched = await searchBack(deps, storyId, [...new Set(members.map((m) => m.source))], now);
  if (searched === null) return null;

  if (deps.mode === 'dry') return { fetched: 0, usd: 0 };
  const search = searched.name === null ? { name: null, note: searched.note } : { name: searched.name, returned: searched.returned };
  const total = usd + searched.usd;
  await deps.backfill.record({ storyId, at: now, membersAt: members.length, quotedPosts: fetched, search, costUsd: total });
  deps.log.info('story backfilled', { story: storyId, members: members.length, quotedPosts: fetched, search, usd: total });
  return { fetched: fetched + (searched.name === null ? 0 : searched.returned), usd: total };
}

type Searched =
  | { readonly name: string; readonly returned: number; readonly usd: number }
  | { readonly name: null; readonly note: 'no_name' | 'not_supported'; readonly usd: 0 };

/**
 * One search per source of the story's posts, for the story's name, ending at our earliest
 * post. Null when it could not be completed, so the story is tried again.
 *
 * ★ NEWEST FIRST, NOT OLDEST. The sources return the latest posts before the cutoff and
 * cannot be asked for the oldest, so this reads the stretch just before we caught the
 * story. A post found here that joins moves the story's earliest post back, and the next
 * backfill — the story has a new member — searches from there.
 */
async function searchBack(deps: BackfillDeps, storyId: StoryId, sources: readonly SourceId[], now: Millis): Promise<Searched | null> {
  const name = (await deps.names.latest([storyId])).get(storyId)?.judgement.proposedName?.trim() ?? '';
  if (name === '') return { name: null, note: 'no_name', usd: 0 };
  const story = await deps.stories.byId(storyId);
  if (story === null) return null;

  let asked = false;
  let returned = 0;
  let usd = 0;
  for (const source of sources) {
    if (!deps.platforms.has(source)) continue;
    const adapter = deps.platforms.get(source);
    if (!adapter.capabilities.discovery.includes('keyword')) continue;
    const query: DiscoveryQuery = {
      mode: 'keyword',
      term: name,
      sinceMs: null,
      untilMs: story.earliestPostAt,
      limit: deps.policy.backfill.searchResultCap,
      cursor: null,
    };
    let estimate;
    try {
      estimate = adapter.estimate({ kind: 'discover', query });
    } catch (e) {
      deps.log.error('backfill search cannot be priced; not asking', { story: storyId, source, err: errorText(e) });
      continue;
    }
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.info('backfill paused for budget; the story is tried again later', { story: storyId, source, wouldSpendUsd: estimate.usd });
      return null;
    }
    if (deps.mode === 'dry') {
      deps.log.info('DRY RUN — search back, not sent', { story: storyId, source, name, wouldSpendUsd: estimate.usd });
      asked = true;
      continue;
    }

    try {
      const line = deps.meter.line(estimate.vendor);
      const result = await adapter.discover(query, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: (now + LOOKUP_DEADLINE_MS) as Millis });
      asked = true;
      usd += result.spend.usd;
      const found = result.value.items;
      returned += found.length;
      if (found.length > 0) {
        await deps.store(found, result.value.authors);
        await deps.backfill.markPosts(found.map((item) => ({ itemId: item.itemId, reachedFrom: null })), storyId, 'search', now);
      }
    } catch (e) {
      /* A source that cannot search back to a cutoff says so by type; it is not an outage,
         and the story is not tried again for it. */
      if (e instanceof NotImplemented) {
        deps.log.info('this source cannot search back to a cutoff; skipped', { story: storyId, source });
        continue;
      }
      deps.log.error('backfill search failed; the story is tried again later', { story: storyId, source, err: errorText(e) });
      return null;
    }
  }
  if (!asked) return { name: null, note: 'not_supported', usd: 0 };
  return { name, returned, usd };
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
