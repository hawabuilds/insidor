/**
 * THE COIN MODEL PASS: each post the judge said no to, scored once by our own coin model (the
 * safety net, Policy.judge.coinModel), and the score stored in internal.coin_model_score (0096).
 *
 * One pass, in order:
 *   1. the latest APPLIED fit (internal.coin_model, refitted by the re-tune); none, nothing to do
 *   2. at most `maxPerPass` posts whose newest live answer is "no", answered in the last
 *      `lookbackMs`, never scored, newest first
 *   3. their facts AS OF THAT ANSWER (store coin-model.ts `facts`: every reading taken by then) and
 *      their words-and-picture vectors (0074), the very read the fit was taught on
 *   4. core `coinModelVerdict`, and one row per post written: the score, the threshold of the
 *      moment, whether it would let the post through, and `shadow` or `live`
 *
 * ★ ITS OWN LOOP, NEVER THE DISCOVER PASS. The judge and the feed never wait on this: a slow or
 * failed pass writes nothing and the next one picks the same posts up. It makes no paid call.
 *
 * ★ IT NEVER ADDS ANYTHING ITSELF. The projector reads `would_add` only while `on`; in shadow the
 * rows are the log of what it would have added (tools/coin-model.ts shadow).
 *
 * ★ ONE SCORE PER POST, FIXED. The facts are those at the answer, so a later pass would compute the
 * same number; the fit that scored is recorded with it. A post re-answered "yes" leaves the queue.
 *
 * What breaks if changed carelessly: scoring on facts read "now" instead of at the answer. The fit
 * was tested on the answer's facts; a later reading would make the shadow look better than the
 * test, and the live net admit posts the test never measured.
 */

import type { Millis } from '@insidor/contracts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { coinModelVerdict, type CoinModelFacts, type CoinModelFit } from '@insidor/core';
import type { CoinFactRow, CoinModelScore, PgCoinModelRepo, PgJunkFilterRepo } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';

export interface CoinModelDeps {
  readonly repo: Pick<PgCoinModelRepo, 'latestApplied' | 'toScore' | 'facts' | 'recordScores'>;
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
  approval: r.approval, conversation: r.conversation, rebroadcast: r.rebroadcast, followers: r.followers, echoes: r.echoes,
});

const NONE: Omit<CoinModelResult, 'skipped'> = { scored: 0, wouldAdd: 0, unscored: 0, cpuMs: 0 };

export async function scoreCoinModel(deps: CoinModelDeps): Promise<CoinModelResult> {
  const C = deps.policy.judge.coinModel;
  if (!C.on && !C.shadow) return { skipped: 'off', ...NONE };
  if (deps.mode !== 'live') return { skipped: 'dry run', ...NONE };
  const fit = await deps.repo.latestApplied();
  if (fit === null) return { skipped: 'no applied fit', ...NONE };
  const now = deps.now();
  const todo = await deps.repo.toScore(new Date(now - C.lookbackMs), C.maxPerPass);
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
    const verdict = coinModelVerdict(factsOf(f), v === undefined || v.values.length === 0 ? null : { space: fit.space, values: v.values }, asCore, deps.policy);
    if (verdict.kind === 'unscored') {
      unscored += 1;
      continue;
    }
    rows.push({
      itemId: f.itemId, fitId: verdict.fitId, probability: verdict.probability, threshold: verdict.threshold, wouldAdd: verdict.kind === 'add',
      answerJudgedAt: answerAt.get(f.itemId) ?? f.decidedAt, scoredAt: new Date(now), mode: C.on ? 'live' : 'shadow',
    });
  }
  const used = process.cpuUsage(started);
  const cpuMs = (used.user + used.system) / 1000;
  try {
    await deps.repo.recordScores(rows);
  } catch (e) {
    deps.log.warn('could not record the coin model\'s scores; scored again next pass', { posts: rows.length, err: errorText(e) });
    return { skipped: 'write failed', ...NONE, cpuMs };
  }
  const wouldAdd = rows.filter((r) => r.wouldAdd).length;
  deps.log.info('coin model scored posts the judge said no to', { fit: fit.id, scored: rows.length, wouldAdd, unscored, cpuMs: Math.round(cpuMs), rssMb: Math.round(process.memoryUsage().rss / 1_048_576), mode: C.on ? 'live' : 'shadow' });
  return { skipped: null, scored: rows.length, wouldAdd, unscored, cpuMs };
}
