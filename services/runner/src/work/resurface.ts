/**
 * A HUGE ACCOUNT BROUGHT AN OLDER POST BACK (Policy.judge.resurface): the stored posts an account of
 * 10M+ followers, or a key crypto account (`keyAccounts`), has just quoted, reposted (0140), or posted the same picture or video of, are asked the post question
 * again with that share beside them (JudgeSubject.sharedBy), and each share is noted (0139) so the
 * projector can count For You's six hours from it.
 *
 * Why a pass of its own and not the quote boost (early-judge.ts): the boost asks only never-judged
 * posts of the last twelve hours, and asks them blind — the judge never learns a big account shared
 * them. On 2026-10-26 @elonmusk quoted a 16-day-old video; it was judged a weak yes without the quote
 * in view, and For You, counting from the video's own time, could not have shown it whatever the
 * answer. This pass asks whatever the post's age and whatever it was answered before.
 *
 * ★ FILED LIKE ANY ANSWER. The ask goes through score-posts' `judgeQueue` — the owner's labels as
 * precedent, the not-a-meme match, the kind question after a yes — and its answer becomes the post's
 * newest, read by every feed, the coin links and the narratives as any answer is. Two differences:
 * no other post's answer is reused for it (`sharedBy`), and the junk filter is not applied (a huge
 * account's share is stronger evidence than the fit; For You's junk bar still applies). The usual
 * bar holds: the measurement on the policy found no reason to lower it.
 *
 * ★ RUN BEFORE THE QUOTE BOOST, on the early loop, so a young never-judged original meets the share
 * on its first ask; the boost then finds it judged and leaves it.
 *
 * ★ BOUNDED: `maxPerPass` shares a pass, `dailyUsd` a UTC day on lane 'resurface' of
 * internal.lane_spend; an unreadable ledger asks nothing (fail closed). Credited to the 'quoted' lane
 * (0116) so TRACK re-reads the original's views and the projector may load it.
 *
 * What breaks if changed carelessly: the share is written (`PgResurfacingRepo.record`) only once an
 * answer is filed, so the projector never counts from a share the judge never saw. Writing it before
 * asking would put an old post on For You on its share-blind answer after an outage.
 */

import type { Millis } from '@insidor/contracts';
import type { JudgeShare } from '@insidor/contracts/ports/judge.ts';
import type { PgItemRepo, PgResurfacingRepo, SharedOriginal } from '@insidor/store';

import { errorText } from '../log.ts';
import type { LaneLedger } from './lane-ledger.ts';
import { judgeQueue, kindLabelOf, type ScoringDeps, type ScoringResult } from './score-posts.ts';

/** Its row in the capped lanes' ledger. */
export const RESURFACE_LANE = 'resurface' as const;
/** The lane its originals are credited to, the quote boost's (0116): a lane value needs no migration. */
const CREDIT_LANE = 'quoted' as const;

export interface ResurfaceDeps extends Omit<ScoringDeps, 'items' | 'shadow'> {
  readonly items: Pick<PgItemRepo, 'sharedOriginals'> & Partial<Pick<PgItemRepo, 'markFoundBy'>>;
  readonly shares: Pick<PgResurfacingRepo, 'record'>;
  readonly ledger: Pick<LaneLedger, 'spent' | 'add'>;
  /** The hash of the words the share is shown in (judge SHARED_PROMPT.sha), kept with each ask. */
  readonly wordsSha: string;
  /** Running total of embedding spend, as early-judge.ts reads it. Absent: only the judge's is charged. */
  readonly embedSpentUsd?: () => number;
  /** The platform's key accounts (adapters/platform/x key-accounts.ts), shared whatever their followers. */
  readonly keyAccounts?: readonly string[];
}

export interface ResurfaceResult extends ScoringResult {
  /** Shares found this pass (at most `maxPerPass`). */
  readonly found: number;
  /** Shares written as asked (an answer came back). */
  readonly recorded: number;
  readonly held?: 'off' | 'no-judge' | 'ledger' | 'cap';
}

const nothing = (held?: ResurfaceResult['held']): ResurfaceResult => ({ queued: 0, scored: 0, copied: 0, waiting: 0, wouldSpendUsd: 0, spentUsd: 0, found: 0, recorded: 0, ...(held === undefined ? {} : { held }) });

/** The sharing post's own words: links dropped, space folded, at most `max` characters. */
export function shareWords(text: string, max: number): string {
  return text.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** What the judge is told of one share; null when we hold no handle to name the account by. */
export function judgeShareOf(s: SharedOriginal, maxChars: number): JudgeShare | null {
  if (s.handle === null || s.handle.trim() === '') return null;
  return { handle: s.handle.replace(/^@/, ''), followers: s.followers, how: s.how, words: shareWords(s.words, maxChars) };
}

/** One pass. Says once a day when the cap holds it, and every time the ledger cannot be read. */
export function resurface(deps: ResurfaceDeps): () => Promise<ResurfaceResult> {
  let capSaidFor: string | null = null;
  return async () => {
    const r = deps.policy.judge.resurface;
    if (!r.on) return nothing('off');
    if (deps.judge === null) return nothing('no-judge');
    const now = deps.now();
    const spent = await deps.ledger.spent(RESURFACE_LANE, now);
    if (spent === null) {
      deps.log.warn('resurfacing: what it spent today cannot be read; it asks nothing until it can', { lane: RESURFACE_LANE });
      return nothing('ledger');
    }
    if (spent >= r.dailyUsd) {
      const day = new Date(now).toISOString().slice(0, 10);
      if (capSaidFor !== day) {
        capSaidFor = day;
        deps.log.info('resurfacing: the day\'s cap is spent; shared posts keep their answers', { spentUsd: Number(spent.toFixed(4)), capUsd: r.dailyUsd });
      }
      return nothing('cap');
    }
    const found = (await deps.items.sharedOriginals({ sharedSince: (now - r.windowMs) as Millis, minFollowers: r.minFollowers, limit: r.maxPerPass, keyHandles: r.keyAccountsOn ? deps.keyAccounts ?? [] : [] }))
      .flatMap((s) => {
        const share = judgeShareOf(s, deps.policy.judge.maxCharsPerText);
        return share === null ? [] : [{ s, share }];
      });
    if (found.length === 0) return nothing();
    const queue = found.map((f) => f.s.item);
    if (deps.mode === 'live' && deps.items.markFoundBy !== undefined) {
      try {
        await deps.items.markFoundBy(queue.map((i) => i.itemId), CREDIT_LANE, now);
      } catch (e) {
        deps.log.error('resurfacing could not credit its posts; they are judged but may not be re-read', { err: errorText(e) });
      }
    }
    const embedBefore = deps.embedSpentUsd?.() ?? 0;
    const precedents = deps.precedents === undefined || deps.precedents === null ? null : { refresh: async () => ({ embedded: 0, relabelled: 0 }), forPosts: deps.precedents.forPosts };
    const result = await judgeQueue({ ...deps, precedents, shadow: null }, queue, {
      rescoring: [],
      junkFit: null,
      kindLabel: kindLabelOf(deps.kindJudge),
      now,
      sharedBy: new Map(found.map((f) => [String(f.s.item.itemId), f.share] as const)),
    });
    const usd = result.spentUsd + Math.max(0, (deps.embedSpentUsd?.() ?? 0) - embedBefore);
    let recorded = 0;
    if (deps.mode === 'live') {
      if (usd > 0) {
        try {
          await deps.ledger.add(RESURFACE_LANE, deps.now(), usd);
        } catch (e) {
          deps.log.error('resurfacing could not record what it spent', { usd, err: errorText(e) });
        }
      }
      try {
        recorded = await deps.shares.record(found.map((f) => ({
          itemId: String(f.s.item.itemId),
          byItemId: f.s.byItemId,
          byAuthorKey: f.s.byAuthorKey,
          how: f.s.how,
          sharedAt: new Date(f.s.sharedAtMs),
          wordsSha: deps.wordsSha,
        })), now, kindLabelOf(deps.kindJudge));
      } catch (e) {
        deps.log.error('resurfacing could not note its shares; For You counts these posts from their own time', { err: errorText(e) });
      }
    }
    deps.log.info('resurfacing', { asked: queue.length, scored: result.scored, recorded, by: found.map((f) => `${String(f.s.item.itemId)}<@${f.share.handle}`), usd: Number(usd.toFixed(6)) });
    return { ...result, found: found.length, recorded };
  };
}
