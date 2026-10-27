/**
 * OUR OWN MODEL, FITTED AT EACH RE-TUNE, FOR EACH TARGET: a logistic regression that says how sure
 * it is a post is a yes for its target, from the facts we held when the judge answered it and its
 * words-and-picture vector; tested on the newest posts it never saw and on the owner's held-out
 * missed posts; written to internal.coin_model (0096) with its target (0099). The runner scores
 * each post the judge said no to with each target's applied fit (services/runner
 * work/coin-model.ts); the projector lets one through only with Policy.judge.coinModel.on, and only
 * for `liveTarget`.
 *
 * Its own module, called from tools/retune.ts by one line beside the junk filter, because it is a
 * fourth learner and must not share the judge block's fate: free (every fact and vector is already
 * stored — no paid call), and a failure is logged and never fails the re-tune. `tools/coin-model.ts`
 * runs it by hand and prints the owner's table. Not ml/train: it refits unattended.
 *
 * ★ THE DECISION TIME. A post is scored as of its FIRST live answer (internal.post_judgement, not a
 * rule, not a copy): every reading is the newest taken by then (store coin-model.ts `facts`), and
 * so is the count of coins linked to it. A post we never judged (a missed post, gold, a backtest
 * post) is scored as of when we first saw it, and a post we do not hold at all on its words and
 * picture alone, with no reading.
 *
 * ★ THE TARGETS' LABELS.
 *   coined  y = 1: people launched a coin for it `lateMs` or more after it was posted, by an
 *           account that does not coin its own posts (store `coinedLate`), or it is hand gold, an
 *           owner's "meme" tap, a taught missed post (eval coin-model-split.json `teach`), or a
 *           backtest 2 or 3 post (eval backtest-coined.json). y = 0: everything else the judge
 *           answered, and the owner's "Not a meme" taps whatever was coined. The coin features are
 *           left out of its fit (core `COIN_FEATURES`): for it they are the label read early.
 *   viral   the owner, 2026-10-18: "memeable and about to go viral; coins are just one input".
 *           y = 1: hand gold, an owner's "meme" tap, a taught missed post, or a post that went over
 *           the scorecard's viral line (tools/lib/scorecard.ts `VIRAL_LINE`) AFTER its decision.
 *           y = 0: the owner's "Not a meme" taps and no calls, whatever the views, and every post
 *           that never went over the line. A post already over the line when it was decided is
 *           not "about to" and not a no either: it is left out of the fit (`already`). A post
 *           decided less than `viral.settleMs` ago has not had its day, so the whole split ends
 *           there. Coins known by the decision are features, never the label.
 * Never-yes posts are kept for the fit by a hash of the id (`negativeShare`); every labelled post
 * is kept. The viral fit also leaves out the posts labelled from views alone that have no vector:
 * 1 in 10 viral posts, older than the embedding backfill reached, against almost none of the
 * negatives, so "no vector" would have been taught as "viral".
 *
 * ★ AND THE OWNER'S SOFT YES, AT A LOWER WEIGHT (Policy.learning.seenKept, the owner 2026-10-18). A
 * post he saw and kept (store owner-seen.ts) that no label above names is y = 1 with sample weight
 * `fitWeight` (every other row weighs 1); any explicit label, coin or view count wins over it. In the
 * FIT only: the validation's ranking, the threshold's table and the test count the target's yes
 * exactly as before, so a soft label cannot make the net look better than it is.
 *
 * ★ THE SPLIT. By decision time over the posts the live judge answered: the newest `testShare` is
 * the test, never fitted; of the rest, the newest `validationShare` chooses the ridge and the
 * threshold, fitted on what is older. The table is read with a fit on all the training time (fit
 * B), at the threshold chosen on validation; the fit stored is refitted on everything (fit C) with
 * the same ridge and threshold. The owner's held-out missed posts are never taught to any fit.
 *
 * ★ ONE RULER. Every target's table carries the scorecard's measures on the same test posts:
 * memeable %, earliness, coverage, extras an hour, the junk rise (eval coin-fit.ts). The applied
 * fit it would replace is read on the same posts beside it, and the judge alone is in every row.
 *
 * ★ THE GATE. A new fit is applied when a threshold was found and, with one already applied, it
 * catches more of the held-out missed posts than the applied one at its own threshold with no more
 * junk on the same test posts (the owner, 2026-10-18: "only replaced if the new one catches more
 * missed posts without more junk, using the same gate idea as the judge"). The applied one is the
 * target's own; a target with none yet is gated against the applied coined fit, the net it would
 * stand beside.
 *
 * What breaks if changed carelessly: the features must stay core `coinModelFeatures` — the runner
 * scores with it — and the facts must stay `facts`' as-of-decision read; a later reading in the fit
 * would be a model taught on the future. The views that make a viral label are read after the
 * decision on purpose: they are the label, and never a feature.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DEFAULT_POLICY, type CoinModelTarget, type Policy } from '../../contracts/src/policy.ts';
import { clearsReachBar, COIN_FEATURES, coinModelFeatures, coinModelProbability, oneHotsOf, standardised, type CoinModelFacts, type CoinModelFit } from '../../core/src/index.ts';
import { asDb, createPool, DB_ROLE, PgCoinModelRepo, PgLearningRepo, PgOwnerSeenRepo, type AppliedCoinModel, type CoinFactRow, type Db, type FirstAnswer } from '../../store/src/index.ts';
import { PgJunkFilterRepo } from '../../store/src/repo/junk-filter.ts';
import { averagePrecision, chooseThreshold, fitLogistic, scoreRow, standardisation, tableRow, THRESHOLDS, type FitRow, type LogisticFit, type TablePost, type TableRow } from '../../eval/src/feed/coin-fit.ts';
import { loadJunkLabels } from './junk-filter.ts';
import { GEMMA_JUDGE, HAIKU_JUDGE, oldLabel } from './junk-sample.ts';
import { EARLY_SHARE, NEAR_24H_MS, VIRAL_LINE } from './scorecard.ts';

/* ★ THE POLICY'S POST SPACE, the one the runner stores and scores in. This read one embedding model's
   name from its adapter, so after the switch to our own models (policy.v172, v182) the fit read and
   recorded vectors in a space no new post has. */
const POST_SPACE = DEFAULT_POLICY.group.image.postSpace;

const SPLIT = new URL('../../eval/src/feed/coin-model-split.json', import.meta.url);
const BACKTEST = new URL('../../eval/src/feed/backtest-coined.json', import.meta.url);
/** The newest share of the judged posts' time held out as the test. */
export const TEST_SHARE = 0.2;
/** A language gets its own one-hot with at least this many training posts. */
const MIN_LANG_POSTS = 100;
/** Reads go in chunks this size: a few thousand posts a query. */
const CHUNK = 2000;
/** The short-video source's reach scale applies to this source (as the projector's rising.ts). */
const SHORT_VIDEO_SOURCE = 'tiktok';
const MS_PER_HOUR = 3_600_000;
const DAY_MS = 86_400_000;

export type Why = 'coined' | 'gold' | 'missed' | 'meme' | 'backtest' | 'viral' | 'already' | 'not' | 'kept' | 'none';

export interface Example {
  readonly itemId: string;
  readonly decidedAtMs: number;
  readonly facts: CoinModelFacts;
  readonly vector: Float32Array | null;
  readonly y: 0 | 1;
  readonly why: Why;
  /** Answered by the live judge: part of the time split. Others are taught only. */
  readonly live: boolean;
  readonly answer: FirstAnswer | null;
}

export interface MissedScore {
  readonly itemId: string;
  readonly post: string;
  readonly group: string;
  readonly score: number;
  /** Why no setting may catch it, when one of these holds. */
  readonly blockers: readonly string[];
}

export interface CoinModelRefit {
  readonly target: CoinModelTarget;
  readonly counts: Readonly<Record<string, number>>;
  readonly l2: number;
  readonly validation: { readonly ap: Readonly<Record<string, number | null>>; readonly threshold: number | null; readonly from: string; readonly to: string };
  readonly test: { readonly from: string; readonly to: string; readonly hours: number; readonly posts: number; readonly ap: number | null };
  readonly threshold: number | null;
  readonly table: readonly TableRow[];
  readonly missed: readonly MissedScore[];
  readonly taughtMissed: readonly MissedScore[];
  /** The applied fit this one is gated against, read on the same test posts and missed posts. */
  readonly current: { readonly id: number; readonly target: CoinModelTarget; readonly threshold: number; readonly missedCaught: number; readonly junkRise: number | null; readonly table: readonly TableRow[]; readonly missed: readonly MissedScore[] } | null;
  readonly applied: boolean;
  readonly why: string | null;
  readonly id: number | null;
  readonly fit: Omit<CoinModelFit, 'id' | 'threshold'>;
  readonly testPosts: readonly TablePost[];
  readonly weightsByName: readonly { readonly name: string; readonly weight: number }[];
}

export const hashShare = (id: string): number => createHash('sha256').update(`coin-model|${id}`).digest().readUInt32BE(0) / 0x1_0000_0000;
const chunks = <T,>(xs: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

export function loadSplit(): { readonly test: readonly { id: string; post: string; group: string }[]; readonly teach: readonly { id: string; post: string; group: string }[] } {
  return JSON.parse(readFileSync(SPLIT, 'utf8'));
}

function factsOf(r: CoinFactRow): CoinModelFacts {
  return {
    source: r.source, lang: r.lang, text: r.text, mediaKinds: r.mediaKinds,
    postedAtMs: r.postedAt?.getTime() ?? null, decidedAtMs: r.decidedAt.getTime(),
    reach: r.reach, reachAtMs: r.reachAt?.getTime() ?? null, ratePerMinute: r.ratePerMinute, priorRatePerMinute: r.priorRatePerMinute,
    approval: r.approval, conversation: r.conversation, rebroadcast: r.rebroadcast, followers: r.followers, echoes: r.echoes, coins: r.coins,
  };
}

/** Facts for a post we do not hold: its words, its source, nothing read. */
function bareFacts(itemId: string, text: string, atMs: number): CoinModelFacts {
  return {
    source: itemId.split(':')[0] ?? '', lang: null, text, mediaKinds: [], postedAtMs: null, decidedAtMs: atMs,
    reach: null, reachAtMs: null, ratePerMinute: null, priorRatePerMinute: null, approval: null, conversation: null, rebroadcast: null, followers: null, echoes: null, coins: null,
  };
}

/** A label from views alone, kept for the fit by hash like a never-yes post: the viral target's `already` only. */
const sampledLabel = (why: Why): boolean => why === 'none' || why === 'already';

/** Every example of `target`, with its facts as of its decision and its vector; the split ends at `untilMs`. */
export async function loadExamples(db: Db, p: Policy, opts: { readonly since: Date; readonly now: Date; readonly target?: CoinModelTarget; readonly log?: (s: string) => void }): Promise<{ readonly examples: readonly Example[]; readonly counts: Record<string, number>; readonly valFromMs: number; readonly testFromMs: number; readonly untilMs: number }> {
  const C = p.judge.coinModel;
  const target = opts.target ?? 'coined';
  const log = opts.log ?? (() => {});
  const repo = new PgCoinModelRepo(db);
  const vectors = new PgJunkFilterRepo(db);
  const split = loadSplit();
  const heldOut = new Set(split.test.map((t) => t.id));
  const taught = new Set(split.teach.map((t) => t.id));
  /* A viral label needs its day: the split ends `settleMs` before now. */
  const untilMs = target === 'viral' ? opts.now.getTime() - C.viral.settleMs : opts.now.getTime();

  const answers = (await repo.firstAnswers(opts.since)).filter((a) => a.judgedAt.getTime() < untilMs);
  log(`${answers.length} posts answered from ${opts.since.toISOString()} to ${new Date(untilMs).toISOString()} (target ${target})`);
  const coined = target === 'coined' ? await repo.coinedLate({ lateMs: C.lateMs, deployerWindowMs: C.deployerWindowMs, deployerMinPosts: C.deployerMinPosts }) : new Map();
  const owner = await loadJunkLabels(db, p);
  const taps = new Map((await new PgLearningRepo(db).postCalls()).map((t) => [t.itemId, t.verdict] as const));
  const backtest = new Set((JSON.parse(readFileSync(BACKTEST, 'utf8')) as { posts: { id: string }[] }).posts.map((x) => x.id));
  const K = p.learning.seenKept;
  const kept = await new PgOwnerSeenRepo(db).keptIds({ since: opts.since, until: opts.now, keepWindowMs: K.keepWindowMs, now: opts.now });
  /* The viral line's crossing, for the viral target's labels: read after the decision on purpose (the label, never a feature). */
  const crossedAt = new Map<string, number>();
  if (target === 'viral') {
    for (const c of chunks(answers.map((a) => a.itemId))) for (const [id, pk] of await repo.reachPeaks(c, VIRAL_LINE, EARLY_SHARE)) if (pk.crossedAt !== null) crossedAt.set(id, pk.crossedAt.getTime());
    log(`${crossedAt.size} of them went over the viral line`);
  }

  const labelOf = (id: string, decidedAtMs: number | null): { y: 0 | 1; why: Why } => {
    if (taps.get(id) === 'not') return { y: 0, why: 'not' };
    if (taught.has(id)) return { y: 1, why: 'missed' };
    const g = owner.get(id);
    if (g === 'gold') return { y: 1, why: 'gold' };
    if (g === 'meme') return { y: 1, why: 'meme' };
    if (target === 'coined') {
      if (coined.has(id)) return { y: 1, why: 'coined' };
      if (backtest.has(id)) return { y: 1, why: 'backtest' };
    }
    if (g === 'missed') return { y: 1, why: 'missed' };
    if (g === 'not') return { y: 0, why: 'not' };
    if (target === 'viral' && decidedAtMs !== null) {
      const at = crossedAt.get(id);
      if (at !== undefined) return at <= decidedAtMs ? { y: 0, why: 'already' } : { y: 1, why: 'viral' };
    }
    if (kept.has(id)) return { y: 1, why: 'kept' };
    return { y: 0, why: 'none' };
  };

  /* The time split, over every post the live judge answered: the newest TEST_SHARE is the test, the
     newest validationShare of the rest the validation. Both windows keep every post (their table
     counts posts an hour); older never-yes posts are kept by hash. */
  const byTime = [...answers].sort((a, b) => a.judgedAt.getTime() - b.judgedAt.getTime());
  const first = byTime[0]?.judgedAt.getTime() ?? untilMs;
  const testFromMs = first + (untilMs - first) * (1 - TEST_SHARE);
  const valFromMs = first + (testFromMs - first) * (1 - C.validationShare);
  const keep = byTime.filter((a) => heldOut.has(a.itemId) || !sampledLabel(labelOf(a.itemId, a.judgedAt.getTime()).why) || a.judgedAt.getTime() >= valFromMs || hashShare(a.itemId) < C.negativeShare);
  const liveIds = new Set(keep.map((a) => a.itemId));

  /* The rest: labelled posts outside the answers (missed posts, gold, backtest), each as of when we first saw it. */
  const others = [...new Set([...owner.keys(), ...backtest, ...heldOut, ...taught])].filter((id) => !liveIds.has(id) && (heldOut.has(id) || labelOf(id, null).y === 1));
  const held = await repo.held(others);

  const pairs = [
    ...keep.map((a) => ({ itemId: a.itemId, decidedAt: a.judgedAt })),
    ...others.flatMap((id) => {
      const h = held.get(id);
      return h === undefined ? [] : [{ itemId: id, decidedAt: h.firstAnswerAt ?? h.firstSeenAt }];
    }),
  ];
  const facts = new Map<string, CoinFactRow>();
  for (const c of chunks(pairs)) for (const r of await repo.facts(c)) facts.set(r.itemId, r);
  log(`${facts.size} posts' facts read`);
  const vec = new Map<string, { text: string; values: Float32Array }>();
  for (const c of chunks([...new Set([...pairs.map((x) => x.itemId), ...others])])) for (const [id, v] of await vectors.vectors(c, POST_SPACE)) vec.set(id, v);
  log(`${vec.size} vectors read`);

  const answerOf = new Map(answers.map((a) => [a.itemId, a] as const));
  const examples: Example[] = [];
  for (const id of [...liveIds, ...others]) {
    const f = facts.get(id);
    const v = vec.get(id);
    const fx = f !== undefined ? factsOf(f) : v !== undefined ? bareFacts(id, v.text, opts.now.getTime()) : null;
    if (fx === null) continue;
    const label = heldOut.has(id) ? { y: 1 as const, why: 'missed' as const } : labelOf(id, liveIds.has(id) ? fx.decidedAtMs : null);
    examples.push({ itemId: id, decidedAtMs: fx.decidedAtMs, facts: fx, vector: v !== undefined && v.values.length > 0 ? v.values : null, y: label.y, why: label.why, live: liveIds.has(id), answer: answerOf.get(id) ?? null });
  }
  const counts: Record<string, number> = { answered: answers.length, kept: examples.length, withVector: examples.filter((e) => e.vector !== null).length };
  for (const e of examples) counts[e.why] = (counts[e.why] ?? 0) + 1;
  if (target === 'coined') counts['coinedAnswered'] = answers.filter((a) => coined.has(a.itemId) && taps.get(a.itemId) !== 'not').length;
  else {
    counts['viralNoVector'] = examples.filter((e) => e.why === 'viral' && e.vector === null).length;
    counts['coinedByDecision'] = examples.filter((e) => (e.facts.coins ?? 0) > 0).length;
  }
  return { examples, counts, valFromMs, testFromMs, untilMs };
}

/* ── the design matrix ────────────────────────────────────────────────────────────────────────── */

interface Design {
  readonly names: readonly string[];
  readonly means: readonly number[];
  readonly spreads: readonly number[];
  readonly dim: number;
  readonly sources: readonly string[];
  readonly langs: readonly string[];
}

function designOf(train: readonly Example[], p: Policy, target: CoinModelTarget): Design {
  const sources = [...new Set(train.map((e) => e.facts.source))].sort();
  const langCount = new Map<string, number>();
  for (const e of train) if (e.facts.lang !== null) langCount.set(e.facts.lang, (langCount.get(e.facts.lang) ?? 0) + 1);
  const langs = [...langCount.entries()].filter(([, n]) => n >= MIN_LANG_POSTS).map(([l]) => l).sort();
  const feats = train.map((e) => ({ ...coinModelFeatures(e.facts, sources, langs, p), no_vector: e.vector === null ? 1 : 0 }));
  /* The coined target never reads a coin: for it a coin by the decision is its label arriving early. */
  const names = Object.keys(feats[0] ?? {}).filter((n) => target !== 'coined' || !COIN_FEATURES.includes(n)).sort();
  const { means, spreads } = standardisation(feats, names);
  const dim = train.find((e) => e.vector !== null)?.vector?.length ?? 0;
  return { names, means, spreads, dim, sources, langs };
}

function rowOf(e: Example, d: Design, p: Policy): FitRow {
  const x = new Float64Array(d.names.length + d.dim);
  x.set(standardised({ ...coinModelFeatures(e.facts, d.sources, d.langs, p), no_vector: e.vector === null || e.vector.length !== d.dim ? 1 : 0 }, d.names, d.means, d.spreads), 0);
  if (e.vector !== null && e.vector.length === d.dim) for (let j = 0; j < d.dim; j++) x[d.names.length + j] = e.vector[j] as number;
  return { x, y: e.y, w: e.why === 'kept' ? p.learning.seenKept.fitWeight : 1 };
}

/** The label every measurement reads: the target's yes; a soft yes is taught, never counted as caught. */
const measuredY = (e: Example): 0 | 1 => (e.why === 'kept' ? 0 : e.y);

/** Whether an example is taught to `target`'s fit. */
function taughtTo(e: Example, p: Policy, target: CoinModelTarget): boolean {
  if (e.why === 'already') return false;
  if (target === 'viral' && (e.why === 'viral' || e.why === 'none') && e.vector === null) return false;
  return e.why !== 'none' || hashShare(e.itemId) < p.judge.coinModel.negativeShare;
}

/** Fits on `xs`, never-yes posts kept by hash (`negativeShare`) and every labelled one. */
function fitOn(xs: readonly Example[], l2: number, p: Policy, target: CoinModelTarget): { readonly d: Design; readonly f: LogisticFit; readonly score: (e: Example) => number } {
  const train = xs.filter((e) => taughtTo(e, p, target));
  const d = designOf(train, p, target);
  const f = fitLogistic(train.map((e) => rowOf(e, d, p)), l2);
  return { d, f, score: (e) => scoreRow(rowOf(e, d, p).x, f) };
}

const asStored = (d: Design, f: LogisticFit): Omit<CoinModelFit, 'id' | 'threshold'> => ({
  space: POST_SPACE, intercept: f.intercept, names: d.names, means: d.means, spreads: d.spreads,
  weights: f.weights.slice(0, d.names.length), vectorWeights: f.weights.slice(d.names.length),
});

/* ── the table's posts ────────────────────────────────────────────────────────────────────────── */

type Reading = { readonly atMs: number; readonly reach: number | null };

/** The newest reading's views at or before `atMs`; null when none. */
const viewsAt = (rs: readonly Reading[], atMs: number | null): number | null => {
  if (atMs === null) return null;
  let v: number | null = null;
  for (const r of rs) if (r.atMs <= atMs && r.reach !== null) v = r.reach;
  return v;
};

/** Views a day after posting, the scorecard's way: the reading nearest posted + 24 h within NEAR_24H_MS, else the highest one. */
function dayViews(rs: readonly Reading[], postedAtMs: number | null): number | null {
  const read = rs.filter((r): r is { atMs: number; reach: number } => r.reach !== null);
  if (read.length === 0) return null;
  if (postedAtMs !== null) {
    const at = postedAtMs + DAY_MS;
    const near = read.filter((r) => Math.abs(r.atMs - at) <= NEAR_24H_MS).sort((a, b) => Math.abs(a.atMs - at) - Math.abs(b.atMs - at))[0];
    if (near !== undefined) return near.reach;
  }
  return Math.max(...read.map((r) => r.reach));
}

/** The table's posts, the same measures for every target; `hit` is the target's own yes. */
async function tablePosts(db: Db, p: Policy, posts: readonly Example[], score: (e: Example) => number, nowMs: number): Promise<TablePost[]> {
  const repo = new PgCoinModelRepo(db);
  const ids = posts.map((e) => e.itemId);
  const shown = new Map<string, Date>();
  const readings = new Map<string, readonly Reading[]>();
  const old = new Map<string, { a: { coinable: boolean; confidence: number } | null; b: { coinable: boolean; confidence: number } | null }>();
  for (const c of chunks(ids)) {
    for (const [k, v] of await repo.firstShown('fyp', c)) shown.set(k, v);
    for (const [k, v] of await repo.reachReadings(c)) readings.set(k, v);
    for (const [k, v] of await repo.oldAnswers(c, [HAIKU_JUDGE, GEMMA_JUDGE])) old.set(k, v);
  }
  const taps = new Map((await new PgLearningRepo(db).postCalls()).map((t) => [t.itemId, t.verdict] as const));
  return posts.map((e) => {
    const posted = e.facts.postedAtMs;
    const scale = e.facts.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1;
    const all = readings.get(e.itemId) ?? [];
    const inAge = all.filter((r) => posted === null || r.atMs <= Math.min(nowMs, posted + p.rising.fypMaxAgeMs));
    const tap = taps.get(e.itemId);
    const o = old.get(e.itemId);
    const ol = o === undefined ? { label: null } : oldLabel({ haiku: o.a, gemma: o.b }, p);
    const junk = tap === 'not' ? true : tap === 'meme' ? false : ol.label === 'not' ? true : ol.label === 'meme' ? false : null;
    const gates = tap !== 'not' && clearsReachBar('fyp', inAge, posted, p, scale);
    /* When the net would have added it: at its decision, or at the first reading after it that clears the reach bar. */
    let addAtMs: number | null = null;
    if (gates) {
      for (let k = 0; k < inAge.length; k++) {
        if (clearsReachBar('fyp', inAge.slice(0, k + 1), posted, p, scale)) {
          addAtMs = Math.max(e.decidedAtMs, (inAge[k] as Reading).atMs);
          break;
        }
      }
    }
    const line = VIRAL_LINE[e.facts.source];
    const crossed = line === undefined ? undefined : all.find((r) => r.reach !== null && r.reach >= line);
    const early = line === undefined ? undefined : all.find((r) => r.reach !== null && r.reach >= EARLY_SHARE * line);
    const shownAt = shown.get(e.itemId)?.getTime() ?? null;
    return {
      itemId: e.itemId,
      score: score(e),
      hit: measuredY(e) === 1 && e.why !== 'not',
      shown: shownAt !== null,
      judgeNo: e.answer !== null && !e.answer.newestCoinable,
      gates,
      junk,
      tappedNot: tap === 'not',
      memeViral: crossed !== undefined && crossed.atMs > e.decidedAtMs && e.why !== 'not' && tap !== 'not',
      earlyAtMs: early?.atMs ?? null,
      shownAtMs: shownAt,
      addAtMs,
      viewsShown: viewsAt(all, shownAt),
      viewsAdd: viewsAt(all, addAtMs),
      views24: dayViews(all, posted),
    };
  });
}

/* ── a refit ──────────────────────────────────────────────────────────────────────────────────── */

/** Why a missed post cannot be caught at any setting, by the facts at its decision. */
function blockersOf(e: Example | undefined, firstCoinAt: Date | null): string[] {
  if (e === undefined) return ['not held: we never saw the post'];
  const out: string[] = [];
  if (e.answer === null) out.push('never judged live: found by the owner, not by us');
  if (firstCoinAt !== null && e.decidedAtMs > firstCoinAt.getTime()) out.push(`found too late: decided ${Math.round((e.decidedAtMs - firstCoinAt.getTime()) / 60_000)} min after the first coin`);
  if (e.facts.ratePerMinute === null) out.push('no speed yet: one reach reading at the decision');
  if ((e.facts.conversation ?? 0) === 0) out.push('no replies yet');
  if (e.vector === null) out.push('no vector');
  return out;
}

export async function refitCoinModel(db: Db, opts: { readonly record: boolean; readonly target?: CoinModelTarget; readonly now?: Date; readonly policy?: Policy; readonly since?: Date; readonly log?: (s: string) => void }): Promise<CoinModelRefit> {
  const p = opts.policy ?? DEFAULT_POLICY;
  const C = p.judge.coinModel;
  const target = opts.target ?? 'coined';
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const since = opts.since ?? new Date(now.getTime() - 14 * DAY_MS);
  const { examples, counts, valFromMs: valFrom, testFromMs: testFrom, untilMs: until } = await loadExamples(db, p, { since, now, target, log });
  const split = loadSplit();
  const heldOut = new Set(split.test.map((t) => t.id));

  const live = examples.filter((e) => e.live && !heldOut.has(e.itemId)).sort((a, b) => a.decidedAtMs - b.decidedAtMs);
  const taughtOnly = examples.filter((e) => !e.live && !heldOut.has(e.itemId));
  const trainAll = [...live.filter((e) => e.decidedAtMs < testFrom), ...taughtOnly];
  const trainA = trainAll.filter((e) => !e.live || e.decidedAtMs < valFrom);
  const val = live.filter((e) => e.decidedAtMs >= valFrom && e.decidedAtMs < testFrom);
  const test = live.filter((e) => e.decidedAtMs >= testFrom);
  const valHours = (testFrom - valFrom) / MS_PER_HOUR;
  const testHours = (until - testFrom) / MS_PER_HOUR;
  log(`train A ${trainA.length}, validation ${val.length}, test ${test.length}`);

  /* The ridge, by average precision on validation; the threshold, by the owner's bars on validation. */
  const ap: Record<string, number | null> = {};
  let best: { l2: number; ap: number; fit: ReturnType<typeof fitOn> } | null = null;
  for (const l2 of C.l2s) {
    const fit = fitOn(trainA, l2, p, target);
    const a = averagePrecision(val.map((e) => ({ score: fit.score(e), y: measuredY(e) })));
    ap[String(l2)] = a;
    log(`l2 ${l2}: validation average precision ${a?.toFixed(4)}`);
    if (a !== null && (best === null || a > best.ap)) best = { l2, ap: a, fit };
  }
  const l2 = best?.l2 ?? (C.l2s[0] as number);
  const valPosts = best === null ? [] : await tablePosts(db, p, val, best.fit.score, testFrom);
  const threshold = chooseThreshold(valPosts, THRESHOLDS, valHours, C.maxJunkRise, C.maxExtrasPerHour);

  /* Fit B: all the training time. The table on the test. */
  const fitB = fitOn(trainAll, l2, p, target);
  const testPosts = await tablePosts(db, p, test, fitB.score, now.getTime());
  const grid = [...new Set([...THRESHOLDS, ...(threshold === null ? [] : [threshold])])].sort((a, b) => a - b);
  const table = grid.map((t) => tableRow(testPosts, t, testHours));
  const testAp = averagePrecision(testPosts.map((t) => ({ score: t.score, y: t.hit ? 1 : 0 })));

  /* The owner's missed posts: the held-out half scored by fit B (never taught), the taught half for the record. */
  const firstCoin = new Map((await db.query<{ item_id: string; first_coin_at: Date | null }>(`select item_id, first_coin_at from internal.missed_post where status = 'done' and item_id is not null`)).map((r) => [r.item_id, r.first_coin_at] as const));
  const byId = new Map(examples.map((e) => [e.itemId, e] as const));
  const missedOf = (xs: readonly { id: string; post: string; group: string }[], score: (e: Example) => number): MissedScore[] =>
    xs.map((m) => {
      const e = byId.get(m.id);
      return { itemId: m.id, post: m.post, group: m.group, score: e === undefined ? 0 : score(e), blockers: blockersOf(e, firstCoin.get(m.id) ?? null) };
    });
  const missed = missedOf(split.test, fitB.score);
  const taughtMissed = missedOf(split.teach, fitB.score);

  /* Fit C, stored: everything but the held-out missed posts, the same ridge. */
  const fitC = fitOn([...live, ...taughtOnly], l2, p, target);
  const stored = asStored(fitC.d, fitC.f);

  /* The gate against the applied fit — the target's own, else the applied coined net — on the same test posts and held-out missed posts. */
  const repo = new PgCoinModelRepo(db);
  const applied = (await repo.latestApplied(target)) ?? (target === 'coined' ? null : await repo.latestApplied('coined'));
  let current: CoinModelRefit['current'] = null;
  const atNew = threshold === null ? null : tableRow(testPosts, threshold, testHours);
  const newCaught = threshold === null ? 0 : missed.filter((m) => m.score >= threshold).length;
  if (applied !== null) {
    const scoreCur = (e: Example): number => scoreApplied(applied, e, p);
    const cur = await tablePosts(db, p, test, scoreCur, now.getTime());
    const curMissed = missedOf(split.test, scoreCur);
    const curGrid = [...new Set([...THRESHOLDS, applied.threshold])].sort((a, b) => a - b);
    current = {
      id: applied.id, target: applied.target, threshold: applied.threshold,
      missedCaught: curMissed.filter((m) => m.score >= applied.threshold).length,
      junkRise: tableRow(cur, applied.threshold, testHours).junkRise,
      table: curGrid.map((t) => tableRow(cur, t, testHours)),
      missed: curMissed,
    };
  }
  let why: string | null = null;
  if (threshold === null) why = `no threshold keeps junk within ${C.maxJunkRise * 100} points and extras at or under ${C.maxExtrasPerHour} an hour on validation`;
  else if (current !== null && !(newCaught > current.missedCaught && (atNew?.junkRise ?? 0) <= (current.junkRise ?? 0))) {
    why = `catches ${newCaught} held-out missed posts with junk ${pts(atNew?.junkRise ?? null)}; the applied ${current.target} fit ${current.id} catches ${current.missedCaught} with ${pts(current.junkRise)}: kept the applied one`;
  }
  let id: number | null = null;
  if (opts.record) {
    id = await repo.record({
      target, fittedAt: now, ...stored, threshold, fitN: trainAll.length + test.length,
      heldOut: { target, l2, ap, testAp, counts, validation: { from: new Date(valFrom).toISOString(), to: new Date(testFrom).toISOString(), threshold }, test: { from: new Date(testFrom).toISOString(), to: new Date(until).toISOString(), hours: testHours, posts: test.length }, table, missed, taughtMissed, current },
      applied: why === null,
      why,
    });
    if (id === null) why = `not recorded: internal.coin_model (0096) or its target (0099) is not migrated yet${why === null ? '' : `; ${why}`}`;
  }
  const weightsByName = stored.names.map((name, i) => ({ name, weight: stored.weights[i] as number })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    target, counts, l2,
    validation: { ap, threshold, from: new Date(valFrom).toISOString(), to: new Date(testFrom).toISOString() },
    test: { from: new Date(testFrom).toISOString(), to: new Date(until).toISOString(), hours: testHours, posts: test.length, ap: testAp },
    threshold, table, missed, taughtMissed, current,
    applied: why === null && opts.record && id !== null, why, id, fit: stored, testPosts, weightsByName,
  };
}

/** A stored fit's score of an example, through core, as the runner scores it. */
export function scoreApplied(fit: AppliedCoinModel, e: Example, p: Policy): number {
  const { sources, langs } = oneHotsOf(fit.names);
  return coinModelProbability(coinModelFeatures(e.facts, sources, langs, p), e.vector === null ? null : { space: POST_SPACE, values: e.vector }, fit) ?? 0;
}

/**
 * The shadow's report for one target: every post the runner scored since `since`, the ones it would
 * have added, whether each clears For You's other gates now (the reach bar inside the age bar, no
 * owner Not a meme), which got coined, which went over the viral line from under it at the answer,
 * the share of its day's views it had at the answer, and junk among them by the owner's tap or the
 * old judges' labels. Above the list: of every scored post that went viral from under the line,
 * how many the net would have added before the early share of the line.
 */
export async function shadowReport(db: Db, p: Policy, since: Date, now: Date, target: CoinModelTarget = 'coined'): Promise<string> {
  const repo = new PgCoinModelRepo(db);
  const scores = await repo.scoresSince(since, target);
  const would = scores.filter((s) => s.wouldAdd);
  const allIds = scores.map((s) => s.itemId);
  const coined = await repo.coinedLate({ lateMs: p.judge.coinModel.lateMs, deployerWindowMs: p.judge.coinModel.deployerWindowMs, deployerMinPosts: p.judge.coinModel.deployerMinPosts });
  const readings = new Map<string, readonly Reading[]>();
  for (const c of chunks(allIds)) for (const [k, v] of await repo.reachReadings(c)) readings.set(k, v);
  const old = await repo.oldAnswers(would.map((s) => s.itemId), [HAIKU_JUDGE, GEMMA_JUDGE]);
  const taps = new Map((await new PgLearningRepo(db).postCalls()).map((t) => [t.itemId, t.verdict] as const));
  const items = new Map<string, { item_id: string; source: string; posted_at: Date | null; body: string | null }>();
  for (const c of chunks(allIds)) for (const r of await db.query<{ item_id: string; source: string; posted_at: Date | null; body: string | null }>(`select item_id, source, posted_at, body from public.item where item_id = any($1::text[])`, [c])) items.set(r.item_id, r);
  const viralOf = (itemId: string, answerAt: Date): { readonly viral: boolean; readonly earlyAtMs: number | null } => {
    const it = items.get(itemId);
    const line = it === undefined ? undefined : VIRAL_LINE[it.source];
    const rs = readings.get(itemId) ?? [];
    const crossed = line === undefined ? undefined : rs.find((r) => r.reach !== null && r.reach >= line);
    const early = line === undefined ? undefined : rs.find((r) => r.reach !== null && r.reach >= EARLY_SHARE * line);
    return { viral: crossed !== undefined && crossed.atMs > answerAt.getTime() && taps.get(itemId) !== 'not', earlyAtMs: early?.atMs ?? null };
  };
  const allCoined = scores.filter((s) => coined.has(s.itemId)).length;
  const viralScored = scores.filter((s) => viralOf(s.itemId, s.answerJudgedAt).viral);
  const lines: string[] = [];
  let gated = 0, gatedCoined = 0, gatedViral = 0, gatedViralEarly = 0, junk = 0, labelled = 0;
  for (const s of would) {
    const it = items.get(s.itemId);
    const posted = it?.posted_at?.getTime() ?? null;
    const scale = it?.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1;
    const rs = readings.get(s.itemId) ?? [];
    const inAge = rs.filter((r) => posted === null || r.atMs <= Math.min(now.getTime(), posted + p.rising.fypMaxAgeMs));
    const gates = taps.get(s.itemId) !== 'not' && clearsReachBar('fyp', inAge, posted, p, scale);
    const o = old.get(s.itemId);
    const ol = o === undefined ? { label: null } : oldLabel({ haiku: o.a, gemma: o.b }, p);
    const j = taps.get(s.itemId) === 'not' ? true : ol.label === 'not' ? true : ol.label === 'meme' ? false : null;
    const v = viralOf(s.itemId, s.answerJudgedAt);
    const atAnswer = viewsAt(rs, s.answerJudgedAt.getTime());
    const day = dayViews(rs, posted);
    if (gates) {
      gated += 1;
      if (coined.has(s.itemId)) gatedCoined += 1;
      if (v.viral) {
        gatedViral += 1;
        if (v.earlyAtMs === null || s.scoredAt.getTime() < v.earlyAtMs) gatedViralEarly += 1;
      }
      if (j !== null) {
        labelled += 1;
        if (j) junk += 1;
      }
    }
    const share = atAnswer === null || day === null || day <= 0 ? '-' : `${Math.round(Math.min(1, atAnswer / day) * 100)}%`;
    lines.push(`| ${s.itemId} | ${s.probability.toFixed(3)} | ${gates ? 'yes' : 'no'} | ${coined.has(s.itemId) ? 'yes' : '-'} | ${v.viral ? 'yes' : '-'} | ${share} | ${j === null ? '-' : j ? 'junk' : 'meme'} | ${(it?.body ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 70)} |`);
  }
  const hours = (now.getTime() - since.getTime()) / MS_PER_HOUR;
  return [
    `Shadow of the ${target} target since ${since.toISOString()} (${hours.toFixed(1)} h): ${scores.length} posts the judge said no to were scored; ${allCoined} of them were coined since, ${viralScored.length} went over the viral line from under it after the answer.`,
    `It would have added ${would.length} at its threshold; ${gated} of those clear For You's other gates (${(gated / Math.max(hours, 1e-9)).toFixed(2)} an hour), ${gatedCoined} of them coined, ${gatedViral} went viral (${gatedViralEarly} scored before ${EARLY_SHARE * 100}% of the line), junk ${junk} of ${labelled} labelled.`,
    `A post still inside its day may yet go viral: read this again a day after the window ends.`,
    '', '| post | score | other gates | coined | went viral | views at the answer / day | old label | words |', '|---|---|---|---|---|---|---|---|', ...lines,
  ].join('\n');
}

const pts = (x: number | null): string => (x === null ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pts`);

/**
 * The re-tune's one call: refit every target in Policy.judge.coinModel.targets, record, and say what
 * to put in the log and the owner's alert. Never throws — the coin model failing must not fail the
 * judge's re-tune, and one target failing does not stop the other. The coined target's facts keep
 * their names; another target's are prefixed with it.
 */
export async function refitCoinModelForRetune(url: string | undefined, opts: { readonly record: boolean; readonly policy?: Policy }): Promise<{ readonly log: Record<string, unknown>; readonly facts: Record<string, unknown> }> {
  const p = opts.policy ?? DEFAULT_POLICY;
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-coin-model' });
  const log: Record<string, unknown> = {};
  const facts: Record<string, unknown> = {};
  try {
    for (const target of p.judge.coinModel.targets) {
      const key = (k: string): string => (target === 'coined' ? `coinModel${k}` : `${target}Model${k}`);
      try {
        const r = await refitCoinModel(asDb(pool), { record: opts.record, target, policy: p });
        const at = r.threshold === null ? null : r.table.find((t) => t.threshold === r.threshold) ?? null;
        const caught = r.threshold === null ? null : r.missed.filter((m) => m.score >= (r.threshold as number)).length;
        log[target] = { applied: r.applied, why: r.why, id: r.id, l2: r.l2, threshold: r.threshold, heldOutMissedCaught: caught, extrasPerHour: at?.extrasPerHour ?? null, junkRise: at?.junkRise ?? null, coverage: at?.coverage ?? null };
        Object.assign(facts, { [key('Applied')]: r.applied, [key('Why')]: r.why, [key('Threshold')]: r.threshold, [key('MissedCaught')]: caught, [key('MissedN')]: r.missed.length });
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        log[target] = { failed: err };
        Object.assign(facts, { [key('Applied')]: false, [key('Why')]: `the ${target} model could not be fitted: ${err.slice(0, 200)}` });
      }
    }
    return { log, facts };
  } finally {
    await pool.end();
  }
}
