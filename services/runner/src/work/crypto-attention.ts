/**
 * CRYPTO ATTENTION UNDER FOR YOU POSTS: each post over the reach bar has its newest replies and
 * quote posts read, once and once more an hour later, and core `attentionFacts` counts what is in
 * them into internal.crypto_attention (0064).
 *
 * Its own step, run after each discovery pass beside the scorer, because it is a separate paid
 * read with its own caps. ★ MEASURED, NOT WIRED: nothing here or downstream moves a post on or off
 * a feed; the facts are stored for the owner to choose how they sit next to the judge
 * (tools/crypto-attention.ts measured that on gold and on the owner's "not" posts).
 *
 * ★ ON THE LIVE POSTS LINE, CAPPED TWICE. The owner asked for it "within the posts line": the read
 * bills the posts vendor through the live meter, so every line and the day's cap apply as they do
 * to discovery. On top, `attention.postsPerPass` and `attention.postsPerDay` (first reads and
 * re-reads together, counted from the table, so a restart shares them). The judged-yes posts come
 * first, newest first, so a day the cap binds spends it where the facts can matter.
 *
 * ★ ONLY SOURCES THAT CAN READ A POST'S RESPONSES. A source without the platform port's optional
 * `responses` (the short-video source today) is skipped, not read as "no crypto talk".
 *
 * ★ THE AUTHOR APART (2026-10-13): the post's text and author go with the read, so the stored facts
 * keep other accounts' coin talk (the signal) apart from the author's own (a shill); `withSignal`
 * counts other accounts' cashtags, addresses or CA only.
 *
 * What breaks if changed carelessly: a failed or refused read records nothing — a row of zeros
 * would be a claim made of an outage — and the post stays due for a later pass. The reach bar is
 * core's `clearsReachBar`, the same rule the scorer and the projector hold a post to.
 */

import type { Millis } from '@insidor/contracts';
import type { ItemId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { ResponseAsk } from '@insidor/contracts/ports/responses.ts';
import { attentionFacts, clearsReachBar, isShill, isShillText, othersSignal } from '@insidor/core';
import type { PlatformRegistry } from '@insidor/platform-registry';
import type { Judgement } from '@insidor/contracts';
import type { PgCryptoAttentionRepo, PgItemRepo, PgPostJudgementRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

/** Due posts fetched per post that may be read: the rest may still be under the exact bar. */
const PREFETCH_FACTOR = 5;
const DAY_MS = 86_400_000;

/** The source held to the short-video bars (Policy.rising.shortVideoReachScale), as the scorer does. */
const SHORT_VIDEO_SOURCE = 'tiktok';

/**
 * ★ THE SHILL RULE'S ANSWER, FILED AS A KIND ANSWER (the owner, 2026-10-13): a post whose own text,
 * or whose author's own replies, name a coin is an ad. It is filed in internal.post_judgement as
 * the kind question files a held kind — the kind ('AD') as its name, coinable false — so the
 * projector's held-kind check hides it with no new path. The prompt id starts `post-kind@`, so every
 * reader that skips kind answers (`post-kind%`) and the scorer's re-score check (`post-kind@%`)
 * treat it as a kind answer, never as an answer to the post question. A rule, not a model: cost 0.
 */
export const SHILL_PROMPT_ID = 'post-kind@shill-rule-1';
export const SHILL_JUDGE_ID = 'rule:crypto-shill@1';
/** How many shills whose label a newer answer covered are re-filed per pass. */
const REFILE_PER_PASS = 20;

const shillAnswer = (at: Millis): Judgement => ({
  judgeId: SHILL_JUDGE_ID,
  promptId: SHILL_PROMPT_ID,
  judgedAt: at,
  coinable: false,
  confidence: 1,
  lookedAt: 'text',
  proposedName: 'AD',
  alternateNames: [],
  subjectSpans: [],
  rationaleRef: null,
  costUsd: 0,
});

export interface AttentionDeps {
  readonly platforms: Pick<PlatformRegistry, 'all'>;
  readonly attention: Pick<PgCryptoAttentionRepo, 'readsSince' | 'due' | 'record'> & Partial<Pick<PgCryptoAttentionRepo, 'shillsToRefile'>>;
  /** Where the shill rule's AD answer is filed. Absent: shills are stored as facts only. */
  readonly kinds?: Pick<PgPostJudgementRepo, 'record'>;
  readonly items: Pick<PgItemRepo, 'reachReadings'>;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface AttentionResult {
  readonly read: number;
  readonly withSignal: number;
  readonly wouldSpendUsd: number;
  readonly spentUsd: number;
}

export async function readCryptoAttention(deps: AttentionDeps): Promise<AttentionResult> {
  const now = deps.now();
  const a = deps.policy.attention;
  const r = deps.policy.rising;
  const none = { read: 0, withSignal: 0, wouldSpendUsd: 0, spentUsd: 0 };
  const readers = new Map(deps.platforms.all().filter((p) => p.responses !== undefined && p.estimateResponses !== undefined).map((p) => [String(p.id), p] as const));
  if (readers.size === 0) return none;

  let today: number;
  try {
    today = await deps.attention.readsSince((Math.floor(now / DAY_MS) * DAY_MS) as Millis);
  } catch (e) {
    /* Before 0064 is applied the table is missing: the step waits rather than failing the pass. */
    deps.log.warn('crypto attention not read this pass: its table could not be read', { err: errorText(e) });
    return none;
  }
  const room = Math.min(a.postsPerPass, a.postsPerDay - today);
  if (room <= 0) return none;

  const since = (now - r.windowMs) as Millis;
  const floor = Math.min(r.fypFastReachPerMinute, r.fypEarlyReach, r.fypMinReach);
  const due = await deps.attention.due([...readers.keys()], since, floor, a.rereadAfterMs === null ? null : ((now - a.rereadAfterMs) as Millis), room * PREFETCH_FACTOR);
  const readings = await deps.items.reachReadings(due.map((d) => d.itemId as ItemId), since);
  const queue = due
    .filter((d) => clearsReachBar('fyp', readings.get(d.itemId) ?? [], d.postedAt, deps.policy, d.source === SHORT_VIDEO_SOURCE ? r.shortVideoReachScale : 1))
    .slice(0, room);

  /* A shill is filed whatever the budget: the rule costs nothing. Live only — a dry run writes nothing. */
  const fileShill = async (itemId: string) => {
    if (deps.kinds === undefined || deps.mode !== 'live') return;
    try {
      await deps.kinds.record(itemId as ItemId, shillAnswer(deps.now()));
    } catch (e) {
      deps.log.warn('a shill could not be filed as an ad; tried again next pass', { post: itemId, err: errorText(e) });
    }
  };
  let shills = 0;
  if (deps.kinds !== undefined && deps.mode === 'live' && deps.attention.shillsToRefile !== undefined) {
    try {
      for (const id of await deps.attention.shillsToRefile(since, SHILL_PROMPT_ID, REFILE_PER_PASS)) {
        await fileShill(id);
        shills += 1;
      }
    } catch (e) {
      deps.log.warn('shills to re-file could not be read; tried again next pass', { err: errorText(e) });
    }
  }

  const ask: ResponseAsk = { maxReplies: a.repliesPerPost, maxReproductions: a.reproductionsPerPost, untilMs: null };
  let read = 0;
  let withSignal = 0;
  let wouldSpendUsd = 0;
  let spentUsd = 0;
  for (const post of queue) {
    const adapter = readers.get(post.source);
    if (adapter === undefined) continue;
    /* The post's own words naming a coin need no read to be called a shill. */
    const textShill = post.text !== null && isShillText(post.text, a);
    if (textShill) {
      await fileShill(post.itemId);
      shills += 1;
    }
    const estimate = adapter.estimateResponses!(ask);
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.warn('crypto attention paused for budget; these posts wait', { posts: queue.length - read });
      break;
    }
    if (deps.mode === 'dry') {
      wouldSpendUsd += estimate.usd;
      continue;
    }
    const line = deps.meter.line(estimate.vendor);
    try {
      const result = await adapter.responses!(post.sourceItemId, ask, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: null, deadline: (now + DAY_MS) as Millis });
      spentUsd += result.spend.usd;
      const f = attentionFacts(result.value, a, { text: post.text, authorId: post.authorId, authorHandle: post.authorHandle });
      await deps.attention.record(post.itemId, deps.now(), {
        repliesRead: f.repliesRead,
        quotesRead: f.reproductionsRead,
        repliesCut: f.repliesCut,
        quotesCut: f.reproductionsCut,
        cashtags: f.cashtags,
        coinWords: f.coinWordResponses,
        caMentions: f.caMentions,
        contractAddresses: f.addresses,
        cryptoQuoters: f.cryptoReproducers,
        cryptoRepliers: f.cryptoRepliers,
        firstSignalAt: f.firstSignalAt as Millis | null,
        costUsd: result.spend.usd,
        others: f.others,
        own: f.own,
        authorKnown: f.authorKnown,
        postShill: f.postShill,
        othersFirstAt: f.othersFirstAt as Millis | null,
        readFor: 'live',
      });
      read += 1;
      if (othersSignal(f)) withSignal += 1;
      if (!textShill && isShill(f)) {
        await fileShill(post.itemId);
        shills += 1;
      }
    } catch (e) {
      if (e instanceof BudgetRefused) {
        deps.log.warn('crypto attention paused for budget at the vendor edge; these posts wait', { posts: queue.length - read });
        break;
      }
      deps.log.warn('a post\'s replies could not be read; it is read again on a later pass', { post: post.itemId, err: errorText(e) });
    }
  }

  if (deps.mode === 'dry') deps.log.info('DRY RUN — crypto attention priced, not read', { posts: queue.length, wouldSpendUsd: Number(wouldSpendUsd.toFixed(6)) });
  else if (queue.length > 0 || shills > 0) deps.log.info('crypto attention read', { due: queue.length, read, withSignal, shills, today: today + read, usd: Number(spentUsd.toFixed(6)) });
  return { read, withSignal, wouldSpendUsd, spentUsd };
}
