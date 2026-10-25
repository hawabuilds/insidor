/**
 * WHAT THIS SERVICE COMPUTES, NAMED ONCE: the model, its two precisions, how a post's words and
 * picture become one vector, and the space ids those choices add up to.
 *
 * Its own file, and constants rather than settings, because every choice here is part of the
 * vectors' meaning. A cosine bar in the policy is calibrated against exactly this combination
 * (copy test of 2026-10-24); a different model, a quantised picture encoder or another words weight
 * gives vectors that are well-formed, comparable-looking and NOT comparable with the stored ones.
 * An environment variable that changed one of them would change the meaning of every stored
 * vector's neighbours without changing its space id — the silent cross-space comparison
 * contracts/src/ports/embed.ts exists to make impossible.
 *
 * What breaks if changed carelessly: change ANY value below and you must change `SPACE` (and so
 * `POST_SPACE`), re-embed what is stored (tools/reembed.ts) and re-measure the bars. The adapter
 * (adapters/embed/selfhost) refuses a reply whose space is not the one it was built for, so a
 * deploy of a changed service against an unchanged adapter fails loudly instead of mixing.
 *
 * Why these values (copy test, 2026-10-24, 25 narratives, 215 posts, 180 pictures, on this repo's
 * own stored posts):
 *   - SigLIP 2 base/16 at 224: multilingual (its tokenizer reads Japanese, Chinese, Turkish — the
 *     first SigLIP read "奈良の鹿" as noise), 768 wide, about 375M parameters, Apache-2.0.
 *   - words encoder 8-bit (273 MB on disk instead of 1.1 GB, the 256k-token vocabulary is most of
 *     it): same-vs-unrelated separation 0.909 against 0.913 at full precision.
 *   - picture encoder at full precision: 8-bit cost the post vectors 0.913 → 0.738.
 *   - a post is 0.7 words + 0.3 picture (unit vectors, then re-normalised): 0.5 separated
 *     0.848, 0.7 0.913, 0.9 0.889. Words and pictures sit in different regions of this space (a
 *     words-only post and a picture-only post of one story score low against each other), so the
 *     words, which every post has, carry most of the weight.
 */

export const MODEL_ID = 'onnx-community/siglip2-base-patch16-224-ONNX';
/** The ONNX precision of each half, as the model repository names its files. */
export const TEXT_DTYPE = 'q8';
export const VISION_DTYPE = 'fp32';
/** Tokens per text: the length the model was trained at; longer words are cut. */
export const TEXT_TOKENS = 64;
/** The model's vector width. */
export const MODEL_DIMENSIONS = 768;
/** A post's words' share of its one vector; the picture has the rest. */
export const POST_TEXT_WEIGHT = 0.7;

/** A picture's (and a lone text's) space. */
export const SPACE = 'siglip2-b16-224.768';
/** A post's words-and-picture vector: its own space, as with every other representation here. */
export const POST_SPACE = `${SPACE}.post`;

/*
 * ★ THE SECOND POST SPACE: another model's words beside this model's picture (benchmark of
 * 2026-10-25 on model-free ground truth: 3,370 same-story pairs by quote, coin, picture hash and the
 * owner's adds, against 22,769 hard negatives). This model's words tower is the weak half — it kept
 * 26% of the same-story pairs at 0.5% hard negatives where multilingual-e5-base with this model's
 * picture kept 62%, level with the hosted vendor's 64%.
 *
 * The two halves sit side by side, not added: [√w·words, √(1−w)·picture]. Each half is unit length,
 * so for two posts with pictures the cosine is exactly w·(words cosine) + (1−w)·(picture cosine), the
 * scoring the benchmark measured; words alone are [words, 0] and a picture alone [0, picture], both
 * unit length, so a words-only post against a pictured one scores √w·(words cosine). Adding the two
 * (as POST_SPACE does) is impossible here: the halves are two models' coordinates.
 *
 * ★ FULL PRECISION, NOT 8-BIT, AND THIS IS WHY (2026-10-25). The 8-bit files multiply 8-bit
 * activations by signed 8-bit weights. On the laptop CPU the benchmark ran on, that product is exact
 * and 8-bit agrees with full precision at 0.996; on the Railway box the stored words vectors of this
 * service agree with a local run of the same text, same tokenizer settings and same file at only
 * 0.94 (median of 300 words-only posts, 0.70 at worst), while the full-precision picture tower's
 * stored vectors agree with a local run at 1.00000. Our code is the same on both; what differs is the CPU's
 * integer kernel (most likely x86's 8-bit-times-signed-8-bit product, which sums pairs in 16 bits
 * and saturates on CPUs without the newer dot-product instructions — not verifiable from here). A space whose vectors depend on which CPU made
 * them cannot be calibrated anywhere but on that CPU, so the words model of this space runs at full
 * precision, where the laptop's numbers are the box's numbers (and WORDS_PROBE checks it at boot).
 * POST_SPACE keeps its 8-bit words: its stored vectors and bars are all the box's own, consistent
 * with one another, and it is being replaced, not repaired.
 */
export const WORDS_MODEL_ID = 'Xenova/multilingual-e5-base';
export const WORDS_DTYPE = 'fp32';
/** The model was trained with "query: " before a text to be compared with other short texts. */
export const WORDS_PREFIX = 'query: ';
/** The model's own limit; the judge's 400 characters never reach it. */
export const WORDS_TOKENS = 512;
export const WORDS_DIMENSIONS = 768;
/** The words' share of the cosine between two pictured posts; the picture has the rest. */
export const E5_POST_TEXT_WEIGHT = 0.7;
export const E5_POST_SPACE = 'me5-base+siglip2-b16-224.1536.post';
export const E5_POST_DIMENSIONS = WORDS_DIMENSIONS + MODEL_DIMENSIONS;

/**
 * A fixed text and the first values of its words vector, computed at full precision on the laptop the
 * bars were measured on. The service embeds it at boot: a box that answers differently (beyond float
 * rounding) would write vectors the bars were not measured on, so the E5 space refuses to answer
 * until it agrees (main.ts). Re-measure these with the model if WORDS_* ever changes.
 */
export const WORDS_PROBE: { readonly text: string; readonly head: readonly number[]; readonly tolerance: number } = {
  text: 'the deer of nara bow to tourists for crackers 奈良の鹿',
  head: [-0.004809, 0.04254, -0.01823, 0.034711, 0.032925, -0.003024, -0.025669, -0.037022],
  /* Float rounding across CPUs moves these by about 1e-6; the 8-bit fault moved values by about 1e-2. */
  tolerance: 1e-3,
};
/**
 * The same text through THIS model's 8-bit words tower on the laptop. Only logged, never enforced:
 * the box is known to answer differently (see above), and the boot log's distance from these is the
 * measurement that confirms why.
 */
export const TEXT_PROBE_HEAD: readonly number[] = [-0.01455, 0.041058, 0.063447, 0.008933, 0.280905, -0.018196, -0.004992, 0.00357];
/** Of the probes' agreement: the largest difference among the head's values. */
export function probeDistance(head: readonly number[], got: ArrayLike<number>): number {
  let worst = head.length === 0 ? Infinity : 0;
  head.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - (got[i] ?? Infinity)))));
  return worst;
}
