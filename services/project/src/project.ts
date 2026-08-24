/**
 * THE PROJECTION. Domain facts in, finished wire JSON out. No I/O, no clock, no
 * database, no randomness — every input arrives as an argument, which is what makes
 * every rule in here a unit test rather than an integration test.
 *
 * This is the ONE place the wire shape is ever constructed. Not because assembling it
 * twice would be untidy, but because every rule below is a decision about what a
 * missing number looks like, and a second assembler is a second set of answers to
 * those questions that nobody compared. The read service does no logic at all: it
 * selects the jsonb this file produced and returns it verbatim.
 *
 * THE FOUR RULES THIS FILE EXISTS TO HOLD, all of them the same rule wearing different
 * clothes — AN ABSENCE IS NOT A ZERO:
 *
 *   1. A CENSORED READING BECOMES `value: null` ON THE SPARK. Never 0, never dropped,
 *      never averaged over, never filled from the level we last trusted. Zero draws a
 *      cliff and a cliff reads as collapse, on a chart whose only job is to show
 *      acceleration — so the failure hides exactly the item that is taking off, which
 *      is the only thing we are paid to notice. Dropping the point instead loses the
 *      gap in `atMs`, which is the evidence that we looked and learned nothing.
 *
 *   2. A COUNTER THE SOURCE DOES NOT KEEP BECOMES THE ABSENT FORM WITH A REASON.
 *      Never 0. "This source has no view concept" and "nobody looked at it" are
 *      different facts about the world, and rendering both as 0 sorts one of them last
 *      for a reason that is ours, not the world's.
 *
 *   3. AN UNKNOWN INSTANT STAYS UNKNOWN. Never backfilled from another column, never
 *      defaulted to now. A missing start time rendered as an age of zero reads as
 *      "brand new" on a product whose entire pitch is earliness — the worst available
 *      direction to be wrong in, because it makes the oldest and least-known rows look
 *      like the freshest ones.
 *
 *   4. MOMENTUM LEAVES HERE AS A WORD AND NEVER AS A NUMBER. Internally it is a
 *      comparison; on the wire it is one of three words, projected one way, forever.
 *      A number would be something the client could threshold, and a threshold in a
 *      component is how the previous build ended up with `gain >= 150000 ? 'up' : 'down'`
 *      living in the render path.
 *
 * And the rule underneath all four: facts about the world go on screen, our reasoning
 * never does. The test is "would this number still be true if we did not exist?" — a
 * post count would, a match score would not.
 */

import type {
  Fidelity,
  FingerprintKind,
  MintTimeConfidence,
  Millis,
  Policy,
  Rate,
  SourceHealth,
} from '@insidor/contracts';
import type { StoryOrigin } from '@insidor/contracts/story.ts';
import { sourceState } from '@insidor/core';

import { orderByRecency } from './order.ts';
import type { Orderable } from './order.ts';
import {
  assertNoInternalVocabulary,
  instant,
  measured,
  WireLeakError,
  type MarketCapBasis,
  type PendingReason,
  type Tone,
  type WireBoardProvenance,
  type WireStoryProvenance,
  type WireBoardRow,
  type WireCoin,
  type WireCoinLink,
  type WireEvidence,
  type WireFeedSource,
  type WireInstant,
  type WireLaunch,
  type WireMeasured,
  type WirePair,
  type WirePairFeed,
  type WirePairHead,
  type WirePairListing,
  type WireSourceFeed,
  type WireSourceHealth,
  type WireSpark,
  type WireSparkPoint,
  type WireStory,
} from './wire.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Display lengths, not judgements. Nothing branches on them; they only trim strings. */
const TITLE_MAX_CHARS = 96;
const EXCERPT_MAX_CHARS = 240;

/**
 * ★ THE THREE ABOVE TRIM OUR OWN TEXT. THESE THREE BOUND SOMEBODY ELSE'S.
 *
 * A story title is written by the qualify stage; a token's symbol and name are typed by
 * whoever minted the coin, which on this product means by someone who would like a rail
 * position. So these are not display niceties, they are the limit on how much
 * attacker-chosen text can reach a browser at all — the bound is applied here, in the
 * projection, so an over-long name is never stored in a payload and therefore can never
 * be served, whatever the client does with it.
 *
 * The numbers are generous against real tokens (tickers run 3-10 characters, names a
 * handful of words) and tight against a payload written to break a layout.
 */
const TICKER_MAX_CHARS = 16;
const NAME_MAX_CHARS = 48;
/** A Solana address is 32-44 base58 characters. Anything longer is not one. */
const ADDRESS_MAX_CHARS = 64;

/* ── what the projector is handed ─────────────────────────────────────── */

/**
 * One reading of one item's reach counter, already reassembled into the Rate union.
 *
 * The union, rather than a flat `perMin: number | null`, is not ceremony: a
 * `number | null` is precisely the shape that lets a caller skip the censored case and
 * get a plausible zero, and `rate.perMin` does not typecheck here until the measured
 * branch has been proved. `fidelity` rides along because "the source has no such
 * concept" is a statement the rate cannot make on its own.
 */
export interface ReachReading {
  readonly atMs: Millis;
  readonly fidelity: Fidelity['kind'];
  readonly rate: Rate;
}

/**
 * Why a post is in a story, reduced to the part a sentence can be written from.
 *
 * This is contracts' MatchEvidence with every NUMBER removed — no carrier weight, no
 * Hamming distance, no cosine similarity. Reusing MatchEvidence itself would be easier
 * and is the wrong call: a field that is present gets rendered eventually, and the whole
 * argument of this service is that the numbers which persuaded us live in the decision
 * log and not on a screen. Keeping them out of the display type also means the query
 * that feeds it never has to select them, and a column that is not in the result set
 * cannot leak.
 */
export type MemberRelation =
  | { readonly kind: 'seed' }
  | { readonly kind: 'carrier'; readonly carrier: FingerprintKind }
  | { readonly kind: 'lineage'; readonly via: 'reproduction' | 'rebroadcast' }
  | { readonly kind: 'representation' }
  | { readonly kind: 'adjudicated' };

/** One post inside a story, with everything needed to show it and nothing more. */
export interface MemberFacts {
  readonly itemId: string;
  /** A display string the server chooses. The app never maps a source id to a label. */
  readonly sourceLabel: string;
  readonly authorLabel: string;
  /** null when the source omitted it or is known to lie. Never defaulted to a guess. */
  readonly postedAt: Millis | null;
  readonly excerpt: string;
  readonly thumbUrl: string | null;
  /**
   * The public link to the post. null when we do not hold one — and a piece of
   * evidence with no link is dropped rather than shown, see projectEvidence.
   */
  readonly permalink: string | null;
  /** Why this item joined. Turned into a plain English sentence; never into a number. */
  readonly relation: MemberRelation;
  /** This item's reach series, oldest first. */
  readonly reach: readonly ReachReading[];
}

/**
 * A market number, or the venue's own statement of why there is none.
 *
 * A two-branch union rather than `number | null`, for the reason `Rate` is one: a
 * `number | null` is precisely the shape that lets a caller skip the absent case and
 * get a plausible zero, and `.amount` does not typecheck here until the known branch
 * has been proved. `why` is the venue's answer, carried rather than re-guessed — a
 * curve reporting no reserve and a coin nobody has traded are different facts and the
 * projection is not in a position to tell them apart on its own.
 */
export type MarketNumber =
  | { readonly known: true; readonly amount: number }
  | { readonly known: false; readonly why: PendingReason };

/**
 * The market reading a coin's numbers came from, or `null` when we hold none.
 *
 * ★ NULL HERE IS A DIFFERENT FACT FROM A READING FULL OF NULLS, and separating them is
 * the whole reason this is a nested object rather than five more fields on CoinFacts.
 * "Nobody has read this coin's market yet" is our state; "the venue says there is no
 * market" is the world's. Flattened, both would arrive as a null price and the
 * projection would have to pick one reason for both — and it would pick wrongly for
 * whichever is less common, which on a board whose rows are minutes old is neither.
 */
export interface CoinMarket {
  /**
   * When the reading was TAKEN. Never `now`, never when the row was written.
   * projectCoin refuses to publish a reading older than `marketFreshnessMs` as the
   * current market, and this is the instant that decides it.
   */
  readonly takenAt: Millis;
  readonly priceUsd: MarketNumber;
  readonly marketCapUsd: MarketNumber;
  /** Non-null exactly when the cap is known. Never guessed, never carried forward. */
  readonly marketCapBasis: MarketCapBasis | null;
  /** Absent on a bonding curve. Absence is not illiquidity — see the reason it carries. */
  readonly liquidityUsd: MarketNumber;
  /** The trailing day's move, as a signed percentage. A fall is a reading. */
  readonly priceChange24h: MarketNumber;
  /** Decided by asking a venue for a quote, never by comparing liquidity to a number. */
  readonly tradable: boolean;
}

/** A coin, as facts. Every market number is absent-or-known and absent is never zero. */
export interface CoinFacts {
  readonly coinId: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly address: string;
  readonly venueLabel: string;
  readonly imageUrl: string | null;
  /** Unknown is normal and stays unknown. Never backfilled from first-seen. */
  readonly mintedAt: Millis | null;
  /** The latest reading we hold for this coin. `null` means we hold none at all. */
  readonly market: CoinMarket | null;
}

/**
 * A coin considered for this story, with the verdict reached about it.
 *
 * `confident` arrives ALREADY DECIDED. Nothing below this line weighs a coin against
 * another one — projectCoins counts and nothing else — because deciding which of several
 * coins is the real one is the product, and a second implementation of it living inside
 * the wire assembler would be a second answer nobody replays.
 *
 * Today the verdict is made by coins.ts, one module away, out of the story's own spans and
 * the coin's observed symbol and name. That is a deliberately weak stand-in for
 * core/src/resolve, which will score five channels and apply an ambiguity margin: it can
 * fail to name a coin and it cannot name the wrong one. When resolve runs, it fills this
 * seam instead and the shape does not move.
 */
export interface CoinCandidate {
  readonly coin: CoinFacts;
  readonly confident: boolean;
}

export interface StoryFacts extends Orderable {
  readonly storyId: string;
  /** Written by the qualify stage. null is a legitimate long-term state, not a gap. */
  readonly displayTitle: string | null;
  readonly thumbUrl: string | null;
  readonly lastMemberAt: Millis;
  readonly memberCount: number;
  readonly distinctAuthors: number;
  readonly distinctSources: number;
  readonly members: readonly MemberFacts[];
  readonly coins: readonly CoinCandidate[];
  /**
   * Whether this story was on the previous committed frame. `isNew` is that and nothing
   * else — an arrival on this board, which is a fact about the board rather than a
   * quality claim about the story.
   */
  readonly wasOnPreviousBoard: boolean;
}

export interface ProjectOptions {
  /** Injected, never read from the clock: a projection has to be reproducible. */
  readonly nowMs: Millis;
  /** The window the spark's points cover. The client draws the axis from this. */
  readonly sparkWindowMs: number;
  /**
   * How old a market reading may be and still be published as the CURRENT market.
   *
   * ★ THIS IS THE ONLY OPTION HERE THAT ANYTHING BRANCHES ON, and it is not a number
   * typed in this file: it arrives from Policy.market.readingFreshnessMs, so the board
   * a user saw last month is answerable against the policy that was in force then.
   * `sparkWindowMs` above only bounds how wide an axis is drawn; this one decides
   * whether a price is a price or a dash, which is a judgement.
   */
  readonly marketFreshnessMs: number;
  /**
   * How long a feed of new coins may be silent before it stops being published as live.
   *
   * The SECOND option here that something branches on, and it arrives the same way the
   * first does — from Policy.assets.feedFreshnessMs, never typed in this file. The two are
   * deliberately separate numbers measuring different things: one is how long a PRICE
   * stays true, which is about a coin's market, and this is how long a SILENCE stays
   * ordinary, which is about a transport. They happen to share a unit and nothing else.
   */
  readonly feedFreshnessMs: number;
}

/* ── reach: a level, or an honest statement that we have none ─────────── */

/**
 * The story's reach, taken from its representative post.
 *
 * Order of preference, and each step is a different fact:
 *   1. the level attached to the newest MEASURED reading — a number we stand behind;
 *   2. otherwise the newest censored reading's carried level, which is exactly what
 *      "the most recent trustworthy level" means. A level stays usable even when a
 *      difference does not, so refusing it here would throw away a number we have;
 *   3. otherwise, if the newest reading says the counter is ABSENT, the source keeps
 *      no such count at all → `not_reported`;
 *   4. otherwise we have simply not learned it → `not_read_yet`.
 *
 * There is no fifth step returning 0, and adding one would undo the whole file.
 */
export function projectReach(readings: readonly ReachReading[]): WireMeasured {
  if (readings.length === 0) return measured(null, 'not_read_yet');

  for (let i = readings.length - 1; i >= 0; i -= 1) {
    const rate = readings[i]?.rate;
    if (rate !== undefined && rate.kind === 'measured') return measured(rate.level, 'unreadable');
  }
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    const rate = readings[i]?.rate;
    if (rate !== undefined && rate.kind === 'censored' && rate.lastLevel !== null) {
      return measured(rate.lastLevel, 'unreadable');
    }
  }

  const newest = readings[readings.length - 1];
  if (newest !== undefined && newest.fidelity === 'absent') return measured(null, 'not_reported');
  return measured(null, 'not_read_yet');
}

/**
 * Change in reach over the last day.
 *
 * Both ends must be readings we actually took. If the series does not reach back a full
 * day, the answer is an absence — NOT the change since the oldest reading we happen to
 * hold, which would silently relabel "the last forty minutes" as "the last day" and be
 * wrong by a factor nobody can see. Nothing is extrapolated and nothing is annualised.
 */
export function projectReachDelta24h(
  readings: readonly ReachReading[],
  nowMs: Millis,
): WireMeasured {
  const now = measuredLevelAtOrBefore(readings, nowMs);
  const before = measuredLevelAtOrBefore(readings, nowMs - MS_PER_DAY);
  if (now === null || before === null) return measured(null, 'not_read_yet');
  return measured(now - before, 'unreadable');
}

function measuredLevelAtOrBefore(readings: readonly ReachReading[], at: Millis): number | null {
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    const reading = readings[i];
    if (reading === undefined || reading.atMs > at) continue;
    if (reading.rate.kind === 'measured') return reading.rate.level;
  }
  return null;
}

/* ── the spark ────────────────────────────────────────────────────────── */

/**
 * The small line graph: one point per reading inside the declared window, in place,
 * in order.
 *
 * ★ A censored reading is `value: null`. There is no `?? 0` in this function, no
 * `coalesce` in the query that feeds it, no filter that drops a reading for being
 * censored, and no averaging across the hole. The client breaks the line at a null,
 * which is a picture of what actually happened: we read the counter and learned
 * nothing about how it moved.
 *
 * Note what is deliberately NOT done here: a censored reading often carries
 * `lastLevel`, the level we last trusted, and using it to fill the hole would produce
 * a continuous line. It would also be a flat segment across a period we did not
 * measure, and a flat line is a claim about stability. We did not measure stability;
 * we measured nothing.
 *
 * ★ THE POINTS ARE CLIPPED TO `windowMs`, AND THAT IS NOT COSMETIC. The series handed
 * in covers more than a day, because reachDelta24h needs its older end; the spark is
 * half an hour wide. shared/ui/Sparkline.tsx anchors its x axis at the newest known
 * point minus `windowMs`, so anything older is drawn off the left of the viewBox and
 * clipped — but it is still in the array, so it still sets `min`/`max` for the y
 * scale. A row that went from 1,000 to 500,000 overnight would have its last thirty
 * minutes squeezed into the top few percent of a 24-pixel chart and render as a FLAT
 * LINE. Flat reads as cooling on the one chart whose entire job is to show
 * acceleration, which is the exact failure the rest of this file is arranged against —
 * arriving through the axis instead of through a zero.
 *
 * Clipped relative to the newest reading rather than to `now`, because that is the
 * anchor the renderer uses; picking a different one here would move the points off the
 * axis again in the other direction.
 */
export function projectSpark(
  readings: readonly ReachReading[],
  windowMs: number,
): WireSpark {
  const newest = readings[readings.length - 1]?.atMs;
  const points: WireSparkPoint[] = [];
  for (const reading of readings) {
    if (newest !== undefined && reading.atMs < newest - windowMs) continue;
    points.push({ atMs: reading.atMs, value: sparkValue(reading.rate) });
  }
  return { points, windowMs };
}

function sparkValue(rate: Rate): number | null {
  if (rate.kind !== 'measured') return null;
  return Number.isFinite(rate.level) ? rate.level : null;
}

/* ── momentum ─────────────────────────────────────────────────────────── */

/**
 * Three words, projected one way and forever. The client gets no number.
 *
 * The rule is a majority vote on the SIGN of each step between consecutive MEASURED
 * rates. Sign only — there is deliberately no band around zero ("call it steady if it
 * moved by less than x"), because that x would be a tuned threshold living outside
 * contracts/src/policy.ts, where nobody could answer what the board was judged against
 * last month. A tie, including a series that never changed, is `steady`.
 *
 * Censored readings are SKIPPED, not counted as flat. Counting them as flat is the
 * whole disaster this vocabulary exists to prevent: flat reads as cooling, cooling
 * demotes, and the item being demoted is the one accelerating behind a quantized
 * counter.
 *
 * Fewer than two measured rates is `null` — no claim at all. Not `steady`: steady says
 * we watched it hold, and we did not watch it.
 */
export function projectMomentum(readings: readonly ReachReading[]): Tone | null {
  const rates: number[] = [];
  for (const reading of readings) {
    if (reading.rate.kind === 'measured' && Number.isFinite(reading.rate.perMin)) {
      rates.push(reading.rate.perMin);
    }
  }
  if (rates.length < 2) return null;

  let up = 0;
  let down = 0;
  for (let i = 1; i < rates.length; i += 1) {
    const previous = rates[i - 1];
    const current = rates[i];
    if (previous === undefined || current === undefined) continue;
    if (current > previous) up += 1;
    else if (current < previous) down += 1;
  }
  if (up > down) return 'rising';
  if (down > up) return 'cooling';
  return 'steady';
}

/* ── when it began ────────────────────────────────────────────────────── */

/**
 * The earliest post time among the members, or an honest absence.
 *
 * ★ NOTHING IS SUBSTITUTED HERE. Not `now`, not the story's creation row, not the
 * first time we happened to see it. `public.story.earliest_post_at` is NOT NULL only
 * because Postgres' `least()` ignores nulls, so reading it would manufacture a
 * timestamp for a story whose posts never carried one — and an age of zero renders as
 * "brand new", which is the single most expensive way to be wrong on this product.
 *
 * Two different absences, told apart: members exist but none reported a time is the
 * source withholding it (`not_reported`); no members at all is us not having looked
 * (`not_read_yet`).
 */
export function projectFirstSeenAt(members: readonly MemberFacts[]): WireInstant {
  let earliest: Millis | null = null;
  for (const member of members) {
    if (member.postedAt === null) continue;
    if (earliest === null || member.postedAt < earliest) earliest = member.postedAt;
  }
  if (earliest !== null) return instant(earliest, 'unreadable');
  return instant(null, members.length === 0 ? 'not_read_yet' : 'not_reported');
}

/* ── coins ────────────────────────────────────────────────────────────── */

/**
 * ★ A READING WE HOLD, OR NOTHING — the staleness gate, and it is a gate.
 *
 * A market reading is true of an instant, not of a coin. Fifteen minutes after it was
 * taken it is still a fact about that instant and is no longer an answer to "what is
 * this worth now", which is the only question the board is asking. On a product whose
 * measured post-to-mint lag is under four minutes, a coin can be minted, run and peak
 * inside one freshness window — so an hour-old price is not a slightly-late price here,
 * it is a different story about the same coin, and it is the one market error a user
 * acts on directly because the row has a Buy button on it.
 *
 * So a stale reading is dropped whole and every figure becomes an absence, rather than
 * the last number we happen to hold being shown beside a quiet caveat nobody reads.
 * Dropping it WHOLE also matters: publishing the price but suppressing the cap, or
 * keeping `tradable` alive past its reading, would put figures from two different
 * instants in one row.
 *
 * The window is Policy.market.readingFreshnessMs, injected. Nothing here reads a clock:
 * `options.nowMs` is an argument, which is what keeps this function a unit test.
 */
function currentMarket(market: CoinMarket | null, options: ProjectOptions): CoinMarket | null {
  if (market === null) return null;
  /* Only the upper side is checked. A reading stamped in the FUTURE is a clock problem
     rather than a staleness one, and suppressing it here would hide the clock problem
     behind a dash that looks exactly like every other dash on the board. */
  return options.nowMs - market.takenAt > options.marketFreshnessMs ? null : market;
}

/**
 * One market number onto the wire.
 *
 * `undefined` — no current reading at all — becomes `not_read_yet`, which is the true
 * statement in both cases that produce it: nobody has read this coin's market, or the
 * reading we hold is too old to be the current one. Neither is a claim about the coin.
 *
 * An absence that DID come from a reading keeps the venue's own reason, and that is the
 * point of carrying it: `no_market` says the coin has never traded, `not_reported` says
 * the market exists and has no such quantity to report — a curve has no two-sided
 * reserve, a coin minutes old has no trailing day. Collapsing them, and then rejecting
 * anything that came back zero, is how the build this replaces filtered out essentially
 * the entire pre-graduation population, which is the only population we serve.
 */
function marketNumber(value: MarketNumber | undefined): WireMeasured {
  if (value === undefined) return measured(null, 'not_read_yet');
  return value.known ? measured(value.amount, 'unreadable') : measured(null, value.why);
}

export function projectCoin(facts: CoinFacts, options: ProjectOptions): WireCoin {
  const market = currentMarket(facts.market, options) ?? undefined;
  const marketCapUsd = marketNumber(market?.marketCapUsd);

  return {
    coinId: facts.coinId,
    /* An unknown ticker renders as nothing. It does NOT render as the address, or as
       the story's title, or as any other string that would look like a ticker to a
       person deciding what to buy. */
    ticker: facts.ticker ?? '',
    name: facts.name ?? '',
    address: facts.address,
    venueLabel: facts.venueLabel,
    imageUrl: nonEmpty(facts.imageUrl),
    mintedAt: instant(facts.mintedAt, 'not_read_yet'),
    priceUsd: marketNumber(market?.priceUsd),
    marketCapUsd,
    /* ★ A BASIS NEVER OUTLIVES ITS CAP, in either direction. A label with no number is
       a description of nothing; a number with no label is a figure whose meaning is
       missing, and the two bases differ by more than a factor of ten on a coin with
       most of its supply still locked. Read off the projected cap rather than off the
       facts, so a stale reading drops both together. */
    marketCapBasis: marketCapUsd.v === null ? null : (market?.marketCapBasis ?? null),
    liquidityUsd: marketNumber(market?.liquidityUsd),
    priceChange24h: marketNumber(market?.priceChange24h),
    /* ★ NO CURRENT READING MEANS NOT TRADABLE, and that is not derived from any number
       above it. Tradability is a claim that a venue will quote this coin RIGHT NOW; the
       only evidence for it is a quote, and a quote taken twenty minutes ago is not
       evidence about now. Absence of a current quote is absence of the affordance. */
    tradable: market?.tradable ?? false,
  };
}

/**
 * The row's button, as a closed union with nothing left for the client to decide.
 *
 *   no candidates at all            → `none`   → the row offers Create
 *   candidates, none confident      → `unsure` → the row offers NOTHING
 *   exactly one confident           → `one`    → the row offers Buy
 *   two or more confident           → `several`→ the row offers Compare
 *
 * ★ THE `unsure` BRANCH CARRIES A COUNT AND NO COIN, and that is the load-bearing line
 * in this function. Not a coin with a flag beside it, not a disabled button — nothing.
 * A disabled button says "this exists but you may not have it", which invites a user to
 * wait for it to enable; the honest render of "we do not know which coin this is" is
 * the absence of the affordance. And structurally: a coin that is not in the payload
 * cannot be prop-drilled into a buy panel by anyone, ever, however the UI is rewritten.
 */
export function projectCoins(
  candidates: readonly CoinCandidate[],
  options: ProjectOptions,
): WireCoinLink {
  if (candidates.length === 0) return { kind: 'none' };

  const confident = candidates.filter((candidate) => candidate.confident);
  if (confident.length === 0) return { kind: 'unsure', claimCount: candidates.length };

  const coins = confident.map((candidate) => projectCoin(candidate.coin, options));
  const [first, second, ...rest] = coins;
  if (first === undefined) return { kind: 'none' };
  if (second === undefined) return { kind: 'one', coin: first };
  return { kind: 'several', coins: [first, second, ...rest] };
}

/**
 * ★ THE ROW'S MARKET CAP, WHICH IS THE STORY'S COIN'S MARKET CAP, WHICH EXISTS ONLY WHEN
 * THE STORY HAS EXACTLY ONE COIN.
 *
 * MARKET CAP IS A PROPERTY OF A COIN, NOT OF A STORY. Nothing about "chef throws the soup"
 * has a market capitalisation; six tokens named after it each do. So this function reads
 * the answer off `coins` and never computes one, and the four branches are four different
 * facts that must not share a spelling:
 *
 *   `one`     → THAT COIN'S CAP, verbatim, absence and all. A coin nobody has traded
 *               carries `{ v: null, why: 'no_market' }` and it arrives here unchanged —
 *               "minted, nothing quotable yet" is the coin's own honest state and there is
 *               nothing for this function to add to it. It is emphatically not a zero: a
 *               zero says the coin is worthless, and untraded is not worthless.
 *
 *   `none`    → `not_minted`. Nothing has been minted from this story, so there is no
 *               market anywhere to have a number in. This is the only branch where "no
 *               coin yet" is a true thing to tell a user.
 *
 *   `unsure`  → ABSENT. Coins claim this story and we will not say which of them is it.
 *               The payload carries no coin at all — by construction, see projectCoins —
 *               so there is not even a cap here to be tempted by. Reaching past the union
 *               to fetch one from the candidate list would reintroduce exactly the coin
 *               that branch exists to withhold.
 *
 *   `several` → ABSENT, and this is the branch that has to be read twice, because two
 *               plausible answers are both wrong:
 *                 · SUMMING the caps produces a number that is true of nothing. Nobody
 *                   holds a position in "the soup complex"; adding the caps of three
 *                   rival tokens invents a security that does not exist.
 *                 · TAKING THE LARGEST is picking which coin is the real one and then
 *                   presenting the pick as a measurement. It is the same judgement the
 *                   `unsure` branch refuses to make, laundered through arithmetic — and
 *                   it is worse than refusing, because the user cannot see it happening.
 *               Not showing a cap costs a column on some rows. Showing either of those
 *               costs the user money on the row where the biggest cap belongs to the
 *               copycat, which is the common case and the reason this product exists.
 *
 * ★ THE REASON FOR `unsure` AND `several` IS A COMPROMISE AND IS FLAGGED AS ONE.
 * `PendingReason` is a closed list of the USER'S reasons, and it has no member meaning
 * "this story does not resolve to a single coin". `not_reported` is the closest true
 * reading of the five — the concept does not exist at the level the column asks about, so
 * nothing reports it — and it is deliberately NOT `no_market` (which would claim the coin
 * exists and is untraded) and NOT `not_minted` (which would claim no coin exists, flatly
 * contradicting the row's own summary line two cells away). If the list ever grows a
 * `no_single_coin`, this is its first caller and these two branches should take it.
 */
export function projectMarketCap(coins: WireCoinLink): WireMeasured {
  return fromTheOneCoin(coins, (coin) => coin.marketCapUsd);
}

/**
 * ★ THE ROW'S 24-HOUR PRICE MOVE, WHICH IS THE STORY'S COIN'S PRICE MOVE, WHICH EXISTS
 * ONLY WHEN THE STORY HAS EXACTLY ONE COIN.
 *
 * The same rule as the cap above, restated because the temptation is different and
 * slightly stronger. A cap is at least additive-looking; a change is a percentage, and
 * percentages invite an AVERAGE — which for `several` would be the mean of three rival
 * tokens' moves, a number describing a portfolio nobody holds and which would sit under
 * a column head reading GAIN, in the one column a user is most likely to trade on. The
 * other tempting answer is the biggest riser, which is picking which coin is the real
 * one and presenting the pick as a measurement — precisely the judgement the `unsure`
 * and `several` branches exist to say we have not made.
 *
 *   `one`     → THAT COIN'S move, verbatim, absence and all. A coin with no trailing
 *               day carries `not_reported` and arrives here unchanged.
 *   `none`    → `not_minted`. No coin, so no price, so nothing to have changed.
 *   `unsure`  → ABSENT. The payload carries no coin at all, by construction.
 *   `several` → ABSENT. See above.
 *
 * `not_reported` for the last two is the same knowing compromise projectMarketCap
 * makes: PendingReason has no member meaning "this story does not resolve to a single
 * coin", and if it ever grows a `no_single_coin` these two branches take it together.
 */
export function projectPriceChange24h(coins: WireCoinLink): WireMeasured {
  return fromTheOneCoin(coins, (coin) => coin.priceChange24h);
}

/**
 * The four branches, written once.
 *
 * Both row-level market figures answer the same question — "does this story have one
 * settled coin to borrow a number from?" — and a second copy of the switch is a second
 * set of answers nobody compared. The reasons live here, in one place, which is what
 * makes "the cap says not_minted and the gain says not_reported on the same row"
 * unwritable rather than merely unlikely.
 */
function fromTheOneCoin(
  coins: WireCoinLink,
  read: (coin: WireCoin) => WireMeasured,
): WireMeasured {
  switch (coins.kind) {
    case 'one':
      return read(coins.coin);
    case 'none':
      return measured(null, 'not_minted');
    case 'unsure':
    case 'several':
      return measured(null, 'not_reported');
  }
}

/* ── launches: one coin, in the minute it appeared ────────────────────── */

/**
 * A newly minted coin, as facts, before anything has been bounded or censored.
 *
 * Not `CoinFacts` reused. A launch is not a coin-attached-to-a-story with the story
 * missing: it is a smaller statement with a different key (the asset, not the story), a
 * different question ("what appeared, and when") and a different set of things it is
 * allowed to say. Reusing CoinFacts would carry `imageUrl` and every market number into
 * a payload that must not have them, and a field that is present gets rendered.
 */
export interface LaunchFacts {
  /** '<chain>:<address>'. Unique by constraint, so it is a stable client key. */
  readonly assetKey: string;
  /**
   * ★ ATTACKER-CONTROLLED, BOTH OF THEM. A mint's symbol and name are typed by whoever
   * made the coin: they can impersonate another token, carry markup, carry a URL, be
   * ten kilobytes long, or be empty. They arrive here raw and leave bounded — see
   * `boundedText`, which is the only door they go through.
   */
  readonly ticker: string | null;
  readonly name: string | null;
  /** The on-chain identifier. Also arrives as raw text and is also bounded. */
  readonly address: string;
  /** Already a label, chosen from a Map in db.ts. Never an id passed through. */
  readonly venueLabel: string;
  /** Unknown is normal and stays unknown. Never backfilled from first_seen_at. */
  readonly mintedAt: Millis | null;
  /**
   * How well the mint time is known, as 0005 stores it. Named `precision` rather than
   * `confidence` because `confidence` is a forbidden key on the wire and the two words
   * must not be one keystroke apart in the same file.
   */
  readonly mintPrecision: MintTimeConfidence;
  /** Half-width of the bound, in SECONDS. 0005 requires it when the precision is bounded. */
  readonly mintBoundS: number | null;
  /** The latest reading we hold for this coin, or null when we hold none at all. */
  readonly market: CoinMarket | null;
}

/**
 * ★ MINT TIME ONTO THE WIRE, WHICH IS THE ONE DECISION THIS FUNCTION EXISTS TO MAKE.
 *
 * A live mint feed does not tell us when a coin was minted. It tells us when we heard
 * about it, and the mint happened at or shortly before that — an INTERVAL, not an
 * instant. 0005 has three columns for saying so and a CHECK constraint
 * (`exact_requires_real_source`) that stops the third-party spelling of it claiming to
 * be exact. This is the display side of the same rule.
 *
 * Three cases, and the middle one is the common one:
 *
 *   exact    → the instant, and no bound. Only a real source can produce this, and only
 *              a chain confirmation produces it on this path.
 *   bounded  → the instant AND the width. The rail renders "~3m" and states the bound.
 *              A bounded time rendered as a bare "3m ago" is an estimate wearing a
 *              reading's clothes, and mint time is the axis every ordering claim in the
 *              product hangs on — "the post came before the mint" is the whole thesis,
 *              and it is a claim about seconds.
 *   unknown  → absent, with a reason, and NEVER filled from first_seen_at. That column
 *              is when WE looked, which can postdate a mint by hours; rendering it as an
 *              age would make the oldest and least-known coins look like the freshest.
 *
 * ★ AND THE FOURTH CASE, WHICH IS THE DEFENSIVE ONE: a row claiming `bounded` with no
 * width is a row written around 0005's `bounded_requires_width`. It is published as
 * UNREADABLE rather than as a bare instant. An estimate whose error we cannot state is
 * not a better answer than no answer — it is the same answer with the caveat deleted.
 */
interface MintTimeFacts {
  readonly mintedAt: Millis | null;
  readonly mintPrecision: MintTimeConfidence;
  readonly mintBoundS: number | null;
}

/*
 * ★ THE PARAMETER IS THE THREE COLUMNS AND NOT `LaunchFacts`, so that the pairs screen
 * below goes through this exact function rather than through a second copy of the rule.
 * `LaunchFacts` and `PairFacts` both satisfy it structurally. A duplicated mint-time rule
 * is the one duplication this file cannot afford: the two copies would agree on the day
 * they were written and the drift would show up as an estimate rendered as a reading on
 * whichever surface was edited second.
 */
function projectMintTime(facts: MintTimeFacts): {
  readonly mintedAt: WireInstant;
  readonly mintedAtBoundS: number | null;
} {
  switch (facts.mintPrecision) {
    case 'unknown':
      return { mintedAt: instant(null, 'not_read_yet'), mintedAtBoundS: null };
    case 'exact':
      return { mintedAt: instant(facts.mintedAt, 'not_read_yet'), mintedAtBoundS: null };
    case 'bounded':
      if (facts.mintBoundS === null || !Number.isFinite(facts.mintBoundS)) {
        return { mintedAt: instant(null, 'unreadable'), mintedAtBoundS: null };
      }
      return {
        mintedAt: instant(facts.mintedAt, 'not_read_yet'),
        /* Rounded up: a bound stated smaller than it is claims a precision nobody has,
           and rounding is the cheapest place to lose one. Never below one second. */
        mintedAtBoundS: Math.max(1, Math.ceil(facts.mintBoundS)),
      };
  }
}

/**
 * One launch, finished.
 *
 * Throws WireLeakError if anything in the payload is internal vocabulary — which on this
 * payload means a vendor's name inside a token name somebody typed, and that is not a
 * hypothetical: naming a rival's data vendor in a ticker is free. The caller drops the
 * one row rather than the frame.
 */
export function projectLaunch(facts: LaunchFacts, options: ProjectOptions): WireLaunch {
  const market = currentMarket(facts.market, options) ?? undefined;
  const marketCapUsd = marketNumber(market?.marketCapUsd);
  const mint = projectMintTime(facts);

  const launch: WireLaunch = {
    launchId: facts.assetKey,
    /* An unknown ticker renders as nothing. It does NOT fall back to the address, or to
       the name, or to anything else that would look like a ticker to a person. */
    ticker: boundedText(facts.ticker, TICKER_MAX_CHARS),
    name: boundedText(facts.name, NAME_MAX_CHARS),
    /* Bounded like the other two. A Solana address is at most 44 characters, so a real
       one is never touched; anything longer is not an address, and it arrives visibly
       truncated rather than silently full-length. */
    address: boundedText(facts.address, ADDRESS_MAX_CHARS),
    venueLabel: facts.venueLabel,
    mintedAt: mint.mintedAt,
    mintedAtBoundS: mint.mintedAtBoundS,
    marketCapUsd,
    /* A basis never outlives its cap, in either direction — read off the projected cap
       rather than off the facts, so a stale reading drops both together. */
    marketCapBasis: marketCapUsd.v === null ? null : (market?.marketCapBasis ?? null),
  };

  assertNoInternalVocabulary(launch, `$.launch_row[${facts.assetKey}]`);
  return launch;
}

/**
 * ★ WHETHER THE FEED BEHIND THIS FRAME IS STILL BEING HEARD FROM.
 *
 * The fact this publishes is the one the launches rail had no way to state: a poll loop
 * can be perfectly healthy over a transport that died six days ago, and on the store this
 * was written against it was — the pill read "updated 2s ago" above coins last heard about
 * 141 hours earlier, and both halves of that were true. Two independent facts, and the
 * screen could only say one of them.
 *
 * ★ `lastHeardAt` IS "WHEN DID WE LAST HEAR ANYTHING", NOT "HOW FAR DID WE GET". Those are
 * different questions and the caller has to have asked the right one — see
 * `PgAssetRepo.lastHeardAt`, which excludes gap rows precisely because a gap row's end
 * advances while nothing was heard, so a watcher that reconnects and declares six dark
 * days would otherwise push this instant to now and announce the feed live over exactly
 * the interval we had just declared dark.
 *
 * THREE OUTCOMES, and the first two are different sentences:
 *
 *   never heard    → absent, `not_read_yet`, and NOT live. Nothing has ever been observed
 *                    on this feed. A watcher that has not started yet is a different state
 *                    from a watcher that stopped, and folding them together would tell a
 *                    fresh deployment its feed had died.
 *   heard, stale   → the instant, and NOT live. The rows on the frame are still true; they
 *                    are simply not new, and the surface says so beside them rather than
 *                    hiding them. Removing real rows because they are old trades one lie
 *                    for another.
 *   heard, recent  → the instant, and live.
 *
 * ★ A FUTURE INSTANT IS NOT LIVE. A clock skewed forward would otherwise make a feed
 * unfalsifiably live — `at > nowMs` produces a negative silence, which passes any
 * `silence < bar` test forever. It is published as the reading it is and judged dead,
 * which is the direction that costs a banner rather than the direction that hides one.
 */
export function projectFeedSource(
  lastHeardAtMs: Millis | null,
  options: ProjectOptions,
): WireFeedSource {
  const at = instant(lastHeardAtMs, 'not_read_yet');
  if (at.at === null) {
    /* Never heard from. `live: false` is not a judgement about the world — it is a refusal
       to assert liveness we have no evidence for, which is the same direction every
       absence in this file fails in. */
    return { lastHeardAt: at, live: false };
  }
  const silenceMs = options.nowMs - at.at;
  const source: WireFeedSource = {
    lastHeardAt: at,
    live: silenceMs >= 0 && silenceMs <= options.feedFreshnessMs,
  };
  /* Run for the same reason every other payload here is: this one carries no free text
     today, and the assertion is what keeps that true when somebody adds a field. */
  assertNoInternalVocabulary(source, '$.launch_view.source');
  return source;
}

/* ── which sources we ingest from are answering ───────────────────────── */

/**
 * The two things this projection needs besides the record itself.
 *
 * ★ NOT `ProjectOptions`, DELIBERATELY, and it is `pairs-main.ts`'s argument repeated. That
 * type carries `marketFreshnessMs` — the five-minute window inside which a price may be
 * published as current — and a source indicator has no business anywhere near it. A single
 * options object shared by both would sooner or later grow a "which surface is this" field,
 * and then the board's five minutes would be a parameter somebody could pass differently.
 *
 * ★ AND IT CARRIES THE WHOLE `Policy` RATHER THAN THE TWO NUMBERS, which is the opposite of
 * what `ProjectOptions` does and is deliberate for one reason: `sourceState` in core is the
 * one place that decides what a source's state is, and pulling its inputs out here would be
 * a second, silent copy of WHICH bars that rule reads — which drifts the moment the rule
 * grows a third. The rule takes a policy; this passes a policy.
 */
export interface SourceOptions {
  /** Injected, never read from the clock: a projection has to be reproducible. */
  readonly nowMs: Millis;
  /** Whatever was in force for this frame. Read only by `sourceState`, never here. */
  readonly policy: Policy;
}

/**
 * How long a source's display label may be.
 *
 * The indicator is a corner of a 58px nav and the whole cluster has to stay under about
 * 140px with three sources in it, so this is a layout bound rather than a safety one —
 * `boundedText` is doing the safety work regardless, and every label we actually ship
 * ("X", "TikTok", "Reddit", "Instagram") is well inside it. It exists so that a source key
 * somebody adds later cannot silently push the Connect button off the edge of the screen.
 */
const SOURCE_LABEL_MAX_CHARS = 12;

/**
 * ONE SOURCE, PROJECTED.
 *
 * ★ THE THREE-WAY CALL IS NOT MADE HERE. It is made by `sourceState` in core, which is the
 * one place in the system that decides it, and this file calls that rather than spelling a
 * second version of the ladder. Core's own header states the failure that would follow from
 * two spellings, and it is worth repeating because it is not symmetric: the branch two
 * copies drift toward is always `live`, because `live` is the branch nobody notices being
 * wrong. The process that DOES the calling asks the same function.
 *
 * ★ WHAT THIS FILE DOES DECIDE IS WHAT MAY BE SAID OUT LOUD, and that is the whole of its
 * job here. `SourceHealth` carries two pieces of operator text — `configurationDetail`,
 * which names environment variables, and `lastFailureReason`, which is a vendor's own
 * message kept whole and therefore names both the reseller and, often, us. NEITHER IS READ
 * ON ANY PATH BELOW. What crosses is a label, a word, and an instant. A failure reason shown
 * to a user is "not responding"; what the vendor actually said stays in a schema the
 * browser's role has no USAGE on.
 *
 * ★ AND THE INSTANT IS DERIVED FROM THE SAME FIELD THE STATE IS, so the word and the time
 * beside it cannot disagree. Both read `lastSuccessAt`, and both treat a non-finite value as
 * an absence — `instant()` degrades it to the pending form and `sourceState` returns failing
 * on it, so a corrupt row produces "has never answered, and that is a fault" rather than a
 * green pip with a dash under it.
 *
 * ★ THE LABEL GOES THROUGH `boundedText` LIKE A TOKEN NAME, even though it comes from a Map
 * we wrote. The Map has a fallback branch for a source key it does not know, and that key is
 * a database value; the day one arrives from somewhere less careful than the registry, the
 * difference between a bounded label and an unbounded one is the difference between a
 * truncated pip and a nav with the Connect button pushed off the right of the screen.
 * `boundedText` also strips control and bidi characters, which is what stops a label
 * reordering the text around it. A label that bounds to the empty string is a source that
 * cannot be named on a surface; the caller drops it and says so, rather than rendering a
 * nameless pip or inventing a placeholder — a placeholder is a fiction, and a fiction is
 * labelled a fiction or it is not shown.
 */
export function projectSourceHealth(
  health: SourceHealth,
  label: string,
  options: SourceOptions,
): WireSourceHealth {
  const projected: WireSourceHealth = {
    sourceId: health.source,
    label: boundedText(label, SOURCE_LABEL_MAX_CHARS),
    state: sourceState(health, options.nowMs, options.policy),
    /* `not_read_yet` and not `not_reported`: a source that has never answered is one we have
       not yet heard from, which is a statement about our contact with it. `not_reported`
       would claim the source has no such concept, which is a claim about the source. */
    lastHeardAt: instant(health.lastSuccessAt, 'not_read_yet'),
  };
  assertNoInternalVocabulary(projected, `$.source_view[${health.source}]`);
  return projected;
}

/**
 * One committed frame of the indicator.
 *
 * ★ IT DOES NOT SORT, AND THE REFUSAL IS THE DECISION. The obvious sort is "problems
 * first", and it is wrong here: this is a row of three pips a reader glances at many times
 * a day, and an order that changes when a state changes means the pip under the cursor is
 * not the pip that was there a second ago. The order is the caller's declared order and it
 * is stable across every frame, so a reader learns the positions once and afterwards reads
 * the SHAPES rather than the labels. That is what makes a six-pixel indicator legible at a
 * glance instead of something you have to stop and parse.
 *
 * ★ AN EMPTY ARRAY IS COMMITTED HAPPILY AND MEANS SOMETHING PRECISE: we ingest from nothing
 * at all. It is not a missing frame — the read service answers 404 for that, which is a
 * different fact — and it is not a loading state. The surface reads it as "nothing is
 * ingesting", which over a board full of rows is the most important sentence on the screen.
 */
export function projectSourceFeed(
  tick: number,
  sources: readonly WireSourceHealth[],
): WireSourceFeed {
  return { tick, sources: [...sources] };
}

/* ── pairs: the mints that reached a market ───────────────────────────── */

/**
 * A coin some venue could price, as facts.
 *
 * Not `CoinFacts` and not `LaunchFacts`. A pair is a coin with a reading that HAS a price —
 * the reading is not an optional decoration here, it is the membership test — so `readAt`
 * and the three figures are required fields rather than a nullable `market` object. That is
 * the type saying what the SQL says: `loadPairFacts` inner-joins the latest reading and
 * requires `price_absent is null`, so a row that reached this function has a price by
 * construction and there is no branch here that has to invent one.
 *
 * `marketCapUsd` and `liquidityUsd` stay `MarketNumber` and are routinely absent even so: a
 * bonding curve reports no reserve, which is `not_reported` and is a different fact from
 * `no_market`. The venue's own reason is carried rather than re-guessed.
 */
export interface PairFacts {
  /** '<chain>:<address>'. Unique by constraint, so it is a stable client key. */
  readonly assetKey: string;
  /** ★ ATTACKER-CONTROLLED, BOTH. Typed by whoever minted the coin; bounded on the way out. */
  readonly ticker: string | null;
  readonly name: string | null;
  /** The on-chain identifier. Also raw text, also bounded. */
  readonly address: string;
  /** Already a label, chosen from a Map in db.ts. Never an id passed through. */
  readonly venueLabel: string;
  /** Unknown is normal and stays unknown. Never backfilled from first_seen_at. */
  readonly mintedAt: Millis | null;
  /** Named `precision` and not `confidence`: `confidence` is a forbidden key on the wire. */
  readonly mintPrecision: MintTimeConfidence;
  /** Half-width of the bound, in SECONDS. Required by 0005 when the precision is bounded. */
  readonly mintBoundS: number | null;
  /** When the reading was TAKEN. Never now, never when the row was written. */
  readonly readAt: Millis;
  readonly priceUsd: MarketNumber;
  readonly marketCapUsd: MarketNumber;
  readonly marketCapBasis: MarketCapBasis | null;
  readonly liquidityUsd: MarketNumber;
}

/**
 * The three numbers behind the sentence at the top of the screen.
 *
 * They arrive from ONE statement over ONE population, which is the only reason it is safe
 * to put them beside each other in a sentence. Two statements would be two moments, and
 * "6 of 192" assembled from two moments is a ratio of two different things.
 */
export interface PairCounts {
  readonly mintsInWindow: number;
  readonly withMarket: number;
  readonly withoutMarket: number;
}

/**
 * ★ ONE PAIR, FINISHED — AND NOTE WHAT THIS FUNCTION IS NOT GIVEN.
 *
 * There is no `ProjectOptions` parameter, so there is no `nowMs` and no
 * `marketFreshnessMs`, so this function CANNOT apply the board's staleness gate even if
 * somebody wanted it to. That is deliberate and it is the whole divergence stated as a
 * signature: `projectCoin` drops a reading older than the policy window WHOLE because the
 * board has a Buy button and a price a user is about to act on must be current or absent.
 * This screen has no trade affordance — `WirePair` carries no `tradable` and no
 * `priceUsd`-adjacent action — so suppressing an hour-old reading here would delete the
 * only evidence the screen exists to show, and replace six real rows with eighteen dashes.
 *
 * The honest treatment is the one the product rule already names: a stale reading SAYS it
 * is stale. `readAt` travels with the figures and the screen renders the age beside them.
 * Nothing is suppressed and nothing is presented as current.
 *
 * Throws WireLeakError if anything in the payload is internal vocabulary — which on this
 * payload means a vendor's name inside a token name somebody typed, and that is free to do.
 * The caller drops the one row rather than the frame.
 */
export function projectPair(facts: PairFacts): WirePair {
  const marketCapUsd = marketNumber(facts.marketCapUsd);
  const mint = projectMintTime(facts);

  const pair: WirePair = {
    pairId: facts.assetKey,
    /* An unknown ticker renders as nothing. It does NOT fall back to the address, or to the
       name, or to anything else that would look like a ticker to a person. */
    ticker: boundedText(facts.ticker, TICKER_MAX_CHARS),
    name: boundedText(facts.name, NAME_MAX_CHARS),
    address: boundedText(facts.address, ADDRESS_MAX_CHARS),
    venueLabel: facts.venueLabel,
    mintedAt: mint.mintedAt,
    mintedAtBoundS: mint.mintedAtBoundS,
    /* `unreadable` is the reason a broken instant degrades to, not `not_read_yet`: a row
       reached this function BECAUSE we hold a reading for it, so "we have not read it" is
       the one thing that cannot be true here. */
    readAt: instant(facts.readAt, 'unreadable'),
    priceUsd: marketNumber(facts.priceUsd),
    marketCapUsd,
    /* A basis never outlives its cap, in either direction — read off the projected cap and
       not off the facts, so the two can never be published apart. */
    marketCapBasis: marketCapUsd.v === null ? null : facts.marketCapBasis,
    liquidityUsd: marketNumber(facts.liquidityUsd),
  };

  assertNoInternalVocabulary(pair, `$.pair_row[${facts.assetKey}]`);
  return pair;
}

/**
 * The head of the frame: what the list covers, and when a mint was last heard.
 *
 * `counts` is null exactly when the rows are withheld, and the union below is what makes
 * that unsayable any other way — there is no shape of this function's output that carries a
 * count of coins it refused to list, because a count over a population containing fictions
 * is not the count the sentence on screen would be claiming.
 */
export function projectPairHead(input: {
  readonly windowMs: number;
  readonly lastMintHeardAt: Millis | null;
  readonly counts: PairCounts | null;
}): WirePairHead {
  const rows: WirePairListing =
    input.counts === null
      ? { listing: 'withheld' }
      : {
          listing: 'shown',
          mintsInWindow: input.counts.mintsInWindow,
          withMarket: input.counts.withMarket,
          withoutMarket: input.counts.withoutMarket,
        };

  const head: WirePairHead = {
    windowMs: input.windowMs,
    /* ★ `not_read_yet` AND NOT `not_reported`. An absent instant here means nothing has ever
       been observed on this feed — we have never heard a mint — which is a statement about
       our own contact with the world and not about the world having no mints in it. The two
       render as different sentences on the far side, and they must. */
    lastMintHeardAt: instant(input.lastMintHeardAt, 'not_read_yet'),
    rows,
  };

  /* ★ THE HEAD GOES THROUGH THE CENSOR TOO, and it has to for a reason specific to where it
     is stored rather than for symmetry with the row beside it. 0014 puts `head` on
     public.pair_view, which is granted to the app role, and its own column comment promises
     the value is "already censored" — a promise nothing kept until this line. Every other
     payload committed onto a granted table runs this: `projectPair` does, `projectBoardRow`
     does, and `projectFeedSource` runs it while carrying no free text at all, saying in as
     many words that "the assertion is what keeps that true when somebody adds a field".

     This payload is the one most likely to acquire that field. It is the sentence above the
     table, so the pressure on it is always to explain — a `reason` for the withholding, a
     `threshold` the silence was measured against, a `verdict` about the feed. All three are
     FORBIDDEN_KEYS, all three would be our machinery on a user's screen, and all three would
     have been published silently. */
  assertNoInternalVocabulary(head, '$.pair_view.head');
  return head;
}

/**
 * One whole frame.
 *
 * ★ THE WITHHELD BRANCH DROPS THE ROWS HERE, AT THE PROJECTION, and not at the screen.
 * A frame that carried rows under a `withheld` head would be a frame whose two halves
 * disagree, and the half that got rendered would be whichever one a component happened to
 * read. So the array is emptied where the decision is made, the write puts nothing in
 * public.pair_row, and the decoder on the far side does not look at it. Three layers, one
 * answer.
 */
export function projectPairFeed(
  tick: number,
  head: WirePairHead,
  pairs: readonly WirePair[],
): WirePairFeed {
  return { tick, head, pairs: head.rows.listing === 'withheld' ? [] : pairs };
}

/* ── words ────────────────────────────────────────────────────────────── */

/**
 * Why this post is in this story, in plain English.
 *
 * A switch over the evidence union, so adding a sixth kind is a compile error here
 * rather than a post that silently arrives with no explanation. Note what none of these
 * sentences contains: a distance, a similarity, a carrier weight, or the name of a
 * tier. Those numbers exist, they are on the group stage's row in the decision log, and
 * they are precisely what a user must never be shown — "this post scored 0.83 on the
 * carrier join" is the sentence this vocabulary exists to make unsayable.
 */
export function relationText(relation: MemberRelation): string {
  switch (relation.kind) {
    case 'seed':
      return 'The earliest post we found with this in it.';
    case 'carrier':
      return carrierText(relation.carrier);
    case 'lineage':
      return relation.via === 'reproduction'
        ? 'Posted as its own version of an earlier post.'
        : 'A repost of an earlier post.';
    case 'representation':
      return 'Says much the same thing as the rest.';
    case 'adjudicated':
      return 'A person confirmed this belongs here.';
  }
}

function carrierText(carrier: FingerprintKind): string {
  switch (carrier) {
    case 'imageHash':
      return 'Uses the same picture.';
    case 'textShingle':
      return 'Uses close to the same wording.';
    case 'formatId':
      return 'Uses the same sound or template.';
    case 'entitySpan':
      return 'Names the same thing.';
  }
}

/**
 * The title.
 *
 * `display_title` is written by the qualify stage and null is a legitimate long-term
 * state — a story with nothing nameable in it is a normal outcome, not a gap to be
 * filled with a placeholder. So when it is null we fall back to QUOTING the earliest
 * post rather than generating a sentence: a quotation is a fact about the world, and
 * "Story st_4f2a" or "Trending now" is a placeholder pretending to be one.
 *
 * When there is neither a title nor any text to quote, this returns null and the caller
 * does not project the story at all. A row is not put on the board under a made-up name.
 */
export function projectTitle(story: StoryFacts): string | null {
  const declared = (story.displayTitle ?? '').trim();
  if (declared !== '') return trimTo(declared, TITLE_MAX_CHARS);

  const earliest = earliestMember(story.members);
  const quoted = trimTo((earliest?.excerpt ?? '').trim(), TITLE_MAX_CHARS);
  return quoted === '' ? null : quoted;
}

/**
 * Two lines of plain English, and exactly two.
 *
 * Line one is the spread of the meme; line two is what has been minted from it. Both
 * are counts of things that happened — they would still be true if we did not exist,
 * which is the test every number on this screen has to pass. Breadth is counted in
 * accounts and sources rather than in posts alone, deliberately: one account posting
 * forty times is not forty people making their own version, and the difference between
 * those two is the entire product thesis.
 */
export function projectSummary(story: StoryFacts, coins: WireCoinLink): readonly [string, string] {
  const spread =
    `${count(story.memberCount, 'post')} from ${count(story.distinctAuthors, 'account')}, ` +
    `across ${count(story.distinctSources, 'source')}.`;

  return [spread, coinSentence(coins)];
}

function coinSentence(coins: WireCoinLink): string {
  switch (coins.kind) {
    case 'none':
      return 'Nothing has been minted from this yet.';
    case 'unsure':
      /* The count is a fact. Which of them is the real one is a judgement we have not
         made, and saying so plainly is the point of this branch. */
      return `${count(coins.claimCount, 'coin')} use this, and none of them is clearly the one.`;
    case 'one':
      return coins.coin.ticker === ''
        ? 'One coin uses this.'
        : `One coin uses this, ${coins.coin.ticker}.`;
    case 'several':
      return `${count(coins.coins.length, 'coin')} use this.`;
  }
}

/* ── evidence and discussion ──────────────────────────────────────────── */

/**
 * The posts we counted, each with a link a person can open.
 *
 * ★ A MEMBER WITH NO PERMALINK IS DROPPED. Evidence is the only place a user can check
 * our work, so a piece of it that cannot be opened is not evidence — it is an
 * assertion with a citation-shaped hole in it. Showing it would make the list longer
 * and the claim weaker.
 *
 * The link is not stored anywhere; it is derived from the ids we hold by the adapter
 * that owns the platform, in services/project/src/permalinks.ts, which is also where
 * the three ways of failing to produce one are enumerated. A source with no adapter
 * yields no link and therefore no evidence row — a visible hole, and the correct one,
 * because the alternative is a guessed URL that 404s in front of the single user who
 * cared enough to click it.
 */
export function projectEvidence(members: readonly MemberFacts[]): readonly WireEvidence[] {
  const out: WireEvidence[] = [];
  for (const member of members) {
    const permalink = (member.permalink ?? '').trim();
    if (permalink === '') continue;
    /* ★ AND IT MUST BE AN ABSOLUTE https LINK, checked here rather than trusted from
       upstream. Evidence.tsx renders this string straight into an anchor's href, and an
       href is not a string the browser merely displays — `javascript:` executes,
       `data:` opens a document we did not write, `//host/x` silently changes origin, and
       a bare `x` resolves against our own. Nothing today can produce one: permalinkFor
       splices into a hardcoded `https://` prefix. But `MemberFacts.permalink` is typed
       `string | null` and this is the last place the value is looked at before it
       becomes a link, so the cheapest place to make the whole class impossible is the
       gate that is already dropping members two lines up. A rejected link is a dropped
       row, which is the same visible hole an unlinkable member already leaves. */
    if (!permalink.startsWith('https://')) continue;
    out.push({
      evidenceId: member.itemId,
      sourceLabel: member.sourceLabel,
      authorLabel: member.authorLabel,
      permalink,
      excerpt: trimTo(member.excerpt.trim(), EXCERPT_MAX_CHARS),
      thumbUrl: nonEmpty(member.thumbUrl),
      postedAt: instant(member.postedAt, 'not_reported'),
      relation: relationText(member.relation),
    });
  }
  return out;
}

/* ── the two payloads ─────────────────────────────────────────────────── */

/**
 * One board row, or null when the story has nothing nameable in it.
 *
 * Throws WireLeakError if anything in the finished payload is internal vocabulary — a
 * forbidden key, or a vendor name inside free text a person typed. Throwing is right:
 * the caller skips one story, which is a visible hole, whereas storing it publishes the
 * leak and finds out from a user's browser. The check runs over the WHOLE payload, at
 * every depth, because the likeliest leak is not a key somebody added, it is a word
 * inside a title nobody wrote.
 */
export function projectBoardRow(story: StoryFacts, options: ProjectOptions): WireBoardRow | null {
  const title = projectTitle(story);
  if (title === null) return null;

  const readings = representativeReach(story.members);
  const coins = projectCoins(story.coins, options);

  const row: WireBoardRow = {
    id: story.storyId,
    title,
    summary: projectSummary(story, coins),
    thumbUrl: nonEmpty(story.thumbUrl),
    reach: projectReach(readings),
    spark: projectSpark(readings, options.sparkWindowMs),
    momentum: projectMomentum(readings),
    /* Both taken from the SAME `coins` value the row carries, not re-derived, so the
       two market cells and the button can never disagree about how many coins this
       story has — a cap beside "6 coins claim this", or a gain beside a dash. */
    marketCapUsd: projectMarketCap(coins),
    priceChange24h: projectPriceChange24h(coins),
    firstSeenAt: projectFirstSeenAt(story.members),
    coins,
    isNew: !story.wasOnPreviousBoard,
  };

  assertNoInternalVocabulary(row, `$.board_row[${story.storyId}]`);
  return row;
}

/**
 * The story page. The board row minus `isNew` and minus the row's `marketCapUsd`, plus the
 * day's change, the evidence and the discussion.
 *
 * The market cap is deliberately not repeated here. The page renders the coins THEMSELVES,
 * each with its own cap beside its own ticker, so the story-level roll-up would be a second
 * spelling of the same number in the one place where the honest per-coin answer is already
 * on screen — and on a `several` story it would be a dash sitting next to three real caps,
 * which reads as a bug rather than as a refusal.
 */
export function projectStory(
  story: StoryFacts,
  options: ProjectOptions,
  provenance: WireStoryProvenance,
): WireStory | null {
  const title = projectTitle(story);
  if (title === null) return null;

  const readings = representativeReach(story.members);
  const coins = projectCoins(story.coins, options);

  const page: WireStory = {
    id: story.storyId,
    title,
    summary: projectSummary(story, coins),
    thumbUrl: nonEmpty(story.thumbUrl),
    reach: projectReach(readings),
    reachDelta24h: projectReachDelta24h(readings, options.nowMs),
    spark: projectSpark(readings, options.sparkWindowMs),
    momentum: projectMomentum(readings),
    firstSeenAt: projectFirstSeenAt(story.members),
    coins,
    evidence: projectEvidence(story.members),
    /* There is no discussion table. An empty list says "nobody has said anything here",
       which is true, and it is the only honest thing to send until the table exists. */
    discussion: [],
    /* Handed in rather than derived, because `StoryFacts` deliberately does not carry the
       origin — see `StoryRow.origin` in db.ts. The caller reads it off the same story rows
       the facts came from, so the page and the board cannot disagree about one story. */
    provenance,
  };

  assertNoInternalVocabulary(page, `$.story_view[${story.storyId}]`);
  return page;
}

export interface ProjectedBoard {
  readonly order: readonly string[];
  readonly rows: readonly WireBoardRow[];
  /** Ids withheld because their payload would have leaked. The caller logs them. */
  readonly withheld: readonly string[];
}

/**
 * The whole frame: the committed order and the rows, consistent with each other.
 *
 * `order` and `rows` are built from the SAME filtered list, in the same pass. The client
 * keys rows by id and renders from `order`, so an id in `order` with no row behind it
 * renders nothing at all — a silent hole in the board. Building them separately is how
 * that happens.
 *
 * ★ A LEAKY STORY COSTS ONE ROW, NOT THE FRAME. projectBoardRow throws WireLeakError,
 * and the likeliest trigger by far is a vendor name inside text a PERSON TYPED — a post
 * body quoted as a title, a source's own thumbnail host — on a feed about crypto memes,
 * where those words are ordinary vocabulary. Letting that throw escape put the whole
 * projection inside one transaction on the floor: the frame rolls back, the board freezes
 * at the last tick, and the projector exits non-zero on every subsequent run until the
 * offending story ages out of the window, which can be two days. One missing row is a
 * hole somebody notices; a frozen board is a product that looks like it still works.
 *
 * Only WireLeakError is swallowed. Anything else is a bug in the projection itself and
 * still takes the run down, because a frame built around one is not a frame we know the
 * shape of.
 */
export function projectBoard(
  stories: readonly StoryFacts[],
  options: ProjectOptions,
): ProjectedBoard {
  const rows: WireBoardRow[] = [];
  const withheld: string[] = [];
  for (const story of orderByRecency(stories)) {
    let row: WireBoardRow | null;
    try {
      row = projectBoardRow(story, options);
    } catch (error: unknown) {
      if (!(error instanceof WireLeakError)) throw error;
      withheld.push(story.storyId);
      continue;
    }
    if (row !== null) rows.push(row);
  }
  return { order: rows.map((row) => row.id), rows, withheld };
}

/**
 * What kind of stories this frame is made of.
 *
 * ★ THE COUNT IS OVER THE FRAME AND NOT OVER THE TABLE. `origins` holds exactly the
 * stories that were loaded for this board, so the answer describes what is on screen. A
 * count over `public.story` would keep the banner up for a database that still holds six
 * old fixtures under a board showing nothing but real rows — a permanent warning about
 * rows nobody can see, which is how a banner gets ignored and then removed.
 *
 * Any story of an origin this function does not know about counts as observed. That is
 * the narrow direction, and it is deliberate: the failure it prevents is a new origin
 * being introduced and every real story silently gaining a "this is made up" banner. The
 * opposite mistake — a new KIND of fiction going unannounced — is caught by `STORY_ORIGINS`
 * being a closed list pinned to the schema by `store/src/migrations.test.ts`, so a third
 * member cannot arrive without somebody editing the vocabulary and reading this.
 *
 * ★ `connectSourceLabel` IS A PARAMETER AND NOT A CONSTANT IN THIS FILE, for a boring
 * structural reason worth stating so nobody "tidies" it: the label comes from
 * `sourceLabel` in db.ts, and db.ts imports THIS file. Reaching back for it would close an
 * import cycle. The caller supplies it — see `FREE_POST_SOURCE_LABEL` in db.ts, which is
 * where the map from a source key to the words a user reads already lives.
 */
export function projectBoardProvenance(
  origins: ReadonlyMap<string, StoryOrigin>,
  onFrame: readonly string[],
  connectSourceLabel: string,
): WireBoardProvenance {
  let seeded = 0;
  for (const storyId of onFrame) {
    if (origins.get(storyId) === 'fixture') seeded += 1;
  }
  if (seeded === 0) return { kind: 'observed' };
  return { kind: 'seeded', seededStories: seeded, totalStories: onFrame.length, connectSourceLabel };
}

/**
 * The same question asked of ONE story, for its own page.
 *
 * ★ IT EXISTS SEPARATELY BECAUSE THE PAGE IS REACHABLE WITHOUT THE BOARD. A story link
 * survives being shared, bookmarked and opened cold, and none of those arrive with a board
 * frame whose provenance the page could borrow. Deriving the page's answer from the
 * frame's would make the page honest only when it was clicked through from the list —
 * dishonest in precisely the case where the reader has the least context.
 *
 * An origin this function does not recognise counts as observed, which is the same narrow
 * default `projectBoardProvenance` takes and is chosen for the same reason: a new origin
 * must not silently stamp "this is made up" across every real story.
 */
export function projectStoryProvenance(
  origin: StoryOrigin | undefined,
  connectSourceLabel: string,
): WireStoryProvenance {
  return origin === 'fixture' ? { kind: 'seeded', connectSourceLabel } : { kind: 'observed' };
}

/* ── helpers ──────────────────────────────────────────────────────────── */

/**
 * The member whose series stands for the story.
 *
 * WHY ONE POST RATHER THAN A SUM OVER ALL OF THEM: the members are read on different
 * passes, so their capture instants do not line up, and summing them into a single
 * series means carrying each item's last level forward across instants where it was not
 * read. That carry-forward is a made-up reading — the sum would move because a
 * DIFFERENT post got read, drawing a step that no counter took. Rule 1 of this file
 * forbids inventing a reading to fill a hole, and a sum is that same invention with
 * arithmetic on top. So the story's line is one real post's line: the post that carried
 * it, meaning the one whose reach we know to be highest.
 *
 * Ties break on the id, so the board does not reshuffle between ticks with nothing
 * having changed.
 */
export function representativeReach(members: readonly MemberFacts[]): readonly ReachReading[] {
  let best: MemberFacts | null = null;
  let bestLevel = -Infinity;
  for (const member of members) {
    const level = knownLevel(member.reach);
    if (level === null) continue;
    if (level > bestLevel || (level === bestLevel && best !== null && member.itemId < best.itemId)) {
      best = member;
      bestLevel = level;
    }
  }
  /* Nobody has a readable level yet. Fall back to the longest series we hold, so the
     spark can still show the holes we recorded rather than showing nothing at all. */
  if (best === null) {
    for (const member of members) {
      if (best === null || member.reach.length > best.reach.length) best = member;
    }
  }
  return best?.reach ?? [];
}

function knownLevel(readings: readonly ReachReading[]): number | null {
  for (let i = readings.length - 1; i >= 0; i -= 1) {
    const rate = readings[i]?.rate;
    if (rate === undefined) continue;
    if (rate.kind === 'measured') return rate.level;
    if (rate.lastLevel !== null) return rate.lastLevel;
  }
  return null;
}

function earliestMember(members: readonly MemberFacts[]): MemberFacts | null {
  let earliest: MemberFacts | null = null;
  for (const member of members) {
    if (earliest === null) {
      earliest = member;
      continue;
    }
    if (member.postedAt === null) continue;
    if (earliest.postedAt === null || member.postedAt < earliest.postedAt) earliest = member;
  }
  return earliest;
}

/**
 * Everything a browser draws as nothing, in one expression. See step 2 of `boundedText`
 * for why the third property is here and why a hand-written list is not good enough.
 */
const UNRENDERABLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

/** `null` for anything that is not a non-empty string, so `''` never reaches a component. */
function nonEmpty(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * ★ A STRING SOMEBODY ELSE TYPED, MADE SAFE TO STORE AND SHOW. The only door a token's
 * symbol, name or address goes through.
 *
 * Four steps, and the order of the first two is the whole subtlety:
 *
 *   1. EVERY WHITESPACE CHARACTER BECOMES A PLAIN SPACE. A newline, a tab and a
 *      non-breaking space all SEPARATE WORDS, so they have to survive as separators.
 *      Deleting them instead — which is what step 2 would do to them, since a newline is
 *      also a control character — turns "line one\nline two" into "line onetwo", and a
 *      name that reads as one word is a different name.
 *
 *   2. WHAT IS LEFT OF THE CONTROL, FORMAT AND DEFAULT-IGNORABLE CLASSES IS DELETED.
 *      `\p{Cc}` is the C0/C1 controls; `\p{Cf}` is the format class, which is where the
 *      bidi overrides live. U+202E RIGHT-TO-LEFT OVERRIDE inside a token name does not
 *      affect that name alone — it reverses the visual order of the text AROUND it, so a
 *      coin can rewrite the label sitting beside it on the rail. None of these classes is
 *      renderable content and all are removable without asking what they were for. The
 *      cost is real and accepted: ZERO WIDTH JOINER is in `Cf` and VARIATION SELECTOR-16
 *      is default-ignorable, so a multi-part emoji comes apart into its pieces and a
 *      glyph loses its colour presentation. A cosmetic loss on a name beats a name that
 *      can reorder its own row or wear another coin's ticker.
 *
 *      ★ `\p{Default_Ignorable_Code_Point}` IS THE THIRD ONE AND IT IS NOT REDUNDANT.
 *      Cc and Cf between them do NOT cover every character a browser draws as nothing.
 *      U+115F HANGUL CHOSEONG FILLER, U+1160 HANGUL JUNGSEONG FILLER and U+17B4 KHMER
 *      VOWEL INHERENT AQ are all category Lo or Mn — ordinary letters and marks, as far
 *      as a category test is concerned — and every one of them measures ZERO PIXELS in
 *      the rail's own font. `"BᅟONK"` and `"BONK"` are two different strings that
 *      render to the same picture, which is the entire mechanism this step exists to
 *      stop: on a rail of thirty coins, a lookalike ticker is a coin wearing another
 *      coin's name, and no amount of care further down can undo it because by then the
 *      two are visually the same word. The property is the right test rather than a
 *      hand-written list because it is Unicode's own answer to "is this drawn", and a
 *      list of code points is a list somebody has to remember to extend.
 *
 *   3. RUNS OF SPACES ARE COLLAPSED, which is what makes a name of four thousand spaces
 *      become empty rather than a four-thousand-character cell — and also tidies the gaps
 *      step 2 leaves behind where a control character sat between two spaces.
 *
 *   4. THE RESULT IS CAPPED, with an ellipsis, so a truncation is visible as one. A
 *      silently cut name reads as the coin's actual name, and a coin apparently called
 *      "OFFICIAL SOLANA FOUNDATION TREASU" is a better impersonation than the full string
 *      it came from.
 *
 * Capping happens LAST, so a ten-kilobyte string of invisible characters collapses to
 * nothing rather than to forty-eight characters of garbage with an ellipsis after it.
 *
 * ★ AND THE CAP COUNTS CODE POINTS, NOT UTF-16 UNITS, WHICH IS NOT A NICETY — IT IS THE
 * DIFFERENCE BETWEEN A TRUNCATED NAME AND A PROJECTION THAT CANNOT COMMIT.
 *
 * An astral character (every emoji, and most of the alphabets a token name reaches for)
 * is TWO UTF-16 units in a JavaScript string and one character to everything else. A cut
 * by `.slice(max)` can therefore land between the two halves of one character and leave a
 * LONE SURROGATE on the end of the string. That string is not representable in UTF-8;
 * `JSON.stringify` emits it as a bare `\ud83d` escape, and `writeLaunches` casts exactly
 * that text to `jsonb`, where Postgres refuses it — `invalid input syntax for type json:
 * Unicode low surrogate must follow a high surrogate`. The launches write shares ONE
 * transaction with the board, so the whole run rolls back, and it rolls back again on
 * every subsequent run for as long as the coin sits in the launches window. One token
 * name of 24 emoji — free to mint, and ordinary on this venue without anybody meaning
 * harm — freezes the entire read surface at the tick it was on.
 *
 * `Array.from` iterates code points, so the cut can only ever fall between characters.
 * This is the same rule `hostile.ts` states one layer up, for the same reason, and the
 * two now agree: a cap of 48 means 48 characters in both places, and neither can emit a
 * string Postgres will not take.
 *
 * An absent or all-junk string comes back as `''` — the empty string, not a placeholder
 * and not the address. `projectCoin` makes the same choice for the same reason: a coin
 * with no readable ticker renders as nothing, never as something that looks like one.
 */
function boundedText(raw: string | null, max: number): string {
  if (raw === null) return '';
  const spaced = raw.replace(/\s/gu, ' ');
  const stripped = spaced.replace(UNRENDERABLE, '');
  const collapsed = stripped.replace(/ {2,}/gu, ' ').trim();
  if (collapsed === '') return '';
  const points = Array.from(collapsed);
  if (points.length <= max) return collapsed;
  /* `trimTo` cuts at the last space when there is one, which is right for a sentence and
     wrong for a ticker — a 16-character cap on "MOON SAFE" would cut it to "MOON". So
     the cut is on characters here, and only the ellipsis is shared. */
  return `${points.slice(0, max).join('').trimEnd()}…`;
}

/**
 * Our own long text, cut at a word boundary.
 *
 * Code points again, and for the reason `boundedText` spells out at length: a story title
 * quoted out of a post, or a post's excerpt, is somebody else's text too, and an excerpt
 * that is 200 emoji with no space in it takes the `cut` branch below unchanged. A lone
 * surrogate reaching `story_view.payload` fails the same jsonb cast in the same
 * transaction. Slicing at `lastSpace` afterwards is safe on any measure: a space is one
 * UTF-16 unit, so an index found at one can never sit inside a pair.
 */
function trimTo(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const points = Array.from(collapsed);
  if (points.length <= max) return collapsed;
  const cut = points.slice(0, max).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** "1 post" / "4 posts". English, not a template with a stray `(s)` in it. */
function count(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}
