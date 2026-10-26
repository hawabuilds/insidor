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
 *   `pickOneCoin`    the candidates' trading so far, judged from `judgeFromMs` after each launch
 *                    and again on every update:
 *                      out     the creator's wallet sold, or the cap fell under `rugShareOfPeak` of
 *                              its own peak (the replay's rugs: $508k at +10 min, $1.9k at +1 h)
 *                      pick    cap at least `minCapUsd`, net buying at least `leadRatio` times every
 *                              rival's, at least `minUniqueBuyers` distinct buyers
 *                      keep    a held coin is handed over only to a rival with `handOverRatio` times
 *                              its net buying; a held coin that goes out is dropped and the rest
 *                              judged afresh — except a fall from its peak, see below
 *                    otherwise no pick: `waiting` while there are candidates, `none` without.
 *
 * ★ A HELD COIN THAT DIPS IS NOT A RUG YET. A coin we hold that falls under `rugShareOfPeak` stays
 * the post's coin on grace until its cap is also under `rugFloorUsd`, or it has stayed under the
 * share for `rugGraceMs`, or a rival clears the bars and leads it `leadRatio` times. The creator
 * selling is still out at once. $Laura (20 Oct): $51k peak, $12-18k for eighteen minutes, then
 * $219k after a big repost — the bare share rule blanked the card ("No coin yet") through the dip.
 * Replayed on readings since live, the floor alone told the coins apart: every kept coin that never
 * came back had fallen to $2-6k, and every one held over $10k was still trading. A coin not yet
 * held keeps the bare rule: a fall before we ever showed it is evidence against it.
 *
 * Two more for a held coin (25 Oct, $Marvin): one still worth `rugKeepAboveUsd` is never dropped for
 * time under the share alone, and one under the share loses the pick at once to a rival made for
 * the post worth `crashCapRatio` times its cap (the crash switch, beside `pickOneCoin`).
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
 * ★ A LINK IS BOUND BY ITS OWN AGE, NOT THE WINDOW, AND IT REACHES ONE HOP. `postWindowMs` keeps a
 * name or a picture — facts any coin can share by chance — from tying a launch to a post of
 * yesterday. A link is the creators pointing at the post, which no chance produces, so it ties up to
 * `linkMaxAgeMs` (the owner's 48 h): the post at most that old at the coin's launch. Past it, the
 * links are copycats of an old viral post, and with no bound they reopened posts days old and
 * changed their pick. And a coin often links its own account's quote or re-share of the viral post
 * rather than the post itself (HI, 19 Oct: launched 24 h after the baby post, linking its account's
 * quote of it): the caller passes those originals in `linksThrough`, and they tie as a link, under
 * the same age bound on the original. One hop only — a quote of a quote is somebody else's post,
 * and following chains would tie a coin to whatever went viral first. The one exception is the
 * coin-first route's walk (match/coin-origin.ts), bounded in depth and stopped at a bigger post: the
 * caller passes the original it reached, through the pointer, as one more such entry.
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
 * ★ AN OLDER COIN OF THE POST'S NAME IS THE INCUMBENT. When the second path found a coin that was
 * already trading on the post's subject, a coin launched after it that only shares a name is out
 * (`after_older_coin`) unless it clears the bars and its strength is `handOverRatio` times the
 * leading older coin's — on the same basis, and never while that older coin is unmeasured: nobody
 * can say a newcomer out-traded a coin whose trading we could not read. A link or a picture still
 * competes on the plain rule: those are the creators making the post's own coin. 19 Oct: "Kim"
 * (5pwu…ZAV6), launched three hours after the post, was picked over "Rip Kim Jong-Un", 17 hours old
 * and the coin the owner called right, on a namer ticker alone.
 *
 * ★ A QUOTE WITH NO POOL IS NOT A PRICE. On readings, a coin whose newest reading's pool is under
 * `minLiquidityUsd` climbs nothing and clears nothing: that same "Kim" read $381,537 for three hours
 * on a $0.01 pool, and on the readings rule that frozen quote out-climbed every coin people bought.
 * A reading with no liquidity figure (a coin on its curve) is unknown, and judged on its cap.
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
import { statedInText, statesName, type StatedBars } from './stated-name.ts';

/* ── the matcher ───────────────────────────────────────────────────── */

export interface LaunchMatchBars {
  readonly launchLeadMs: number;
  readonly postWindowMs: number;
  /** A link ties a launch to a post at most this old at the launch (the window binds only names and pictures). */
  readonly linkMaxAgeMs: number;
  readonly maxHashDistance: number;
  readonly minSimilarity: number;
  readonly minVariantLength: number;
  /**
   * The stated-name tie (stated-name.ts): a coin carrying the post's whole stated name and ticker.
   * Absent: no such tie, as before policy.v154.
   */
  readonly stated?: StatedBars & {
    /** A stated coin ties a post up to this long after it, past `postWindowMs` (the window binds a shared name, not a stated one). */
    readonly withinMs: number;
  };
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

export type MatchEvidence = 'link' | 'name_judge' | 'name_guess' | 'name_text' | 'name_stated' | 'picture' | 'existing' | 'missed_runner';

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

/** Every name the post states: the judge's, the namer's, and what its own words call it (stated-name.ts). */
export function statedNamesOf(p: Pick<MatchPost, 'judgeNames' | 'guessNames' | 'text'>): readonly string[] {
  return [...p.judgeNames, ...p.guessNames, ...statedInText(p.text)];
}

/** The posts a launch could be the coin of, with what ties it to each. A launch tied to none is absent. */
export function launchMatches(coin: LaunchSide, posts: readonly MatchPost[], bars: LaunchMatchBars): readonly LaunchMatch[] {
  const out: LaunchMatch[] = [];
  for (const p of posts) {
    const after = coin.launchedAtMs - p.postedAtMs;
    if (after < -bars.launchLeadMs) continue;
    const through = coin.linksPosts.has(p.itemId) || after > bars.linkMaxAgeMs ? null : coin.linksThrough?.get(p.itemId) ?? null;
    const linked = (coin.linksPosts.has(p.itemId) || through !== null) && after <= bars.linkMaxAgeMs;
    const side = { name: coin.name, ticker: coin.ticker };
    /* A coin carrying the post's whole stated name and ticker, launched after it (stated-name.ts). */
    const stated = bars.stated !== undefined && after >= 0 && after <= bars.stated.withinMs && statesName(statedNamesOf(p), side, bars.stated);
    /* Past the window only a link or the stated name ties: a name or a picture shared with yesterday's post is chance. */
    if (after > bars.postWindowMs && !linked && !stated) continue;
    const evidence: MatchEvidence[] = [];
    if (linked) evidence.push('link');
    if (p.judgeNames.length > 0 && nameMatch(p.judgeNames, side, bars) === 'exact') evidence.push('name_judge');
    if (p.guessNames.length > 0 && nameMatch(p.guessNames, side, bars) === 'exact') evidence.push('name_guess');
    if (!evidence.includes('name_judge') && !evidence.includes('name_guess') && namedInText(p, side, bars)) evidence.push('name_text');
    if (stated) evidence.push('name_stated');
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

/**
 * The second path's lookback: coins launched up to `lookbackMs` before the post (and more than
 * `launchLeadMs`, where the launch path takes over) that its names tie exactly or its own words tie
 * (`namedInText`), the `lookbackCoins` most traded first. No reading bar: a coin read sixteen hours
 * ago under the cap bar is still the coin the post is about, and the rule judges its trading from
 * now on. Traded is the newest reading's cap; a reading on a pool under `minLiquidityUsd` is a
 * frozen quote and counts as none; a coin never read ranks after every read one, never as zero.
 */
export interface PriorCoin extends ExistingCoin {
  readonly launchedAtMs: number | null;
  readonly liquidityUsd: number | null;
}

export interface PriorBars {
  readonly minVariantLength: number;
  readonly launchLeadMs: number;
  readonly lookbackMs: number;
  readonly lookbackCoins: number;
  readonly minLiquidityUsd: number;
}

export function priorCoins<C extends PriorCoin>(post: MatchPost, coins: readonly C[], bars: PriorBars): readonly { readonly coin: C; readonly ties: readonly MatchEvidence[] }[] {
  const tied = coins.flatMap((c) => {
    if (c.launchedAtMs === null || c.launchedAtMs < post.postedAtMs - bars.lookbackMs || c.launchedAtMs >= post.postedAtMs - bars.launchLeadMs) return [];
    const ties: MatchEvidence[] = [];
    if (post.judgeNames.length > 0 && nameMatch(post.judgeNames, c, bars) === 'exact') ties.push('name_judge');
    if (post.guessNames.length > 0 && nameMatch(post.guessNames, c, bars) === 'exact') ties.push('name_guess');
    if (ties.length === 0 && namedInText(post, c, bars)) ties.push('name_text');
    return ties.length === 0 ? [] : [{ coin: c, ties }];
  });
  const traded = (c: PriorCoin): number | null => (c.capUsd === null ? null : c.liquidityUsd !== null && c.liquidityUsd < bars.minLiquidityUsd ? 0 : c.capUsd);
  const rank = (x: { coin: C }): number => traded(x.coin) ?? Number.NEGATIVE_INFINITY;
  return tied.sort((a, b) => rank(b) - rank(a) || (a.coin.launchedAtMs ?? 0) - (b.coin.launchedAtMs ?? 0) || a.coin.address.localeCompare(b.coin.address)).slice(0, bars.lookbackCoins);
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
  /** A HELD coin under the share is kept until its cap is under this, in USD… */
  readonly rugFloorUsd: number;
  /** …or it has stayed under the share this long, or a rival clears the bars and leads it. */
  readonly rugGraceMs: number;
  /** …but never for time alone while it is still worth this many USD. */
  readonly rugKeepAboveUsd: number;
  /** Under the share, a rival made for the post worth this many times its cap takes it (the crash switch). */
  readonly crashCapRatio: number;
  readonly openingCapUsd: number;
  readonly minLiquidityUsd: number;
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
  /** The newest reading's pool; absent or null when it gave none (a coin on its curve): unknown. */
  readonly liquidityUsd?: number | null;
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
export type OutReason = 'creator_sold' | 'fell_from_peak' | 'after_older_coin' | 'behind_stated';

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
  | {
      readonly kind: 'picked';
      readonly address: string;
      readonly sinceMs: number;
      readonly confirmed: boolean;
      readonly handedOverFrom: string | null;
      /** The hand-over was the crash switch (the held coin crashed under a rival made for the post): pushed like a runner's. */
      readonly crash?: true;
      /** The held coin has been under `rugShareOfPeak` of its peak since then, and is kept on grace; null: it is not under. */
      readonly underShareSinceMs: number | null;
      readonly basis: Basis;
      readonly standings: readonly Standing[];
    }
  | { readonly kind: 'waiting'; readonly reason: WaitingReason; readonly droppedHolder: string | null; readonly basis: Basis; readonly standings: readonly Standing[] }
  | { readonly kind: 'none' };

/** The coin held before this judgement, and since when. */
export interface Holder {
  readonly address: string;
  readonly sinceMs: number;
  /** Since when it has been under the share while held (the last judgement's `underShareSinceMs`); absent or null: it was not. */
  readonly underShareSinceMs?: number | null;
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
  const noPool = m.liquidityUsd !== undefined && m.liquidityUsd !== null && m.liquidityUsd < bars.minLiquidityUsd;
  return { address: c.address, evidence: c.evidence, visible, measured: true, strength: noPool ? 0 : Math.max(0, m.capUsd - bars.openingCapUsd), uniqueBuyers: null, capUsd: m.capUsd, out, clears: !noPool && out === null && m.capUsd >= bars.minCapUsd };
}

/** A coin the second path found already trading when the post came. */
const isOlder = (c: Contender): boolean => c.existingSinceMs !== undefined && c.existingSinceMs !== null;
/** A coin carrying the post's whole stated name (stated-name.ts). */
const isStated = (c: Contender): boolean => c.evidence.includes('name_stated');
/** Ties that are the creators making the post's own coin, not a shared name: a link, the picture, the whole stated name, or the missed-runner net's origin (missed-runner.ts). */
const madeForPost = (c: Contender): boolean => c.evidence.includes('link') || c.evidence.includes('picture') || isStated(c) || c.evidence.includes('missed_runner');

/**
 * Out, when an older coin of the post's name stands: each later name-only coin that does not beat
 * the leading older coin by `handOverRatio`, measured on this basis. The older coins themselves are
 * judged as usual.
 */
function behindOlder(contenders: readonly Contender[], standings: readonly Standing[], floor: number, bars: OneCoinBars): readonly Standing[] {
  const older = new Set(contenders.filter(isOlder).map((c) => c.address));
  const standing = standings.filter((s) => older.has(s.address) && s.visible && s.out === null);
  if (standing.length === 0) return standings;
  const lead = standing.filter((s) => s.measured).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))[0];
  const later = new Set(contenders.filter((c) => !isOlder(c) && !madeForPost(c)).map((c) => c.address));
  return standings.map((s) => {
    if (!later.has(s.address) || s.out !== null) return s;
    const beats = lead !== undefined && s.clears && (s.strength ?? 0) >= bars.handOverRatio * Math.max(lead.strength ?? 0, floor);
    return beats ? s : { ...s, out: 'after_older_coin', clears: false };
  });
}

/**
 * ★ THE STATED NAME WINS — ON EQUAL TRADING, NOT AGAINST IT. When a coin carrying the post's whole
 * stated name and ticker stands (visible, not out, clearing the bars), every coin that only shares a
 * name — not stated, not the creators' link or picture — and trades no more than it is out
 * (`behind_stated`). A held look-alike goes out with them, so the pick re-opens and the stated coin
 * is judged against the coins still standing on the plain rule: the holder's three-times shield is
 * gone, its lead is not. 23 Oct: dozens of "You Missed Coin" $BITCHES copies launched within seconds
 * of the post that stated the name, one reached $16k; the look-alike held, "You Missed Bitches"
 * $YMB, ran to $2.4M. Putting every look-alike out would have handed the pick to the $16k copy.
 * The real $BITCHES, launched 71 minutes later, takes it once it trades more than $YMB. While no
 * stated coin clears the bars, nothing changes.
 */
function behindStated(contenders: readonly Contender[], standings: readonly Standing[]): readonly Standing[] {
  const stated = new Set(contenders.filter(isStated).map((c) => c.address));
  const best = standings.filter((s) => stated.has(s.address) && s.visible && s.out === null && s.clears).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))[0];
  if (best === undefined) return standings;
  const lookAlike = new Set(contenders.filter((c) => !isStated(c) && !madeForPost(c)).map((c) => c.address));
  return standings.map((s) => (lookAlike.has(s.address) && s.out === null && (s.strength ?? 0) <= (best.strength ?? 0) ? { ...s, out: 'behind_stated', clears: false } : s));
}

/**
 * The post's (or narrative's) one coin now. `tradesRunning`: the trade feed wrote lately and these
 * candidates are watched; false falls back to the readings rule, said in `basis`.
 */
export function pickOneCoin(contenders: readonly Contender[], holder: Holder | null, nowMs: number, tradesRunning: boolean, bars: OneCoinBars): OneCoinOutcome {
  if (contenders.length === 0) return { kind: 'none' };
  const basis: Basis = tradesRunning ? 'trades' : 'market_readings';
  /* On readings the rival floor is one dollar of climb, as the replay's; on trades it is zero net buying. */
  const floor = basis === 'trades' ? 0 : 1;
  const standings = behindStated(contenders, behindOlder(contenders, contenders.map((c) => standingOf(c, basis, nowMs, bars)), floor, bars));
  const live = standings.filter((s) => s.visible && s.out === null);
  /* On readings an unread coin is not judged yet (the replay's rule); on trades it holds every pick back. */
  const judged = basis === 'trades' ? live : live.filter((s) => s.measured);
  const strength = (s: Standing): number => s.strength ?? 0;
  const ranked = judged.filter((s) => s.measured).sort((a, b) => strength(b) - strength(a) || a.address.localeCompare(b.address));
  const unmeasured = judged.some((s) => !s.measured);
  const contender = (a: string) => contenders.find((c) => c.address === a);
  const picked = (address: string, sinceMs: number, from: string | null, underShareSinceMs: number | null = null): OneCoinOutcome => {
    const c = contender(address);
    const existing = c?.existingSinceMs ?? null;
    const confirmAt = existing !== null ? existing + bars.confirmByMs - bars.judgeFromMs : (c?.launchedAtMs ?? sinceMs) + bars.confirmByMs;
    return { kind: 'picked', address, sinceMs, confirmed: nowMs >= confirmAt, handedOverFrom: from, underShareSinceMs, basis, standings };
  };

  const held = holder === null ? null : standings.find((s) => s.address === holder.address) ?? null;
  /* A held coin under the share stays on grace: not under the floor, not under for `rugGraceMs`. */
  const under = held?.out === 'fell_from_peak' ? holder?.underShareSinceMs ?? nowMs : null;
  const keptByCap = held !== null && held.capUsd !== null && held.capUsd >= bars.rugKeepAboveUsd;
  const onGrace = held !== null && under !== null && !(held.capUsd !== null && held.capUsd < bars.rugFloorUsd) && (nowMs - under < bars.rugGraceMs || keptByCap);
  if (holder !== null && held !== null && (held.out === null || onGrace)) {
    /* ★ THE CRASH SWITCH. Under the share, a rival the creators made for the post that is now worth
       `crashCapRatio` times the held coin takes it on caps alone: a crash says nothing about net
       buying, which a pump and its dump leave flat on both coins. */
    if (onGrace && held.capUsd !== null) {
      const heldCap = held.capUsd;
      const crashTo = standings
        .filter((s) => s.address !== holder.address && s.visible && s.out === null && s.capUsd !== null && s.capUsd >= bars.minCapUsd && s.capUsd >= bars.crashCapRatio * heldCap)
        .filter((s) => { const c = contender(s.address); return c !== undefined && madeForPost(c); })
        .sort((a, b) => (b.capUsd ?? 0) - (a.capUsd ?? 0))[0];
      if (crashTo !== undefined) {
        const o = picked(crashTo.address, nowMs, holder.address);
        return o.kind === 'picked' ? { ...o, crash: true } : o;
      }
    }
    const challenger = ranked.find((s) => s.address !== holder.address);
    const holdStrength = Math.max(held.strength ?? 0, floor);
    /* On grace a rival takes it on the bar of a fresh pick against it; standing, only at the hand-over bar. */
    const ratio = onGrace ? bars.leadRatio : bars.handOverRatio;
    if (challenger !== undefined && challenger.clears && strength(challenger) >= ratio * holdStrength) return picked(challenger.address, nowMs, holder.address);
    return picked(holder.address, holder.sinceMs, null, onGrace ? under : null);
  }
  const dropped = holder === null ? null : holder.address;
  const wait = (reason: WaitingReason): OneCoinOutcome => ({ kind: 'waiting', reason, droppedHolder: dropped, basis, standings });
  if (standings.every((s) => !s.visible)) return wait('too_early');
  if (live.length === 0) return wait('all_out');
  /* ★ A held coin the trades already put out stays out on the readings fallback (2026-10-26, $DOUPI): a
     curve's reading can stand still for an hour after the curve is emptied, and $41,293 on readings
     re-held a coin the trades read at $1,985. */
  if (basis === 'trades' && unmeasured) return pickOneCoin(contenders, holder !== null && dropped !== null ? null : holder, nowMs, false, bars);
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
  p: { readonly judgeFromMs: number; readonly confirmByMs: number; readonly minCapUsd: number; readonly leadRatio: number; readonly minUniqueBuyers: number; readonly handOverRatio: number; readonly rugShareOfPeak: number; readonly rugFloorUsd: number; readonly rugGraceMs: number; readonly rugKeepAboveUsd: number; readonly crashCapRatio: number; readonly openingCapUsd: number; readonly minLiquidityUsd: number },
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
    rugFloorUsd: p.rugFloorUsd,
    rugGraceMs: p.rugGraceMs,
    rugKeepAboveUsd: p.rugKeepAboveUsd,
    crashCapRatio: p.crashCapRatio,
    openingCapUsd: p.openingCapUsd,
    minLiquidityUsd: p.minLiquidityUsd,
  };
}
