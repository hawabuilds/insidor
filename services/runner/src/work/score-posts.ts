/**
 * THE PER-POST SCORE: each post the catch-all search found, judged alone, once.
 *
 * Its own step, run after each discovery pass, because a post's score decides whether it
 * reaches the For You feed — a different question from QUALIFY's, which judges a group of
 * posts. It uses the same judge and the same ported prompt (with its news rules), shown one
 * post. The bar the answer is held to is core's `postScore`.
 *
 * ★ ONLY CATCH-ALL POSTS, ONLY OBSERVED ONES, AND EACH ONCE PER PROMPT. The queue is
 * `PgItemRepo.catchAllUnscored`: found by a catch-all lane (or fetched by a story's backfill,
 * for GROUP's name-plus-picture join), not yet scored, newest first, inside the feed's window. An answer is recorded the moment it arrives, so a restart does
 * not pay for it twice.
 *
 * ★ A NEW PROMPT RE-SCORES THE DAY, SLOWLY (2026-10-13). A post whose newest answer came from
 * another version of the post question (`PgItemRepo.catchAllStale`: a wording edit, a re-tune's
 * new examples) is judged again, after the never-judged posts and at most `rising.rescorePerPass`
 * a pass, so one prompt change drains over hours on the live line rather than as one burst. A
 * re-scored post is asked the kind again too: the projector reads a kind label only while it is
 * the post's newest answer.
 *
 * ★ THE KIND QUESTION MEETS EVERY POST THAT COULD SHOW. It is asked of a post the first answer
 * passed or that the picture boost could still lift (core `couldPassWithBoost`), and of a copied
 * answer that could; until 2026-10-13 a boosted post skipped it, and a zoo-mauling news post
 * reached For You that way.
 *
 * ★ FREE CHECKS FIRST. A catch-all post goes to the paid judge only once its reach clears For
 * You's bar (core's `clearsReachBar`) — a post that cannot show is not worth a judgement yet. One
 * that has not cleared it waits, unscored and off the feed, and is checked again after its next
 * re-read. A post a story's backfill fetched is judged regardless: GROUP needs its name.
 *
 * ★ NO DOUBLE SCORING (2026-10-13). Before a post is sent, an answer this judge already gave
 * under this prompt, inside the feed's window, is reused when the post shows the judge nothing
 * new: a plain repost (the same object, re-shown); a quote whose own text is empty or only links
 * and that carries no picture of its own (a quote with words is a new post — it says something
 * the quoted one did not, so it is judged); or a post whose first picture is the very file of a
 * post the judge was shown (`looked_at = 'picture'`). The answer is filed as a copy (0053): same
 * judge and prompt ids, cost zero, `copied_from` naming the post it was given about. Only on a
 * live run: a dry run writes nothing, copies included.
 *
 * ★ THE OWNER'S LABELS RIDE ALONG (2026-10-13). Before a pass is judged, each post is embedded
 * (words and picture together) and sent with its closest labelled posts and their labels
 * (work/precedents.ts, Policy.judge.precedents). A post that could pass and is at least
 * `holdNotSimilarity` close to one the owner called "not a meme" is held as NOT_MEME_MATCH, filed
 * like a held kind, and is not asked the kind question. With no vectors (the vendor down, the line
 * spent, 0069 not applied) posts are judged as before and nothing is held.
 *
 * ★ NO ANSWER IS NOT A NO. A dry run prices the batch and sends nothing; a budget pause or
 * an unavailable answer records nothing. Each leaves the post waiting — off the feed, and
 * back in the queue next pass — and none is ever read as a pass.
 *
 * What breaks if changed carelessly: the subject id below is a key the judge echoes back to
 * match answers to posts. It is derived from the post id, so two posts never share one; a
 * subject id that collided would file one post's answer under another.
 */

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { storyId, type ItemId, type StoryId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgePort, JudgePrecedent, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PgItemRepo, PgPostJudgementRepo, ReusableAnswer } from '@insidor/store';
import { NOT_MEME_MATCH, clearsReachBar, couldPassWithBoost, heldAsNotMeme, heldKind } from '@insidor/core';
import { BudgetRefused } from '@insidor/vendor-kit';

/** How many unscored posts are read per pass for each one that may be judged: the rest are below the bar. */
const PREFETCH_FACTOR = 5;

/** What a kind answer's prompt id starts with when no kind judge is wired to say. */
const KIND_PROMPT_LABEL = 'post-kind';

import { errorText, type Logger } from '../log.ts';
import type { PostPrecedents, PrecedentSource } from './precedents.ts';

/**
 * The not-a-meme hold's answer, filed as a kind answer (as the shill rule files its AD): the label
 * NOT_MEME_MATCH as its name, coinable false, how close the post is to the "not a meme" label as
 * its confidence. A rule, not a model: cost 0. The prompt id starts with the kind question's label,
 * so every reader that skips kind answers, and the re-score check, treat it as one.
 */
const notMatchAnswer = (kindLabel: string, at: Millis, similarity: number, lookedAt: Judgement['lookedAt'], p: Policy): Judgement => ({
  judgeId: `rule:not-meme-match@${p.judge.precedents.holdNotSimilarity}`,
  promptId: `${kindLabel}@not-meme-match-1`,
  judgedAt: at,
  coinable: false,
  confidence: Math.min(1, Math.max(0, similarity)),
  lookedAt,
  proposedName: NOT_MEME_MATCH,
  alternateNames: [],
  subjectSpans: [],
  rationaleRef: null,
  costUsd: 0,
});

export interface ScoringDeps {
  /** null when the judge is dormant: nothing is asked and every post waits. */
  readonly judge: JudgePort | null;
  /**
   * The second question, asked of a post the first answer passed OR could pass with the picture
   * boost (core `couldPassWithBoost`): which kind of post it is. A kind in Policy.judge.heldKinds
   * (the labels are core kinds.ts) holds it back — the kind
   * answer (coinable false, the kind as its name) is filed as the post's latest judgement, so every
   * reader of the latest answer hides it. OTHER files nothing: the first answer stands. Absent:
   * one question only.
   */
  readonly kindJudge?: JudgePort | null;
  /**
   * The owner's labelled posts closest to each post, sent with it as precedent, and the not-a-meme
   * hold (work/precedents.ts, Policy.judge.precedents). Absent, or nothing found: judged without
   * precedents, and nothing is held by it.
   */
  readonly precedents?: PrecedentSource | null;
  readonly items: Pick<PgItemRepo, 'catchAllUnscored' | 'catchAllStale' | 'reachReadings' | 'backfilled'>;
  readonly scores: Pick<PgPostJudgementRepo, 'record' | 'recordCopy' | 'reusable'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface ScoringResult {
  readonly queued: number;
  readonly scored: number;
  /** Given another post's answer instead of a call (included in `scored`). */
  readonly copied: number;
  readonly waiting: number;
  /** Priced and not sent, on a dry run. */
  readonly wouldSpendUsd: number;
  readonly spentUsd: number;
}

/** The key the judge echoes back for one post. Unique per post, never a real story id. */
function subjectIdFor(item: Item): StoryId {
  return storyId(`post-${String(item.itemId).replaceAll(':', '-').replaceAll('|', '-')}`);
}

function subjectFor(item: Item, p: Policy, precedents: readonly JudgePrecedent[] = []): JudgeSubject {
  const text = item.text.trim().slice(0, p.judge.maxCharsPerText);
  return {
    storyId: subjectIdFor(item),
    texts: text === '' ? [] : [text],
    media: item.media,
    distinctAuthors: 1,
    distinctSources: 1,
    ...(precedents.length === 0 ? {} : { precedents }),
  };
}

/** The source held to the short-video bars (Policy.rising.shortVideoReachScale): the projector applies the same. */
const SHORT_VIDEO_SOURCE = 'tiktok';

/** The post's words without its links: what a quote says of its own. */
const ownWords = (text: string): string => text.replace(/https?:\/\/\S+/gi, '').trim();

/** The first still picture's uri, as the store keys a post's picture. */
const firstImage = (item: Item): string | null => item.media.find((m) => m.kind === 'image' && m.uri !== '')?.uri ?? null;

/**
 * The answer this post may reuse, by the rule in the header, or null when it must be judged.
 * A repost first, then a bare quote, then the same picture.
 */
export function reusableFor(
  item: Item,
  found: { readonly byItem: ReadonlyMap<string, ReusableAnswer>; readonly byImage: ReadonlyMap<string, ReusableAnswer> },
): ReusableAnswer | null {
  if (item.rebroadcastOf !== null) {
    const answer = found.byItem.get(String(item.rebroadcastOf));
    if (answer !== undefined) return answer;
  }
  const picture = firstImage(item);
  if (item.reproductionOf !== null && ownWords(item.text) === '' && picture === null) {
    const answer = found.byItem.get(String(item.reproductionOf));
    if (answer !== undefined) return answer;
  }
  return picture === null ? null : (found.byImage.get(picture) ?? null);
}

/** The answers this pass may reuse, or null when they cannot be read: then every post is judged. */
async function findReusable(deps: ScoringDeps, queue: readonly Item[], judgeId: string, promptId: string, since: Millis) {
  try {
    return await deps.scores.reusable({
      itemIds: queue.flatMap((item) => [item.rebroadcastOf, item.reproductionOf].filter((id): id is ItemId => id !== null)),
      imageUris: queue.flatMap((item) => firstImage(item) ?? []),
      judgeId,
      promptId,
      since,
    });
  } catch (e) {
    deps.log.warn('earlier answers could not be read; every post is judged', { err: errorText(e) });
    return null;
  }
}

export async function scorePosts(deps: ScoringDeps): Promise<ScoringResult> {
  const now = deps.now();
  const r = deps.policy.rising;
  const since = (now - r.windowMs) as Millis;
  /* The database narrows to posts some reading has put at the lowest reach any path to the feed
     starts from; core then holds each to the exact bar. Fetched wide, so posts still below it
     cannot crowd out the ones above it. */
  const floor = Math.min(r.fypFastReachPerMinute, r.fypEarlyReach, r.fypMinReach);
  /* The watch lane read on its own as well: newest-first over every lane, the text lanes' hundreds
     of unscored posts an hour push a short video stored hours earlier off the page for good. */
  const kindLabel = deps.kindJudge?.promptId.split('@')[0] ?? KIND_PROMPT_LABEL;
  const [everyLane, watchLane, staleWide] = await Promise.all([
    deps.items.catchAllUnscored(since, r.postsPerPass * PREFETCH_FACTOR, floor),
    deps.items.catchAllUnscored(since, r.postsPerPass, floor, 'watch'),
    /* ★ RE-SCORE AFTER A PROMPT CHANGE: posts last answered by another version of the question.
       After the never-judged ones, and at most `rescorePerPass` a pass, so a prompt change drains
       over hours instead of landing as one burst on the live line. */
    deps.judge === null ? Promise.resolve([] as readonly Item[]) : deps.items.catchAllStale(since, r.rescorePerPass * PREFETCH_FACTOR, deps.judge.promptId, `${kindLabel}@`, floor),
  ]);
  const seen = new Set(everyLane.map((i) => String(i.itemId)));
  const wide = [...everyLane, ...watchLane.filter((i) => !seen.has(String(i.itemId)))];
  for (const i of wide) seen.add(String(i.itemId));
  const stale = staleWide.filter((i) => !seen.has(String(i.itemId)));
  const readings = await deps.items.reachReadings([...wide, ...stale].map((i) => i.itemId), since);
  const backfilled = await deps.items.backfilled(wide.map((i) => i.itemId));
  const reaches = (item: Item): boolean =>
    clearsReachBar('fyp', readings.get(String(item.itemId)) ?? [], item.postedAt, deps.policy, String(item.source) === SHORT_VIDEO_SOURCE ? deps.policy.rising.shortVideoReachScale : 1);
  const rescoring = stale.filter(reaches).slice(0, r.rescorePerPass);
  const queue = [...wide.filter((item) => backfilled.has(String(item.itemId)) || reaches(item)).slice(0, r.postsPerPass), ...rescoring];
  const empty = { queued: queue.length, scored: 0, copied: 0, waiting: queue.length, wouldSpendUsd: 0, spentUsd: 0 };
  if (queue.length === 0 || deps.judge === null) return empty;
  const judge = deps.judge;

  /* ★ REUSE BEFORE PAYING — see the header. Live only: a dry run writes nothing. A lookup or a
     copy that fails (a database without 0053, say) never costs a post its judgement: the post is
     simply judged, as it was before reuse existed. */
  let copied = 0;
  const toJudge: Item[] = [];
  /* Posts the first question passed, or could pass with the boost, this pass: for the second. */
  const askKind: { itemId: ItemId; subject: JudgeSubject | undefined; lookedAt: Judgement['lookedAt'] }[] = [];
  const found = deps.mode === 'live' ? await findReusable(deps, queue, judge.id, judge.promptId, since) : null;
  for (const item of queue) {
    const answer = found === null ? null : reusableFor(item, found);
    if (answer === null || String(answer.sourceId) === String(item.itemId)) {
      toJudge.push(item);
      continue;
    }
    try {
      await deps.scores.recordCopy(item.itemId, { ...answer.judgement, judgedAt: now, costUsd: 0, rationaleRef: null }, answer.sourceId);
      copied += 1;
      /* A copied answer is still asked the kind: the source's kind answer is not copied with it. */
      if (couldPassWithBoost(answer.judgement, deps.policy)) askKind.push({ itemId: item.itemId, subject: subjectFor(item, deps.policy), lookedAt: answer.judgement.lookedAt });
    } catch (e) {
      deps.log.warn('could not file a reused answer; the post is judged instead', { post: String(item.itemId), err: errorText(e) });
      toJudge.push(item);
    }
  }

  /* ★ THE OWNER'S LABELS FIRST: new taps embedded, then each post's closest labelled posts. Live
     only, and never in the way: with nothing found every post is judged as before. Copied posts
     too, for the hold — they are few. */
  const near: ReadonlyMap<string, PostPrecedents> =
    deps.precedents === undefined || deps.precedents === null || deps.mode !== 'live' || queue.length === 0
      ? new Map()
      : await deps.precedents.refresh().then(() => deps.precedents!.forPosts(queue));

  let scored = copied;
  let wouldSpendUsd = 0;
  let spentUsd = 0;
  for (let i = 0; i < toJudge.length; i += judge.maxBatch) {
    const batch = toJudge.slice(i, i + judge.maxBatch);
    const subjects = batch.map((item) => subjectFor(item, deps.policy, near.get(String(item.itemId))?.precedents));
    const byKey = new Map<string, ItemId>(batch.map((item) => [String(subjectIdFor(item)), item.itemId]));
    const estimate = judge.estimate(subjects);

    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.warn('post scoring paused for budget; these posts wait', { posts: batch.length, wouldSpendUsd: estimate.usd });
      break;
    }
    if (deps.mode === 'dry') {
      wouldSpendUsd += estimate.usd;
      continue;
    }

    const line = deps.meter.line(estimate.vendor);
    try {
      const result = await judge.judge(subjects, {
        capUsd: line.capUsd,
        spentUsd: line.spentUsd,
        maxCalls: null,
        deadline: (now + deps.policy.judge.timeoutMs * deps.policy.judge.maxAttempts) as Millis,
      });
      spentUsd += result.spend.usd;
      /* Answers come back parallel to the subjects sent, as QUALIFY's judging reads them. */
      for (const [index, outcome] of result.value.entries()) {
        if (outcome.kind !== 'judged') continue;
        const itemId = byKey.get(String(subjects[index]?.storyId));
        if (itemId === undefined) continue;
        await deps.scores.record(itemId, outcome.judgement);
        scored += 1;
        /* ★ The boost's posts too: a post the picture may lift must meet the kind question like a
           pass, or a boosted ad or news post reaches For You (the zoo-mauling post, 2026-10-13). */
        if (couldPassWithBoost(outcome.judgement, deps.policy)) askKind.push({ itemId, subject: subjects[index], lookedAt: outcome.judgement.lookedAt });
      }
    } catch (e) {
      if (e instanceof BudgetRefused) {
        deps.log.warn('post scoring paused for budget at the vendor edge; these posts wait', { posts: batch.length });
        break;
      }
      deps.log.error('post scoring failed; these posts wait', { posts: batch.length, err: errorText(e) });
    }
  }

  /* The second question, for the posts the first passed or the boost could: a held kind holds the
     post back by filing the kind answer as its latest judgement. A budget pause or an outage here
     leaves the first answer standing — the post is not hidden for want of a second answer. */
  let heldBack = 0;
  /* ★ THE NOT-A-MEME HOLD before the kind question: a post this close to one the owner called "not
     a meme" is held as NOT_MEME_MATCH, and not asked its kind (the answer could not free it). */
  let notMatched = 0;
  const stillAsk: typeof askKind = [];
  for (const a of askKind) {
    const n = near.get(String(a.itemId));
    if (deps.mode !== 'live' || n === undefined || n.closestNot === null || !heldAsNotMeme(n.closestNot, deps.policy)) {
      stillAsk.push(a);
      continue;
    }
    try {
      await deps.scores.record(a.itemId, notMatchAnswer(kindLabel, deps.now(), n.closestNot, a.lookedAt, deps.policy));
      notMatched += 1;
      deps.log.info('post held: very close to one the owner called not a meme', { post: String(a.itemId), like: n.closestNotId });
    } catch (e) {
      deps.log.warn('could not file the not-a-meme hold; the kind question is asked instead', { post: String(a.itemId), err: errorText(e) });
      stillAsk.push(a);
    }
  }
  const kindJudge = deps.kindJudge ?? null;
  if (kindJudge !== null && deps.mode === 'live' && stillAsk.length > 0) {
    const asked = stillAsk.flatMap((p) => (p.subject === undefined ? [] : [{ itemId: p.itemId, subject: p.subject }]));
    const estimate = kindJudge.estimate(asked.map((a) => a.subject));
    if (deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      try {
        const line = deps.meter.line(estimate.vendor);
        const result = await kindJudge.judge(asked.map((a) => a.subject), {
          capUsd: line.capUsd,
          spentUsd: line.spentUsd,
          maxCalls: null,
          deadline: (now + deps.policy.judge.timeoutMs * deps.policy.judge.maxAttempts) as Millis,
        });
        spentUsd += result.spend.usd;
        for (const [index, outcome] of result.value.entries()) {
          const a = asked[index];
          /* Decided by the kind named, not the yes/no beside it: a reply that says OTHER and "not
             coinable" in one breath is OTHER. */
          if (a === undefined || outcome.kind !== 'judged' || heldKind(outcome.judgement.proposedName, deps.policy.judge.heldKinds) === null) continue;
          await deps.scores.record(a.itemId, outcome.judgement);
          heldBack += 1;
        }
      } catch (e) {
        deps.log.warn('the kind question failed; first answers stand', { posts: asked.length, err: errorText(e) });
      }
    }
  }

  if (deps.mode === 'dry') {
    deps.log.info('DRY RUN — posts priced for scoring, not sent', { posts: queue.length, wouldSpendUsd: Number(wouldSpendUsd.toFixed(6)) });
  } else {
    deps.log.info('posts scored', { queued: queue.length, rescoring: rescoring.length, scored, heldBack, notMatched, withPrecedents: near.size, copied, waiting: queue.length - scored, usd: Number(spentUsd.toFixed(6)) });
  }
  return { queued: queue.length, scored, copied, waiting: queue.length - scored, wouldSpendUsd, spentUsd };
}
