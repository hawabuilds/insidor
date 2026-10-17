/**
 * THE OWNER'S SECOND JUNK MEASURE (the owner, 2026-10-18): a fixed random sample of For You posts
 * from the last three days that the owner never tapped, labelled from the judges' OLD answers, so
 * the re-tune's junk is also read on posts the owner did not pick out. The owner's "Not a meme" taps
 * (junk a) decide the gate; this one (junk b) is reported beside it and flagged when it rises too.
 *
 * Its own file because it has three parts that must stay apart: the label an old answer gives
 * (`oldLabel`, pure), which posts are drawn (`drawSample`, pure: a seeded hash, so the block and the
 * setup live now are graded on the same posts and a re-run draws the same ones), and the one read
 * (`readUntapped`, through the store). The judge ids are named here, at the edge, not in settings.
 *
 * ★ THE OLD LABEL. The Haiku answer where one exists; else the Gemma 3 answer, a "yes" only at or
 * above Policy.learning.ownerGate.untapped.fallbackCutoff (0.90, the bar Gemma's answers were held
 * to). UNCLEAR, and left out of the junk number, when the two old answers disagree or either sits in
 * the borderline band (`unclearBand`, 0.6–0.8): a borderline old answer is no label. Unclear posts
 * are listed for the owner to label (`unclearMarkdown`).
 *
 * ★ ONLY THE "NOT" POSTS ARE GRADED. Junk (b) is the share of the sample's old-label "not" posts the
 * version passes; grading the sample's "meme" and unclear posts would cost and count for nothing.
 *
 * What breaks if changed carelessly: the draw must stay a pure function of the seed and the ids. A
 * draw that differed between the two gradings of one run would compare two different samples.
 */

import { createHash } from 'node:crypto';

import type { Policy } from '../../contracts/src/policy.ts';
import type { PgLearningRepo } from '../../store/src/index.ts';

/** The old judges, by their answer ids' prefix (internal.post_judgement judge_id). */
export const HAIKU_JUDGE = 'judge:anthropic/%';
export const GEMMA_JUDGE = '%gemma-3%';

export interface OldAnswer { readonly coinable: boolean; readonly confidence: number }
export interface Untapped { readonly itemId: string; readonly text: string; readonly imageUri: string | null; readonly haiku: OldAnswer | null; readonly gemma: OldAnswer | null }
export type OldLabel = { readonly label: 'meme' | 'not' } | { readonly label: 'unclear'; readonly why: string } | { readonly label: null };

/** The label the old answers give a post (see the header). */
export function oldLabel(u: Pick<Untapped, 'haiku' | 'gemma'>, p: Policy): OldLabel {
  const U = p.learning.ownerGate.untapped;
  const [lo, hi] = U.unclearBand;
  const answers = [u.haiku, u.gemma].filter((a): a is OldAnswer => a !== null);
  if (answers.length === 0) return { label: null };
  const border = answers.find((a) => a.confidence >= lo && a.confidence <= hi);
  if (border !== undefined) return { label: 'unclear', why: `an old answer at ${border.confidence.toFixed(2)}, in the ${lo}–${hi} band` };
  const h = u.haiku === null ? null : u.haiku.coinable ? 'meme' : 'not';
  const g = u.gemma === null ? null : u.gemma.coinable && u.gemma.confidence >= U.fallbackCutoff ? 'meme' : 'not';
  if (h !== null && g !== null && h !== g) return { label: 'unclear', why: `Haiku said ${h}, Gemma ${g}` };
  return { label: (h ?? g)! };
}

/** The sample: posts with an old answer, not `exclude`d, in a seeded hash order, the first `n`. */
export function drawSample(posts: readonly Untapped[], p: Policy, exclude: ReadonlySet<string>): readonly (Untapped & { readonly old: OldLabel })[] {
  const U = p.learning.ownerGate.untapped;
  const key = (id: string) => createHash('sha256').update(`${U.seed}|${id}`).digest('hex');
  return posts
    .filter((u) => !exclude.has(u.itemId))
    .map((u) => ({ ...u, old: oldLabel(u, p), k: key(u.itemId) }))
    .filter((u) => u.old.label !== null)
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, U.sample)
    .map(({ k: _k, ...u }) => u);
}

/** The posts the owner never tapped, first shown on the gate's feed in its window, with their old answers. */
export async function readUntapped(repo: PgLearningRepo, p: Policy, since: Date, pictureOf: (media: unknown) => { readonly uri: string } | null): Promise<readonly Untapped[]> {
  const rows = await repo.untappedShown(p.learning.ownerGate.junkFeed, since, HAIKU_JUDGE, GEMMA_JUDGE);
  return rows.map((r) => ({ itemId: r.itemId, text: r.body, imageUri: pictureOf(r.media)?.uri ?? null, haiku: r.haiku, gemma: r.gemma }));
}

const linkOf = (itemId: string): string => {
  const [source, id] = itemId.split(':');
  return source === 'x' ? `https://x.com/i/status/${id}` : source === 'tiktok' ? `https://www.tiktok.com/@/video/${id}` : itemId;
};
const said = (a: OldAnswer | null, name: string) => (a === null ? `${name} —` : `${name} ${a.coinable ? 'yes' : 'no'} ${a.confidence.toFixed(2)}`);

/** The unclear posts as a page for the owner to label: link, text, old answers. */
export function unclearMarkdown(sample: readonly (Untapped & { readonly old: OldLabel })[], drawnAt: Date): string {
  const unclear = sample.filter((u) => u.old.label === 'unclear');
  return [
    `# Unclear posts in the junk sample (${unclear.length} of ${sample.length})`,
    '',
    `Drawn ${drawnAt.toISOString()} from For You posts of the last three days that were never tapped. Unclear: the old answers disagree, or one is between 0.6 and 0.8. Left out of junk (b) until labelled.`,
    '',
    '| post | text | old answers | why unclear |',
    '|---|---|---|---|',
    ...unclear.map((u) => `| [${u.itemId}](${linkOf(u.itemId)}) | ${u.text.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 140)} | ${said(u.haiku, 'Haiku')}; ${said(u.gemma, 'Gemma')} | ${u.old.label === 'unclear' ? u.old.why : ''} |`),
    '',
  ].join('\n');
}
