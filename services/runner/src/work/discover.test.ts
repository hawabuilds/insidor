/**
 * THE PROPERTY UNDER TEST IS THAT DEGRADATION IS ORDINARY.
 *
 * Zero, one, two and three live sources are all normal returns from the same function,
 * and the only difference between them is how many rows come back. Nothing throws,
 * nothing blocks, nothing retries in place, and — the one that is easy to lose —
 * nothing counts a source we did not ask as a source that had nothing to say.
 *
 * That last property is checked from both directions, because it can be broken in
 * both: a dark source must not add to the item count, and a source that WAS asked and
 * returned nothing must still be recorded as having answered. If those two collapse,
 * every number computed downstream is partly a measurement of our own configuration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY, sourceId } from '@insidor/contracts';
import type { Item, Millis } from '@insidor/contracts';
import type { Budget, Meter, Metered, CostEstimate } from '@insidor/contracts/ports/meter.ts';
import type {
  Capabilities,
  Discovered,
  DiscoveryMode,
  DiscoveryQuery,
  PlatformAdapter,
} from '@insidor/contracts/ports/platform.ts';
import type { PlatformRegistry, SourceAbsence } from '@insidor/platform-registry';
import { BudgetRefused } from '@insidor/vendor-kit';

import type { Logger } from '../log.ts';
import { discoverPass, queryFor, termFor, type DiscoveryPlan } from './discover.ts';

/* A logger that says nothing. The real one writes a line per pass to stdout, which
   would bury the assertions; what it prints is asserted where the loop is, not here. */
const log: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

const NOW = 1_800_000_000_000 as Millis;
/* One term and a cadence, because the cadence is what makes the term rotate. A plan
   with one term rotates to the same term forever, which is exactly what these tests
   want: they are about degradation, not about which word we looked for. */
const CADENCE_MS = 300_000;
const PLAN: DiscoveryPlan = { terms: ['ceasefire'], cadenceMs: CADENCE_MS };

/* ── fake adapters ─────────────────────────────────────────────────────── */

function capabilities(source: string, discovery: readonly DiscoveryMode[]): Capabilities {
  return {
    source: sourceId(source),
    counters: [],
    absent: [],
    fidelity: {},
    discovery,
    observeBatchSize: 10,
    lineage: false,
    billing: 'per-call',
  };
}

const item = (source: string, n: number): Item =>
  ({
    id: `${source}:${n}`,
    source: sourceId(source),
    sourceItemId: String(n),
  }) as unknown as Item;

interface FakeOptions {
  readonly items?: number;
  readonly fails?: string;
  readonly discovery?: readonly DiscoveryMode[];
  /** What one discovery call costs. Zero makes this a free source. */
  readonly usd?: number;
  /** The opaque billing identity. Two sources may legitimately share one. */
  readonly vendor?: string;
  /** Records every call that actually went out, so a dry run can be proved silent. */
  readonly calls?: string[];
  /** Refuse at the vendor edge, the way `metered()` does behind the pre-check. */
  readonly refuses?: boolean;
}

function fakeAdapter(source: string, options: FakeOptions = {}): PlatformAdapter {
  const count = options.items ?? 0;
  const usd = options.usd ?? 0;
  const vendor = options.vendor ?? source;
  return {
    id: sourceId(source),
    capabilities: capabilities(source, options.discovery ?? ['keyword']),
    discover: async (_q: DiscoveryQuery, _b: Budget): Promise<Metered<Discovered>> => {
      /* ★ RECORDED BEFORE ANY BRANCH. The dry-run test asserts this array is EMPTY, so
         it has to be written by every path a call could take — including the ones that
         throw. A counter incremented after a successful return would let a dry run that
         called and failed look identical to one that never called. */
      options.calls?.push(source);
      if (options.refuses === true) throw new BudgetRefused(vendor, 'discover', 'soft stop reached');
      if (options.fails !== undefined) throw new Error(options.fails);
      return {
        value: {
          items: Array.from({ length: count }, (_v, i) => item(source, i)),
          cursor: null,
          hasMore: false,
        },
        spend: [],
      } as unknown as Metered<Discovered>;
    },
    observe: async () => {
      throw new Error('not used');
    },
    estimate: (): CostEstimate => ({
      vendor,
      endpoint: 'discover',
      unit: 'per-call',
      estUnits: 1,
      usd,
    }),
    toItem: () => item(source, 0),
    baselineKey: () => source,
  };
}

/**
 * A meter that permits everything and knows nothing.
 *
 * ★ THE DEFAULT FOR EVERY TEST THAT IS NOT ABOUT MONEY, because a meter that could
 * refuse would make a budget pause and a vendor outage share a symptom — which is
 * precisely the collapse the `paused` outcome exists to prevent, and a test suite that
 * could not tell them apart would be unable to notice it coming back.
 */
const openMeter = (): Meter => ({
  record: () => undefined,
  spentUsd: () => 0,
  mayspend: () => true,
  line: () => ({
    capUsd: Number.POSITIVE_INFINITY,
    spentUsd: 0,
    stopAtUsd: Number.POSITIVE_INFINITY,
    remainingUsd: Number.POSITIVE_INFINITY,
    unrecordedUsd: 0,
  }),
});

/** A meter with a real line, so a refusal carries real numbers into the pause row. */
const meterWith = (capUsd: number, spentUsd: number): Meter => ({
  record: () => undefined,
  spentUsd: () => spentUsd,
  mayspend: (_vendor, usd) => spentUsd + usd <= capUsd,
  line: () => ({
    capUsd,
    spentUsd,
    stopAtUsd: capUsd,
    remainingUsd: Math.max(capUsd - spentUsd, 0),
    unrecordedUsd: 0,
  }),
});

function registryOf(
  live: readonly PlatformAdapter[],
  absent: readonly SourceAbsence[] = [],
): PlatformRegistry {
  return {
    get: () => {
      throw new Error('not used');
    },
    all: () => live,
    has: () => true,
    absent: () => absent,
  };
}

const dormant = (source: string): SourceAbsence =>
  ({ source, configuration: 'dormant', detail: ['SOME_KEY'] }) as unknown as SourceAbsence;

const broken = (source: string): SourceAbsence =>
  ({ source, configuration: 'misconfigured', detail: ['SOME_KEY is not set'] }) as unknown as SourceAbsence;

function deps(
  registry: PlatformRegistry,
  store: (items: readonly Item[]) => Promise<number> = async (i) => i.length,
) {
  return {
    platforms: registry,
    store,
    plan: PLAN,
    policy: DEFAULT_POLICY,
    meter: openMeter(),
    mode: 'live' as const,
    log,
    now: () => NOW,
    signal: new AbortController().signal,
  };
}

/* ── zero, one, two, three ─────────────────────────────────────────────── */

test('zero live sources is a clean return, not an error', () => {
  // The state of a fresh clone. It must not throw, must not retry in place, and must
  // report every dark source with its reason rather than reporting nothing at all.
  return discoverPass(deps(registryOf([], [dormant('x'), dormant('tiktok'), dormant('reddit')]))).then(
    (result) => {
      assert.equal(result.asked, 0);
      assert.equal(result.answered, 0);
      assert.equal(result.failed, 0);
      assert.equal(result.dark, 3);
      assert.equal(result.itemsSeen, 0);
      assert.equal(result.itemsStored, 0);
      assert.equal(result.firstError, null);
    },
  );
});

test('one live source works exactly as three do, with fewer rows', async () => {
  const one = await discoverPass(
    deps(registryOf([fakeAdapter('reddit', { items: 4 })], [dormant('x'), dormant('tiktok')])),
  );
  const three = await discoverPass(
    deps(
      registryOf([
        fakeAdapter('reddit', { items: 4 }),
        fakeAdapter('x', { items: 4 }),
        fakeAdapter('tiktok', { items: 4 }),
      ]),
    ),
  );

  assert.equal(one.answered, 1);
  assert.equal(one.itemsStored, 4);
  assert.equal(three.answered, 3);
  assert.equal(three.itemsStored, 12);
  // Same shape of result, same absence of errors. Only the counts differ.
  assert.equal(one.failed, 0);
  assert.equal(three.failed, 0);
});

test('two live and one dark keeps the dark one visible and out of the counts', async () => {
  const result = await discoverPass(
    deps(
      registryOf(
        [fakeAdapter('reddit', { items: 3 }), fakeAdapter('x', { items: 2 })],
        [dormant('tiktok')],
      ),
    ),
  );
  assert.equal(result.asked, 2);
  assert.equal(result.dark, 1);
  assert.equal(result.itemsSeen, 5);
});

/* ── ★ the rule the whole build turns on ───────────────────────────────── */

test('★ a dark source is never recorded as a source that had nothing to say', async () => {
  const result = await discoverPass(
    deps(registryOf([fakeAdapter('reddit', { items: 2 })], [dormant('x'), broken('tiktok')])),
  );

  const dark = result.outcomes.filter((o) => o.kind === 'dark');
  assert.equal(dark.length, 2);
  for (const outcome of dark) {
    // The type makes this unrepresentable rather than merely untrue: there is no item
    // count on the dark branch, so nobody can write "this dark source returned zero".
    assert.equal('items' in outcome, false, 'a dark source must carry no item count');
  }

  // and the two kinds of dark stay two kinds.
  assert.deepEqual(
    dark.map((o) => (o.kind === 'dark' ? `${o.source}:${o.configuration}` : '')).sort(),
    ['tiktok:misconfigured', 'x:dormant'],
  );
});

test('★ a source that WAS asked and returned nothing is an answer, and a real zero', async () => {
  // The other half of the same rule. This zero is a measurement — the source was
  // reached and the window was quiet — and it must not be flattened into the dark
  // ones, or "quiet" and "unplugged" become the same row again.
  const result = await discoverPass(
    deps(registryOf([fakeAdapter('reddit', { items: 0 })], [dormant('x')])),
  );
  const answered = result.outcomes.find((o) => o.kind === 'answered');
  assert.ok(answered !== undefined);
  assert.equal(answered.kind === 'answered' ? answered.items : -1, 0);
  assert.equal(result.answered, 1);
  assert.equal(result.asked, 1);
  assert.equal(result.dark, 1);
});

/* ── failure ───────────────────────────────────────────────────────────── */

test('one failing source does not take the working ones down with it', async () => {
  const result = await discoverPass(
    deps(
      registryOf([
        fakeAdapter('reddit', { items: 3 }),
        fakeAdapter('x', { fails: 'the vendor said no' }),
        fakeAdapter('tiktok', { items: 1 }),
      ]),
    ),
  );
  assert.equal(result.answered, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.itemsStored, 4, 'the two that worked still stored their rows');
  assert.match(result.firstError ?? '', /the vendor said no/);
});

test('a failed source contributes no item count at all', async () => {
  const result = await discoverPass(deps(registryOf([fakeAdapter('x', { fails: 'boom' })])));
  const failed = result.outcomes.find((o) => o.kind === 'failed');
  assert.ok(failed !== undefined);
  assert.equal('items' in failed, false, 'a failed call measured nothing');
  assert.equal(result.itemsSeen, 0);
});

test('a store failure leaves the count UNKNOWN rather than zero', async () => {
  // The write did not complete, so how many landed is not a number we have. A zero
  // here would be a measurement we never made — and it is deliberately not recorded
  // against the source, because the source answered and our database is not its fault.
  const result = await discoverPass(
    deps(registryOf([fakeAdapter('reddit', { items: 5 })]), async () => {
      throw new Error('the database went away');
    }),
  );
  const answered = result.outcomes.find((o) => o.kind === 'answered');
  assert.ok(answered !== undefined && answered.kind === 'answered');
  assert.equal(answered.stored, null);
  assert.equal(answered.items, 5, 'what the source returned is still known');
  assert.match(result.firstError ?? '', /could not store/);
  // and it is NOT counted as a source failure: the source did its job.
  assert.equal(result.failed, 0);
});

/* ── a source we cannot ask ────────────────────────────────────────────── */

test('a live source with no renderable discovery mode is UNASKED, not failed', async () => {
  // A gap in what we can ask, not a fault of the vendor's. Counting it as a failure
  // would inflate the consecutive-failure count and eventually paint the source red
  // for a feature we have not written.
  const result = await discoverPass(
    deps(registryOf([fakeAdapter('odd', { discovery: [] })])),
  );
  assert.equal(result.unasked, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.asked, 0, 'it was never asked, so it is not in the denominator');
});

test('the query is rendered in the source\'s own declared mode', () => {
  const keyword = queryFor(fakeAdapter('x', { discovery: ['account', 'keyword'] }), 'term', NOW);
  assert.equal(keyword?.mode, 'keyword', 'keyword is preferred where it exists');

  const feed = queryFor(fakeAdapter('t', { discovery: ['feed'] }), 'term', NOW);
  assert.equal(feed?.mode, 'feed', 'and a source without it gets one it does declare');

  assert.equal(queryFor(fakeAdapter('n', { discovery: [] }), 'term', NOW), null);
});

test('live discovery declares a null cutoff rather than reading a clock', () => {
  // Null means "take whatever is newest". A replay passes the decision instant here,
  // which is what makes a historical run structurally blind rather than blind by good
  // intentions; this is the live path, so null is the honest value.
  const query = queryFor(fakeAdapter('x'), 'term', NOW);
  assert.equal(query?.untilMs, null);
  assert.ok((query?.sinceMs ?? 0) < NOW, 'and it looks back further than one cadence');
});

/* ── shutdown ──────────────────────────────────────────────────────────── */

test('an aborted pass stops asking and still reports what it already knew', async () => {
  const ac = new AbortController();
  ac.abort();
  const result = await discoverPass({
    ...deps(registryOf([fakeAdapter('reddit', { items: 9 })], [dormant('x')])),
    signal: ac.signal,
  });
  assert.equal(result.asked, 0, 'no vendor call is started once shutdown has begun');
  assert.equal(result.dark, 1, 'and what configuration said is still on the record');
});

/* ── the ceiling, the pause, and the dry run ───────────────────────────── */

test('★ the ceiling REFUSES: the call is not made once the cap is reached', async () => {
  /* The line the whole money path exists for. A meter that measured spend without
     refusing it is a receipt, and the difference is only visible here — in whether the
     adapter's `discover` was entered at all. */
  const calls: string[] = [];
  const paid = fakeAdapter('x', { items: 3, usd: 0.9, calls });

  const result = await discoverPass({
    ...deps(registryOf([paid])),
    meter: meterWith(1, 0.8), // 20c left, the call wants 90c
  });

  assert.deepEqual(calls, [], 'the vendor was contacted despite the cap being reached');
  assert.equal(result.answered, 0);
  assert.equal(result.paused, 1);
});

test('★ a paused stage is DISTINGUISHABLE from one that found nothing', async () => {
  /* The distinction this whole codebase is built on, applied to money. Both sources
     below produce no items. One was asked and the world was quiet; the other was never
     asked because we could not afford it. Recorded as the same thing, an empty board
     reads as "nothing is happening" on the day the truth is "we ran out of money". */
  const quiet = fakeAdapter('reddit', { items: 0, usd: 0 });
  const unaffordable = fakeAdapter('x', { items: 5, usd: 9 });

  const result = await discoverPass({
    ...deps(registryOf([quiet, unaffordable])),
    meter: meterWith(1, 0),
  });

  const byKind = new Map(result.outcomes.map((o) => [o.source, o.kind]));
  assert.equal(byKind.get('reddit'), 'answered', 'a quiet source must still be an answer');
  assert.equal(byKind.get('x'), 'paused', 'an unaffordable source must not read as quiet');

  /* And the reverse direction, which is the one that would be lost by a `0` in a
     count: the quiet source's zero is a MEASUREMENT and survives as one. */
  const answered = result.outcomes.find((o) => o.kind === 'answered');
  assert.ok(answered !== undefined && answered.kind === 'answered');
  assert.equal(answered.items, 0);
});

test('★ a pause carries the arithmetic that produced it', async () => {
  /* A row saying only "paused" is indistinguishable from "we chose not to ask" a week
     later, when the question is whether the cap is too low or the cadence too fast.
     Both answers are in these four numbers and in no log line. */
  const result = await discoverPass({
    ...deps(registryOf([fakeAdapter('x', { items: 3, usd: 0.9 })])),
    meter: meterWith(1, 0.8),
  });

  const paused = result.outcomes.find((o) => o.kind === 'paused');
  assert.ok(paused !== undefined && paused.kind === 'paused');
  assert.equal(paused.wouldSpendUsd, 0.9);
  assert.equal(paused.spentUsd, 0.8);
  assert.equal(paused.capUsd, 1);
  assert.ok(Math.abs(paused.remainingUsd - 0.2) < 1e-9);
});

test('★ a pause is NOT a failure, and never reaches firstError', async () => {
  /* `failed` drives the run row to 'error' and the supervisor's backoff. A budget stop
     is the system working exactly as told, and reporting it as an error would slow a
     healthy loop and page somebody about an invoice. */
  const result = await discoverPass({
    ...deps(registryOf([fakeAdapter('x', { usd: 9 })])),
    meter: meterWith(1, 0),
  });

  assert.equal(result.failed, 0);
  assert.equal(result.firstError, null);
  assert.equal(result.asked, 0, 'a source we could not afford was never asked');
});

test('★ a refusal thrown at the vendor edge is a pause too, not a failure', async () => {
  /* `metered()` is the backstop behind the pre-check and it THROWS, arriving on the same
     path as a timeout. Counted as a failure it would inflate the consecutive-failure
     count on a source that is working perfectly, and after three passes the board would
     call it broken because we could not afford it. */
  const result = await discoverPass({
    ...deps(registryOf([fakeAdapter('x', { usd: 0, refuses: true })])),
  });

  assert.equal(result.paused, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.firstError, null);
});

test('★ THE DRY RUN ISSUES NO CALL, and still prices every one it would have made', async () => {
  /* The property the mode exists for, asserted from the only place it is observable:
     whether the adapter's `discover` was entered. `calls` is written by every path
     `discover` can take, including the throwing ones, so a dry run that called and
     failed cannot pass this test. */
  const calls: string[] = [];
  const registry = registryOf([
    fakeAdapter('x', { items: 40, usd: 0.015, calls }),
    fakeAdapter('reddit', { items: 12, usd: 0, calls }),
  ]);

  const result = await discoverPass({ ...deps(registry), mode: 'dry' });

  assert.deepEqual(calls, [], 'a dry run contacted a vendor');
  assert.equal(result.planned, 2);
  assert.equal(result.answered, 0);
  assert.equal(result.itemsSeen, 0, 'a dry run must not invent items it did not fetch');
  assert.equal(result.estimatedUsd, 0.015, 'the dry run must total what the calls would cost');
});

test('a dry run reports what WOULD have been refused', async () => {
  /* Otherwise it tells a person their day costs ninety cents when the ninth pass would
     have been paused — which is the one thing they ran it to find out. The mode returns
     AFTER the budget has been consulted, so a `paused` row appears in both modes. */
  const result = await discoverPass({
    ...deps(registryOf([fakeAdapter('x', { usd: 9 })])),
    mode: 'dry',
    meter: meterWith(1, 0),
  });

  assert.equal(result.paused, 1);
  assert.equal(result.planned, 0);
  assert.equal(result.estimatedUsd, 0, 'a call that would be refused is not a call we would pay for');
});

/* ── free before paid ──────────────────────────────────────────────────── */

test('★ the free source is asked FIRST, whatever order the registry declares', async () => {
  /* Ordering decides who gets refused when the cap binds. Registry order is DECLARATION
     order — whatever order somebody happened to add sources to a file — and under it the
     paid source drains the line before the free one is reached, so the day loses the half
     that was never going to cost anything. */
  const calls: string[] = [];
  const registry = registryOf([
    fakeAdapter('x', { items: 1, usd: 0.015, calls }),
    fakeAdapter('reddit', { items: 1, usd: 0, calls }),
  ]);

  await discoverPass({
    ...deps(registry),
    /* The rule is off, so the paid source is still asked — this test is about ORDER
       alone, and folding the two together would let a passing test mean either. */
    policy: { ...DEFAULT_POLICY, budget: { ...DEFAULT_POLICY.budget, paidOnlyWhenFreeIsEmpty: false } },
  });

  assert.deepEqual(calls, ['reddit', 'x'], 'the paid source was asked before the free one');
});

test('★ a paid source is DEFERRED, never recorded as having answered nothing', async () => {
  /* "We decided not to pay for this" and "we paid and there was nothing there" are
     opposite facts, and the second is the one that would make somebody turn a working
     source off. The row names who covered it, so the decision is reconstructable. */
  const calls: string[] = [];
  const registry = registryOf([
    fakeAdapter('x', { items: 5, usd: 0.015, calls }),
    fakeAdapter('reddit', { items: 3, usd: 0, calls }),
  ]);

  const result = await discoverPass({ ...deps(registry) });

  assert.deepEqual(calls, ['reddit'], 'the paid source was called anyway');
  const deferred = result.outcomes.find((o) => o.kind === 'deferred');
  assert.ok(deferred !== undefined && deferred.kind === 'deferred');
  assert.equal(deferred.source, 'x');
  assert.equal(deferred.coveredBy, 'reddit');
  assert.equal(result.answered, 1, 'the deferred source must not count as having answered');
});

test('a free source that found NOTHING does not cover the term', async () => {
  /* A free source that was asked and found nothing has told us the term is quiet on IT.
     That is no reason to skip a source reading a different half of the internet, and
     treating it as coverage would turn one quiet source into a system-wide blind spot. */
  const calls: string[] = [];
  const registry = registryOf([
    fakeAdapter('x', { items: 5, usd: 0.015, calls }),
    fakeAdapter('reddit', { items: 0, usd: 0, calls }),
  ]);

  const result = await discoverPass({ ...deps(registry) });

  assert.deepEqual(calls, ['reddit', 'x']);
  assert.equal(result.deferred, 0);
  assert.equal(result.itemsSeen, 5);
});

test('two free sources never defer each other — the rule is about money, not duplication', () => {
  /* Deferral exists to avoid PAYING twice, not to avoid asking twice. Two free sources
     hold different posts and cost nothing, so both are always asked. */
  const calls: string[] = [];
  const registry = registryOf([
    fakeAdapter('a', { items: 2, usd: 0, calls }),
    fakeAdapter('b', { items: 2, usd: 0, calls }),
  ]);

  return discoverPass({ ...deps(registry) }).then((result) => {
    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(result.answered, 2);
  });
});

/* ── the term rotates ──────────────────────────────────────────────────── */

test('★ every configured term is eventually looked for, not just the first', () => {
  /* Before this, `terms[0]` was used and the rest were silently dropped: a colleague
     who configured three terms got one of them forever and no warning about the other
     two, which reads for weeks as "the system found nothing" when we never looked. */
  const plan: DiscoveryPlan = { terms: ['alpha', 'beta', 'gamma'], cadenceMs: CADENCE_MS };
  const seen = new Set<string>();
  for (let pass = 0; pass < plan.terms.length; pass += 1) {
    seen.add(termFor(plan, (NOW + pass * CADENCE_MS) as Millis) ?? '');
  }
  assert.deepEqual([...seen].sort(), ['alpha', 'beta', 'gamma']);
});

test('the rotation is a function of the clock, so a restart does not reset it to the first term', () => {
  /* A counter in the loop would reset on every deploy, and a system deployed twice a
     day would spend its life on terms[0] — the bug this rotation exists to fix,
     restored by the mechanism meant to fix it. */
  const plan: DiscoveryPlan = { terms: ['alpha', 'beta', 'gamma'], cadenceMs: CADENCE_MS };
  const at = (NOW + 7 * CADENCE_MS) as Millis;
  assert.equal(termFor(plan, at), termFor(plan, at), 'the same instant chose two different terms');
});

test('one term rotates to itself, and an empty list has no term at all', () => {
  assert.equal(termFor({ terms: ['solo'], cadenceMs: CADENCE_MS }, NOW), 'solo');
  /* Not reachable through config, which refuses an empty list — but the pass records
     `unasked` for it rather than returning clean, so the null has to exist. */
  assert.equal(termFor({ terms: [], cadenceMs: CADENCE_MS }, NOW), null);
});

test('a call that FAILED still counts toward what the pass spent', async () => {
  /* The vendor bills on receipt, not on our ability to parse the answer. Counting only
     the successful calls would make an incident — the hours when everything fails —
     look like the cheapest day of the month, which is the same understatement
     `metered()` records the spend on the throw path to prevent. */
  const result = await discoverPass({
    ...deps(registryOf([fakeAdapter('x', { usd: 0.015, fails: 'gateway timeout' })])),
  });

  assert.equal(result.failed, 1);
  assert.equal(result.estimatedUsd, 0.015, 'a billed failure was recorded as free');
});

test('a REFUSED call costs nothing, because no request left the process', async () => {
  /* The other side of the same line, and the only path that does not add: a refusal
     happens before the socket, so there is nothing for anybody to bill. */
  const result = await discoverPass({
    ...deps(registryOf([fakeAdapter('x', { usd: 9 })])),
    meter: meterWith(1, 0),
  });

  assert.equal(result.paused, 1);
  assert.equal(result.estimatedUsd, 0);
});
