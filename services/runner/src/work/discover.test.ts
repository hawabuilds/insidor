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
import type { Budget, Metered } from '@insidor/contracts/ports/meter.ts';
import type {
  Capabilities,
  Discovered,
  DiscoveryMode,
  DiscoveryQuery,
  PlatformAdapter,
} from '@insidor/contracts/ports/platform.ts';
import type { PlatformRegistry, SourceAbsence } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import { discoverPass, queryFor, type DiscoveryPlan } from './discover.ts';

/* A logger that says nothing. The real one writes a line per pass to stdout, which
   would bury the assertions; what it prints is asserted where the loop is, not here. */
const log: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

const NOW = 1_800_000_000_000 as Millis;
const PLAN: DiscoveryPlan = { terms: ['ceasefire'] };

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
}

function fakeAdapter(source: string, options: FakeOptions = {}): PlatformAdapter {
  const count = options.items ?? 0;
  return {
    id: sourceId(source),
    capabilities: capabilities(source, options.discovery ?? ['keyword']),
    discover: async (_q: DiscoveryQuery, _b: Budget): Promise<Metered<Discovered>> => {
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
    toItem: () => item(source, 0),
    baselineKey: () => source,
  };
}

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
