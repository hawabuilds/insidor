/**
 * THE NARRATIVE LESSONS FOR THE 08:00 AND 20:00 RE-TUNE (the owner, 2026-10-16: "My narrative
 * buttons are used straight away, and in every re-tune. Report: narratives shown, how many I marked
 * Not a narrative, wrong merges, and story coins right / wrong").
 *
 * "Straight away" is the grouping's own business: the runner and the projector fold every call on
 * their next pass (core group/narrative.ts `foldNarrativeCalls`). What the re-tune adds is the
 * measurement: each call is a label on post PAIRS — "Not a narrative" and "Remove this post" say
 * two posts are not one story, "Merge with…" says they are — and the pairs are held against the
 * bar the grouping links on (Policy.narrative.sameMeaning), so the report says how often the bar
 * agreed with him. The bar is policy: a lesson here is reported, never applied.
 *
 * Its own file because tools/retune.ts is already the longest file in tools/, and this reads only
 * the owner's narrative calls, the narratives table and the post vectors — no judge, no money.
 *
 * What breaks if changed carelessly: a pair with no vector on either side is counted as "no vector",
 * never as unlike: an absence is not a measurement.
 */

import type { Policy } from '../../contracts/src/policy.ts';
import { pairKey } from '../../core/src/index.ts';
import { PgNarrativeRepo, type Db } from '../../store/src/index.ts';

const POST_SPACE = 'multimodal-3.1024.post';

export interface NarrativeLessons {
  /** Narratives first on the board in the window. */
  readonly shown: number;
  readonly notNarrative: number;
  /** "Remove this post": a post the grouping put in a narrative it does not belong to. */
  readonly wrongMerges: number;
  /** "Merge with…": two narratives the grouping kept apart that are one story. */
  readonly missedMerges: number;
  readonly coinRight: number;
  readonly coinWrong: number;
  /** The owner's "not one story" pairs the meaning bar would link, of those with vectors. */
  readonly apartOverBar: { readonly n: number; readonly of: number; readonly noVector: number };
  /** His "one story" pairs the bar would not link, of those with vectors. */
  readonly togetherUnderBar: { readonly n: number; readonly of: number; readonly noVector: number };
  readonly list: readonly string[];
}

export async function narrativeLessons(db: Db, sinceMs: number, policy: Policy): Promise<NarrativeLessons> {
  const repo = new PgNarrativeRepo(db);
  const { shown, calls } = await repo.lessonsSince(sinceMs);
  const apart = new Set<string>();
  const together = new Set<string>();
  for (const c of calls) {
    if (c.verdict === 'not_narrative') for (let i = 0; i < c.members.length; i += 1) for (let j = i + 1; j < c.members.length; j += 1) apart.add(pairKey(c.members[i] ?? '', c.members[j] ?? ''));
    if (c.verdict === 'remove_post' && c.otherId !== null) for (const m of c.members) if (m !== c.otherId) apart.add(pairKey(c.otherId, m));
    if (c.verdict === 'merge') for (const a of c.members) for (const b of c.otherMembers) together.add(pairKey(a, b));
  }
  const ids = [...new Set([...apart, ...together].flatMap((k) => k.split('|')))];
  const vectors = await repo.vectors(ids, POST_SPACE, 'post');
  const measure = (pairs: ReadonlySet<string>, over: boolean) => {
    let n = 0;
    let of = 0;
    let noVector = 0;
    for (const k of pairs) {
      const [a, b] = k.split('|');
      const va = vectors.get(a ?? '');
      const vb = vectors.get(b ?? '');
      if (va === undefined || vb === undefined) {
        noVector += 1;
        continue;
      }
      of += 1;
      const cos = va.reduce((t, x, i) => t + x * (vb[i] ?? 0), 0);
      if (over ? cos >= policy.narrative.sameMeaning : cos < policy.narrative.sameMeaning) n += 1;
    }
    return { n, of, noVector };
  };
  return {
    shown,
    notNarrative: calls.filter((c) => c.verdict === 'not_narrative').length,
    wrongMerges: calls.filter((c) => c.verdict === 'remove_post').length,
    missedMerges: calls.filter((c) => c.verdict === 'merge').length,
    coinRight: calls.filter((c) => c.verdict === 'right').length,
    coinWrong: calls.filter((c) => c.verdict === 'wrong').length,
    apartOverBar: measure(apart, true),
    togetherUnderBar: measure(together, false),
    list: calls.map((c) => `${c.narrativeId} ${c.verdict}${c.otherId === null ? '' : ` ${c.otherId}`}${c.coin === null ? '' : ` → ${c.coin}`}`),
  };
}

/** The report's line: the owner's numbers, then the bar against his labels. */
export function lessonsLine(l: NarrativeLessons): string {
  const of = (x: { n: number; of: number; noVector: number }) => `${x.n}/${x.of}${x.noVector > 0 ? ` (${x.noVector} without a vector)` : ''}`;
  return `narratives shown ${l.shown}, marked Not a narrative ${l.notNarrative}, wrong merges (posts removed) ${l.wrongMerges}, merges asked ${l.missedMerges}, story coins right ${l.coinRight} / wrong ${l.coinWrong}; the meaning bar would link ${of(l.apartOverBar)} of the pairs he kept apart and miss ${of(l.togetherUnderBar)} he merged`;
}
