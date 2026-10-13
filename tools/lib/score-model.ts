/**
 * THE FOR YOU ORDER MODEL, FITTED TWICE A DAY: a small L2-regularised logistic regression over each
 * post's separate signals (core `postSignals`), fitted on every label so far, tested on posts it
 * was not fitted on, and written to internal.score_model (0065) — applied only when the test says
 * it is no worse than the fit in use. The projector orders For You by the applied fit.
 *
 * Its own module, called from tools/retune.ts by one line, because it is a second learner beside
 * the judge's examples and must not share their fate: it costs nothing (no paid call — every
 * signal is already stored), so it runs at every slot, even one the judge's block skips; and a
 * failure here is logged and never fails the re-tune. `tools/score-model.ts` runs it by hand.
 *
 * Why not ml/: ml/train is Python, run by hand weekly, and fits trees for the decision log; this
 * fit must run unattended at 08:00 and 20:00 where Python never runs. A dozen weights fitted by
 * Newton's method in TypeScript are exactly reproducible (no random start, no sampling).
 *
 * THE LABELS, by group (a post's newest, most direct label wins: recall < gold < labels file <
 * missed < the owner's taps):
 *   gold     the gold sheets' origin posts and the owner's hand-gold list       positive, gated
 *   missed   the owner's missed posts                                           positive, gated
 *   meme     the owner's "meme" taps and the labels file's memes                positive, gated
 *   recall   the recall check's creator-linked posts not on the hand-gold list  positive, NOT gated
 *   not      the owner's "not a meme" taps and the labels file's non-memes      negative, gated
 * A post we do not hold (no row in public.item) has no stored facts and is left out, and so is one
 * with no measured reach reading: every post on For You has one, and a labelled post we never read
 * live (an old gold post, a missed post read once by hand) would teach "no reading → meme". Both are
 * counted in the coverage line, never filled in. The fit, the split and the gate are pure, in
 * eval/src/feed/score-fit.ts.
 *
 * What breaks if changed carelessly: the facts must be read as the projector reads them
 * (store/src/repo/score-model.ts beside services/project/src/rising.ts) — a signal read two ways is
 * a fit scored on inputs it never saw.
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { postScoreReason } from '../../core/src/qualify/post-score.ts';
import { postRankScore, postSignals, SCORE_SIGNALS, type ScoreFit } from '../../core/src/qualify/post-rank.ts';
import { asDb, createPool, DB_ROLE, type Db } from '../../store/src/index.ts';
import { PgScoreModelRepo, type StoredPostFacts } from '../../store/src/repo/score-model.ts';
import { loadEvidence } from '../../eval/src/gold/coin-evidence.ts';
import { tuning } from '../../eval/src/gold/coin-origins.ts';
import { crossScores, fitLogistic, gateFit, isHeldOut, ordering, POSITIVE, ratesOf, signalWeights, tradeOff, usable, type Example, type LabelGroup, type Rate } from '../../eval/src/feed/score-fit.ts';
import { handGoldIds } from './pass-rates.ts';


export interface Labelled {
  readonly itemId: string;
  readonly group: LabelGroup;
  /** Coined-picture refs that are this post's own coin's: never its picture match. */
  readonly ownCoins: readonly string[];
}


const LABELS = new URL('../../eval/src/feed/live-labels.json', import.meta.url);

/* ── the labels ───────────────────────────────────────────────────────────────────────────────── */

export async function loadLabels(db: Db): Promise<readonly Labelled[]> {
  const out = new Map<string, Labelled>();
  const put = (itemId: string, group: LabelGroup, ownCoins: readonly string[] = []) => {
    const was = out.get(itemId);
    out.set(itemId, { itemId, group, ownCoins: [...new Set([...(was?.ownCoins ?? []), ...ownCoins])] });
  };
  const soft = async <R,>(sql: string): Promise<R[]> => {
    try {
      return await db.query<R & Record<string, unknown>>(sql);
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return [];
      throw e;
    }
  };
  const listed = handGoldIds();
  /* recall: the creator-linked posts made before launch, from the check and its gold additions. */
  for (const r of await soft<{ post_id: string }>(`select distinct post_id from internal.recall_check where post_platform = 'x' and post_id is not null and (posted_at is null or launched_at is null or posted_at <= launched_at)`)) put(`x:${r.post_id}`, 'recall');
  for (const g of await soft<{ item_id: string; source: string; coin_mint: string | null }>(`select item_id, source, coin_mint from internal.gold_addition`)) {
    if (g.source === 'recall') put(g.item_id, listed.has(g.item_id) ? 'gold' : 'recall', g.coin_mint === null ? [] : [g.coin_mint]);
  }
  /* gold: the sheets' origin posts and the owner's list. */
  const evidence = loadEvidence();
  for (const c of tuning()) {
    const post = evidence.get(c.id)?.origin?.post ?? null;
    if (post !== null) put(`x:${post.postId}`, 'gold', [c.id]);
  }
  for (const id of listed) put(id, 'gold');
  /* the labels file */
  const labels = (JSON.parse(readFileSync(LABELS, 'utf8')) as { posts: { itemId: string; label: string; ownerLabel?: string }[] }).posts;
  for (const p of labels) {
    const l = p.ownerLabel ?? p.label;
    if (l === 'meme') put(p.itemId, 'meme');
    else if (l === 'not') put(p.itemId, 'not');
  }
  for (const m of await soft<{ item_id: string }>(`select distinct item_id from internal.missed_post where status = 'done' and item_id is not null`)) put(m.item_id, 'missed');
  for (const t of await soft<{ item_id: string; verdict: string }>(
    `select distinct on (item_id) item_id, verdict from internal.owner_feedback where subject_kind = 'post' order by item_id, created_at desc, id desc`,
  )) {
    if (t.verdict === 'meme') put(t.item_id, 'meme');
    else if (t.verdict === 'not') put(t.item_id, 'not');
  }
  return [...out.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
}

/** One stored post as the projector would see it: its signals and today's rules' answer. */
export function exampleOf(l: Labelled, f: StoredPostFacts, p: Policy): Example {
  const scale = f.source === 'tiktok' ? p.rising.shortVideoReachScale : 1;
  const facts = {
    coinable: f.coinable, confidence: f.confidence, lookedAt: f.lookedAt, proposedName: f.proposedName, kindLabel: f.kindLabel,
    pictureSimilarity: f.pictureSimilarity, readings: f.readings, postedAtMs: f.postedAt === null ? null : f.postedAt.getTime(), reachScale: scale, attention: f.attention,
  };
  const judged = f.coinable !== null && f.confidence !== null && f.lookedAt !== null;
  const rulesPass = judged && postScoreReason({ coinable: f.coinable as boolean, confidence: f.confidence as number, lookedAt: f.lookedAt as 'text', proposedName: f.proposedName }, p, f.pictureSimilarity, f.kindLabel) === 'passes';
  return { itemId: l.itemId, group: l.group, y: POSITIVE.has(l.group) ? 1 : 0, heldOut: isHeldOut(l.itemId, p.learning.scoreHeldOutShare), signals: postSignals(facts, p), rulesPass };
}

/* ── a refit ──────────────────────────────────────────────────────────────────────────────────── */

export interface Coverage {
  readonly labelled: number;
  readonly held: number;
  /** Held with a measured reach reading: the posts the fit is made and tested on. */
  readonly usable: number;
  /** Per signal, how many held posts have it. */
  readonly present: Readonly<Record<string, number>>;
}

export interface RefitResult {
  readonly fitN: number;
  readonly heldOutN: number;
  readonly applied: boolean;
  readonly why: string | null;
  readonly id: number | null;
  readonly bar: number | null;
  readonly weights: ReturnType<typeof signalWeights>;
  readonly gate: ReturnType<typeof gateFit>;
  readonly coverage: Readonly<Record<LabelGroup, Coverage>>;
  /** The trade-off on the fixed held-out posts. */
  readonly table: ReturnType<typeof tradeOff>;
  /** The same, cross-validated over every usable label; `crossNone` is today's rules alone. */
  readonly crossTable: ReturnType<typeof tradeOff>;
  readonly crossNone: ReturnType<typeof ratesOf>;
  readonly crossOrder: number | null;
  readonly crossRulesOrder: number | null;
  readonly examples: readonly Example[];
  readonly fit: ScoreFit;
}

export async function refit(db: Db, opts: { readonly record: boolean; readonly now?: Date; readonly policy?: Policy }): Promise<RefitResult> {
  const p = opts.policy ?? DEFAULT_POLICY;
  const repo = new PgScoreModelRepo(db);
  const labels = await loadLabels(db);
  const facts = new Map((await repo.facts(labels.map((l) => l.itemId), new Map(labels.map((l) => [l.itemId, l.ownCoins] as const)))).map((f) => [f.itemId, f] as const));
  const stored = labels.flatMap((l) => {
    const f = facts.get(l.itemId);
    return f === undefined ? [] : [exampleOf(l, f, p)];
  });
  /* ★ ONLY POSTS THAT LOOK LIKE A FOR YOU POST: a measured reach reading, which every post on For
     You has (core clearsReachBar). A labelled post we never read live (an old gold post, a missed
     post read once by hand) would teach "no reading → meme", which is true of the labels and of no
     post the projector ever orders. They are counted in the coverage line and left out. */
  const examples = stored.filter(usable);
  const coverage = {} as Record<LabelGroup, Coverage>;
  for (const g of ['gold', 'missed', 'recall', 'meme', 'not'] as const) {
    const held = stored.filter((e) => e.group === g);
    coverage[g] = { labelled: labels.filter((l) => l.group === g).length, held: held.length, usable: held.filter(usable).length, present: Object.fromEntries(SCORE_SIGNALS.map((s) => [s, held.filter((e) => e.signals[s] !== null).length])) };
  }
  const fitRows = examples.filter((e) => !e.heldOut);
  const heldOut = examples.filter((e) => e.heldOut);
  const fit = fitLogistic(fitRows, p.learning.scoreL2);
  const inUse = await repo.latestApplied();
  const ref: ScoreFit | null = inUse === null ? null : { intercept: inUse.intercept, terms: inUse.terms };
  const bar = p.rising.scorePassBar;
  const gate = gateFit(heldOut, fit, ref, bar);
  const table = tradeOff(heldOut, (r) => postRankScore(r.signals, fit));
  /* Every usable label scored by a fit that never saw it: the owner's table, with the most labels. */
  const cv = crossScores(examples, p.learning.scoreL2);
  const cvValue = (r: Example) => cv.get(r.itemId) ?? 0;
  const crossTable = tradeOff(examples, cvValue);
  const crossNone = ratesOf(examples, (r) => r.rulesPass);
  const crossOrder = ordering(examples, cvValue);
  const crossRulesOrder = ordering(examples, (r) => (r.rulesPass ? 1 : 0));
  const weights = signalWeights(fit);
  let id: number | null = null;
  let why = gate.why;
  if (opts.record) {
    /* Before 0065 is migrated there is nowhere to keep a fit: measured and said, never applied. */
    id = await repo.record({
      fittedAt: opts.now ?? new Date(),
      features: [...SCORE_SIGNALS],
      intercept: fit.intercept,
      terms: fit.terms,
      fitN: fitRows.length,
      heldOut: { bar, next: gate.next, ref: gate.ref, order: gate.order, refOrder: gate.refOrder, against: ref === null ? 'rules' : `fit ${inUse?.id}`, n: heldOut.length },
      applied: gate.apply,
      why: gate.why,
    }).catch((e: unknown) => {
      if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return null;
      throw e;
    });
    if (id === null) why = `not recorded: internal.score_model (0065) is not migrated yet${gate.why === null ? '' : `; ${gate.why}`}`;
  }
  return { fitN: fitRows.length, heldOutN: heldOut.length, applied: gate.apply && opts.record && id !== null, why, id, bar, weights, gate, coverage, table, crossTable, crossNone, crossOrder, crossRulesOrder, examples, fit };
}

/**
 * The re-tune's one call: refit, record, and say what to put in the log and the owner's alert.
 * Never throws — the order model failing must not fail the judge's re-tune.
 */
export async function refitForRetune(url: string | undefined, opts: { readonly record: boolean }): Promise<{ readonly log: Record<string, unknown>; readonly facts: Record<string, unknown> }> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-score-model' });
  try {
    const r = await refit(asDb(pool), { record: opts.record });
    const ofN = (x: Rate) => `${x.passed}/${x.tested}`;
    const rates = (x: ReturnType<typeof ratesOf>) => ({ hand: ofN(x.hand), negatives: ofN(x.negatives), missed: ofN(x.missed), recall: ofN(x.recall) });
    return {
      log: { applied: r.applied, why: r.why, id: r.id, fitN: r.fitN, heldOutN: r.heldOutN, bar: r.bar, weights: r.weights, heldOut: rates(r.gate.next), before: rates(r.gate.ref), order: r.gate.order, orderBefore: r.gate.refOrder },
      facts: {
        orderApplied: r.applied,
        orderWhy: r.why,
        orderSignals: r.weights.map((w) => ({ signal: w.signal, weight: w.weight })),
        orderHandBefore: r.gate.ref.hand.passed, orderHandAfter: r.gate.next.hand.passed, orderHandN: r.gate.next.hand.tested,
        orderNegBefore: r.gate.ref.negatives.passed, orderNegAfter: r.gate.next.negatives.passed, orderNegN: r.gate.next.negatives.tested,
        orderMissedBefore: r.gate.ref.missed.passed, orderMissedAfter: r.gate.next.missed.passed, orderMissedN: r.gate.next.missed.tested,
      },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { log: { failed: err }, facts: { orderApplied: false, orderWhy: `the order model could not be fitted: ${err.slice(0, 200)}` } };
  } finally {
    await pool.end();
  }
}
