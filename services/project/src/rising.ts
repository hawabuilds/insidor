/**
 * THE FOR YOU AND POPULAR FEEDS: single posts, projected once and served verbatim.
 *
 * Which posts: the earlier build's rule. A post the catch-all search found (0025's
 * `item_found_by`), observed rather than seeded, posted inside `rising.windowMs`, whose
 * meme score — the judge's answer about that post alone — clears core's `postScore`. A post
 * with no score yet is not here: it waits, and is never shown as if it had passed.
 *
 * In what order: `fyp` newest first by post time; `popular` most views first, and a post
 * whose views we have not read goes after every post whose views we have. The client never
 * sorts.
 *
 * What each row says: facts only — where it was posted, by whom, a link to it, its text,
 * its picture, when, how many saw it and when we read that, and the views line. Never the
 * score, never anything TRACK or the judge computed.
 *
 * ★ A COIN ONLY THROUGH A CONFIDENT NARRATIVE. A single post carries no coin of its own.
 * When it belongs to a promoted story whose board row, in THIS frame, names exactly one coin
 * (`coins.kind === 'one'`), the row carries that story's id and that coin, so the Buy button
 * it puts on screen is the board's own confident answer. Any other link — none, unsure,
 * several — and the row carries no coin and no story id at all, so nothing can be assembled
 * into a button. See docs/rising-posts-plan.md, adjusted by this rule.
 *
 * What breaks if changed carelessly: the coin is read from the board rows committed in the
 * same projection run. Reading it from anywhere else would let a post offer Buy on a coin
 * the narrative's own row has since stopped naming.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { postScore } from '@insidor/core';
import type { Db } from '@insidor/store';

import { firstImageUri, loadReach, sourceLabel } from './db.ts';
import { permalinkFor } from './permalinks.ts';
import { projectReach, projectSpark } from './project.ts';
import type { ReachReading } from './project.ts';
import { assertNoInternalVocabulary, instant } from './wire.ts';
import type { WireCoinLink, WireInstant, WireMeasured, WireSpark } from './wire.ts';

export const RISING_FEEDS = ['fyp', 'popular'] as const;
export type RisingFeed = (typeof RISING_FEEDS)[number];

const EXCERPT_MAX_CHARS = 280;

/** One single post on a feed. Twelve keys, every one a fact. */
export interface WireRisingPost {
  readonly id: string;
  readonly sourceLabel: string;
  readonly authorLabel: string;
  /** Null when we hold no handle to build one from; the row then has no link, never a guessed one. */
  readonly permalink: string | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  readonly postedAt: WireInstant;
  readonly reach: WireMeasured;
  /** When the view count above was read, so its age travels with it. */
  readonly readAt: WireInstant;
  readonly spark: WireSpark;
  /** The narrative this post is part of — only when that narrative has one confident coin. */
  readonly storyId: string | null;
  /** That narrative's one coin, or null. Never `none`, `unsure` or `several`. */
  readonly coins: Extract<WireCoinLink, { kind: 'one' }> | null;
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
  looked_at: 'text' | 'videoFrame';
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

function authorLabelOf(row: RisingRow): string {
  const handle = (row.handle ?? '').trim();
  if (handle !== '') return handle.startsWith('@') ? handle : `@${handle}`;
  const name = (row.display_name ?? '').trim();
  return name !== '' ? name : row.source_author_id;
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
): WireRisingPost {
  const latest = readings[readings.length - 1];
  const link = row.story_id === null ? undefined : coinsByStory.get(row.story_id);
  const confident = link !== undefined && link.kind === 'one' ? link : null;
  const handle = (row.handle ?? '').trim().replace(/^@/, '');
  const post: WireRisingPost = {
    id: row.item_id,
    sourceLabel: sourceLabel(row.source),
    authorLabel: authorLabelOf(row),
    permalink: handle === '' ? null : permalinkFor(row.source, handle, row.source_item_id),
    excerpt: trimTo(row.body, EXCERPT_MAX_CHARS),
    thumbUrl: firstImageUri(row.media),
    postedAt: instant(toMs(row.posted_at), 'not_reported'),
    reach: projectReach(readings),
    readAt: instant(latest?.atMs ?? null, 'not_read_yet'),
    spark: projectSpark(readings, sparkWindowMs),
    storyId: confident === null ? null : row.story_id,
    coins: confident,
  };
  assertNoInternalVocabulary(post, `$.rising[${row.item_id}]`);
  return post;
}

export interface RisingFrame {
  readonly fyp: readonly WireRisingPost[];
  readonly popular: readonly WireRisingPost[];
}

/** Load, filter by the per-post score, project, and order both feeds. Writes nothing. */
export async function buildRising(
  db: Db,
  nowMs: Millis,
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  sparkWindowMs: number,
  policy = DEFAULT_POLICY,
): Promise<RisingFrame> {
  const sinceMs = (nowMs - policy.rising.windowMs) as Millis;
  const rows = (await loadCandidates(db, sinceMs)).filter(
    (row) => postScore({ coinable: row.coinable, confidence: row.confidence, lookedAt: row.looked_at, proposedName: row.proposed_name }, policy) === 'passes',
  );
  const reach = await loadReach(db, rows.map((row) => row.item_id), sinceMs);
  const posts = rows.map((row) => ({
    post: projectRisingPost(row, reach.get(row.item_id) ?? [], coinsByStory, sparkWindowMs),
    at: toMs(row.posted_at) ?? toMs(row.first_seen_at) ?? 0,
  }));

  const fyp = [...posts].sort((a, b) => b.at - a.at || a.post.id.localeCompare(b.post.id));
  const views = (p: WireRisingPost): number | null => p.reach.v;
  const popular = [...posts].sort((a, b) => {
    const va = views(a.post);
    const vb = views(b.post);
    if (va === null || vb === null) return va === null ? (vb === null ? b.at - a.at : 1) : -1;
    return vb - va || b.at - a.at;
  });
  const cap = (list: typeof posts) => list.slice(0, policy.rising.maxRows).map((p) => p.post);
  return { fyp: cap(fyp), popular: cap(popular) };
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
): Promise<number> {
  const frame = await buildRising(db, nowMs, coinsByStory, sparkWindowMs);
  return (await writeRising(db, 'fyp', frame.fyp)) + (await writeRising(db, 'popular', frame.popular));
}
