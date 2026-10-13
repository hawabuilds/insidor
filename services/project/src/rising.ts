/**
 * THE FOR YOU AND POPULAR FEEDS: single posts, projected once and served verbatim.
 *
 * Which posts: the earlier build's rule. A post the catch-all search found (0025's
 * `item_found_by`), observed rather than seeded, posted inside `rising.windowMs`, whose
 * meme score — the judge's answer about that post alone — clears core's `postScore`. A post
 * with no score yet is not here: it waits, and is never shown as if it had passed.
 * And it must clear the feed's view bar (core's `clearsReachBar`): For You at 40k views or fast
 * early growth, Popular at 250k. A post whose views we have not read is on neither.
 *
 * In what order: `fyp` newest first by post time; `popular` most views first, and a post
 * whose views we have not read goes after every post whose views we have. The client never
 * sorts.
 *
 * What each row says: facts only — where it was posted, by whom, a link to it, its text
 * (without the trailing short links X appends), its picture (a video's preview counts, flagged
 * so the card draws a play icon), when, how many saw it and when we read that, and the views
 * line. Never the score, never anything
 * TRACK or the judge computed.
 *
 * ★ EVERY ROW SAYS WHERE ITS COIN STANDS, AND A COIN ONLY EVER COMES THROUGH A NARRATIVE.
 * `coins` is never null; it is one of these, decided in `postCoins` below:
 *
 *   the post's promoted story names one coin, several, or is unsure → that story's own link,
 *                                       with its story id (if the read has a story, the story
 *                                       decides) — so a Buy button is the board's confident
 *                                       answer and nothing else;
 *   the post's name was searched (internal.coin_lookup) and nothing came back → `none`;
 *   it was searched and launchpad coins came back → `unsure` with that count: coins exist,
 *                                       and nothing has said which, if any, is this post's;
 *   the post's story was searched and has none → `none`;
 *   no search has finished `universe.lookup.giveUpMs` after the post entered the feed (as the
 *                                       lookup first saw it, internal.coin_lookup_attempt) →
 *                                       `unchecked`, "Couldn't check", with no button;
 *   nothing searched yet                → `pending`, a dash — never "no coin yet", which
 *                                       would be a claim about the world we had not checked.
 *
 * A search never puts a coin on a post: the one-coin link only ever comes from a story's row.
 *
 * What breaks if changed carelessly: the story's link is read from the board rows committed in
 * the same projection run. Reading it from anywhere else would let a post offer Buy on a coin
 * the narrative's own row has since stopped naming.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { clearsReachBar, postScoreReason, type ReachLevel } from '@insidor/core';
import { PgFeedRejectionRepo, type Db, type FeedRejectionReason } from '@insidor/store';

import { loadReach, pictureOf, sourceLabel } from './db.ts';
import { permalinkFor } from './permalinks.ts';
import { projectReach, projectSpark } from './project.ts';
import type { ReachReading } from './project.ts';
import { assertNoInternalVocabulary, instant } from './wire.ts';
import type { WireCoinLink, WireInstant, WireMeasured, WirePostCoinLink, WireSpark } from './wire.ts';

export const RISING_FEEDS = ['fyp', 'popular'] as const;
export type RisingFeed = (typeof RISING_FEEDS)[number];

const EXCERPT_MAX_CHARS = 280;

/** One single post on a feed. Thirteen keys, every one a fact. */
export interface WireRisingPost {
  readonly id: string;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  /** Null when we hold no handle to build one from; the row then has no link, never a guessed one. */
  readonly permalink: string | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  /** True when `thumbUrl` is a still of the post's video (an X preview, a TikTok cover). */
  readonly thumbIsVideo: boolean;
  readonly postedAt: WireInstant;
  readonly reach: WireMeasured;
  /** When the view count above was read, so its age travels with it. */
  readonly readAt: WireInstant;
  readonly spark: WireSpark;
  /** The narrative this post is part of — only when `coins` below is that narrative's own link. */
  readonly storyId: string | null;
  /** Where the post's coin stands. `one` and `several` only ever arrive with `storyId`. */
  readonly coins: WirePostCoinLink;
}

interface RisingRow {
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
  coinable: boolean;
  confidence: number;
  looked_at: 'text' | 'picture' | 'videoFrame';
  proposed_name: string | null;
  story_id: string | null;
}

const toMs = (value: Date | string | null): Millis | null => {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? (ms as Millis) : null;
};

/**
 * Every catch-all post inside the window with its newest per-post score and the promoted
 * story it belongs to, if any. The service role reads `internal`; the score never leaves
 * this function except as the yes or no `postScore` makes of it.
 */
async function loadCandidates(db: Db, sinceMs: Millis): Promise<readonly RisingRow[]> {
  return db.query<RisingRow>(
    `select i.item_id, i.source, i.source_item_id, i.posted_at, i.first_seen_at, i.body, i.media,
            a.handle, a.display_name, a.source_author_id,
            j.coinable, j.confidence, j.looked_at, j.proposed_name,
            s.story_id
       from internal.item_found_by f
       join public.item i on i.item_id = f.item_id
       join public.author a on a.author_key = i.author_key
       join lateral (
              select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name
                from internal.post_judgement pj
               where pj.item_id = i.item_id
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) j on true
       left join lateral (
              select m.story_id
                from public.story_member m
                join public.story st on st.story_id = m.story_id
               where m.item_id = i.item_id and st.state = 'promoted' and st.merged_into is null
               order by m.joined_at asc
               limit 1
            ) s on true
      where i.origin = 'observed'
        and coalesce(i.posted_at, i.first_seen_at) >= $1`,
    [new Date(sinceMs).toISOString()],
  );
}

/**
 * Which posts have had their name searched for coins, and how many launchpad coins came back;
 * and which have waited `giveUpMs` since the lookup first saw them in the feed with no search
 * finished. A post in neither has not been searched yet. `term` is not selected: the name is the
 * judge's. A post the lookup has never seen waiting is never given up on: the clock starts when
 * the lookup saw it, not when the post was made, so a post that reaches the feed late is not
 * "Couldn't check" on arrival.
 */
async function loadPostLookups(
  db: Db,
  itemIds: readonly string[],
  nowMs: number = Date.now(),
  giveUpMs: number = DEFAULT_POLICY.universe.lookup.giveUpMs,
): Promise<ReadonlyMap<string, PostLookup>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db.query<{ subject_id: string; found: number | null }>(
    `select a.subject_id, l.found
       from (select unnest($1::text[]) as subject_id) a
       left join internal.coin_lookup l on l.subject_kind = 'post' and l.subject_id = a.subject_id
       left join internal.coin_lookup_attempt q on q.subject_kind = 'post' and q.subject_id = a.subject_id
      where l.subject_id is not null or q.queued_at <= $2`,
    [[...itemIds], new Date(nowMs - giveUpMs).toISOString()],
  );
  return new Map(rows.map((r) => [r.subject_id, r.found === null ? { gaveUp: true } : { found: Number(r.found) }]));
}

/** A finished search for a post's name and how many launchpad coins it returned, or none in time. */
export type PostLookup = { readonly found: number } | { readonly gaveUp: true };

/** The row's coin line and the story it came from, by the rule in the header. */
export function postCoins(
  storyLink: WireCoinLink | undefined,
  lookup: PostLookup | null,
): { readonly coins: WirePostCoinLink; readonly fromStory: boolean } {
  if (storyLink !== undefined && (storyLink.kind === 'one' || storyLink.kind === 'several' || storyLink.kind === 'unsure')) {
    return { coins: storyLink, fromStory: true };
  }
  if (lookup !== null && 'found' in lookup) {
    return { coins: lookup.found === 0 ? { kind: 'none' } : { kind: 'unsure', claimCount: lookup.found }, fromStory: false };
  }
  if (storyLink !== undefined && storyLink.kind === 'none') return { coins: storyLink, fromStory: true };
  if (lookup !== null) return { coins: { kind: 'unchecked' }, fromStory: false };
  return { coins: { kind: 'pending' }, fromStory: false };
}

function authorLabelOf(row: RisingRow): string {
  const handle = (row.handle ?? '').trim();
  if (handle !== '') return handle.startsWith('@') ? handle : `@${handle}`;
  const name = (row.display_name ?? '').trim();
  return name !== '' ? name : row.source_author_id;
}

/**
 * The post's words without the short links X appends for its own media and link cards. The
 * picture is already on the card and the post's own link is the card's tap, so a trailing
 * `https://t.co/…` is noise that costs a line. Only trailing ones go: a link in the middle of a
 * sentence is part of what was said.
 */
export function withoutTrailingShortLinks(text: string): string {
  return text.replace(/(?:\s*https?:\/\/t\.co\/[A-Za-z0-9]+)+\s*$/i, '');
}

function trimTo(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const points = Array.from(collapsed);
  if (points.length <= max) return collapsed;
  const cut = points.slice(0, max).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function projectRisingPost(
  row: RisingRow,
  readings: readonly ReachReading[],
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  sparkWindowMs: number,
  lookup: PostLookup | null = null,
): WireRisingPost {
  const latest = readings[readings.length - 1];
  const link = row.story_id === null ? undefined : coinsByStory.get(row.story_id);
  const coin = postCoins(link, lookup);
  const handle = (row.handle ?? '').trim().replace(/^@/, '');
  const picture = pictureOf(row.media);
  const post: WireRisingPost = {
    id: row.item_id,
    sourceLabel: sourceLabel(row.source),
    authorLabel: authorLabelOf(row),
    permalink: handle === '' ? null : permalinkFor(row.source, handle, row.source_item_id),
    excerpt: trimTo(withoutTrailingShortLinks(row.body), EXCERPT_MAX_CHARS),
    thumbUrl: picture?.uri ?? null,
    thumbIsVideo: picture?.isVideo ?? false,
    postedAt: instant(toMs(row.posted_at), 'not_reported'),
    reach: projectReach(readings),
    readAt: instant(latest?.atMs ?? null, 'not_read_yet'),
    spark: projectSpark(readings, sparkWindowMs),
    storyId: coin.fromStory ? row.story_id : null,
    coins: coin.coins,
  };
  assertNoInternalVocabulary(post, `$.rising[${row.item_id}]`);
  return post;
}

export interface RisingFrame {
  readonly fyp: readonly WireRisingPost[];
  readonly popular: readonly WireRisingPost[];
  /**
   * Why each scored post in the window is not on For You: the failed check, or a reach reason.
   * Read only to record why a post that WAS showing left (public.feed_rejection); never sent.
   */
  readonly whyNot: ReadonlyMap<string, FeedRejectionReason>;
}

/** Load, filter by the per-post score and each feed's view bar, project, and order both feeds. Writes nothing. */
export async function buildRising(
  db: Db,
  nowMs: Millis,
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  sparkWindowMs: number,
  policy = DEFAULT_POLICY,
): Promise<RisingFrame> {
  const sinceMs = (nowMs - policy.rising.windowMs) as Millis;
  const whyNot = new Map<string, FeedRejectionReason>();
  const rows = (await loadCandidates(db, sinceMs)).filter((row) => {
    const why = postScoreReason({ coinable: row.coinable, confidence: row.confidence, lookedAt: row.looked_at, proposedName: row.proposed_name }, policy);
    if (why !== 'passes') whyNot.set(row.item_id, why);
    return why === 'passes';
  });
  const reach = await loadReach(db, rows.map((row) => row.item_id), sinceMs);
  const lookups = await loadPostLookups(db, rows.map((row) => row.item_id));
  const posts = rows.map((row) => {
    const readings = reach.get(row.item_id) ?? [];
    /* Measured counts only: a censored reading's last level is an older number, and read at a
       later time it would overstate how fast the post grew. */
    const views: ReachLevel[] = readings.map((x) => ({ atMs: x.atMs, reach: x.rate.kind === 'measured' ? x.rate.level : null }));
    const postedAt = toMs(row.posted_at);
    return {
      post: projectRisingPost(row, readings, coinsByStory, sparkWindowMs, lookups.get(row.item_id) ?? null),
      at: postedAt ?? toMs(row.first_seen_at) ?? 0,
      fyp: clearsReachBar('fyp', views, postedAt, policy),
      unread: views.every((v) => v.reach === null),
      popular: clearsReachBar('popular', views, postedAt, policy),
    };
  });

  const fyp = posts.filter((p) => p.fyp).sort((a, b) => b.at - a.at || a.post.id.localeCompare(b.post.id));
  const views = (p: WireRisingPost): number | null => p.reach.v;
  const popular = posts.filter((p) => p.popular).sort((a, b) => {
    const va = views(a.post);
    const vb = views(b.post);
    if (va === null || vb === null) return va === null ? (vb === null ? b.at - a.at : 1) : -1;
    return vb - va || b.at - a.at;
  });
  const cap = (list: typeof posts) => list.slice(0, policy.rising.maxRows).map((p) => p.post);
  for (const p of posts) if (!p.fyp) whyNot.set(p.post.id, p.unread ? 'reach_unread' : 'under_reach_bar');
  return { fyp: cap(fyp), popular: cap(popular), whyNot };
}

/** Write one feed's frame: the view row first, then its rows, in the caller's transaction. */
export async function writeRising(db: Db, feedId: RisingFeed, posts: readonly WireRisingPost[]): Promise<number> {
  const current = await db.query<{ tick: string }>(`select tick::text as tick from public.rising_view where feed_id = $1`, [feedId]);
  const tick = current[0] === undefined ? 1 : Number(current[0].tick) + 1;
  await db.query(
    `insert into public.rising_view (feed_id, tick, projected_at) values ($1, $2, now())
     on conflict (feed_id) do update set tick = excluded.tick, projected_at = excluded.projected_at`,
    [feedId, tick],
  );
  await db.query(`delete from public.rising_row where feed_id = $1 and item_id <> all($2::text[])`, [
    feedId,
    posts.map((post) => post.id),
  ]);
  for (const [position, post] of posts.entries()) {
    await db.query(
      `insert into public.rising_row (feed_id, item_id, position, payload) values ($1, $2, $3, $4::jsonb)
       on conflict (feed_id, item_id) do update set position = excluded.position, payload = excluded.payload`,
      [feedId, post.id, position, JSON.stringify(post)],
    );
  }
  return posts.length;
}

/** Both feeds, built and written: what one projection run does. `main.ts` and the e2e test call this. */
export async function projectRisingFeeds(
  db: Db,
  nowMs: Millis,
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  sparkWindowMs: number,
  policy = DEFAULT_POLICY,
): Promise<number> {
  const frame = await buildRising(db, nowMs, coinsByStory, sparkWindowMs, policy);
  /* ★ WHAT LEFT, AND WHY. A post that was on a feed and is not now is recorded with the check it
     failed — kept as a "no" example, never deleted. A post that only aged out of the window is
     not a rejection and has no reason here, so it is not recorded. */
  const showing = await db.query<{ item_id: string }>(`select distinct item_id from public.rising_row`);
  const now = new Set([...frame.fyp, ...frame.popular].map((p) => p.id));
  const left = showing.flatMap(({ item_id }) => {
    const why = now.has(item_id) ? undefined : frame.whyNot.get(item_id);
    return why === undefined ? [] : [{ kind: 'post' as const, id: item_id, reason: why, detail: null }];
  });
  await new PgFeedRejectionRepo(db).record(left);
  return (await writeRising(db, 'fyp', frame.fyp)) + (await writeRising(db, 'popular', frame.popular));
}
