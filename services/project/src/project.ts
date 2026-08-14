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

import type { Fidelity, FingerprintKind, Millis, Rate } from '@insidor/contracts';

import { orderByRecency } from './order.ts';
import type { Orderable } from './order.ts';
import {
  assertNoInternalVocabulary,
  instant,
  measured,
  WireLeakError,
  type Tone,
  type WireBoardRow,
  type WireCoin,
  type WireCoinLink,
  type WireEvidence,
  type WireInstant,
  type WireMeasured,
  type WireSpark,
  type WireSparkPoint,
  type WireStory,
} from './wire.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Display lengths, not judgements. Nothing branches on them; they only trim strings. */
const TITLE_MAX_CHARS = 96;
const EXCERPT_MAX_CHARS = 240;

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

/** A coin, as facts. Every market number is nullable and null is never zero. */
export interface CoinFacts {
  readonly coinId: string;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly address: string;
  readonly venueLabel: string;
  readonly imageUrl: string | null;
  /** Unknown is normal and stays unknown. Never backfilled from first-seen. */
  readonly mintedAt: Millis | null;
  readonly priceUsd: number | null;
  readonly marketCapUsd: number | null;
  readonly marketCapBasis: 'fully-diluted' | 'circulating' | null;
  /** Absent on a bonding curve. Absence is not illiquidity, which is why it is nullable. */
  readonly liquidityUsd: number | null;
  /** Decided by asking for a quote, never by comparing liquidity to a number. */
  readonly tradable: boolean;
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

export function projectCoin(facts: CoinFacts): WireCoin {
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
    priceUsd: measured(facts.priceUsd, 'no_market'),
    marketCapUsd: measured(facts.marketCapUsd, 'no_market'),
    marketCapBasis: facts.marketCapBasis,
    /* `not_reported` rather than `no_market`: a bonding curve has no two-sided reserve
       to report, so the venue returns no liquidity object at all. Absence here is not
       illiquidity, and the two must not share a spelling — coercing it to 0 and then
       rejecting anything at 0 is how the previous build filtered out essentially the
       entire pre-graduation population, which is the only population we serve. */
    liquidityUsd: measured(facts.liquidityUsd, 'not_reported'),
    tradable: facts.tradable,
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
export function projectCoins(candidates: readonly CoinCandidate[]): WireCoinLink {
  if (candidates.length === 0) return { kind: 'none' };

  const confident = candidates.filter((candidate) => candidate.confident);
  if (confident.length === 0) return { kind: 'unsure', claimCount: candidates.length };

  const coins = confident.map((candidate) => projectCoin(candidate.coin));
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
  switch (coins.kind) {
    case 'one':
      return coins.coin.marketCapUsd;
    case 'none':
      return measured(null, 'not_minted');
    case 'unsure':
    case 'several':
      return measured(null, 'not_reported');
  }
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
  const coins = projectCoins(story.coins);

  const row: WireBoardRow = {
    id: story.storyId,
    title,
    summary: projectSummary(story, coins),
    thumbUrl: nonEmpty(story.thumbUrl),
    reach: projectReach(readings),
    spark: projectSpark(readings, options.sparkWindowMs),
    momentum: projectMomentum(readings),
    /* Taken from the SAME `coins` value the row carries, not re-derived, so the cap and
       the button can never disagree about how many coins this story has. */
    marketCapUsd: projectMarketCap(coins),
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
export function projectStory(story: StoryFacts, options: ProjectOptions): WireStory | null {
  const title = projectTitle(story);
  if (title === null) return null;

  const readings = representativeReach(story.members);
  const coins = projectCoins(story.coins);

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

/** `null` for anything that is not a non-empty string, so `''` never reaches a component. */
function nonEmpty(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

function trimTo(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** "1 post" / "4 posts". English, not a template with a stray `(s)` in it. */
function count(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}
