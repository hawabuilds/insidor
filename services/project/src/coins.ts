/**
 * ★ HOW A STORY GETS LINKED TO A COIN, GIVEN THERE IS NO story↔asset TABLE.
 *
 * There is no such table in migrations 0001–0009 and there must not be one. The link
 * between a moment and a token is a JUDGEMENT — somebody decided that this coin is what
 * that clip produced — and judgements live in internal.decisions with the evidence that
 * produced them attached. A public join table would be that judgement stored as though it
 * were a fact, with nothing recording who made it or what they saw. So the link is
 * DERIVED, here, from rows anybody can re-read: the story's `entitySpan` fingerprints and
 * public.asset's own observed symbol and name.
 *
 * TWO TESTS, AND THEY ARE DELIBERATELY DIFFERENT STRENGTHS:
 *
 *   CANDIDATE — which coins are even in the running.
 *     The coin shares at least one EVIDENTIAL normalised token with one of the story's
 *     spans — a token that is not already common property across the coins we hold. See
 *     `evidentialTokens` below for what "common property" means and why it is measured
 *     rather than listed, and the guard in `coinCandidates` for the one thing that
 *     measurement is never allowed to do: empty a row that had claimants. The statistic is
 *     counted over a table anybody can write to for the price of a mint, so "how common is
 *     this word" is a number an attacker moves — and the guard is what bounds what moving
 *     it can buy them. Retrieval is time-first and always bounded — window.ts opens the
 *     window at the story's earliest post where one exists, and where none does it hangs a
 *     bounded window on our own first sighting instead and marks the result as unable to
 *     support an ordering — but time alone is not enough and never was: at the rate coins
 *     are minted, "the same minute as this story" contains dozens of coins about something
 *     else entirely. Text is what keeps a stranger's coin off a row. See st_pigeon in
 *     tools/seed.mjs, whose window contains another story's CHILL and which must still
 *     project `none`.
 *
 *   CONFIDENT — which coins we are willing to NAME.
 *     The coin's normalised symbol OR its normalised name is EQUAL to one of those spans.
 *     Equal, not overlapping, and that difference is the whole file. One meme produced 306
 *     distinct tokens sharing a symbol; "soup" overlaps "throws the soup" and so does every
 *     one of the six coins in st_soup, so overlap would let us name whichever of them the
 *     query happened to return first. Equality cannot pick between six coins that all
 *     merely mention the soup — it declines, which is the correct answer and the one the
 *     `unsure` branch of the wire exists to carry.
 *
 * ★ ONE NORMALISATION, USED BY BOTH TESTS. `normalise` below is the single spelling of
 * "the same words" in this service. A second spelling is how the two halves silently
 * disagree — the candidate step admitting a coin the confident step can never match, or
 * worse, the reverse. tools/seed.mjs writes its span fingerprints through the identical
 * rule (its `norm`), which is why a span arrives already normalised and normalising it
 * again is a no-op rather than a correction.
 *
 * WHERE THIS BELONGS EVENTUALLY: core/src/resolve, which scores a candidate set on five
 * channels, applies the ambiguity margin and logs the whole feature vector against the
 * decision it reached. That stage does not run yet. What is here is the free, deterministic
 * part of it — text over public rows, no vendor read, no score, no threshold to tune — and
 * it is exactly the part that can be checked by hand from the seed. It says `unsure`
 * wherever the real stage would abstain, which is the safe direction to be approximate in:
 * this file can fail to name a coin, and it cannot name the wrong one.
 *
 * Pure, like project.ts: spans, coin rows and the corpus statistics in, a decision out. No
 * clock, no database. The statistics are the one input that is genuinely a measurement of
 * the store rather than of this story, and they arrive as an ARGUMENT for exactly that
 * reason — a decision that queries for its own evidence is a decision no test can pin and
 * no replay can reproduce. db.ts measures them; this file only reads them.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';

import type { CoinCandidate, CoinFacts, ProjectOptions } from './project.ts';
import { projectCoins } from './project.ts';
import type { WireCoinLink } from './wire.ts';

/**
 * THE one spelling of "the same words".
 *
 * Lowercased, every run of anything that is not a letter or a digit collapsed to a single
 * space, trimmed. So `'SOUPGATE'`, `'Soup Gate'` and `'soup-gate!'` become `'soupgate'`,
 * `'soup gate'` and `'soup gate'` — note that the first stays ONE token and the other two
 * become two, which is not a rounding error but the actual distinction the candidate test
 * turns on. A coin that welds its words together shares no token with a span that spaces
 * them, and it drops out of the running rather than being half-matched.
 *
 * Punctuation becoming a SPACE rather than nothing is the load-bearing choice here.
 * Deleting it instead would turn "soup-gate" into "soupgate" and quietly re-join words a
 * person deliberately separated.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The normalised words of a phrase. Empty in, empty out — never `['']`. */
function tokensOf(normalised: string): readonly string[] {
  return normalised === '' ? [] : normalised.split(' ');
}

/* ── how common a word already is ─────────────────────────────────────── */

/**
 * One row of the corpus the statistic is measured over: a symbol and a name as observed,
 * plus how many assets carry that exact pair.
 *
 * `assets` exists because of the shape of the real data rather than for elegance. Fifteen
 * separate mints in public.asset are all called "70m views in 3days no brainer" and four
 * are all called "alex is a nazi". Grouping identical pairs in SQL and carrying the count
 * transfers a hundred rows instead of two hundred and five, and it collapses exactly the
 * duplication that motivates this whole file — a spam campaign is one distinct name and
 * fifteen documents, and it must count as fifteen.
 */
export interface CorpusDoc {
  readonly ticker: string | null;
  readonly name: string | null;
  /** How many assets carry this exact (symbol, name) pair. Never zero. */
  readonly assets: number;
}

/**
 * How common each word is across the coins we hold, and how many coins that is.
 *
 * DOCUMENT frequency, not term frequency: a coin whose symbol repeats a word already in
 * its name counts ONCE. The distinction is not cosmetic — per-field counting reads "skin"
 * as 18 where the honest per-document count is 9, and it is per-document counting that
 * makes the identity in `coinCandidates` hold.
 */
export interface CorpusStats {
  /** word → number of distinct assets carrying it in symbol or name. Absent means zero. */
  readonly df: ReadonlyMap<string, number>;
  /** Number of assets measured. The denominator, and the honesty check on `df`. */
  readonly corpusSize: number;
}

/**
 * Count words across the coins we hold. Pure: rows in, two numbers out, no query.
 *
 * ★ IT USES `normalise` AND `tokensOf`, THE SAME TWO FUNCTIONS THE TEST BELOW USES, AND
 * THAT IS THE WHOLE REASON THIS IS TYPESCRIPT AND NOT A `group by` OVER A regexp IN SQL.
 * A statistic tokenised one way and applied to a test tokenised another way is a filter
 * that drops words it never counted and keeps words it counted twice, and it fails
 * silently — the row simply has a different number of coins on it, with nothing anywhere
 * saying why. One spelling of "the same words", already the load-bearing rule of this
 * file, has to cover the statistic too.
 */
export function corpusStats(docs: readonly CorpusDoc[]): CorpusStats {
  const df = new Map<string, number>();
  let corpusSize = 0;

  for (const doc of docs) {
    corpusSize += doc.assets;
    /* Both fields unioned into ONE set before counting, which is what makes this a
       document frequency: a coin called SOUP / "soup" contributes 1 to soup, not 2. */
    const distinct = new Set<string>();
    for (const field of [normalise(doc.ticker ?? ''), normalise(doc.name ?? '')]) {
      for (const word of tokensOf(field)) distinct.add(word);
    }
    for (const word of distinct) df.set(word, (df.get(word) ?? 0) + doc.assets);
  }

  return { df, corpusSize };
}

/**
 * ★ NO STATISTICS AT ALL, WHICH IS A STATE AND NOT AN ERROR.
 *
 * An empty corpus makes every `df` zero, so the FREQUENCY half of the test stops removing
 * anything and the candidate rule falls back to the one this file had before the ceiling
 * existed. That degradation is chosen, not tolerated, and it points the only safe way:
 * with no evidence about which words are common, over-matching inflates `claimCount`, the
 * story projects `unsure`, and the row offers NOTHING. Being stricter when the evidence is
 * weakest would instead produce `none` — the row offering CREATE for a coin that already
 * exists, on a story someone else already reached. Those two failures are not equally bad
 * and the tie is broken here.
 *
 * ★ THE LENGTH HALF STILL RUNS, and saying otherwise would be a lie a reader would only
 * catch by running it. `minTokenLength` is not a frequency test and has no `df` to go to
 * zero, so a one-character word is dropped at every corpus size including this one —
 * measured, st_chillguy has 7 candidates under the pre-ceiling rule and 3 against an empty
 * corpus, because the article "a" out of "just a chill guy" is gone either way. That is a
 * deliberate difference and not a regression: no true pair in the truth set turns on a
 * one-character word, and the guard in `coinCandidates` catches the case where it mattered.
 *
 * The state is also close to unreachable in production, and for a structural reason: the
 * corpus is the same table retrieval draws from, so a store with no statistics is a store
 * with no strangers' coins in it either. It is reachable in a unit test, which is what it
 * is exported for.
 */
export const NO_CORPUS: CorpusStats = corpusStats([]);

/**
 * The three numbers, read off the policy rather than typed here.
 *
 * They are `DEFAULT_POLICY.resolve.candidate*` and the reasoning behind each value —
 * including the measured sweep that put the floor at 6 and what evidence would move it —
 * lives there, next to the mint window, because a reader asking "why is that coin on the
 * row" must not have to find two files with two halves of the answer. This shape exists so
 * a test can sweep the ceiling with a literal instead of mutating a frozen policy.
 */
export interface CandidateTuning {
  readonly dfFloor: number;
  readonly dfFraction: number;
  readonly minTokenLength: number;
}

export const DEFAULT_CANDIDATE_TUNING: CandidateTuning = {
  dfFloor: DEFAULT_POLICY.resolve.candidateDfFloor,
  dfFraction: DEFAULT_POLICY.resolve.candidateDfFraction,
  minTokenLength: DEFAULT_POLICY.resolve.candidateMinTokenLength,
};

/**
 * The df at which a word stops being evidence, for a corpus of this size.
 *
 * `max(floor, ceil(fraction × size))`, and the floor is not a safety belt on the fraction —
 * it is the operative term for every corpus this product has ever had. At 205 assets the
 * fraction gives 7; below 200 assets it gives less than the floor and the floor is what
 * runs. A bare fraction rounds to 1 on a small store, and a ceiling of 1 drops every word
 * carried by any coin at all, which is every word that could ever match.
 */
function dfCeiling(corpusSize: number, tuning: CandidateTuning): number {
  return Math.max(tuning.dfFloor, Math.ceil(tuning.dfFraction * corpusSize));
}

/**
 * Which of a story's own words are allowed to put a coin in the running.
 *
 * A word is EVIDENTIAL when it is not already common property across the coins we hold. Two
 * ways to fail, and they catch different things — neither one is redundant:
 *
 *   df(word) >= ceiling — the word is already spread across the market. "the" sits at 23 of
 *     205; "views", "3days" and "brainer" sit at 15 each because ONE campaign minted the
 *     same name fifteen times. A hand-written stopword list catches the first kind and is
 *     blind to the second — measured, only 4 of the 27 words above df 6 in the real mints
 *     are stopwords, and the other 23 are campaign vocabulary that nobody would have
 *     thought to write down. This test catches both and keeps catching whatever is minted
 *     next, with nobody maintaining a list.
 *
 *   word.length < minTokenLength — a one-character word is not an identifier at any
 *     frequency. This is NOT a second frequency test dressed as a length test, and it is
 *     the reason the article "a" is gone: "a" sits at df 5, tied with "soup", and no
 *     frequency ceiling anywhere can separate them. Length can, and length is all it is
 *     asked to do — the threshold is 2, deliberately far below the 4 that would start
 *     hiding real three-letter tickers.
 *
 * ★ THE ONE THING THIS CANNOT DO, STATED PLAINLY. df cannot tell fifteen spam mints of one
 * name from fifteen coins named after one real viral moment; both are fifteen documents
 * carrying one word. A moment popular enough to spawn K coins makes its own word un-
 * evidential. That is the honest cost, `DEFAULT_POLICY.resolve` names the fix (bound the
 * corpus in time, do not raise K), and the equality exemption in `coinCandidates` is what
 * keeps the cost from ever reaching the coin we would have NAMED.
 */
function evidentialTokens(
  words: ReadonlySet<string>,
  corpus: CorpusStats,
  tuning: CandidateTuning,
): ReadonlySet<string> {
  const ceiling = dfCeiling(corpus.corpusSize, tuning);
  const evidential = new Set<string>();
  for (const word of words) {
    if (word.length < tuning.minTokenLength) continue;
    if ((corpus.df.get(word) ?? 0) >= ceiling) continue;
    evidential.add(word);
  }
  return evidential;
}

/**
 * The coins in the running for this story, each carrying whether we will name it.
 *
 * `spans` are the story's `entitySpan` fingerprint keys — the phrases that actually occur
 * in its members' text, not a list somebody typed about it. `coins` is whatever retrieval
 * returned; everything that fails the token test is DROPPED here rather than returned with
 * a flag, because the count of what survives is the number the user is shown (`claimCount`)
 * and it has to mean "coins that name themselves after this story", not "rows a query
 * happened to return".
 *
 * A story with no spans at all links to nothing. That is not a degenerate case to be
 * papered over with a time-only fallback: a story we have no phrase for is a story we
 * cannot say a coin is named after, and the honest projection of that is `none`.
 */
export function coinCandidates(
  spans: readonly string[],
  coins: readonly CoinFacts[],
  corpus: CorpusStats,
  tuning: CandidateTuning = DEFAULT_CANDIDATE_TUNING,
): readonly CoinCandidate[] {
  const phrases = new Set<string>();
  const words = new Set<string>();
  for (const span of spans) {
    const phrase = normalise(span);
    if (phrase === '') continue;
    phrases.add(phrase);
    for (const word of tokensOf(phrase)) words.add(word);
  }
  if (phrases.size === 0) return [];

  /* The story's words, minus the ones that are common property. Computed ONCE per story
     rather than per coin: it depends only on the spans and the corpus, and recomputing it
     inside the loop would make an O(coins) job out of an O(1) one for no new answer. */
  const evidential = evidentialTokens(words, corpus, tuning);

  const filtered = collect(coins, phrases, evidential);
  if (filtered.length > 0) return filtered;

  /**
   * ★ THE FILTER IS NEVER ALLOWED TO BE THE REASON A ROW SAYS `none`.
   *
   * Zero candidates projects `none`, which puts CREATE on the row — we would be telling a
   * user to mint a coin for a phrase that existing coins already use, on a story somebody
   * else already reached. That is the one failure this whole file ranks as materially
   * worse than uselessness, so the frequency ceiling is not permitted to cause it. When
   * the filter empties the set, the story is re-run against its UNFILTERED words: the
   * count comes back inflated, the row projects `unsure`, and it offers nothing at all.
   *
   * ★ THIS GUARD IS ON THE OUTCOME, NOT ON THE INPUT, AND THE DIFFERENCE IS THE WHOLE
   * POINT. The obvious version — "if every word of the story is common, keep them all" —
   * tests the wrong thing, because a story's words do not become common together. Measured
   * against the 205 assets in this store: st_soup's spans are "throws the soup", "kitchen
   * goes silent" and "nine second clip", and eight mints are enough to push "soup",
   * "kitchen" and "silent" over the ceiling while "throws", "goes", "nine", "second" and
   * "clip" sit at df 0 forever, because no coin is ever named after a verb. An input guard
   * looks at that story, sees five surviving words, concludes it has words of its own, and
   * never fires — while all six real soup claimants have already been filtered off the
   * row. The narrative filler that never matches anything is exactly what holds the input
   * guard open. Testing the outcome cannot be fooled that way: it asks whether the filter
   * actually cost us every coin, which is the only question that matters.
   *
   * ★ AND IT CANNOT PRODUCE A WRONG BUY, by construction rather than by measurement. Every
   * coin the ceiling drops is one the equality exemption below did not admit, so it is not
   * confident. If the filtered set is empty, the unfiltered set therefore holds no
   * confident coin either, and projectCoins has exactly one answer for a non-empty set with
   * nothing confident in it: `unsure`, no coin in the payload, no button. So the only
   * outcome reachable through this line is the useless-and-safe one.
   */
  return collect(coins, phrases, words);
}

/**
 * The candidate set for one admissible word list. Called twice at most — see the guard
 * above — which is why it is a function rather than a loop written out in place: the
 * filtered pass and the fallback pass have to be the SAME rule with a different word list,
 * and two copies of it are two rules that drift.
 */
function collect(
  coins: readonly CoinFacts[],
  phrases: ReadonlySet<string>,
  admissible: ReadonlySet<string>,
): CoinCandidate[] {
  const out: CoinCandidate[] = [];
  for (const coin of coins) {
    /* Both of the coin's names, tested together. `symbol` and `name` are OBSERVED fields
       with no unique constraint behind either of them (0005 says so twice), so neither is
       privileged: a coin may carry the story's phrase as its ticker, as its name, or as
       both, and there is no reading of the data that makes one of those the real one. */
    const names = [normalise(coin.ticker ?? ''), normalise(coin.name ?? '')].filter(
      (name) => name !== '',
    );

    /* EQUALITY, against the whole span. Not `includes`, not "starts with", not a distance.
       The moment this becomes an overlap the six coins of st_soup all become nameable and
       the row confidently offers one of them. Unchanged, and the reason it is computed
       HERE instead of at the push below is the exemption on the next line. */
    const equals = names.some((name) => phrases.has(name));

    /* ★ EQUALITY IS EXEMPT FROM THE FREQUENCY CEILING, and this is the one line that makes
       the filter safe to deploy. A coin whose entire normalised symbol or name IS one of
       the story's phrases is the coin this row would NAME. Without the exemption, a story
       whose own popularity pushed its word past the ceiling would lose that coin from the
       candidate set — and because confidence is only ever decided among candidates, losing
       it from the set hides it from the answer. It loosens nothing: `equals` is the
       confident test itself, so this admits exactly the coins the next line would have
       marked confident anyway, and `candidates ⊇ confident` holds by construction rather
       than by agreement between two expressions that could drift apart. */
    const shares = equals || names.some((name) => tokensOf(name).some((w) => admissible.has(w)));
    if (!shares) continue;

    out.push({ coin, confident: equals });
  }
  return out;
}

/**
 * The whole rule in one call: spans and coins in, the row's button out.
 *
 * The tag falls out of two counts and nothing else — no threshold, no tie-break, no
 * preference for the earliest mint or the biggest name:
 *
 *   0 candidates                 → `none`     the row offers Create
 *   ≥1 candidate, 0 confident    → `unsure`   the row offers NOTHING, and carries no coin
 *   exactly 1 confident          → `one`      the row offers Buy
 *   ≥2 confident                 → `several`  the row offers Compare
 *
 * The counting itself is projectCoins', so the union is constructed in exactly one place
 * and this function cannot grow a fifth answer.
 */
export function deriveCoinLink(
  spans: readonly string[],
  coins: readonly CoinFacts[],
  corpus: CorpusStats,
  options: ProjectOptions,
): WireCoinLink {
  return projectCoins(coinCandidates(spans, coins, corpus), options);
}
