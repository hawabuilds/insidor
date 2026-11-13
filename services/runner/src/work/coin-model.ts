/**
 * THE COIN MODEL PASS: each post the judge said no to, scored once by our own coin model (the
 * safety net, Policy.judge.coinModel), and the score stored in internal.coin_model_score (0096).
 * A target in `everyPost` (0169's `memeable`, the judge in training) scores EVERY post the judge
 * answered, yes or no, as of its first answer, so the two judges are read side by side on the same
 * posts (tools/coin-model.ts --target memeable).
 *
 * One pass, for each target in Policy.judge.coinModel.targets (0099: `coined`, `viral`), in order:
 *   1. the target's fit (internal.coin_model, refitted by the re-tune): for the live target
 *      (`liveTarget`) its latest APPLIED one; for any other its newest one with a threshold,
 *      applied or not, since a shadowed target can add nothing and its gate decides only whether it
 *      may ever act; none, nothing to do for that target
 *   2. at most `maxPerPass` posts whose newest live answer is "no", answered in the last
 *      `lookbackMs`, never scored for that target, newest first
 *   3. their facts AS OF THAT ANSWER (store coin-model.ts `facts`: every reading taken by then) and
 *      their words-and-picture vectors (0074), the very read the fit was taught on
 *   4. core `coinModelVerdict`, and one row per post written: the score, the threshold of the
 *      moment, whether it would let the post through, and `shadow` or `live`
 *
 * ★ ITS OWN LOOP, NEVER THE DISCOVER PASS. The judge and the feed never wait on this: a slow or
 * failed pass writes nothing and the next one picks the same posts up. It makes no paid call.
 *
 * ★ IT NEVER ADDS ANYTHING ITSELF. The projector reads `would_add` only while `on`, and only the
 * live target's (`liveTarget`); in shadow the rows are the log of what it would have added
 * (tools/coin-model.ts shadow). A row is `live` only for the live target with `on`: every other
 * target is shadow, whatever `on` says.
 *
 * ★ ONE TARGET'S FAILURE IS ITS OWN. A target with no fit, or whose write fails, is skipped and
 * the others still score; the counts are summed over the targets.
 *
 * ★ ONE SCORE PER POST, FIXED. The facts are those at the answer, so a later pass would compute the
 * same number; the fit that scored is recorded with it. A post re-answered "yes" leaves the queue.
 *
 * What breaks if changed carelessly: scoring on facts read "now" instead of at the answer. The fit
 * was tested on the answer's facts; a later reading would make the shadow look better than the
 * test, and the live net admit posts the test never measured.
 */

import type { Millis } from '@insidor/contracts';
import type { CoinModelTarget, Policy } from '@insidor/contracts/policy.ts';
import { coinModelVerdict, type CoinModelFacts, type CoinModelFit } from '@insidor/core';
import type { CoinFactRow, CoinModelScore, PgCoinModelRepo, PgJunkFilterRepo } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

export interface CoinModelDeps {
  readonly repo: Pick<PgCoinModelRepo, 'latestApplied' | 'latestForShadow' | 'toScore' | 'facts' | 'recordScores'>;
  readonly vectors: Pick<PgJunkFilterRepo, 'vectors'>;
  readonly policy: Policy;
  readonly mode: 'live' | 'dry';
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface CoinModelResult {
  readonly skipped: string | null;
  readonly scored: number;
  readonly wouldAdd: number;
  readonly unscored: number;
  /** CPU spent scoring this pass (features and dot products, not the reads). */
  readonly cpuMs: number;
}

const factsOf = (r: CoinFactRow): CoinModelFacts => ({
  source: r.source, lang: r.lang, text: r.text, mediaKinds: r.mediaKinds,
  postedAtMs: r.postedAt?.getTime() ?? null, decidedAtMs: r.decidedAt.getTime(),
  reach: r.reach, reachAtMs: r.reachAt?.getTime() ?? null, ratePerMinute: r.ratePerMinute, priorRatePerMinute: r.priorRatePerMinute,
  approval: r.approval, conversation: r.conversation, rebroadcast: r.rebroadcast, followers: r.followers, echoes: r.echoes, coins: r.coins,
});

const NONE: Omit<CoinModelResult, 'skipped'> = { scored: 0, wouldAdd: 0, unscored: 0, cpuMs: 0 };

export async function scoreCoinModel(deps: CoinModelDeps): Promise<CoinModelResult> {
  const C = deps.policy.judge.coinModel;
  if (!C.on && !C.shadow) return { skipped: 'off', ...NONE };
  if (deps.mode !== 'live') return { skipped: 'dry run', ...NONE };
  const results: CoinModelResult[] = [];
  for (const target of C.targets) results.push(await scoreTarget(deps, target));
  const sum = (k: 'scored' | 'wouldAdd' | 'unscored' | 'cpuMs'): number => results.reduce((s, r) => s + r[k], 0);
  if (results.every((r) => r.skipped !== null)) return { skipped: results.map((r) => r.skipped).join('; ') || 'no target', ...NONE, cpuMs: sum('cpuMs') };
  return { skipped: null, scored: sum('scored'), wouldAdd: sum('wouldAdd'), unscored: sum('unscored'), cpuMs: sum('cpuMs') };
}

async function scoreTarget(deps: CoinModelDeps, target: CoinModelTarget): Promise<CoinModelResult> {
  const C = deps.policy.judge.coinModel;
  /* The live target scores with its applied fit only; a shadowed one with its newest fit, applied or not (it can add nothing). */
  const isLive = target === C.liveTarget;
  const fit = isLive ? await deps.repo.latestApplied(target) : await deps.repo.latestForShadow(target);
  if (fit === null) return { skipped: `no ${isLive ? 'applied ' : ''}${target} fit`, ...NONE };
  const live = C.on && isLive;
  const now = deps.now();
  const todo = await deps.repo.toScore(new Date(now - C.lookbackMs), C.maxPerPass, target, C.everyPost.includes(target));
  if (todo.length === 0) return { skipped: null, ...NONE };
  const facts = await deps.repo.facts(todo.map((t) => ({ itemId: t.itemId, decidedAt: t.answerJudgedAt })));
  const vectors = await deps.vectors.vectors(todo.map((t) => t.itemId), fit.space);
  const asCore: CoinModelFit = fit;
  const started = process.cpuUsage();
  const rows: CoinModelScore[] = [];
  let unscored = 0;
  const answerAt = new Map(todo.map((t) => [t.itemId, t.answerJudgedAt] as const));
  for (const f of facts) {
    const v = vectors.get(f.itemId);
    const verdict = coinModelVerdict(factsOf(f), v === undefined || v.values.length === 0 ? null : { space: fit.space, values: v.values }, asCore, deps.policy, isLive);
    if (verdict.kind === 'unscored') {
      unscored += 1;
      continue;
    }
    rows.push({
      itemId: f.itemId, target, fitId: verdict.fitId, probability: verdict.probability, threshold: verdict.threshold, wouldAdd: verdict.kind === 'add',
      answerJudgedAt: answerAt.get(f.itemId) ?? f.decidedAt, scoredAt: new Date(now), mode: live ? 'live' : 'shadow',
    });
  }
  const used = process.cpuUsage(started);
  const cpuMs = (used.user + used.system) / 1000;
  try {
    await deps.repo.recordScores(rows);
  } catch (e) {
    deps.log.warn('could not record the coin model\'s scores; scored again next pass', { target, posts: rows.length, err: errorText(e) });
    return { skipped: 'write failed', ...NONE, cpuMs };
  }
  const wouldAdd = rows.filter((r) => r.wouldAdd).length;
  deps.log.info(C.everyPost.includes(target) ? 'coin model scored posts the judge answered' : 'coin model scored posts the judge said no to', { target, fit: fit.id, scored: rows.length, wouldAdd, unscored, cpuMs: Math.round(cpuMs), rssMb: Math.round(process.memoryUsage().rss / 1_048_576), mode: live ? 'live' : 'shadow' });
  return { skipped: null, scored: rows.length, wouldAdd, unscored, cpuMs };
}
