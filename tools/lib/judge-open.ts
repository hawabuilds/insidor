/**
 * GRADING ANY JUDGE AS THE LIVE FEED GRADES IT, AND THE ARITHMETIC OF THE OPEN-MODEL TEST — the
 * part of tools/judge-open-eval.ts that needs no database, no key and no network, so it can be
 * proven with fake judges (tools/lib/judge-open.test.ts) before a cent is spent.
 *
 * ★ ONE GRADING FOR EVERY JUDGE. The live judge (re-asked through its own port) and each open model
 * (through the same port shape) grade the same posts with the same precedents, the same picture
 * similarity and the same crypto signal — computed ONCE per post by the caller and handed in — so
 * the only thing that differs between two rows is the model. As live, and as tools/lib/pass-rates.ts:
 * ten posts a call in a fixed order mixed by a hash of the id, an unanswered post asked once more,
 * the first question held to core's `postScore` with the picture boost, a pass that is very close to
 * a "not a meme" label held as NOT_MEME_MATCH, the kind question asked only of the posts the first
 * passes, and "on For You" decided by the re-tune's own `inFeed` (eval/src/feed/examples.ts).
 *
 * ★ AN UNANSWERED POST IS OUT OF EVERY RATE, as in the re-tune, and counted beside it: a model that
 * cannot answer is not a model that said no, and the table shows how often it happened.
 *
 * ★ THE OWNER'S RULE FOR SWITCHING, EXACTLY (2026-10-15): an open model is recommended only if on
 * hand gold, live non-memes and missed posts it matches or beats the live judge — at least the same
 * share caught, at most the same share let through, at least the same share of missed caught — AND
 * it costs less a day. Nothing else is weighed in the verdict; speed and agreement are reported.
 *
 * What breaks if changed carelessly: `grade` must keep asking exactly as live asks. Grading one
 * judge with precedents and another without, or at another batch size, measures the difference in
 * setup, not in model.
 */

import { createHash } from 'node:crypto';

import type { Policy } from '../../contracts/src/policy.ts';
import { storyId } from '../../contracts/src/ids.ts';
import type { Budget } from '../../contracts/src/ports/meter.ts';
import type { JudgeOutcome, JudgePort, JudgePrecedent, JudgeSubject } from '../../contracts/src/ports/judge.ts';
import type { MediaRef } from '../../contracts/src/vocabulary.ts';
import { NOT_MEME_MATCH } from '../../core/src/qualify/kinds.ts';
import { heldAsNotMeme } from '../../core/src/qualify/precedents.ts';
import { postScore } from '../../core/src/qualify/post-score.ts';
import { inFeed } from '../../eval/src/feed/examples.ts';
import type { JudgeClient } from '../../adapters/judge/anthropic/src/index.ts';

export type Group = 'gold' | 'missed' | 'live-not' | 'fyp';

export interface OpenEvalPost {
  readonly group: Group;
  readonly id: string;
  readonly text: string;
  /** What the judge is shown, as live holds it: a still picture, or the post's own media. */
  readonly media: readonly MediaRef[];
}

/** What every judge is given alongside a post, worked out once. */
export interface Near {
  readonly precedents: readonly JudgePrecedent[];
  /** Closeness to the nearest "not a meme" label; null when it could not be told. */
  readonly closestNot: number | null;
  /** The picture boost's input; null without one. */
  readonly similarity: number | null;
}

export interface Signal {
  readonly others: boolean;
  readonly shill: boolean;
}

export interface Row {
  readonly id: string;
  readonly group: Group;
  readonly coinable: boolean | null;
  readonly confidence: number | null;
  readonly lookedAt: string | null;
  readonly name: string | null;
  readonly firstPass: boolean;
  readonly kind: string | null;
  /** On For You by the re-tune's rule; null when the judge did not answer. */
  readonly onFeed: boolean | null;
}

/** One judge call: how many posts it carried and how long the model took to answer. */
export interface Timing {
  readonly posts: number;
  readonly ms: number;
}

export interface GradeContext {
  readonly policy: Policy;
  readonly near: ReadonlyMap<string, Near>;
  readonly signals: ReadonlyMap<string, Signal>;
  readonly maxBatch: number;
  readonly budget: () => Budget;
}

/** The subject one post is asked as: the live scorer's shape, with its precedents. */
export function subjectOf(p: OpenEvalPost, ctx: Pick<GradeContext, 'policy' | 'near'>): JudgeSubject {
  const text = p.text.trim().slice(0, ctx.policy.judge.maxCharsPerText);
  const precedents = ctx.near.get(p.id)?.precedents ?? [];
  return {
    storyId: storyId(`rate-${p.id.replaceAll(':', '-').replaceAll('|', '-')}`),
    texts: text === '' ? [] : [text],
    media: p.media,
    distinctAuthors: 1,
    distinctSources: 1,
    ...(precedents.length === 0 ? {} : { precedents }),
  };
}

/** The client with every model call timed: the model's own answer time, not the picture reads before it. */
export function timedClient<C extends JudgeClient>(client: C, sink: Timing[], clock: () => number = () => performance.now()): C {
  return {
    ...client,
    async judge(request) {
      const t = clock();
      const reply = await client.judge(request);
      sink.push({ posts: request.subjects.length, ms: clock() - t });
      return reply;
    },
  };
}

/** Graded in a fixed mixed order (a hash of the id), as the re-tune grades. */
const mixedOrder = (posts: readonly OpenEvalPost[]): number[] =>
  posts.map((p, i) => ({ i, h: createHash('sha256').update(p.id).digest('hex') })).sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i)).map((x) => x.i);

async function ask(port: JudgePort, subjects: readonly JudgeSubject[], maxBatch: number, budget: () => Budget): Promise<JudgeOutcome[]> {
  const out: JudgeOutcome[] = [];
  for (let k = 0; k < subjects.length; k += maxBatch) out.push(...(await port.judge(subjects.slice(k, k + maxBatch), budget())).value);
  return out;
}

/**
 * Every post through the first question, the unanswered asked once more, then the kind question
 * for the posts the first passes; each row as the feed would file it. A refusal for money
 * (BudgetRefused) is not caught: the caller stops there and says how far it got.
 */
export async function grade(posts: readonly OpenEvalPost[], ports: { readonly post: JudgePort; readonly kind: JudgePort }, ctx: GradeContext): Promise<Row[]> {
  const P = ctx.policy;
  const order = mixedOrder(posts);
  const first = await ask(ports.post, order.map((i) => subjectOf(posts[i]!, ctx)), ctx.maxBatch, ctx.budget);
  const outcomeOf = new Map(order.map((i, k) => [i, first[k]]));
  const again = order.filter((i) => outcomeOf.get(i)?.kind !== 'judged');
  if (again.length > 0) {
    const retried = await ask(ports.post, again.map((i) => subjectOf(posts[i]!, ctx)), ctx.maxBatch, ctx.budget);
    again.forEach((i, k) => {
      if (retried[k]?.kind === 'judged') outcomeOf.set(i, retried[k]);
    });
  }
  const rows: Row[] = posts.map((p, i) => {
    const o = outcomeOf.get(i);
    const j = o?.kind === 'judged' ? o.judgement : null;
    return fileRow(p, j === null ? null : { coinable: j.coinable, confidence: j.confidence, lookedAt: j.lookedAt, proposedName: j.proposedName }, null, ctx);
  });
  const askKind = order.filter((i) => rows[i]!.firstPass && rows[i]!.kind === null);
  const kinds = await ask(ports.kind, askKind.map((i) => subjectOf(posts[i]!, ctx)), ctx.maxBatch, ctx.budget);
  askKind.forEach((i, k) => {
    const o = kinds[k];
    const label = o?.kind === 'judged' ? (o.judgement.proposedName ?? '').trim().toUpperCase() : '';
    if (label !== '') rows[i] = withKind(rows[i]!, label, ctx);
  });
  return rows;
}

type Answer = { readonly coinable: boolean; readonly confidence: number; readonly lookedAt: 'text' | 'picture' | 'videoFrame'; readonly proposedName: string | null };

const withKind = (r: Row, kind: string | null, ctx: Pick<GradeContext, 'policy' | 'signals'>): Row => ({
  ...r,
  kind,
  onFeed: r.coinable === null ? null : inFeed({ id: r.id, group: r.group, coinable: r.coinable, firstPass: r.firstPass, kind, signal: ctx.signals.get(r.id) ?? null }, ctx.policy.judge.heldKinds),
});

/**
 * One post's answer filed as the feed files it: the first question against core's bar with the
 * picture boost, held as NOT_MEME_MATCH when very close to a "not a meme" label, else the kind
 * given (a stored kind answer, or none yet). Used for asked answers and stored live ones alike.
 */
export function fileRow(p: Pick<OpenEvalPost, 'id' | 'group'>, answer: Answer | null, kind: string | null, ctx: Pick<GradeContext, 'policy' | 'near' | 'signals'>): Row {
  const near = ctx.near.get(p.id);
  const firstPass = answer !== null && postScore(answer, ctx.policy, near?.similarity ?? null) === 'passes';
  const notMatch = firstPass && heldAsNotMeme(near?.closestNot ?? null, ctx.policy);
  const label = notMatch ? NOT_MEME_MATCH : kind;
  const row: Row = { id: p.id, group: p.group, coinable: answer?.coinable ?? null, confidence: answer?.confidence ?? null, lookedAt: answer?.lookedAt ?? null, name: answer?.proposedName ?? null, firstPass, kind: label, onFeed: null };
  return answer === null ? row : withKind(row, label, ctx);
}

/* ── the numbers ──────────────────────────────────────────────────────────────────────────────── */

export interface Rate {
  readonly passed: number;
  readonly tested: number;
  readonly unanswered: number;
}

export interface SetRates {
  /** Hand gold as the re-tune counts it: the gold posts and the owner's missed posts. */
  readonly hand: Rate;
  readonly negatives: Rate;
  readonly missed: Rate;
}

const rateOf = (rows: readonly Row[], groups: readonly Group[]): Rate => {
  const of = rows.filter((r) => groups.includes(r.group));
  const answered = of.filter((r) => r.onFeed !== null);
  return { passed: answered.filter((r) => r.onFeed === true).length, tested: answered.length, unanswered: of.length - answered.length };
};

export const setRates = (rows: readonly Row[]): SetRates => ({ hand: rateOf(rows, ['gold', 'missed']), negatives: rateOf(rows, ['live-not']), missed: rateOf(rows, ['missed']) });

export const share = (r: Rate): number | null => (r.tested === 0 ? null : r.passed / r.tested);

/** Seconds per post for each call (the call's time over the posts it carried): median and 90th percentile. */
export function speed(timings: readonly Timing[]): { readonly median: number | null; readonly p90: number | null; readonly calls: number } {
  const per = timings.filter((t) => t.posts > 0).map((t) => t.ms / 1000 / t.posts).sort((a, b) => a - b);
  const at = (q: number): number | null => (per.length === 0 ? null : per[Math.min(per.length - 1, Math.ceil(q * per.length) - 1)] ?? null);
  return { median: at(0.5), p90: at(0.9), calls: per.length };
}

/**
 * ★ THE OWNER'S RULE, AND NOTHING ELSE: matches or beats the live judge on all three sets AND costs
 * less a day. A set either side could not measure (nothing answered) cannot be matched, so it fails.
 */
export function recommend(candidate: SetRates, live: SetRates, candidateUsdPerDay: number | null, liveUsdPerDay: number | null): { readonly switch: boolean; readonly why: readonly string[] } {
  const why: string[] = [];
  const cmp = (name: string, a: Rate, b: Rate, better: 'higher' | 'lower') => {
    const x = share(a);
    const y = share(b);
    if (x === null || y === null) return why.push(`${name}: not measured on both sides`);
    if (better === 'higher' ? x < y : x > y) why.push(`${name}: ${pct(x)} against the live judge's ${pct(y)}`);
    return undefined;
  };
  cmp('hand gold caught', candidate.hand, live.hand, 'higher');
  cmp('live non-memes let through', candidate.negatives, live.negatives, 'lower');
  cmp('missed posts caught', candidate.missed, live.missed, 'higher');
  if (candidateUsdPerDay === null || liveUsdPerDay === null) why.push('cost a day: not measured on both sides');
  else if (!(candidateUsdPerDay < liveUsdPerDay)) why.push(`cost a day: $${candidateUsdPerDay.toFixed(2)} is not less than $${liveUsdPerDay.toFixed(2)}`);
  return { switch: why.length === 0, why };
}

export const pct = (x: number | null): string => (x === null ? '-' : `${Math.round(x * 100)}%`);
export const ofN = (r: Rate): string => `${r.passed}/${r.tested}${r.unanswered > 0 ? ` (+${r.unanswered} unanswered)` : ''}`;

/* ── the cheap first pass ─────────────────────────────────────────────────────────────────────── */

export type Band = readonly [number, number];

/**
 * The open model decides every post whose confidence is outside the band; a post inside it — or one
 * the open model did not answer — is decided by the live judge's answer instead. `handed` is how
 * many went to the live judge: what the blend pays it for.
 */
export function blend(open: readonly Row[], live: ReadonlyMap<string, Row>, band: Band): { readonly rows: readonly Row[]; readonly handed: number; readonly total: number } {
  let handed = 0;
  const rows = open.map((r) => {
    const borderline = r.confidence === null || (r.confidence >= band[0] && r.confidence <= band[1]);
    if (!borderline) return r;
    handed += 1;
    return live.get(r.id) ?? { ...r, coinable: null, onFeed: null };
  });
  return { rows, handed, total: open.length };
}

/** Bands tried for the first pass; the bar sits at 0.70–0.75, so each spans it. */
export const BANDS: readonly Band[] = [0.3, 0.4, 0.45, 0.5, 0.55, 0.6].flatMap((lo) => [0.8, 0.85, 0.9, 0.95, 1].map((hi) => [lo, hi] as const));

/**
 * The band chosen from the data: the one that hands the fewest posts to the live judge among those
 * whose blend matches or beats it on all three sets; when none does, the one with the most hand gold
 * caught less live non-memes let through. Says which case it is.
 */
export function chooseBand(open: readonly Row[], live: ReadonlyMap<string, Row>, liveRates: SetRates, bands: readonly Band[] = BANDS): { readonly band: Band; readonly matches: boolean } {
  let best: { band: Band; handed: number } | null = null;
  let fallback: { band: Band; score: number } | null = null;
  for (const band of bands) {
    const b = blend(open, live, band);
    const r = setRates(b.rows);
    if (recommend(r, liveRates, 0, 1).switch) {
      if (best === null || b.handed < best.handed) best = { band, handed: b.handed };
    }
    const score = (share(r.hand) ?? 0) - (share(r.negatives) ?? 0);
    if (fallback === null || score > fallback.score) fallback = { band, score };
  }
  return best !== null ? { band: best.band, matches: true } : { band: fallback?.band ?? [0.45, 0.85], matches: false };
}

/* ── agreement on what For You showed ─────────────────────────────────────────────────────────── */

export function agreement(rows: readonly Row[], live: ReadonlyMap<string, Row>): { readonly coinable: { same: number; of: number }; readonly onFeed: { same: number; of: number }; readonly liveShown: number; readonly alsoShown: number } {
  let cs = 0, co = 0, fs = 0, fo = 0, shown = 0, also = 0;
  for (const r of rows) {
    const l = live.get(r.id);
    if (l === undefined) continue;
    if (r.coinable !== null && l.coinable !== null) { co += 1; if (r.coinable === l.coinable) cs += 1; }
    if (r.onFeed !== null && l.onFeed !== null) { fo += 1; if (r.onFeed === l.onFeed) fs += 1; }
    if (l.onFeed === true && r.onFeed !== null) { shown += 1; if (r.onFeed) also += 1; }
  }
  return { coinable: { same: cs, of: co }, onFeed: { same: fs, of: fo }, liveShown: shown, alsoShown: also };
}
