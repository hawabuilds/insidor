/**
 * Text carriers, shared by every source on purpose.
 *
 * The shingle width is not a tuning knob and must not become one per adapter:
 * two sources that shingle at different widths can never produce a matching
 * key, so the free cross-source carrier join — the cheapest evidence the
 * grouper has — would silently never fire. One width, one place.
 *
 * This is SHAPE only. Whether two shingle sets are the same story is a
 * question for core/group, which is where the threshold lives.
 */

/** Word n-grams, lowercased and whitespace-collapsed. */
const SHINGLE_WORDS = 5;

export function shingles(text: string): readonly string[] {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ') // link shorteners differ per source and carry no meaning
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0);

  if (words.length === 0) return [];
  if (words.length < SHINGLE_WORDS) return [words.join(' ')];

  const out: string[] = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    out.push(words.slice(i, i + SHINGLE_WORDS).join(' '));
  }
  return out;
}

/**
 * Cashtags and hashtags are entity spans. Their keys are deliberately NOT
 * prefixed with a source: an unprefixed key is what lets the same phrase seen
 * on two sources join for free. Format ids ARE prefixed, because a sound id
 * means nothing off the platform that issued it.
 */
export const cashtagKey = (symbol: string): string => `cashtag:${symbol.toUpperCase()}`;
export const hashtagKey = (tag: string): string => `hashtag:${tag.toLowerCase()}`;
