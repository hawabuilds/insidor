/**
 * NAME AND TICKER IDEAS FOR A COIN MADE FROM A POST — from the judge's own names for its subject.
 *
 * The judge already names the subject when it scores a post (`proposedName`, then
 * `alternateNames`). This turns those names into what the Create sheet offers as chips: a name
 * and a ticker each, in the owner's order, with no second call to anything.
 *
 * The owner's sheet rules, applied here because they are rules about strings:
 *   - one word first: a one-word name (the subject's own name or nickname) before any phrase;
 *   - a ticker is `minTicker` to `maxTicker` capital letters or digits, made from the name with
 *     spaces and punctuation gone; a phrase too long for a ticker uses its first word if that
 *     word alone is long enough, else its initials; a name no ticker can be made from is dropped;
 *   - one idea per ticker: two names that come out as the same ticker are one chip.
 *
 * NOT HERE: brand names and real people's full names. A list of either is a list of the world's
 * names, which core must not hold (check-vocabulary); the projector drops the ones it can
 * (services/project/src/name-ideas.ts) and the judge's prompt is told not to offer them.
 * Whether a ticker is free is not here either: that is a live fact, read when a person asks.
 *
 * What breaks if changed carelessly: the order. The read service puts free tickers first and
 * keeps THIS order within each half; sorting here by anything else (length, say) would put a
 * phrase ahead of the subject's own one-word name, which is the one the owner asked for first.
 */

import { nameKey } from '../group/picture.ts';

export interface NameIdeaBars {
  readonly minTicker: number;
  readonly maxTicker: number;
  readonly maxIdeas: number;
}

export interface NameIdea {
  /** As the person will see it in the name field: the judge's spelling, trimmed. */
  readonly name: string;
  /** Capital letters and digits only. */
  readonly ticker: string;
}

const tickerChars = (s: string): string => nameKey(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The ticker a name makes, or null when none fits the bars. */
export function tickerFor(name: string, bars: Pick<NameIdeaBars, 'minTicker' | 'maxTicker'>): string | null {
  const fits = (t: string) => t.length >= bars.minTicker && t.length <= bars.maxTicker;
  const whole = tickerChars(name);
  if (fits(whole)) return whole;
  const words = nameKey(name).split(' ').filter((w) => w !== '');
  const first = tickerChars(words[0] ?? '');
  if (words.length > 1 && fits(first)) return first;
  const initials = words.map((w) => tickerChars(w).slice(0, 1)).join('');
  if (fits(initials)) return initials;
  return whole.length > bars.maxTicker ? whole.slice(0, bars.maxTicker) : null;
}

export function nameIdeas(proposedName: string | null, alternateNames: readonly string[], bars: NameIdeaBars): readonly NameIdea[] {
  const names = [proposedName, ...alternateNames].flatMap((n) => (n === null ? [] : [n.replace(/\s+/g, ' ').trim()])).filter((n) => n !== '');
  const oneWord = (n: string) => nameKey(n).split(' ').filter((w) => w !== '').length === 1;
  const ordered = [...names.filter(oneWord), ...names.filter((n) => !oneWord(n))];
  const seen = new Set<string>();
  const out: NameIdea[] = [];
  for (const name of ordered) {
    const ticker = tickerFor(name, bars);
    if (ticker === null || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ name, ticker });
    if (out.length >= bars.maxIdeas) break;
  }
  return out;
}
