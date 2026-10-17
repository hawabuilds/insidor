/**
 * THE SHADOW'S NUMBERS, WITHOUT A DATABASE: how often the two feed judges agree, where they do
 * not, and what each costs and takes a post — the arithmetic of tools/judge-shadow-report.ts, kept
 * apart so it is tested (tools/lib/judge-shadow.test.ts) on fixed rows.
 *
 * ★ EACH ANSWER IS HELD TO ITS OWN MODEL'S CUTOFF, as the projector holds it (services/project
 * judge-cutoff.ts): the main judge's to the applied block's cutoff, each open model's to its own
 * (Policy.judge.cutoffs, the block's once tuned on it). "Yes" is core's `postScoreReason` passing on
 * the first question: confident enough, a short name. The picture boost, the kind question and the
 * close-match hold are left out — the same rules for both models, applied after.
 *
 * ★ A ROW WITHOUT A SHADOW ANSWER IS OUT OF THE AGREEMENT, and counted beside it: an outage is not
 * a "no".
 *
 * What breaks if changed carelessly: deciding which side is which by live/shadow rather than by
 * judge id. After the switch the live side is the open model, and "main yes, open no" would flip.
 */

import type { Policy } from '../../contracts/src/policy.ts';
import { postScoreReason } from '../../core/src/qualify/post-score.ts';
import { isOpenJudgeId } from '../../adapters/judge/openai-compatible/src/setup.ts';
import { policyForAnswer, type AnswerPolicies } from '../../services/project/src/judge-cutoff.ts';

export interface Side {
  readonly judgeId: string;
  readonly coinable: boolean;
  readonly confidence: number;
  readonly lookedAt: 'text' | 'picture' | 'videoFrame';
  readonly name: string | null;
  readonly costUsd: number;
  readonly sPerPost: number | null;
}

export interface ShadowRow {
  readonly itemId: string;
  readonly askedAt: Date;
  readonly text: string;
  readonly link: string;
  readonly live: Side;
  /** null: the shadow gave no answer (`detail` says why). */
  readonly shadow: Side | null;
  readonly shadowCostUsd: number;
  readonly detail: string | null;
}

export interface Pair {
  readonly row: ShadowRow;
  readonly main: Side;
  readonly open: Side;
  readonly mainYes: boolean;
  readonly openYes: boolean;
}

export interface ModelNumbers {
  readonly answers: number;
  readonly usd: number;
  readonly usdPerPost: number | null;
  readonly medianSPerPost: number | null;
  readonly p90SPerPost: number | null;
}

export interface ShadowSummary {
  readonly rows: number;
  readonly pairs: number;
  readonly unanswered: number;
  /** Same yes/no at each model's own cutoff. */
  readonly agree: number;
  readonly table: { readonly bothYes: number; readonly mainYesOpenNo: number; readonly mainNoOpenYes: number; readonly bothNo: number };
  /** Same raw coinable answer, before any cutoff. */
  readonly coinableAgree: number;
  readonly main: ModelNumbers;
  readonly open: ModelNumbers;
  readonly mainYesOpenNo: readonly Pair[];
  readonly mainNoOpenYes: readonly Pair[];
}

const yes = (s: Side, policies: AnswerPolicies): boolean =>
  postScoreReason({ coinable: s.coinable, confidence: s.confidence, lookedAt: s.lookedAt, proposedName: s.name }, policyForAnswer(s.judgeId, policies)) === 'passes';

const quantile = (xs: readonly number[], q: number): number | null => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : (s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? null);
};

const numbers = (sides: readonly { readonly side: Side; readonly cost: number }[]): ModelNumbers => {
  const usd = sides.reduce((t, x) => t + x.cost, 0);
  const speeds = sides.flatMap((x) => (x.side.sPerPost === null ? [] : [x.side.sPerPost]));
  return { answers: sides.length, usd, usdPerPost: sides.length === 0 ? null : usd / sides.length, medianSPerPost: quantile(speeds, 0.5), p90SPerPost: quantile(speeds, 0.9) };
};

/** The window's agreement, confusion table, cost and speed per model, and up to `examples` disagreements each way, newest first. */
export function summarise(rows: readonly ShadowRow[], policies: AnswerPolicies, examples: number): ShadowSummary {
  const pairs: Pair[] = [];
  const mainSides: { side: Side; cost: number }[] = [];
  const openSides: { side: Side; cost: number }[] = [];
  for (const row of rows) {
    const live = { side: row.live, cost: row.live.costUsd };
    (isOpenJudgeId(row.live.judgeId) ? openSides : mainSides).push(live);
    if (row.shadow === null) continue;
    const shadow = { side: row.shadow, cost: row.shadowCostUsd };
    (isOpenJudgeId(row.shadow.judgeId) ? openSides : mainSides).push(shadow);
    const liveOpen = isOpenJudgeId(row.live.judgeId);
    if (liveOpen === isOpenJudgeId(row.shadow.judgeId)) continue;
    const main = liveOpen ? row.shadow : row.live;
    const open = liveOpen ? row.live : row.shadow;
    pairs.push({ row, main, open, mainYes: yes(main, policies), openYes: yes(open, policies) });
  }
  const count = (f: (p: Pair) => boolean) => pairs.filter(f).length;
  const newest = (xs: Pair[]) => xs.sort((a, b) => b.row.askedAt.getTime() - a.row.askedAt.getTime()).slice(0, examples);
  return {
    rows: rows.length,
    pairs: pairs.length,
    unanswered: rows.filter((r) => r.shadow === null).length,
    agree: count((p) => p.mainYes === p.openYes),
    table: {
      bothYes: count((p) => p.mainYes && p.openYes),
      mainYesOpenNo: count((p) => p.mainYes && !p.openYes),
      mainNoOpenYes: count((p) => !p.mainYes && p.openYes),
      bothNo: count((p) => !p.mainYes && !p.openYes),
    },
    coinableAgree: count((p) => p.main.coinable === p.open.coinable),
    main: numbers(mainSides),
    open: numbers(openSides),
    mainYesOpenNo: newest(pairs.filter((p) => p.mainYes && !p.openYes)),
    mainNoOpenYes: newest(pairs.filter((p) => !p.mainYes && p.openYes)),
  };
}

/** A post's address from its source and its id there; the stored id when the source has no known form. */
export function postLink(source: string, sourceItemId: string, handle: string | null, itemId: string): string {
  if (source === 'x') return `https://x.com/i/status/${sourceItemId}`;
  if (source === 'tiktok' && handle !== null) return `https://www.tiktok.com/@${handle}/video/${sourceItemId}`;
  return itemId;
}
