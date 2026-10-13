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
 *     spaces, punctuation and filler words ("the", "a", "my"…) gone; a phrase too long for a
 *     ticker uses its first word if that word alone is long enough; a word still too long is
 *     shortened by dropping vowels from its end inward (ROLLERDEATH → ROLLERDETH), never by
 *     cutting letters off its tail (ROLLERDEAT); failing that, the phrase's initials; a name no
 *     ticker can be made from is dropped rather than cut to fit;
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

/**
 * Words that carry no name: "the Buck Me ad" is BUCKMEAD, never THE. Dropped only while a word
 * is left, so a name that is nothing but filler makes no ticker rather than an empty one.
 */
const FILLER: ReadonlySet<string> = new Set(['THE', 'A', 'AN', 'MY', 'YOUR', 'OUR', 'HIS', 'HER', 'ITS', 'THEIR', 'THIS', 'THAT']);

const VOWELS: ReadonlySet<string> = new Set(['A', 'E', 'I', 'O', 'U']);

/**
 * A word shortened to `max` the way people shorten tickers: vowels go first, from the end inward,
 * never the first letter; then a letter that repeats the one before it. Null when that is not
 * enough — a word cut short at its tail reads as a typo, so it is not offered.
 */
function shorten(word: string, max: number): string | null {
  const letters = [...word];
  const drop = (test: (i: number) => boolean): void => {
    for (let i = letters.length - 1; i > 0 && letters.length > max; i -= 1) if (test(i)) letters.splice(i, 1);
  };
  drop((i) => VOWELS.has(letters[i] ?? ''));
  drop((i) => letters[i] === letters[i - 1]);
  return letters.length <= max ? letters.join('') : null;
}

/** The ticker a name makes, or null when none fits the bars. */
export function tickerFor(name: string, bars: Pick<NameIdeaBars, 'minTicker' | 'maxTicker'>): string | null {
  const fits = (t: string) => t.length >= bars.minTicker && t.length <= bars.maxTicker;
  const all = nameKey(name).split(' ').map(tickerChars).filter((w) => w !== '');
  const words = all.filter((w) => !FILLER.has(w));
  if (words.length === 0) return null;
  const whole = words.join('');
  if (fits(whole)) return whole;
  const first = words[0] ?? '';
  if (words.length > 1 && fits(first)) return first;
  if (first.length > bars.maxTicker) {
    const short = shorten(first, bars.maxTicker);
    if (short !== null && fits(short)) return short;
  }
  const initials = words.map((w) => w.slice(0, 1)).join('');
  return fits(initials) ? initials : null;
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
