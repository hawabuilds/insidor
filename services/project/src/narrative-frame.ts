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
 *              a post the owner hid a second ago is off its narrative's list in this frame, and so
 *              is a shill or a held kind (an ad) found since. ★ A judge's bar that moved since the
 *              post joined does not take it off (the owner, 2026-10-18: a narrative only goes when
 *              he says so): the bar decides which posts join a narrative, not which stay. On 16-18
 *              Oct 46 of the 208 narratives the old regroup dropped went because their first post
 *              no longer passed the bar of the day
 *   the rule   two good posts from two accounts (`minPosts`, `minAccounts`; the one post the
 *              runner found huge and climbing only while `single.on`); under it the narrative is
 *              kept but its page, its posts' tags and its search entry go until it grows; the owner's
 *              "Not a narrative" hides it, and any narrative made of its posts, until it has
 *              `minPosts` good posts he never saw in it (core `hiddenByOwner`)
 *   the coin   ★ FROM THE POSTS' OWN CARDS, so there is one truth: the owner's call on the
 *              narrative, else a coin he confirmed on one of its posts (or for its story, which
 *              reaches the cards through the story coins), else the coin its cards prove, else the
 *              coins its cards list — core `narrativeCoin`. The cards are the feeds' last frame
 *              (public.rising_row, the scroll's public.feed_post) and their "See N coins" lists
 *              (public.same_name_coin), so the page and its posts' cards never disagree by more
 *              than one frame. A post with no card (never on a feed's frame, as most are) reads
 *              its own name search instead (`cardCoins`), so "still checking" means no post of
 *              the narrative has been searched yet, never that its posts were off the feeds
 *   the views  core `narrativeReach` over the posts' readings, per post and then added up: the
 *              total, the last hour's gain, the views gained every five minutes over the day (the
 *              page's line), the same in half-hours from its first reading (the page's "All") and
 *              each post's own views, last hour and when we found it, each saying how many of the
 *              posts it counted
 *   the orders each window's views gained, new posts and trending place (narrative-trend.ts);
 *              the board is in Trending 1h's order, the tab's default
 *   found      the earliest moment we saved any post it lists now (public.item.first_seen_at),
 *              not when the narrative was first shown and not when a post went up
 *
 * ★ A PAGE STAYS (the owner, 2026-10-18: "narratives never disappear"). The board is the newest
 * narratives, projected in full every frame: live ones first, then the most recently dead, at most
 * `BOARD_LIMIT`. Every other narrative keeps the page last written for it, and
 * `narrative.dead.pagesPerFrame` of them are projected again each frame (never-projected first,
 * then the longest since), so an old narrative's page, its posts' tags and its search entry stay,
 * and its numbers are never more than one turn of that queue old. A page is deleted only when its
 * narrative is no longer one: the owner said "Not a narrative" (or hid enough of its posts that
 * fewer than `minPosts` are left), his "Not a meme" and removals left it no post, or it was merged —
 * then public.story_alias sends its link to the narrative it was merged into.
 *
 * ★ ONCE LISTED, LISTED (0135 `listed_at`; the owner, 2026-10-24: "never remove narratives, bring
 * them back"). The rules above (two accounts, `minPosts`, the viral floor) decide only whether a
 * narrative is listed the FIRST time. Until then each re-check held every page to that frame's rules,
 * so the viral floor of 23 Oct deleted ~940 older pages on their next turn in the queue, and the tab's
 * oldest narrative became a day old. A narrative with `listed_at` is held to the owner's calls only;
 * its page is rewritten with whatever posts it can still cite, even one.
 *
 * ★ DEAD (core `narrativeDead`): its newest listed post went up `narrative.dead.afterMs` ago or
 * more. Said on the page (`dead`, `lastPostAt`), given no trending place, and so left out of
 * Trending; still on the board after the live ones, and in Most viewed and New.
 *
 * ★ ONE POST COUNT EVERYWHERE. `memberCount`, the summary's "N posts from M accounts", `postIds`,
 * `postCount`, the evidence list and public.story_post's `posts` are all the posts listed here.
 *
 * What breaks if changed carelessly: this runs inside the projector's transaction, and is bounded
 * by the board (at most `BOARD_LIMIT` narratives and `pagesPerFrame` more, read in a handful of
 * statements, no pairwise work) — never by every narrative ever made, which grows every day. A missing table (0093 not applied) is asked first, never caught: inside the transaction a
 * failed statement would abort the frame, so a board with no narratives is what an unmigrated
 * database shows.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { barWindowMs, coinCallFor, foldNarrativeCalls, totalReachSeries, linkReach, standsOnViralPost, withReproductions, gainedSeries, hiddenByOwner, isShillText, narrativeCoin, narrativeDead, narrativeReach, narrativeShown, narrativeSpeeds, reachGained, narrativeStanding, survivorOf, type NarrativeCoin, type NarrativeMemberCoin } from '@insidor/core';
import { PgNarrativeRepo, type Db, type NarrativePostRow, type StoredNarrative } from '@insidor/store';

import { loadCoinFactsByAddress, loadReach, nextTick, pictureOf, previousBoardStoryIds, sourceLabel, writeBoard, writeStories } from './db.ts';
import { onePolicy, policyForAnswer, type AnswerPolicies } from './judge-cutoff.ts';
import { loadCoinCalls } from './owner-calls.ts';
import { loadNarrativePicks } from './one-coin-cards.ts';
import { loadPostLookups } from './rising.ts';
import { checkedCoinOf, loadTrendCoins, trendWindows, type TrendSubject } from './narrative-trend.ts';
import { permalinkFor } from './permalinks.ts';
import { projectBoard, projectCoin, projectStory, type CoinCandidate, type MemberFacts, type ProjectOptions, type ReachReading, type StoryFacts } from './project.ts';
import { storySameNameLists, writeSameNameCoins } from './same-name.ts';
import { FORBIDDEN_SUBSTRINGS, instant, measured, WireLeakError, assertNoInternalVocabulary, type WireStory } from './wire.ts';

/** At most this many narratives on the board, as the old board's limit. */
const BOARD_LIMIT = 200;
/**
 * An older narrative whose page could not be written (a payload the censor caught, too few posts
 * it can cite) is not asked again for this long, in this process: never-written pages go first in
 * the queue, and one that can never be written would otherwise hold its place every frame.
 */
const UNWRITTEN_RETRY_MS = 3_600_000;
const unwritten = new Map<string, number>();

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

/** The source whose posts are held to the short-video bars (as rising.ts). */
const SHORT_VIDEO_SOURCE = 'tiktok';

const toMs = (v: Date | string | null): number | null => (v === null ? null : v instanceof Date ? v.getTime() : Date.parse(v));

/** One narrative this frame shows, with the posts it lists. */
export interface ShownNarrative {
  readonly id: string;
  readonly title: string | null;
  readonly members: readonly string[];
  readonly firstShownAtMs: number | null;
  /** The countries of the online meme war the titler said it is (0130); empty or null: not one, or never asked. Absent from an older caller. */
  readonly fight?: readonly string[] | null;
  /** ★ Listed before (0135 `listed_at`): held only to the owner's calls, and its page is written with any post it can still cite. */
  readonly kept?: boolean;
}

/**
 * The runner's narratives held to the rule NOW: each post's standing re-read, the owner's calls
 * re-folded. `shown` is the board (the newest, at most `BOARD_LIMIT`), `pages` the older ones whose
 * page is due this frame, `dropped` the ones looked at that are no longer narratives (their pages
 * go). Pure but for the reads; the board's input.
 */
export async function shownNarratives(db: Db, policy: Policy, answers: AnswerPolicies = onePolicy(policy), skip: readonly string[] = []): Promise<{ readonly shown: readonly ShownNarrative[]; readonly pages: readonly ShownNarrative[]; readonly dropped: readonly string[]; readonly standing: ReadonlyMap<string, NarrativePostRow>; readonly single: ReadonlySet<string> }> {
  const repo = new PgNarrativeRepo(db);
  if (!(await repo.migrated())) return { shown: [], pages: [], dropped: [], standing: new Map(), single: new Set() };
  const callRows = await repo.calls();
  const calls = foldNarrativeCalls(callRows);
  /* Room for the hidden ones among the newest, so the board still fills to its limit. */
  const newestFirst = await repo.newest(BOARD_LIMIT + calls.hidden.length);
  /* ★ A LIVE MEME WAR STAYS ON THE BOARD (the owner, 2026-10-25: "i cant see the multiple countries
     under twitter world war"): the newest 200 by their last post drop a war that went quiet for a
     day while its countries still count it live for `fight.activeMs`, and the tab's World War card
     is gathered only from the narratives the board lists. China vs Turkey's last post was a day old. */
  const quietWars = policy.narrative.fight.on
    ? (await repo.liveWars(Date.now() - policy.narrative.fight.activeMs)).filter((w) => !newestFirst.some((n) => n.id === w.id))
    : [];
  const newest = [...newestFirst, ...quietWars];
  const onBoard = new Set(newest.map((n) => n.id));
  const due = (await repo.pagesDue(policy.narrative.dead.pagesPerFrame, [...onBoard, ...skip])).filter((n) => !onBoard.has(n.id));
  /* ★ Every narrative an owner's hide could reach, wherever it is, so its page goes the frame he says so. */
  const hideIds = [...new Set([...calls.hidden.map((h) => h.narrativeId), ...(await repo.ofPosts([...new Set(calls.hidden.flatMap((h) => [...h.members]))])).values()])];
  const seen = new Set([...onBoard, ...due.map((n) => n.id)]);
  const hideCheck = (await repo.byIds(hideIds.filter((id) => !seen.has(id)))).filter((n) => !seen.has(n.id));
  const all: StoredNarrative[] = [...newest, ...due, ...hideCheck];
  const rows = await repo.standingRows([...new Set(all.flatMap((n) => n.members))]);
  const byId = new Map(rows.map((r) => [r.itemId, r] as const));
  /* ★ The viral floor's readings (Policy.narrative.origin.viralFloor): each post's early readings and its highest. */
  const bar = policy.narrative.origin.viralFloor ? await repo.barReadings([...new Set(all.flatMap((n) => n.members))], barWindowMs(policy)) : new Map();
  const viral = (listed: readonly string[]): boolean =>
    standsOnViralPost(
      listed.map((m) => {
        const b = bar.get(m);
        return { readings: b?.readings ?? [], postedAtMs: b?.postedAtMs ?? null, scale: b?.source === SHORT_VIDEO_SOURCE ? policy.rising.shortVideoReachScale : 1 };
      }),
      policy,
    );
  const good = (r: NarrativePostRow | undefined): boolean => {
    if (r === undefined) return false;
    const answer = r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt, proposedName: r.proposedName };
    const s = narrativeStanding({ answer, kindLabel: r.kindLabel, ownerCall: r.ownerCall, shill: isShillText(r.body, policy.attention) || r.ownTalk }, policyForAnswer(r.judgeId, answers));
    return s !== 'owner_not_meme' && s !== 'shill' && s !== 'held_kind';
  };
  const singles = new Set<string>();
  const dropped: string[] = [];
  const held = (n: StoredNarrative): ShownNarrative | null => {
    if (!n.shown) return null;
    /* A post the owner removed from beside these posts is off the list at once, before the regroup. */
    const removed = (m: string) => [...(calls.removed.get(m) ?? [])].some((x) => x !== m && n.members.includes(x));
    /* ★ A post the owner added ("Add a post", 0130) is listed whatever its kind or the shill rule say; only his own "Not a meme" takes it off. */
    const ownerAdded = (m: string) => calls.added.has(m) && byId.get(m) !== undefined && byId.get(m)?.ownerCall !== 'not';
    const listed = n.members.filter((m) => (good(byId.get(m)) || ownerAdded(m)) && !removed(m)).sort((a, b) => (byId.get(a)?.atMs ?? 0) - (byId.get(b)?.atMs ?? 0) || a.localeCompare(b));
    /* ★ ONCE LISTED, LISTED (the owner, 2026-10-24: "never remove narratives, bring them back"): a
       narrative whose page was ever written is held to his own calls only — his "Not a narrative" (or
       hiding enough of its posts), or his "Not a meme" and removals leaving it no post. A rule that
       moved since (the viral floor of 23 Oct deleted ~940 pages on their next turn), two posts from
       one account, a post judged an ad since: none takes the page. With no post it can cite now, it is
       not written and its last page stays. Merges never reach here: a merged narrative is not open. */
    if (n.listedAtMs !== null && n.listedAtMs !== undefined) {
      const ownerLeft = n.members.filter((m) => byId.get(m)?.ownerCall !== 'not' && !removed(m)).length;
      if (hiddenByOwner(n.id, listed, calls, policy) || ownerLeft === 0) {
        dropped.push(n.id);
        return null;
      }
      if (listed.length === 0) return null;
      return { id: n.id, title: n.title, members: listed, firstShownAtMs: n.firstShownAtMs, fight: n.fight ?? null, kept: true };
    }
    /* A narrative of one is shown only as the runner found it: huge and climbing at its last pass. */
    const single = n.members.length === 1 && n.shown;
    /* ★ Two accounts at least (the owner, 2026-10-18): one account's two posts are not a narrative; a
       post whose account is not known counts as its own. Under the rule its page goes (below) and it
       is kept, listed again the frame it grows. */
    const accounts = new Set(listed.map((m) => byId.get(m)?.authorKey ?? `post:${m}`)).size;
    /* ★ AND ON A VIRAL POST (the owner, 2026-10-23): at least one listed post clears For You's views
       bar. Small posts may join a viral story; two small posts are never listed as one. Kept, and
       listed again the frame a viral post joins — a viral starting post traced back late included. */
    if (narrativeShown(listed.length, single, hiddenByOwner(n.id, listed, calls, policy), policy, accounts) !== 'shown' || !viral(listed)) {
      dropped.push(n.id);
      return null;
    }
    if (single) singles.add(n.id);
    return { id: n.id, title: n.title, members: listed, firstShownAtMs: n.firstShownAtMs, fight: n.fight ?? null };
  };
  const shown = newest.flatMap((n) => {
    const h = held(n);
    return h === null ? [] : [h];
  }).slice(0, BOARD_LIMIT);
  const pages = [...due, ...hideCheck].flatMap((n) => {
    const h = held(n);
    return h === null ? [] : [h];
  });
  return { shown, pages, dropped, standing: byId, single: singles };
}

/**
 * The countries a page says are fighting: the titler's answer (two or more) while it lists at least
 * `narrative.fight.minPosts` posts and its newest is inside `activeMs`, else null — never for an
 * unknown post time, never when the question is switched off.
 */
export function countriesOf(fight: readonly string[] | null, lastPostAtMs: number | null, nowMs: number, policy: Policy, posts: number): readonly string[] | null {
  const f = policy.narrative.fight;
  if (!f.on || fight === null || fight.length < 2 || lastPostAtMs === null || posts < f.minPosts) return null;
  return nowMs - lastPostAtMs <= f.activeMs ? fight : null;
}

/** Each post's coin as its own card shows it, and the list behind a card's "See N coins". */
async function cardCoins(db: Db, itemIds: readonly string[], nowMs: number): Promise<ReadonlyMap<string, NarrativeMemberCoin>> {
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
  /* ★ A POST WITH NO CARD, OR A CARD STILL WAITING, READS ITS OWN SEARCH (2026-10-18). Most of a
     narrative's posts were never on a feed's last frame, so they had no card, and a narrative none
     of whose posts has one said "still checking for a coin" for good (373 of 411 pages on 18 Oct).
     The runner now searches every listed post (work/coin-lookup.ts); here such a post's coin is
     what its finished search (internal.coin_lookup) and the owner's calls on it say, by the cards'
     own rule: the owner's coin on it is confirmed, "No coin is from this" or a search that found
     none is searched-and-empty, the coins the search kept (minus those called wrong) are its list.
     Never proven: proving takes the weighing the feed does for its cards, and an unweighed coin is
     only ever a fitting one. Not searched yet stays null — the one honest "still checking". */
  const waiting = itemIds.filter((id) => {
    const card = out.get(id);
    return card === undefined || (card.listed === null && card.confirmed === null && card.proven === null);
  });
  if (waiting.length === 0) return out;
  /* One after the other: this runs on the projector's one transaction. */
  const searched = await loadPostLookups(db, waiting, nowMs);
  const calls = await loadCoinCalls(db, waiting);
  for (const id of waiting) {
    const call = calls.get(id);
    const lookup = searched.get(id);
    const own = call?.own ?? null;
    const list = call?.none === true ? [] : lookup !== undefined && 'coins' in lookup ? lookup.coins.filter((a) => call?.wrong.has(a) !== true) : null;
    if (own === null && list === null) continue;
    out.set(id, { itemId: id, confirmed: call?.none === true ? null : own, proven: null, listed: list });
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

/** Views a minute to one decimal under 10, whole above: what a card can say without false precision (as For You's). */
const perMin = (v: number): number => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));

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

export async function projectNarrativeFrame(db: Db, viewId: string, options: ProjectOptions, reachSinceMs: number, policy: Policy = DEFAULT_POLICY, answers: AnswerPolicies = onePolicy(policy)): Promise<NarrativeFrame> {
  const empty = { migrated: false, tick: 0, boardRows: 0, storyViews: 0, considered: 0, skipped: 0, withheld: 0, posts: 0 };
  if (!(await new PgNarrativeRepo(db).migrated())) return empty;
  const tick = await nextTick(db, viewId);
  const previous = await previousBoardStoryIds(db, viewId);
  for (const [id, at] of unwritten) if (options.nowMs - at >= UNWRITTEN_RETRY_MS) unwritten.delete(id);
  const { shown: boardSet, pages: offBoard, dropped, standing, single } = await shownNarratives(db, policy, answers, [...unwritten.keys()]);
  /* The board's narratives and the older pages due this frame are projected alike; only the board's get rows. */
  const shown = [...boardSet, ...offBoard];
  const boardIds = new Set(boardSet.map((n) => n.id));
  const ids = [...new Set(shown.flatMap((n) => n.members))];

  const rows = ids.length === 0 ? [] : await db.query<MemberRow>(
    `select i.item_id, i.source, i.source_item_id, i.posted_at, i.first_seen_at, i.body, i.media,
            a.handle, a.display_name, a.source_author_id, a.author_key
       from public.item i join public.author a on a.author_key = i.author_key
      where i.item_id = any($1::text[])`,
    [ids],
  );
  const rowOf = new Map(rows.map((r) => [r.item_id, r] as const));
  /* ★ "STARTED BY" ONLY ON PROOF (project.ts `projectEarliestPost`): the posts each listed post quotes
     or links, `origin.maxHops` steps out, so a narrative whose later posts quote its earliest one says
     so. Read by primary key; a post never read with its links proves nothing. */
  /* ★ And what each quotes (public.item `reproduction_of`, policy.v145): a quote names its quoted post in
     the payload, not among its links, so @liistrk's post, quoted by the Japanese and French posts it set
     off, proves "Started by" only through these. */
  const refs = new Map<string, readonly string[]>();
  let front: readonly string[] = ids;
  for (let hop = 0; hop < policy.narrative.origin.maxHops && front.length > 0; hop += 1) {
    const ask = front.filter((id) => !refs.has(id));
    const repo = new PgNarrativeRepo(db);
    const got = withReproductions(await repo.references(ask), await repo.quotes(ask));
    for (const [k, v] of got) refs.set(k, v);
    front = [...new Set([...got.values()].flat())].filter((id) => !refs.has(id));
  }
  /* Every reading of the narrative window: a post's newest count may be older than the board's reach window. */
  /* ★ Back a week: Most viewed's Week counts each post's gain over the last 7 days (about 12K readings, 18 Oct). */
  const weekMs = policy.rising.forYouSorts.mostViewedSpansMs.week;
  const reach = new Map(await loadReach(db, [...new Set(boardSet.flatMap((n) => n.members))], Math.min(reachSinceMs, options.nowMs - policy.narrative.windowMs, options.nowMs - weekMs) as Millis));
  /* An older page counts its posts' readings from its first post: a story four days old was read before the window. */
  const olderIds = [...new Set(offBoard.flatMap((n) => n.members))].filter((m) => !reach.has(m));
  const olderFrom = Math.min(...olderIds.map((m) => toMs(rowOf.get(m)?.posted_at ?? null) ?? toMs(rowOf.get(m)?.first_seen_at ?? null) ?? options.nowMs));
  if (olderIds.length > 0) for (const [k, v] of await loadReach(db, olderIds, Math.min(olderFrom, options.nowMs - policy.narrative.windowMs) as Millis)) reach.set(k, v);
  const cards = await cardCoins(db, ids, options.nowMs);
  const calls = foldNarrativeCalls(await new PgNarrativeRepo(db).calls());

  /* ★ ONE NARRATIVE, ONE COIN (one-coin-cards.ts), only in live mode: the owner's coin stays first;
     otherwise the runner's pick for the narrative, or no coin (Create) — never its posts' lists. */
  const live = policy.oneCoin.mode === 'live';
  const narrativePicks = live ? await loadNarrativePicks(db, shown.map((n) => n.id)) : new Map<string, string | null>();
  const coinOf = new Map<string, NarrativeCoin>();
  for (const n of shown) {
    const members = n.members.map((m) => cards.get(m) ?? { itemId: m, confirmed: null, proven: null, listed: null });
    const call = coinCallFor(n.id, new Set(n.members), calls);
    const decided = narrativeCoin(members, call, policy.postCoin.list.maxCoins);
    if (!live || decided.kind === 'confirmed') {
      coinOf.set(n.id, decided);
      continue;
    }
    const picked = narrativePicks.get(n.id);
    if (picked === undefined) coinOf.set(n.id, decided.kind === 'pending' ? decided : { kind: 'none' });
    else coinOf.set(n.id, picked === null || call?.wrong.has(picked) === true ? { kind: 'none' } : { kind: 'proven', addresses: [picked] });
  }
  const addresses = [...new Set([...coinOf.values()].flatMap((c) => (c.kind === 'confirmed' ? [c.address] : c.kind === 'proven' || c.kind === 'fitting' ? c.addresses : [])))];
  const coinFacts = await loadCoinFactsByAddress(db, addresses);

  const readingsOf = (id: string): readonly ReachReading[] => reach.get(id) ?? [];
  const facts: StoryFacts[] = [];
  const extras = new Map<string, Partial<WireStory>>();
  const subjects: TrendSubject[] = [];
  const deadIds = new Set<string>();
  for (const n of shown) {
    /* ★ Only posts the page can cite (a link we can build): the list, the count and the summary are one set. */
    /* The earliest listed post by when it went up, and which of the others lead back to it by quotes. */
    const earliest = [...n.members].filter((m) => toMs(rowOf.get(m)?.posted_at ?? null) !== null).sort((a, b) => (toMs(rowOf.get(a)?.posted_at ?? null) ?? 0) - (toMs(rowOf.get(b)?.posted_at ?? null) ?? 0) || a.localeCompare(b))[0] ?? null;
    const quotesFirst = (m: string): boolean => earliest !== null && m !== earliest && linkReach(m, refs, policy.narrative.origin.maxHops).has(earliest);
    const members: MemberFacts[] = n.members.flatMap((m) => {
      const r = rowOf.get(m);
      const link = r === undefined ? null : permalinkFor(r.source, r.handle, r.source_item_id);
      if (r === undefined || link === null || !link.startsWith('https://')) return [];
      /* ★ A post whose words name a vendor the wire never carries (wire.ts FORBIDDEN_SUBSTRINGS, e.g. AI news
         naming "Anthropic") is left out of its narrative's cited posts, not the narrative with it (2026-10-28:
         five narratives were dropped on every pass for one such post each). The guard below stays as strict. */
      const words = `${r.body ?? ''} ${authorLabelOf(r) ?? ''}`.toLowerCase();
      if (FORBIDDEN_SUBSTRINGS.some((bad) => words.includes(bad))) return [];
      return [{
        itemId: m,
        sourceLabel: sourceLabel(r.source),
        authorLabel: authorLabelOf(r),
        postedAt: toMs(r.posted_at) as Millis | null,
        excerpt: r.body,
        thumbUrl: pictureOf(r.media)?.uri ?? null,
        permalink: link,
        relation: quotesFirst(m) ? { kind: 'lineage' as const, via: 'reproduction' as const, toItem: earliest } : { kind: 'representation' as const },
        reach: readingsOf(m),
      }];
    });
    /* A listed one is written with any post it can cite: its page must not wait for a rule to pass again. */
    if (members.length < (n.kept === true ? 1 : policy.narrative.minPosts) && !(members.length === 1 && single.has(n.id))) continue;
    const latest = (m: MemberFacts): number => {
      const last = [...m.reach].reverse().find((x) => x.count !== undefined && x.count !== null);
      return last?.count ?? -1;
    };
    /* The best picture: the most-seen post that has one. */
    const picture = [...members].filter((m) => m.thumbUrl !== null).sort((a, b) => latest(b) - latest(a) || a.itemId.localeCompare(b.itemId))[0]?.thumbUrl ?? null;
    const used = members.map((m) => rowOf.get(m.itemId)).filter((r): r is MemberRow => r !== undefined);
    const coin = coinOf.get(n.id) ?? { kind: 'pending' };
    /* ★ Dead: its newest listed post (when it went up, else when we saved it) is the owner's 48 hours old. */
    const newestAt = Math.max(...used.map((r) => toMs(r.posted_at) ?? toMs(r.first_seen_at) ?? 0));
    const lastPostAtMs = Number.isFinite(newestAt) && newestAt > 0 ? newestAt : null;
    const dead = narrativeDead(lastPostAtMs, options.nowMs, policy);
    const countries = countriesOf(n.fight ?? null, lastPostAtMs, options.nowMs, policy, members.length);
    if (dead) deadIds.add(n.id);
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
    const memberReach = members.map((m) => ({ postedAtMs: m.postedAt, points: m.reach.map((x) => ({ atMs: x.atMs, reach: x.count ?? null })) }));
    const views = narrativeReach(memberReach, options.nowMs, policy);
    /* The tab's sorts (core rank/narrative-sorts.ts): For You's speeds, added up over the measured posts, and the day's and week's gains. */
    const speeds = narrativeSpeeds(members.map((m) => ({ readings: m.reach.map((x) => ({ atMs: x.atMs, value: x.count ?? null })), source: rowOf.get(m.itemId)?.source ?? '' })), options.nowMs, policy);
    const spans = policy.rising.forYouSorts.mostViewedSpansMs;
    /* ★ FIRST FOUND: the earliest moment we saved any post it lists NOW, so removing a post moves it. */
    const found = used.map((r) => toMs(r.first_seen_at)).filter((t): t is number => t !== null && Number.isFinite(t));
    const foundAtMs = found.length === 0 ? null : Math.min(...found);
    const foundOf = (m: MemberFacts): number | null => {
      const t = toMs(rowOf.get(m.itemId)?.first_seen_at ?? null);
      return t !== null && Number.isFinite(t) ? t : null;
    };
    subjects.push({
      id: n.id,
      input: {
        foundAtMs,
        posts: members.map((m, i) => ({ authorKey: rowOf.get(m.itemId)?.author_key ?? m.itemId, sourceKey: rowOf.get(m.itemId)?.source ?? '', foundAtMs: foundOf(m), reach: memberReach[i] ?? { postedAtMs: null, points: [] }, reachScale: rowOf.get(m.itemId)?.source === SHORT_VIDEO_SOURCE ? policy.rising.shortVideoReachScale : 1 })),
      },
      coin: checkedCoinOf(coin),
    });
    /* "All": from its first reading to now in coarser slots, at most the window's length (an older story's line is its last two days). */
    const r = policy.narrative.reach;
    const all = gainedSeries(memberReach, Math.max(options.nowMs - policy.narrative.windowMs, foundAtMs ?? options.nowMs), options.nowMs, r.allStepMs, Math.ceil(policy.narrative.windowMs / r.allStepMs));
    /* ★ Total views over time (core `totalReachSeries`): the day in five-minute slots and the window in
       "All"'s, each post's views brought in over the time it was up before we read it. */
    const totals = totalReachSeries(memberReach, options.nowMs - r.spanMs, options.nowMs, r.stepMs, Math.floor(r.spanMs / r.stepMs));
    const totalsAll = totalReachSeries(memberReach, options.nowMs - policy.narrative.windowMs, options.nowMs, r.allStepMs, Math.ceil(policy.narrative.windowMs / r.allStepMs));
    extras.set(n.id, {
      postIds: members.map((m) => m.itemId),
      postCount: members.length,
      viewsTotal: measured(views.total.value, 'not_read_yet'),
      viewsTotalPosts: views.total.counted,
      viewsGained1h: measured(views.lastHour.value, 'not_read_yet'),
      viewsGained1hPosts: views.lastHour.counted,
      viewsGained: views.gained,
      viewsGainedAll: all,
      viewsTotals: totals,
      viewsTotalsAll: totalsAll,
      viewsPerMinute: speeds === null ? null : { now: perMin(speeds.now), before: perMin(speeds.before), posts: speeds.posts, nowBySource: Object.fromEntries(Object.entries(speeds.nowBySource).map(([k, v]) => [k, perMin(v)])) },
      viewsGainedDay: measured(reachGained(memberReach, options.nowMs - spans.today, options.nowMs).value, 'not_read_yet'),
      viewsGainedWeek: measured(reachGained(memberReach, options.nowMs - spans.week, options.nowMs).value, 'not_read_yet'),
      postViews: members.map((m, i) => ({ postId: m.itemId, views: views.posts[i]?.total ?? null, gainedLastHour: views.posts[i]?.lastHour ?? null, foundAt: foundOf(m) })),
      foundAt: instant(foundAtMs, 'not_reported'),
      dead,
      lastPostAt: instant(lastPostAtMs, 'not_reported'),
      /* ★ An online meme war between countries (Policy.narrative.fight): said while a listed post went up
         in the last `activeMs`, so the app's umbrella holds only fights still being posted. */
      ...(countries === null ? {} : { countries }),
      /* ★ The top coin when none is settled (fitting, or several proven equally): shown as "Top coin,
         not checked", never as the narrative's coin. The coins most posts list come first. */
      ...(coin.kind === 'fitting' || (coin.kind === 'proven' && coin.addresses.length > 1) ? topCoinOf(coin.addresses, coinFacts, options) : {}),
    });
  }

  /* ★ TRENDING FIRST (narrative-trend.ts): each window's facts and place on every page, and the board
     in the first window's order, the tab's default. A story with no reading in it goes after every
     one that has one, never as a slow story. */
  const coinsRead = await loadTrendCoins(db, [...new Set(subjects.flatMap((s) => (s.coin === null ? [] : [s.coin])))], options.nowMs, policy.narrative.trend.windows.map((w) => w.ms));
  /* Trending is the board's live narratives only: an older page and a dead one get the facts, no place. */
  const trend = trendWindows(subjects.filter((x) => boardIds.has(x.id) || deadIds.has(x.id)), coinsRead, options.nowMs, policy, deadIds);
  const offTrend = subjects.filter((x) => !boardIds.has(x.id) && !deadIds.has(x.id));
  if (offTrend.length > 0) for (const [id, inWindow] of trendWindows(offTrend, coinsRead, options.nowMs, policy, new Set(offTrend.map((x) => x.id))).pages) trend.pages.set(id, inWindow);
  for (const [id, inWindow] of trend.pages) extras.set(id, { ...extras.get(id), inWindow });
  const place = new Map(trend.order.map((id, i) => [id, i] as const));
  const byTrend = (list: readonly StoryFacts[]) => [...list].sort((a, b) => (place.get(a.storyId) ?? Number.MAX_SAFE_INTEGER) - (place.get(b.storyId) ?? Number.MAX_SAFE_INTEGER) || b.lastMemberAt - a.lastMemberAt);
  const board = projectBoard(facts.filter((f) => boardIds.has(f.storyId)), options, byTrend);
  for (const id of board.withheld) console.warn(`narrative ${id} was withheld from the board: its payload would have leaked`);
  const onBoard = new Set(board.order);

  const pages: WireStory[] = [];
  let skipped = 0;
  for (const story of facts) {
    if (boardIds.has(story.storyId) && !onBoard.has(story.storyId)) continue;
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
  for (const n of offBoard) if (!paged.has(n.id)) unwritten.set(n.id, options.nowMs);
  /* ★ And one the rule dropped (too few posts, no viral post): tried, nothing to write, so it waits
     `UNWRITTEN_RETRY_MS` instead of taking a place in the page queue every frame. */
  for (const id of dropped) unwritten.set(id, options.nowMs);
  const boardRows = await writeBoard(db, viewId, tick, rowsWithPages, { kind: 'observed' });
  const storyViews = await writeStories(db, pages);
  /* ★ Every page written is listed from now on (0135): no later rule takes it. */
  await new PgNarrativeRepo(db).markListed([...paged]);
  /* ★ A PAGE GOES ONLY WITH ITS NARRATIVE: one the owner hid (or left under `minPosts` good posts),
     one merged, and anything that is not a narrative at all. Every other page stays — the board
     moving on is not a reason — so a story page, search, the post sheet and alerts keep serving it. */
  await db.query(
    `delete from public.story_view v
      where v.story_id = any($1::text[])
         or not exists (select 1 from internal.narrative n where n.narrative_id = v.story_id and n.state = 'open' and n.shown)`,
    [dropped.filter((id) => !paged.has(id))],
  );
  const coinsByStory = new Map(rowsWithPages.map((row) => [row.id, row.coins]));
  await writeSameNameCoins(db, 'story', storySameNameLists(facts.filter((f) => paged.has(f.storyId) && boardIds.has(f.storyId)), coinsByStory));

  /* ★ Each listed post's narrative, its title and post count: the cards' tag and the post sheet's tile.
     Rewritten for the pages written this frame; kept for every page that stays; gone with a page. */
  const posts = pages.flatMap((p) => (p.postIds ?? []).map((itemId) => ({ itemId, storyId: p.id, title: p.title, posts: p.postCount ?? p.evidence.length })));
  await db.query(`delete from public.story_post p where p.story_id = any($1::text[]) or not exists (select 1 from public.story_view v where v.story_id = p.story_id)`, [[...paged]]);
  if (posts.length > 0) {
    await db.query(
      `insert into public.story_post (item_id, story_id, title, posts)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::int[])
       on conflict (item_id) do update set story_id = excluded.story_id, title = excluded.title, posts = excluded.posts, projected_at = now()`,
      [posts.map((p) => p.itemId), posts.map((p) => p.storyId), posts.map((p) => p.title), posts.map((p) => p.posts)],
    );
  }
  await writeAliases(db);
  return { migrated: true, tick, boardRows, storyViews, considered: shown.length, skipped, withheld: board.withheld.length, posts: posts.length };
}

/**
 * ★ A MERGED NARRATIVE'S LINK OPENS THE ONE IT WAS MERGED INTO (0106 public.story_alias): every
 * merged narrative, by the owner or by the old regroup (16-18 Oct), to the open narrative at the end
 * of its merges. Rewritten whole each frame — a few hundred rows at most, one statement each way —
 * and skipped before 0106.
 */
async function writeAliases(db: Db): Promise<void> {
  const [has] = await db.query<{ ok: boolean }>(`select to_regclass('public.story_alias') is not null as ok`);
  if (has?.ok !== true) return;
  const rows = await new PgNarrativeRepo(db).merged();
  const states = new Map(rows.map((r) => [r.id, { state: r.state, mergedInto: r.mergedInto }] as const));
  const alias = rows.filter((r) => r.state === 'merged').flatMap((r) => {
    const into = survivorOf(r.id, states);
    return into === null || into === r.id ? [] : [{ from: r.id, into }];
  });
  await db.query(`delete from public.story_alias where not (story_id = any($1::text[]))`, [alias.map((a) => a.from)]);
  if (alias.length > 0) {
    await db.query(
      `insert into public.story_alias (story_id, into_story_id) select * from unnest($1::text[], $2::text[])
       on conflict (story_id) do update set into_story_id = excluded.into_story_id, projected_at = now()`,
      [alias.map((a) => a.from), alias.map((a) => a.into)],
    );
  }
}
