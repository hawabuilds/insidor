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
 * count on exactly one of its seven members. There is no way to write down "this dark
 * source returned nothing", because that sentence has no representation here.
 *
 * The seven members are seven genuinely different facts:
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

import type { Item, Millis, Policy } from '@insidor/contracts';
import type { Budget, Meter, CostEstimate } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryMode, DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';

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

/* ── what one source did ──────────────────────────────────────────────────── */

export type SourceOutcome =
  /** Asked, and it replied. `items` is a measurement; zero here is a real quiet. */
  | { readonly kind: 'answered'; readonly source: string; readonly items: number; readonly stored: number | null; readonly hasMore: boolean }
  /** Asked, and the call threw. Recorded against the source's health by the wrapper. */
  | { readonly kind: 'failed'; readonly source: string; readonly reason: string }
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
  | { readonly kind: 'paused'; readonly source: string; readonly wouldSpendUsd: number; readonly remainingUsd: number; readonly spentUsd: number; readonly capUsd: number }
  /** ★ A DRY RUN. Resolved, priced, and not asked. No call left the process. */
  | { readonly kind: 'planned'; readonly source: string; readonly mode: DiscoveryMode; readonly estUnits: number; readonly wouldSpendUsd: number }
  /** ★ A FREE SOURCE COVERED THIS TERM. We chose not to pay for it, and say who. */
  | { readonly kind: 'deferred'; readonly source: string; readonly coveredBy: string; readonly wouldSpendUsd: number };

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
  /** Store the arrivals. Narrow on purpose: this pass may not read or decide. */
  readonly store: (items: readonly Item[]) => Promise<number>;
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
  /** Aborted on SIGTERM. A pass that ignores it delays every deploy by a vendor call. */
  readonly signal: AbortSignal;
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

  /* ── prepare: resolve and price every source before asking any of them ──── */

  const plans: SourcePlan[] = [];
  for (const adapter of live) {
    const source = String(adapter.id);

    /* Defensive rather than reachable: the config refuses an empty term list. Stated
       as an outcome anyway, because "we asked nobody and returned clean" must never be
       a path this function can take without saying so. */
    if (term === null) {
      outcomes.push({ kind: 'unasked', source, reason: 'no discovery term is configured' });
      continue;
    }

    const query = queryFor(adapter, term, now);
    if (query === null) {
      /* ★ NOT `failed`. This source declares no discovery mode we know how to render,
         which is a gap in what WE can ask rather than anything wrong with it. Counting
         it as a failure would inflate the consecutive-failure count and eventually
         paint the source red for a feature we have not written. */
      outcomes.push({
        kind: 'unasked',
        source,
        reason: `declares no discovery mode we can render (${adapter.capabilities.discovery.join(', ') || 'none'})`,
      });
      deps.log.warn('source is live but cannot be asked', { source });
      continue;
    }

    let estimate: CostEstimate;
    try {
      estimate = adapter.estimate({ kind: 'discover', query });
    } catch (e) {
      /* An adapter that cannot price its own call is a configuration fault of ours —
         a missing row in a price book — and it is `unasked` rather than `failed` for
         the reason above: nothing was asked and no vendor is implicated. It is NOT a
         reason to call the source anyway. An unpriced call is not a free call, and
         asking one would put a charge in the ledger with no line to book it against. */
      outcomes.push({ kind: 'unasked', source, reason: `cannot be priced: ${errorText(e)}` });
      deps.log.error('source cannot be priced; not asking it', { source, err: errorText(e) });
      continue;
    }

    plans.push({ adapter, source, query, estimate });
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

  for (const plan of plans) {
    if (deps.signal.aborted) break;
    const { adapter, source, query, estimate } = plan;

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
    const coveredBy = covered.get(query.term);
    if (deps.policy.budget.paidOnlyWhenFreeIsEmpty && estimate.usd > 0 && coveredBy !== undefined) {
      outcomes.push({ kind: 'deferred', source, coveredBy, wouldSpendUsd: estimate.usd });
      deps.log.info('paid source deferred; a free source already answered this term', {
        source,
        term: query.term,
        coveredBy,
        wouldSpendUsd: estimate.usd,
      });
      continue;
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
      continue;
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
      estimatedUsd += estimate.usd;
      outcomes.push({
        kind: 'planned',
        source,
        mode: query.mode,
        estUnits: estimate.estUnits,
        wouldSpendUsd: estimate.usd,
      });
      continue;
    }

    let items: readonly Item[];
    let hasMore: boolean;
    try {
      const result = await adapter.discover(query, budget);
      items = result.value.items;
      hasMore = result.value.hasMore;
    } catch (e) {
      /**
       * ★ OUR OWN REFUSAL IS NOT A VENDOR FAILURE, AND IS CAUGHT SEPARATELY.
       *
       * `metered()` is the backstop behind the pre-check above, and it throws rather
       * than returning — so it arrives here as an exception, on the same path as a
       * timeout. It is a different fact. Recording it as `failed` would inflate the
       * consecutive-failure count on a source that is working perfectly, and after
       * three passes the board would call it broken because we could not afford it.
       */
      if (e instanceof BudgetRefused) {
        const line = deps.meter.line(estimate.vendor);
        outcomes.push({
          kind: 'paused',
          source,
          wouldSpendUsd: estimate.usd,
          remainingUsd: line.remainingUsd,
          spentUsd: line.spentUsd,
          capUsd: line.capUsd,
        });
        deps.log.warn('source paused for budget at the vendor edge', { source, reason: e.reason });
        continue;
      }
      /* ★ A FAILED CALL STILL COST MONEY. The vendor bills on receipt, not on our
         ability to parse the answer, so this pass spent those dollars and the running
         total has to say so. Counting only the successful calls would make an incident
         — the hours when everything fails — look like the cheapest day of the month,
         which is the same understatement `metered()` records the spend on the throw
         path to prevent. */
      estimatedUsd += estimate.usd;

      /* The health record was already written by the wrapper around the adapter. What
         happens here is only accounting: one source failing must not end the pass, or
         a single dark vendor would take the working ones down with it. */
      const text = errorText(e);
      firstError ??= `${source}: ${text}`;
      outcomes.push({ kind: 'failed', source, reason: text });
      deps.log.error('source failed', { source, mode: query.mode, err: text });
      continue;
    }

    /* Quoted, not measured. The measured figure is in the ledger, recorded by the
       adapter; this is the pass's own running total and is what makes the dry and live
       numbers comparable. */
    estimatedUsd += estimate.usd;
    itemsSeen += items.length;

    /* A free source that answered covers this term for the paid ones behind it. Only
       a non-empty answer counts: a free source that was asked and found nothing has
       told us the term is quiet on IT, which is no reason to skip a source that reads
       a different half of the internet. */
    if (estimate.usd === 0 && items.length > 0 && !covered.has(query.term)) {
      covered.set(query.term, source);
    }

    let stored: number | null = null;
    if (items.length > 0) {
      try {
        stored = await deps.store(items);
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

    outcomes.push({ kind: 'answered', source, items: items.length, stored, hasMore });
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
    itemsSeen,
    itemsStored,
    estimatedUsd,
    firstError,
  };
}
