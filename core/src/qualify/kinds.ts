/**
 * THE KIND LABELS the feed's second question answers with, and which of them hold a post back.
 *
 * The second question sorts one post into a kind (the judge adapter's kind prompt). The labels
 * are fixed here; WHICH of them keep a post off For You is the owner's call and lives in policy
 * (`Policy.judge.heldKinds`), chosen by measurement. Two groups among the labels, kept for
 * reading the answers rather than for deciding:
 *
 *   NEWS_KINDS         sport, celebrity, politics, routine company and product news, film, TV and
 *                      music news;
 *   NEVER_SHOWN_KINDS  an ad, a fan post, or a tragedy (a death, an injury, an accident, an attack).
 *
 * Its own file because three readers must agree on these exact strings: the runner (which kind
 * answers to file), the projector (which filed answer hides a post), and the measuring tools. A
 * label spelled two ways in two places is a post one reader hides and the other shows.
 *
 * ★ A KIND ANSWER HOLDS ONLY BY ITS LABEL. Whether a reply holds a post is read from the kind it
 * names, never from the yes/no beside it: on 2026-10-13 two replies naming OTHER were filed as
 * "not coinable" and hid two posts that no rule meant to hide. `heldKind` returns null for OTHER,
 * for an unknown label, for a label policy does not hold, and for nothing.
 *
 * What breaks if changed carelessly: these strings are the prompt's own labels. Renaming one here
 * without the prompt (or the reverse) silently stops that kind from holding anything; a label in
 * `heldKinds` that is not in KIND_LABELS holds nothing.
 */

export const NEWS_KINDS = ['SPORT', 'SHOWBIZ', 'POLITICS', 'CORP_NEWS', 'MEDIA_NEWS'] as const;
export const NEVER_SHOWN_KINDS = ['AD', 'FANDOM', 'TRAGEDY'] as const;
/**
 * Not the kind question's: the label the runner files, by rule and with no model asked, when a post
 * is very close to one the owner called "not a meme" (precedents.ts, Policy.judge.precedents). Filed
 * like a kind answer so every reader of a held kind — the projector, its rejection detail
 * `kind:NOT_MEME_MATCH`, the measuring tools — holds it the same way.
 */
export const NOT_MEME_MATCH = 'NOT_MEME_MATCH';

export type NewsKind = (typeof NEWS_KINDS)[number];
export type NeverShownKind = (typeof NEVER_SHOWN_KINDS)[number];
export type HeldKind = NewsKind | NeverShownKind | typeof NOT_MEME_MATCH;

/** Every label that may hold a post other than OTHER: the labels policy may hold. */
export const KIND_LABELS: ReadonlySet<string> = new Set<string>([...NEVER_SHOWN_KINDS, ...NEWS_KINDS, NOT_MEME_MATCH]);
const NEWS: ReadonlySet<string> = new Set<string>(NEWS_KINDS);

/**
 * The held kind a reply named, upper-cased and trimmed as the model may vary it; null when it
 * holds nothing. `held` is `Policy.judge.heldKinds`.
 */
export function heldKind(label: string | null | undefined, held: readonly string[]): HeldKind | null {
  const k = (label ?? '').trim().toUpperCase();
  return KIND_LABELS.has(k) && held.includes(k) ? (k as HeldKind) : null;
}

/** Whether a kind label is one of the news kinds. */
export const isNewsKind = (kind: HeldKind): kind is NewsKind => NEWS.has(kind);
