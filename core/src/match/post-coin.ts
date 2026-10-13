/**
 * WHICH COIN, IF ANY, IS A FEED POST'S — ranked by evidence, decided by a rule a person can read.
 *
 * The post's name was searched (services/runner coin-lookup) and some coins came back. Each one
 * is weighed here on four kinds of evidence, strongest first:
 *
 *   1. links    the coin's own links or description name this exact post, or its picture
 *   2. picture  the coin's picture is the post's: near-identical (`postPictureVerdict`; the
 *               caller hands in the verdict, never asks here)
 *   3. timing   launched after the post, within `windowMs`. A coin launched before the post
 *               (beyond `launchAllowanceMs`, the origin rule's grace) can never be its coin
 *   4. name     the subject's names against the coin's name and ticker: the same once spaces
 *               and punctuation go (`exact`), or a looser spelling (`variant`)
 *
 * CONFIDENT is only: (1) on exactly one coin; or (2)+(3) on exactly one coin while every other
 * coin in the window has had its picture compared. Anything else is unsure, and an unsure answer
 * carries no coin a button could be built from. ★ A NAME NEVER MAKES A CARD CONFIDENT (since
 * 2026-10-13): with every name searched and nearly every coin's metadata read, the gold set's
 * "launched after, the only coin of the name" answers were 4 wrong and 0 right that the other
 * routes did not already find (eval/src/gold/matching-report.md). Names only order the list.
 * And "only one has the same picture" is not a claim we can make while another coin in the
 * window has a picture we never compared: on gold that was a wrong link.
 *
 * Why a fixed rule and not a weighted sum: the card says WHY it matched as facts ("Links this
 * post", "Same picture", "Launched 12m after"). A sum would let two weak facts outvote a
 * missing strong one, and the card could not say which fact decided. The ranking below is a
 * lexicographic order on the same facts, so the list and the card can never disagree.
 *
 * ★ AN UNKNOWN IS NOT A NO. A coin whose links we could not read has `linksPost: null`, a
 * picture not compared has `samePicture: null`, an unknown launch has `launchedAfterMs: null`.
 * None of them counts for the coin, and none counts against it either; a coin whose launch is
 * unknown can never be confident on timing.
 *
 * What breaks if changed carelessly: the "only one" clauses. Two coins that both link the
 * post (copycats often link the viral post itself) or both show its picture are a tie, and a
 * tie is unsure. Dropping the uniqueness test turns every copycat wave into a confident Buy on
 * whichever coin happened to sort first. Every bar comes in through `MatchBars`; core holds none.
 */

import type { Millis } from '@insidor/contracts';

import { nameKey } from '../group/picture.ts';

/** The bars the rule is applied with. The service passes them; every one is a policy number. */
export interface MatchBars {
  /** An origin is posted before the coin, with this much grace (Policy.origin.launchAllowanceMs). */
  readonly launchAllowanceMs: number;
  /** How long after the post a launch still counts as timing evidence. */
  readonly windowMs: number;
  /** A post id shorter than this is never looked for in a link: too likely to occur by chance. */
  readonly minLinkIdLength: number;
  /** A looser spelling only counts when its letters run at least this long. */
  readonly minVariantLength: number;
}

/** The post, as the rule needs it. */
export interface PostSide {
  readonly postedAt: Millis | null;
  /** The post's ids as a link would carry them: its own id on its source, and its pictures' ids. */
  readonly linkIds: readonly string[];
  /** The subject's names: the judge's proposed name first, then its alternates. */
  readonly names: readonly string[];
}

/** One coin the post's name search found, with what we could read of it. */
export interface CoinSide {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: Millis | null;
  /** The coin's own links and description, as its creator wrote them; null when not read. */
  readonly links: readonly string[] | null;
  /** The picture verdict (`pictureVerdict`); null when the two pictures were not compared. */
  readonly samePicture: boolean | null;
}

export type NameMatch = 'exact' | 'variant' | 'none';

/** What we know about one coin against the post — facts only, each null when not known. */
export interface CoinEvidence {
  readonly address: string;
  readonly linksPost: boolean | null;
  readonly samePicture: boolean | null;
  /** The coin's launch minus the post's time: positive after, negative before. */
  readonly launchedAfterMs: number | null;
  /** Launched after the post (with the grace) and within the window. */
  readonly inWindow: boolean;
  /** Launched before the post beyond the grace: never this post's coin. */
  readonly before: boolean;
  readonly name: NameMatch;
  readonly launchedAt: Millis | null;
}

export type PostCoinMatch =
  | { readonly kind: 'confident'; readonly address: string; readonly because: 'links' | 'pictureAndTiming'; readonly ranked: readonly CoinEvidence[] }
  | { readonly kind: 'unsure'; readonly ranked: readonly CoinEvidence[] }
  | { readonly kind: 'none' };

/** Same picture: near-identical, or borderline and confirmed the same subject. Null: not compared. */
export function pictureVerdict(
  similarity: number | null,
  confirmed: boolean | null,
  bars: { readonly nearIdentical: number; readonly borderline: number },
): boolean | null {
  if (similarity === null) return null;
  if (similarity >= bars.nearIdentical) return true;
  if (similarity < bars.borderline) return false;
  return confirmed;
}

/**
 * Same picture, for a post's coin: near-identical only. A borderline pair the judge called "the
 * same subject" is NOT the same picture — on the gold set (2026-10-13) every confident link made
 * on a judge's "same subject" between the bars was a different coin from the gold's, or an
 * unrelated post's — so the judge's yes leaves it unknown, and only its no counts against.
 * The origin check (`matchCandidates`) still takes a confirmed subject; there the name is
 * required too.
 */
export function postPictureVerdict(
  similarity: number | null,
  said: 'yes' | 'no' | 'unsure' | null,
  bars: { readonly nearIdentical: number; readonly borderline: number },
): boolean | null {
  return pictureVerdict(similarity, said === 'no' ? false : null, bars);
}

/** A name with spaces and punctuation gone: "Moo Deng!" and "moodeng" are one name. */
export function compactName(name: string): string {
  return nameKey(name).replace(/\s+/g, '');
}

/** Doubled letters squashed and the vowels after the first letter dropped: "Peanut" and "PNUT" share "pnt". */
export function skeleton(name: string): string {
  const compact = compactName(name).replace(/(.)\1+/gu, '$1');
  return compact.slice(0, 1) + compact.slice(1).replace(/[aeiouy]/g, '');
}

/** How the subject's names meet a coin's name and ticker. A leading "the" never matters. */
export function nameMatch(names: readonly string[], coin: Pick<CoinSide, 'name' | 'ticker'>, bars: Pick<MatchBars, 'minVariantLength'>): NameMatch {
  const strip = (s: string) => compactName(s.replace(/^\s*the\s+/i, ''));
  const mine = names.map(strip).filter((n) => n !== '');
  const theirs = [coin.name, coin.ticker].flatMap((n) => (n === null ? [] : [strip(n)])).filter((n) => n !== '');
  if (mine.some((m) => theirs.includes(m))) return 'exact';
  const long = (s: string) => s.length >= bars.minVariantLength;
  const mineSk = new Set(mine.filter(long).map(skeleton));
  if (theirs.filter(long).some((t) => mineSk.has(skeleton(t)))) return 'variant';
  /* One spelled inside the other ("pnut" in "pnutcoin"), both long enough to mean it. */
  if (mine.some((m) => long(m) && theirs.some((t) => long(t) && (t.includes(m) || m.includes(t))))) return 'variant';
  return 'none';
}

/** Whether any of the coin's links carries one of the post's ids as a whole token. */
export function linksPost(links: readonly string[] | null, ids: readonly string[], bars: Pick<MatchBars, 'minLinkIdLength'>): boolean | null {
  if (links === null) return null;
  const usable = ids.filter((id) => id.length >= bars.minLinkIdLength);
  if (usable.length === 0) return null;
  return links.some((link) => usable.some((id) => new RegExp(`(?<![A-Za-z0-9])${escape(id)}(?![A-Za-z0-9])`).test(link)));
}

export function coinEvidence(post: PostSide, coin: CoinSide, bars: MatchBars): CoinEvidence {
  const after = post.postedAt === null || coin.launchedAt === null ? null : coin.launchedAt - post.postedAt;
  return {
    address: coin.address,
    linksPost: linksPost(coin.links, post.linkIds, bars),
    samePicture: coin.samePicture,
    launchedAfterMs: after,
    inWindow: after !== null && after >= -bars.launchAllowanceMs && after <= bars.windowMs,
    before: after !== null && after < -bars.launchAllowanceMs,
    name: nameMatch(post.names, coin, bars),
    launchedAt: coin.launchedAt,
  };
}

const NAME_RANK: Record<NameMatch, number> = { exact: 2, variant: 1, none: 0 };

/**
 * Strongest evidence first, then the earliest launch: links, then picture, then timing, then
 * name. A coin launched before the post goes last, whatever else it has.
 */
export function byEvidence(a: CoinEvidence, b: CoinEvidence): number {
  const key = (e: CoinEvidence) => [e.before ? 0 : 1, e.linksPost === true ? 1 : 0, e.samePicture === true ? 1 : 0, e.inWindow ? 1 : 0, NAME_RANK[e.name]];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i += 1) {
    const d = (kb[i] ?? 0) - (ka[i] ?? 0);
    if (d !== 0) return d;
  }
  const la = a.launchedAt ?? Number.POSITIVE_INFINITY;
  const lb = b.launchedAt ?? Number.POSITIVE_INFINITY;
  return la - lb || a.address.localeCompare(b.address);
}

/** The rule in the header, over every coin the search found. */
export function matchPostCoin(post: PostSide, coins: readonly CoinSide[], bars: MatchBars): PostCoinMatch {
  if (coins.length === 0) return { kind: 'none' };
  const ranked = coins.map((c) => coinEvidence(post, c, bars)).sort(byEvidence);
  const possible = ranked.filter((e) => !e.before);
  const only = <T>(xs: readonly T[]): T | null => (xs.length === 1 ? (xs[0] ?? null) : null);

  const linking = only(possible.filter((e) => e.linksPost === true));
  if (linking !== null) return { kind: 'confident', address: linking.address, because: 'links', ranked };
  if (possible.some((e) => e.linksPost === true)) return { kind: 'unsure', ranked };

  const pictured = possible.filter((e) => e.samePicture === true && e.inWindow);
  const picture = only(pictured);
  const uncompared = possible.some((e) => e.inWindow && e.samePicture === null);
  if (picture !== null && !uncompared) return { kind: 'confident', address: picture.address, because: 'pictureAndTiming', ranked };
  return { kind: 'unsure', ranked };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
