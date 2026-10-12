/**
 * THE SOCIAL SITES THE PHONE APP CAN DRAW A MARK FOR, keyed by the label the server sends.
 *
 * The server chooses `sourceLabel` ("X", "TikTok", "Reddit") — the app never maps an internal
 * source id to a name, because that mapping is where a new platform silently renders as its
 * raw id. This file goes one step the other way only: from the server's display label to a
 * mark we know how to draw.
 *
 * ★ AN UNKNOWN LABEL IS `null`, NOT A GUESS. A sixth platform the server starts sending gets
 * no badge and keeps its label in text, rather than being drawn as whichever mark looked
 * closest. A wrong logo on a post is a false claim about where it came from.
 */

export type Platform = 'x' | 'tiktok' | 'youtube' | 'reddit' | 'instagram';

/** In the order the filter pills show them. */
export const PLATFORMS: readonly { readonly key: Platform; readonly label: string }[] = [
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'reddit', label: 'Reddit' },
  { key: 'instagram', label: 'Instagram' },
];

/**
 * ★ THE PLATFORMS A FILTER OFFERS, FOR NOW: X and TikTok. The others stay above, so their marks
 * still draw on a post and turning one back on is adding its key here. Kept in the app rather than
 * in contracts/src/policy.ts because that file may not name a platform (check-vocabulary), and
 * the app may not reach it by name (check-app-vocabulary).
 */
export const SHOWN_PLATFORMS: readonly Platform[] = ['x', 'tiktok'];

/** What the filter pills and the filter panel list. */
export const FILTER_PLATFORMS = PLATFORMS.filter((p) => SHOWN_PLATFORMS.includes(p.key));

export function platformOf(sourceLabel: string): Platform | null {
  const wanted = sourceLabel.trim().toLowerCase();
  return PLATFORMS.find((p) => p.label.toLowerCase() === wanted)?.key ?? null;
}

/** "X, TikTok" — each site once, in the order first seen. */
export function siteList(sourceLabels: readonly string[]): string {
  return [...new Set(sourceLabels)].join(', ');
}
