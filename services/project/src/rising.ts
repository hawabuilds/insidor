/**
 * THE FOR YOU AND POPULAR FEEDS: single posts, projected once and served verbatim.
 *
 * Which posts: the earlier build's rule. A post the catch-all search found (0025's
 * `item_found_by`), observed rather than seeded, posted inside `rising.windowMs`, whose
 * meme score — the judge's answer about that post alone — clears core's `postScore`, OR whose
 * kind is not held and other accounts answered it with a cashtag, an address or CA (core
 * `passesWithSignal`, the stored crypto read, 0064); a shill — its own text or its author's own
 * replies naming a coin — never passes. A post with no score yet is not here: it waits, and is
 * never shown as if it had passed.
 * And it must clear the feed's view bar (core's `clearsReachBar`): For You at 40k views or fast
 * early growth, Popular at 250k. A post whose views we have not read is on neither.
 *
 * In what order (the owner, 2026-10-13): `fyp` newest first, by when the post went up on its source
 * (`forYouOrder`); the pass routes (judge, judge with the signal, the signal) decide only whether a
 * post is on For You, never where. The order model (core `postRankScore`, 0065) does not order; with
 * `rising.scorePassBar` set, a post the rules passed but the fit puts under the bar is not on For
 * You (`under_score_bar`), and its number goes nowhere else: not on the row, not in the payload,
 * not in the log. `popular` most views
 * first, and a post whose views we have not read goes after every post whose views we have. The
 * client never sorts.
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
 *   the owner's current coin call names a coin we hold ("This is the coin", owner-calls.ts)
 *                                       → `matched` with that coin, over the story's link and
 *                                       the evidence, `ownerChecked` among its facts;
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
 *                                       the other coins with the name are written beside it
 *                                       too, settled coin first, for the post sheet's list;
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
 * ★ AN OLDER COIN TRADING ON THE SUBJECT IS ITS OWN FIELD, `runningOlder` (older-coins.ts, 0060):
 * coins launched before the post, named for its subject, whose trading jumped since it — as
 * dollars and prices, busiest first, empty when none. Never in `coins`, never a Buy: a coin
 * launched before a post cannot be its coin.
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
import { clearsReachBar, heldKind, isShillText, passesWithSignal, postRankScore, postScoreReason, postSignals, type CryptoSignal, type HeldKind, type PassRoute, type ReachLevel, type ScoreFit } from '@insidor/core';
import { recentGrowthPerMinute } from './fyp-freshness.ts';
import { PgFeedRejectionRepo, type Db, type FeedRejectionReason } from '@insidor/store';
import { PgScoreModelRepo } from '@insidor/store/repo/score-model.ts';

import { loadCoinFactsByAddress, loadReach, pictureOf, sourceLabel } from './db.ts';

/** The source whose posts are held to the short-video bars. */
const SHORT_VIDEO_SOURCE = 'tiktok';
import { loadNameIdeas, weighPostCoins, writeNameIdeas, type PostMatch } from './post-match.ts';
import { projectCoin } from './project.ts';
import { loadOwnerCoins, withOwnerCall, type OwnerPostCall } from './owner-calls.ts';
import { writeSameNameCoins } from './same-name.ts';
import { loadRunningOlder, type WireOlderCoin } from './older-coins.ts';
import { permalinkFor } from './permalinks.ts';
import { projectReach, projectSpark } from './project.ts';
import type { ReachReading } from './project.ts';
import { assertNoInternalVocabulary, instant } from './wire.ts';
import type { WireCoin, WireCoinEvidence, WireCoinLink, WireInstant, WireMeasured, WirePostCoinLink, WireSpark } from './wire.ts';

export const RISING_FEEDS = ['fyp', 'popular'] as const;
export type RisingFeed = (typeof RISING_FEEDS)[number];

const EXCERPT_MAX_CHARS = 280;

/** One single post on a feed. Fourteen keys, every one a fact. */
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
  /** Older coins named for the subject whose trading jumped since the post; never its coin. */
  readonly runningOlder: readonly WireOlderCoin[];
  /**
   * What only the post sheet shows, read by `GET /post/:id/sheet` and cut from the feed replies
   * (services/read queries.ts), so the cards do not carry a chart each. Absent on a row projected
   * before it existed.
   */
  readonly sheet?: WirePostSheetFacts;
}

/**
 * The post sheet's facts that only this process can read (public.observation and the crypto
 * reads are not the app role's):
 *
 *   views          every view reading we took, oldest first; a censored one is null and breaks
 *                  the chart's line rather than dropping it to the floor
 *   perMinute      views a minute lately (fyp-freshness.ts `recentGrowthPerMinute`, the same
 *                  rate For You is ordered by); null when the readings cannot say
 *   tickersInReplies  how many times other accounts named a $ticker in the newest replies and
 *                  quote posts we read (0064, `_others`); null when we have not read them —
 *                  never zero for "not read"
 */
export interface WirePostSheetFacts {
  readonly views: readonly { readonly atMs: number; readonly value: number | null }[];
  readonly perMinute: number | null;
  readonly tickersInReplies: number | null;
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
  /**
   * The label the kind question filed, when the post's newest answer is a kind answer (prompt id
   * `post-kind…`); null otherwise. Only a held kind holds (core `heldKind`): OTHER holds nothing.
   */
  kind_label?: string | null;
}

/**
 * The kind a post was held by, or null: what feed_rejection's detail records and what a News
 * surface sorts by. The same rule `postStanding` applies, so the two never disagree.
 */
export const postHeldKind = (row: Pick<RisingRow, 'kind_label'>, policy = DEFAULT_POLICY): HeldKind | null => heldKind(row.kind_label ?? null, policy.judge.heldKinds);

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
            k.kind_label,
            pic.similarity as picture_similarity,
            s.story_id,
            oc.verdict as owner_call
       from internal.item_found_by f
       join public.item i on i.item_id = f.item_id
       join public.author a on a.author_key = i.author_key
       /* ★ The first question's newest answer, never a kind answer: a kind label is not a name, and
          its yes/no is not the judge's verdict on the post (two OTHER answers filed as "no" hid two
          posts on 2026-10-13). The kind is read beside it, below. */
       left join lateral (
              select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name
                from internal.post_judgement pj
               where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) j on true
       /* The kind label, only when the newest answer of all is a kind answer: a re-score after it
          (a new prompt) asks the kind again, and until then the old label no longer holds. */
       left join lateral (
              select case when pj.prompt_id like 'post-kind%' then pj.proposed_name end as kind_label
                from internal.post_judgement pj
               where pj.item_id = i.item_id
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) k on true
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
  /* `owner`: the owner named this coin (owner-calls.ts `loadOwnerCoins`); it wins over a story's link. */
  | { readonly kind: 'matched'; readonly coin: WireCoin; readonly evidence: WireCoinEvidence; readonly owner?: true }
  | { readonly kind: 'unsure'; readonly order: readonly string[]; readonly evidence: ReadonlyMap<string, WireCoinEvidence> };

/** The row's coin line and the story it came from, by the rule in the header. */
export function postCoins(
  storyLink: WireCoinLink | undefined,
  lookup: PostLookup | null,
): { readonly coins: WirePostCoinLink; readonly fromStory: boolean; readonly sameName: readonly string[] } {
  /* The owner's own coin first: "This is the coin" outranks a narrative's link and the evidence. */
  if (lookup !== null && 'coins' in lookup && lookup.match?.kind === 'matched' && lookup.match.owner === true) {
    const m = lookup.match;
    return { coins: { kind: 'matched', coin: m.coin, evidence: m.evidence }, fromStory: false, sameName: [m.coin.address, ...lookup.coins.filter((a) => a !== m.coin.address)] };
  }
  if (storyLink !== undefined && (storyLink.kind === 'one' || storyLink.kind === 'several' || storyLink.kind === 'unsure')) {
    return { coins: storyLink, fromStory: true, sameName: [] };
  }
  if (lookup !== null && 'coins' in lookup) {
    const n = lookup.coins.length;
    const m = lookup.match;
    /* A proven coin is shown even when the name search found none: its picture or the poster's
       own reply found it. Anything less on an empty search stays "no coin yet" — the list's
       wording is "N coins use this name", which a coin found by its picture does not. */
    if (n === 0 && m?.kind !== 'matched') return { coins: { kind: 'none' }, fromStory: false, sameName: [] };
    /* The settled coin first, then every other coin with the name: the post sheet's "All N coins". */
    if (m?.kind === 'matched') return { coins: { kind: 'matched', coin: m.coin, evidence: m.evidence }, fromStory: false, sameName: [m.coin.address, ...lookup.coins.filter((a) => a !== m.coin.address)] };
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
  runningOlder: readonly WireOlderCoin[] = [],
  sheet: WirePostSheetFacts | null = null,
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
    runningOlder,
    ...(sheet === null ? {} : { sheet }),
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
  /** The kind that held each post the kind question held (`postHeldKind`), recorded as the rejection's detail. */
  readonly heldBy: ReadonlyMap<string, HeldKind>;
  /** The coins behind each shown post's own unsure count, by post id (same-name.ts), strongest evidence first. */
  readonly sameName: ReadonlyMap<string, readonly string[]>;
  /** Each listed coin's facts against its post, by post id then address (0058). */
  readonly sameNameEvidence: ReadonlyMap<string, ReadonlyMap<string, WireCoinEvidence>>;
}

/** What a post's newest split crypto read said (0064): other accounts' coin talk, and the author's own. */
export interface CryptoRead {
  readonly others: boolean;
  readonly ownTalk: boolean;
  /** Other accounts' $ticker mentions in that read, summed over the tickers (the post sheet's tile). */
  readonly othersTickers?: number;
}

/**
 * ★ THE CRYPTO SIGNAL FOR THE PASS RULE (the owner, 2026-10-13): other accounts' cashtags,
 * addresses or CA from the post's newest split read; a shill when its own text names a coin (core
 * `isShillText`, no read needed) or its author's own replies did. Null when there is nothing to say:
 * no read and a clean text.
 */
export function cryptoSignalFor(row: Pick<RisingRow, 'body'>, read: CryptoRead | undefined, policy = DEFAULT_POLICY): CryptoSignal | null {
  const shill = isShillText(row.body ?? '', policy.attention) || read?.ownTalk === true;
  if (read === undefined && !shill) return null;
  return { others: read?.others === true, shill };
}

/**
 * Whether one loaded post passes, and by which route: core `passesWithSignal` (the judge, the judge
 * with other accounts' crypto signal, or the signal alone on a kind not held; a shill never), with
 * the owner's call over it. A row with no answer is here only because the owner called it a meme.
 */
export function postRoute(row: RisingRow, policy = DEFAULT_POLICY, signal: CryptoSignal | null = null): { readonly why: FeedRejectionReason | 'passes'; readonly route: PassRoute | null } {
  const similarity = row.picture_similarity === null ? null : Number(row.picture_similarity);
  const answer =
    row.coinable === null || row.confidence === null || row.looked_at === null
      ? null
      : { coinable: row.coinable, confidence: row.confidence, lookedAt: row.looked_at, proposedName: row.proposed_name };
  const kind = row.kind_label ?? null;
  const judge = answer === null ? undefined : postScoreReason(answer, policy, similarity, kind);
  const call = row.owner_call ?? undefined;
  if (call === 'meme') return { why: 'passes', route: signal?.others === true && signal.shill !== true ? 'judge+signal' : 'judge' };
  if (call === 'not') return { why: withOwnerCall(judge, call) ?? 'owner_not_meme', route: null };
  const route = answer === null ? null : passesWithSignal(answer, policy, similarity, kind, signal);
  if (route !== null) return { why: 'passes', route };
  /* Not passed: the judge's own reason, or — when the judge passed it and a shill stopped it — not memeable. */
  return { why: judge === undefined ? 'not_scored' : judge === 'passes' ? 'not_memeable' : judge, route: null };
}

/** Whether one loaded post passes (`postRoute`'s answer without the route). */
export function postStanding(row: RisingRow, policy = DEFAULT_POLICY, signal: CryptoSignal | null = null): FeedRejectionReason | 'passes' {
  return postRoute(row, policy, signal).why;
}

/**
 * ★ FOR YOU'S ORDER (the owner, 2026-10-13, second word): newest first, by when the post went up on
 * its source (`at`: the post's own time, or when we first saw it when the source gave none), then by
 * id so a frame is stable. Pull to refresh then brings new posts in at the top. The route a post
 * passed by, its growth and the order model's number are not in it; they decide only admission.
 */
export function forYouOrder(a: { readonly at: number; readonly id: string }, b: { readonly at: number; readonly id: string }): number {
  return b.at - a.at || a.id.localeCompare(b.id);
}

/**
 * Each post's newest split crypto read (0064; rows from before the split are not read). Empty when
 * the table cannot be read: every post then passes or not by the judge alone, as before.
 */
async function loadCryptoReads(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, CryptoRead>> {
  if (itemIds.length === 0) return new Map();
  try {
    const rows = await db.query<{ item_id: string; others: boolean; own_talk: boolean; others_tickers: number | string | null }>(
      `select item_id,
              (select coalesce(sum(case when jsonb_typeof(t.value) = 'number' then (t.value #>> '{}')::numeric else 0 end), 0)
                 from jsonb_each(case when jsonb_typeof(cashtags->'_others'->'cashtags') = 'object'
                                      then cashtags->'_others'->'cashtags' else '{}'::jsonb end) t) as others_tickers,
              (coalesce(cashtags->'_others'->'cashtags', '{}'::jsonb) <> '{}'::jsonb
               or coalesce((cashtags->'_others'->>'addresses')::int, 0) > 0
               or coalesce((cashtags->'_others'->>'ca')::int, 0) > 0) as others,
              (coalesce(cashtags->'_own'->'cashtags', '{}'::jsonb) <> '{}'::jsonb
               or coalesce((cashtags->'_own'->>'addresses')::int, 0) > 0
               or coalesce((cashtags->'_own'->>'ca')::int, 0) > 0) as own_talk
         from (select distinct on (item_id) item_id, cashtags from internal.crypto_attention
                where item_id = any($1::text[]) and cashtags ? '_others'
                order by item_id, read_at desc) r`,
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, { others: r.others, ownTalk: r.own_talk, othersTickers: r.others_tickers === null ? 0 : Number(r.others_tickers) }] as const));
  } catch {
    return new Map();
  }
}

/**
 * Whether the order model holds a post back: only with a bar set, a fit applied, and the post
 * under it — and never a post the owner called a meme, whose call outranks the fit as it
 * outranks the judge.
 */
export function underScoreBar(score: number | null, bar: number | null, ownerCall: OwnerPostCall | null): boolean {
  return bar !== null && score !== null && score < bar && ownerCall !== 'meme';
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
  const heldBy = new Map<string, HeldKind>();
  const candidates = await loadCandidates(db, sinceMs);
  const crypto = await loadCryptoReads(db, candidates.map((row) => row.item_id));
  const rows = candidates.filter((row) => {
    const { why } = postRoute(row, policy, cryptoSignalFor(row, crypto.get(row.item_id), policy));
    if (why !== 'passes') whyNot.set(row.item_id, why);
    const held = postHeldKind(row, policy);
    if (why !== 'passes' && held !== null) heldBy.set(row.item_id, held);
    return why === 'passes';
  });
  const reach = await loadReach(db, rows.map((row) => row.item_id), sinceMs);
  const lookups = await withMatches(db, rows, await loadPostLookups(db, rows.map((row) => row.item_id)), coinsByStory, nowMs, sparkWindowMs, policy);
  const older = await loadRunningOlder(db, rows.map((row) => row.item_id));
  /* The order model: the latest applied fit, and crypto attention only when the fit weighs it. */
  const scores = new PgScoreModelRepo(db);
  const applied = await scores.latestApplied();
  const fit: ScoreFit | null = applied === null ? null : { intercept: applied.intercept, terms: applied.terms };
  const attention = fit !== null && fit.terms.some((t) => t.signal === 'attention') ? await scores.attention(rows.map((row) => row.item_id)) : new Map<string, number>();
  const posts = rows.map((row) => {
    const readings = reach.get(row.item_id) ?? [];
    /* Measured counts only: a censored reading's last level is an older number, and read at a
       later time it would overstate how fast the post grew. */
    const views: ReachLevel[] = readings.map((x) => ({ atMs: x.atMs, reach: x.rate.kind === 'measured' ? x.rate.level : null }));
    const postedAt = toMs(row.posted_at);
    const lookup = lookups.get(row.item_id) ?? null;
    /* A short video's views run an order of magnitude above a text post's: its own bars (Policy.rising.shortVideoReachScale). */
    const scale = row.source === SHORT_VIDEO_SOURCE ? policy.rising.shortVideoReachScale : 1;
    const score = fit === null ? null : postRankScore(postSignals({
      coinable: row.coinable, confidence: row.confidence === null ? null : Number(row.confidence), lookedAt: row.looked_at, proposedName: row.proposed_name,
      kindLabel: row.kind_label ?? null, pictureSimilarity: row.picture_similarity === null ? null : Number(row.picture_similarity),
      readings: views, postedAtMs: postedAt, reachScale: scale, attention: attention.get(row.item_id) ?? null,
    }, policy), fit);
    const underBar = underScoreBar(score, policy.rising.scorePassBar, row.owner_call ?? null);
    return {
      score,
      underBar,
      post: projectRisingPost(row, readings, coinsByStory, sparkWindowMs, lookup, older.get(row.item_id) ?? [], {
        views: views.map((v) => ({ atMs: v.atMs, value: v.reach })),
        perMinute: (() => {
          const g = recentGrowthPerMinute(views, nowMs, policy);
          return g === null ? null : Math.round(g);
        })(),
        tickersInReplies: crypto.get(row.item_id)?.othersTickers ?? null,
      }),
      sameName: postCoins(row.story_id === null ? undefined : coinsByStory.get(row.story_id), lookup).sameName,
      at: postedAt ?? toMs(row.first_seen_at) ?? 0,
      fyp: !underBar && clearsReachBar('fyp', views, postedAt, policy, scale),
      unread: views.every((v) => v.reach === null),
      popular: clearsReachBar('popular', views, postedAt, policy, scale),
    };
  });

  const fyp = posts.filter((p) => p.fyp).sort((a, b) => forYouOrder({ at: a.at, id: a.post.id }, { at: b.at, id: b.post.id }));
  const views = (p: WireRisingPost): number | null => p.reach.v;
  const popular = posts.filter((p) => p.popular).sort((a, b) => {
    const va = views(a.post);
    const vb = views(b.post);
    if (va === null || vb === null) return va === null ? (vb === null ? b.at - a.at : 1) : -1;
    return vb - va || b.at - a.at;
  });
  const cap = (list: typeof posts) => list.slice(0, policy.rising.maxRows).map((p) => p.post);
  for (const p of posts) if (!p.fyp) whyNot.set(p.post.id, p.underBar ? 'under_score_bar' : p.unread ? 'reach_unread' : 'under_reach_bar');
  const shown = { fyp: cap(fyp), popular: cap(popular) };
  const ids = new Set([...shown.fyp, ...shown.popular].map((p) => p.id));
  const sameName = new Map(posts.filter((p) => ids.has(p.post.id) && p.sameName.length > 0).map((p) => [p.post.id, p.sameName] as const));
  const sameNameEvidence = new Map<string, ReadonlyMap<string, WireCoinEvidence>>();
  for (const id of sameName.keys()) {
    const l = lookups.get(id);
    if (l !== undefined && 'coins' in l && l.match?.kind === 'unsure') sameNameEvidence.set(id, l.match.evidence);
    if (l !== undefined && 'coins' in l && l.match?.kind === 'matched') sameNameEvidence.set(id, new Map([[l.match.coin.address, l.match.evidence]]));
  }
  return { ...shown, whyNot, heldBy, sameName, sameNameEvidence };
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
    /* A search that found nothing is weighed too: the coin may be one its picture or its replies
       found (post-match.ts widens the list). */
    if (l !== undefined && 'coins' in l) lists.set(row.item_id, l.coins);
  }
  const ownerCoins = await loadOwnerCoins(db, rows.map((row) => row.item_id));
  if (lists.size === 0 && ownerCoins.size === 0) return lookups;
  const weighed: ReadonlyMap<string, PostMatch> = lists.size === 0 ? new Map() : await weighPostCoins(db, lists, policy);
  const confident = [...weighed.values()].flatMap((m) => (m.decision.kind === 'confident' ? [m.decision.address] : []));
  const facts = await loadCoinFactsByAddress(db, [...new Set([...confident, ...ownerCoins.values()])]);
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
  /* The owner's coin, over all of the above: proven for everyone, with the facts we hold about it
     against the post. A coin we do not hold yet waits for the runner to add it (owner-calls.ts). */
  const postedAt = new Map(rows.map((row) => [row.item_id, toMs(row.posted_at) ?? toMs(row.first_seen_at)] as const));
  for (const [itemId, address] of ownerCoins) {
    const f = facts.get(address);
    if (f === undefined) continue;
    const coin = projectCoin(f, options);
    const weighedHere = weighed.get(itemId)?.evidence.find((x) => x.address === address);
    const posted = postedAt.get(itemId) ?? null;
    const evidence: WireCoinEvidence = {
      linksPost: true,
      samePicture: weighedHere?.samePicture ?? null,
      launchedAfterMs: weighedHere?.launchedAfterMs ?? (coin.mintedAt.at === null || posted === null ? null : coin.mintedAt.at - posted),
      ...(weighedHere?.posterPostedAddress === undefined ? {} : { posterPostedAddress: weighedHere.posterPostedAddress }),
      ownerChecked: true,
    };
    const l = out.get(itemId);
    const base = l !== undefined && 'coins' in l ? l : { coins: [], more: false };
    out.set(itemId, { ...base, match: { kind: 'matched', coin, evidence, owner: true } });
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

/** A held post's rejection detail: `kind:TRAGEDY`, `kind:AD` and so on; null for any other reason. */
export const kindDetail = (kind: HeldKind | undefined): string | null => (kind === undefined ? null : `kind:${kind}`);

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
    return why === undefined ? [] : [{ kind: 'post' as const, id: item_id, reason: why, detail: kindDetail(frame.heldBy.get(item_id)) }];
  });
  /* ★ AND WHAT THE KIND QUESTION HELD, whether or not it ever showed: usually it never did, since
     the kind is asked in the pass that judged it. Recorded once per kind (detail `kind:AD`…), so
     an unchanged hold is not rewritten every frame; a post on a feed now (News) is not a hold. */
  const leftIds = new Set(left.map((r) => r.id));
  const heldIds = [...frame.heldBy.keys()].filter((id) => !now.has(id) && !leftIds.has(id));
  const recorded = heldIds.length === 0 ? [] : await db.query<{ subject_id: string; detail: string | null }>(
    `select subject_id, detail from public.feed_rejection where subject_kind = 'post' and subject_id = any($1::text[])`,
    [heldIds],
  );
  const already = new Map(recorded.map((r) => [r.subject_id, r.detail] as const));
  const held = heldIds.flatMap((id) => {
    const detail = kindDetail(frame.heldBy.get(id));
    const why = frame.whyNot.get(id);
    return why === undefined || already.get(id) === detail ? [] : [{ kind: 'post' as const, id, reason: why, detail }];
  });
  await new PgFeedRejectionRepo(db).record([...left, ...held]);
  /* The coins behind each unsure post's count, in this transaction with the rows that show it. */
  await writeSameNameCoins(db, 'post', frame.sameName, frame.sameNameEvidence);
  /* Each shown post's name ideas for Create (0058), with the feeds they belong to. */
  await writeNameIdeas(db, await loadNameIdeas(db, [...new Set([...frame.fyp, ...frame.popular].map((p) => p.id))]));
  return (await writeRising(db, 'fyp', frame.fyp)) + (await writeRising(db, 'popular', frame.popular));
}
