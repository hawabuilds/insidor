/**
 * THE COIN MATCH LEARNS FROM THE OWNER, TWICE A DAY: the ranking's weights refitted on the gold
 * set and every coin label the owner has tapped, scored, and written to internal.coin_match_fit
 * (0070) for the projector to rank with.
 *
 * Its own module, called from tools/retune.ts by one line beside the order model, because it is a
 * third learner with its own fate: it costs nothing (every fact is stored or frozen), runs at every
 * slot, and a failure here is logged and never fails the re-tune.
 *
 * THE LABELS:
 *   gold     the gold set's tuning half (eval/src/gold, frozen evidence), the live-like candidates
 *   owner    each "This is the coin" (`right`, with its coin), each pick after "Wrong coin" (`wrong`
 *            WITH a coin — the right one, unless it takes back an earlier `right` on that coin), and
 *            "No coin is from this" (`none`) (internal.owner_feedback, `coin_match`, folded by core
 *            `foldCoinCalls`), weighed as the projector weighs the post now (services/project
 *            post-match.ts). A bare `wrong` says only that the shown coin was not it, so it is
 *            counted and not fitted.
 * THE TEST, in every report: the gold set's held-out half (never fitted on) and the owner's labels,
 * each with the weights in use before and the refit after — proven right and wrong (a proof never
 * depends on the weights, so these move only with new facts), likely right and wrong, missed.
 *
 * ★ A REFIT ONLY ORDERS. The weights rank what no fact proved; a refit can move a coin between
 * likely and unsure, never onto a Buy. It is written only when it has no fewer right coins (proven,
 * likely or clear) and no more likely-wrong ones than the weights in use, on gold and on the
 * owner's labels each (eval match-fit.ts `refitRefusal`); otherwise the run says why. The first
 * refit, 2026-10-14 06:54, passed the old gate (likely-wrong only) while losing $TRUSTPROCESS, and
 * was rolled back by a newer row carrying the policy's weights — the table stays append-only.
 *
 * What breaks if changed carelessly: the owner's posts must be weighed by the projector's own code
 * (`weighPostCoins`), never a copy — a label scored on facts read another way teaches a ranking the
 * feed never runs. And the fit and the likely bar come from eval/src/gold/match-fit.ts, so the
 * twice-daily number and the gold report are one measurement.
 */

import { DEFAULT_POLICY, type Policy, type PostCoinWeights } from '../../contracts/src/policy.ts';
import { addressOfCoinId, coinLabelOf, foldCoinCalls, postCoinSignals, type PostCoinMatch } from '../../core/src/index.ts';
import { asDb, createPool, DB_ROLE, missingTable, PgOwnerCoinCallRepo, type Db } from '../../store/src/index.ts';
import { evaluateCase, matchBarsOf, type CaseResult } from '../../eval/src/gold/match-eval.ts';
import { loadMatchEvidence, matchCases } from '../../eval/src/gold/match-cases.ts';
import { fitWeights, pickLikelyShare, refitRefusal, type Choice } from '../../eval/src/gold/match-fit.ts';
import { loadFit, matchBars, weighPostCoins } from '../../services/project/src/post-match.ts';

type Outcome = 'provenRight' | 'provenWrong' | 'likelyRight' | 'likelyWrong' | 'missed' | 'clear';
type Tally = Readonly<Record<Outcome, number>> & { readonly n: number };

interface InUse {
  readonly weights: PostCoinWeights;
  readonly likelyMinShare: number;
}

const tally = (outcomes: readonly Outcome[]): Tally => {
  const t: Record<Outcome, number> = { provenRight: 0, provenWrong: 0, likelyRight: 0, likelyWrong: 0, missed: 0, clear: 0 };
  for (const o of outcomes) t[o] += 1;
  return { ...t, n: outcomes.length };
};

const outcomeOf = (d: PostCoinMatch, right: string | null): Outcome => {
  const named = d.kind === 'confident' ? d.address : d.kind === 'unsure' ? d.likely : null;
  if (named === null) return right === null ? 'clear' : 'missed';
  if (named === right) return d.kind === 'confident' ? 'provenRight' : 'likelyRight';
  return d.kind === 'confident' ? 'provenWrong' : 'likelyWrong';
};

/** One owner label weighed as the projector weighs it now. */
interface OwnerCase {
  readonly itemId: string;
  readonly right: string | null;
  readonly decision: PostCoinMatch;
}

/**
 * The owner's coin labels, one per post, folded in order (core `foldCoinCalls`, the projector's own
 * rule): the coin the owner says is the post's — "This is the coin", or the pick after "Wrong coin"
 * (`wrong` WITH a coin), unless that takes back a coin an earlier `right` named — or `none`. A post
 * whose calls leave only coins said to be wrong is counted apart; a `cleared` one is no label.
 */
async function ownerLabels(db: Db): Promise<{ readonly labels: readonly { itemId: string; right: string | null }[]; readonly wrongTaps: number }> {
  const rows = await new PgOwnerCoinCallRepo(db).rows();
  const folded = foldCoinCalls(rows.map((r) => ({ itemId: r.itemId, verdict: r.verdict, coinAddress: r.coinAddress, shownCoin: addressOfCoinId(r.shownCoinId), atMs: r.atMs, id: r.id })));
  const labels: { itemId: string; right: string | null }[] = [];
  let wrongTaps = 0;
  for (const [itemId, calls] of folded) {
    const label = coinLabelOf(calls);
    if (label !== null) labels.push({ itemId, right: label.right });
    else if (calls.wrong.size > 0) wrongTaps += 1;
  }
  return { labels, wrongTaps };
}

/** Each labelled post's candidates as the projector widens and weighs them, with the given weights. */
async function weighOwner(db: Db, labels: readonly { itemId: string; right: string | null }[], use: InUse, p: Policy): Promise<readonly OwnerCase[]> {
  if (labels.length === 0) return [];
  const rows = await db.query<{ subject_id: string; hits: string[] | null }>(
    `select distinct on (subject_id) subject_id, hits from internal.coin_lookup
      where subject_kind = 'post' and subject_id = any($1::text[]) order by subject_id, looked_at desc nulls last`,
    [labels.map((l) => l.itemId)],
  );
  const lists = new Map(labels.map((l) => [l.itemId, rows.find((r) => r.subject_id === l.itemId)?.hits ?? []]));
  /* The labelled coin is always a candidate: the owner found it, so it is one the post had. */
  for (const l of labels) if (l.right !== null && !(lists.get(l.itemId) ?? []).includes(l.right)) lists.set(l.itemId, [...(lists.get(l.itemId) ?? []), l.right]);
  const weighed = await weighPostCoins(db, lists, { ...p, postCoin: { ...p.postCoin, weights: use.weights, likelyMinShare: use.likelyMinShare } }, { ignoreFit: true });
  return labels.flatMap((l) => {
    const m = weighed.get(l.itemId);
    return m === undefined ? [] : [{ itemId: l.itemId, right: l.right, decision: m.decision }];
  });
}

const choiceOf = (d: PostCoinMatch, right: string | null, use: InUse, p: Policy): Choice | null => {
  if (d.kind !== 'unsure') return null;
  const possible = d.ranked.filter((e) => !e.before);
  if (possible.length === 0) return null;
  const bars = matchBars(p, use);
  const at = possible.findIndex((e) => e.address === right);
  return { options: possible.map((e) => postCoinSignals(e, bars)), right: at < 0 ? null : at };
};

export interface CoinMatchRefit {
  readonly before: { readonly goldHeld: Tally; readonly owner: Tally };
  readonly after: { readonly goldHeld: Tally; readonly owner: Tally };
  readonly weights: PostCoinWeights;
  readonly likelyMinShare: number;
  readonly fitted: number;
  readonly ownerLabels: number;
  readonly wrongTaps: number;
  readonly applied: boolean;
  readonly why: string | null;
}

/** Refit, score before and after, and record when it is no worse. */
export async function refitCoinMatch(db: Db, opts: { readonly record: boolean }, p: Policy = DEFAULT_POLICY): Promise<CoinMatchRefit> {
  const fit = await loadFit(db);
  const before: InUse = fit ?? { weights: p.postCoin.weights, likelyMinShare: p.postCoin.likelyMinShare };

  const ev = loadMatchEvidence();
  const cases = matchCases().filter((c) => ev.searches[c.term] !== undefined);
  const gold = (use: InUse): readonly CaseResult[] => cases.map((c) => evaluateCase(c, ev, { ...matchBarsOf(p, use.weights), likelyMinShare: use.likelyMinShare }, p, true));
  const goldBefore = gold(before);

  const { labels, wrongTaps } = await ownerLabels(db);
  const ownerBefore = await weighOwner(db, labels, before, p);

  const choices = [
    ...goldBefore.filter((r) => r.c.split === 'tune').flatMap((r) => (r.choice === null ? [] : [r.choice])),
    ...ownerBefore.flatMap((o) => {
      const c = choiceOf(o.decision, o.right, before, p);
      return c === null ? [] : [c];
    }),
  ];
  const weights = fitWeights(choices, before.weights);
  const likelyMinShare = pickLikelyShare(weights, choices).share;
  const after: InUse = { weights, likelyMinShare };
  const goldAfter = gold(after);
  const ownerAfter = await weighOwner(db, labels, after, p);

  const held = (rs: readonly CaseResult[]) => tally(rs.filter((r) => r.c.split === 'holdout').map((r) => r.outcome));
  const all = (rs: readonly CaseResult[]) => tally(rs.map((r) => r.outcome));
  const owner = (os: readonly OwnerCase[]) => tally(os.map((o) => outcomeOf(o.decision, o.right)));
  const r = {
    before: { goldHeld: held(goldBefore), owner: owner(ownerBefore) },
    after: { goldHeld: held(goldAfter), owner: owner(ownerAfter) },
  };
  /* ★ THE GATE (eval match-fit.ts `refitRefusal`): fewer right coins, or more likely-wrong ones, on
     the whole gold set or on the owner's labels, and the refit is not kept. */
  const refused = refitRefusal({ gold: all(goldBefore), owner: r.before.owner }, { gold: all(goldAfter), owner: r.after.owner });
  const worse = refused !== null;
  let why: string | null = refused;
  let applied = false;
  if (!worse && opts.record) {
    try {
      await db.query(
        `insert into internal.coin_match_fit (fitted_at, weights, likely_min_share, posts, owner_labels, score) values (now(), $1::jsonb, $2, $3, $4, $5::jsonb)`,
        [JSON.stringify(weights), likelyMinShare, choices.length, labels.length, JSON.stringify(r)],
      );
      applied = true;
    } catch (e) {
      if (!missingTable(e)) throw e;
      why = 'not recorded: internal.coin_match_fit (0070) is not migrated yet';
    }
  }
  return { ...r, weights, likelyMinShare, fitted: choices.length, ownerLabels: labels.length, wrongTaps, applied, why };
}

/**
 * The re-tune's one call: refit, record, and say what to put in the log and the owner's alert.
 * Never throws — the coin match failing must not fail the judge's re-tune.
 */
export async function refitCoinMatchForRetune(url: string | undefined, opts: { readonly record: boolean }): Promise<{ readonly log: Record<string, unknown>; readonly facts: Record<string, unknown> }> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-coin-match-fit' });
  try {
    const r = await refitCoinMatch(asDb(pool), opts);
    const t = (x: Tally) => ({ provenRight: x.provenRight, provenWrong: x.provenWrong, likelyRight: x.likelyRight, likelyWrong: x.likelyWrong, missed: x.missed, n: x.n });
    return {
      log: { applied: r.applied, why: r.why, fitted: r.fitted, ownerLabels: r.ownerLabels, wrongTaps: r.wrongTaps, weights: r.weights, likelyMinShare: r.likelyMinShare, before: { goldHeld: t(r.before.goldHeld), owner: t(r.before.owner) }, after: { goldHeld: t(r.after.goldHeld), owner: t(r.after.owner) } },
      facts: {
        coinMatchApplied: r.applied,
        coinMatchWhy: r.why,
        coinGoldN: r.after.goldHeld.n,
        coinGoldProven: r.after.goldHeld.provenRight,
        coinGoldWrong: r.after.goldHeld.provenWrong,
        coinGoldLikelyBefore: r.before.goldHeld.likelyRight,
        coinGoldLikelyAfter: r.after.goldHeld.likelyRight,
        coinLabelsN: r.after.owner.n,
        coinLabelsRightBefore: r.before.owner.provenRight + r.before.owner.likelyRight + r.before.owner.clear,
        coinLabelsRightAfter: r.after.owner.provenRight + r.after.owner.likelyRight + r.after.owner.clear,
        coinLabelsWrong: r.after.owner.provenWrong,
      },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { log: { failed: err }, facts: { coinMatchApplied: false, coinMatchWhy: `the coin match could not be refitted: ${err.slice(0, 200)}` } };
  } finally {
    await pool.end();
  }
}

/** The order model's report with the coin match's beside it: one value for the re-tune's log and alert. */
export function withCoinMatch<T extends { readonly log: Record<string, unknown>; readonly facts: Record<string, unknown> }>(order: T, coin: { readonly log: Record<string, unknown>; readonly facts: Record<string, unknown> }): T {
  return { ...order, log: { ...order.log, coinMatch: coin.log }, facts: { ...order.facts, ...coin.facts } };
}
