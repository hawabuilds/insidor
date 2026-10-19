/**
 * ONE POST, ONE COIN: which single coin a post (or a narrative) gets, chosen by who is actually
 * buying it in the minutes after its launch — or none, and the card offers Create.
 *
 * Two pure steps, both run by the runner (services/runner work/one-coin.ts) and by the replay
 * (tools/onecoin-replay.ts), so the rule that ships is the rule measured:
 *
 *   `launchMatches`  a new launch against the posts of the last hours, within seconds of it:
 *                    its metadata names the post (strongest), its name or ticker is exactly one of
 *                    the judge's or the namer's names, or its picture is the post's — the cheap
 *                    perceptual hash first, the embedding only on a coin a name or link already
 *                    tied (the caller pays for that, `wantsPicture` says when). A coin launched
 *                    more than `launchLeadMs` before the post is never a candidate by this path.
 *
 * ★ A SHORT TICKER NEEDS THE POST'S OWN WORDS. An exact name or ticker ties a launch; a looser
 * spelling does not, and a ticker under `minVariantLength` letters never counts as one. So "Rip Kim
 * Jong-Un" ($KIM) met none of 19 Oct's "KIMJONGUN" posts. `namedInText` ties it when the coin's
 * name meets the post's names at least as a variant AND the post's own words carry the ticker as a
 * whole word or the full name as a phrase of two words or more. Never the ticker alone: "Kim" is a
 * word in every post about any Kim, and a three-letter ticker is a word in thousands. Never the
 * phrase alone either: on 17-19 Oct it tied "Social Media" to a protest post that said "on social
 * media" and "its over" to a post on Kim Jong Un.
 *
 * ★ A LINK IS NOT BOUND BY THE WINDOW, AND IT REACHES ONE HOP. `postWindowMs` keeps a name or a
 * picture — facts any coin can share by chance — from tying a launch to a post of yesterday. A link
 * is the creators pointing at the post, which no chance produces, so it ties at any age. And a coin
 * often links its own account's quote or re-share of the viral post rather than the post itself
 * (HI, 19 Oct: launched 24 h after the baby post, linking its account's quote of it): the caller
 * passes those originals in `linksThrough`, and they tie as a link. One hop only — a quote of a
 * quote is somebody else's post, and following chains would tie a coin to whatever went viral first.
 *   `pickOneCoin`    the candidates' trading so far, judged from `judgeFromMs` after each launch
 *                    and again on every update:
 *                      out     the creator's wallet sold, or the cap fell under `rugShareOfPeak` of
 *                              its own peak (the replay's rugs: $508k at +10 min, $1.9k at +1 h)
 *                      pick    cap at least `minCapUsd`, net buying at least `leadRatio` times every
 *                              rival's, at least `minUniqueBuyers` distinct buyers
 *                      keep    a held coin is handed over only to a rival with `handOverRatio` times
 *                              its net buying; a held coin that goes out is dropped and the rest
 *                              judged afresh
 *                    otherwise no pick: `waiting` while there are candidates, `none` without.
 *
 * ★ WITHOUT TRADE DATA THE RULE SAYS SO. When the trade feed is not running (no internal
 * coin_trade_minute, or nothing written lately) the pick falls back to the replay's rule on market
 * readings — the cap's climb over the opening cap in place of net buying, no buyer bar, no creator
 * check — and `basis` says `market_readings`, so a shadow pick made on readings is never read as one
 * made on trades.
 *
 * ★ AN UNKNOWN IS NOT A ZERO. A candidate whose trading we could not read while the feed runs is
 * `unmeasured`: we cannot say anyone leads it three times on trades, so that post is judged on market
 * readings instead and `basis` says so (the owner's call, 2026-10-19). Holding every pick back
 * instead stalled each post with a graduated, capped or restart-hit rival, often the real winner,
 * until its watch ended. A watched coin with no trade yet is a measured zero: the feed would have
 * told us. On readings, a coin with no reading is simply not judged yet, as in the replay.
 *
 * ★ NOTHING HERE REACHES A SCREEN. The standings (net buying, buyers, why a coin is out) are kept
 * with the pick for the owner's tools and the refit; the card says only "Coin for this post: $X".
 *
 * What breaks if changed carelessly: the rival floor. Comparing against the rivals' net buying
 * floored at zero means a lone buyer of one coin among sellers of the others leads by any ratio; the
 * cap and buyer bars are what keep that from being a pick on a coin nobody wants. Drop either and a
 * thin coin with three wallets becomes the post's.
 */

import { hexHamming, isHexHash, BITS_PER_HEX_DIGIT } from '../bits.ts';
import { nameKey } from '../group/picture.ts';
import { compactName, nameMatch } from './post-coin.ts';

/* ── the matcher ───────────────────────────────────────────────────── */

export interface LaunchMatchBars {
  readonly launchLeadMs: number;
  readonly postWindowMs: number;
  readonly maxHashDistance: number;
  readonly minSimilarity: number;
  readonly minVariantLength: number;
}

/** A new launch, as the matcher needs it. Every absent fact is unknown, never "no". */
export interface LaunchSide {
  readonly address: string;
  readonly launchedAtMs: number;
  readonly name: string | null;
  readonly ticker: string | null;
  /** The posts its metadata names (internal.coin_post_link), by item id. */
  readonly linksPosts: ReadonlySet<string>;
  /**
   * The posts its linked posts quote or re-share (public.item reproduction_of / rebroadcast_of),
   * each with the linked post that points at it. One hop. Absent: none known.
   */
  readonly linksThrough?: ReadonlyMap<string, string>;
  /** Its picture's perceptual hash, hex; null when not hashed yet. */
  readonly hash: string | null;
  /** Its picture's embedding similarity to each post's, where both were embedded. */
  readonly similarity: ReadonlyMap<string, number>;
}

/** A recent post, as the matcher needs it. */
export interface MatchPost {
  readonly itemId: string;
  readonly postedAtMs: number;
  /** The judge's proposed and alternate names. */
  readonly judgeNames: readonly string[];
  /** The namer's guesses, names and tickers. */
  readonly guessNames: readonly string[];
  readonly hash: string | null;
  /** The post's own words; absent or null when not read. */
  readonly text?: string | null;
}

export type MatchEvidence = 'link' | 'name_judge' | 'name_guess' | 'name_text' | 'picture' | 'existing';

export interface LaunchMatch {
  readonly itemId: string;
  readonly address: string;
  readonly evidence: readonly MatchEvidence[];
  readonly hashDistance: number | null;
  readonly similarity: number | null;
  /** Launch minus post, ms: negative when the coin came first (inside `launchLeadMs`). */
  readonly launchedAfterMs: number;
  /** The coin's linked post that quotes or re-shares this one, when the link reached it that way. */
  readonly linkedThrough: string | null;
  /** A name or link tied it and its picture was not compared by embedding yet: worth paying for. */
  readonly wantsPicture: boolean;
}

/** Two hashes' distance in bits, or null when either is missing or they are not the same width. */
export function hashGap(a: string | null, b: string | null): number | null {
  if (a === null || b === null || a.length !== b.length) return null;
  const bits = a.length * BITS_PER_HEX_DIGIT;
  return isHexHash(a, bits) && isHexHash(b, bits) ? hexHamming(a, b) : null;
}

/** A post's words, normalised and space-padded so a phrase is found only as whole words. Kept per post. */
const wordsOf = new WeakMap<MatchPost, string>();
function postWords(p: MatchPost): string | null {
  if (p.text === undefined || p.text === null) return null;
  const known = wordsOf.get(p);
  if (known !== undefined) return known;
  const w = ` ${nameKey(p.text)} `;
  wordsOf.set(p, w);
  return w;
}

/**
 * The coin is named in the post's own words: its name meets the post's names at least as a variant,
 * and the words carry its ticker as a whole word or its full name as a phrase of two or more words
 * (a leading "the" not counted).
 */
export function namedInText(p: MatchPost, coin: { readonly name: string | null; readonly ticker: string | null }, bars: Pick<LaunchMatchBars, 'minVariantLength'>): boolean {
  const words = postWords(p);
  const names = [...p.judgeNames, ...p.guessNames];
  if (words === null || coin.name === null || names.length === 0) return false;
  const ticker = coin.ticker === null ? '' : nameKey(coin.ticker);
  const phrase = nameKey(coin.name).replace(/^the /, '');
  const said = (ticker !== '' && words.includes(` ${ticker} `)) || (phrase.includes(' ') && compactName(phrase).length >= bars.minVariantLength && words.includes(` ${phrase} `));
  return said && nameMatch(names, { name: coin.name, ticker: null }, bars) !== 'none';
}

/** The posts a launch could be the coin of, with what ties it to each. A launch tied to none is absent. */
export function launchMatches(coin: LaunchSide, posts: readonly MatchPost[], bars: LaunchMatchBars): readonly LaunchMatch[] {
  const out: LaunchMatch[] = [];
  for (const p of posts) {
    const after = coin.launchedAtMs - p.postedAtMs;
    if (after < -bars.launchLeadMs) continue;
    const through = coin.linksPosts.has(p.itemId) ? null : coin.linksThrough?.get(p.itemId) ?? null;
    const linked = coin.linksPosts.has(p.itemId) || through !== null;
    /* Past the window only a link ties: a name or a picture shared with yesterday's post is chance. */
    if (after > bars.postWindowMs && !linked) continue;
    const evidence: MatchEvidence[] = [];
    if (linked) evidence.push('link');
    const side = { name: coin.name, ticker: coin.ticker };
    if (p.judgeNames.length > 0 && nameMatch(p.judgeNames, side, bars) === 'exact') evidence.push('name_judge');
    if (p.guessNames.length > 0 && nameMatch(p.guessNames, side, bars) === 'exact') evidence.push('name_guess');
    if (!evidence.includes('name_judge') && !evidence.includes('name_guess') && namedInText(p, side, bars)) evidence.push('name_text');
    const gap = hashGap(coin.hash, p.hash);
    const similarity = coin.similarity.get(p.itemId) ?? null;
    if ((gap !== null && gap <= bars.maxHashDistance) || (similarity !== null && similarity >= bars.minSimilarity)) evidence.push('picture');
    if (evidence.length === 0) continue;
    const tied = evidence.some((e) => e !== 'picture');
    out.push({ itemId: p.itemId, address: coin.address, evidence, hashDistance: gap, similarity, launchedAfterMs: after, linkedThrough: through, wantsPicture: tied && similarity === null });
  }
  return out;
}

/**
 * The second path: a post that arrives after its coin exists. Of the coins of its exact name with
 * a recent reading at `minCapUsd` or more, the biggest — one candidate, judged by the same rule.
 */
export interface ExistingCoin {
  readonly address: string;
  readonly name: string | null;
  readonly ticker: string | null;
  readonly capUsd: number | null;
  readonly readAtMs: number | null;
}

export function biggestOfName<C extends ExistingCoin>(
  post: Pick<MatchPost, 'judgeNames' | 'guessNames' | 'postedAtMs'>,
  coins: readonly C[],
  bars: Pick<LaunchMatchBars, 'minVariantLength'> & { readonly readingWithinMs: number; readonly minCapUsd: number },
  nowMs: number,
): C | null {
  const names = [...post.judgeNames, ...post.guessNames];
  if (names.length === 0) return null;
  const live = coins.filter((c) => c.capUsd !== null && c.capUsd >= bars.minCapUsd && c.readAtMs !== null && nowMs - c.readAtMs <= bars.readingWithinMs && nameMatch(names, c, bars) === 'exact');
  return live.sort((a, b) => (b.capUsd ?? 0) - (a.capUsd ?? 0) || a.address.localeCompare(b.address))[0] ?? null;
}

/* ── the rule ──────────────────────────────────────────────────────── */

export interface OneCoinBars {
  readonly judgeFromMs: number;
  readonly confirmByMs: number;
  readonly minCapUsd: number;
  readonly leadRatio: number;
  readonly minUniqueBuyers: number;
  readonly handOverRatio: number;
  readonly rugShareOfPeak: number;
  readonly openingCapUsd: number;
}

/** A candidate's trading over its life so far (internal.coin_trade_minute and _state). */
export interface TradeFacts {
  readonly uniqueBuyers: number;
  /** Bought minus sold, in the chain's own currency. */
  readonly netBuy: number;
  readonly capUsd: number | null;
  /** The newest cap and the peak, in the chain's own currency: the rug test is a ratio of the two. */
  readonly cap: number | null;
  readonly peakCap: number | null;
  readonly creatorSold: boolean;
}

/** A candidate's market readings (public.market_reading): the newest cap and the highest so far. */
export interface MarketFacts {
  readonly capUsd: number;
  readonly peakCapUsd: number;
}

export interface Contender {
  readonly address: string;
  readonly launchedAtMs: number | null;
  /** The second path's coins are judged from when they became the post's candidate, not their launch. */
  readonly existingSinceMs?: number | null;
  readonly evidence: readonly MatchEvidence[];
  /** Its trading: facts; `quiet` (watched, no trade yet: a measured nothing); null (unknown). */
  readonly trades: TradeFacts | 'quiet' | null;
  readonly market: MarketFacts | null;
}

export type Basis = 'trades' | 'market_readings';
export type OutReason = 'creator_sold' | 'fell_from_peak';

/** How one candidate stood at this judgement. Kept with the pick; never shown. */
export interface Standing {
  readonly address: string;
  readonly evidence: readonly MatchEvidence[];
  readonly visible: boolean;
  readonly measured: boolean;
  /** Net buying on trades; the cap's climb over the opening cap on readings. */
  readonly strength: number | null;
  readonly uniqueBuyers: number | null;
  readonly capUsd: number | null;
  readonly out: OutReason | null;
  readonly clears: boolean;
}

export type WaitingReason = 'too_early' | 'under_bars' | 'no_clear_lead' | 'rival_unmeasured' | 'all_out';

export type OneCoinOutcome =
  | { readonly kind: 'picked'; readonly address: string; readonly sinceMs: number; readonly confirmed: boolean; readonly handedOverFrom: string | null; readonly basis: Basis; readonly standings: readonly Standing[] }
  | { readonly kind: 'waiting'; readonly reason: WaitingReason; readonly droppedHolder: string | null; readonly basis: Basis; readonly standings: readonly Standing[] }
  | { readonly kind: 'none' };

/** The coin held before this judgement, and since when. */
export interface Holder {
  readonly address: string;
  readonly sinceMs: number;
}

const visibleFrom = (c: Contender, bars: OneCoinBars): number | null =>
  c.existingSinceMs !== undefined && c.existingSinceMs !== null ? c.existingSinceMs : c.launchedAtMs === null ? null : c.launchedAtMs + bars.judgeFromMs;

function standingOf(c: Contender, basis: Basis, nowMs: number, bars: OneCoinBars): Standing {
  const from = visibleFrom(c, bars);
  const visible = from !== null && nowMs >= from;
  if (basis === 'trades') {
    const t = c.trades;
    if (t === null) return { address: c.address, evidence: c.evidence, visible, measured: false, strength: null, uniqueBuyers: null, capUsd: c.market?.capUsd ?? null, out: null, clears: false };
    const f: TradeFacts = t === 'quiet' ? { uniqueBuyers: 0, netBuy: 0, capUsd: null, cap: null, peakCap: null, creatorSold: false } : t;
    const out: OutReason | null = f.creatorSold ? 'creator_sold' : f.cap !== null && f.peakCap !== null && f.peakCap > 0 && f.cap < bars.rugShareOfPeak * f.peakCap ? 'fell_from_peak' : null;
    const capUsd = f.capUsd ?? c.market?.capUsd ?? null;
    const clears = out === null && capUsd !== null && capUsd >= bars.minCapUsd && f.uniqueBuyers >= bars.minUniqueBuyers && f.netBuy > 0;
    return { address: c.address, evidence: c.evidence, visible, measured: true, strength: f.netBuy, uniqueBuyers: f.uniqueBuyers, capUsd, out, clears };
  }
  const m = c.market;
  if (m === null) return { address: c.address, evidence: c.evidence, visible, measured: false, strength: null, uniqueBuyers: null, capUsd: null, out: null, clears: false };
  const out: OutReason | null = m.peakCapUsd > 0 && m.capUsd < bars.rugShareOfPeak * m.peakCapUsd ? 'fell_from_peak' : null;
  return { address: c.address, evidence: c.evidence, visible, measured: true, strength: Math.max(0, m.capUsd - bars.openingCapUsd), uniqueBuyers: null, capUsd: m.capUsd, out, clears: out === null && m.capUsd >= bars.minCapUsd };
}

/**
 * The post's (or narrative's) one coin now. `tradesRunning`: the trade feed wrote lately and these
 * candidates are watched; false falls back to the readings rule, said in `basis`.
 */
export function pickOneCoin(contenders: readonly Contender[], holder: Holder | null, nowMs: number, tradesRunning: boolean, bars: OneCoinBars): OneCoinOutcome {
  if (contenders.length === 0) return { kind: 'none' };
  const basis: Basis = tradesRunning ? 'trades' : 'market_readings';
  const standings = contenders.map((c) => standingOf(c, basis, nowMs, bars));
  const live = standings.filter((s) => s.visible && s.out === null);
  /* On readings an unread coin is not judged yet (the replay's rule); on trades it holds every pick back. */
  const judged = basis === 'trades' ? live : live.filter((s) => s.measured);
  const strength = (s: Standing): number => s.strength ?? 0;
  const ranked = judged.filter((s) => s.measured).sort((a, b) => strength(b) - strength(a) || a.address.localeCompare(b.address));
  const unmeasured = judged.some((s) => !s.measured);
  /* On readings the rival floor is one dollar of climb, as the replay's; on trades it is zero net buying. */
  const floor = basis === 'trades' ? 0 : 1;
  const contender = (a: string) => contenders.find((c) => c.address === a);
  const picked = (address: string, sinceMs: number, from: string | null): OneCoinOutcome => {
    const c = contender(address);
    const existing = c?.existingSinceMs ?? null;
    const confirmAt = existing !== null ? existing + bars.confirmByMs - bars.judgeFromMs : (c?.launchedAtMs ?? sinceMs) + bars.confirmByMs;
    return { kind: 'picked', address, sinceMs, confirmed: nowMs >= confirmAt, handedOverFrom: from, basis, standings };
  };

  const held = holder === null ? null : standings.find((s) => s.address === holder.address) ?? null;
  const holdStands = held !== null && held.out === null;
  if (holder !== null && holdStands) {
    const challenger = ranked.find((s) => s.address !== holder.address);
    const holdStrength = Math.max(held.strength ?? 0, floor);
    if (challenger !== undefined && challenger.clears && strength(challenger) >= bars.handOverRatio * holdStrength) return picked(challenger.address, nowMs, holder.address);
    return picked(holder.address, holder.sinceMs, null);
  }
  const dropped = holder === null ? null : holder.address;
  const wait = (reason: WaitingReason): OneCoinOutcome => ({ kind: 'waiting', reason, droppedHolder: dropped, basis, standings });
  if (standings.every((s) => !s.visible)) return wait('too_early');
  if (live.length === 0) return wait('all_out');
  if (basis === 'trades' && unmeasured) return pickOneCoin(contenders, holder, nowMs, false, bars);
  const top = ranked[0];
  if (top === undefined) return wait('too_early');
  if (!top.clears) return wait('under_bars');
  const rival = Math.max(floor, ...ranked.slice(1).map(strength));
  if (strength(top) < bars.leadRatio * rival) return wait('no_clear_lead');
  return picked(top.address, nowMs, dropped);
}

/**
 * The rule's bars from the policy, with a refit's numbers over them when one was applied
 * (internal.one_coin_fit, 0113). Every bar not in the refit stays the policy's.
 */
export function oneCoinBars(
  p: { readonly judgeFromMs: number; readonly confirmByMs: number; readonly minCapUsd: number; readonly leadRatio: number; readonly minUniqueBuyers: number; readonly handOverRatio: number; readonly rugShareOfPeak: number; readonly openingCapUsd: number },
  fit: Partial<Pick<OneCoinBars, 'minCapUsd' | 'leadRatio' | 'handOverRatio' | 'minUniqueBuyers'>> | null = null,
): OneCoinBars {
  return {
    judgeFromMs: p.judgeFromMs,
    confirmByMs: p.confirmByMs,
    minCapUsd: fit?.minCapUsd ?? p.minCapUsd,
    leadRatio: fit?.leadRatio ?? p.leadRatio,
    minUniqueBuyers: fit?.minUniqueBuyers ?? p.minUniqueBuyers,
    handOverRatio: fit?.handOverRatio ?? p.handOverRatio,
    rugShareOfPeak: p.rugShareOfPeak,
    openingCapUsd: p.openingCapUsd,
  };
}
