/**
 * THE CREATE FORM'S RULES — a ticker from a name, what a ticker may contain, and the dev-buy
 * presets.
 *
 * Nothing here can create a coin. The form is a draft a person can fill in; the button says
 * "Coming soon". It is split from the modal so the ticker rules are tested.
 *
 * ★ THE FORM NEVER SAYS A TICKER IS FREE. Whether a ticker is taken on a venue is a fact we
 * would have to ask the venue for, and nothing asks yet — so the line under the inputs says
 * the check is coming, rather than a reassuring "you'd be first" that nobody verified.
 */

/** What a ticker may hold: capitals and digits, at most ten. */
export const TICKER_MAX = 10;

export function cleanTicker(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TICKER_MAX);
}

/**
 * A first suggestion, which the person is expected to change. A one- or two-word name gives
 * its last word ("Grim Reaper" → REAPER); a longer title gives its first ("Jimothy Heads To
 * DC" → JIMOTHY), which is usually the subject.
 */
export function suggestTicker(name: string): string {
  const words = name.split(/\s+/).map(cleanTicker).filter((w) => w !== '');
  const pick = words.length <= 2 ? words[words.length - 1] : words[0];
  return pick ?? '';
}

/** Dev-buy presets, in SOL. A menu of amounts, not advice about any of them. */
export const DEV_BUY_PRESETS: readonly number[] = [0.5, 1, 2];
