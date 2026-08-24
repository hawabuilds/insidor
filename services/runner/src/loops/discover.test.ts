/**
 * THE TWO CLAIMS THE DISCOVERY LOOP MAKES ABOUT ITSELF THAT NOTHING ELSE CHECKS.
 *
 * `work/discover.test.ts` covers the PASS — what happens to dark, failing and quiet
 * sources once one is under way. This file covers the LOOP around it, and specifically
 * the two properties that live in the wiring rather than in the work:
 *
 *   1. ★ THE CADENCE AND THE FRESHNESS BAR ARE ONE DECISION SPELLED IN TWO PLACES.
 *      `EVERY_MS` in discover.ts and `Policy.ingest.sourceFreshnessMs` in contracts are
 *      not independent numbers: a source is called failing once it has been silent past
 *      the bar, and the only thing that ever breaks that silence is this loop asking.
 *      Set the cadence at or above the bar and a perfectly healthy source crosses it
 *      between passes — the indicator flickers red on a product that is working exactly
 *      as configured, which is the single failure the three-way state exists to prevent.
 *      Until this file existed that link was held by a comment, and a comment does not
 *      fail a build. The bar is deliberately generous (several cadences of headroom, so
 *      an outage rather than a slow afternoon is what turns a pip red) and the assertion
 *      below is the loose version of it: whatever either number becomes, the loop must
 *      still get several attempts inside one window.
 *
 *   2. ★ SOURCES ARE DECLARED EVEN WHEN NOTHING IS ASKED. `DISCOVER=off` is the default
 *      in `.env.example` and therefore the state of every fresh clone, so the branch
 *      that runs on most machines most of the time is the one that asks nobody. If
 *      `declareSources` ever moved below that early return, the indicator would show
 *      whatever was last written — or nothing at all on a fresh database — while the
 *      process hummed along beside it. That is a stale claim rather than a missing one,
 *      which is the worse of the two, and it would be invisible precisely because the
 *      pipeline would look fine.
 *
 * Nothing here reaches a network or a database: the registry, the store and the health
 * repository are all stubs, and a stub that is not supposed to be called throws.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY, sourceId } from '@insidor/contracts';
import type { Item, Millis, SourceConfiguration, SourceHealth } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { PlatformRegistry, SourceAbsence } from '@insidor/platform-registry';

import { SUPERVISED, SUPERVISED_STAGES } from '../config.ts';
import type { LogFields, Logger } from '../log.ts';
import type { LoopContext } from '../loop.ts';
import type { WatchDeps } from '../sources.ts';
import { discoverLoop } from './discover.ts';

const NOW = 1_770_000_000_000 as Millis;

/* Silent, because the loop prints a line per pass and the assertions are about what it
   DID, not what it said. The one line whose absence would be a bug — the `off` branch
   saying so out loud — is captured rather than swallowed, below. */
function recordingLogger(): { readonly log: Logger; readonly infos: string[] } {
  const infos: string[] = [];
  const log: Logger = {
    info: (msg: string, _fields?: LogFields) => {
      infos.push(msg);
    },
    warn: () => undefined,
    error: () => undefined,
    child: () => log,
  };
  return { log, infos };
}

/** A registry with nothing live and nothing absent: the fresh-clone shape. */
function emptyRegistry(absent: readonly SourceAbsence[] = []): PlatformRegistry {
  return {
    get: () => {
      throw new Error('the loop must not ask for an adapter on a pass that asks nobody');
    },
    all: (): readonly PlatformAdapter[] => [],
    has: () => false,
    absent: () => absent,
  };
}

interface Declared {
  readonly source: string;
  readonly configuration: SourceConfiguration;
}

function watchDeps(): { readonly deps: WatchDeps; readonly declared: Declared[] } {
  const declared: Declared[] = [];
  const deps: WatchDeps = {
    health: {
      declare: async (source, configuration) => {
        declared.push({ source: String(source), configuration });
      },
      recordSuccess: async () => {
        throw new Error('no call was made, so no success may be recorded');
      },
      recordFailure: async () => {
        throw new Error('no call was made, so no failure may be recorded');
      },
      all: async (): Promise<readonly SourceHealth[]> => [],
    },
    now: () => NOW,
    log: recordingLogger().log,
  };
  return { deps, declared };
}

/**
 * A meter that permits everything.
 *
 * These tests are about what the LOOP reports, not about what the wallet allows, and a
 * meter that could refuse would make a pass that was paused indistinguishable from one
 * that found nothing — which is exactly the collapse the loop's counts exist to prevent.
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

const context = (): LoopContext => ({
  signal: new AbortController().signal,
  now: () => NOW,
});

const store = async (_items: readonly Item[]): Promise<number> => {
  throw new Error('a pass that asks nobody has nothing to store');
};

function loopWith(discovery: { readonly kind: 'off' } | { readonly kind: 'on'; readonly terms: readonly string[] }) {
  const { log, infos } = recordingLogger();
  const watch = watchDeps();
  const loop = discoverLoop({
    platforms: emptyRegistry([
      { source: 'x', configuration: 'dormant', detail: ['X_API_KEY'] },
      { source: 'reddit', configuration: 'misconfigured', detail: ['REDDIT_CLIENT_SECRET is not set'] },
    ]),
    store,
    discovery,
    policy: DEFAULT_POLICY,
    meter: openMeter(),
    mode: 'live',
    log,
    watch: watch.deps,
  });
  return { loop, infos, declared: watch.declared };
}

/* ── 1. the cadence and the bar ───────────────────────────────────────── */

test('★ the discovery cadence leaves room inside the freshness bar, so a healthy source cannot flicker', () => {
  const { loop } = loopWith({ kind: 'off' });
  const bar = DEFAULT_POLICY.ingest.sourceFreshnessMs;

  /* The loop that asks is the only thing that can reset a source's silence, so the bar
     has to hold several of its cadences. Four is the loose floor — one missed pass must
     never be enough to call a source dead, and the shipped numbers (five minutes against
     thirty) leave six. Raising the cadence past this line means moving the bar in
     contracts/src/policy.ts in the same commit; that is the point of the assertion. */
  assert.ok(
    loop.everyMs * 4 <= bar,
    `discovery runs every ${loop.everyMs}ms against a freshness bar of ${bar}ms — fewer ` +
      'than four attempts fit inside the window, so an ordinary gap between passes can ' +
      'publish a working source as failing. Move the bar or lower the cadence.',
  );

  /* And the cadence must be a real interval. A zero or negative one would busy-loop
     against paid vendors, which is the failure mode a per-call bill makes expensive
     rather than merely noisy. */
  assert.ok(loop.everyMs > 0, 'a cadence of zero is a paid vendor asked in a tight loop');
  assert.ok(loop.offsetMs >= 0, 'a negative stagger is not a stagger');
});

test('discovery is supervised but is NOT a decision stage, so it can never reach the decision log', () => {
  const { loop } = loopWith({ kind: 'off' });

  assert.equal(loop.stage, 'discover');
  assert.ok(SUPERVISED.includes(loop.stage), 'a loop nobody supervises is a loop nobody misses');
  /* `Decision.stage` is typed from STAGE_NAMES and `internal.decisions` enumerates those
     seven in a CHECK constraint. Discovery writes no decision, so a member here would be
     a name no row can ever carry — the type and the constraint disagreeing by design. */
  assert.ok(
    !(SUPERVISED_STAGES as readonly string[]).includes(loop.stage),
    'discovery decides nothing and must stay out of the decision vocabulary',
  );
});

/* ── 2. the branch that runs on every fresh clone ─────────────────────── */

test('★ with discovery off, every source is still declared — the indicator does not go stale', async () => {
  const { loop, infos, declared } = loopWith({ kind: 'off' });

  const counts = await loop.run(context());

  /* Both absences, with which kind of dark each is. This is the half of the health
     record nothing can observe from the outside, and it has to be written by the pass
     that asks nobody exactly as by the pass that asks everybody. */
  assert.deepEqual(declared, [
    { source: 'x', configuration: 'dormant' },
    { source: 'reddit', configuration: 'misconfigured' },
  ]);

  /* Said out loud, once per cadence, and at info rather than warn: somebody declared
     this state, and a warning for a declared state is how a log stops being read. */
  assert.ok(infos.includes('discovery is off; no source will be asked'));

  /* Nothing asked means nothing seen and nothing stored — real zeroes about our own
     work, not measurements of a quiet world. `failed` is zero because no call failed;
     a pass that asks nobody cannot have been let down by anybody. */
  assert.deepEqual(counts, { in: 0, out: 0, failed: 0, firstError: null });
});

test('a declaration that throws does not take the pass down with it', async () => {
  const { log } = recordingLogger();
  const loop = discoverLoop({
    platforms: emptyRegistry([{ source: 'x', configuration: 'dormant', detail: ['X_API_KEY'] }]),
    store,
    discovery: { kind: 'off' },
    policy: DEFAULT_POLICY,
    meter: openMeter(),
    mode: 'live',
    log,
    watch: {
      health: {
        declare: async () => {
          throw new Error('the database is having an afternoon');
        },
        recordSuccess: async () => undefined,
        recordFailure: async () => undefined,
        all: async () => [],
      },
      now: () => NOW,
      log,
    },
  });

  /* A monitoring feature must not be able to take down the thing it monitors. The write
     is logged and dropped; the pass returns its ordinary counts. */
  const counts = await loop.run(context());
  assert.deepEqual(counts, { in: 0, out: 0, failed: 0, firstError: null });
});

test('every registry key is a legal source id, so declaring one cannot throw at the seam', () => {
  /* `declareSources` mints a `SourceId` from the registry's plain-string key rather than
     casting it, which means a key that is not a legal token would throw at the one seam
     where the two vocabularies meet. The throw is caught and logged there — a dark
     source rather than a dead process — but the row would silently never be written, and
     a source missing from the indicator is the one state this whole feature exists to
     make impossible. Pinned here so a source added under an illegal name fails in a test
     rather than as a pip nobody notices is absent. */
  for (const key of ['x', 'reddit', 'tiktok']) {
    assert.equal(String(sourceId(key)), key);
  }
});
