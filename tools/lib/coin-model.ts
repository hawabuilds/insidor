/**
 * OUR OWN COIN MODEL, FITTED AT EACH RE-TUNE: a logistic regression that says how sure it is a post
 * will be coined, from the facts we held when the judge answered it and its words-and-picture
 * vector; tested on the newest posts it never saw and on the owner's held-out missed posts; written
 * to internal.coin_model (0096). The runner scores each post the judge said no to with the applied
 * fit (services/runner work/coin-model.ts); the projector lets one through only with
 * Policy.judge.coinModel.on.
 *
 * Its own module, called from tools/retune.ts by one line beside the junk filter, because it is a
 * fourth learner and must not share the judge block's fate: free (every fact and vector is already
 * stored — no paid call), and a failure is logged and never fails the re-tune. `tools/coin-model.ts`
 * runs it by hand and prints the owner's table. Not ml/train: it refits unattended.
 *
 * ★ THE DECISION TIME. A post is scored as of its FIRST live answer (internal.post_judgement, not a
 * rule, not a copy): every reading is the newest taken by then (store coin-model.ts `facts`). A post
 * we never judged (a missed post, gold, a backtest post) is scored as of when we first saw it, and
 * a post we do not hold at all on its words and picture alone, with no reading.
 *
 * ★ THE LABELS. y = 1: people launched a coin for it `lateMs` or more after it was posted, by an
 * account that does not coin its own posts (store `coinedLate`), or it is hand gold, an owner's
 * "meme" tap, a taught missed post (eval coin-model-split.json `teach`), or a backtest 2 or 3 post
 * (eval backtest-coined.json). y = 0: everything else the judge answered, and the owner's "Not a
 * meme" taps whatever was coined. Never-coined posts are kept for the fit by a hash of the id
 * (`negativeShare`); every labelled post is kept.
 *
 * ★ AND THE OWNER'S SOFT YES, AT A LOWER WEIGHT (Policy.learning.seenKept, the owner 2026-10-18). A
 * post he saw and kept (store owner-seen.ts) that no label above names is y = 1 with sample weight
 * `fitWeight` (every other row weighs 1); any explicit label or coin wins over it. In the FIT only:
 * the validation's ranking, the threshold's table and the test count "coined" exactly as before, so
 * a soft label cannot make the net look better at catching coins than it is.
 *
 * ★ THE SPLIT. By decision time over the posts the live judge answered: the newest `testShare` is
 * the test, never fitted; of the rest, the newest `validationShare` chooses the ridge and the
 * threshold, fitted on what is older. The table is read with a fit on all the training time (fit
 * B), at the threshold chosen on validation; the fit stored is refitted on everything (fit C) with
 * the same ridge and threshold. The owner's held-out missed posts are never taught to any fit.
 *
 * ★ THE GATE. A new fit is applied when a threshold was found and, with one already applied, it
 * catches more of the held-out missed posts than the applied one at its own threshold with no more
 * junk on the same test posts (the owner, 2026-10-18: "only replaced if the new one catches more
 * missed posts without more junk, using the same gate idea as the judge").
 *
 * What breaks if changed carelessly: the features must stay core `coinModelFeatures` — the runner
 * scores with it — and the facts must stay `facts`' as-of-decision read; a later reading in the fit
 * would be a model taught on the future.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { clearsReachBar, coinModelFeatures, coinModelProbability, oneHotsOf, standardised, type CoinModelFacts, type CoinModelFit } from '../../core/src/index.ts';
import { POST_SPACE } from '../../adapters/embed/voyage/src/index.ts';
import { asDb, createPool, DB_ROLE, PgCoinModelRepo, PgLearningRepo, PgOwnerSeenRepo, type AppliedCoinModel, type CoinFactRow, type Db, type FirstAnswer } from '../../store/src/index.ts';
import { PgJunkFilterRepo } from '../../store/src/repo/junk-filter.ts';
import { averagePrecision, chooseThreshold, fitLogistic, scoreRow, standardisation, tableRow, THRESHOLDS, type FitRow, type LogisticFit, type TablePost, type TableRow } from '../../eval/src/feed/coin-fit.ts';
import { loadJunkLabels } from './junk-filter.ts';
import { GEMMA_JUDGE, HAIKU_JUDGE, oldLabel } from './junk-sample.ts';

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

export interface Example {
  readonly itemId: string;
  readonly decidedAtMs: number;
  readonly facts: CoinModelFacts;
  readonly vector: Float32Array | null;
  readonly y: 0 | 1;
  readonly why: 'coined' | 'gold' | 'missed' | 'meme' | 'backtest' | 'not' | 'kept' | 'none';
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
  readonly counts: Readonly<Record<string, number>>;
  readonly l2: number;
  readonly validation: { readonly ap: Readonly<Record<string, number | null>>; readonly threshold: number | null; readonly from: string; readonly to: string };
  readonly test: { readonly from: string; readonly to: string; readonly hours: number; readonly posts: number; readonly ap: number | null };
  readonly threshold: number | null;
  readonly table: readonly TableRow[];
  readonly missed: readonly MissedScore[];
  readonly taughtMissed: readonly MissedScore[];
  readonly current: { readonly id: number; readonly missedCaught: number; readonly junkRise: number | null } | null;
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
    approval: r.approval, conversation: r.conversation, rebroadcast: r.rebroadcast, followers: r.followers, echoes: r.echoes,
  };
}

/** Facts for a post we do not hold: its words, its source, nothing read. */
function bareFacts(itemId: string, text: string, atMs: number): CoinModelFacts {
  return {
    source: itemId.split(':')[0] ?? '', lang: null, text, mediaKinds: [], postedAtMs: null, decidedAtMs: atMs,
    reach: null, reachAtMs: null, ratePerMinute: null, priorRatePerMinute: null, approval: null, conversation: null, rebroadcast: null, followers: null, echoes: null,
  };
}

/** Every example, with its facts as of its decision and its vector. */
export async function loadExamples(db: Db, p: Policy, opts: { readonly since: Date; readonly now: Date; readonly log?: (s: string) => void }): Promise<{ readonly examples: readonly Example[]; readonly counts: Record<string, number>; readonly valFromMs: number; readonly testFromMs: number }> {
  const C = p.judge.coinModel;
  const log = opts.log ?? (() => {});
  const repo = new PgCoinModelRepo(db);
  const vectors = new PgJunkFilterRepo(db);
  const split = loadSplit();
  const heldOut = new Set(split.test.map((t) => t.id));
  const taught = new Set(split.teach.map((t) => t.id));

  const answers = await repo.firstAnswers(opts.since);
  log(`${answers.length} posts answered since ${opts.since.toISOString()}`);
  const coined = await repo.coinedLate({ lateMs: C.lateMs, deployerWindowMs: C.deployerWindowMs, deployerMinPosts: C.deployerMinPosts });
  const owner = await loadJunkLabels(db, p);
  const taps = new Map((await new PgLearningRepo(db).postCalls()).map((t) => [t.itemId, t.verdict] as const));
  const backtest = new Set((JSON.parse(readFileSync(BACKTEST, 'utf8')) as { posts: { id: string }[] }).posts.map((x) => x.id));
  const K = p.learning.seenKept;
  const kept = await new PgOwnerSeenRepo(db).keptIds({ since: opts.since, until: opts.now, keepWindowMs: K.keepWindowMs, now: opts.now });

  const labelOf = (id: string): { y: 0 | 1; why: Example['why'] } => {
    if (taps.get(id) === 'not') return { y: 0, why: 'not' };
    if (taught.has(id)) return { y: 1, why: 'missed' };
    const g = owner.get(id);
    if (g === 'gold') return { y: 1, why: 'gold' };
    if (g === 'meme') return { y: 1, why: 'meme' };
    if (coined.has(id)) return { y: 1, why: 'coined' };
    if (backtest.has(id)) return { y: 1, why: 'backtest' };
    if (g === 'missed') return { y: 1, why: 'missed' };
    if (g === 'not') return { y: 0, why: 'not' };
    if (kept.has(id)) return { y: 1, why: 'kept' };
    return { y: 0, why: 'none' };
  };

  /* The time split, over every post the live judge answered: the newest TEST_SHARE is the test, the
     newest validationShare of the rest the validation. Both windows keep every post (their table
     counts posts an hour); older never-coined posts are kept by hash. */
  const byTime = [...answers].sort((a, b) => a.judgedAt.getTime() - b.judgedAt.getTime());
  const first = byTime[0]?.judgedAt.getTime() ?? opts.now.getTime();
  const testFromMs = first + (opts.now.getTime() - first) * (1 - TEST_SHARE);
  const valFromMs = first + (testFromMs - first) * (1 - C.validationShare);
  const keep = byTime.filter((a) => heldOut.has(a.itemId) || labelOf(a.itemId).why !== 'none' || a.judgedAt.getTime() >= valFromMs || hashShare(a.itemId) < C.negativeShare);
  const liveIds = new Set(keep.map((a) => a.itemId));

  /* The rest: labelled posts outside the answers (missed posts, gold, backtest), each as of when we first saw it. */
  const others = [...new Set([...owner.keys(), ...backtest, ...heldOut, ...taught])].filter((id) => !liveIds.has(id) && (heldOut.has(id) || labelOf(id).y === 1));
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
    const label = heldOut.has(id) ? { y: 1 as const, why: 'missed' as const } : labelOf(id);
    const fx = f !== undefined ? factsOf(f) : v !== undefined ? bareFacts(id, v.text, opts.now.getTime()) : null;
    if (fx === null) continue;
    examples.push({ itemId: id, decidedAtMs: fx.decidedAtMs, facts: fx, vector: v !== undefined && v.values.length > 0 ? v.values : null, y: label.y, why: label.why, live: liveIds.has(id), answer: answerOf.get(id) ?? null });
  }
  const counts: Record<string, number> = { answered: answers.length, kept: examples.length, withVector: examples.filter((e) => e.vector !== null).length };
  for (const e of examples) counts[e.why] = (counts[e.why] ?? 0) + 1;
  counts['coinedAnswered'] = answers.filter((a) => coined.has(a.itemId) && taps.get(a.itemId) !== 'not').length;
  return { examples, counts, valFromMs, testFromMs };
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

function designOf(train: readonly Example[], p: Policy): Design {
  const sources = [...new Set(train.map((e) => e.facts.source))].sort();
  const langCount = new Map<string, number>();
  for (const e of train) if (e.facts.lang !== null) langCount.set(e.facts.lang, (langCount.get(e.facts.lang) ?? 0) + 1);
  const langs = [...langCount.entries()].filter(([, n]) => n >= MIN_LANG_POSTS).map(([l]) => l).sort();
  const feats = train.map((e) => ({ ...coinModelFeatures(e.facts, sources, langs, p), no_vector: e.vector === null ? 1 : 0 }));
  const names = Object.keys(feats[0] ?? {}).sort();
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

/** The label every measurement reads: coined or labelled; a soft yes is taught, never counted as caught. */
const measuredY = (e: Example): 0 | 1 => (e.why === 'kept' ? 0 : e.y);

/** Fits on `xs`, never-coined posts kept by hash (`negativeShare`) and every labelled one. */
function fitOn(xs: readonly Example[], l2: number, p: Policy): { readonly d: Design; readonly f: LogisticFit; readonly score: (e: Example) => number } {
  const train = xs.filter((e) => e.why !== 'none' || hashShare(e.itemId) < p.judge.coinModel.negativeShare);
  const d = designOf(train, p);
  const f = fitLogistic(train.map((e) => rowOf(e, d, p)), l2);
  return { d, f, score: (e) => scoreRow(rowOf(e, d, p).x, f) };
}

const asStored = (d: Design, f: LogisticFit): Omit<CoinModelFit, 'id' | 'threshold'> => ({
  space: POST_SPACE, intercept: f.intercept, names: d.names, means: d.means, spreads: d.spreads,
  weights: f.weights.slice(0, d.names.length), vectorWeights: f.weights.slice(d.names.length),
});

/* ── the table's posts ────────────────────────────────────────────────────────────────────────── */

async function tablePosts(db: Db, p: Policy, posts: readonly Example[], score: (e: Example) => number, nowMs: number): Promise<TablePost[]> {
  const repo = new PgCoinModelRepo(db);
  const ids = posts.map((e) => e.itemId);
  const shown = new Map<string, Date>();
  const readings = new Map<string, readonly { atMs: number; reach: number | null }[]>();
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
    const inAge = (readings.get(e.itemId) ?? []).filter((r) => posted === null || r.atMs <= Math.min(nowMs, posted + p.rising.fypMaxAgeMs));
    const tap = taps.get(e.itemId);
    const o = old.get(e.itemId);
    const ol = o === undefined ? { label: null } : oldLabel({ haiku: o.a, gemma: o.b }, p);
    const junk = tap === 'not' ? true : tap === 'meme' ? false : ol.label === 'not' ? true : ol.label === 'meme' ? false : null;
    return {
      itemId: e.itemId,
      score: score(e),
      coined: measuredY(e) === 1 && e.why !== 'not',
      shown: shown.has(e.itemId),
      judgeNo: e.answer !== null && !e.answer.newestCoinable,
      gates: tap !== 'not' && clearsReachBar('fyp', inAge, posted, p, scale),
      junk,
      tappedNot: tap === 'not',
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

export async function refitCoinModel(db: Db, opts: { readonly record: boolean; readonly now?: Date; readonly policy?: Policy; readonly since?: Date; readonly log?: (s: string) => void }): Promise<CoinModelRefit> {
  const p = opts.policy ?? DEFAULT_POLICY;
  const C = p.judge.coinModel;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const since = opts.since ?? new Date(now.getTime() - 14 * 86_400_000);
  const { examples, counts, valFromMs: valFrom, testFromMs: testFrom } = await loadExamples(db, p, { since, now, log });
  const split = loadSplit();
  const heldOut = new Set(split.test.map((t) => t.id));

  const live = examples.filter((e) => e.live && !heldOut.has(e.itemId)).sort((a, b) => a.decidedAtMs - b.decidedAtMs);
  const taughtOnly = examples.filter((e) => !e.live && !heldOut.has(e.itemId));
  const trainAll = [...live.filter((e) => e.decidedAtMs < testFrom), ...taughtOnly];
  const trainA = trainAll.filter((e) => !e.live || e.decidedAtMs < valFrom);
  const val = live.filter((e) => e.decidedAtMs >= valFrom && e.decidedAtMs < testFrom);
  const test = live.filter((e) => e.decidedAtMs >= testFrom);
  const valHours = (testFrom - valFrom) / MS_PER_HOUR;
  const testHours = (now.getTime() - testFrom) / MS_PER_HOUR;
  log(`train A ${trainA.length}, validation ${val.length}, test ${test.length}`);

  /* The ridge, by average precision on validation; the threshold, by the owner's bars on validation. */
  const ap: Record<string, number | null> = {};
  let best: { l2: number; ap: number; fit: ReturnType<typeof fitOn> } | null = null;
  for (const l2 of C.l2s) {
    const fit = fitOn(trainA, l2, p);
    const a = averagePrecision(val.map((e) => ({ score: fit.score(e), y: measuredY(e) })));
    ap[String(l2)] = a;
    log(`l2 ${l2}: validation average precision ${a?.toFixed(4)}`);
    if (a !== null && (best === null || a > best.ap)) best = { l2, ap: a, fit };
  }
  const l2 = best?.l2 ?? (C.l2s[0] as number);
  const valPosts = best === null ? [] : await tablePosts(db, p, val, best.fit.score, testFrom);
  const threshold = chooseThreshold(valPosts, THRESHOLDS, valHours, C.maxJunkRise, C.maxExtrasPerHour);

  /* Fit B: all the training time. The table on the test. */
  const fitB = fitOn(trainAll, l2, p);
  const testPosts = await tablePosts(db, p, test, fitB.score, now.getTime());
  const grid = [...new Set([...THRESHOLDS, ...(threshold === null ? [] : [threshold])])].sort((a, b) => a - b);
  const table = grid.map((t) => tableRow(testPosts, t, testHours));
  const testAp = averagePrecision(testPosts.map((t) => ({ score: t.score, y: t.coined ? 1 : 0 })));

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
  const fitC = fitOn([...live, ...taughtOnly], l2, p);
  const stored = asStored(fitC.d, fitC.f);

  /* The gate against the applied fit, on the same test posts and held-out missed posts. */
  const repo = new PgCoinModelRepo(db);
  const applied = await repo.latestApplied();
  let current: CoinModelRefit['current'] = null;
  const atNew = threshold === null ? null : tableRow(testPosts, threshold, testHours);
  const newCaught = threshold === null ? 0 : missed.filter((m) => m.score >= threshold).length;
  if (applied !== null) {
    const scoreCur = (e: Example): number => scoreApplied(applied, e, p);
    const cur = await tablePosts(db, p, test, scoreCur, now.getTime());
    const curMissed = missedOf(split.test, scoreCur);
    current = { id: applied.id, missedCaught: curMissed.filter((m) => m.score >= applied.threshold).length, junkRise: tableRow(cur, applied.threshold, testHours).junkRise };
  }
  let why: string | null = null;
  if (threshold === null) why = `no threshold keeps junk within ${C.maxJunkRise * 100} points and extras at or under ${C.maxExtrasPerHour} an hour on validation`;
  else if (current !== null && !(newCaught > current.missedCaught && (atNew?.junkRise ?? 0) <= (current.junkRise ?? 0))) {
    why = `catches ${newCaught} held-out missed posts with junk ${pts(atNew?.junkRise ?? null)}; the applied fit ${current.id} catches ${current.missedCaught} with ${pts(current.junkRise)}: kept the applied one`;
  }
  let id: number | null = null;
  if (opts.record) {
    id = await repo.record({
      fittedAt: now, ...stored, threshold, fitN: trainAll.length + test.length,
      heldOut: { l2, ap, testAp, counts, validation: { from: new Date(valFrom).toISOString(), to: new Date(testFrom).toISOString(), threshold }, test: { from: new Date(testFrom).toISOString(), hours: testHours, posts: test.length }, table, missed, taughtMissed, current },
      applied: why === null,
      why,
    });
    if (id === null) why = `not recorded: internal.coin_model (0096) is not migrated yet${why === null ? '' : `; ${why}`}`;
  }
  const weightsByName = stored.names.map((name, i) => ({ name, weight: stored.weights[i] as number })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return {
    counts, l2,
    validation: { ap, threshold, from: new Date(valFrom).toISOString(), to: new Date(testFrom).toISOString() },
    test: { from: new Date(testFrom).toISOString(), to: now.toISOString(), hours: testHours, posts: test.length, ap: testAp },
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
 * The shadow's report: every post the runner scored since `since`, the ones it would have added,
 * whether each clears For You's other gates now (the reach bar inside the age bar, no owner Not a
 * meme), which got coined, and junk among them by the owner's tap or the old judges' labels.
 */
export async function shadowReport(db: Db, p: Policy, since: Date, now: Date): Promise<string> {
  const repo = new PgCoinModelRepo(db);
  const scores = await repo.scoresSince(since);
  const would = scores.filter((s) => s.wouldAdd);
  const ids = would.map((s) => s.itemId);
  const coined = await repo.coinedLate({ lateMs: p.judge.coinModel.lateMs, deployerWindowMs: p.judge.coinModel.deployerWindowMs, deployerMinPosts: p.judge.coinModel.deployerMinPosts });
  const readings = await repo.reachReadings(ids);
  const old = await repo.oldAnswers(ids, [HAIKU_JUDGE, GEMMA_JUDGE]);
  const taps = new Map((await new PgLearningRepo(db).postCalls()).map((t) => [t.itemId, t.verdict] as const));
  const items = new Map((ids.length === 0 ? [] : await db.query<{ item_id: string; source: string; posted_at: Date | null; body: string | null }>(`select item_id, source, posted_at, body from public.item where item_id = any($1::text[])`, [ids])).map((r) => [r.item_id, r] as const));
  const allCoined = scores.filter((s) => coined.has(s.itemId)).length;
  const lines: string[] = [];
  let gated = 0, gatedCoined = 0, junk = 0, labelled = 0;
  for (const s of would) {
    const it = items.get(s.itemId);
    const posted = it?.posted_at?.getTime() ?? null;
    const scale = it?.source === SHORT_VIDEO_SOURCE ? p.rising.shortVideoReachScale : 1;
    const inAge = (readings.get(s.itemId) ?? []).filter((r) => posted === null || r.atMs <= Math.min(now.getTime(), posted + p.rising.fypMaxAgeMs));
    const gates = taps.get(s.itemId) !== 'not' && clearsReachBar('fyp', inAge, posted, p, scale);
    const o = old.get(s.itemId);
    const ol = o === undefined ? { label: null } : oldLabel({ haiku: o.a, gemma: o.b }, p);
    const j = taps.get(s.itemId) === 'not' ? true : ol.label === 'not' ? true : ol.label === 'meme' ? false : null;
    if (gates) {
      gated += 1;
      if (coined.has(s.itemId)) gatedCoined += 1;
      if (j !== null) {
        labelled += 1;
        if (j) junk += 1;
      }
    }
    lines.push(`| ${s.itemId} | ${s.probability.toFixed(3)} | ${gates ? 'yes' : 'no'} | ${coined.has(s.itemId) ? 'yes' : '-'} | ${j === null ? '-' : j ? 'junk' : 'meme'} | ${(it?.body ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 70)} |`);
  }
  const hours = (now.getTime() - since.getTime()) / MS_PER_HOUR;
  return [
    `Shadow since ${since.toISOString()} (${hours.toFixed(1)} h): ${scores.length} posts the judge said no to were scored; ${allCoined} of them were coined since.`,
    `It would have added ${would.length} at its threshold; ${gated} of those clear For You's other gates (${(gated / Math.max(hours, 1e-9)).toFixed(2)} an hour), ${gatedCoined} of them coined, junk ${junk} of ${labelled} labelled.`,
    '', '| post | score | other gates | coined | old label | words |', '|---|---|---|---|---|---|', ...lines,
  ].join('\n');
}

const pts = (x: number | null): string => (x === null ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)} pts`);

/**
 * The re-tune's one call: refit, record, and say what to put in the log and the owner's alert.
 * Never throws — the coin model failing must not fail the judge's re-tune.
 */
export async function refitCoinModelForRetune(url: string | undefined, opts: { readonly record: boolean }): Promise<{ readonly log: Record<string, unknown>; readonly facts: Record<string, unknown> }> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-coin-model' });
  try {
    const r = await refitCoinModel(asDb(pool), { record: opts.record });
    const at = r.threshold === null ? null : r.table.find((t) => t.threshold === r.threshold) ?? null;
    const caught = r.threshold === null ? null : r.missed.filter((m) => m.score >= (r.threshold as number)).length;
    return {
      log: { applied: r.applied, why: r.why, id: r.id, l2: r.l2, threshold: r.threshold, heldOutMissedCaught: caught, extrasPerHour: at?.extrasPerHour ?? null, junkRise: at?.junkRise ?? null },
      facts: { coinModelApplied: r.applied, coinModelWhy: r.why, coinModelThreshold: r.threshold, coinModelMissedCaught: caught, coinModelMissedN: r.missed.length },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { log: { failed: err }, facts: { coinModelApplied: false, coinModelWhy: `the coin model could not be fitted: ${err.slice(0, 200)}` } };
  } finally {
    await pool.end();
  }
}
