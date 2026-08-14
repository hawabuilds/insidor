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
 *     The coin shares at least one normalised TOKEN with one of the story's spans.
 *     Retrieval is time-first where a time exists (db.ts opens the window at the story's
 *     earliest post), but time alone is not enough and never was: at the rate coins are
 *     minted, "the same minute as this story" contains dozens of coins about something
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
 * Pure, like project.ts: spans and coin rows in, a decision out. No clock, no database.
 */

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

  const out: CoinCandidate[] = [];
  for (const coin of coins) {
    /* Both of the coin's names, tested together. `symbol` and `name` are OBSERVED fields
       with no unique constraint behind either of them (0005 says so twice), so neither is
       privileged: a coin may carry the story's phrase as its ticker, as its name, or as
       both, and there is no reading of the data that makes one of those the real one. */
    const names = [normalise(coin.ticker ?? ''), normalise(coin.name ?? '')].filter(
      (name) => name !== '',
    );

    const shares = names.some((name) => tokensOf(name).some((word) => words.has(word)));
    if (!shares) continue;

    /* EQUALITY, against the whole span. Not `includes`, not "starts with", not a distance.
       The moment this becomes an overlap the six coins of st_soup all become nameable and
       the row confidently offers one of them. */
    out.push({ coin, confident: names.some((name) => phrases.has(name)) });
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
  options: ProjectOptions,
): WireCoinLink {
  return projectCoins(coinCandidates(spans, coins), options);
}
