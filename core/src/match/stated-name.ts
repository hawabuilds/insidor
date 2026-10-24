/**
 * THE NAME A POST STATES, AND THE COIN THAT CARRIES IT: when a post (or the judge, or the namer,
 * reading it) says what the coin is called and what its ticker is, a coin whose name AND ticker are
 * exactly that is the post's coin — over an earlier look-alike that only shares part of it.
 *
 * Its own file because it is a different kind of evidence from the matcher's name ties
 * (one-coin.ts `launchMatches`): those ask whether a coin's name OR ticker is one of the post's
 * names, which a copycat launched in the first seconds always satisfies. This asks whether the
 * coin carries the whole statement — both halves — which a copycat guessing at the name rarely
 * does, and the coin the creators actually launched does.
 *
 * The miss that made it (23 Oct): @Na1_N1ako said "The coin is officially called 'You Missed Coin'
 * so ticker should be BITCHES"; the judge named it YOU MISSED COIN with BITCHES beside it. A
 * copycat "You Missed Bitches" ($YMB), launched nine minutes before, was picked on the name; the
 * real "You Missed Coin" ($BITCHES), 71 minutes after the post, ran to millions and never took the
 * pick. And the origin post (@TocRadio, "a custom gold coin ... reads 'YOU MISSED BITCHES'") was
 * named YOU MISSED BITCHES: the real coin spells that statement as its name without the word
 * "coin" followed by its ticker — "You Missed" + "BITCHES".
 *
 * A coin STATES a post's name when, with the post's stated names S (the judge's, the namer's, and
 * the names the post's own words give after "called" / "named" / "ticker", and its cashtags):
 *   both   its name (or its name without a generic last word such as "coin") is in S AND its ticker
 *          is in S; or
 *   spelt  its name without the generic word, run together with its ticker, is in S.
 * Every comparison is on `compactName` (case, spaces and punctuation gone). A ticker shorter than
 * `minVariantLength` never states: "AI" is in thousands of posts' names. Nor does a coin whose ticker
 * is its name ("Kimchi" $KIMCHI): that is one half said twice, and every copycat of the name says it —
 * on 21-24 Oct it would have re-opened 30 posts' picks for one of a dozen $kimchi coins.
 *
 * What breaks if changed carelessly: requiring only one half. The name alone is what a copycat
 * copies, so a one-half rule would call the copycat stated too and the later coin could never
 * replace it; the copycat test case in stated-name.test.ts is the guard.
 */

import { compactName } from './post-coin.ts';

export interface StatedBars {
  readonly minVariantLength: number;
  /** Last words of a coin's name that carry no name of their own ("coin", "token"): dropped before comparing. */
  readonly genericWords: readonly string[];
}

/* "called 'X'" / "named “X”": a quoted name after the word. */
const CALLED = /\b(?:called|named)\s+["“'‘«]([^"”'’»\n]+)["”'’»]/giu;
/* "ticker should be X", "ticker: $X", "ticker is X". */
const TICKER = /\bticker\s*(?:(?:is|should be|will be|=|:)\s*)?\$?([\p{L}\p{N}]+)/giu;
/* A cashtag. */
const CASHTAG = /(?:^|[^\p{L}\p{N}$])\$([\p{L}][\p{L}\p{N}]*)/gu;

/** The names a post's own words state: quoted after "called" / "named", after "ticker", and its cashtags. */
export function statedInText(text: string | null | undefined): readonly string[] {
  if (text === null || text === undefined || text === '') return [];
  const out = new Set<string>();
  for (const re of [CALLED, TICKER, CASHTAG]) {
    for (const m of text.matchAll(re)) {
      const name = m[1]?.trim();
      if (name !== undefined && name !== '') out.add(name);
    }
  }
  return [...out];
}

/** The coin's name without a trailing generic word ("You Missed Coin" → "You Missed"), compacted; null when nothing is left. */
function nameCore(name: string, bars: StatedBars): string {
  const words = name.trim().split(/\s+/u);
  const generic = new Set(bars.genericWords.map(compactName));
  while (words.length > 1 && generic.has(compactName(words[words.length - 1] ?? ''))) words.pop();
  return compactName(words.join(' '));
}

/** Whether the coin carries the whole stated name: both its name and its ticker, or the two spelt together. */
export function statesName(stated: readonly string[], coin: { readonly name: string | null; readonly ticker: string | null }, bars: StatedBars): boolean {
  if (coin.name === null || coin.ticker === null) return false;
  const ticker = compactName(coin.ticker);
  if (ticker.length < bars.minVariantLength) return false;
  const s = new Set(stated.map(compactName).filter((x) => x !== ''));
  if (s.size === 0) return false;
  const full = compactName(coin.name);
  const core = nameCore(coin.name, bars);
  /* A coin whose ticker is its name ("Kimchi" $KIMCHI) states one thing, not two: every copycat of the name carries it. */
  if (core === '' || core === ticker || full === ticker) return false;
  const nameIn = s.has(full) || s.has(core);
  if (nameIn && s.has(ticker)) return true;
  return s.has(core + ticker);
}
