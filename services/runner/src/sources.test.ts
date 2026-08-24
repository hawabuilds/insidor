/**
 * THE PROPERTY UNDER TEST IS THAT THE RECORD CANNOT LIE ABOUT A CALL.
 *
 * A wrapper around a vendor call is easy to write so that it records the outcome it
 * expected rather than the one that happened, and the mistake is invisible: the calls
 * still work, the errors still propagate, and the only symptom is a health table that
 * says everything is fine. So the checks below are all about the seam — that a failure
 * is recorded AND re-thrown unchanged, that a success is recorded, that the recording
 * cannot change either outcome, and that dormancy — the one fact no call can reveal —
 * is written for every source including the ones nobody turned on.
 *
 * The fake repository below implements the same reset-and-increment arithmetic the SQL
 * does, because the recovery property is a property of that arithmetic: a success must
 * clear the count, or a source that had a bad hour reads failing forever.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { sourceId } from '@insidor/contracts';
import type { Millis, SourceConfiguration, SourceHealth } from '@insidor/contracts';
import type { SourceHealthRepo } from '@insidor/contracts/ports/store.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { PlatformRegistry, SourceAbsence } from '@insidor/platform-registry';
import { BudgetRefused } from '@insidor/vendor-kit';
import type { SourceId } from '@insidor/contracts/ids.ts';

import type { Logger } from './log.ts';
import { declareSources, watched, watchedRegistry, type WatchDeps } from './sources.ts';

const log: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

const NOW = 1_800_000_000_000 as Millis;

/* ── a repository with the SQL's own arithmetic ────────────────────────── */

interface FakeRepo extends SourceHealthRepo {
  readonly rows: Map<string, SourceHealth>;
  failWrites: boolean;
}

function fakeRepo(): FakeRepo {
  const rows = new Map<string, SourceHealth>();

  const base = (source: SourceId, at: Millis): SourceHealth => ({
    source,
    configuration: 'configured',
    configurationDetail: null,
    configuredAt: at,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    consecutiveFailures: 0,
  });

  const repo: FakeRepo = {
    rows,
    failWrites: false,
    declare: async (source, configuration, detail, at) => {
      if (repo.failWrites) throw new Error('the database went away');
      const existing = rows.get(String(source));
      rows.set(String(source), {
        ...(existing ?? base(source, at)),
        configuration,
        configurationDetail: detail,
        // Moves only when the configuration itself changed. See the repo's own note.
        configuredAt: existing !== undefined && existing.configuration === configuration ? existing.configuredAt : at,
      });
    },
    recordSuccess: async (source, at) => {
      if (repo.failWrites) throw new Error('the database went away');
      const existing = rows.get(String(source)) ?? base(source, at);
      rows.set(String(source), { ...existing, lastSuccessAt: at, consecutiveFailures: 0 });
    },
    recordFailure: async (source, at, reason) => {
      if (repo.failWrites) throw new Error('the database went away');
      const existing = rows.get(String(source)) ?? base(source, at);
      rows.set(String(source), {
        ...existing,
        lastFailureAt: at,
        lastFailureReason: reason,
        consecutiveFailures: existing.consecutiveFailures + 1,
      });
    },
    all: async () => [...rows.values()],
  };
  return repo;
}

const deps = (health: SourceHealthRepo): WatchDeps => ({ health, now: () => NOW, log });

/* ── adapters ──────────────────────────────────────────────────────────── */

function adapterOf(
  source: string,
  behaviour: { fails?: string; refuses?: boolean } = {},
): PlatformAdapter {
  return {
    id: sourceId(source),
    capabilities: { source: sourceId(source), discovery: ['keyword'] } as unknown as PlatformAdapter['capabilities'],
    discover: async () => {
      if (behaviour.refuses === true) throw new BudgetRefused(source, 'discover', 'soft stop reached');
      if (behaviour.fails !== undefined) throw new Error(behaviour.fails);
      return { value: { items: [], cursor: null, hasMore: false }, spend: [] } as never;
    },
    observe: async () => {
      if (behaviour.refuses === true) throw new BudgetRefused(source, 'observe', 'soft stop reached');
      if (behaviour.fails !== undefined) throw new Error(behaviour.fails);
      return { value: new Map(), spend: [] } as never;
    },
    estimate: () => ({ vendor: source, endpoint: 'discover', unit: 'per-call', estUnits: 1, usd: 0 }),
    toItem: () => ({}) as never,
    baselineKey: () => source,
  };
}

const query = { mode: 'keyword', term: 't', sinceMs: null, untilMs: null, limit: 1, cursor: null } as never;
const budget = { capUsd: 1, spentUsd: 0, maxCalls: 1, deadline: NOW } as never;

const registryOf = (
  live: readonly PlatformAdapter[],
  absent: readonly SourceAbsence[] = [],
): PlatformRegistry => ({
  get: (source) => {
    const found = live.find((a) => String(a.id) === String(source));
    if (found === undefined) throw new Error('not live');
    return found;
  },
  all: () => live,
  has: (source) => live.some((a) => String(a.id) === String(source)),
  absent: () => absent,
});

const absence = (source: string, configuration: SourceConfiguration): SourceAbsence =>
  ({ source, configuration, detail: ['SOME_KEY'] }) as unknown as SourceAbsence;

/* ── the wrapper ───────────────────────────────────────────────────────── */

test('a call that works records a success', async () => {
  const repo = fakeRepo();
  await watched(adapterOf('reddit'), deps(repo)).discover(query, budget);
  assert.equal(repo.rows.get('reddit')?.lastSuccessAt, NOW);
  assert.equal(repo.rows.get('reddit')?.consecutiveFailures, 0);
});

test('a call that throws records a failure AND re-throws it unchanged', async () => {
  // Re-thrown unchanged because the caller's response — count it, log it, move on —
  // is not this wrapper's decision. A wrapper that swallowed would turn a dark vendor
  // into an empty page, which is the one thing this whole build refuses.
  const repo = fakeRepo();
  const adapter = watched(adapterOf('x', { fails: 'the vendor said no' }), deps(repo));
  await assert.rejects(() => adapter.discover(query, budget), /the vendor said no/);
  const row = repo.rows.get('x');
  assert.equal(row?.consecutiveFailures, 1);
  assert.equal(row?.lastFailureReason, 'the vendor said no');
  assert.equal(row?.lastSuccessAt, null);
});

test('EVERY verb is recorded, not only the one the loop was written for', async () => {
  // A source that fails every re-read while discovery happens to work is half broken.
  // Recording at the call site rather than around the adapter is how that reads as fine.
  const repo = fakeRepo();
  const adapter = watched(adapterOf('x', { fails: 'no' }), deps(repo));
  await assert.rejects(() => adapter.observe([], budget));
  assert.equal(repo.rows.get('x')?.consecutiveFailures, 1);
});

test('★ a source recovers the moment one call succeeds', async () => {
  const repo = fakeRepo();
  const failing = watched(adapterOf('reddit', { fails: 'no' }), deps(repo));
  for (let i = 0; i < 4; i += 1) await assert.rejects(() => failing.discover(query, budget));
  assert.equal(repo.rows.get('reddit')?.consecutiveFailures, 4);

  await watched(adapterOf('reddit'), deps(repo)).discover(query, budget);
  const row = repo.rows.get('reddit');
  assert.equal(row?.consecutiveFailures, 0, 'the count is cleared by the success');
  assert.equal(row?.lastSuccessAt, NOW);
  // and the failure it had is still on the record: recovery is not amnesia.
  assert.equal(row?.lastFailureReason, 'no');
});

test('a health write that fails does not change what the call returned', async () => {
  // The recording mechanism must not be able to cause the outage it exists to report.
  const repo = fakeRepo();
  repo.failWrites = true;
  const ok = watched(adapterOf('reddit'), deps(repo));
  await assert.doesNotReject(() => ok.discover(query, budget));

  const bad = watched(adapterOf('x', { fails: 'the vendor said no' }), deps(repo));
  await assert.rejects(() => bad.discover(query, budget), /the vendor said no/);
});

test('translation is not a call and does not make a source look alive', async () => {
  // `toItem` parses a payload we already hold. Recording a success for it would make a
  // dead source read as healthy on the strength of re-reading its own past pages.
  const repo = fakeRepo();
  const adapter = watched(adapterOf('reddit'), deps(repo));
  adapter.toItem({}, NOW);
  adapter.baselineKey({} as never, NOW);
  assert.equal(repo.rows.size, 0);
});

/* ── declaring what configuration said ─────────────────────────────────── */

test('★ every known source is declared, dark ones included, with which kind of dark', async () => {
  const repo = fakeRepo();
  await declareSources(
    registryOf([adapterOf('reddit')], [absence('x', 'dormant'), absence('tiktok', 'misconfigured')]),
    deps(repo),
  );
  assert.equal(repo.rows.get('reddit')?.configuration, 'configured');
  assert.equal(repo.rows.get('x')?.configuration, 'dormant');
  assert.equal(repo.rows.get('tiktok')?.configuration, 'misconfigured');
  assert.equal(repo.rows.get('tiktok')?.configurationDetail, 'SOME_KEY');
});

test('declaring never throws, whatever the database does', async () => {
  // A boot that failed because it could not write a health row would be a monitoring
  // feature taking down the thing it monitors.
  const repo = fakeRepo();
  repo.failWrites = true;
  await assert.doesNotReject(() =>
    declareSources(registryOf([adapterOf('reddit')], [absence('x', 'dormant')]), deps(repo)),
  );
});

test('a source that stays in one configuration keeps its original since-instant', async () => {
  // "Off since Tuesday" has to survive a redeploy, or every restart makes a source
  // that nobody has touched in a month look like one switched off five seconds ago.
  const repo = fakeRepo();
  const registry = registryOf([], [absence('x', 'dormant')]);
  await declareSources(registry, deps(repo));
  await declareSources(registry, { health: repo, now: () => (NOW + 86_400_000) as Millis, log });
  assert.equal(repo.rows.get('x')?.configuredAt, NOW);
});

/* ── the wrapped registry ──────────────────────────────────────────────── */

test('★ the registry hands out WRAPPED adapters, so a new loop cannot get an unwatched one', async () => {
  const repo = fakeRepo();
  const registry = watchedRegistry(registryOf([adapterOf('reddit')], [absence('x', 'dormant')]), deps(repo));

  const fromAll = registry.all()[0];
  assert.ok(fromAll !== undefined);
  await fromAll.discover(query, budget);
  assert.equal(repo.rows.get('reddit')?.lastSuccessAt, NOW, 'all() is watched');

  const repo2 = fakeRepo();
  const registry2 = watchedRegistry(registryOf([adapterOf('reddit')]), deps(repo2));
  await registry2.get(sourceId('reddit')).discover(query, budget);
  assert.equal(repo2.rows.get('reddit')?.lastSuccessAt, NOW, 'get() is watched too');
});

test('the absences pass through untouched — there is no call to record', async () => {
  const repo = fakeRepo();
  const registry = watchedRegistry(registryOf([], [absence('x', 'dormant')]), deps(repo));
  assert.deepEqual(
    registry.absent().map((a) => a.source),
    ['x'],
  );
  assert.equal(registry.all().length, 0);
});

/* ── our own refusal is not the vendor's outage ────────────────────────── */

test('★ a budget refusal is NOT recorded as a source failure', async () => {
  /* The meter throws BEFORE the request leaves the process, so there is no call whose
     outcome this could be. Recording it would write our own decision into the column
     whose entire purpose is to say what somebody else's server did — and three refused
     passes would then drive `consecutive_failures` past the failing bar and paint a
     working source red, sending somebody to look for an outage that is an invoice. */
  const health = fakeRepo();
  const adapter = watched(adapterOf('x', { refuses: true }), deps(health));

  await assert.rejects(() => adapter.discover(query, budget), BudgetRefused);

  const rows = await health.all();
  assert.equal(rows.length, 0, 'a refusal wrote a health row; it must write none');
});

test('★ and a real vendor failure still is', async () => {
  /* The other half, asserted in the same file, because the value of the first test is
     entirely in the contrast: a rule that suppressed BOTH would be indistinguishable
     from health recording being broken. */
  const health = fakeRepo();
  const adapter = watched(adapterOf('x', { fails: 'gateway timeout' }), deps(health));

  await assert.rejects(() => adapter.discover(query, budget));

  const row = (await health.all())[0];
  assert.ok(row, 'a vendor failure wrote no health row');
  assert.equal(row.consecutiveFailures, 1);
});

test('an estimate records nothing at all — a dry run must not look like a healthy ingest', () => {
  /* A dry run consists of nothing but estimates. If the wrapper recorded them, every
     source would end the pass marked as answering, and the board would report a healthy
     ingest on a run that contacted nobody. */
  const health = fakeRepo();
  const adapter = watched(adapterOf('x'), deps(health));

  const estimated = adapter.estimate({ kind: 'discover', query });

  assert.equal(estimated.usd, 0);
  assert.equal(health.rows.size, 0, 'estimating wrote a health row');
});
