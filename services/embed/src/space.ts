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
