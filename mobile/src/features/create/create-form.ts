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

/** The presets that fit under the launchpad's cap, in SOL: a preset above it is not offered. */
export function presetsWithin(maxDevBuyLamports: bigint): readonly number[] {
  return DEV_BUY_PRESETS.filter((sol) => BigInt(Math.round(sol * 1e9)) <= maxDevBuyLamports);
}

/**
 * The ticker check, in words, about what Insidor has seen — never a claim about every coin ever.
 * Unknown is said as unknown.
 */
export function tickerLine(ticker: string, seen: number | null): string {
  if (ticker === '') return 'Pick a ticker.';
  if (seen === null) return `Whether $${ticker} is taken couldn't be checked.`;
  if (seen === 0) return `You'd be first: no coin Insidor has seen uses $${ticker}.`;
  return `${seen.toLocaleString('en-US')} coin${seen === 1 ? '' : 's'} Insidor has seen already use${seen === 1 ? 's' : ''} $${ticker}.`;
}

/** A fee rate from the chain, in words: 30 basis points is "0.30% of every trade". */
export function feeRate(bps: number): string {
  return `${(bps / 100).toFixed(2)}% of every trade`;
}

/** A share of the supply from the chain, in words: 17 basis points is "0.17% of supply". */
export function supplyShare(bps: number): string {
  return `${(bps / 100).toFixed(2)}% of supply`;
}

/**
 * What the line beside a name chip says about its ticker, in the server's three answers: "Free"
 * only when every source answered, "Taken by 3 coins" (or "10+" when there were more), and
 * "Couldn't check" when a source was down — never "Free" on an outage.
 */
export function tickerUseLine(use: { readonly kind: 'free' } | { readonly kind: 'taken'; readonly count: number; readonly more: boolean } | { readonly kind: 'unknown' }): string {
  if (use.kind === 'free') return 'Free';
  if (use.kind === 'unknown') return "Couldn't check";
  return `Taken by ${use.count}${use.more ? '+' : ''} ${use.count === 1 && !use.more ? 'coin' : 'coins'}`;
}
