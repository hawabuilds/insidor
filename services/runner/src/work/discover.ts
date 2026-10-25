/**
 * ONE DISCOVERY PASS, ACROSS WHATEVER IS LIVE.
 *
 * ── ★ THE RULE THIS FILE IS BUILT AROUND ───────────────────────────────────
 *
 * A SOURCE THAT WAS NOT ASKED IS NEVER RECORDED AS A SOURCE THAT HAD NOTHING TO
 * SAY.
 *
 * This is the censored-reading rule applied to a whole platform. A source with no
 * credential produced no items, and so did a source that was asked and found a
 * quiet hour — and if both arrive downstream as `items: 0`, every number computed
 * over them is a claim about the world made partly out of our own configuration.
 * The same shape as writing a zero where a counter does not exist, one layer up.
 *
 * It is enforced by the TYPE and not by discipline: `SourceOutcome` carries an item
 * count on exactly one of its eight members. There is no way to write down "this dark
 * source returned nothing", because that sentence has no representation here.
 *
 * The eight members are eight genuinely different facts:
 *
 *   answered  we asked and it replied. `items` is a measurement, and zero is a real
 *             and meaningful zero: this source was quiet.
 *   failed    we asked and the call threw. Not a measurement of anything.
 *   unasked   it is live, and we could not form a question it can answer. OUR gap,
 *             not the vendor's — which is why it does not touch the failure count,
 *             because inflating that would make our own missing feature look like
 *             somebody else's outage.
 *   dark      it is not live. Nothing was asked. The reason travels with it so a
 *             reader can tell a source nobody turned on from one that is broken.
 *   paused    ★ WE COULD AFFORD IT YESTERDAY AND CANNOT TODAY. The budget refused
 *             the call before it was made. Nothing was asked, the vendor is fine, and
 *             the numbers that produced the refusal travel with it.
 *   planned   ★ A DRY RUN. We worked out what we would ask and what it would cost,
 *             and then did not ask. No call left the process.
 *   deferred  ★ A FREE SOURCE ALREADY ANSWERED THIS TERM, so we did not pay for it.
 *             Names the source that covered it, because "we chose not to" and "there
 *             was nothing there" are opposite facts about the same empty result.
 *   resting   ★ A PAID SOURCE WITH NO CATCH-ALL, BETWEEN ASKS. It is asked by word,
 *             spaced so a day of asks fits its share of the line (`watchEveryMs`), and
 *             this pass falls between two of them. Says when the next one is.
 *
 * ── ★ WHY THE LAST THREE EXIST AS SEPARATE MEMBERS ─────────────────────────
 *
 * Every one of them is a source that returned no items, and every one of them would
 * be indistinguishable from `answered` with `items: 0` if it were recorded that way —
 * which is the same collapse `dark` was added to prevent, arriving by a different
 * road. A stage that stopped because it ran out of money is a different fact from a
 * stage that ran and found a quiet hour, and it demands a different response: one is
 * "raise the cap or lower the cadence", the other is "the internet was quiet". Losing
 * that distinction is how a system that has stopped working reads as a system with
 * nothing to do. It is also the distinction this whole codebase is built on, so it
 * gets a type here rather than a log line.
 *
 * ── ★ ZERO LIVE SOURCES IS A NORMAL RETURN, NOT AN ERROR ───────────────────
 *
 * It is the state of a fresh clone and of any deploy where the keys have not been
 * bought yet, so the pass returns cleanly, having asked nobody and stored nothing,
 * and the loop above says so in one line. It does not throw, does not retry and does
 * not busy-wait: the supervisor's own cadence is the only thing that decides when to
 * look again. One live source runs exactly as three do, with fewer rows.
 *
 * ── ★ WHY THE ITEMS ARE UPSERTED PER SOURCE ────────────────────────────────
 *
 * A vendor that dies on the third source leaves the first two written. Items are
 * FACTS — this post existed and said this — and facts do not need each other to be
 * true, which is the same argument services/market makes for chunk-per-transaction.
 * A board frame is the opposite and is transactional for the opposite reason.
 */

import type { Author, Item, Millis, Policy } from '@insidor/contracts';
import type { Budget, Meter, CostEstimate } from '@insidor/contracts/ports/meter.ts';
import { FEED_LANES } from '@insidor/contracts/ports/platform.ts';
import type { DiscoveryMode, DiscoveryQuery, FeedLane, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { bandFloor, bandWindow, effectiveFloor, pacedDailyUsd, langBandWindow, langEveryMs, langPostsPerDay, langSplitOn, langTarget, laneJudgeUsd, laneMayAsk, searchDayAllowanceUsd, searchDayMayAsk, laneTargets, laneWindowMin, lateBandFloor, lateBands, middleWindow, nextFloor, sentFloors, sliceCoveredByBands, sliceCoveredByLateBand, sliceCoveredByMiddle, sliceFloor, sliceWindow, slowLangs, startFloors, type LaneFloors } from '@insidor/core';
import type { PlatformRegistry } from '@insidor/platform-registry';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { CappedLane, LaneLedger } from './lane-ledger.ts';
import { languageAsks, roundOrder, waitedLongestFirst, type LanguageAsk } from './languages.ts';

/* ── operational constants ────────────────────────────────────────────────
   Page sizes and lookbacks — how much is fetched, never what is decided. Nothing
   here changes a verdict, which is why these literals may sit in a service and may
   not sit in core. */

const MS_PER_MINUTE = 60_000;

/**
 * How far back a pass looks for arrivals.
 *
 * Wider than the cadence on purpose: a pass that asked for exactly one cadence would
 * lose everything published during a restart, a backoff, or a vendor timeout, and
 * lose it silently — there is no gap row for a discovery window nobody asked about.
 * Overlap costs a re-read of items we already hold, which upsert makes free.
 *
 * ★ FREE TO STORE IS NOT FREE TO FETCH, AND THAT IS WHY THIS IS FIFTEEN AND NOT THIRTY.
 * The upsert is free; the vendor is not. On a source billed per item returned, a window
 * six times wider than the cadence means the same post is returned and PAID FOR up to
 * six times before it ages out, so most of a quiet term's bill buys nothing at all.
 *
 * ★ AND THAT IS WHY IT IS FIFTEEN AND NOT TEN, WHICH IS THE MORE IMPORTANT HALF. The
 * width has to survive not one missed pass but a BACKOFF, and the supervisor's ceiling
 * is the cadence itself — so two consecutive failures can put five minutes between us
 * and the last successful window. Three cadences of overlap absorbs that; two absorbs
 * exactly one missed pass and loses arrivals silently on the second, and there is no
 * gap row for a discovery window nobody asked about. Halving the re-billing is worth
 * having. Buying it by making a silent loss reachable is not.
 */
const LOOKBACK_MS = 15 * MS_PER_MINUTE;

/**
 * One page per source per pass, and this many items from it.
 *
 * More is a paging loop, and paging is a budget decision. On the one source that
 * bills per item returned this number is also the RESERVATION: the vendor picks its
 * own page size and we cannot ask for a smaller one, so the pre-check reserves this
 * many items' worth of money whether or not that many come back. Raising it does not
 * fetch more — it reserves more, and a bigger reservation exhausts the cap sooner
 * while returning exactly the same posts.
 */
const PAGE_LIMIT = 100;

/**
 * The discovery modes we know how to render a term into, best first.
 *
 * ★ IT IS A PREFERENCE LIST AND NOT A CONSTANT PER SOURCE, because which modes a
 * source has is the source's declaration to make (`capabilities.discovery`) and not
 * ours to remember. A source that gains keyword search next year is picked up here
 * with no change; a source that has none of these is reported `unasked` by name
 * rather than quietly skipped.
 */
const PREFERRED_MODES: readonly DiscoveryMode[] = ['keyword', 'hashtag', 'feed', 'account', 'catalog'];
/* `catchall` is not on this list: it takes no term. A source that has it is asked the
   catch-all lanes instead — see `feedQueryFor`. */

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/* ── what one source did ──────────────────────────────────────────────────── */

export type SourceOutcome =
  /** Asked, and it replied. `items` is a measurement; zero here is a real quiet. */
  | { readonly kind: 'answered'; readonly source: string; readonly items: number; readonly stored: number | null; readonly hasMore: boolean; readonly lane?: PassLane }
  /** Asked, and the call threw. Recorded against the source's health by the wrapper. */
  | { readonly kind: 'failed'; readonly source: string; readonly reason: string; readonly lane?: PassLane }
  /** Live, and we have no question it can answer. Our gap, not the vendor's. */
  | { readonly kind: 'unasked'; readonly source: string; readonly reason: string }
  /** Not live. Nothing was asked, and the reason distinguishes off from broken. */
  | { readonly kind: 'dark'; readonly source: string; readonly configuration: 'dormant' | 'misconfigured' }
  /**
   * ★ THE BUDGET REFUSED IT. Nothing was asked and the vendor is not implicated.
   * `wouldSpendUsd` is what the call was estimated at and `remainingUsd` is what was
   * left, so the row says whether the cap is too low or the cadence too fast without
   * anybody having to reconstruct it.
   */
  | { readonly kind: 'paused'; readonly source: string; readonly wouldSpendUsd: number; readonly remainingUsd: number; readonly spentUsd: number; readonly capUsd: number; readonly lane?: PassLane }
  /** ★ A DRY RUN. Resolved, priced, and not asked. No call left the process. */
  | { readonly kind: 'planned'; readonly source: string; readonly mode: DiscoveryMode; readonly estUnits: number; readonly wouldSpendUsd: number; readonly lane?: PassLane }
  /** ★ A FREE SOURCE COVERED THIS TERM. We chose not to pay for it, and say who. */
  | { readonly kind: 'deferred'; readonly source: string; readonly coveredBy: string; readonly wouldSpendUsd: number }
  /**
   * ★ ASKED RECENTLY; ITS SHARE OF THE LINE IS SPREAD OVER THE DAY. A paid source with no
   * catch-all is asked once per `everyMs`, not every pass — see `watchEveryMs`. Nothing was
   * asked, nothing is wrong, and `nextAtMs` says when it will be.
   */
  | { readonly kind: 'resting'; readonly source: string; readonly everyMs: number; readonly nextAtMs: number };

/** A lane an outcome can name: the catch-all lanes, and the middle lane (`feed.middle`), which keeps no floor. */
export type PassLane = FeedLane | 'middle';

export interface DiscoverPassResult {
  /** One per KNOWN source, live or not. Never a subset — see `dark` above. */
  readonly outcomes: readonly SourceOutcome[];
  /** Sources we actually called. The denominator of "how many answered". */
  readonly asked: number;
  readonly answered: number;
  readonly failed: number;
  readonly unasked: number;
  readonly dark: number;
  /** Sources the budget refused. Never folded into `failed`; see SourceOutcome. */
  readonly paused: number;
  /** Sources priced and not asked, because this was a dry run. */
  readonly planned: number;
  /** Sources skipped because a free source had already answered the term. */
  readonly deferred: number;
  /** Paid sources without a catch-all, between their spread-out asks. */
  readonly resting: number;
  /**
   * Items returned by sources that ANSWERED. Never includes a dark source's absence
   * as a zero, because a dark source has no item count in this type at all.
   */
  readonly itemsSeen: number;
  /** Items written. Null contributions — a failed write — are excluded, not zeroed. */
  readonly itemsStored: number;
  /**
   * ★ WHAT THIS PASS SPENT, OR WOULD HAVE. On a live pass it is the sum of the estimates
   * for the calls that were made; on a dry pass it is the sum for the calls that were
   * not. The same number either way, which is the property that makes a dry run worth
   * running — it answers "what will this cost me" in the units the invoice arrives in.
   */
  readonly estimatedUsd: number;
  /** The first thing that went wrong, so the run row says which. A pause is not one. */
  readonly firstError: string | null;
  /**
   * ★ WHAT A DAY OF CATCH-ALL SEARCH COSTS AT THIS CADENCE, per source that has it: at the
   * lanes' targets (what the floors steer toward) and at worst (every lane returning
   * `feed.maxPagesPerLane` full pages every pass). Computed on dry and live passes alike, so a dry run answers
   * "what will a day cost" before anything is spent. Both before the hard daily cap, which
   * stops the worst case at the cap.
   */
  readonly feedDays: readonly FeedDay[];
}

export interface FeedDay {
  readonly source: string;
  readonly floors: LaneFloors;
  readonly sentFloors: LaneFloors;
  readonly targets: LaneFloors;
  readonly targetUsd: number;
  readonly worstUsd: number;
}

/* ── the query ────────────────────────────────────────────────────────────── */

/**
 * What to go looking for.
 *
 * ★ TERMS ARE CONFIGURATION AND NOT CODE. What we watch is a product choice that
 * changes far more often than this file does, and a term list compiled into the
 * binary is a term list nobody edits. An empty list is not a legal value: the caller
 * declares discovery `off` instead, so silence is chosen rather than inherited — the
 * same argument as HEARTBEAT and as `capabilities.absent`.
 */
export interface DiscoveryPlan {
  readonly terms: readonly string[];
  /**
   * How often the pass runs. Here so terms can ROTATE — see `termFor`. It is the
   * caller's own cadence handed back to it, rather than a second copy of the number,
   * because two spellings of a cadence is how a rotation silently stops rotating.
   */
  readonly cadenceMs: number;
}

/**
 * Which term this pass looks for.
 *
 * ★ ONE TERM PER PASS, ROTATING, AND BOTH HALVES ARE A COST DECISION.
 *
 * ONE, because a pass that asked every source for every term multiplies the bill by
 * the number of terms, and it does so at the moment somebody edits a config line —
 * with no code change, no review, and no warning. A three-term list would triple a
 * bill that the person who typed it believed was fixed.
 *
 * ROTATING, because the alternative that was here before — `terms[0]`, always — meant
 * a colleague who configured three terms got one of them, forever, and got no warning
 * about the other two. That reads for weeks as "the system found nothing" when what
 * happened is that we never looked. Rotation costs exactly the same as taking the
 * first one and covers the whole list, at the price of visiting each term every
 * `terms.length` passes instead of every pass. On the shipped five-minute cadence a
 * three-term list is a fifteen-minute round trip, which is well inside the thirty
 * minutes of arrivals the lookback window carries.
 *
 * ★ IT IS DERIVED FROM THE CLOCK RATHER THAN FROM A COUNTER, so it survives a restart
 * without state and lands on the same term for the same instant on every replay. A
 * counter in the loop would reset on every deploy, and a system deployed twice a day
 * would spend its life on `terms[0]` — the bug this function exists to fix, restored
 * by the mechanism meant to fix it.
 */
export function termFor(plan: DiscoveryPlan, now: Millis): string | null {
  if (plan.terms.length === 0) return null;
  const period = Math.max(plan.cadenceMs, 1);
  const index = Math.floor(now / period) % plan.terms.length;
  return plan.terms[index] ?? null;
}

/**
 * ★ HOW OFTEN A SOURCE WITH NO CATCH-ALL IS ASKED: its discovery share of its supplier's line,
 * spread evenly over the day.
 *
 * Such a source is asked by word (the configured terms, or else the owner's watch list in
 * `policy.feed.hashtags`), and on the short-video source every ask is a paid scraper run. Asked
 * every pass it would spend the whole line by mid-morning and starve the re-reads that share
 * it; left to the meter's pace it would do the same thing more slowly, with a `paused` warning
 * every two minutes. So the ask is spaced so that a day of them costs `feed.budgetShare` of the
 * line — the same share the catch-all search is allowed, with the rest left for re-reads —
 * and never more often than the pass itself runs. A free source (an ask priced at zero) is
 * asked every pass, exactly as before.
 *
 * Derived, not configured: change the line, the share or the vendor's price and the spacing
 * follows. A line of zero gives no spacing at all — the meter refuses and says so, which is
 * the honest record of "no money", rather than a rest that would hide it.
 */
export function watchEveryMs(usdPerAsk: number, lineCapUsd: number, cadenceMs: number, policy: Policy): number {
  const share = lineCapUsd * policy.feed.budgetShare;
  if (!(usdPerAsk > 0) || !(share > 0)) return cadenceMs;
  /* A spacing the owner set (`feed.watchAskEveryMs`) wins over the derived one; the meter still
     checks each ask against the line, so a line run dry still stops the asks. */
  if (policy.feed.watchAskEveryMs !== null) return Math.max(cadenceMs, policy.feed.watchAskEveryMs);
  /* Whole milliseconds, rounded up: a fractional spacing never quite elapses on a millisecond clock. */
  return Math.max(cadenceMs, Math.ceil((usdPerAsk / share) * MS_PER_DAY));
}

/**
 * ★ WHEN A SPACED ASK MAY GO OUT: null when it may now, else the instant it may.
 *
 * A spacing longer than the pass is held to the clock's own slots of `everyMs` — one ask in each
 * slot, at the first pass inside it — not to `everyMs` after the last ask. Counted from the last
 * ask, each wait also took the rest of the pass it fell in: on 2026-10-14 the 15-minute spacing
 * asked every 15 to 19 minutes (median 16; 39 asks from 01:19 to 11:20 UTC), about 91 a day
 * against 96. And the words of an ask (`watchTermsFor`) come from the same slot, so a wait that
 * crossed two slot edges skipped a pair of words — "meme" and "cute" were asked 8 times in those
 * ten hours against 11 for "dog". On slots there are exactly `MS_PER_DAY / everyMs` asks a day and every
 * pair comes round in turn. Two asks can stand closer than `everyMs` only across a slot edge
 * after a late pass; the count per day, which is what the line pays for, does not change.
 * At or under the pass's own cadence (a free source) the plain elapsed time decides, as before.
 */
export function watchAskDue(lastAskedAt: Millis | null, now: Millis, everyMs: number, cadenceMs: number): Millis | null {
  if (lastAskedAt === null) return null;
  if (everyMs <= cadenceMs) return now - lastAskedAt < everyMs ? ((lastAskedAt + everyMs) as Millis) : null;
  const slot = Math.floor(now / everyMs);
  return Math.floor(lastAskedAt / everyMs) === slot ? (((slot + 1) * everyMs) as Millis) : null;
}

/**
 * Which word a source with no catch-all is asked for: the configured term if there is one,
 * else the owner's watch list, rotated by the clock in steps of the source's own spacing so
 * that consecutive asks walk the list rather than repeat one word. From the clock for the same
 * reason as `termFor`: it survives a restart without state.
 */
export function watchTermFor(watch: readonly string[], everyMs: number, now: Millis): string | null {
  const words = watch.map((w) => w.trim()).filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return words[Math.floor(now / Math.max(everyMs, 1)) % words.length] ?? null;
}

/**
 * ★ SEVERAL WATCH WORDS FOR ONE ASK (`feed.watchWordsPerAsk`): the next `perAsk` words of the list
 * from the clock, each ask starting where the last one ended, so one ask (and one wait between
 * asks) covers several words and the whole list comes round `perAsk` times as often. Never more words than the
 * list holds, never one twice. From the clock for the same reason as `watchTermFor`.
 */
export function watchTermsFor(watch: readonly string[], perAsk: number, everyMs: number, now: Millis): readonly string[] {
  const words = [...new Set(watch.map((w) => w.trim()).filter((w) => w.length > 0))];
  if (words.length === 0) return [];
  const n = Math.min(words.length, Math.max(1, Math.trunc(perAsk)));
  const start = (Math.floor(now / Math.max(everyMs, 1)) * n) % words.length;
  return Array.from({ length: n }, (_, k) => words[(start + k) % words.length] ?? '').filter((w) => w.length > 0);
}

/**
 * ★ THE EXTRA WATCH WORDS FOR THIS ASK (`feed.watchExtra`): its words on every `everyAsks`-th ask
 * slot of the clock, none on the others, and never a word the ask already carries. From the clock
 * like `watchTermsFor`, so a restart neither skips nor repeats a slot. Empty while off.
 *
 * What breaks if changed carelessly: counting asks in memory instead of slots would ask the extra
 * words on the first ask after every deploy, and a deploy-heavy day would pay for them every time.
 */
export function watchExtraFor(policy: Policy, already: readonly string[], everyMs: number, now: Millis): readonly string[] {
  const extra = policy.feed.watchExtra;
  if (!extra.on) return [];
  const every = Math.max(1, Math.trunc(extra.everyAsks));
  if (Math.floor(now / Math.max(everyMs, 1)) % every !== 0) return [];
  const have = new Set(already.map((w) => w.trim().toLowerCase()));
  return [...new Set(extra.words.map((w) => w.trim()).filter((w) => w.length > 0 && !have.has(w.toLowerCase())))];
}

/**
 * When each source with no catch-all was last asked, kept by the loop between passes. In
 * memory on purpose: a restart forgets it and asks at once, which costs one extra ask per
 * deploy and never a missed one — the slow lane's trade.
 */
export interface WatchClock {
  lastAskedAt(source: string): Millis | null;
  asked(source: string, at: Millis): void;
}

/** A clock held in memory, for the loop. */
export function memoryWatchClock(): WatchClock {
  const at = new Map<string, Millis>();
  return {
    lastAskedAt: (source) => at.get(source) ?? null,
    asked: (source, when) => void at.set(source, when),
  };
}

/**
 * Render one term for one source, or say why we cannot.
 *
 * ★ `untilMs` IS NULL AND THAT IS A DELIBERATE DECLARATION, not an omission. Null
 * means live discovery: take whatever is newest. A replay passes the decision instant
 * instead, which is what makes a historical run structurally blind rather than blind
 * by good intentions. This is the live path, so the honest value is null — and it is
 * written out rather than left off so that nobody later "fixes" it into a clock read.
 */
export function queryFor(adapter: PlatformAdapter, term: string, now: Millis): DiscoveryQuery | null {
  const mode = PREFERRED_MODES.find((m) => adapter.capabilities.discovery.includes(m));
  if (mode === undefined) return null;
  return {
    mode,
    term,
    sinceMs: (now - LOOKBACK_MS) as Millis,
    untilMs: null,
    limit: PAGE_LIMIT,
    cursor: null,
  };
}

/**
 * One catch-all lane for one pass: no term, the lane's floor as the vendor filter, and the
 * policy window ending now.
 *
 * ★ `untilMs` IS NOW, NOT NULL, unlike `queryFor`. The earlier build sent an explicit
 * upper bound and the window is defined by both ends; the source refuses a page carrying
 * anything at or after it (the adapter's cutoff check), which on a live search cannot
 * happen and would be worth knowing about if it did.
 */
export function feedQueryFor(lane: FeedLane, floors: LaneFloors, now: Millis, policy: Policy): DiscoveryQuery {
  return {
    mode: 'catchall',
    term: '',
    sinceMs: (now - laneWindowMin(lane, policy) * MS_PER_MINUTE) as Millis,
    untilMs: now,
    limit: policy.feed.pageLimit,
    cursor: null,
    filter: {
      minApproval: effectiveFloor(lane, floors, policy),
      mediaOnly: lane === 'media',
      /* The slow lane asks its own languages (`slow.langs`), so its slices do not multiply with `feed.langs`. */
      langs: lane === 'slow' ? slowLangs(policy) : policy.feed.langs,
      /* Plain reposts only: replies and quotes are searched (the owner, 2026-10-13). */
      excludeRebroadcasts: true,
    },
  };
}

/**
 * ★ THE SLOW LANE, AS TIME SLICES (`feed.slow.slices`). Asked newest first over its whole six
 * hours, its pages filled inside the newest hour and it never saw anything older — the exact
 * posts it exists for. So it asks one page for each of `slices` bands instead: band k holds the
 * posts aged k·(window/slices) − `slow.everyMs` to k·(window/slices) minutes, newest first, at
 * the lane's floor. Each band is as wide as the lane's own spacing, so the bands move by their
 * width each pass and every post is looked at once as it turns one, two, … six hours old — the
 * moments a post that crossed the floor late can still be caught — rather than the newest hour
 * six times over.
 *
 * What breaks if changed carelessly: a band wider than the spacing double-counts posts on
 * consecutive passes and pays for them twice; narrower leaves gaps no pass looks at. A full band
 * is not paged: its floor rises with the lane's target instead, which is the money lever.
 */
export function slowSliceQueries(floors: LaneFloors, now: Millis, policy: Policy, clock?: FreshClock, source = ''): readonly DiscoveryQuery[] {
  return slowSlices(source, floors, now, policy, clock).map((s) => s.query);
}

/** The clock key of one slow slice, by its oldest age: its own window (core `sliceWindow`), shared by its languages. */
export const sliceKey = (source: string, oldestAgeMin: number): string => `${source}:slow:${oldestAgeMin}`;

/**
 * The slow lane's slices this pass, each with the key its window is kept under.
 *
 * ★ TILED BY A CLOCK (core `sliceWindow`, from policy.v181): each slice asks from where its last
 * answered ask ended, so slow passes 15 to 17 minutes apart, or one held back, leave no posting time
 * unasked at that age. Without a clock (a start, or no clock given) a slice is its nominal width.
 * ★ EACH AT ITS OWN FLOOR (`slow.ageScaledFloor`, core `sliceFloor`).
 */
export function slowSlices(source: string, floors: LaneFloors, now: Millis, policy: Policy, clock?: FreshClock): readonly { readonly query: DiscoveryQuery; readonly clockKey: string }[] {
  const base = feedQueryFor('slow', floors, now, policy);
  const sent = base.filter?.minApproval ?? 0;
  const slices = Math.max(1, Math.floor(policy.feed.slow.slices));
  const stepMin = laneWindowMin('slow', policy) / slices;
  const widthMin = Math.min(policy.feed.slow.everyMs, stepMin * MS_PER_MINUTE) / MS_PER_MINUTE;
  return Array.from({ length: slices }, (_, i) => {
    const oldestAgeMin = (i + 1) * stepMin;
    const youngestAgeMin = oldestAgeMin - widthMin;
    const clockKey = sliceKey(source, oldestAgeMin);
    const minApproval = sliceFloor(sent, oldestAgeMin, policy);
    return { oldestAgeMin, youngestAgeMin, clockKey, minApproval, window: sliceWindow(youngestAgeMin, widthMin, clock?.lastUntil(clockKey) ?? null, now, policy) };
  }).filter((s) =>
    /* A late band (`feed.fresh.late`) at an age inside this slice asks the same posts at a floor no higher;
       so does the middle lane (`feed.middle`) over a slice wholly inside its window. */
    s.window !== null &&
    !sliceCoveredByBands(s.youngestAgeMin, policy) &&
    !sliceCoveredByLateBand(s.youngestAgeMin, widthMin, policy, floors, s.minApproval) &&
    !sliceCoveredByMiddle(s.youngestAgeMin, widthMin, s.minApproval, policy),
  ).map((s) => ({
    clockKey: s.clockKey,
    query: { ...base, filter: { ...base.filter!, minApproval: s.minApproval }, sinceMs: Math.round(s.window!.since) as Millis, untilMs: Math.round(s.window!.until) as Millis },
  }));
}

/**
 * ★ THE MIDDLE LANE'S ASK (`feed.middle`): every post `minAgeMin` to `maxAgeMin` minutes old over
 * its fixed floor, in the main lanes' languages and with plain reposts left out, newest first. One
 * query; the pass pages it until the window is exhausted, its page limit, or its cap.
 *
 * What breaks if changed carelessly: sending an adapted floor here would let a quiet hour pull the
 * floor down and a busy one buy the same window several times over — the fixed floor is what
 * makes its cost the count of posts over it.
 */
export function middleQuery(floors: LaneFloors, now: Millis, policy: Policy): DiscoveryQuery {
  const base = feedQueryFor('all', floors, now, policy);
  const window = middleWindow(now, policy);
  return {
    ...base,
    sinceMs: Math.round(window.since) as Millis,
    untilMs: Math.round(window.until) as Millis,
    filter: { ...base.filter!, minApproval: Math.max(policy.feed.effectiveFloorMin, Math.round(policy.feed.middle.minApproval)), mediaOnly: false },
  };
}

/**
 * ★ WHERE EACH FRESH BAND'S LAST ANSWERED ASK ENDED (`feed.fresh`), kept by the loop between
 * passes. In memory on purpose, the slow lane's trade: a restart forgets it and the next ask
 * reaches back `fresh.maxWindowMin`, which re-buys at most one window of posts and never
 * misses one. Set only when the source answered: a failed or paused ask leaves the window open,
 * so the next pass asks for it again.
 */
export interface FreshClock {
  lastUntil(key: string): Millis | null;
  ran(key: string, until: Millis): void;
}

/** A fresh-band clock held in memory, for the loop. */
export function memoryFreshClock(): FreshClock {
  const at = new Map<string, Millis>();
  return {
    lastUntil: (key) => at.get(key) ?? null,
    ran: (key, until) => void at.set(key, until),
  };
}

/**
 * The clock key of one band on one source, and of one language's search of it (work/languages.ts):
 * each language keeps its own window, so a language that failed is asked again from where it
 * stood while the others move on.
 */
export const bandKey = (source: string, ageMin: number, lang: string | null = null): string => `${source}:${ageMin}${lang === null ? '' : `:${lang}`}`;

/** The clock key of one late band (`feed.fresh.late`): its own, so a late band at a fresh band's age keeps its own window. */
export const lateBandKey = (source: string, ageMin: number, lang: string | null = null): string => `${source}:late:${ageMin}${lang === null ? '' : `:${lang}`}`;

/** One language's search of a fresh or late band, with the clock key its window is kept under. */
export interface BandLanguageAsk extends LanguageAsk {
  readonly clockKey: string;
}

/**
 * ★ THE FRESH BANDS (`feed.fresh`), in place of the 'all' lane's ten-minute window: for each age
 * in `fresh.bandAgesMin`, the posts that turned that old since the band's last ask, at the 'all'
 * floor scaled to the age, newest first. Paged like a main lane, because a band's page is the
 * whole of its window: a full page with more behind it would otherwise be a gap.
 *
 * What breaks if changed carelessly: a band window computed without the clock overlaps the last
 * one and buys the same posts again, which is the waste this replaces.
 */
export function freshBandQueries(source: string, floors: LaneFloors, now: Millis, policy: Policy, clock: FreshClock | undefined, split?: LanguageSplit): readonly { readonly query: DiscoveryQuery; readonly age: number; readonly late: boolean; readonly languages: readonly BandLanguageAsk[] }[] {
  const base = feedQueryFor('all', floors, now, policy);
  const ask = (age: number, keyOf: (lang: string | null) => string, minApproval: number, late: boolean): { readonly query: DiscoveryQuery; readonly age: number; readonly late: boolean; readonly languages: readonly BandLanguageAsk[] }[] => {
    /* A late band asks the slow lane's languages (`slow.langs`): it is the slow lane's kind of search. */
    const banded: DiscoveryQuery = { ...base, filter: { ...base.filter!, minApproval, ...(late ? { langs: slowLangs(policy) } : {}) } };
    /* ★ EACH LANGUAGE ITS OWN WINDOW (work/languages.ts): from where that language's last answered
       ask ended, so one that failed is asked again and the others are not re-bought. With the split
       (`feed.langSplit`) a fresh band's language also has its own floor, and is asked only once its
       window spans its own spacing. */
    const languages = languageAsks(banded).flatMap((l): BandLanguageAsk[] => {
      const clockKey = keyOf(l.lang);
      const own = split !== undefined && !late && l.lang !== null;
      const lastUntil = clock?.lastUntil(clockKey) ?? null;
      const window = own ? langBandWindow(age, lastUntil, now, split.everyMsOf(l.lang!), policy) : bandWindow(age, lastUntil, now, policy);
      if (window === null) return [];
      const filter = own ? { ...l.query.filter!, minApproval: bandFloor(age, { ...floors, all: split.floorOf(l.lang!) }, policy) } : l.query.filter;
      return [{ ...l, clockKey, query: { ...l.query, ...(filter === undefined ? {} : { filter }), sinceMs: Math.round(window.since) as Millis, untilMs: Math.round(window.until) as Millis } }];
    });
    const first = languages[0];
    if (first === undefined) return [];
    /* The band as one query, for pricing and the log: the widest of its languages' windows. */
    const sinceMs = Math.min(...languages.map((l) => l.query.sinceMs ?? now)) as Millis;
    return [{ age, late, languages, query: { ...banded, sinceMs, untilMs: first.query.untilMs } }];
  };
  /* A single language (or none) keeps the band's own key, so its clock reads as it always has. */
  const one = languageAsks(base).length === 1;
  const oneLate = slowLangs(policy).length <= 1;
  return [
    ...policy.feed.fresh.bandAgesMin.flatMap((age) => ask(age, (lang) => bandKey(source, age, one ? null : lang), bandFloor(age, floors, policy), false)),
    /* ★ LATE BANDS (`feed.fresh.late`): the same tiling at an age in hours, at a fixed floor. Empty while off. */
    ...lateBands(policy).flatMap((b) => ask(b.ageMin, (lang) => lateBandKey(source, b.ageMin, oneLate ? null : lang), lateBandFloor(b.minApproval, floors, policy), true)),
  ];
}

/**
 * ★ EACH LANGUAGE'S FLOOR AND SPACING on the fresh bands (`feed.langSplit`), for `freshBandQueries`:
 * the floor its own adaptation left (internal.feed_lang_floor, 0111), and how often its share lets it
 * be asked (core `langEveryMs`).
 */
export interface LanguageSplit {
  floorOf(lang: string): number;
  everyMsOf(lang: string): number;
}

/* ── the pass ─────────────────────────────────────────────────────────────── */

/**
 * Whether this pass may contact a vendor at all.
 *
 * ★ `dry` IS NOT "live WITH THE CALLS COMMENTED OUT". It resolves the same sources,
 * renders the same queries and prices them against the same price books the live path
 * bills against — and then returns without issuing one request. That is what makes it
 * an answer to "what will this cost me" rather than a guess: the arithmetic is the
 * production arithmetic, and the only thing removed is the socket.
 */
export type DiscoverMode = 'live' | 'dry';

export interface DiscoverDeps {
  readonly platforms: PlatformRegistry;
  /**
   * Store the arrivals: the accounts first, then the posts. Narrow on purpose: this pass
   * may not read or decide. Authors go first so a post's author row carries its handle from
   * the first read, and a story page can cite the post the moment it is grouped.
   */
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly plan: DiscoveryPlan;
  readonly policy: Policy;
  /**
   * The ledger, consulted BEFORE each call rather than only inside the adapter.
   *
   * ★ THE ADAPTER'S OWN CHECK IS NOT REMOVED AND THIS IS NOT A DUPLICATE OF IT.
   * `metered()` refuses at the last possible moment and throws, which is the backstop
   * and must stay — it covers every call site including the ones written later. This
   * check happens where the OUTCOME can be recorded properly: a refusal caught here
   * knows which source it was, what the call was estimated at, and what was left, and can
   * write a `paused` row saying so. Catching the throw alone would give us the same
   * refusal with none of the numbers.
   */
  readonly meter: Meter;
  readonly mode: DiscoverMode;
  readonly log: Logger;
  readonly now: () => Millis;
  /**
   * The catch-all lanes' approval floors, kept between passes (internal.feed_floor). Read
   * before the pass; written after a LIVE pass only — a dry run learns nothing to move them by.
   */
  readonly floors: {
    floors(): Promise<Readonly<Record<string, number>>>;
    set(lane: string, floor: number, at: Millis): Promise<void>;
    /** Each language's fresh-band floor (0111, `feed.langSplit`). Absent: every language starts at the 'all' floor each pass. */
    langFloors?(): Promise<Readonly<Record<string, number>>>;
    setLang?(lang: string, floor: number, at: Millis): Promise<void>;
  };
  /** The day's hard cap — the lower of the environment's and policy's. Sets each lane's target. */
  readonly dailyCapUsd: number;
  /**
   * The catch-all lanes asked this pass. The slow lane runs on its own clock
   * (`feed.slow.everyMs`), so the loop says when it is due. Absent: the two main lanes.
   */
  readonly lanes?: readonly FeedLane[];
  /** Aborted on SIGTERM. A pass that ignores it delays every deploy by a vendor call. */
  readonly signal: AbortSignal;
  /**
   * When each source with no catch-all was last asked — see `watchEveryMs`. The loop always
   * passes one; absent, every such source counts as never asked, which only a test wants.
   */
  readonly watch?: WatchClock;
  /** Where each fresh band's last ask ended (`feed.fresh`). Absent: every band reaches back its cap. */
  readonly fresh?: FreshClock;
  /**
   * ★ THE MIDDLE LANE (`feed.middle`), when the loop says it is due: its ledger (0088), read before
   * every page and added to after, and how many of a page's posts no lane has found yet (the
   * judging it brings in). Absent: the middle lane is not asked this pass.
   */
  readonly middle?: {
    readonly ledger: LaneLedger;
    readonly uncredited: (itemIds: readonly string[]) => Promise<number>;
  };
  /**
   * ★ 'middle': this pass asks the middle lane and nothing else — no catch-all lane, no term, no
   * watch list, no floor moved. The middle loop's pass (loops/middle.ts). It runs outside the
   * discover pass so its paging can never hold up the steps after that pass, the live judge first.
   * Absent: the discover pass, which asks the middle lane only if `middle` is given.
   */
  readonly only?: 'middle';
  /**
   * ★ THE CAPPED LANES' LEDGER (0088), for a catch-all search that reads past short pages
   * (`feed.paging`): its day is read before it asks and added to after. Absent, or unreadable,
   * every such search keeps the old rule, so no search spends past a day nobody can count.
   */
  readonly ledger?: LaneLedger;
  /**
   * ★ THE X SEARCH DAY (`feed.searchDay`): what a supplier's search has been billed since 00:00 UTC,
   * as metered (internal.spend). Read once a pass per vendor, then kept current from each page's bill.
   * Null: the bill cannot be read, and no catch-all search is asked. Absent: no day is kept (a test).
   */
  readonly searchDay?: { spent(vendor: string, now: Millis): Promise<number | null> };
}

/**
 * How one ask pages (`feed.paging`, `feed.middle.fullPaging`).
 *
 *   full      read while the source says there is more; false is the old rule, which stops at
 *             the first page that came back short.
 *   maxPages  pages this ask may read, the first included.
 *   deadline  how long it may page from `from`; null, no deadline (the old rule).
 *   ledger    the search's own day (lane and cap) when it is not the middle lane's; null, none.
 */
interface PageRule {
  readonly full: boolean;
  readonly maxPages: number;
  readonly deadlineMs: number | null;
  readonly ledger: { readonly lane: CappedLane; readonly dailyUsd: number; readonly spentUsd: number } | null;
}

/** Why one language's search stopped, for the log: the source's end, or which of our limits. */
type Stop = 'end' | 'short' | 'pages' | 'meter' | 'cap' | 'day' | 'deadline' | 'empty' | 'aborted' | 'failed';
/* The stops that are a day running out — the search's own, the X search day's, the meter's line — as opposed to the window, a page limit or the clock. */
const MONEY_STOPS: ReadonlySet<Stop> = new Set<Stop>(['cap', 'day', 'meter']);

/** One language's search inside an ask (work/languages.ts): its own cursor, pages, empty run and end. */
interface Thread {
  readonly lang: string | null;
  readonly query: DiscoveryQuery;
  /** A band's: the key its window is kept under (`bandKey`). */
  readonly clockKey: string | undefined;
  cursor: string | null;
  hasMore: boolean;
  items: Item[];
  authors: Author[];
  pages: number;
  emptyRun: number;
  open: boolean;
  stop: Stop;
  error: string | null;
}

/**
 * The name a catch-all ask is listed under in `feed.paging.searches`, or null for an ask that
 * is never paged (a term or the watch list) and for the middle lane, which has its own switch.
 */
export function pagingKey(plan: { readonly lane: FeedLane | null; readonly slice: boolean; readonly band: number | null; readonly late: boolean; readonly middle: boolean }): string | null {
  if (plan.middle || plan.lane === null) return null;
  if (plan.slice) return 'slow';
  if (plan.band !== null) return `${plan.late ? 'late' : 'band'}_${plan.band}`;
  return plan.lane;
}

/**
 * The ceiling handed to each call.
 *
 * Constructed truthfully rather than left as zeroes even though most of it binds
 * nothing today: a zero cap reads downstream as "no money at all", and the day a paid
 * source is genuinely live behind this call site, an honest-looking zero is the worst
 * thing to find there. Same argument as services/market's `budgetFor`.
 *
 * ★ AND IT IS STILL NOT WHAT STOPS THE SPENDING. No adapter reads this object; the
 * refusal comes from the meter, above and inside the adapter. It is said here as well
 * as on the `Budget` type because this is the call site somebody tuning a bill will
 * read first, and lowering `discoveryUsdPerDay` here changes nothing at all.
 */
function budgetFor(policy: Policy, now: Millis, sources: number): Budget {
  return {
    capUsd: policy.budget.discoveryUsdPerDay,
    spentUsd: 0,
    /* One page per source per pass. A real ceiling, and the only one that binds on a
       source whose vendor rations requests rather than dollars. */
    maxCalls: Math.max(sources, 1),
    deadline: (now + 5 * MS_PER_MINUTE) as Millis,
  };
}

/**
 * One source, resolved and priced, before anything is asked.
 *
 * ★ THE PASS IS SPLIT INTO PREPARE-THEN-EXECUTE PRECISELY SO THAT PRICING HAPPENS
 * BEFORE ORDERING. Free-before-paid cannot be decided while iterating: by the time
 * the expensive source has been reached, the cheap ones behind it in registry order
 * have already been skipped or the expensive one has already spent. Both questions —
 * what order, and can we afford it — are answered from the estimate, and the estimate is
 * available before any call because `PlatformAdapter.estimate` performs no I/O.
 */
interface SourcePlan {
  readonly adapter: PlatformAdapter;
  readonly source: string;
  readonly query: DiscoveryQuery;
  readonly estimate: CostEstimate;
  /** The catch-all lane this is, or null for a term search. */
  readonly lane: FeedLane | null;
  /** An ask on a source with no catch-all, spaced by `watchEveryMs`: its clock is set when asked. */
  readonly spaced: boolean;
  /** An ask from the owner's watch list: its fresh posts are credited to the 'watch' lane (0061), so they are judged. */
  readonly watch: boolean;
  /** One time slice of the slow lane (`slowSliceQueries`): one page, never more. */
  readonly slice: boolean;
  /** The age of the fresh band this is (`freshBandQueries`), or null. */
  readonly band: number | null;
  /** A late band (`feed.fresh.late`): fixed floor, so what it returns never moves a lane's floor. */
  readonly late: boolean;
  /** The middle lane (`feed.middle`): fixed floor, its own cap, paged to the end of its window. */
  readonly middle: boolean;
  /**
   * ★ THE SEARCHES THIS ASK IS MADE OF: one per language (work/languages.ts), each paged on its own
   * cursor under the ask's caps. A band's carry the clock key each language's window is kept under.
   */
  readonly languages: readonly (LanguageAsk & { readonly clockKey?: string })[];
}

export async function discoverPass(deps: DiscoverDeps): Promise<DiscoverPassResult> {
  const outcomes: SourceOutcome[] = [];
  let itemsSeen = 0;
  let itemsStored = 0;
  let estimatedUsd = 0;
  let firstError: string | null = null;

  /* ★ THE DARK SOURCES ARE RECORDED FIRST AND UNCONDITIONALLY. Written before any
     call so that a pass which dies halfway still leaves a complete account of what
     was not asked — the half we would otherwise lose is exactly the half nobody
     notices is missing. */
  for (const absence of deps.platforms.absent()) {
    outcomes.push({ kind: 'dark', source: absence.source, configuration: absence.configuration });
  }

  const live = deps.platforms.all();

  if (live.length === 0) {
    /* Not an error, not a warning, and not silence. A legitimate state that has to be
       SAID, because the alternative is a pass that looks identical to a healthy one
       over a quiet hour. */
    deps.log.info('no source is live; discovering from nothing', {
      dark: outcomes.map((o) => (o.kind === 'dark' ? `${o.source}:${o.configuration}` : o.source)),
    });
  }

  /* ★ ONE INSTANT FOR THE WHOLE PASS, read once. Every source is then asked for the
     same window, which is what makes "two sources saw different amounts" a fact about
     the sources rather than about how long our own loop took. */
  const now = deps.now();
  const term = termFor(deps.plan, now);
  const budget = budgetFor(deps.policy, now, live.length);

  /* The lanes' floors as last adapted, or policy's start for a lane never adapted. */
  const stored = await deps.floors.floors();
  const floors: Record<FeedLane, number> = { ...startFloors(deps.policy) };
  for (const lane of FEED_LANES) {
    const held = stored[lane];
    if (held !== undefined && Number.isFinite(held) && held > 0) floors[lane] = held;
  }

  /* ★ EACH LANGUAGE'S FLOOR (`feed.langSplit`), as last adapted; a language never adapted starts at
     the shared 'all' floor. Unreadable: every language starts there this pass, and nothing is lost
     but this pass's adaptation, which then starts from it. */
  const splitOn = langSplitOn(deps.policy);
  const langFloors: Record<string, number> = {};
  if (splitOn) {
    try {
      const held = (await deps.floors.langFloors?.()) ?? {};
      for (const [lang, floor] of Object.entries(held)) if (Number.isFinite(floor) && floor > 0) langFloors[lang] = floor;
    } catch (e) {
      deps.log.warn("could not read the languages' floors; each starts at the shared floor this pass", { err: errorText(e) });
    }
  }
  const langFloor = (lang: string): number => langFloors[lang] ?? floors.all;

  /* ── prepare: resolve and price every source before asking any of them ──── */

  const plans: SourcePlan[] = [];
  for (const adapter of live) {
    const source = String(adapter.id);

    /* ★ THE CATCH-ALL FIRST, ON EVERY SOURCE THAT CAN BE ASKED FOR IT: two lanes, no
       keyword. Then the optional term on top. */
    const asks: { readonly query: DiscoveryQuery; readonly lane: FeedLane | null; readonly spaced?: boolean; readonly watch?: boolean; readonly slice?: boolean; readonly band?: number; readonly late?: boolean; readonly middle?: boolean; readonly languages?: readonly (LanguageAsk & { readonly clockKey?: string })[] }[] = [];
    const middleOnly = deps.only === 'middle';
    const hasCatchAll = adapter.capabilities.discovery.includes('catchall');
    if (hasCatchAll && !middleOnly) {
      const fresh = deps.policy.feed.fresh.enabled;
      for (const lane of deps.lanes ?? MAIN_LANES) {
        if (lane === 'slow') for (const { query, clockKey } of slowSlices(source, floors, now, deps.policy, deps.fresh)) asks.push({ query, lane, slice: true, languages: languageAsks(query).map((l) => ({ ...l, clockKey })) });
        /* Fresh bands replace both main lanes: the media lane's posts clear the bands' floor too. */
        else if (fresh && lane === 'media') continue;
        /* A late band's posts are the slow lane's kind (found hours in), so they are stored as its finds. */
        else if (fresh && lane === 'all') {
          /* The split's spacing is in posts, so it needs the source's price of one (`feed.langSplit`). */
          let split: LanguageSplit | undefined;
          if (splitOn) {
            let usdPerPost = 0;
            try {
              const probe = adapter.estimate({ kind: 'discover', query: feedQueryFor('all', floors, now, deps.policy) });
              usdPerPost = probe.estUnits > 0 ? probe.usd / probe.estUnits : 0;
            } catch {
              /* Unpriced: every language gets the slowest spacing, and the pricing step below says why. */
            }
            split = { floorOf: langFloor, everyMsOf: (lang) => langEveryMs(lang, usdPerPost, deps.policy) };
          }
          for (const { query, age, late, languages } of freshBandQueries(source, floors, now, deps.policy, deps.fresh, split)) asks.push({ query, lane: late ? 'slow' : lane, band: age, late, languages });
        }
        else asks.push({ query: feedQueryFor(lane, floors, now, deps.policy), lane });
      }
    }
    const catchAll = middleOnly ? hasCatchAll : asks.length > 0;
    /* The middle lane is asked on a source with a catch-all, by the middle loop's own pass. */
    if (catchAll && deps.middle !== undefined && deps.policy.feed.middle.on) asks.push({ query: middleQuery(floors, now, deps.policy), lane: null, middle: true });
    if (catchAll && term !== null && !middleOnly) {
      const query = queryFor(adapter, term, now);
      if (query !== null) asks.push({ query, lane: null });
    }

    /* ★ NO CATCH-ALL: ASK BY WORD, SPACED. The configured term if one is set, else the owner's
       watch list; `feed.hashtagResults` posts an ask, no time cutoff; and on a paid source, only
       once per `watchEveryMs` so a day of it stays inside its share of the line. The ask's size
       is its price on a per-post source, so the spacing below is priced at that size: half the
       posts an ask, twice the asks a day for the same money. */
    if (!catchAll && !middleOnly) {
      /* Priced with as many words as an ask of the watch list will carry. */
      const perAsk = term === null ? Math.min(deps.policy.feed.watchWordsPerAsk, Math.max(1, deps.policy.feed.hashtags.length)) : 1;
      const probeQuery = queryFor(adapter, term ?? deps.policy.feed.hashtags[0] ?? '', now);
      const probe = probeQuery === null || term !== null ? probeQuery : { ...probeQuery, terms: deps.policy.feed.hashtags.slice(0, perAsk) };
      if (probe !== null) {
        let priced: CostEstimate | null = null;
        try {
          priced = adapter.estimate({ kind: 'discover', query: probe });
        } catch {
          /* Left to the pricing step below, which records it as `unasked` with the reason. */
        }
        const usdPerAsk = priced?.usd ?? 0;
        const lineCapUsd = priced !== null && usdPerAsk > 0 ? deps.meter.line(priced.vendor).capUsd : 0;
        const everyMs = watchEveryMs(usdPerAsk, lineCapUsd, deps.plan.cadenceMs, deps.policy);
        const last = deps.watch?.lastAskedAt(source) ?? null;
        const due = watchAskDue(last, now, everyMs, deps.plan.cadenceMs);
        if (due !== null) {
          outcomes.push({ kind: 'resting', source, everyMs, nextAtMs: due });
          continue;
        }
        const listed = term === null ? watchTermsFor(deps.policy.feed.hashtags, perAsk, everyMs, now) : [term];
        /* The extra words (`feed.watchExtra`) ride every few asks of the watch list: never a configured
           term's, and never alone, so an empty watch list still leaves the source unasked, by name. */
        const words = term === null && listed.length > 0 ? [...listed, ...watchExtraFor(deps.policy, listed, everyMs, now)] : listed;
        const word = words[0] ?? null;
        const query = word === null ? null : queryFor(adapter, word, now);
        /* The watch list is asked for `feed.hashtagResults` posts and `feed.watchWordsPerAsk` words; a configured term keeps its own size. */
        if (query !== null) asks.push({ query: term === null ? { ...query, terms: words, limit: deps.policy.feed.hashtagResults } : query, lane: null, spaced: true, watch: term === null });
      }
    }

    /* The middle pass has nothing to ask of a source with no catch-all; the discover pass reports it. */
    if (asks.length === 0 && middleOnly) continue;
    if (asks.length === 0) {
      /* ★ NOT `failed`. This source has no catch-all search and either no term is set
         or it declares no mode we can render one into — a gap in what WE can ask, not
         anything wrong with it. Counting it as a failure would eventually paint the
         source red for a feature we have not written. */
      outcomes.push({
        kind: 'unasked',
        source,
        reason:
          term === null && deps.policy.feed.hashtags.length === 0
            ? 'has no catch-all search, no discovery term is configured and the watch list is empty'
            : `declares no discovery mode we can render (${adapter.capabilities.discovery.join(', ') || 'none'})`,
      });
      deps.log.warn('source is live but cannot be asked', { source });
      continue;
    }

    for (const { query, lane, spaced, watch, slice, band, late, middle, languages: banded } of asks) {
      const languages = banded ?? languageAsks(query);
      let estimate: CostEstimate;
      try {
        /* A page of one language's search: what each call the pass makes is checked against. */
        estimate = adapter.estimate({ kind: 'discover', query: languages[0]?.query ?? query });
      } catch (e) {
        /* An adapter that cannot price its own call is a configuration fault of ours —
           a missing row in a price book — and it is `unasked` rather than `failed`:
           nothing was asked and no vendor is implicated. It is NOT a reason to call the
           source anyway. An unpriced call is not a free call. */
        outcomes.push({ kind: 'unasked', source, reason: `cannot be priced: ${errorText(e)}` });
        deps.log.error('source cannot be priced; not asking it', { source, err: errorText(e) });
        continue;
      }
      plans.push({ adapter, source, query, estimate, lane, spaced: spaced === true, watch: watch === true, slice: slice === true, band: band ?? null, late: late === true, middle: middle === true, languages });
    }
  }

  /* What a day of catch-all search costs on each source that has it — on every pass, dry
     or live, so a dry run answers the question before anything is spent. */
  const passesPerDay = MS_PER_DAY / Math.max(deps.plan.cadenceMs, 1);
  const slowPassesPerDay = MS_PER_DAY / deps.policy.feed.slow.everyMs;
  const pages = deps.policy.feed.maxPagesPerLane;
  const feedDays: FeedDay[] = [];
  for (const source of new Set(plans.filter((p) => p.lane !== null).map((p) => p.source))) {
    const lanes = plans.filter((p) => p.source === source && p.lane !== null);
    const sample = lanes[0];
    if (sample === undefined) continue;
    const usdPerPost = sample.estimate.estUnits > 0 ? sample.estimate.usd / sample.estimate.estUnits : 0;
    const targets = laneTargets(deps.dailyCapUsd, usdPerPost, passesPerDay, deps.policy);
    /* A page costs the same on every lane; the slow lane is priced at its own cadence
       whether or not it is due this pass, so every pass reports the same day. */
    const usdPerPage = sample.estimate.usd;
    const day: FeedDay = {
      source,
      floors: { ...floors },
      sentFloors: sentFloors(floors, deps.policy),
      targets,
      targetUsd: ((targets.all + targets.media) * passesPerDay + targets.slow * slowPassesPerDay) * usdPerPost,
      /* The middle lane is in neither figure: it stops at its own cap (`feed.middle.cap`), which is its worst day. */
      /* Every language is its own search (work/languages.ts), so each ask's pages are counted once a language. */
      worstUsd: usdPerPage * (Math.max(1, deps.policy.feed.langs.length) * pages * (deps.policy.feed.fresh.enabled ? deps.policy.feed.fresh.bandAgesMin.length : MAIN_LANES.length) * passesPerDay + Math.max(1, slowLangs(deps.policy).length) * (pages * lateBands(deps.policy).length * passesPerDay + deps.policy.feed.slow.slices * slowPassesPerDay)),
    };
    feedDays.push(day);
    deps.log.info(deps.mode === 'dry' ? 'DRY RUN — a day of catch-all search, priced' : 'catch-all search, priced', {
      source,
      floors: day.floors,
      sentFloors: day.sentFloors,
      postsPerPassTarget: { all: round(targets.all), media: round(targets.media), slow: round(targets.slow) },
      dayAtTargetUsd: round(day.targetUsd),
      dayWorstCaseUsd: round(day.worstUsd),
      dailyCapUsd: deps.dailyCapUsd,
    });
  }

  /**
   * ★ FREE BEFORE PAID — A POLICY, NOT AN OPTIMISATION, AND NOT A TIDY-UP.
   *
   * Ordering decides who gets refused when the cap binds, and the two orders produce
   * different products from the same money. Cheapest-first, a day that runs out has
   * already taken everything the free sources had and loses only the paid tail.
   * Registry order — which is DECLARATION order, i.e. whatever order somebody happened
   * to add sources to a file — lets the paid source drain the line before the free one
   * is reached, and the day loses the half that was never going to cost anything.
   *
   * ★ SORTED BY THE ESTIMATE AND NOT BY A LIST OF SOURCE NAMES, so it stays true when a
   * vendor changes its terms and when a source is added. `capabilities.billing` gives
   * the KIND of billing and not the rate, so it cannot answer this; the estimate can.
   *
   * ★ AND THE SORT IS STABLE, so sources of equal cost keep their declaration order.
   * The free ones are all equal at zero, and an order that shuffled between passes
   * would make "which free source did we ask first" unanswerable from the log.
   */
  if (deps.policy.budget.freeSourcesFirst) {
    plans.sort((a, b) => a.estimate.usd - b.estimate.usd);
  }

  /* ── execute ───────────────────────────────────────────────────────────── */

  /**
   * Terms a free source has already answered in THIS pass, with the source that did.
   * Keyed by term rather than held as a flag because the term rotates and because the
   * day this pass asks for more than one, the rule has to be per-term or it is wrong.
   */
  const covered = new Map<string, string>();
  /* What each catch-all lane returned this pass, per source — the input to its next floor. */
  const laneReturned = new Map<string, Partial<Record<FeedLane, number>>>();
  /* ★ WHAT EACH LANGUAGE'S FRESH BANDS RETURNED, and over how many minutes of posting time (`feed.langSplit`). */
  const langReturned = new Map<string, Map<string, { returned: number; windowMin: number; cut: boolean }>>();

  /* ★ THE X SEARCH DAY (`feed.searchDay`): the metered bill read once a pass per vendor, and what this
     pass's own pages added since. Null when it could not be read. */
  const dayRead = new Map<string, number | null>();
  const dayAdded = new Map<string, number>();
  const dayBill = async (vendor: string): Promise<number | null> => {
    if (!dayRead.has(vendor)) {
      let spent: number | null = null;
      try {
        spent = (await deps.searchDay?.spent(vendor, now)) ?? null;
      } catch (e) {
        deps.log.warn("could not read the day's search bill; no catch-all search is asked", { vendor, err: errorText(e) });
      }
      dayRead.set(vendor, spent !== null && Number.isFinite(spent) ? spent : null);
    }
    const base = dayRead.get(vendor) ?? null;
    return base === null ? null : base + (dayAdded.get(vendor) ?? 0);
  };
  const dayAdd = (vendor: string, usd: number): void => void dayAdded.set(vendor, (dayAdded.get(vendor) ?? 0) + usd);

  /* ★ ONE ASK, RUN. A function so the spaced asks — a source with no catch-all, whose paid scraper
     runs take minutes — run beside the catch-all lanes rather than ahead of them: a four-minute
     short-video run used to hold the text search, the feed's main input, for as long. */
  const runPlan = async (plan: SourcePlan): Promise<void> => {
    if (deps.signal.aborted) return;
    const { adapter, source, query, estimate, lane, spaced, watch, slice, band, late, middle } = plan;
    const tag: { lane?: PassLane } = middle ? { lane: 'middle' } : lane === null ? {} : { lane };
    const coverKey = middle ? 'feed:middle' : lane === null ? query.term : `feed:${lane}`;
    const cap = deps.policy.feed.middle.cap;
    /* Every catch-all search and the middle lane are held to the X search day; a term or watch ask is not. */
    const dayGated = deps.policy.feed.searchDay.on && deps.searchDay !== undefined && (middle || lane !== null);

    /**
     * ★ DO NOT PAY FOR WHAT A FREE SOURCE ALREADY ANSWERED.
     *
     * The stronger half of free-before-paid, and the half with a real cost: two
     * sources do not hold the same posts, so this loses whatever only the paid one
     * had. It is a policy field with that cost written on it, and it is OFF by
     * flipping one boolean.
     *
     * ★ IT IS RECORDED AS `deferred` AND NEVER AS `answered` WITH ZERO ITEMS. "We
     * decided not to pay for this" and "we paid and there was nothing there" are
     * opposite facts, and the second is the one that would make somebody turn a
     * working source off.
     */
    const coveredBy = covered.get(coverKey);
    if (deps.policy.budget.paidOnlyWhenFreeIsEmpty && estimate.usd > 0 && coveredBy !== undefined) {
      outcomes.push({ kind: 'deferred', source, coveredBy, wouldSpendUsd: estimate.usd });
      deps.log.info('paid source deferred; a free source already answered this term', {
        source,
        term: query.term,
        coveredBy,
        wouldSpendUsd: estimate.usd,
      });
      return;
    }

    /* ★ THE MIDDLE LANE'S OWN CAP, before the day's: what it spent today (0088) plus this page must
       fit `feed.middle.cap`. An unreadable ledger asks nothing (work/lane-ledger.ts). */
    let laneSpent = 0;
    if (middle) {
      const spent = (await deps.middle?.ledger.spent('middle', now)) ?? null;
      if (spent === null) {
        outcomes.push({ kind: 'unasked', source, reason: "the middle lane's ledger (0088) cannot be read, so it does not ask" });
        return;
      }
      if (!laneMayAsk(spent, estimate.usd, cap)) {
        outcomes.push({ kind: 'paused', ...tag, source, wouldSpendUsd: estimate.usd, remainingUsd: Math.max(0, cap.dailyUsd - spent), spentUsd: spent, capUsd: cap.dailyUsd });
        deps.log.info('the middle lane has spent its day; not asked', { source, spentUsd: spent, capUsd: cap.dailyUsd });
        return;
      }
      laneSpent = spent;
    }

    /* ★ HOW THIS ASK PAGES. The middle lane by its own switch; a catch-all search listed `full` in
       `feed.paging` only with its day readable and not yet spent; everything else by the old rule —
       a term or watch-list ask and a slow slice one page, a catch-all lane `maxPagesPerLane` while
       each page comes back full. */
    const key = pagingKey(plan);
    const listed = key === null ? undefined : deps.policy.feed.paging.searches[key];
    const oldPages = middle ? deps.policy.feed.middle.maxPages : lane !== null && !slice ? deps.policy.feed.maxPagesPerLane : 1;
    let rule: PageRule = middle
      ? { full: deps.policy.feed.middle.fullPaging, maxPages: oldPages, deadlineMs: deps.policy.feed.middle.passDeadlineMs, ledger: null }
      : { full: false, maxPages: oldPages, deadlineMs: null, ledger: null };
    if (key !== null && listed?.full === true) {
      const ledgerLane: CappedLane = `search:${key}`;
      const spent = deps.ledger === undefined ? null : await deps.ledger.spent(ledgerLane, now);
      /* A paced search (policy.v158) may have spent only its day's share so far; held back, it waits a pass rather than the day. */
      const capNow = listed.paced === true ? pacedDailyUsd(listed.dailyUsd, deps.now(), deps.policy) : listed.dailyUsd;
      if (spent === null) {
        deps.log.warn('a search set to read past short pages has no readable day; it keeps the old rule', { source, search: key });
      } else if (spent + estimate.usd > capNow) {
        outcomes.push({ kind: 'paused', ...tag, source, wouldSpendUsd: estimate.usd, remainingUsd: Math.max(0, capNow - spent), spentUsd: spent, capUsd: capNow });
        deps.log.info(listed.paced === true ? 'a paced search is ahead of its day; not asked this pass' : 'a search has spent its day; not asked', { source, search: key, spentUsd: spent, capUsd: capNow, dailyUsd: listed.dailyUsd });
        return;
      } else {
        rule = { full: true, maxPages: listed.maxPages, deadlineMs: listed.passDeadlineMs, ledger: { lane: ledgerLane, dailyUsd: capNow, spentUsd: spent } };
      }
    }

    /* ★ THE X SEARCH DAY, before the meter's line: the day's metered search bill plus this page must fit
       the pace (`feed.searchDay`). An unreadable bill asks nothing. */
    if (dayGated) {
      const spent = await dayBill(estimate.vendor);
      if (spent === null) {
        outcomes.push({ kind: 'unasked', source, reason: "the day's search bill cannot be read, so no catch-all search is asked" });
        return;
      }
      const at = deps.now();
      if (!searchDayMayAsk(spent, estimate.usd, at, deps.policy)) {
        const allowance = searchDayAllowanceUsd(at, deps.policy);
        outcomes.push({ kind: 'paused', ...tag, source, wouldSpendUsd: estimate.usd, remainingUsd: Math.max(0, allowance - spent), spentUsd: spent, capUsd: allowance });
        deps.log.info("the X search day's pace is spent; not asked", { source, lane: middle ? 'middle' : lane, band, late, spentUsd: round(spent), allowedNowUsd: round(allowance), dailyUsd: deps.policy.feed.searchDay.dailyUsd });
        return;
      }
    }

    /**
     * ★ THE CEILING, CHECKED BEFORE THE CALL AND NOT AFTER IT.
     *
     * This is the line the whole money path exists for. A meter that measured spend
     * without refusing it is a receipt, not a cap, and a cap consulted after the
     * request has gone out is a receipt with extra steps. `mayspend` compares the
     * PROJECTED total against the soft stop, so the cap is never crossed by a call we
     * had already approved.
     */
    if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      const line = deps.meter.line(estimate.vendor);
      outcomes.push({
        kind: 'paused',
        ...tag,
        source,
        wouldSpendUsd: estimate.usd,
        remainingUsd: line.remainingUsd,
        spentUsd: line.spentUsd,
        capUsd: line.capUsd,
      });
      /* A warning and not an error: this is the system doing exactly what it was told
         to do. It is also not silent, because a pass that quietly stops asking is
         indistinguishable from a quiet internet — which is the failure this whole
         service is shaped around. */
      deps.log.warn('source paused for budget; the call was not made', {
        source,
        wouldSpendUsd: estimate.usd,
        remainingUsd: line.remainingUsd,
        spentUsd: line.spentUsd,
        capUsd: line.capUsd,
        unrecordedUsd: line.unrecordedUsd,
      });
      return;
    }

    /**
     * ★ THE DRY RUN STOPS HERE, WITH EVERYTHING WORKED OUT AND NOTHING ASKED.
     *
     * Note where the return sits: after the query is rendered, after the estimate is
     * priced, and after the budget has been consulted — so a dry run reports the same
     * `paused` rows a live run would, and a person can find out that their cap is too
     * low before they have spent anything finding out. Only the request is missing.
     */
    if (deps.mode === 'dry') {
      /* One first page a language: each is its own search (work/languages.ts). */
      const asked = Math.max(1, plan.languages.length);
      estimatedUsd += estimate.usd * asked;
      outcomes.push({
        kind: 'planned',
        ...tag,
        source,
        mode: query.mode,
        estUnits: estimate.estUnits * asked,
        wouldSpendUsd: estimate.usd * asked,
      });
      return;
    }

    /**
     * ★ ONE SEARCH PER LANGUAGE, EACH ON ITS OWN CURSOR (work/languages.ts): the supplier answers an
     * OR of languages with the last one only (since 2026-10-16). Each language keeps its own page
     * count, empty run and end; the ask's caps — the meter's line, the middle lane's cap, the
     * search's own day, its deadline — are totals across them, checked before every page of every
     * language. Paged round-robin: every language's first page before any language's second.
     */
    /* The language that has waited longest asks first (work/languages.ts `waitedLongestFirst`): a cap that
       closes inside the first round must not land on the same languages every pass. */
    const threads: Thread[] = waitedLongestFirst(plan.languages.length > 0 ? plan.languages : [{ lang: null, query }]).map((l) => ({
      lang: l.lang, query: l.query, clockKey: 'clockKey' in l ? l.clockKey : undefined,
      cursor: null, hasMore: false, items: [], authors: [], pages: 0, emptyRun: 0, open: true, stop: 'end', error: null,
    }));
    /* What this ask's pages were billed, for its ledger (the middle lane's, or the search's own). */
    let laneUsd = 0;
    /* A limit shared by every language (the meter, a cap, the deadline, a shutdown): it ends the ask. */
    let shared: Stop | null = null;
    /* The meter refused at the vendor edge (`BudgetRefused`): nothing went out on that call. */
    let refused: string | null = null;
    let calls = 0;
    /* The middle lane's deadline runs from its pass's start; a search's own from its first page. */
    const pagingFrom = middle ? now : deps.now();
    /* Set as the call goes out, not when it comes back: a run that fails was still billed. */
    if (spaced) deps.watch?.asked(source, now);

    /* ★ EACH PAGE AFTER THE ASK'S FIRST IS CHECKED BEFORE IT IS ASKED FOR: against the meter's paced
       line, the lane's own day (the middle lane's cap, or the search's `dailyUsd`), a shutdown and
       the deadline. The first was checked above, where a refusal is recorded as `paused`. */
    const sharedStop = async (): Promise<Stop | null> => {
      if (!deps.meter.mayspend(estimate.vendor, estimate.usd)) return 'meter';
      if (dayGated && !searchDayMayAsk((await dayBill(estimate.vendor)) ?? Number.NaN, estimate.usd, deps.now(), deps.policy)) return 'day';
      if (middle && !laneMayAsk(laneSpent + laneUsd, estimate.usd, cap)) return 'cap';
      if (rule.ledger !== null && rule.ledger.spentUsd + laneUsd + estimate.usd > rule.ledger.dailyUsd) return 'cap';
      if (deps.signal.aborted) return 'aborted';
      /* ★ THE DEADLINE (`feed.middle.passDeadlineMs`, a search's `passDeadlineMs`): a slow or
         refusing supplier costs the ask its deeper pages this pass, never minutes. The next pass
         asks again. */
      if (rule.deadlineMs !== null && deps.now() - pagingFrom >= rule.deadlineMs) {
        deps.log.warn(middle ? 'the middle lane reached its deadline; the rest of its window waits for the next pass' : 'a search reached its deadline; the rest of its window waits for the next pass', { source, search: key ?? 'middle', pages: calls, deadlineMs: rule.deadlineMs });
        return 'deadline';
      }
      return null;
    };

    /* ★ PAGE BY PAGE, ROUND-ROBIN: round r asks page r of every language still open, the order turned
       by one each round. Under the old rule a short page ends that language — the earlier build's
       paging, from when a short page meant the window was exhausted. Under `full` it does not
       (`feed.paging`): the supplier answers short pages with more to come, so only its own "no more"
       ends a language's window, or `maxEmptyRun` empty pages in a row, each billed. */
    rounds: for (let round = 1; round <= rule.maxPages; round += 1) {
      for (const t of roundOrder(threads, round - 1)) {
        if (!t.open) continue;
        if (round > 1) {
          if (t.cursor === null || !t.hasMore) { t.open = false; t.stop = 'end'; continue; }
          if (!rule.full && t.items.length < (round - 1) * t.query.limit) { t.open = false; t.stop = 'short'; continue; }
          if (rule.full && t.emptyRun >= deps.policy.feed.paging.maxEmptyRun) { t.open = false; t.stop = 'empty'; continue; }
        }
        if (calls > 0) {
          shared = await sharedStop();
          if (shared !== null) break rounds;
        }
        calls += 1;
        try {
          const page = await adapter.discover(t.cursor === null ? t.query : { ...t.query, cursor: t.cursor }, budget);
          laneUsd += page.spend.usd;
          if (dayGated) dayAdd(estimate.vendor, page.spend.usd);
          estimatedUsd += estimate.usd;
          t.pages = round;
          t.items.push(...page.value.items);
          t.authors.push(...(page.value.authors ?? []));
          t.hasMore = page.value.hasMore;
          t.cursor = page.value.cursor;
          t.emptyRun = page.value.items.length === 0 ? t.emptyRun + 1 : 0;
        } catch (e) {
          /**
           * ★ OUR OWN REFUSAL IS NOT A VENDOR FAILURE, AND IS CAUGHT SEPARATELY.
           *
           * `metered()` is the backstop behind the pre-check above, and it throws rather
           * than returning — so it arrives here as an exception, on the same path as a
           * timeout. It is a different fact. Recording it as `failed` would inflate the
           * consecutive-failure count on a source that is working perfectly, and after
           * three passes the board would call it broken because we could not afford it.
           * It ends the whole ask: the line is every language's.
           */
          if (e instanceof BudgetRefused) {
            refused = e.reason;
            shared = 'meter';
            break rounds;
          }
          /* ★ A FAILED CALL STILL COST MONEY. The vendor bills on receipt, not on our ability
             to parse the answer, so the pass's total and the lane's day say so. One language
             failing ends that language only: the others are asked as if it had answered. */
          laneUsd += estimate.usd;
          if (dayGated) dayAdd(estimate.vendor, estimate.usd);
          estimatedUsd += estimate.usd;
          t.open = false;
          t.stop = 'failed';
          t.error = errorText(e);
          continue;
        }
        if (round === rule.maxPages && t.hasMore && t.cursor !== null) { t.open = false; t.stop = 'pages'; }
      }
    }
    for (const t of threads) {
      if (!t.open) continue;
      t.stop = shared ?? (t.hasMore && t.cursor !== null ? 'pages' : 'end');
    }
    const answeredThreads = threads.filter((t) => t.error === null && t.pages > 0);
    const failedThreads = threads.filter((t) => t.error !== null);
    const pages = threads.reduce((n, t) => n + t.pages, 0);
    const byLang = Object.fromEntries(threads.map((t) => [t.lang ?? 'any', { pages: t.pages, returned: t.items.length, stop: t.stop }]));

    if (answeredThreads.length === 0) {
      /* Nothing answered. A page that threw was still billed, and the lane's day says so too. */
      if (middle) await deps.middle?.ledger.add('middle', now, laneUsd);
      if (rule.ledger !== null) await deps.ledger?.add(rule.ledger.lane, now, laneUsd);
      const failure = failedThreads[0];
      if (failure === undefined) {
        const line = deps.meter.line(estimate.vendor);
        outcomes.push({ kind: 'paused', ...tag, source, wouldSpendUsd: estimate.usd, remainingUsd: line.remainingUsd, spentUsd: line.spentUsd, capUsd: line.capUsd });
        deps.log.warn('source paused for budget at the vendor edge', { source, reason: refused ?? shared });
        return;
      }
      /* The health record was already written by the wrapper around the adapter. What
         happens here is only accounting: one source failing must not end the pass, or
         a single dark vendor would take the working ones down with it. */
      const text = failure.error ?? '';
      firstError ??= `${source}: ${text}`;
      outcomes.push({ kind: 'failed', source, reason: text, ...tag });
      deps.log.error('source failed', { source, mode: query.mode, err: text, languages: byLang });
      return;
    }
    /* Some languages answered and some failed: each failed one is said, by its language. */
    for (const t of failedThreads) {
      const text = `${t.lang === null ? '' : `lang ${t.lang}: `}${t.error ?? ''}`;
      firstError ??= `${source}: ${text}`;
      outcomes.push({ kind: 'failed', source, reason: text, ...tag });
      deps.log.error('a language of a search failed; the others answered', { source, mode: query.mode, lang: t.lang, err: t.error });
    }

    /* A post is in one language, so the languages' pages never hold the same post twice. */
    const items: Item[] = threads.flatMap((t) => t.items);
    const authors: Author[] = threads.flatMap((t) => t.authors);
    const hasMore = answeredThreads.some((t) => t.hasMore && t.cursor !== null);
    const stop: Stop = shared ?? (threads.length === 1 ? threads[0]!.stop : 'end');
    itemsSeen += items.length;

    /* A free source that answered covers this term for the paid ones behind it. Only
       a non-empty answer counts: a free source that was asked and found nothing has
       told us the term is quiet on IT, which is no reason to skip a source that reads
       a different half of the internet. */
    if (estimate.usd === 0 && items.length > 0 && !covered.has(coverKey)) {
      covered.set(coverKey, source);
    }
    /* With the split, a fresh band's languages move their own floors, each on what it returned. */
    if (splitOn && band !== null && !late) {
      const byLang = langReturned.get(source) ?? new Map<string, { returned: number; windowMin: number; cut: boolean }>();
      for (const t of answeredThreads) {
        if (t.lang === null) continue;
        const had = byLang.get(t.lang) ?? { returned: 0, windowMin: 0, cut: false };
        const windowMin = t.query.untilMs === null || t.query.sinceMs === null ? 0 : (t.query.untilMs - t.query.sinceMs) / MS_PER_MINUTE;
        /* ★ CUT SHORT BY MONEY (core `nextFloor`'s `cut`): read, more to come, and a day closed on it. */
        const cut = MONEY_STOPS.has(t.stop) && t.hasMore && t.cursor !== null;
        byLang.set(t.lang, { returned: had.returned + t.items.length, windowMin: had.windowMin + windowMin, cut: had.cut || cut });
      }
      langReturned.set(source, byLang);
    }
    /* A slow lane's slices add up, and so do the fresh bands: the lane's floor moves on what all of them returned. */
    else if (lane !== null && !late) laneReturned.set(source, { ...laneReturned.get(source), [lane]: (slice || band !== null ? (laneReturned.get(source)?.[lane] ?? 0) : 0) + items.length });
    /* Each language's band window that answered: its next ask starts where this one ended. A language
       that failed, or was never reached, keeps its window open. */
    if (band !== null) {
      for (const t of answeredThreads) {
        if (t.query.untilMs === null) continue;
        deps.fresh?.ran(t.clockKey ?? (late ? lateBandKey(source, band) : bandKey(source, band)), t.query.untilMs);
      }
    }
    /* A slow slice's window (`slowSlices`), shared by its languages: its next ask starts where this one
       ended once any language answered. A slice no language answered keeps its window open. */
    if (slice) {
      for (const t of answeredThreads) if (t.clockKey !== undefined && t.query.untilMs !== null) deps.fresh?.ran(t.clockKey, t.query.untilMs);
    }

    /* ★ THE MIDDLE LANE'S DAY: its pages' bill, and the judging of the posts it found first, counted
       before the store writes their lane (`LaneCapPolicy`). A count that fails is charged as if
       every post were new: the cap may close early, never late. */
    if (middle && deps.middle !== undefined) {
      let fresh = items.length;
      try {
        fresh = await deps.middle.uncredited(items.map((i) => String(i.itemId)));
      } catch (e) {
        deps.log.warn("could not count the middle lane's new posts; charging it for all of them", { err: errorText(e) });
      }
      await deps.middle.ledger.add('middle', now, laneUsd + laneJudgeUsd(fresh, cap));
      deps.log.info('middle lane', { source, returned: items.length, new: fresh, pages, stop, languages: byLang, fullPaging: rule.full, searchUsd: round(laneUsd), judgeUsd: round(laneJudgeUsd(fresh, cap)), spentBeforeUsd: round(laneSpent), capUsd: cap.dailyUsd });
    }
    /* ★ A SEARCH READING PAST SHORT PAGES: its pages' bill, in its own day (`feed.paging`). */
    if (rule.ledger !== null) {
      await deps.ledger?.add(rule.ledger.lane, now, laneUsd);
      deps.log.info('paged search', { source, search: key, returned: items.length, pages, stop, languages: byLang, searchUsd: round(laneUsd), spentBeforeUsd: round(rule.ledger.spentUsd), capUsd: rule.ledger.dailyUsd });
    } else if (!middle && threads.length > 1) {
      deps.log.info('search by language', { source, lane: lane ?? 'term', band, late, returned: items.length, pages, stop, languages: byLang });
    }

    let stored: number | null = null;
    if (items.length > 0) {
      try {
        stored = await deps.store(items, authors, middle ? 'middle' : (lane ?? (watch ? 'watch' : null)));
        itemsStored += stored;
      } catch (e) {
        /* ★ `stored` STAYS NULL RATHER THAN BECOMING ZERO. The write did not complete,
           so how many landed is unknown — and a zero here is a measurement we did not
           make. It is also NOT recorded against the source's health: the source
           answered, and our database is not its fault. */
        const text = errorText(e);
        firstError ??= `${source}: could not store arrivals: ${text}`;
        deps.log.error('could not store arrivals', { source, items: items.length, err: text });
      }
    } else {
      /* Asked, answered, nothing new. A real zero and the only kind this pass records:
         it is a measurement of a quiet window on a source we actually reached. */
      stored = 0;
    }

    outcomes.push({ kind: 'answered', source, items: items.length, stored, hasMore, ...tag });
  };
  const inTurn = async (list: readonly SourcePlan[]): Promise<void> => {
    for (const plan of list) {
      if (deps.signal.aborted) return;
      await runPlan(plan);
    }
  };
  await Promise.all([inTurn(plans.filter((p) => !p.spaced)), inTurn(plans.filter((p) => p.spaced))]);

  /* ── adapt: each lane's floor toward its target, from its own result ───────
     Live passes only, and only lanes that answered: a pause, a failure or a dry run says
     nothing about how many posts clear the floor. The floor is a cost lever and nothing
     else — see core's `nextFloor`. */
  if (deps.mode === 'live') {
    for (const [source, returned] of laneReturned) {
      const day = feedDays.find((d) => d.source === source);
      if (day === undefined) continue;
      for (const lane of FEED_LANES) {
        const got = returned[lane];
        if (got === undefined) continue;
        /* With the split the fresh bands move each language's floor (below), not the shared one. */
        if (splitOn && lane === 'all') continue;
        const other = returned[lane === 'all' ? 'media' : 'all'];
        const next = nextFloor(floors[lane], got, day.targets[lane], other === 0, deps.policy);
        if (next.floor !== floors[lane]) {
          try {
            await deps.floors.set(lane, next.floor, now);
            floors[lane] = next.floor;
          } catch (e) {
            deps.log.error('could not store a lane floor; it starts the next pass where it was', { lane, err: errorText(e) });
          }
        }
        deps.log.info('catch-all lane floor', {
          source,
          lane,
          returned: got,
          target: round(day.targets[lane]),
          move: next.move,
          floor: next.floor,
        });
      }
    }
  }

  /* ★ EACH LANGUAGE'S FLOOR toward its own target (`feed.langSplit`): its share of the bands' money,
     over the posting time its asks covered this pass. Live only, and only languages that answered. */
  if (deps.mode === 'live' && splitOn) {
    for (const [source, byLang] of langReturned) {
      const sample = plans.find((p) => p.source === source && p.band !== null && !p.late);
      const usdPerPost = sample !== undefined && sample.estimate.estUnits > 0 ? sample.estimate.usd / sample.estimate.estUnits : 0;
      for (const [lang, got] of byLang) {
        const before = langFloor(lang);
        const target = langTarget(langPostsPerDay(lang, usdPerPost, deps.policy), got.windowMin, deps.policy);
        const next = nextFloor(before, got.returned, target, false, deps.policy, got.cut);
        if (next.floor !== before || langFloors[lang] === undefined) {
          try {
            await deps.floors.setLang?.(lang, next.floor, now);
            langFloors[lang] = next.floor;
          } catch (e) {
            deps.log.error("could not store a language's floor; it starts the next pass where it was", { lang, err: errorText(e) });
          }
        }
        deps.log.info('catch-all language floor', { source, lang, returned: got.returned, windowMin: round(got.windowMin), target: round(target), move: next.move, floor: next.floor, everyMin: round(langEveryMs(lang, usdPerPost, deps.policy) / MS_PER_MINUTE) });
      }
    }
  }

  return {
    outcomes,
    asked: outcomes.filter((o) => o.kind === 'answered' || o.kind === 'failed').length,
    answered: outcomes.filter((o) => o.kind === 'answered').length,
    failed: outcomes.filter((o) => o.kind === 'failed').length,
    unasked: outcomes.filter((o) => o.kind === 'unasked').length,
    dark: outcomes.filter((o) => o.kind === 'dark').length,
    paused: outcomes.filter((o) => o.kind === 'paused').length,
    planned: outcomes.filter((o) => o.kind === 'planned').length,
    deferred: outcomes.filter((o) => o.kind === 'deferred').length,
    resting: outcomes.filter((o) => o.kind === 'resting').length,
    itemsSeen,
    itemsStored,
    estimatedUsd,
    firstError,
    feedDays,
  };
}

/** The lanes asked on every pass. The slow lane is added when it is due. */
export const MAIN_LANES: readonly FeedLane[] = FEED_LANES.filter((lane) => lane !== 'slow');

const round = (n: number): number => Math.round(n * 10_000) / 10_000;
