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
 * count on exactly one of its four members. There is no way to write down "this dark
 * source returned nothing", because that sentence has no representation here.
 *
 * The four members are four genuinely different facts:
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
import type { Budget } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryMode, DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';

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
 */
const LOOKBACK_MS = 30 * MS_PER_MINUTE;

/** One page per source per pass. More is a paging loop, and paging is a budget decision. */
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
  | { readonly kind: 'dark'; readonly source: string; readonly configuration: 'dormant' | 'misconfigured' };

export interface DiscoverPassResult {
  /** One per KNOWN source, live or not. Never a subset — see `dark` above. */
  readonly outcomes: readonly SourceOutcome[];
  /** Sources we actually called. The denominator of "how many answered". */
  readonly asked: number;
  readonly answered: number;
  readonly failed: number;
  readonly unasked: number;
  readonly dark: number;
  /**
   * Items returned by sources that ANSWERED. Never includes a dark source's absence
   * as a zero, because a dark source has no item count in this type at all.
   */
  readonly itemsSeen: number;
  /** Items written. Null contributions — a failed write — are excluded, not zeroed. */
  readonly itemsStored: number;
  /** The first thing that went wrong, so the run row says which. */
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

export interface DiscoverDeps {
  readonly platforms: PlatformRegistry;
  /** Store the arrivals. Narrow on purpose: this pass may not read or decide. */
  readonly store: (items: readonly Item[]) => Promise<number>;
  readonly plan: DiscoveryPlan;
  readonly policy: Policy;
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

export async function discoverPass(deps: DiscoverDeps): Promise<DiscoverPassResult> {
  const outcomes: SourceOutcome[] = [];
  let itemsSeen = 0;
  let itemsStored = 0;
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

  const budget = budgetFor(deps.policy, deps.now(), live.length);

  for (const adapter of live) {
    if (deps.signal.aborted) break;
    const source = String(adapter.id);

    const term = deps.plan.terms[0];
    /* Defensive rather than reachable: the config refuses an empty term list. Stated
       as an outcome anyway, because "we asked nobody and returned clean" must never be
       a path this function can take without saying so. */
    if (term === undefined) {
      outcomes.push({ kind: 'unasked', source, reason: 'no discovery term is configured' });
      continue;
    }

    const query = queryFor(adapter, term, deps.now());
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

    let items: readonly Item[];
    let hasMore: boolean;
    try {
      const result = await adapter.discover(query, budget);
      items = result.value.items;
      hasMore = result.value.hasMore;
    } catch (e) {
      /* The health record was already written by the wrapper around the adapter. What
         happens here is only accounting: one source failing must not end the pass, or
         a single dark vendor would take the working ones down with it. */
      const text = errorText(e);
      firstError ??= `${source}: ${text}`;
      outcomes.push({ kind: 'failed', source, reason: text });
      deps.log.error('source failed', { source, mode: query.mode, err: text });
      continue;
    }

    itemsSeen += items.length;

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
    itemsSeen,
    itemsStored,
    firstError,
  };
}
