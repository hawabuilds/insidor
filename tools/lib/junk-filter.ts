/**
 * THE JUNK FILTER, FITTED AT EACH RE-TUNE: a logistic regression over each labelled post's
 * words-and-picture vector that says how sure it is a post is junk, cross-validated, with the
 * threshold chosen so no held-out hand gold or missed post would be dropped, written to
 * internal.junk_filter (0091). The runner (services/runner work/score-posts.ts) does not ask the
 * post judge about a post the applied fit is that sure of, while Policy.judge.junkFilter.on.
 *
 * Its own module, called from tools/retune.ts by one line beside the order model, because it is a
 * third learner and must not share the judge block's fate: free (every vector is already stored —
 * no paid call), so it runs at every slot, and a failure is logged and never fails the re-tune.
 * `tools/junk-filter.ts` runs it by hand and prints the table.
 *
 * Why not ml/train: Python is run by hand, weekly, and never where the re-tune runs; this fit must
 * be refitted unattended at 08:00 and 20:00. 1,024 weights by Newton's method in TypeScript are
 * exactly reproducible (eval/src/feed/junk-fit.ts).
 *
 * THE LABELS, by group (one per post; the stronger source wins: labels file < coined < gold <
 * missed < the owner's taps):
 *   gold     the gold sheets' origin posts, the owner's hand-gold list, the owner's "this is the
 *            coin" calls, approved recall additions                                 keep, PROTECTED
 *   missed   the owner's missed posts (internal.missed_post, and gold additions from them)
 *                                                                                    keep, PROTECTED
 *   coined   posts people launched coins for late (internal.coin_post_link), self-coining
 *            accounts left out exactly as Policy.learning.coinedYes does                keep, reported
 *   meme     the owner's "meme" taps and the labels file's memes                       keep
 *   not      the owner's "Not a meme" taps and the labels file's non-memes — the re-tune's
 *            "live non-memes"                                                           junk
 * A post with no stored vector is counted and left out: the runner never filters a post it has no
 * vector for, so a label without one teaches nothing the filter will use.
 *
 * ★ APPLIED ONLY WITH A SAFE THRESHOLD. The fit is applied when the held-out test found a threshold
 * under 1 with at least Policy.judge.junkFilter.minProtected protected posts tested; otherwise it
 * is recorded with why, and the runner keeps the last applied one (or none: everything judged).
 *
 * What breaks if changed carelessly: the vectors must stay the runner's own (core `embedInput` in
 * the post space); and `loadJunkLabels` must keep gold and missed out of `not` — a protected post
 * taught as junk is a post the threshold is then measured to drop.
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { POST_SPACE } from '../../adapters/embed/voyage/src/index.ts';
import { asDb, createPool, DB_ROLE, PgLearningRepo, type Db } from '../../store/src/index.ts';
import { PgJunkFilterRepo } from '../../store/src/repo/junk-filter.ts';
import { loadEvidence } from '../../eval/src/gold/coin-evidence.ts';
import { tuning } from '../../eval/src/gold/coin-origins.ts';
import { chooseThreshold, crossJunk, droppedAt, fitJunk, junkScore, JUNK_GROUPS, PROTECTED, type Dropped, type JunkExample, type JunkGroup } from '../../eval/src/feed/junk-fit.ts';
import { handGoldIds } from './pass-rates.ts';

const LABELS = new URL('../../eval/src/feed/live-labels.json', import.meta.url);
/** The thresholds the owner's table lists beside the chosen one. */
export const TABLE_THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99] as const;
/** How far back "today's traffic" reaches for the share skipped. */
const DAY_MS = 86_400_000;

const RANK: Readonly<Record<string, number>> = { labels: 1, coined: 2, gold: 3, missed: 4, tap: 5 };

/* ── the labels ───────────────────────────────────────────────────────────────────────────────── */

export async function loadJunkLabels(db: Db, p: Policy = DEFAULT_POLICY): Promise<ReadonlyMap<string, JunkGroup>> {
  const out = new Map<string, { group: JunkGroup; rank: number }>();
  const put = (itemId: string, group: JunkGroup, from: keyof typeof RANK) => {
    const was = out.get(itemId);
    const rank = RANK[from] as number;
    if (was === undefined || rank >= was.rank) out.set(itemId, { group, rank });
  };
  const soft = async <R,>(read: () => Promise<readonly R[]>): Promise<readonly R[]> => {
    try {
      return await read();
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return [];
      throw e;
    }
  };
  const repo = new PgLearningRepo(db);
  /* The labels file. */
  for (const x of (JSON.parse(readFileSync(LABELS, 'utf8')) as { posts: { itemId: string; label: string; ownerLabel?: string }[] }).posts) {
    const l = x.ownerLabel ?? x.label;
    if (l === 'meme') put(x.itemId, 'meme', 'labels');
    else if (l === 'not') put(x.itemId, 'not', 'labels');
  }
  /* Coined posts, whatever the judge said, self-coiners left out (Policy.learning.coinedYes's bars). */
  const C = p.learning.coinedYes;
  for (const source of ['x', 'tiktok']) {
    for (const c of await soft(() => repo.coinedPosts({ source, minCoins: C.minCoins, lateMs: C.lateMs, deployerWindowMs: C.deployerWindowMs, deployerMinPosts: C.deployerMinPosts, anyAnswer: true }))) put(c.itemId, 'coined', 'coined');
  }
  /* Hand gold, as the re-tune gates it. */
  const listed = handGoldIds();
  const evidence = loadEvidence();
  for (const c of tuning()) {
    const post = evidence.get(c.id)?.origin?.post ?? null;
    if (post !== null) put(`x:${post.postId}`, 'gold', 'gold');
  }
  for (const id of listed) put(id, 'gold', 'gold');
  for (const m of await soft(() => repo.matchCalls())) if (m.verdict === 'right' && m.coinAddress !== null) put(m.itemId, 'gold', 'gold');
  for (const g of await soft(() => repo.goldAdditions())) {
    if (g.source === 'missed') put(g.itemId, 'missed', 'missed');
    else if (listed.has(g.itemId)) put(g.itemId, 'gold', 'gold');
  }
  /* Missed posts. */
  for (const m of await soft(() => db.query<{ item_id: string }>(`select distinct item_id from internal.missed_post where status = 'done' and item_id is not null`))) put(m.item_id, 'missed', 'missed');
  /* The owner's taps, newest per post. */
  for (const t of await soft(() => repo.postCalls())) {
    if (t.verdict === 'meme') put(t.itemId, 'meme', 'tap');
    else if (t.verdict === 'not') put(t.itemId, 'not', 'tap');
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, v]) => [id, v.group] as const));
}

/* ── a refit ──────────────────────────────────────────────────────────────────────────────────── */

export interface ThresholdRow {
  readonly threshold: number;
  readonly dropped: Readonly<Record<JunkGroup, Dropped>>;
  /** Today's judged posts it would not have asked, of those with a vector. */
  readonly traffic: Dropped;
  /** Of those, the ones the live judge answered yes. */
  readonly trafficYes: Dropped;
}

export interface JunkRefit {
  readonly labelled: Readonly<Record<JunkGroup, number>>;
  readonly withVector: Readonly<Record<JunkGroup, number>>;
  readonly fitN: number;
  readonly l2: number;
  readonly threshold: number | null;
  readonly highestProtected: number | null;
  readonly highestProtectedId: string | null;
  readonly table: readonly ThresholdRow[];
  readonly chosen: ThresholdRow | null;
  readonly trafficN: number;
  readonly trafficUsdPerPost: number | null;
  readonly applied: boolean;
  readonly why: string | null;
  readonly id: number | null;
  readonly examples: readonly JunkExample[];
  readonly heldOutScore: ReadonlyMap<string, number>;
}

export async function refitJunk(db: Db, opts: { readonly record: boolean; readonly now?: Date; readonly policy?: Policy; readonly l2?: number }): Promise<JunkRefit> {
  const p = opts.policy ?? DEFAULT_POLICY;
  const J = p.judge.junkFilter;
  const l2 = opts.l2 ?? J.l2;
  const now = opts.now ?? new Date();
  const repo = new PgJunkFilterRepo(db);
  const labels = await loadJunkLabels(db, p);
  const vectors = await repo.vectors([...labels.keys()], POST_SPACE);
  const examples: JunkExample[] = [...labels.entries()].flatMap(([itemId, group]) => {
    const v = vectors.get(itemId);
    return v === undefined || v.values.length === 0 ? [] : [{ itemId, group, text: v.text, values: v.values }];
  });
  const count = (xs: readonly { group: JunkGroup }[]) => Object.fromEntries(JUNK_GROUPS.map((g) => [g, xs.filter((x) => x.group === g).length])) as Record<JunkGroup, number>;
  const labelled = count([...labels.values()].map((group) => ({ group })));
  const withVector = count(examples);

  const heldOutScore = crossJunk(examples, l2, J.folds);
  const pick = chooseThreshold(examples, heldOutScore, J.margin);
  const fit = fitJunk(examples, l2);

  /* Today's traffic, scored by the full fit: what share of posts the judge answered it would skip. */
  const traffic = await repo.judgedSince(new Date(now.getTime() - DAY_MS), POST_SPACE);
  const labelledIds = new Set(labels.keys());
  const unlabelled = traffic.filter((t) => !labelledIds.has(t.itemId));
  const trafficScore = new Map(unlabelled.map((t) => [t.itemId, junkScore(t.values, fit)] as const));
  const rowAt = (threshold: number): ThresholdRow => {
    const over = unlabelled.filter((t) => (trafficScore.get(t.itemId) as number) >= threshold);
    return {
      threshold,
      dropped: droppedAt(examples, heldOutScore, threshold),
      traffic: { dropped: over.length, tested: unlabelled.length },
      trafficYes: { dropped: over.filter((t) => t.coinable).length, tested: unlabelled.filter((t) => t.coinable).length },
    };
  };
  const table = [...new Set([...TABLE_THRESHOLDS, ...(pick.threshold === null ? [] : [pick.threshold])])].sort((a, b) => a - b).map(rowAt);
  const chosen = pick.threshold === null ? null : rowAt(pick.threshold);
  const protectedN = examples.filter((e) => PROTECTED.has(e.group)).length;
  const usd = unlabelled.reduce((a, t) => a + t.costUsd, 0);

  let why: string | null = null;
  if (protectedN < J.minProtected) why = `only ${protectedN} hand gold and missed posts have a vector; at least ${J.minProtected} are needed to test a threshold`;
  else if (pick.threshold === null) why = `no threshold under 1 keeps every held-out hand gold and missed post (the highest scored ${pick.highestProtected?.toFixed(4)})`;
  const apply = why === null;
  let id: number | null = null;
  if (opts.record) {
    id = await repo.record({
      fittedAt: now,
      space: POST_SPACE,
      intercept: fit.intercept,
      weights: fit.weights,
      threshold: pick.threshold,
      fitN: examples.length,
      heldOut: {
        l2, folds: J.folds, margin: J.margin, highestProtected: pick.highestProtected, highestProtectedId: pick.highestProtectedId,
        labelled, withVector, chosen, table, trafficN: unlabelled.length,
      },
      applied: apply,
      why,
    });
    if (id === null) why = `not recorded: internal.junk_filter (0091) is not migrated yet${why === null ? '' : `; ${why}`}`;
  }
  return {
    labelled, withVector, fitN: examples.length, l2, threshold: pick.threshold, highestProtected: pick.highestProtected, highestProtectedId: pick.highestProtectedId,
    table, chosen, trafficN: unlabelled.length, trafficUsdPerPost: unlabelled.length === 0 ? null : usd / unlabelled.length,
    applied: apply && opts.record && id !== null, why, id, examples, heldOutScore,
  };
}

/**
 * The re-tune's one call: refit, record, and say what to put in the log and the owner's alert.
 * Never throws — the junk filter failing must not fail the judge's re-tune.
 */
export async function refitJunkForRetune(url: string | undefined, opts: { readonly record: boolean }): Promise<{ readonly log: Record<string, unknown>; readonly facts: Record<string, unknown> }> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-junk-filter' });
  try {
    const r = await refitJunk(asDb(pool), { record: opts.record });
    const ofN = (x: Dropped) => `${x.dropped}/${x.tested}`;
    const c = r.chosen;
    return {
      log: {
        applied: r.applied, why: r.why, id: r.id, fitN: r.fitN, threshold: r.threshold, withVector: r.withVector,
        ...(c === null ? {} : { gold: ofN(c.dropped.gold), missed: ofN(c.dropped.missed), coined: ofN(c.dropped.coined), meme: ofN(c.dropped.meme), notMeme: ofN(c.dropped.not), traffic: ofN(c.traffic) }),
      },
      facts: {
        junkApplied: r.applied, junkWhy: r.why, junkThreshold: r.threshold,
        junkNotDropped: c?.dropped.not.dropped ?? null, junkNotN: c?.dropped.not.tested ?? null,
        junkCoinedDropped: c?.dropped.coined.dropped ?? null, junkCoinedN: c?.dropped.coined.tested ?? null,
        junkTrafficDropped: c?.traffic.dropped ?? null, junkTrafficN: c?.traffic.tested ?? null,
      },
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { log: { failed: err }, facts: { junkApplied: false, junkWhy: `the junk filter could not be fitted: ${err.slice(0, 200)}` } };
  } finally {
    await pool.end();
  }
}
