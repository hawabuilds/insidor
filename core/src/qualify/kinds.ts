/**
 * THE KIND LABELS the feed's second question answers with, and which of them hold a post back.
 *
 * The second question sorts one post into a kind (the judge adapter's kind prompt). Every label
 * but OTHER holds the post off For You. Two groups among them, because the owner treats them
 * differently:
 *
 *   NEWS_KINDS         real news a person might still want to read (sport, celebrity, politics,
 *                      routine company and product news, film, TV and music news): kept off For
 *                      You, eligible for a news surface of its own;
 *   NEVER_SHOWN_KINDS  an ad, a fan post, or a tragedy (a death, an injury, an accident, an
 *                      attack): shown on no surface at all, whatever its picture or its views.
 *
 * Its own file because three readers must agree on these exact strings: the runner (which kind
 * answers to file), the projector (which filed answer hides a post, and from which surface), and
 * the measuring tools. A label spelled two ways in two places is a post one reader hides and the
 * other shows.
 *
 * ★ A KIND ANSWER HOLDS ONLY BY ITS LABEL. Whether a reply holds a post is read from the kind it
 * names, never from the yes/no beside it: on 2026-10-13 two replies naming OTHER were filed as
 * "not coinable" and hid two posts that no rule meant to hide. `heldKind` returns null for OTHER,
 * for an unknown label and for nothing — only a label in HELD_KINDS ever holds.
 *
 * What breaks if changed carelessly: these strings are the prompt's own labels. Renaming one here
 * without the prompt (or the reverse) silently stops that kind from holding anything.
 */

export const NEWS_KINDS = ['SPORT', 'SHOWBIZ', 'POLITICS', 'CORP_NEWS', 'MEDIA_NEWS'] as const;
export const NEVER_SHOWN_KINDS = ['AD', 'FANDOM', 'TRAGEDY'] as const;

export type NewsKind = (typeof NEWS_KINDS)[number];
export type NeverShownKind = (typeof NEVER_SHOWN_KINDS)[number];
export type HeldKind = NewsKind | NeverShownKind;

/** Every kind that keeps a post off For You. */
export const HELD_KINDS: ReadonlySet<string> = new Set<string>([...NEVER_SHOWN_KINDS, ...NEWS_KINDS]);
const NEWS: ReadonlySet<string> = new Set<string>(NEWS_KINDS);

/** The held kind a reply named, upper-cased and trimmed as the model may vary it; null when it holds nothing. */
export function heldKind(label: string | null | undefined): HeldKind | null {
  const k = (label ?? '').trim().toUpperCase();
  return HELD_KINDS.has(k) ? (k as HeldKind) : null;
}

/** Whether a held kind is news (eligible for a news surface) rather than never shown. */
export const isNewsKind = (kind: HeldKind): kind is NewsKind => NEWS.has(kind);
