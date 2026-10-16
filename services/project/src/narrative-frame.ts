/**
 * THE NARRATIVES BOARD: one frame of the board from the narratives the runner grouped (0093,
 * core group/narrative.ts), each held again to the owner's rule with what is true NOW, projected
 * as a board row and a story page, and each of its posts written to public.story_post.
 *
 * Replaces the board's old source (GROUP's promoted stories, frame.ts) because those were built
 * from ads, shills and posts the owner hid. The runner regroups every couple of minutes; this frame
 * runs every minute and re-reads what can change in between, so the owner's calls act at once:
 *
 *   posts      each post's standing again (core `narrativeStanding`, at its own model's cutoff):
 *              a post the owner hid a second ago is off its narrative's list in this frame
 *   the rule   two good posts, or the one post the runner found huge and climbing; the owner's
 *              "Not a narrative" hides it until its posts change (core `narrativeShown`)
 *   the coin   ★ FROM THE POSTS' OWN CARDS, so there is one truth: the owner's call on the
 *              narrative, else a coin he confirmed on one of its posts (or for its story, which
 *              reaches the cards through the story coins), else the coin its cards prove, else the
 *              coins its cards list — core `narrativeCoin`. The cards are the feeds' last frame
 *              (public.rising_row, the scroll's public.feed_post) and their "See N coins" lists
 *              (public.same_name_coin), so the page and its posts' cards never disagree by more
 *              than one frame
 *   the views  core `narrativeReach` over the posts' readings, per post and then added up: the
 *              total, the last hour's gain (the board's order, fastest first), the views gained
 *              every five minutes over the day (the page's line) and each post's own views and
 *              last hour, each saying how many of the posts it counted
 *   found      the earliest moment we saved any post it lists now (public.item.first_seen_at),
 *              not when the narrative was first shown and not when a post went up
 *
 * ★ ONE POST COUNT EVERYWHERE. `memberCount`, the summary's "N posts from M accounts", `postIds`,
 * `postCount`, the evidence list and public.story_post's `posts` are all the posts listed here.
 *
 * What breaks if changed carelessly: this runs inside the projector's transaction, and is bounded
 * by the board (at most `BOARD_LIMIT` narratives, read in a handful of statements, no pairwise
 * work). A missing table (0093 not applied) is asked first, never caught: inside the transaction a
 * failed statement would abort the frame, so a board with no narratives is what an unmigrated
 * database shows.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { coinCallFor, foldNarrativeCalls, isShillText, narrativeCoin, narrativeReach, narrativeShown, narrativeStanding, type NarrativeCoin, type NarrativeMemberCoin } from '@insidor/core';
import { PgNarrativeRepo, type Db, type NarrativePostRow } from '@insidor/store';

import { loadCoinFactsByAddress, loadReach, nextTick, pictureOf, previousBoardStoryIds, sourceLabel, writeBoard, writeStories } from './db.ts';
import { policyForAnswer } from './judge-cutoff.ts';
import { permalinkFor } from './permalinks.ts';
import { projectBoard, projectCoin, projectStory, type CoinCandidate, type MemberFacts, type ProjectOptions, type ReachReading, type StoryFacts } from './project.ts';
import { storySameNameLists, writeSameNameCoins } from './same-name.ts';
import { instant, measured, WireLeakError, assertNoInternalVocabulary, type WireStory } from './wire.ts';

/** At most this many narratives on the board, as the old board's limit. */
const BOARD_LIMIT = 200;

interface MemberRow {
  item_id: string;
  source: string;
  source_item_id: string;
  posted_at: Date | string | null;
  first_seen_at: Date | string;
  body: string;
  media: unknown;
  handle: string | null;
  display_name: string | null;
  source_author_id: string;
  author_key: string;
}

const toMs = (v: Date | string | null): number | null => (v === null ? null : v instanceof Date ? v.getTime() : Date.parse(v));

/** One narrative this frame shows, with the posts it lists. */
export interface ShownNarrative {
  readonly id: string;
  readonly title: string | null;
  readonly members: readonly string[];
  readonly firstShownAtMs: number | null;
}

/**
 * The runner's open narratives held to the rule NOW: each post's standing re-read, the owner's
 * calls re-folded. Pure but for the reads; the board's input.
 */
export async function shownNarratives(db: Db, policy: Policy, openPolicy: Policy = policy): Promise<{ readonly shown: readonly ShownNarrative[]; readonly standing: ReadonlyMap<string, NarrativePostRow>; readonly single: ReadonlySet<string> }> {
  const repo = new PgNarrativeRepo(db);
  if (!(await repo.migrated())) return { shown: [], standing: new Map(), single: new Set() };
  const open = (await repo.open()).filter((n) => n.shown);
  const calls = foldNarrativeCalls(await repo.calls());
  const rows = await repo.standingRows([...new Set(open.flatMap((n) => n.members))]);
  const byId = new Map(rows.map((r) => [r.itemId, r] as const));
  const good = (r: NarrativePostRow | undefined): boolean => {
    if (r === undefined) return false;
    const answer = r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt, proposedName: r.proposedName };
    return narrativeStanding({ answer, kindLabel: r.kindLabel, ownerCall: r.ownerCall, shill: isShillText(r.body, policy.attention) || r.ownTalk }, policyForAnswer(r.judgeId, policy, openPolicy)) === 'good';
  };
  const shown: ShownNarrative[] = [];
  const singles = new Set<string>();
  for (const n of open) {
    /* A post the owner removed from beside these posts is off the list at once, before the regroup. */
    const removed = (m: string) => [...(calls.removed.get(m) ?? [])].some((x) => x !== m && n.members.includes(x));
    const listed = n.members.filter((m) => good(byId.get(m)) && !removed(m)).sort((a, b) => (byId.get(a)?.atMs ?? 0) - (byId.get(b)?.atMs ?? 0) || a.localeCompare(b));
    /* A narrative of one is shown only as the runner found it: huge and climbing at its last pass. */
    const single = n.members.length === 1 && n.shown;
    if (narrativeShown(listed.length, single, calls.hiddenAt.get(n.id) ?? null, n.postsChangedAtMs, policy) !== 'shown') continue;
    shown.push({ id: n.id, title: n.title, members: listed, firstShownAtMs: n.firstShownAtMs });
    if (single) singles.add(n.id);
  }
  return { shown: shown.slice(0, BOARD_LIMIT), standing: byId, single: singles };
}

/** Each post's coin as its own card shows it, and the list behind a card's "See N coins". */
async function cardCoins(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, NarrativeMemberCoin>> {
  if (itemIds.length === 0) return new Map();
  const [has] = await db.query<{ scroll: boolean }>(`select to_regclass('public.feed_post') is not null as scroll`);
  const scroll = has?.scroll === true
    ? `union all select f.item_id, f.payload -> 'coins', 1 from public.feed_post f where f.item_id = any($1::text[]) and f.payload is not null`
    : '';
  const cards = await db.query<{ item_id: string; coins: Record<string, unknown> | null }>(
    `select distinct on (item_id) item_id, coins from (
       select r.item_id, r.payload -> 'coins' as coins, 0 as pref from public.rising_row r where r.item_id = any($1::text[])
       ${scroll}
     ) c(item_id, coins, pref) order by item_id, pref`,
    [[...itemIds]],
  );
  const lists = await db.query<{ subject_id: string; addresses: string[] }>(
    `select subject_id, array_agg(address order by position) as addresses from public.same_name_coin
      where subject_kind = 'post' and subject_id = any($1::text[]) group by subject_id`,
    [[...itemIds]],
  );
  const listed = new Map(lists.map((l) => [l.subject_id, l.addresses] as const));
  const out = new Map<string, NarrativeMemberCoin>();
  for (const c of cards) {
    const kind = c.coins?.['kind'];
    const coin = (c.coins?.['coin'] ?? {}) as Record<string, unknown>;
    const evidence = (c.coins?.['evidence'] ?? {}) as Record<string, unknown>;
    const address = typeof coin['address'] === 'string' ? coin['address'] : null;
    const matched = (kind === 'matched' || kind === 'one') && address !== null;
    const confirmed = matched && (evidence['ownerChecked'] === true || evidence['storyCoin'] === true);
    out.set(c.item_id, {
      itemId: c.item_id,
      /* The card does not say when the owner confirmed it; the newest call is decided on the card. */
      confirmed: confirmed && address !== null ? { address, atMs: 0 } : null,
      proven: matched && !confirmed ? address : null,
      listed: kind === 'pending' || kind === 'unchecked' || kind === undefined ? null : listed.get(c.item_id) ?? [],
    });
  }
  return out;
}

const authorLabelOf = (row: MemberRow): string => {
  const handle = (row.handle ?? '').trim();
  if (handle !== '') return handle.startsWith('@') ? handle : `@${handle}`;
  const name = (row.display_name ?? '').trim();
  return name !== '' ? name : row.source_author_id;
};

/** The judge's most common name among the posts: the title until the cheap model has written one. */
function judgesName(members: readonly string[], standing: ReadonlyMap<string, NarrativePostRow>): string | null {
  const names = new Map<string, number>();
  for (const m of members) {
    const n = standing.get(m)?.proposedName?.trim();
    if (n !== undefined && n !== '') names.set(n, (names.get(n) ?? 0) + 1);
  }
  return [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** The candidates `projectCoins` reads for one narrative coin: confident for a settled coin, not for the fitting ones. */
function candidatesOf(coin: NarrativeCoin, facts: ReadonlyMap<string, CoinCandidate['coin']>): readonly CoinCandidate[] {
  const of = (addresses: readonly string[], confident: boolean) => addresses.flatMap((a) => {
    const f = facts.get(a);
    return f === undefined ? [] : [{ coin: f, confident }];
  });
  if (coin.kind === 'confirmed') return of([coin.address], true);
  if (coin.kind === 'proven') return of(coin.addresses, true);
  if (coin.kind === 'fitting') return of(coin.addresses, false);
  return [];
}

/** The first of the coins that has facts, projected as a coin: the payload's `topCoin`. */
function topCoinOf(addresses: readonly string[], facts: ReadonlyMap<string, CoinCandidate['coin']>, options: ProjectOptions): Partial<WireStory> {
  const first = addresses.map((a) => facts.get(a)).find((f) => f !== undefined);
  return first === undefined ? {} : { topCoin: projectCoin(first, options) };
}

export interface NarrativeFrame {
  /** False before 0093: nothing was read or written, and the caller projects the old board. */
  readonly migrated: boolean;
  readonly tick: number;
  readonly boardRows: number;
  readonly storyViews: number;
  readonly considered: number;
  readonly skipped: number;
  readonly withheld: number;
  readonly posts: number;
}

export async function projectNarrativeFrame(db: Db, viewId: string, options: ProjectOptions, reachSinceMs: number, policy: Policy = DEFAULT_POLICY, openPolicy: Policy = policy): Promise<NarrativeFrame> {
  const empty = { migrated: false, tick: 0, boardRows: 0, storyViews: 0, considered: 0, skipped: 0, withheld: 0, posts: 0 };
  if (!(await new PgNarrativeRepo(db).migrated())) return empty;
  const tick = await nextTick(db, viewId);
  const previous = await previousBoardStoryIds(db, viewId);
  const { shown, standing, single } = await shownNarratives(db, policy, openPolicy);
  const ids = [...new Set(shown.flatMap((n) => n.members))];

  const rows = ids.length === 0 ? [] : await db.query<MemberRow>(
    `select i.item_id, i.source, i.source_item_id, i.posted_at, i.first_seen_at, i.body, i.media,
            a.handle, a.display_name, a.source_author_id, a.author_key
       from public.item i join public.author a on a.author_key = i.author_key
      where i.item_id = any($1::text[])`,
    [ids],
  );
  const rowOf = new Map(rows.map((r) => [r.item_id, r] as const));
  /* Every reading of the narrative window: a post's newest count may be older than the board's reach window. */
  const reach = await loadReach(db, ids, Math.min(reachSinceMs, options.nowMs - policy.narrative.windowMs) as Millis);
  const cards = await cardCoins(db, ids);
  const calls = foldNarrativeCalls(await new PgNarrativeRepo(db).calls());

  const coinOf = new Map<string, NarrativeCoin>();
  for (const n of shown) {
    const members = n.members.map((m) => cards.get(m) ?? { itemId: m, confirmed: null, proven: null, listed: null });
    coinOf.set(n.id, narrativeCoin(members, coinCallFor(n.id, new Set(n.members), calls), policy.postCoin.list.maxCoins));
  }
  const addresses = [...new Set([...coinOf.values()].flatMap((c) => (c.kind === 'confirmed' ? [c.address] : c.kind === 'proven' || c.kind === 'fitting' ? c.addresses : [])))];
  const coinFacts = await loadCoinFactsByAddress(db, addresses);

  const readingsOf = (id: string): readonly ReachReading[] => reach.get(id) ?? [];
  const facts: StoryFacts[] = [];
  const extras = new Map<string, Partial<WireStory>>();
  const gainOf = new Map<string, number | null>();
  for (const n of shown) {
    /* ★ Only posts the page can cite (a link we can build): the list, the count and the summary are one set. */
    const members: MemberFacts[] = n.members.flatMap((m) => {
      const r = rowOf.get(m);
      const link = r === undefined ? null : permalinkFor(r.source, r.handle, r.source_item_id);
      if (r === undefined || link === null || !link.startsWith('https://')) return [];
      return [{
        itemId: m,
        sourceLabel: sourceLabel(r.source),
        authorLabel: authorLabelOf(r),
        postedAt: toMs(r.posted_at) as Millis | null,
        excerpt: r.body,
        thumbUrl: pictureOf(r.media)?.uri ?? null,
        permalink: link,
        relation: { kind: 'representation' as const },
        reach: readingsOf(m),
      }];
    });
    if (members.length < policy.narrative.minPosts && !(members.length === 1 && single.has(n.id))) continue;
    const latest = (m: MemberFacts): number => {
      const last = [...m.reach].reverse().find((x) => x.count !== undefined && x.count !== null);
      return last?.count ?? -1;
    };
    /* The best picture: the most-seen post that has one. */
    const picture = [...members].filter((m) => m.thumbUrl !== null).sort((a, b) => latest(b) - latest(a) || a.itemId.localeCompare(b.itemId))[0]?.thumbUrl ?? null;
    const used = members.map((m) => rowOf.get(m.itemId)).filter((r): r is MemberRow => r !== undefined);
    const coin = coinOf.get(n.id) ?? { kind: 'pending' };
    facts.push({
      storyId: n.id,
      displayTitle: n.title ?? judgesName(n.members, standing),
      thumbUrl: picture,
      lastMemberAt: Math.max(...members.map((m) => m.postedAt ?? 0)) as Millis,
      memberCount: members.length,
      distinctAuthors: new Set(used.map((r) => r.author_key)).size,
      distinctSources: new Set(used.map((r) => r.source)).size,
      members,
      coins: candidatesOf(coin, coinFacts),
      coinsLookedUp: coin.kind !== 'pending',
      wasOnPreviousBoard: previous.has(n.id),
    });
    const views = narrativeReach(members.map((m) => ({ postedAtMs: m.postedAt, points: m.reach.map((x) => ({ atMs: x.atMs, reach: x.count ?? null })) })), options.nowMs, policy);
    gainOf.set(n.id, views.lastHour.value);
    /* ★ FIRST FOUND: the earliest moment we saved any post it lists NOW, so removing a post moves it. */
    const found = used.map((r) => toMs(r.first_seen_at)).filter((t): t is number => t !== null && Number.isFinite(t));
    extras.set(n.id, {
      postIds: members.map((m) => m.itemId),
      postCount: members.length,
      viewsTotal: measured(views.total.value, 'not_read_yet'),
      viewsTotalPosts: views.total.counted,
      viewsGained1h: measured(views.lastHour.value, 'not_read_yet'),
      viewsGained1hPosts: views.lastHour.counted,
      viewsGained: views.gained,
      postViews: members.map((m, i) => ({ postId: m.itemId, views: views.posts[i]?.total ?? null, gainedLastHour: views.posts[i]?.lastHour ?? null })),
      foundAt: instant(found.length === 0 ? null : Math.min(...found), 'not_reported'),
      /* ★ The top coin when none is settled (fitting, or several proven equally): shown as "Top coin,
         not checked", never as the narrative's coin. The coins most posts list come first. */
      ...(coin.kind === 'fitting' || (coin.kind === 'proven' && coin.addresses.length > 1) ? topCoinOf(coin.addresses, coinFacts, options) : {}),
    });
  }

  /* ★ FASTEST FIRST: the views gained in the last hour; an unknown gain after every known one, never as zero. */
  const byGain = (list: readonly StoryFacts[]) => [...list].sort((a, b) => {
    const ga = gainOf.get(a.storyId) ?? null;
    const gb = gainOf.get(b.storyId) ?? null;
    if (ga === null || gb === null) return ga === null ? (gb === null ? b.lastMemberAt - a.lastMemberAt : 1) : -1;
    return gb - ga || b.lastMemberAt - a.lastMemberAt;
  });
  const board = projectBoard(facts, options, byGain);
  for (const id of board.withheld) console.warn(`narrative ${id} was withheld from the board: its payload would have leaked`);
  const onBoard = new Set(board.order);

  const pages: WireStory[] = [];
  let skipped = 0;
  for (const story of facts) {
    if (!onBoard.has(story.storyId)) continue;
    try {
      const page = projectStory(story, options, { kind: 'observed' });
      if (page === null) {
        skipped += 1;
        continue;
      }
      const full: WireStory = { ...page, ...extras.get(story.storyId) };
      assertNoInternalVocabulary(full, `$.story_view[${story.storyId}]`);
      pages.push(full);
    } catch (error: unknown) {
      if (!(error instanceof WireLeakError)) throw error;
      skipped += 1;
      console.warn(`narrative ${story.storyId} was not projected: ${error.message}`);
    }
  }
  /* The board lists only narratives with a page: a row that opens a 404 is worse than none. */
  const paged = new Set(pages.map((p) => p.id));
  const rowsWithPages = board.rows.filter((r) => paged.has(r.id));
  const boardRows = await writeBoard(db, viewId, tick, rowsWithPages, { kind: 'observed' });
  const storyViews = await writeStories(db, pages);
  const coinsByStory = new Map(rowsWithPages.map((row) => [row.id, row.coins]));
  await writeSameNameCoins(db, 'story', storySameNameLists(facts.filter((f) => paged.has(f.storyId)), coinsByStory));

  /* ★ Each listed post's narrative, its title and post count: the cards' tag and the post sheet's tile. */
  const posts = pages.flatMap((p) => (p.postIds ?? []).map((itemId) => ({ itemId, storyId: p.id, title: p.title, posts: p.postCount ?? p.evidence.length })));
  await db.query(`delete from public.story_post`);
  if (posts.length > 0) {
    await db.query(
      `insert into public.story_post (item_id, story_id, title, posts)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::int[]) on conflict (item_id) do nothing`,
      [posts.map((p) => p.itemId), posts.map((p) => p.storyId), posts.map((p) => p.title), posts.map((p) => p.posts)],
    );
  }
  return { migrated: true, tick, boardRows, storyViews, considered: shown.length, skipped, withheld: board.withheld.length, posts: posts.length };
}
