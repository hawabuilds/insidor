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
 * early growth, Popular at 250k (For You's speed path from `rising.speedBar.forYouMinAgeMs`, not the
 * scorer's age: `forYouBarPolicy`). A post whose views we have not read is on neither — except that
 * For You also takes a post a coin vouches for (`rising.coinLinked`, core `coinVouches`): the first
 * observed coin naming it launched within six hours of the post, which had 5,000 approvals. The
 * coin stands in for the views only; the judge, the kind and the six hours still decide.
 * ★ And For You takes a post by the coin-first route (`rising.coinFirst`, coin-first.ts): a coin whose
 * own link ties it (or its repost, one hop) launched within 48 hours of the post, the judge said yes,
 * and the one-coin rule picked that coin. No view bar, score bar, six hours or junk bar for it; the
 * post may be up to two days old, so it is loaded and counted in the window whatever its age.
 * ★ And For You takes a post by the late route (`lateNoCoin`, late-no-coin.ts): found after the six
 * hours had closed, judged yes (a yes just under the bar counts there alone), over the views bar, and
 * no coin for it running yet; loaded whatever its age and whoever found it, For You's only. Under the
 * frame's cut — where For You's newest-first order puts most of them — it joins For You's list all the
 * same (`lateJoins`).
 * ★ And For You takes a post whose picked coin is running now (`runnerLink.running`, running-picks.ts):
 * the coin trading — the running coins strip's last-hour test, or a cap bar — pulls its post back,
 * past the view bar, the six hours, the junk bar and a held kind, with the judge's yes and the
 * owner's word still deciding. Loaded whatever its age and whichever route stored it.
 * With `rising.fypMaxAgeOn`, For You also turns away a post over `rising.fypMaxAgeMs` old unless it
 * is still growing fast (fyp-freshness.ts) — but only one that is not on it yet: a post already on
 * For You (feed-members.ts, 0075) stays while it is inside the window (the owner, 2026-10-14: the
 * six hours stop a post joining late and never take one off). Off, it keeps every post inside the
 * window, as it has since the News tab went. Everything a frame ever showed stays on the infinite
 * scroll (public.feed_post), whatever later frames show.
 * ★ And no route lets a PROMOTION onto either feed (promotions.ts, `rising.promotion`, the owner
 * 2026-10-24): a post under For You's views bar that only re-shares, quotes or links another
 * account's bigger post is taken out after every route has spoken, and withdrawn from the scroll if
 * it was a member. Its picked coin is carried on the original's card, and a running one pulls the
 * original back by the running route.
 * With `rising.junkBar.on`, a post the re-tune's junk fit puts at or over its own held-out For You
 * bar does not join For You either (junk-bar.ts); like the six hours it never takes a member off.
 *
 * How much of For You one topic may take (the owner, 2026-10-15): at most a few cards in any run of
 * twenty (variety.ts, `rising.variety*`); the rest of the topic leave the live list, never reordered.
 * And one account (the owner, 2026-10-23): at most two cards on the list (`rising.authorShare`), its
 * most-viewed ones; the next post in line takes the freed place.
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
 * line; and the post it quotes, when it quotes one we hold (quoted.ts) — whose picture leads the card
 * when the post has none of its own. Never the score, never anything
 * TRACK or the judge computed.
 *
 * ★ EVERY ROW SAYS WHERE ITS COIN STANDS. `coins` is never null; it is one of these, decided in
 * `postCoins` below:
 *
 *   the owner said "No coin is from this" on the post → `none`, over everything below;
 *   the owner's current coin call names a coin we hold ("This is the coin", owner-calls.ts)
 *                                       → `matched` with that coin, over the story's link and
 *                                       the evidence, `ownerChecked` among its facts;
 *   the owner confirmed a coin for a post about the same story (story-coins.ts) and we hold it
 *                                       → `matched` with that coin, over the narrative's link:
 *                                       the post's own facts when it proves the coin itself,
 *                                       else `storyCoin` ("Coin for this story");
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
 * A search alone never puts a coin on a post: `matched` needs evidence beyond the name, or the
 * owner's word on the post or its story, and the board's `one` only ever comes from a story's row.
 *
 * ★ A COIN THE OWNER CALLED WRONG IS NEVER SHOWN ON THE POST (`CoinCheck`): wrong on the post, or
 * on a post of its story, it is taken out of the narrative's link, the search's list and the
 * evidence's answer before any of them is shown.
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
import { COIN_MODEL_TARGETS, DEFAULT_POLICY, type CoinModelTarget } from '@insidor/contracts/policy.ts';
import { clearsReachBar, coinVouches, heldKind, passesAsViral, viralEligible, type ViralAnswer, type PostCoinCalls, type StoryCoin, isShillText, passesWithSignal, postRankScore, postScoreReason, postSignals, type CryptoSignal, type HeldKind, type PassRoute, type ReachLevel, type ScoreFit } from '@insidor/core';
import { onePolicy, policyForAnswer, type AnswerPolicies } from './judge-cutoff.ts';
import { freshForYou, recentGrowthPerMinute } from './fyp-freshness.ts';
import { overJunkBar } from './junk-bar.ts';
import { loadMembership, writeMembership, type Membership } from './feed-members.ts';
import { changedPosts, frameCursor, lockForYou, type QuickCursor } from './for-you-lock.ts';
import { PgFeedRejectionRepo, PgFinderRepo, PgViralMomentRepo, type CoinVouchRow, type Db, type FeedRejectionReason } from '@insidor/store';
import { PgScoreModelRepo } from '@insidor/store/repo/score-model.ts';

import { loadCoinFactsByAddress, loadReach, pictureOf, sourceLabel } from './db.ts';
import { loadQuotedPosts, mainPicture, type QuotedRow } from './quoted.ts';

/** The source whose posts are held to the short-video bars. */
const SHORT_VIDEO_SOURCE = 'tiktok';
import { loadNameIdeas, weighPostCoins, writeNameIdeas, type PostMatch } from './post-match.ts';
import { coinFirstLets, loadCoinFirst, recordAdmitted } from './coin-first.ts';
import { beyondCap, lateAnswerPolicy, lateLets, loadLateNoCoin } from './late-no-coin.ts';
import { loadRunningPicks, runningLets } from './running-picks.ts';
import { loadPromotedPicks, loadPromotions, NO_PROMOTED_PICKS, promotionOn, withCarried, type OwnReachOf } from './promotions.ts';
import { projectCoin } from './project.ts';
import { loadCoinCalls, withOwnerCall, type OwnerPostCall } from './owner-calls.ts';
import { loadStoryCoins } from './story-coins.ts';
import { withPlausibleLists } from './coin-list.ts';
import { liveCoinLine, loadPostPicks, type CardPick } from './one-coin-cards.ts';
import { writeSameNameCoins } from './same-name.ts';
import { loadRunningOlder, type WireOlderCoin } from './older-coins.ts';
import { permalinkFor } from './permalinks.ts';
import { forYouTime, loadShares, projectShare, type WireSharedBy } from './resurfaced.ts';
import { accountKey, loadTopicLinks, topicsOf, withVariety, type ShareRule } from './variety.ts';
import { projectReach, projectSpark } from './project.ts';
import type { ReachReading } from './project.ts';
import { assertNoInternalVocabulary, instant, WireLeakError } from './wire.ts';
import type { WireCoin, WireCoinEvidence, WireCoinLink, WireInstant, WireMeasured, WirePostCoinLink, WireSpark } from './wire.ts';

export const RISING_FEEDS = ['fyp', 'popular'] as const;
export type RisingFeed = (typeof RISING_FEEDS)[number];

const EXCERPT_MAX_CHARS = 280;
/** A quoted post's words are clamped on screen; this only bounds the payload. */
const QUOTE_EXCERPT_MAX_CHARS = 280;

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
  /**
   * The post this one quotes, drawn inside the card as the source draws it (quoted.ts). Absent when
   * the post quotes none, or quotes one we hold nothing of. When the post has no picture of its
   * own, `thumbUrl` above is this post's picture, so the meme leads the card.
   */
  readonly quote?: WireQuotedPost;
  /**
   * ★ When the post was found deleted from its source, as ms: absent while it is not known to be.
   * Only ever set with proof (0131): the source stopped returning the post while the same account
   * was still readable. A post merely not returned (its account private or suspended, or one short
   * answer) carries nothing, because "we cannot tell" is not "deleted". The card keeps what we stored.
   */
  readonly deletedAt?: number;
  /**
   * ★ A huge account just shared this post (resurfaced.ts, Policy.judge.resurface): who, how, when,
   * and a link to the share. Absent for every other post. When present, For You counted the post's
   * age from `sharedBy.at`; `postedAt` above is still the post's own time.
   */
  readonly sharedBy?: WireSharedBy;
}

/**
 * A quoted post on a card: who posted it, a link to it, its words and its picture. The read
 * service adds the account's face (`authorPictureUrl`, `authorPictureFile`) and our copy of the
 * picture (`thumbFile`) at read time, as it does for the card's own.
 */
export interface WireQuotedPost {
  readonly id: string;
  /** "@handle", else the account's name; never an internal key. */
  readonly authorLabel: string;
  /** The account's display name; null when the source gave none. */
  readonly authorName: string | null;
  readonly permalink: string | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  readonly thumbIsVideo: boolean;
  readonly postedAt: WireInstant;
}

/**
 * The post sheet's facts that only this process can read (public.observation and the crypto
 * reads are not the app role's):
 *
 *   views          every view reading we took, oldest first; a censored one is null and breaks
 *                  the chart's line rather than dropping it to the floor
 *   counts         the same readings, with the post's first reading's count too (`firstCount`):
 *                  For You's Trending and Most viewed (services/read post-sorts.ts) count a post's
 *                  views gained from these. `views` has no first count (its rate has nothing
 *                  before it, so it is censored), so a gain worked out from `views` lost the whole
 *                  interval between the first and second reading: every post on For You, its early
 *                  climb most of all. A first count gives away no rate we refused to publish:
 *                  there is no reading before it to take a difference from. Not for the chart.
 *   perMinute      views a minute lately (fyp-freshness.ts `recentGrowthPerMinute`, the same
 *                  rate For You is ordered by); null when the readings cannot say
 *   tickersInReplies  how many times other accounts named a $ticker in the newest replies and
 *                  quote posts we read (0064, `_others`); null when we have not read them —
 *                  never zero for "not read"
 */
export interface WirePostSheetFacts {
  readonly views: readonly { readonly atMs: number; readonly value: number | null }[];
  /** Absent on a card projected before it existed: the read service then counts from `views`. */
  readonly counts?: readonly { readonly atMs: number; readonly value: number | null }[];
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
  /** The post this one quotes (quoted.ts), or null; absent from a row built by hand. */
  reproduction_of?: string | null;
  /* Null together when the judge has not answered: such a row is loaded only when the owner
     called it a meme. */
  coinable: boolean | null;
  confidence: number | null;
  looked_at: 'text' | 'picture' | 'videoFrame' | null;
  proposed_name: string | null;
  /** The judge that gave the first question's answer: it decides which cutoff holds (judge-cutoff.ts). */
  judge_id?: string | null;
  picture_similarity: number | null;
  story_id: string | null;
  /** The owner's newest call on this post (0054), or null when there is none. */
  owner_call?: OwnerPostCall | null;
  /**
   * The label the kind question filed, when the post's newest answer is a kind answer (prompt id
   * `post-kind…`); null otherwise. Only a held kind holds (core `heldKind`): OTHER holds nothing.
   */
  kind_label?: string | null;
  /**
   * Whether our own coin model's stored score (0096) would let this post through: read only while
   * Policy.judge.coinModel.on, absent otherwise. The score itself is never loaded.
   */
  net_add?: boolean | null;
  /** A catch-all lane credited the post (internal.item_found_by); false for a late post loaded by id alone. Absent on a row built by hand. */
  credited?: boolean;
  /** When the post was found deleted from its source (0131, `loadDeleted`); absent or null when it is not known to be. */
  deleted_at?: Date | string | null;
  /** The viral exception's stored answers (0138, `loadViral`), read only while Policy.judge.viral.on; absent or null: never asked. */
  viral?: ViralAnswer | null;
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
 * story it belongs to, if any — and the feed members outside the window that this run refreshes
 * (feed-members.ts), which are projected for their cards and never put in the frame. The service
 * role reads `internal`; the score never leaves
 * this function except as the yes or no `postScore` makes of it.
 */
export async function loadCandidates(
  db: Db,
  sinceMs: Millis,
  members: readonly string[] = [],
  only: readonly string[] | null = null,
  net: CoinModelTarget | null = null,
  /**
   * Posts loaded though no catch-all lane credited them (late-no-coin.ts: a late post is often found
   * by a coin's link or a narrative's search, which credit nothing). Each must also be in `members`
   * or inside the window to be read. `credited` says which rows a lane found.
   */
  uncredited: readonly string[] = [],
): Promise<readonly RisingRow[]> {
  /* ★ The safety net's one bit, joined only while it is on: before 0096 is applied the table does not
     exist, and with the net off nothing here may depend on it. Only the live target's would-add
     (Policy.judge.coinModel.liveTarget, 0099): a shadowed target never lets a post through. The
     target is one of COIN_MODEL_TARGETS, so it is spelled into the query rather than bound. */
  const netColumn = net !== null && COIN_MODEL_TARGETS.includes(net) ? `exists (select 1 from internal.coin_model_score cms where cms.item_id = i.item_id and cms.would_add and cms.target = '${net}') as net_add` : `null::boolean as net_add`;
  const rows = await db.query<RisingRow>(
    `select i.item_id, i.source, i.source_item_id, i.posted_at, i.first_seen_at, i.body, i.media, i.reproduction_of,
            a.handle, a.display_name, a.source_author_id,
            j.coinable, j.confidence, j.looked_at, j.proposed_name, j.judge_id,
            k.kind_label, ${netColumn},
            pic.similarity as picture_similarity,
            s.story_id,
            oc.verdict as owner_call,
            f.credited
       from (select fb.item_id, true as credited from internal.item_found_by fb
             union all
             select u.item_id, false from unnest($4::text[]) as u(item_id)
              where not exists (select 1 from internal.item_found_by g where g.item_id = u.item_id)) f
       join public.item i on i.item_id = f.item_id
       join public.author a on a.author_key = i.author_key
       /* ★ The first question's newest answer, never a kind answer: a kind label is not a name, and
          its yes/no is not the judge's verdict on the post (two OTHER answers filed as "no" hid two
          posts on 2026-10-13). The kind is read beside it, below. */
       left join lateral (
              select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name, pj.judge_id
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
          Read here and nowhere else; it decides, and never reaches the wire. In the policy's picture
          space only ($5): the bar was measured in it, and a max over two models' vectors is no number. */
       left join lateral (
              select max(1 - (e.embedding <=> c.embedding)) as similarity
                from internal.image_embedding e
                join internal.coined_picture c on c.space = e.space and c.space = $5
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
        and (coalesce(i.posted_at, i.first_seen_at) >= $1 or i.item_id = any($2::text[]))
        and (j.coinable is not null or oc.verdict = 'meme')
        and ($3::text[] is null or f.item_id = any($3::text[]))`,
    [new Date(sinceMs).toISOString(), [...members], only === null ? null : [...only], [...uncredited], DEFAULT_POLICY.group.image.space],
  );
  const gone = await loadDeleted(db, rows.map((r) => r.item_id));
  return gone.size === 0 ? rows : rows.map((r) => (gone.has(r.item_id) ? { ...r, deleted_at: gone.get(r.item_id) ?? null } : r));
}

/**
 * The viral exception's stored answers for these posts (0138, PgViralMomentRepo). Its own query, so a
 * database without 0138 projects every frame as before — no post passes this way — rather than failing.
 */
export async function loadViral(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, ViralAnswer>> {
  try {
    return await new PgViralMomentRepo(db).answers(itemIds);
  } catch (e: unknown) {
    /* Said once a process: the quick frame runs every few seconds. */
    if (!viralUnreadSaid) console.warn(`the viral exception's answers could not be read; no post passes that way until they can: ${e instanceof Error ? e.message : String(e)}`);
    viralUnreadSaid = true;
    return new Map();
  }
}
let viralUnreadSaid = false;

/**
 * The posts among these known to be deleted from their source (0131 `public.item.deleted_at`, set by
 * the runner's work/gone-posts.ts only with proof), with when. Its own query, so a database without
 * 0131 projects every card as before rather than failing the frame: the card then says nothing.
 */
export async function loadDeleted(db: Db, itemIds: readonly string[]): Promise<ReadonlyMap<string, Date | string>> {
  if (itemIds.length === 0) return new Map();
  try {
    const rows = await db.query<{ item_id: string; deleted_at: Date | string }>(
      `select item_id, deleted_at from public.item where item_id = any($1::text[]) and deleted_at is not null`,
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, r.deleted_at] as const));
  } catch {
    return new Map();
  }
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
/** How long before a post a coin may launch and still be counted as made from it (mobile shared/coins-made.ts COIN_LEAD_MS). */
export const COIN_LEAD_MS = 10 * 60_000;

/** Each address's launch time in ms, where the asset row has one. */
async function loadLaunches(db: Db, addresses: readonly string[]): Promise<ReadonlyMap<string, number>> {
  if (addresses.length === 0) return new Map();
  const rows = await db.query<{ address: string; at: number | string | null }>(
    `select address, (extract(epoch from minted_at) * 1000)::float8 as at from public.asset where chain = 'solana' and address = any($1::text[]) and minted_at is not null`,
    [[...addresses]],
  );
  return new Map(rows.flatMap((r) => (r.at === null || !Number.isFinite(Number(r.at)) ? [] : [[r.address, Number(r.at)] as const])));
}

export type PostLookup = { readonly coins: readonly string[]; readonly more: boolean; readonly match?: PostLookupMatch } | { readonly gaveUp: true };

/**
 * The coins weighed (post-match.ts): one coin settled with the facts that settled it, or the
 * list in evidence order with each coin's facts. Absent when nothing was weighed.
 */
export type PostLookupMatch =
  /* `owner`: the owner named this coin (owner-calls.ts `loadCoinCalls`); it wins over a story's link.
     `story`: the owner's coin for this post's story (story-coins.ts), or this post's proven coin when
     it is that same coin; it wins over a narrative's link too, never over the owner's own call. */
  | { readonly kind: 'matched'; readonly coin: WireCoin; readonly evidence: WireCoinEvidence; readonly owner?: true; readonly story?: true }
  | { readonly kind: 'unsure'; readonly order: readonly string[]; readonly evidence: ReadonlyMap<string, WireCoinEvidence> };

/**
 * The owner's coin labels as live checks on one post (the owner, 2026-10-14): coins the owner said
 * are not this post's — on the post itself, or on a post of its story (story-coins.ts) — are never
 * shown on it, and "No coin is from this" on it shows no coin at all.
 */
export interface CoinCheck {
  readonly wrong: ReadonlySet<string>;
  readonly none: boolean;
}

/** Each post's check from the owner's calls on it and on its story; a post with nothing to check is absent. */
export function coinChecks(itemIds: readonly string[], calls: ReadonlyMap<string, PostCoinCalls>, stories: ReadonlyMap<string, StoryCoin>): ReadonlyMap<string, CoinCheck> {
  const out = new Map<string, CoinCheck>();
  for (const id of itemIds) {
    const own = calls.get(id);
    const story = stories.get(id);
    const wrong = new Set([...(own?.wrong.keys() ?? []), ...(story?.wrong ?? [])]);
    /* The owner's own coin on the post is never kept off it by a story's wrong call. */
    if (own?.own !== null && own?.own !== undefined) wrong.delete(own.own.address);
    const none = own?.none === true;
    if (wrong.size > 0 || none) out.set(id, { wrong, none });
  }
  return out;
}

/** A narrative's link with the coins the owner called wrong taken out; a link left with fewer than it needs is no link. */
export function withoutWrong(link: WireCoinLink | undefined, check: CoinCheck | null): WireCoinLink | undefined {
  if (link === undefined || check === null || check.wrong.size === 0) return link;
  if (link.kind === 'one') return check.wrong.has(link.coin.address) ? undefined : link;
  if (link.kind === 'several') {
    const kept = link.coins.filter((c) => !check.wrong.has(c.address));
    if (kept.length === link.coins.length) return link;
    const [a, b, ...rest] = kept;
    /* One left is not "several", and is not the board's confident `one` either: the post decides. */
    return a !== undefined && b !== undefined ? { kind: 'several', coins: [a, b, ...rest] } : undefined;
  }
  return link;
}

/** A post's finished search with the coins the owner called wrong taken out of its list. */
export function lookupWithoutWrong(lookup: PostLookup, check: CoinCheck | undefined): PostLookup {
  if (check === undefined || check.wrong.size === 0 || !('coins' in lookup)) return lookup;
  return { ...lookup, coins: lookup.coins.filter((a) => !check.wrong.has(a)) };
}

/** The row's coin line and the story it came from, by the rule in the header. */
export function postCoins(
  linked: WireCoinLink | undefined,
  lookup: PostLookup | null,
  check: CoinCheck | null = null,
): { readonly coins: WirePostCoinLink; readonly fromStory: boolean; readonly sameName: readonly string[] } {
  /* "No coin is from this": the owner said so, and no story, search or evidence says otherwise. */
  if (check?.none === true) return { coins: { kind: 'none' }, fromStory: false, sameName: [] };
  /* The owner's own coin first: "This is the coin" outranks a narrative's link and the evidence;
     then the owner's coin for this post's story ("Coin for this story"). */
  if (lookup !== null && 'coins' in lookup && lookup.match?.kind === 'matched' && (lookup.match.owner === true || lookup.match.story === true)) {
    const m = lookup.match;
    return { coins: { kind: 'matched', coin: m.coin, evidence: m.evidence }, fromStory: false, sameName: [m.coin.address, ...lookup.coins.filter((a) => a !== m.coin.address)] };
  }
  const storyLink = withoutWrong(linked, check);
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

/**
 * A quoted post as the card carries it; null when there is nothing to draw (no words, no picture)
 * or when its own words carry a word the wire refuses — then the card goes out without it, never
 * withheld whole for another account's post.
 */
export function projectQuote(row: QuotedRow): WireQuotedPost | null {
  const handle = (row.handle ?? '').trim().replace(/^@/, '');
  const name = (row.display_name ?? '').trim();
  const picture = pictureOf(row.media);
  const excerpt = trimTo(withoutTrailingShortLinks(row.body ?? ''), QUOTE_EXCERPT_MAX_CHARS);
  if (excerpt === '' && picture === null) return null;
  const quote: WireQuotedPost = {
    id: row.item_id,
    authorLabel: handle !== '' ? `@${handle}` : name,
    authorName: name === '' ? null : name,
    permalink: handle === '' ? null : permalinkFor(row.source, handle, row.source_item_id),
    excerpt,
    thumbUrl: picture?.uri ?? null,
    thumbIsVideo: picture?.isVideo ?? false,
    postedAt: instant(toMs(row.posted_at), 'not_reported'),
  };
  if (quote.authorLabel === '') return null;
  try {
    assertNoInternalVocabulary(quote, `$.quote[${row.item_id}]`);
  } catch (error: unknown) {
    if (error instanceof WireLeakError) return null;
    throw error;
  }
  return quote;
}

export function projectRisingPost(
  row: RisingRow,
  readings: readonly ReachReading[],
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  sparkWindowMs: number,
  lookup: PostLookup | null = null,
  runningOlder: readonly WireOlderCoin[] = [],
  sheet: WirePostSheetFacts | null = null,
  check: CoinCheck | null = null,
  quoted: QuotedRow | null = null,
): WireRisingPost {
  const latest = readings[readings.length - 1];
  const link = row.story_id === null ? undefined : coinsByStory.get(row.story_id);
  const coin = postCoins(link, lookup, check);
  const handle = (row.handle ?? '').trim().replace(/^@/, '');
  const quote = quoted === null ? null : projectQuote(quoted);
  /* ★ The post's own picture first; with none, the quoted post's leads the card (quoted.ts). */
  const picture = mainPicture(row.media, quote);
  const deletedMs = toMs(row.deleted_at ?? null);
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
    ...(quote === null ? {} : { quote }),
    ...(deletedMs === null ? {} : { deletedAt: deletedMs }),
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
  /**
   * Every feed member this run projected (feed-members.ts), shown or not, with its new card; empty
   * without 0075. A member the judge has since turned down is here too: it keeps its place.
   */
  readonly members: readonly WireRisingPost[];
  /**
   * The posts this frame lets onto For You by the coin-first route alone (coin-first.ts): not members
   * yet, and no other gate would have let them in. The writer records the ones it shows (0116); never
   * sent. Absent on a frame built by hand.
   */
  readonly coinFirst?: ReadonlySet<string>;
  /** The posts on this frame's For You list by the late route (late-no-coin.ts), cut or not. Absent on a frame built by hand. */
  readonly late?: ReadonlySet<string>;
  /**
   * The late route's posts the cut left under the frame, not members yet: they join For You's list for
   * good all the same (`beyondCap`), at their own place on the scroll. Absent on a frame built by hand.
   */
  readonly lateJoins?: readonly WireRisingPost[];
  /** The feed members this frame found to be promotions (promotions.ts): withdrawn from the scroll by the writer. Absent on a frame built by hand. */
  readonly promotions?: ReadonlySet<string>;
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
 * A reading's count when its rate is censored only because nothing was read before it (`no_prior`),
 * else null. Every other censored reason stays null on the card, as on `views`: a count under the
 * rounding step or read twice at one instant would let a client take the very difference that was
 * refused (db.ts `loadReach`).
 */
export function firstCount(x: ReachReading): number | null {
  if (x.rate.kind !== 'censored' || x.rate.reason !== 'no_prior') return null;
  const v = x.count ?? x.rate.lastLevel;
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
}

/**
 * The readings a feed's views bars hold a post to. Measured counts only, as the card's views line
 * shows them; with `rising.feedBarCountsEveryReading`, every readable count, as the scorer reads
 * them — a first reading and a flat one included. A reading loaded without its count keeps its
 * measured level.
 */
export function barReadings(readings: readonly ReachReading[], policy = DEFAULT_POLICY): ReachLevel[] {
  const measured = (x: ReachReading): number | null => (x.rate.kind === 'measured' ? x.rate.level : null);
  return readings.map((x) => ({ atMs: x.atMs, reach: policy.rising.feedBarCountsEveryReading && x.count !== undefined ? x.count : measured(x) }));
}

/**
 * Whether one loaded post passes, and by which route: core `passesWithSignal` (the judge, the judge
 * with other accounts' crypto signal, or the signal alone on a kind not held; a shill never), with
 * the owner's call over it. A row with no answer is here only because the owner called it a meme.
 */
/**
 * How a post passed: core's routes, or `net` — the judge said no and our own coin model's stored
 * score would let it through (Policy.judge.coinModel.on). A `net` post is For You's only.
 */
export type RisingRoute = PassRoute | 'net' | 'viral';

export function postRoute(row: RisingRow, policy = DEFAULT_POLICY, signal: CryptoSignal | null = null): { readonly why: FeedRejectionReason | 'passes'; readonly route: RisingRoute | null } {
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
  /* ★ THE SAFETY NET (the owner, 2026-10-18): the judge said no, our own coin model is sure. Only a
     plain "no" — never an unsure yes, a held kind or the close-match hold (filed as a kind), a shill,
     or the owner's Not a meme (returned above) — and every gate after this one still applies: the
     score bar, the reach bar, the age bar, variety. */
  if (policy.judge.coinModel.on && row.net_add === true && answer !== null && !answer.coinable && heldKind(kind, policy.judge.heldKinds) === null && signal?.shill !== true) {
    return { why: 'passes', route: 'net' };
  }
  /* ★ THE VIRAL EXCEPTION (Policy.judge.viral, core viral.ts): a "no", or a politics or showbiz hold,
     that was huge and fast and that the moment and kind questions both let through. Never a shill,
     another held kind or the owner's Not a meme (returned above); For You's only, and every later
     gate but the junk bar still applies. */
  if (answer !== null && signal?.shill !== true && viralEligible(answer.coinable, kind, policy) && passesAsViral(row.viral ?? null, policy)) {
    return { why: 'passes', route: 'viral' };
  }
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
 * The scroll under the frame continues this exact order (services/read feed-page.ts, by the same
 * time and `collate "C"`), and the phone merges by it too, so the id tie-break is byte order, not
 * the locale's: a locale order differs from the database's and would repeat or skip a post at a
 * page boundary. The card's age is `postedAt`, the same posted time; with none it shows a dash
 * and takes its place by when we first saw it.
 */
export function forYouOrder(a: { readonly at: number; readonly id: string }, b: { readonly at: number; readonly id: string }): number {
  return b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * A For You list with the changed posts put in, re-placed or taken off (before the variety rule and
 * the cut): the cards of `showing` that did not change as they were, the changed ones as `built` has
 * them, newest first by `at`. The quick frame merges its newly built posts into the committed list;
 * the full frame merges the committed cards of posts that changed since it began into its own.
 */
export function mergeForYou<P extends { readonly id: string }>(
  showing: readonly P[],
  changed: ReadonlySet<string>,
  built: readonly P[],
  at: (post: P) => number,
): P[] {
  const kept = showing.filter((p) => !changed.has(p.id));
  const keptIds = new Set(kept.map((p) => p.id));
  const all = [...kept, ...built.filter((p) => !keptIds.has(p.id))];
  return all.sort((a, b) => forYouOrder({ at: at(a), id: a.id }, { at: at(b), id: b.id }));
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

/**
 * ★ THE COIN THAT BROUGHT THE POST IN IS ON ITS LIST (the owner, 2026-10-18: "show the coin that brought
 * the post in: put it in the card's coin list, not as 'Links this post'"). A post For You takes on a
 * coin's word (`coinVouches`) lists that first coin among its coins — "See N coins", the post sheet's
 * "All N coins" — as one more listed coin: added after the weighing, so it is never the card's
 * proven coin and carries none of the weighing's facts, "Links this post" among them. Since
 * 2026-10-16 the coins whose metadata names a post are not weighed (Policy.postCoin.linkedCandidates),
 * and six of seven coin-path cards did not list the coin that put them there. A coin the owner called
 * wrong on the post stays off; a coin already listed or proven is left where it is; a post whose
 * search found nothing, or has not finished, lists this one coin.
 */
export function withVouchingCoin(lookup: PostLookup | undefined, address: string, check: CoinCheck | undefined): PostLookup | undefined {
  if (check?.none === true || check?.wrong.has(address) === true) return lookup;
  if (lookup === undefined || !('coins' in lookup)) return { coins: [address], more: false };
  if (lookup.coins.includes(address) || (lookup.match?.kind === 'matched' && lookup.match.coin.address === address)) return lookup;
  return { ...lookup, coins: [address, ...lookup.coins] };
}

/** Whether the first coin naming a post puts it past For You's view bar (core `coinVouches`); no coin, no. */
export const coinVouchesFor = (facts: CoinVouchRow | undefined, policy = DEFAULT_POLICY): boolean => facts !== undefined && coinVouches(facts, policy);

/**
 * ★ THE POLICY FOR YOU'S VIEWS BAR IS HELD TO (`rising.speedBar.forYouMinAgeMs`, 2026-10-20): the speed
 * bar from its own youngest age instead of the shared `minAgeMs`. Here only, never in core: the scorer
 * asks core's bar to decide whether a post is judged now, and a younger age there would judge more
 * posts. A post already judged yes and on pace at 15 minutes waited for 30 on that shared number.
 * Null, or the speed bar off: the policy as it is.
 */
export function forYouBarPolicy<P extends typeof DEFAULT_POLICY>(policy: P): P {
  const s = policy.rising.speedBar;
  if (s.forYouMinAgeMs === null || s.forYouMinAgeMs === s.minAgeMs) return policy;
  return { ...policy, rising: { ...policy.rising, speedBar: { ...s, minAgeMs: s.forYouMinAgeMs } } };
}

/** Load, filter by the per-post score and each feed's view bar, project, and order both feeds. Writes nothing. */
export async function buildRising(
  db: Db,
  nowMs: Millis,
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  sparkWindowMs: number,
  policy = DEFAULT_POLICY,
  membership: Membership | null = null,
  /** The policy each answer is held to, by the model that gave it (judge-cutoff.ts). */
  answers: AnswerPolicies = onePolicy(policy),
  /** Only these posts (the quick frame's changed ones, quick-frame.ts); null: every post in the window. */
  only: readonly string[] | null = null,
): Promise<RisingFrame> {
  const sinceMs = (nowMs - policy.rising.windowMs) as Millis;
  const whyNot = new Map<string, FeedRejectionReason>();
  const heldBy = new Map<string, HeldKind>();
  /* ★ THE COIN-FIRST ROUTE's posts (coin-first.ts): loaded whatever their age, as a member is. */
  const coinFirst = await loadCoinFirst(db, nowMs, policy, only, membership === null ? [] : [...membership.fyp]);
  /* ★ THE LATE ROUTE's posts (late-no-coin.ts): found after the six hours, no coin running yet; loaded whatever their age and whoever found them. */
  const late = await loadLateNoCoin(db, nowMs, policy, only);
  /* ★ THE PICKS ON PROMOTIONS (promotions.ts): each one's coin is its original's, young or running. */
  const ownReachOf: OwnReachOf = (source) => policy.rising.fypMinReach * (source === SHORT_VIDEO_SOURCE ? policy.rising.shortVideoReachScale : 1);
  const promoted = promotionOn(policy) ? await loadPromotedPicks(db, nowMs, ownReachOf, policy) : NO_PROMOTED_PICKS;
  /* ★ THE RUNNING PICKS (running-picks.ts): loaded whatever their age, and whichever route stored them; a promotion's, as its original. */
  const running = await loadRunningPicks(db, nowMs, policy, only, promoted.byPromo);
  /* ★ THE POSTS A HUGE ACCOUNT JUST SHARED (resurfaced.ts): loaded whatever their own age; For You counts them from the share. */
  const shares = await loadShares(db, nowMs, policy, only);
  const loaded = await loadCandidates(db, sinceMs, [...(membership?.refresh ?? []), ...coinFirst.records.keys(), ...late.keys(), ...running.keys(), ...shares.keys()], only, policy.judge.coinModel.on ? policy.judge.coinModel.liveTarget : null, [...new Set([...late.keys(), ...running.keys(), ...shares.keys()])]);
  const crypto = await loadCryptoReads(db, loaded.map((row) => row.item_id));
  /* ★ THE VIRAL EXCEPTION's answers (0138), only while it is on. */
  const viralAnswers = policy.judge.viral.on ? await loadViral(db, loaded.map((row) => row.item_id)) : new Map<string, ViralAnswer>();
  const candidates = viralAnswers.size === 0 ? loaded : loaded.map((row) => (viralAnswers.has(row.item_id) ? { ...row, viral: viralAnswers.get(row.item_id) ?? null } : row));
  const ownAtOf = (row: RisingRow): number => toMs(row.posted_at) ?? toMs(row.first_seen_at) ?? 0;
  /* For You's time for a post: its own, or its newest huge-account share's when later (resurfaced.ts). */
  const atOf = (row: RisingRow): number => forYouTime(ownAtOf(row), shares.get(row.item_id));
  /* On For You by a share alone (its own time outside the window): For You's, never Popular's. */
  const sharedOnly = new Set(candidates.filter((row) => shares.has(row.item_id) && ownAtOf(row) < sinceMs).map((row) => row.item_id));
  /* Whether each loaded post passes now; a member that no longer does is still projected for its
     card (feed-members.ts), and is never in the frame. Only posts inside the window are given a
     reason: a member refreshed from outside it did not leave the frame for a reason. */
  const passing = new Set<string>();
  /* Passed only through the safety net: For You's, never Popular's. */
  const netOnly = new Set<string>();
  /* Passed only through the viral exception: For You's, never Popular's, and not held to the junk bar. */
  const viralOnly = new Set<string>();
  /* Passed only by the late route's near-the-bar yes (late-no-coin.ts `lateAnswerPolicy`): that route's alone. */
  const nearOnly = new Set<string>();
  const rows = candidates.filter((row) => {
    const signal = cryptoSignalFor(row, crypto.get(row.item_id), policy);
    const own = postRoute(row, policyForAnswer(row.judge_id, answers), signal);
    const inWindow = atOf(row) >= sinceMs || coinFirst.records.has(row.item_id) || late.has(row.item_id) || running.has(row.item_id);
    const near = own.route === null && late.has(row.item_id) ? postRoute(row, lateAnswerPolicy(policyForAnswer(row.judge_id, answers), policy), signal) : null;
    const nearYes = near !== null && near.route !== null && near.route !== 'net' && near.route !== 'viral';
    if (nearYes && inWindow) nearOnly.add(row.item_id);
    const { why, route } = nearYes && near !== null ? near : own;
    if (why !== 'passes' && inWindow) whyNot.set(row.item_id, why);
    const held = postHeldKind(row, policy);
    if (why !== 'passes' && held !== null && inWindow) heldBy.set(row.item_id, held);
    if (why === 'passes' && inWindow) passing.add(row.item_id);
    if (route === 'net' && inWindow) netOnly.add(row.item_id);
    if (route === 'viral' && inWindow) viralOnly.add(row.item_id);
    return passing.has(row.item_id) || membership?.all.has(row.item_id) === true || running.has(row.item_id);
  });
  /* A refreshed member's readings start before the window: read from its own time. */
  const readFromMs = Math.min(sinceMs, ...rows.map(atOf)) as Millis;
  const reach = await loadReach(db, rows.map((row) => row.item_id), readFromMs);
  /* ★ A COIN NAMING A POST STANDS IN FOR ITS VIEWS (`rising.coinLinked`, core `coinVouches`): read
     for the passing posts only, and only while the switch is on. */
  const vouch: ReadonlyMap<string, CoinVouchRow> = policy.rising.coinLinked.on ? await new PgFinderRepo(db).coinVouchFacts([...passing]) : new Map();
  /* ★ THE OWNER'S COIN LABELS, LIVE: every coin call (the owner's own coin, the coins called wrong,
     "No coin is from this") and the coin the owner confirmed for each post's story. */
  const rowIds = rows.map((row) => row.item_id);
  const calls = await loadCoinCalls(db, null);
  const stories = await loadStoryCoins(db, rowIds, calls, policy);
  const checks = coinChecks(rowIds, calls, stories);
  const searched = new Map([...(await loadPostLookups(db, rowIds))].map(([id, l]) => [id, lookupWithoutWrong(l, checks.get(id))] as const));
  const weighed = await withMatches(db, rows, searched, coinsByStory, nowMs, sparkWindowMs, policy, calls, stories, checks);
  /* ★ THE COIN THAT BROUGHT THE POST IN, ON ITS LIST (`withVouchingCoin`), after the weighing so it is listed and never proven. */
  const lookups = new Map(weighed);
  for (const [id, facts] of vouch) {
    if (!coinVouchesFor(facts, policy) || facts.firstCoinAddress === null || facts.firstCoinAddress === undefined) continue;
    const listed = withVouchingCoin(lookups.get(id), facts.firstCoinAddress, checks.get(id));
    if (listed !== undefined) lookups.set(id, listed);
  }
  const older = await loadRunningOlder(db, rows.map((row) => row.item_id));
  /* The posts these quote (quoted.ts): the card draws each inside it. */
  const quoted = await loadQuotedPosts(db, rows.map((row) => row.reproduction_of));
  /* ★ ONE POST, ONE COIN (one-coin-cards.ts): only in live mode is the runner's pick read, and then
     it is the card's coin, or Create; in shadow nothing here is read and every card is as before. */
  const live = policy.oneCoin.mode === 'live';
  /* ★ An original carries its promotion's coin where it has none picked of its own (promotions.ts `withCarried`). */
  const picks: ReadonlyMap<string, CardPick> = live ? withCarried(await loadPostPicks(db, rowIds), promoted.byOriginal, rowIds) : new Map();
  /* ★ THE PROMOTIONS (promotions.ts): a post only pointing at another account's bigger post is on neither feed, by any route. */
  const promotions = promotionOn(policy) ? await loadPromotions(db, rowIds, ownReachOf) : new Map();
  const pickedFacts = live ? await loadCoinFactsByAddress(db, [...new Set([...picks.values()].flatMap((p) => (p.outcome === 'picked' && p.address !== null ? [p.address] : [])))]) : new Map();
  const pickOptions = { nowMs, sparkWindowMs, marketFreshnessMs: policy.market.readingFreshnessMs, feedFreshnessMs: policy.assets.feedFreshnessMs };
  /* ★ THE OWNER'S "SEE N COINS" COUNTS ONLY COINS MADE AFTER THE POST (the owner, 2026-10-24: the
     count said 5 and the list, which leaves out older same-name coins — mobile shared/coins-made.ts —
     was empty). Launched no earlier than COIN_LEAD_MS before the post; a coin of unknown launch is
     not counted, as the list does not show it. */
  const launchOf = live ? await loadLaunches(db, [...new Set([...lookups.values()].flatMap((l) => ('coins' in l ? l.coins : [])))]) : new Map<string, number>();
  const madeAfter = (row: RisingRow, coins: readonly string[]): number => {
    const posted = toMs(row.posted_at);
    if (posted === null) return 0;
    return coins.filter((a) => {
      const at = launchOf.get(a);
      return at !== undefined && at >= posted - COIN_LEAD_MS;
    }).length;
  };
  /* ★ The huge account's share on the card (resurfaced.ts): a fact, and the reason an older post is here. */
  const withShared = (row: RisingRow, post: WireRisingPost): WireRisingPost => {
    const share = shares.get(row.item_id);
    const sharedBy = share === undefined ? null : projectShare(share);
    if (sharedBy === null) return post;
    const out: WireRisingPost = { ...post, sharedBy };
    assertNoInternalVocabulary(out, `$.rising[${row.item_id}]`);
    return out;
  };
  const withPick = (row: RisingRow, post: WireRisingPost, lookup: PostLookup | null): WireRisingPost => {
    if (!live) return post;
    const check = checks.get(row.item_id);
    const owners = lookup !== null && 'coins' in lookup && lookup.match?.kind === 'matched' && (lookup.match.owner === true || lookup.match.story === true);
    if (check?.none === true || owners) return post;
    const pick = picks.get(row.item_id);
    const f = pick?.address === null || pick?.address === undefined ? undefined : pickedFacts.get(pick.address);
    const listed = lookup !== null && 'coins' in lookup ? { count: madeAfter(row, lookup.coins), more: false } : { count: 0, more: false };
    const coins = liveCoinLine(post.coins, pick, f === undefined ? null : projectCoin(f, pickOptions), listed, check?.wrong ?? new Set());
    const out: WireRisingPost = { ...post, coins, storyId: coins === post.coins ? post.storyId : null };
    assertNoInternalVocabulary(out, `$.rising[${row.item_id}]`);
    return out;
  };
  /* The order model: the latest applied fit, and crypto attention only when the fit weighs it. */
  const scores = new PgScoreModelRepo(db);
  const applied = await scores.latestApplied();
  const fit: ScoreFit | null = applied === null ? null : { intercept: applied.intercept, terms: applied.terms };
  const attention = fit !== null && fit.terms.some((t) => t.signal === 'attention') ? await scores.attention(rows.map((row) => row.item_id)) : new Map<string, number>();
  /* For You's views bar only (`forYouBarPolicy`); Popular, freshness and the order model keep `policy`. */
  const fypBar = forYouBarPolicy(policy);
  const build = (row: RisingRow) => {
    const readings = reach.get(row.item_id) ?? [];
    /* Measured counts only: a censored reading's last level is an older number, and read at a
       later time it would overstate how fast the post grew. */
    const views: ReachLevel[] = readings.map((x) => ({ atMs: x.atMs, reach: x.rate.kind === 'measured' ? x.rate.level : null }));
    /* ★ The bars may read what the scorer read (`rising.feedBarCountsEveryReading`): every readable
       count, the first reading and a flat one included, so a post judged on a reading can show on
       it. The card's views line above stays measured-only. */
    const barViews = barReadings(readings, policy);
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
    const member = membership?.fyp.has(row.item_id) === true;
    /* ★ THE COIN-FIRST ROUTE: the judge's own yes (never the safety net), and the pick a coin that ties it. */
    const check = checks.get(row.item_id);
    const pick = picks.get(row.item_id);
    const byCoin = coinFirst.records.has(row.item_id) && coinFirstLets({
      itemId: row.item_id,
      postedAtMs: postedAt,
      judgedYes: passing.has(row.item_id) && !netOnly.has(row.item_id) && !viralOnly.has(row.item_id) && !nearOnly.has(row.item_id),
      pick: pick === undefined ? null : { outcome: pick.outcome, address: pick.address },
      member,
      ownerNone: check?.none === true,
      wrong: check?.wrong ?? new Set(),
    }, coinFirst, nowMs, policy);
    const byViews = !underBar && (clearsReachBar('fyp', barViews, postedAt, fypBar, scale) || coinVouchesFor(vouch.get(row.item_id), policy));
    /* ★ THE LATE ROUTE: the judge's own yes, the views bar, and no coin on the card or in the owner's word. */
    const byLate = lateLets({
      itemId: row.item_id,
      judgedYes: passing.has(row.item_id) && !netOnly.has(row.item_id) && !viralOnly.has(row.item_id),
      byViews,
      picked: pick?.outcome === 'picked',
      ownerCoin: calls.get(row.item_id)?.own !== null && calls.get(row.item_id)?.own !== undefined,
    }, late);
    /* ★ THE RUNNING PICK: the post's coin is trading now, the judge said yes once, the owner did not say no. */
    const byRunning = runningLets(running.get(row.item_id), { ownerNotMeme: row.owner_call === 'not', ownerNone: check?.none === true, wrong: check?.wrong ?? new Set() }, nowMs, policy);
    return {
      passes: passing.has(row.item_id),
      byCoin,
      byLate,
      byRunning,
      /* Loaded by the running route alone, no lane credited it: For You's, never Popular's. */
      runningOnly: running.has(row.item_id) && row.credited === false,
      /* Loaded by the late route alone: For You's, never Popular's. */
      lateOnly: late.has(row.item_id) && (row.credited === false || atOf(row) < sinceMs),
      score,
      underBar,
      post: withShared(row, withPick(row, projectRisingPost(row, readings, coinsByStory, sparkWindowMs, lookup, older.get(row.item_id) ?? [], {
        views: views.map((v) => ({ atMs: v.atMs, value: v.reach })),
        counts: readings.map((x) => ({ atMs: x.atMs, value: x.rate.kind === 'measured' ? x.rate.level : firstCount(x) })),
        perMinute: (() => {
          const g = recentGrowthPerMinute(views, nowMs, policy);
          return g === null ? null : Math.round(g);
        })(),
        tickersInReplies: crypto.get(row.item_id)?.othersTickers ?? null,
      }, checks.get(row.item_id) ?? null, (row.reproduction_of === null || row.reproduction_of === undefined ? undefined : quoted.get(row.reproduction_of)) ?? null), lookup)),
      sameName: postCoins(row.story_id === null ? undefined : coinsByStory.get(row.story_id), lookup, checks.get(row.item_id) ?? null).sameName,
      at: atOf(row),
      fyp: byViews || byCoin || byRunning,
      byViews,
      /* Six hours, unless still climbing fast (fyp-freshness.ts), with `rising.fypMaxAgeOn`. For
         You only: Popular keeps old posts. Ageing out is not a rejection, so it records no reason. */
      fresh: !policy.rising.fypMaxAgeOn || freshForYou(views, atOf(row), nowMs, policy, scale),
      /* ★ The six hours only stop a post JOINING For You late (the owner, 2026-10-14): a post already
         on it (feed-members.ts) stays while it is inside the window and passes. */
      member,
      unread: barViews.every((v) => v.reach === null),
      popular: clearsReachBar('popular', barViews, postedAt, policy, scale),
    };
  };
  /* One post whose own words carry a word the wire refuses (a post about a vendor, say) is left out
     of this frame on its own, printed, as a launch is in main.ts: it must never stop both feeds
     updating, which is what one such post did for five hours on 2026-10-15. */
  const built = rows.flatMap((row) => {
    try {
      return [build(row)];
    } catch (error: unknown) {
      if (!(error instanceof WireLeakError)) throw error;
      console.warn(`post ${row.item_id} was withheld from the feeds: ${error.message}`);
      return [];
    }
  });
  /* ★ A PROMOTION IS NEVER SHOWN: taken out after every route has had its say, so none puts it back.
     Its card is still projected for the members list below; leaving the frame records no reason. */
  const posts = built.filter((p) => !promotions.has(p.post.id));

  /* ★ FOR YOU'S JUNK BAR (junk-bar.ts, `rising.junkBar`): of the posts about to JOIN For You, the ones
     the junk fit puts over its own held-out bar stay off. A member is never re-asked. Ageing out and
     this bar only stop a post joining, so neither records a reason. */
  /* A viral-exception post is not asked: the junk fit learned the judge's "no"s, and the viral answers are the evidence against it. */
  const junk = await overJunkBar(db, posts.filter((p) => p.passes && p.fyp && (p.fresh || p.byLate) && !p.member && !p.byCoin && !p.byRunning && !viralOnly.has(p.post.id)).map((p) => p.post.id), policy);
  /* By the views and the other gates, or by the coin-first route, which none of the six hours and the junk bar hold;
     or by the late route, which the six hours do not hold and the junk bar does. */
  const byGates = (p: (typeof posts)[number]): boolean => !nearOnly.has(p.post.id) && p.byViews && (p.member || (p.fresh && !junk.has(p.post.id)));
  const byLateRoute = (p: (typeof posts)[number]): boolean => p.byLate && (p.member || !junk.has(p.post.id));
  const fypAll = posts.filter((p) => (p.passes && (byGates(p) || p.byCoin || byLateRoute(p))) || p.byRunning).sort((a, b) => forYouOrder({ at: a.at, id: a.post.id }, { at: b.at, id: b.post.id }));
  const coinFirstAlone = new Set(posts.filter((p) => p.passes && p.byCoin && !p.member && !byGates(p)).map((p) => p.post.id));
  /* ★ No one topic and no one account fills For You (variety.ts): only who is on it changes, never the order. */
  const fyp = await varied(db, fypAll, rows, policy);
  const views = (p: WireRisingPost): number | null => p.reach.v;
  const popular = posts.filter((p) => p.passes && p.popular && !netOnly.has(p.post.id) && !viralOnly.has(p.post.id) && !sharedOnly.has(p.post.id) && !nearOnly.has(p.post.id) && !p.lateOnly && !p.runningOnly).sort((a, b) => {
    const va = views(a.post);
    const vb = views(b.post);
    if (va === null || vb === null) return va === null ? (vb === null ? b.at - a.at : 1) : -1;
    return vb - va || b.at - a.at;
  });
  const cap = (list: typeof posts) => list.slice(0, policy.rising.maxRows).map((p) => p.post);
  for (const p of posts) if (p.passes && !p.fyp) whyNot.set(p.post.id, p.underBar ? 'under_score_bar' : p.unread ? 'reach_unread' : 'under_reach_bar');
  const shown = { fyp: cap(fyp), popular: cap(popular) };
  /* ★ The late route's posts under the cut join For You's list all the same (late-no-coin.ts `beyondCap`). */
  const lateIds = new Set(posts.filter((p) => p.passes && byLateRoute(p)).map((p) => p.post.id));
  const lateJoins = beyondCap(fyp.map((p) => p.post), policy.rising.maxRows, lateIds, membership?.fyp ?? new Set());
  const ids = new Set([...shown.fyp, ...shown.popular, ...lateJoins].map((p) => p.id));
  const sameName: Map<string, readonly string[]> = new Map(posts.filter((p) => ids.has(p.post.id) && p.sameName.length > 0).map((p) => [p.post.id, p.sameName] as const));
  const sameNameEvidence = new Map<string, ReadonlyMap<string, WireCoinEvidence>>();
  const evidenceOf = (id: string): void => {
    const l = lookups.get(id);
    if (l !== undefined && 'coins' in l && l.match?.kind === 'unsure') sameNameEvidence.set(id, l.match.evidence);
    if (l !== undefined && 'coins' in l && l.match?.kind === 'matched') sameNameEvidence.set(id, new Map([[l.match.coin.address, l.match.evidence]]));
  };
  const members = built.filter((p) => membership?.all.has(p.post.id) === true).map((p) => p.post);
  /* A member's list of same-named coins is kept with its card, so See N coins opens on an old card too. */
  for (const p of posts) if (!ids.has(p.post.id) && membership?.all.has(p.post.id) === true && p.sameName.length > 0) sameName.set(p.post.id, p.sameName);
  for (const id of sameName.keys()) evidenceOf(id);
  /* The members that are promotions: withdrawn from the scroll too (feed-members.ts), so none stays on screen. */
  const promotionMembers = new Set([...promotions.keys()].filter((id) => membership?.all.has(id) === true));
  return { ...shown, whyNot, heldBy, sameName, sameNameEvidence, members, coinFirst: coinFirstAlone, late: lateIds, lateJoins, promotions: promotionMembers };
}

/**
 * For You's posts with no topic and no account over its share (variety.ts), in the order given. The
 * topic facts are read for these posts alone: the story and the judge's name from the loaded rows,
 * the namer's guess and the meaning vectors from `internal`; the account from the loaded rows. With
 * both rules off the list comes back as given, and the topic reads are made only with the topic rule on.
 */
export async function varied<P extends { readonly at: number; readonly post: WireRisingPost }>(db: Db, list: readonly P[], rows: readonly RisingRow[], policy: typeof DEFAULT_POLICY): Promise<P[]> {
  const ids = list.map((p) => p.post.id);
  const byId = new Map(rows.map((row) => [row.item_id, row] as const));
  const rules: ShareRule[] = [];
  if (policy.rising.varietyOn) {
    const { guesses, alike } = await loadTopicLinks(db, ids, policy.rising.varietySameMeaning, policy.group.image.postSpace);
    const facts = new Map(ids.map((id) => {
      const row = byId.get(id);
      return [id, { storyId: row?.story_id ?? null, name: row?.proposed_name ?? guesses.get(id) ?? null }] as const;
    }));
    rules.push({ groupOf: topicsOf(ids, facts, alike), perWindow: policy.rising.varietyPerWindow, window: policy.rising.varietyWindow });
  }
  if (policy.rising.authorShare.on) {
    /* A post whose row was not loaded has no known account and is its own group. */
    const accounts = new Map(ids.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [[id, accountKey(row.source, row.source_author_id)] as const];
    }));
    rules.push({ groupOf: accounts, perWindow: policy.rising.authorShare.perWindow, window: policy.rising.authorShare.window });
  }
  if (rules.length === 0) return [...list];
  const cards = list.map((p) => ({ id: p.post.id, views: p.post.reach.v, at: p.at, p }));
  return withVariety(cards, rules).map((c) => c.p);
}

/**
 * Each searched post's coins weighed by evidence (post-match.ts), the answer folded into its
 * lookup: a confident coin is projected as the board projects its coins, with its market. A post
 * whose narrative decides its coins is not weighed — if the read has a story, the story decides —
 * unless the owner confirmed a coin for its story, which outranks the narrative's link: then the
 * post is weighed to learn whether it proves that coin itself.
 *
 * Then the owner's labels, live: the owner's own coin over everything; else the story's coin —
 * "Links this post" when the post's own evidence proves it, "Coin for this story" (`storyCoin`)
 * when it does not; and a coin the owner called wrong for the post or its story is never the
 * post's coin, proven or not.
 */
async function withMatches(
  db: Db,
  rows: readonly RisingRow[],
  lookups: ReadonlyMap<string, PostLookup>,
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  nowMs: Millis,
  sparkWindowMs: number,
  policy: typeof DEFAULT_POLICY,
  calls: ReadonlyMap<string, PostCoinCalls> = new Map(),
  stories: ReadonlyMap<string, StoryCoin> = new Map(),
  checks: ReadonlyMap<string, CoinCheck> = new Map(),
): Promise<ReadonlyMap<string, PostLookup>> {
  const ownerCoins = new Map(rows.flatMap((row) => {
    const own = calls.get(row.item_id)?.own;
    return own === null || own === undefined ? [] : [[row.item_id, own.address] as const];
  }));
  /* The story's coin, for a post with no coin of the owner's own, no "none", and the coin not called wrong. */
  const storyCoinOf = new Map(rows.flatMap((row) => {
    const sc = stories.get(row.item_id)?.coin;
    const check = checks.get(row.item_id);
    if (sc === null || sc === undefined || ownerCoins.has(row.item_id) || check?.none === true || check?.wrong.has(sc.address) === true) return [];
    return [[row.item_id, sc.address] as const];
  }));
  const lists = new Map<string, readonly string[]>();
  for (const row of rows) {
    const story = row.story_id === null ? undefined : withoutWrong(coinsByStory.get(row.story_id), checks.get(row.item_id) ?? null)?.kind;
    if ((story === 'one' || story === 'several' || story === 'unsure') && !storyCoinOf.has(row.item_id)) continue;
    const l = lookups.get(row.item_id);
    /* A search that found nothing is weighed too: the coin may be one its picture or its replies
       found (post-match.ts widens the list). */
    if (l !== undefined && 'coins' in l) lists.set(row.item_id, l.coins);
  }
  if (lists.size === 0 && ownerCoins.size === 0 && storyCoinOf.size === 0) return lookups;
  const weighed: ReadonlyMap<string, PostMatch> = lists.size === 0 ? new Map() : await weighPostCoins(db, lists, policy);
  /* A coin the owner called wrong for the post is never its proven coin, whatever the evidence says. */
  const wrongFor = (itemId: string, address: string): boolean => checks.get(itemId)?.wrong.has(address) === true;
  const confident = [...weighed].flatMap(([id, m]) => (m.decision.kind === 'confident' && !wrongFor(id, m.decision.address) ? [m.decision.address] : []));
  const facts = await loadCoinFactsByAddress(db, [...new Set([...confident, ...ownerCoins.values(), ...storyCoinOf.values()])]);
  const options = { nowMs, sparkWindowMs, marketFreshnessMs: policy.market.readingFreshnessMs, feedFreshnessMs: policy.assets.feedFreshnessMs };
  const out = new Map(lookups);
  for (const [itemId, m] of weighed) {
    const l = lookups.get(itemId);
    if (l === undefined || !('coins' in l)) continue;
    const kept = m.evidence.filter((x) => !wrongFor(itemId, x.address));
    const evidence = new Map(kept.map(({ address, ...e }) => [address, e] as const));
    const d = m.decision;
    const settled = d.kind === 'confident' && !wrongFor(itemId, d.address) ? d.address : null;
    const coin = settled === null ? undefined : facts.get(settled);
    const e = settled === null ? undefined : evidence.get(settled);
    /* A confident coin we cannot project (not an observed coin we hold) stays in the list: the
       card never offers Buy on a coin it cannot show. */
    if (coin !== undefined && e !== undefined) {
      out.set(itemId, { ...l, match: { kind: 'matched', coin: projectCoin(coin, options), evidence: e, ...(settled === storyCoinOf.get(itemId) ? { story: true as const } : {}) } });
    } else {
      out.set(itemId, { ...l, match: { kind: 'unsure', order: kept.map((x) => x.address), evidence } });
    }
  }
  const postedAt = new Map(rows.map((row) => [row.item_id, toMs(row.posted_at) ?? toMs(row.first_seen_at)] as const));
  const factsAgainst = (itemId: string, address: string, coin: WireCoin) => {
    const weighedHere = weighed.get(itemId)?.evidence.find((x) => x.address === address);
    const posted = postedAt.get(itemId) ?? null;
    return {
      weighedHere,
      launchedAfterMs: weighedHere?.launchedAfterMs ?? (coin.mintedAt.at === null || posted === null ? null : coin.mintedAt.at - posted),
    };
  };
  /* The story's coin, where the post itself did not prove it (a proof of it is already `story` above;
     a proof of ANOTHER coin is a fact about this post and stays). A coin we do not hold yet waits. */
  for (const [itemId, address] of storyCoinOf) {
    const l = out.get(itemId);
    const base = l !== undefined && 'coins' in l ? l : { coins: [], more: false };
    if (base.match?.kind === 'matched') continue;
    const f = facts.get(address);
    if (f === undefined) continue;
    const coin = projectCoin(f, options);
    const { weighedHere, launchedAfterMs } = factsAgainst(itemId, address, coin);
    const evidence: WireCoinEvidence = {
      linksPost: weighedHere?.linksPost ?? null,
      samePicture: weighedHere?.samePicture ?? null,
      launchedAfterMs,
      ...(weighedHere?.posterPostedAddress === undefined ? {} : { posterPostedAddress: weighedHere.posterPostedAddress }),
      ...(weighedHere?.posterBioNamesCoin === undefined ? {} : { posterBioNamesCoin: weighedHere.posterBioNamesCoin }),
      storyCoin: true,
    };
    out.set(itemId, { ...base, match: { kind: 'matched', coin, evidence, story: true } });
  }
  /* The owner's coin, over all of the above: proven for everyone, with the facts we hold about it
     against the post. A coin we do not hold yet waits for the runner to add it (owner-calls.ts). */
  for (const [itemId, address] of ownerCoins) {
    const f = facts.get(address);
    if (f === undefined) continue;
    const coin = projectCoin(f, options);
    const { weighedHere, launchedAfterMs } = factsAgainst(itemId, address, coin);
    const evidence: WireCoinEvidence = {
      linksPost: true,
      samePicture: weighedHere?.samePicture ?? null,
      launchedAfterMs,
      ...(weighedHere?.posterPostedAddress === undefined ? {} : { posterPostedAddress: weighedHere.posterPostedAddress }),
      ...(weighedHere?.posterBioNamesCoin === undefined ? {} : { posterBioNamesCoin: weighedHere.posterBioNamesCoin }),
      ownerChecked: true,
    };
    const l = out.get(itemId);
    const base = l !== undefined && 'coins' in l ? l : { coins: [], more: false };
    out.set(itemId, { ...base, match: { kind: 'matched', coin, evidence, owner: true } });
  }
  /* "See N coins": only the coins that could be the post's (coin-list.ts). */
  return withPlausibleLists(db, out, weighed, policy, nowMs);
}

/**
 * Write one feed's frame: the view row first, then its rows, in the caller's transaction.
 *
 * ★ THE ROWS IN ONE STATEMENT. They were written one insert each: fifty round trips for For You, a
 * hundred for both feeds, and from the project service to the database a round trip costs a large
 * part of a second — a quick frame that wrote took 18.5 s at the median where one that did not took
 * 5 s. A post listed twice keeps its last place, as the one-by-one writes left it.
 */
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
  const last = new Map(posts.map((post, position) => [post.id, { post, position }] as const));
  if (last.size > 0) {
    const rows = [...last.values()];
    await db.query(
      `insert into public.rising_row (feed_id, item_id, position, payload)
       select $1, r.id, r.position, r.payload from unnest($2::text[], $3::int[], $4::jsonb[]) as r(id, position, payload)
       on conflict (feed_id, item_id) do update set position = excluded.position, payload = excluded.payload`,
      [feedId, rows.map((r) => r.post.id), rows.map((r) => r.position), rows.map((r) => JSON.stringify(r.post))],
    );
  }
  return posts.length;
}

/** A held post's rejection detail: `kind:TRAGEDY`, `kind:AD` and so on; null for any other reason. */
export const kindDetail = (kind: HeldKind | undefined): string | null => (kind === undefined ? null : `kind:${kind}`);

/**
 * ★ A NEWER ANSWER WINS (for-you-lock.ts, rule 2). For each For You post that changed since this frame
 * began, the card For You shows now — the quick frame's, or none — instead of this frame's older one;
 * For You re-ordered, held to the variety rule and cut as a frame's list is. `deferred` are the posts
 * whose same-name list this frame must not rewrite. Nothing changed: the frame as built.
 */
export async function withNewerCards(db: Db, frame: RisingFrame, began: QuickCursor, nowMs: Millis, policy = DEFAULT_POLICY): Promise<{ readonly frame: RisingFrame; readonly deferred: readonly string[] }> {
  const changed = new Set(await changedPosts(db, began));
  if (changed.size === 0) return { frame, deferred: [] };
  const committed = (await db.query<{ payload: WireRisingPost }>(
    `select payload from public.rising_row where feed_id = 'fyp' and item_id = any($1::text[]) order by position`,
    [[...changed]],
  )).map((r) => r.payload);
  const touched = frame.fyp.some((p) => changed.has(p.id)) || committed.length > 0;
  if (!touched) return { frame, deferred: [] };
  const sinceMs = (nowMs - policy.rising.windowMs) as Millis;
  const ids = [...new Set([...frame.fyp.map((p) => p.id), ...committed.map((p) => p.id)])];
  /* Uncredited too: a late post (late-no-coin.ts) has no lane's credit and must still be found here. */
  const rows = await loadCandidates(db, sinceMs, ids, ids, null, ids);
  const rowAt = new Map(rows.map((r) => [r.item_id, new Date(r.posted_at ?? r.first_seen_at).getTime()] as const));
  const at = (p: WireRisingPost): number => rowAt.get(p.id) ?? p.postedAt.at ?? 0;
  const cards = mergeForYou(frame.fyp, changed, committed, at).map((post) => ({ at: at(post), post }));
  const fyp = (await varied(db, cards, rows, policy)).slice(0, policy.rising.maxRows).map((c) => c.post);
  const deferred = committed.map((p) => p.id);
  const sameName = new Map([...frame.sameName].filter(([id]) => !deferred.includes(id)));
  return { frame: { ...frame, fyp, sameName }, deferred };
}

/** Both feeds, built and written: what one projection run does. `main.ts` and the e2e test call this. */
export async function projectRisingFeeds(
  db: Db,
  nowMs: Millis,
  coinsByStory: ReadonlyMap<string, WireCoinLink>,
  sparkWindowMs: number,
  policy = DEFAULT_POLICY,
  answers: AnswerPolicies = onePolicy(policy),
): Promise<number> {
  /* ★ WHERE THIS FRAME BEGAN, read before any post (for-you-lock.ts): a post that changes after it is
     the quick frame's, which may already have placed it while this frame was building. */
  const began = await frameCursor(db);
  /* The feeds' members for good (feed-members.ts, 0075); null before it is applied. */
  const membership = await loadMembership(db, nowMs - policy.rising.windowMs);
  const built = await buildRising(db, nowMs, coinsByStory, sparkWindowMs, policy, membership, answers);
  /* ★ Built; now the one right to write For You, and For You as committed under it. */
  await lockForYou(db);
  const { frame, deferred } = await withNewerCards(db, built, began, nowMs, policy);
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
  const projected = new Set(frame.members.map((p) => p.id));
  const unrefreshed = membership === null ? [] : [...membership.all].filter((id) => !projected.has(id));
  /* A post the quick frame placed since this frame began keeps the list the quick frame wrote: its card's count is that list's length. */
  await writeSameNameCoins(db, 'post', frame.sameName, frame.sameNameEvidence, [...unrefreshed, ...deferred]);
  /* Each shown post's name ideas for Create (0058), with the feeds they belong to. */
  await writeNameIdeas(db, await loadNameIdeas(db, [...new Set([...frame.fyp, ...frame.popular, ...(frame.lateJoins ?? [])].map((p) => p.id))]));
  const written = (await writeRising(db, 'fyp', frame.fyp)) + (await writeRising(db, 'popular', frame.popular));
  /* The late route's posts under the cut join For You's list beside the frame's own (late-no-coin.ts). */
  if (membership !== null) await writeMembership(db, nowMs, { fyp: [...frame.fyp, ...(frame.lateJoins ?? [])], popular: frame.popular }, frame.members, membership.refresh, [...(frame.promotions ?? [])]);
  /* The posts shown by the coin-first route alone: recorded once, so each joins by it once (0116). */
  await recordAdmitted(db, frame.fyp.filter((p) => frame.coinFirst?.has(p.id) === true).map((p) => p.id), nowMs);
  return written;
}
