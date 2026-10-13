/**
 * THE OWNER'S LABELLED POSTS AS PRECEDENT: which labelled posts are closest to a post the feed's
 * judge is about to be asked about, and whether the post is so close to a "not a meme" call that
 * it is held without being shown.
 *
 * Pure, and its own file, because two callers must choose exactly the same neighbours: the live
 * scorer (services/runner score-posts) and the measuring harness the re-tune grades with
 * (tools/lib/pass-rates.ts). A re-tune that picked neighbours differently would measure a judge
 * nobody runs.
 *
 * ★ EVERY LABEL IS A CANDIDATE. There is no capped block here: each post gets its own `k` closest
 * (Policy.judge.precedents.k), from all the owner's labels, so a label added a minute ago competes
 * with the oldest one on similarity alone.
 *
 * ★ A POST IS NEVER ITS OWN PRECEDENT. `isSelf` names the post being asked about (live: its id; a
 * test: its id and its own picture or words), and it is left out of its own neighbours and of the
 * hold. A test post graded against its own label would grade nothing.
 *
 * ★ THE HOLD IS A BAR ON ONE NUMBER, chosen on the labelled set so that no gold, coined or "is a
 * meme" post would be held (Policy.judge.precedents.holdNotSimilarity). The similarity decides and
 * never leaves the caller: no number from here reaches a screen.
 *
 * What breaks if changed carelessly: vectors are unit length (the embedding adapter normalises
 * them), so the dot product here IS the cosine. Vectors from two spaces must never meet here; the
 * callers read labels of the post space only.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { JudgePrecedent } from '@insidor/contracts/ports/judge.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';

/** One labelled post with its vector. */
export interface LabelledVector {
  readonly itemId: string;
  readonly label: 'meme' | 'not';
  readonly text: string;
  readonly why: string | null;
  /** The picture embedded with the words, when there was one: a test tells a post from its own label by it. */
  readonly picture?: string | null;
  readonly values: ArrayLike<number>;
}

/**
 * The words and picture a post is embedded from — the words the judge is sent (trimmed to
 * Policy.judge.maxCharsPerText) and the picture the feed shows. Labelled posts and new posts both
 * go through this, so their vectors compare like with like.
 */
export function embedInput(text: string, picture: string | null, p: Policy): { readonly text: string; readonly picture: string | null } {
  return { text: text.trim().slice(0, p.judge.maxCharsPerText), picture };
}

export interface Neighbour {
  readonly label: LabelledVector;
  readonly similarity: number;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** The `k` labelled posts closest to `v`, closest first; never the post itself. */
export function nearestLabelled(v: ArrayLike<number>, labels: readonly LabelledVector[], k: number, isSelf: (l: LabelledVector) => boolean): readonly Neighbour[] {
  if (k <= 0) return [];
  return labels
    .filter((l) => !isSelf(l))
    .map((label) => ({ label, similarity: dot(v, label.values) }))
    .sort((a, b) => b.similarity - a.similarity || (a.label.itemId < b.label.itemId ? -1 : 1))
    .slice(0, k);
}

/** The closest post the owner called "not a meme", and how close; null when there is none. */
export function closestNot(v: ArrayLike<number>, labels: readonly LabelledVector[], isSelf: (l: LabelledVector) => boolean): Neighbour | null {
  let best: Neighbour | null = null;
  for (const l of labels) {
    if (l.label !== 'not' || isSelf(l)) continue;
    const s = dot(v, l.values);
    if (best === null || s > best.similarity) best = { label: l, similarity: s };
  }
  return best;
}

/** Held as NOT_MEME_MATCH: at or over the bar. No similarity (no vector, no "not" label) holds nothing. */
export const heldAsNotMeme = (similarity: number | null, p: Policy): boolean => similarity !== null && similarity >= p.judge.precedents.holdNotSimilarity;

/** The neighbours as the judge is shown them: words trimmed to Policy.judge.precedents.maxChars. */
export function precedentsFor(neighbours: readonly Neighbour[], p: Policy): readonly JudgePrecedent[] {
  return neighbours.map(({ label }) => ({
    ref: label.itemId,
    text: label.text.trim().slice(0, p.judge.precedents.maxChars),
    label: label.label,
    why: label.why,
  }));
}

/** A uri that is the video file itself, not a still of it. */
const VIDEO_FILE = /\.(mp4|m3u8|mpd|mov|webm)(?:$|[?#])/i;

/**
 * The picture embedded with a post's words: a still image first, else a video entry whose uri is
 * its still (not the video file) — the picture the feed shows, so a labelled post and a new post
 * are embedded from the same kind of picture. Read defensively: a stored post's media is jsonb
 * from a source, and anything not shaped like a MediaRef is skipped.
 */
export function postPicture(media: readonly MediaRef[] | unknown): string | null {
  if (!Array.isArray(media)) return null;
  const refs = media.filter((m): m is Pick<MediaRef, 'kind' | 'uri'> => typeof m === 'object' && m !== null && typeof (m as { uri?: unknown }).uri === 'string');
  const image = refs.find((m) => m.kind === 'image' && m.uri.trim() !== '');
  if (image !== undefined) return image.uri;
  return refs.find((m) => m.kind === 'video' && m.uri.trim() !== '' && !VIDEO_FILE.test(m.uri))?.uri ?? null;
}
