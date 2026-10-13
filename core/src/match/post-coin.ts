/**
 * WHICH COIN, IF ANY, IS A FEED POST'S — PROVEN by a fact a person can check, otherwise RANKED.
 *
 * The post's names were searched (services/runner coin-lookup), and coins with its picture or
 * named by an address under it were added; each candidate is weighed here on these facts:
 *
 *   link       the coin's own links or description name this exact post (or its picture's id);
 *              weaker: they point at the poster's own account
 *   picture    the coin's picture against the post's: the embedding's similarity and the
 *              perceptual hash's distance (the caller measures both; core only reads them)
 *   words      the coin's description against the post's own words
 *   address    the coin's address posted in the replies under the post — by the poster's own
 *              account, or by how many others
 *   timing     launched after the post (a coin launched before it, beyond `launchAllowanceMs`, can
 *              never be its coin), and how many minutes after
 *   name       the subject's names against the coin's name and ticker, exact or a variant
 *   trading    buys in the hour after the post against the coin's usual hour, when measured
 *
 * PROVEN (the card's "Links this post", a Buy) is only one of, on exactly one candidate:
 *   (1) its links name this post;
 *   (2) its picture is the post's — near-identical by the embedding, or within
 *       `sameHashDistance` bits by the hash — launched after the post inside the window, while
 *       every other candidate in the window had its picture compared;
 *   (3) the poster's own account posted its address under the post, and it launched after it.
 * Two candidates with the same proving fact are a tie, and a tie proves nothing.
 *
 * LIKELY: when nothing proves a coin, every candidate gets a score — the weighted sum of its
 * signals (Policy.postCoin.weights, fitted on the gold set and refitted by the re-tune) — and
 * the top coin is likely when its share of the ranking (a softmax over the candidates and "none
 * of these", which scores 0) reaches `likelyMinShare`. A likely coin is first in the list and never carries a Buy as proven; the
 * score never leaves the server. Otherwise the answer is unsure (a ranked list) or none.
 *
 * Why proof is a rule and not a score: the card says WHY a coin is the post's, as facts. A sum
 * would let two weak facts outvote a missing strong one and the card could not say which fact
 * decided. The score only ORDERS what the facts could not settle.
 *
 * ★ AN UNKNOWN IS NOT A NO. Links not read, a picture not compared, replies not read, an unknown
 * launch: each counts neither for a coin nor against it, and adds nothing to its score.
 *
 * What breaks if changed carelessly: the "exactly one" clauses. Copycats often link the viral
 * post itself or reuse its picture; dropping the uniqueness test turns every copycat wave into a
 * proven Buy on whichever coin sorted first. Every bar and weight comes in through `MatchBars`;
 * core holds none.
 */

import type { Millis } from '@insidor/contracts';
import type { PostCoinWeights } from '@insidor/contracts/policy.ts';

import { nameKey } from '../group/picture.ts';
import { MS_PER_MINUTE } from '../math.ts';

/** The bars and weights the rule is applied with. The service passes them; every one is policy. */
export interface MatchBars {
  /** An origin is posted before the coin, with this much grace (Policy.origin.launchAllowanceMs). */
  readonly launchAllowanceMs: number;
  /** How long after the post a launch still counts as timing evidence. */
  readonly windowMs: number;
  /** A post id shorter than this is never looked for in a link: too likely to occur by chance. */
  readonly minLinkIdLength: number;
  /** A looser spelling only counts when its letters run at least this long. */
  readonly minVariantLength: number;
  /** Policy.postCoin's: the hash bar, the picture floor, the timing half-life, the words, the share, the weights. */
  readonly sameHashDistance: number;
  readonly pictureFloor: number;
  readonly timingHalfLifeMin: number;
  readonly descriptionMinWord: number;
  readonly likelyMinShare: number;
  readonly weights: PostCoinWeights;
}

/** The post, as the rule needs it. */
export interface PostSide {
  readonly postedAt: Millis | null;
  /** The post's ids as a link would carry them: its own id on its source, and its pictures' ids. */
  readonly linkIds: readonly string[];
  /** The subject's names: the judge's proposed name first, then its alternates. */
  readonly names: readonly string[];
  /** The poster's handle on the source, without the @; null when unknown. */
  readonly author?: string | null;
  /** The post's own words; null when not read. */
  readonly text?: string | null;
}

/** One candidate coin, with what we could read of it. Every optional fact absent is unknown. */
export interface CoinSide {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly launchedAt: Millis | null;
  /** The coin's own links and description, as its creator wrote them; null when not read. */
  readonly links: readonly string[] | null;
  /** The embedding's picture verdict (`postPictureVerdict`); null when not compared. */
  readonly samePicture: boolean | null;
  /** The embedding's cosine similarity of the two pictures; null when not compared. */
  readonly pictureSimilarity?: number | null;
  /** Bits that differ between the two pictures' perceptual hashes (0–64); null when not hashed. */
  readonly hashDistance?: number | null;
  /** The coin's description alone; null when not read or none. */
  readonly description?: string | null;
  /** The poster's own account posted this coin's address under the post (or in it); null when the replies were not read. */
  readonly addressByAuthor?: boolean | null;
  /** How many other accounts posted it there; null when not read. */
  readonly addressByOthers?: number | null;
  /** Buys in the hour after the post over the coin's usual hour; null when not measured. */
  readonly tradingJump?: number | null;
}

export type NameMatch = 'exact' | 'variant' | 'none';
export type ProvenBy = 'links' | 'pictureAndTiming' | 'authorPostedAddress';

/** What we know about one coin against the post — facts, each null when not known — and its rank score. */
export interface CoinEvidence {
  readonly address: string;
  readonly linksPost: boolean | null;
  /** The coin's links point at the poster's account (and not at this post). */
  readonly linksAccount: boolean | null;
  /** The same picture, by the embedding or the hash; null when neither was compared. */
  readonly samePicture: boolean | null;
  readonly pictureSimilarity: number | null;
  readonly hashDistance: number | null;
  /** Share of the description's words found in the post's words; null when either is unknown. */
  readonly descriptionMatch: number | null;
  readonly addressByAuthor: boolean | null;
  readonly addressByOthers: number | null;
  /** The coin's launch minus the post's time: positive after, negative before. */
  readonly launchedAfterMs: number | null;
  /** Launched after the post (with the grace) and within the window. */
  readonly inWindow: boolean;
  /** Launched before the post beyond the grace: never this post's coin. */
  readonly before: boolean;
  readonly name: NameMatch;
  readonly tradingJump: number | null;
  readonly launchedAt: Millis | null;
  /** The weighted sum of the signals (internal: orders the list, never shown). */
  readonly score: number;
  /** Its share of the ranking among the candidates that could be the post's (softmax). */
  readonly share: number;
}

export type PostCoinMatch =
  | { readonly kind: 'confident'; readonly address: string; readonly because: ProvenBy; readonly ranked: readonly CoinEvidence[] }
  | { readonly kind: 'unsure'; readonly likely: string | null; readonly ranked: readonly CoinEvidence[] }
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

/** Whether two spellings are one letter apart: one changed, added or dropped ("Goliath", "Golaith" is two). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const rest = (x: string, skip: number) => x.slice(i + skip);
  return rest(a, 1) === rest(b, 1) || rest(a, 1) === rest(b, 0) || rest(a, 0) === rest(b, 1);
}

/** The post's words run together one, two and three at a time: "Six Flags" is "sixflags". */
function wordRuns(text: string): readonly string[] {
  const ws = nameKey(text).split(' ').filter((w) => w !== '');
  return ws.flatMap((w, i) => [w, w + (ws[i + 1] ?? ''), w + (ws[i + 1] ?? '') + (ws[i + 2] ?? '')]);
}

/**
 * How the subject's names meet a coin's name and ticker. A leading "the" never matters.
 *   exact    the same once spaces and punctuation go
 *   variant  at least `minVariantLength` letters and: the same skeleton (PNUT, Peanut); one inside
 *            the other (RIPGOLIATH, GOLIATH); a short form at the start (GOLI, GOLIATH); one letter
 *            apart (a misspelling); or the coin's name is words the post itself says (SIXFLAGS
 *            under a post about Six Flags)
 */
export function nameMatch(names: readonly string[], coin: Pick<CoinSide, 'name' | 'ticker'>, bars: Pick<MatchBars, 'minVariantLength'>, postText: string | null = null): NameMatch {
  const strip = (s: string) => compactName(s.replace(/^\s*the\s+/i, ''));
  const mine = names.map(strip).filter((n) => n !== '');
  const theirs = [coin.name, coin.ticker].flatMap((n) => (n === null ? [] : [strip(n)])).filter((n) => n !== '');
  if (mine.some((m) => theirs.includes(m))) return 'exact';
  const long = (s: string) => s.length >= bars.minVariantLength;
  const mineSk = new Set(mine.filter(long).map(skeleton));
  if (theirs.filter(long).some((t) => mineSk.has(skeleton(t)))) return 'variant';
  const pairs = mine.filter(long).flatMap((m) => theirs.filter(long).map((t) => [m, t] as const));
  /* One spelled inside the other ("pnut" in "pnutcoin"), or a short form at its start. */
  if (pairs.some(([m, t]) => t.includes(m) || m.includes(t))) return 'variant';
  /* A misspelling: one letter apart, both longer than the variant bar (short names collide). */
  if (pairs.some(([m, t]) => m.length > bars.minVariantLength && t.length > bars.minVariantLength && oneEditApart(m, t))) return 'variant';
  if (postText !== null) {
    const runs = new Set(wordRuns(postText));
    if (theirs.some((t) => long(t) && runs.has(t))) return 'variant';
  }
  return 'none';
}

/** Whether any of the coin's links carries one of the post's ids as a whole token. */
export function linksPost(links: readonly string[] | null, ids: readonly string[], bars: Pick<MatchBars, 'minLinkIdLength'>): boolean | null {
  if (links === null) return null;
  const usable = ids.filter((id) => id.length >= bars.minLinkIdLength);
  if (usable.length === 0) return null;
  return links.some((link) => usable.some((id) => new RegExp(`(?<![A-Za-z0-9])${escape(id)}(?![A-Za-z0-9])`).test(link)));
}

/** Whether any of the coin's links is the poster's account (its profile, or a post of its own). */
export function linksAccount(links: readonly string[] | null, author: string | null | undefined): boolean | null {
  if (links === null || author === null || author === undefined || author === '') return null;
  const handle = escape(author.toLowerCase());
  /* Any host whose first path segment is the handle (with or without @): a source's profile or post link. */
  const profile = new RegExp(`^(?:https?://)?[^/\\s]+/@?${handle}(?:[/?#]|$)`, 'i');
  return links.some((l) => profile.test(l.trim().toLowerCase()));
}

/** Share of the description's words (`descriptionMinWord` letters or more) the post's words also hold. */
export function descriptionMatch(description: string | null | undefined, text: string | null | undefined, bars: Pick<MatchBars, 'descriptionMinWord'>): number | null {
  if (description === null || description === undefined || text === null || text === undefined) return null;
  const words = (s: string) => new Set(nameKey(s.replace(/https?:\/\/\S+/g, ' ')).split(' ').filter((w) => w.length >= bars.descriptionMinWord));
  const theirs = words(description);
  if (theirs.size === 0) return null;
  const mine = words(text);
  return [...theirs].filter((w) => mine.has(w)).length / theirs.size;
}

/** The signals the score weighs, each 0 when unknown: an unknown adds nothing for a coin. */
export function signals(e: Omit<CoinEvidence, 'score' | 'share'>, bars: Pick<MatchBars, 'sameHashDistance' | 'pictureFloor' | 'timingHalfLifeMin'>): Record<keyof PostCoinWeights, number> {
  const after = e.launchedAfterMs;
  return {
    base: 1,
    linksPost: e.linksPost === true ? 1 : 0,
    linksAccount: e.linksAccount === true && e.linksPost !== true ? 1 : 0,
    picture: e.pictureSimilarity === null ? 0 : Math.max(0, (e.pictureSimilarity - bars.pictureFloor) / (1 - bars.pictureFloor)),
    hash: e.hashDistance === null ? 0 : Math.max(0, 1 - e.hashDistance / (2 * bars.sameHashDistance)),
    description: e.descriptionMatch ?? 0,
    authorAddress: e.addressByAuthor === true ? 1 : 0,
    othersAddress: (e.addressByOthers ?? 0) > 0 ? 1 : 0,
    timing: e.inWindow && after !== null ? Math.pow(2, -Math.max(0, after) / MS_PER_MINUTE / bars.timingHalfLifeMin) : 0,
    nameExact: e.name === 'exact' ? 1 : 0,
    nameVariant: e.name === 'variant' ? 1 : 0,
    /* 0 at the usual hour, a half at twice it, four fifths at five times. */
    tradingJump: e.tradingJump === null || e.tradingJump <= 1 ? 0 : 1 - 1 / e.tradingJump,
  };
}

/** The weighted sum of a coin's signals. */
export function scoreOf(sig: Record<keyof PostCoinWeights, number>, w: PostCoinWeights): number {
  return (Object.keys(w) as (keyof PostCoinWeights)[]).reduce((sum, k) => sum + w[k] * sig[k], 0);
}

export function coinEvidence(post: PostSide, coin: CoinSide, bars: MatchBars): Omit<CoinEvidence, 'share'> {
  const after = post.postedAt === null || coin.launchedAt === null ? null : coin.launchedAt - post.postedAt;
  const hashDistance = coin.hashDistance ?? null;
  const byHash = hashDistance === null ? null : hashDistance <= bars.sameHashDistance;
  /* The hash's yes is a yes; a no needs both to say no, since either may miss a recoloured copy. */
  const samePicture = coin.samePicture === true || byHash === true ? true : coin.samePicture === false || byHash === false ? false : null;
  const e = {
    address: coin.address,
    linksPost: linksPost(coin.links, post.linkIds, bars),
    linksAccount: linksAccount(coin.links, post.author),
    samePicture,
    pictureSimilarity: coin.pictureSimilarity ?? null,
    hashDistance,
    descriptionMatch: descriptionMatch(coin.description, post.text, bars),
    addressByAuthor: coin.addressByAuthor ?? null,
    addressByOthers: coin.addressByOthers ?? null,
    launchedAfterMs: after,
    inWindow: after !== null && after >= -bars.launchAllowanceMs && after <= bars.windowMs,
    before: after !== null && after < -bars.launchAllowanceMs,
    name: nameMatch(post.names, coin, bars, post.text ?? null),
    tradingJump: coin.tradingJump ?? null,
    launchedAt: coin.launchedAt,
  };
  return { ...e, score: scoreOf(signals(e, bars), bars.weights) };
}

/** Proven first (by the strength of what proved it), then by score, then the earliest launch. */
export function byEvidence(a: CoinEvidence, b: CoinEvidence): number {
  if (a.before !== b.before) return a.before ? 1 : -1;
  const d = b.score - a.score;
  if (d !== 0) return d;
  const la = a.launchedAt ?? Number.POSITIVE_INFINITY;
  const lb = b.launchedAt ?? Number.POSITIVE_INFINITY;
  return la - lb || a.address.localeCompare(b.address);
}

/** The rule in the header, over every candidate. */
export function matchPostCoin(post: PostSide, coins: readonly CoinSide[], bars: MatchBars): PostCoinMatch {
  if (coins.length === 0) return { kind: 'none' };
  const weighed = coins.map((c) => coinEvidence(post, c, bars));
  const possible = weighed.filter((e) => !e.before);
  /* "None of these" is one more option, scoring 0: a share is against it too, so a lone weak coin is not likely. */
  const top = possible.reduce((m, e) => Math.max(m, e.score), 0);
  const total = possible.reduce((sum, e) => sum + Math.exp(e.score - top), Math.exp(-top));
  const withShare = (e: Omit<CoinEvidence, 'share'>): CoinEvidence => ({ ...e, share: e.before ? 0 : Math.exp(e.score - top) / total });
  const only = <T>(xs: readonly T[]): T | null => (xs.length === 1 ? (xs[0] ?? null) : null);
  const proven = (address: string, because: ProvenBy): PostCoinMatch => {
    const ranked = weighed.map(withShare).sort((a, b) => (a.address === address ? -1 : b.address === address ? 1 : byEvidence(a, b)));
    return { kind: 'confident', address, because, ranked };
  };

  const linking = possible.filter((e) => e.linksPost === true);
  const link = only(linking);
  if (link !== null) return proven(link.address, 'links');

  if (linking.length === 0) {
    const pictured = only(possible.filter((e) => e.samePicture === true && e.inWindow));
    const uncompared = possible.some((e) => e.inWindow && e.samePicture === null);
    if (pictured !== null && !uncompared) return proven(pictured.address, 'pictureAndTiming');

    const posted = only(possible.filter((e) => e.addressByAuthor === true && e.launchedAfterMs !== null));
    if (posted !== null) return proven(posted.address, 'authorPostedAddress');
  }

  const ranked = weighed.map(withShare).sort(byEvidence);
  const first = ranked[0];
  const likely = first !== undefined && !first.before && first.share >= bars.likelyMinShare ? first.address : null;
  return { kind: 'unsure', likely, ranked };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
