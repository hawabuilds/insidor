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
 * ★ EVERY ROW SAYS WHERE ITS COIN STANDS. `coins` is never null; it is one of these, decided in
 * `postCoins` below:
 *
 *   the post's promoted story names one coin, several, or is unsure → that story's own link,
 *                                       with its story id (if the read has a story, the story
 *                                       decides) — so a Buy button is the board's confident
 *                                       answer and nothing else;
 *   the post's name was searched (internal.coin_lookup) and no coin we hold by name came back
 *                                       → `none`;
 *   it was searched and the evidence settles one coin (post-match.ts, core `matchPostCoin`:
 *                                       links this post, or same picture and launched after,
 *                                       or the only coin launched after under the exact name)
 *                                       → `matched`, with the coin and the facts that settled it;
 *   it was searched and launchpad coins came back → `unsure` with how many: coins exist, and
 *                                       nothing has said which, if any, is this post's. The
 *                                       count is the length of the list written beside it
 *                                       (public.same_name_coin, same-name.ts), and `more`
 *                                       says the search found more than it kept;
 *   it was searched before the addresses were kept (0051) and coins came back → `pending`
 *                                       until it is searched again, which the lookup does at
 *                                       once: a count with no list behind it is not offered;
 *   the post's story was searched and has none → `none`;
 *   no search has finished `universe.lookup.giveUpMs` after the post entered the feed (as the
 *                                       lookup first saw it, internal.coin_lookup_attempt) →
 *                                       `unchecked`, "Couldn't check", with no button;
 *   nothing searched yet                → `pending`, a dash — never "no coin yet", which
 *                                       would be a claim about the world we had not checked.
 *
 * A search alone never puts a coin on a post: `matched` needs evidence beyond the name, and the
 * board's `one` only ever comes from a story's row.
 *
 * ★ THE OWNER'S CALL WINS OVER THE JUDGE'S (owner-calls.ts). "Not a meme" keeps a post off both
 * feeds, recorded as `owner_not_meme`; "Is a meme" passes it whatever the judge said, judged or
 * not — and it must still clear the feed's reach bar like any other post.
 *
 * What breaks if changed carelessly: the story's link is read from the board rows committed in
 * the same projection run. Reading it from anywhere else would let a post offer Buy on a coin
 * the narrative's own row has since stopped naming.
 */

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { clearsReachBar, postScoreReason, type ReachLevel } from '@insidor/core';
import { PgFeedRejectionRepo, type Db, type FeedRejectionReason } from '@insidor/store';

import { loadCoinFactsByAddress, loadReach, pictureOf, sourceLabel } from './db.ts';
import { loadNameIdeas, weighPostCoins, writeNameIdeas, type PostMatch } from './post-match.ts';
import { projectCoin } from './project.ts';
import { withOwnerCall, type OwnerPostCall } from './owner-calls.ts';
import { writeSameNameCoins } from './same-name.ts';
import { permalinkFor } from './permalinks.ts';
import { projectReach, projectSpark } from './project.ts';
import type { ReachReading } from './project.ts';
import { assertNoInternalVocabulary, instant } from './wire.ts';
import type { WireCoin, WireCoinEvidence, WireCoinLink, WireInstant, WireMeasured, WirePostCoinLink, WireSpark } from './wire.ts';

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

export interface RisingRow {
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
  /* Null together when the judge has not answered: such a row is loaded only when the owner
     called it a meme. */
  coinable: boolean | null;
  confidence: number | null;
  looked_at: 'text' | 'picture' | 'videoFrame' | null;
  proposed_name: string | null;
  picture_similarity: number | null;
  story_id: string | null;
  /** The owner's newest call on this post (0054), or null when there is none. */
  owner_call?: OwnerPostCall | null;
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
            pic.similarity as picture_similarity,
            s.story_id,
            oc.verdict as owner_call
       from internal.item_found_by f
       join public.item i on i.item_id = f.item_id
       join public.author a on a.author_key = i.author_key
       left join lateral (
              select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name
                from internal.post_judgement pj
               where pj.item_id = i.item_id
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) j on true
       /* The owner's newest call (0054): it outranks the judge's answer, either way. */
       left join lateral (
              select ofb.verdict
                from internal.owner_feedback ofb
               where ofb.subject_kind = 'post' and ofb.item_id = i.item_id
               order by ofb.created_at desc, ofb.id desc
               limit 1
            ) oc on true
       /* The picture boost's one number: how close this post's picture is to a coined post's.
          Read here and nowhere else; it decides, and never reaches the wire. */
       left join lateral (
              select max(1 - (e.embedding <=> c.embedding)) as similarity
                from internal.image_embedding e
                join internal.coined_picture c on c.space = e.space
               where e.subject_kind = 'item' and e.subject_id = i.item_id
            ) pic on true
       left join lateral (
              select m.story_id
                from public.story_member m
                join public.story st on st.story_id = m.story_id
               where m.item_id = i.item_id and st.state = 'promoted' and st.merged_into is null
               order by m.joined_at asc
               limit 1
            ) s on true
      where i.origin = 'observed'
        and coalesce(i.posted_at, i.first_seen_at) >= $1
        and (j.coinable is not null or oc.verdict = 'meme')`,
    [new Date(sinceMs).toISOString()],
  );
}

/**
 * Which posts have had their name searched for coins, and which launchpad coins came back — the
 * addresses the search kept that we hold by name (public.coin_name: observed coins only, so a
 * fixture is never listed), newest launch first;
 * and which have waited `giveUpMs` since the lookup first saw them in the feed with no search
 * finished. A post in neither has not been searched yet. `term` is not selected: the name is the
 * judge's. A post the lookup has never seen waiting is never given up on: the clock starts when
 * the lookup saw it, not when the post was made, so a post that reaches the feed late is not
 * "Couldn't check" on arrival.
 */
export async function loadPostLookups(
  db: Db,
  itemIds: readonly string[],
  nowMs: number = Date.now(),
  giveUpMs: number = DEFAULT_POLICY.universe.lookup.giveUpMs,
): Promise<ReadonlyMap<string, PostLookup>> {
  if (itemIds.length === 0) return new Map();
  /* A search from before 0051 that found coins has a count and no list: it is left out, as if
     not searched (a dash), and never given up on — the lookup searches it again at once. */
  const rows = await db.query<{ subject_id: string; searched: boolean; listed: string[] | null; more: boolean | null }>(
    `select a.subject_id, (l.subject_id is not null) as searched, l.more,
            (select array_agg(h.address order by h.ord)
               from unnest(l.hits) with ordinality as h(address, ord)
               join public.coin_name n on n.address = h.address) as listed
       from (select unnest($1::text[]) as subject_id) a
       left join internal.coin_lookup l on l.subject_kind = 'post' and l.subject_id = a.subject_id
                                       and (l.hits is not null or l.found = 0)
       left join internal.coin_lookup_attempt q on q.subject_kind = 'post' and q.subject_id = a.subject_id
      where l.subject_id is not null
         or (q.queued_at <= $2
             and not exists (select 1 from internal.coin_lookup o where o.subject_kind = 'post' and o.subject_id = a.subject_id))`,
    [[...itemIds], new Date(nowMs - giveUpMs).toISOString()],
  );
  return new Map(rows.map((r) => [r.subject_id, r.searched ? { coins: r.listed ?? [], more: r.more === true } : { gaveUp: true }]));
}

/**
 * A finished search for a post's name — the coins it kept that we can list, newest launch first,
 * and whether it found more than it kept — or none in time.
 */
export type PostLookup = { readonly coins: readonly string[]; readonly more: boolean; readonly match?: PostLookupMatch } | { readonly gaveUp: true };

/**
 * The coins weighed (post-match.ts): one coin settled with the facts that settled it, or the
 * list in evidence order with each coin's facts. Absent when nothing was weighed.
 */
export type PostLookupMatch =
  | { readonly kind: 'matched'; readonly coin: WireCoin; readonly evidence: WireCoinEvidence }
  | { readonly kind: 'unsure'; readonly order: readonly string[]; readonly evidence: ReadonlyMap<string, WireCoinEvidence> };

/** The row's coin line and the story it came from, by the rule in the header. */
export function postCoins(
  storyLink: WireCoinLink | undefined,
  lookup: PostLookup | null,
): { readonly coins: WirePostCoinLink; readonly fromStory: boolean; readonly sameName: readonly string[] } {
  if (storyLink !== undefined && (storyLink.kind === 'one' || storyLink.kind === 'several' || storyLink.kind === 'unsure')) {
    return { coins: storyLink, fromStory: true, sameName: [] };
  }
  if (lookup !== null && 'coins' in lookup) {
    const n = lookup.coins.length;
    if (n === 0) return { coins: { kind: 'none' }, fromStory: false, sameName: [] };
    const m = lookup.match;
    if (m?.kind === 'matched') return { coins: { kind: 'matched', coin: m.coin, evidence: m.evidence }, fromStory: false, sameName: [] };
    /* Strongest evidence first when the coins were weighed; the list is the same coins either way. */
    const listed = new Set(lookup.coins);
    const sameName = m?.kind === 'unsure' ? [...m.order.filter((a) => listed.has(a)), ...lookup.coins.filter((a) => !m.order.includes(a))] : lookup.coins;
    return { coins: lookup.more ? { kind: 'unsure', claimCount: n, more: true } : { kind: 'unsure', claimCount: n }, fromStory: false, sameName };
  }
  if (storyLink !== undefined && storyLink.kind === 'none') return { coins: storyLink, fromStory: true, sameName: [] };
  if (lookup !== null) return { coins: { kind: 'unchecked' }, fromStory: false, sameName: [] };
  return { coins: { kind: 'pending' }, fromStory: false, sameName: [] };
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
  /** The coins behind each shown post's own unsure count, by post id (same-name.ts), strongest evidence first. */
  readonly sameName: ReadonlyMap<string, readonly string[]>;
  /** Each listed coin's facts against its post, by post id then address (0058). */
  readonly sameNameEvidence: ReadonlyMap<string, ReadonlyMap<string, WireCoinEvidence>>;
}

/**
 * Whether one loaded post passes: the judge's answer held to `postScoreReason`, with the owner's
 * call over it. A row with no answer is here only because the owner called it a meme.
 */
export function postStanding(row: RisingRow, policy = DEFAULT_POLICY): FeedRejectionReason | 'passes' {
  const similarity = row.picture_similarity === null ? null : Number(row.picture_similarity);
  const judge =
    row.coinable === null || row.confidence === null || row.looked_at === null
      ? undefined
      : postScoreReason({ coinable: row.coinable, confidence: row.confidence, lookedAt: row.looked_at, proposedName: row.proposed_name }, policy, similarity);
  return withOwnerCall(judge, row.owner_call ?? undefined) ?? 'not_scored';
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
    const why = postStanding(row, policy);
    if (why !== 'passes') whyNot.set(row.item_id, why);
    return why === 'passes';
  });
  const reach = await loadReach(db, rows.map((row) => row.item_id), sinceMs);
  const lookups = await withMatches(db, rows, await loadPostLookups(db, rows.map((row) => row.item_id)), coinsByStory, nowMs, sparkWindowMs, policy);
  const posts = rows.map((row) => {
    const readings = reach.get(row.item_id) ?? [];
    /* Measured counts only: a censored reading's last level is an older number, and read at a
       later time it would overstate how fast the post grew. */
    const views: ReachLevel[] = readings.map((x) => ({ atMs: x.atMs, reach: x.rate.kind === 'measured' ? x.rate.level : null }));
    const postedAt = toMs(row.posted_at);
    const lookup = lookups.get(row.item_id) ?? null;
    return {
      post: projectRisingPost(row, readings, coinsByStory, sparkWindowMs, lookup),
      sameName: postCoins(row.story_id === null ? undefined : coinsByStory.get(row.story_id), lookup).sameName,
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
  const shown = { fyp: cap(fyp), popular: cap(popular) };
  const ids = new Set([...shown.fyp, ...shown.popular].map((p) => p.id));
  const sameName = new Map(posts.filter((p) => ids.has(p.post.id) && p.sameName.length > 0).map((p) => [p.post.id, p.sameName] as const));
  const sameNameEvidence = new Map<string, ReadonlyMap<string, WireCoinEvidence>>();
  for (const id of sameName.keys()) {
    const l = lookups.get(id);
    if (l !== undefined && 'coins' in l && l.match?.kind === 'unsure') sameNameEvidence.set(id, l.match.evidence);
  }
  return { ...shown, whyNot, sameName, sameNameEvidence };
}

/**
 * Each searched post's coins weighed by evidence (post-match.ts), the answer folded into its
 * lookup: a confident coin is projected as the board projects its coins, with its market. A post
 * whose narrative decides its coins is not weighed — if the read has a story, the story decides.
 */
async function withMatches(
  db: Db,
  rows: readonly RisingRow[],
  lookups: ReadonlyMap<string, PostLookup>,
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  nowMs: Millis,
  sparkWindowMs: number,
  policy: typeof DEFAULT_POLICY,
): Promise<ReadonlyMap<string, PostLookup>> {
  const lists = new Map<string, readonly string[]>();
  for (const row of rows) {
    const story = row.story_id === null ? undefined : coinsByStory.get(row.story_id)?.kind;
    if (story === 'one' || story === 'several' || story === 'unsure') continue;
    const l = lookups.get(row.item_id);
    if (l !== undefined && 'coins' in l && l.coins.length > 0) lists.set(row.item_id, l.coins);
  }
  if (lists.size === 0) return lookups;
  const weighed: ReadonlyMap<string, PostMatch> = await weighPostCoins(db, lists, policy);
  const confident = [...weighed.values()].flatMap((m) => (m.decision.kind === 'confident' ? [m.decision.address] : []));
  const facts = await loadCoinFactsByAddress(db, confident);
  const options = { nowMs, sparkWindowMs, marketFreshnessMs: policy.market.readingFreshnessMs, feedFreshnessMs: policy.assets.feedFreshnessMs };
  const out = new Map(lookups);
  for (const [itemId, m] of weighed) {
    const l = lookups.get(itemId);
    if (l === undefined || !('coins' in l)) continue;
    const evidence = new Map(m.evidence.map(({ address, ...e }) => [address, e] as const));
    const d = m.decision;
    const coin = d.kind === 'confident' ? facts.get(d.address) : undefined;
    const e = d.kind === 'confident' ? evidence.get(d.address) : undefined;
    /* A confident coin we cannot project (not an observed coin we hold) stays in the list: the
       card never offers Buy on a coin it cannot show. */
    if (coin !== undefined && e !== undefined) {
      out.set(itemId, { ...l, match: { kind: 'matched', coin: projectCoin(coin, options), evidence: e } });
    } else {
      out.set(itemId, { ...l, match: { kind: 'unsure', order: m.evidence.map((x) => x.address), evidence } });
    }
  }
  return out;
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
  /* The coins behind each unsure post's count, in this transaction with the rows that show it. */
  await writeSameNameCoins(db, 'post', frame.sameName, frame.sameNameEvidence);
  /* Each shown post's name ideas for Create (0058), with the feeds they belong to. */
  await writeNameIdeas(db, await loadNameIdeas(db, [...new Set([...frame.fyp, ...frame.popular].map((p) => p.id))]));
  return (await writeRising(db, 'fyp', frame.fyp)) + (await writeRising(db, 'popular', frame.popular));
}
