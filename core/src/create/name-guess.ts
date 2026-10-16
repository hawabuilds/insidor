/**
 * THE NAMER'S RULES ABOUT STRINGS AND NEIGHBOURS: which known post → coin pairs a post is shown
 * with, how a raw answer becomes a clean ranked list, and when a guess IS a coin's name.
 *
 * Pure and its own file because three callers must agree exactly: the runner (services/runner
 * work/name-guesses.ts) picks the examples and cleans the answer; the measurement
 * (tools/name-guess-eval.ts) grades guesses against real coins with `guessHit`; and coin matching
 * reads the same normalised key when it searches with the guesses. A measurement that compared
 * names more loosely than matching does would report hits matching never gets. The projector
 * puts the first guesses ahead of the judge's names on the Create sheet (`guessesFirst`).
 *
 * ★ ONE POST, ALL ITS NAMES. An example is a POST with every coin people made of it ("GTA 6" →
 * $GTA, $GTA6, $VICECITY): the neighbours are posts, so a post with ten coins counts once among
 * the `k` and shows all ten names — which is how the namer learns that one post gets many names.
 *
 * ★ A GUESS IS THE COIN'S NAME WHEN THE KEYS MATCH, OR ARE ONE SLIP APART. The key drops case,
 * accents, '$', spaces and punctuation ("Flávio Hipotético" = "FLAVIO HIPOTETICO" =
 * "flaviohipotetico"); two keys of `closeSpelling.minChars` or more letters that are
 * `closeSpelling.maxEdits` edits apart also match (PRINGLE / PRINGLES). A name is compared with a
 * name AND a ticker, both ways: people type $RIP for "Rest In Pringles".
 *
 * ★ "NOT THIS COIN" IS AN EXAMPLE TOO (0077). A coin the owner called wrong for a post rides with
 * that post as `notCoins`, so a post like it is shown the name to avoid; a post with only rejected
 * coins (he said "No coin") is still a neighbour.
 *
 * What breaks if changed carelessly: `isSelf`. A post must never be shown its own coins as an
 * example, live (it was confirmed a minute ago) or in the measurement (it is the held-out post):
 * the namer would copy the answer and the hit rate would measure nothing.
 */

import type { NamesPolicy } from '@insidor/contracts/policy.ts';
import type { NameExample, NameGuess } from '@insidor/contracts/ports/names.ts';

import { tickerFor, type NameIdea, type NameIdeaBars } from './name-ideas.ts';
import { ownSourceFirst, sourceOfItemId } from '../qualify/precedents.ts';

/** One known example post with its vector. */
export interface ExampleVector {
  readonly itemId: string;
  readonly text: string;
  readonly seen: string | null;
  readonly coins: readonly NameGuess[];
  /** Coins the owner said are NOT this post's ("Wrong coin", "No coin"); none when absent. */
  readonly notCoins?: readonly NameGuess[];
  /** When the post was made, in ms; null when unknown. */
  readonly postedAtMs: number | null;
  readonly values: ArrayLike<number>;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** The `k` example posts closest to `v`, closest first; never one `isSelf` names. Vectors are unit length. */
export function nearestExamples(v: ArrayLike<number>, examples: readonly ExampleVector[], k: number, isSelf: (e: ExampleVector) => boolean, own?: { readonly source: string; readonly reserve: number }): readonly ExampleVector[] {
  if (k <= 0) return [];
  const sorted = examples
    .filter((e) => !isSelf(e) && (e.coins.length > 0 || (e.notCoins?.length ?? 0) > 0))
    .map((e) => ({ e, s: dot(v, e.values) }))
    .sort((a, b) => b.s - a.s || (a.e.itemId < b.e.itemId ? -1 : 1))
    .map((x) => x.e);
  /* `own`: up to `reserve` of the k from the post's own source, first (qualify/precedents.ts `ownSourceFirst`). */
  return own === undefined ? sorted.slice(0, k) : ownSourceFirst(sorted, k, own.reserve, (e) => sourceOfItemId(e.itemId) === own.source);
}

/** An example as the namer is shown it: words trimmed, each distinct coin name once, and the owner's rejected ones apart. */
export function exampleShown(e: ExampleVector, p: NamesPolicy): NameExample {
  const once = (list: readonly NameGuess[]) => {
    const seen = new Set<string>();
    return list.filter((c) => {
      const key = `${nameKeyOf(c.name)}|${nameKeyOf(c.ticker)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const notCoins = once(e.notCoins ?? []);
  return { text: e.text.trim().slice(0, p.exampleChars), seen: e.seen, coins: once(e.coins), ...(notCoins.length > 0 ? { notCoins } : {}) };
}

/** Case, accents, '$', spaces and punctuation gone: what two spellings of one name share. */
export function nameKeyOf(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** A ticker as the venue takes it: capitals and digits, accents dropped, cut to `max`. */
export function cleanTicker(s: string, max: number): string {
  return s.normalize('NFKD').replace(/\p{M}+/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, max);
}

/** Levenshtein distance, stopping early once it is over `cap`. */
function editsWithin(a: string, b: string, cap: number): boolean {
  if (Math.abs(a.length - b.length) > cap) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return false;
    prev = row;
  }
  return (prev[b.length] ?? cap + 1) <= cap;
}

/** Two spellings of one name: the same key, or close enough (see the header). */
export function sameName(a: string, b: string, p: NamesPolicy): boolean {
  const x = nameKeyOf(a);
  const y = nameKeyOf(b);
  if (x === '' || y === '') return false;
  if (x === y) return true;
  const long = Math.min(x.length, y.length) >= p.closeSpelling.minChars;
  return long && editsWithin(x, y, p.closeSpelling.maxEdits);
}

/** A guess is a coin when its name or ticker is the coin's name or ticker, either way round. */
export function guessIsCoin(g: NameGuess, coin: NameGuess, p: NamesPolicy): boolean {
  return sameName(g.name, coin.name, p) || sameName(g.ticker, coin.ticker, p) || sameName(g.name, coin.ticker, p) || sameName(g.ticker, coin.name, p);
}

/** Whether any of the first `top` guesses is any of the post's real coins. */
export function guessHit(guesses: readonly NameGuess[], coins: readonly NameGuess[], top: number, p: NamesPolicy): boolean {
  return guesses.slice(0, top).some((g) => coins.some((c) => guessIsCoin(g, c, p)));
}

/**
 * A raw answer as a clean ranked list: names trimmed, '$' dropped, a ticker made from the name
 * when none came, a guess with neither dropped, and one guess per ticker (the first, best, wins).
 */
export function cleanGuesses(raw: readonly { readonly name?: unknown; readonly ticker?: unknown }[], p: NamesPolicy): readonly NameGuess[] {
  const out: NameGuess[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').replace(/^\$+/, '').trim() : '';
    const given = typeof r.ticker === 'string' ? cleanTicker(r.ticker, p.maxTickerChars) : '';
    const ticker = given !== '' ? given : cleanTicker(name, p.maxTickerChars);
    if (name === '' && ticker === '') continue;
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    out.push({ name: name === '' ? ticker : name, ticker });
    if (out.length >= p.guesses) break;
  }
  return out;
}

/**
 * The Create sheet's ideas with the namer's first: its first `lead` guesses whose ticker fits the
 * sheet's bars (the guess's own ticker, else one made from its name), then the judge's ideas, one
 * idea per ticker, at most `maxIdeas`. With no guesses this is the judge's ideas unchanged.
 */
export function guessesFirst(guesses: readonly NameGuess[], judgeIdeas: readonly NameIdea[], bars: NameIdeaBars & { readonly lead: number }): readonly NameIdea[] {
  const fits = (t: string) => t.length >= bars.minTicker && t.length <= bars.maxTicker;
  const lead = guesses.flatMap((g) => {
    const own = cleanTicker(g.ticker, Number.MAX_SAFE_INTEGER);
    const ticker = fits(own) ? own : tickerFor(g.name, bars);
    return ticker === null ? [] : [{ name: g.name, ticker }];
  }).slice(0, bars.lead);
  const seen = new Set<string>();
  const out: NameIdea[] = [];
  for (const idea of [...lead, ...judgeIdeas]) {
    if (seen.has(idea.ticker)) continue;
    seen.add(idea.ticker);
    out.push(idea);
    if (out.length >= bars.maxIdeas) break;
  }
  return out;
}
