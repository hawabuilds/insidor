/**
 * THE PROPERTY UNDER TEST IS NOT "IT BUILDS ADAPTERS". It is that a source which is
 * not there comes back as an ANSWER, with the right one of two reasons, and that the
 * number of sources that are there can be any number from zero to all of them without
 * anything throwing.
 *
 * Every test below corresponds to a state somebody will actually be in: a fresh clone
 * with no keys, a deploy where one secret did not make it into the environment, a
 * trial of one paid source, and the finished thing. The one that matters most is the
 * MISCONFIGURED pair — a half-filled environment and a constructor that refuses — both
 * of which must read as a fault and neither of which may read as "nobody turned this
 * on".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Meter, Spend } from '@insidor/contracts/ports/meter.ts';

import {
  KNOWN_SOURCES,
  SourceNotLive,
  UnknownSource,
  credentialSpecs,
  resolvePlatforms,
  type PlatformRegistry,
  type PlatformRuntime,
} from './registry.ts';

/* ── the runtime, with nothing that can reach anything ─────────────────── */

const meter: Meter = {
  record: (_spend: Spend) => undefined,
  spentUsd: () => 0,
  mayspend: () => true,
  /* An unbounded line. These tests are about which sources CONSTRUCT, and a meter that
     could refuse would make a construction failure and a budget refusal share a symptom. */
  line: () => ({
    capUsd: Number.POSITIVE_INFINITY,
    spentUsd: 0,
    stopAtUsd: Number.POSITIVE_INFINITY,
    remainingUsd: Number.POSITIVE_INFINITY,
    unrecordedUsd: 0,
  }),
};

/** Throws if called. No test here makes a request, and one that did would say so. */
const fetchImpl = (async () => {
  throw new Error('the registry tests never reach the network');
}) as unknown as typeof globalThis.fetch;

const runtime: PlatformRuntime = {
  meter,
  now: () => 1_800_000_000_000,
  fetch: fetchImpl,
  handles: () => null,
};

/* ── environments, named for the situation they represent ─────────────── */

/**
 * Every credential every source needs, so all three build.
 *
 * ★ THE ACTOR IDS ARE IN THE API SPELLING, WITH A TILDE, AND THAT IS NOT COSMETIC.
 * They used to be written `actor/discover` here, back when no client validated
 * anything — and that is the console spelling, which would put an extra segment in a
 * request path and produce a 404 that reads exactly like a retired actor. The client
 * now refuses it at construction, so these values are what a correctly configured
 * environment actually looks like rather than what an unchecked one could get away
 * with. `a constructor that refuses a bad actor id` below asserts the other half.
 */
const ALL: Record<string, string> = {
  X_API_KEY: 'x-key',
  APIFY_TOKEN: 'scrape-token',
  TIKTOK_DISCOVERY_ACTOR_ID: 'insidor~discover',
  TIKTOK_OBSERVE_ACTOR_ID: 'insidor~observe',
  REDDIT_CLIENT_ID: 'client-id',
  REDDIT_CLIENT_SECRET: 'client-secret',
  REDDIT_USER_AGENT: 'script:com.insidor.adapter:v0.1.0 (by /u/insidor_bot)',
};

const only = (...keys: readonly string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = ALL[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
};

const X_ONLY = only('X_API_KEY');
const TIKTOK_ONLY = only('APIFY_TOKEN', 'TIKTOK_DISCOVERY_ACTOR_ID', 'TIKTOK_OBSERVE_ACTOR_ID');
const REDDIT_ONLY = only('REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET', 'REDDIT_USER_AGENT');

const ids = (v: readonly { readonly id: unknown }[]): readonly string[] =>
  v.map((a) => String(a.id)).sort();

const darkIds = (v: readonly { readonly source: string }[]): readonly string[] =>
  v.map((a) => a.source).sort();

/* ── zero, one, two, three ─────────────────────────────────────────────── */

test('an empty environment yields zero live sources and does not throw', () => {
  // The state of a fresh clone, and it is a LEGITIMATE one. The process is expected
  // to run on nothing at all; what it must not do is refuse to start.
  const registry = resolvePlatforms({}, runtime);
  assert.deepEqual(registry.all(), []);
  assert.equal(registry.absent().length, KNOWN_SOURCES.length);
  for (const absence of registry.absent()) {
    assert.equal(absence.configuration, 'dormant', `${absence.source} should be dormant`);
    assert.ok(absence.detail.length > 0, 'a dormant source must name what would turn it on');
  }
});

test('one source configured yields exactly that one live and the rest dormant', () => {
  for (const [env, expected] of [
    [X_ONLY, 'x'],
    [TIKTOK_ONLY, 'tiktok'],
    [REDDIT_ONLY, 'reddit'],
  ] as const) {
    const registry = resolvePlatforms(env, runtime);
    assert.deepEqual(ids(registry.all()), [expected]);
    assert.equal(registry.absent().length, KNOWN_SOURCES.length - 1);
    for (const absence of registry.absent()) {
      assert.equal(absence.configuration, 'dormant', `${absence.source} should be dormant`);
    }
  }
});

test('two sources configured yields two live and one dormant', () => {
  const registry = resolvePlatforms({ ...X_ONLY, ...REDDIT_ONLY }, runtime);
  assert.deepEqual(ids(registry.all()), ['reddit', 'x']);
  assert.deepEqual(darkIds(registry.absent()), ['tiktok']);
});

test('every source configured yields every source live and nothing absent', () => {
  const registry = resolvePlatforms(ALL, runtime);
  assert.equal(registry.all().length, KNOWN_SOURCES.length);
  assert.deepEqual(registry.absent(), []);
});

/* ── the fault states ──────────────────────────────────────────────────── */

test('half a source\'s credentials is MISCONFIGURED, never dormant', () => {
  // The likeliest real failure: a deploy where one secret did not make it in. It
  // must read as a fault, because somebody believes this source is running.
  const registry = resolvePlatforms({ APIFY_TOKEN: 'scrape-token' }, runtime);
  const tiktok = registry.absent().find((a) => a.source === 'tiktok');
  assert.ok(tiktok !== undefined);
  assert.equal(tiktok.configuration, 'misconfigured');
  assert.ok(
    tiktok.detail.some((d) => d.includes('TIKTOK_DISCOVERY_ACTOR_ID')),
    'the detail must name the variable that is missing',
  );
});

test('a constructor that refuses a bad credential is misconfigured, not a crash', () => {
  // This source validates its user agent at construction and throws. That throw is
  // right — a spoofed agent gets the app banned — and it must still not take the
  // process down or the other sources with it.
  const env = { ...ALL, ...X_ONLY, REDDIT_USER_AGENT: 'Mozilla/5.0' };
  let registry: PlatformRegistry | undefined;
  assert.doesNotThrow(() => {
    registry = resolvePlatforms(env, runtime);
  });
  assert.ok(registry !== undefined);
  const reddit = registry.absent().find((a) => a.source === 'reddit');
  assert.ok(reddit !== undefined, 'a source whose constructor threw must appear as absent');
  assert.equal(reddit.configuration, 'misconfigured');
  // and the other two are untouched.
  assert.deepEqual(ids(registry.all()), ['tiktok', 'x']);
});

test('★ a constructor that refuses a bad actor id is misconfigured, not a crash', () => {
  // The two PAID sources can now reach this verdict too, which until their HTTP
  // bodies landed they could not: their constructors ignored their config entirely,
  // so the only road to `misconfigured` was a half-filled environment. A well-formed
  // environment holding a WRONG value had nowhere to be reported.
  //
  // It matters most on this source because a plausible-but-wrong actor id does not
  // fail — it runs, IS BILLED, and returns a dataset in a shape we cannot read.
  const env = { ...ALL, TIKTOK_DISCOVERY_ACTOR_ID: 'clockworks/tiktok-scraper' };
  let registry: PlatformRegistry | undefined;
  assert.doesNotThrow(() => {
    registry = resolvePlatforms(env, runtime);
  });
  assert.ok(registry !== undefined);

  const tiktok = registry.absent().find((a) => a.source === 'tiktok');
  assert.ok(tiktok !== undefined, 'a source whose constructor threw must appear as absent');
  assert.equal(tiktok.configuration, 'misconfigured');
  assert.ok(
    tiktok.detail.some((d) => d.includes('TIKTOK_DISCOVERY_ACTOR_ID')),
    'the detail must name the variable the operator has to edit',
  );
  // and the other two are untouched: one bad value never takes the process down.
  assert.deepEqual(ids(registry.all()), ['reddit', 'x']);
});

test('★ a credential with a stray newline is misconfigured on every paid source', () => {
  // A value pasted with a trailing newline is the ordinary way this happens, and a
  // newline in a header value means the request that goes out is not the request the
  // code wrote. It has to read as a fault somebody can fix, not as an outage.
  for (const [variable, source] of [
    ['X_API_KEY', 'x'],
    ['APIFY_TOKEN', 'tiktok'],
  ] as const) {
    const registry = resolvePlatforms({ ...ALL, [variable]: 'value-with-a\nnewline' }, runtime);
    const absence = registry.absent().find((a) => a.source === source);
    assert.ok(absence !== undefined, `${source} constructed with a malformed credential`);
    assert.equal(absence.configuration, 'misconfigured');
    assert.ok(absence.detail.some((d) => d.includes(variable)));
  }
});

test('a placeholder credential left from .env.example is a fault, not a credential', () => {
  const env = {
    ...ALL,
    REDDIT_USER_AGENT: 'script:com.insidor.adapter:v0.1.0 (by /u/YOUR_REDDIT_USERNAME)',
  };
  const registry = resolvePlatforms(env, runtime);
  const reddit = registry.absent().find((a) => a.source === 'reddit');
  assert.ok(reddit !== undefined);
  assert.equal(reddit.configuration, 'misconfigured');
});

/* ── the two kinds of "not here" stay two kinds ────────────────────────── */

test('asking for a dark source says WHICH kind of dark, without parsing a message', () => {
  const registry = resolvePlatforms({}, runtime);
  try {
    registry.get('x' as never);
    assert.fail('expected SourceNotLive');
  } catch (e) {
    assert.ok(e instanceof SourceNotLive);
    // The machine-readable half. Nothing downstream should ever need the string.
    assert.equal(e.configuration, 'dormant');
    assert.equal(e.source, 'x');
  }
});

test('asking for a source that does not exist is a DIFFERENT error', () => {
  // A typo and an unconfigured source are different mistakes with different fixes;
  // one class for both is how a stale row reads as an unpaid subscription.
  const registry = resolvePlatforms(ALL, runtime);
  assert.throws(() => registry.get('nosuchsource' as never), UnknownSource);
});

/* ── the declaration itself ────────────────────────────────────────────── */

test('every known source declares at least one credential of its own', () => {
  // A source with no declared credentials would resolve `ready` in an empty
  // environment and report itself live while holding nothing — the one shape that
  // would make a fresh clone look fully provisioned.
  const specs = credentialSpecs();
  for (const source of KNOWN_SOURCES) {
    const spec = specs[source];
    assert.equal(spec.source, source, 'a spec must belong to the source it is filed under');
    assert.ok(
      spec.requires.some((r) => r.fallback === null),
      `${source} declares no credential, so it can never be dormant`,
    );
  }
});

test('no credential carries a fallback, and every defaulted value is a host', () => {
  // A defaulted credential authenticates as somebody else. This is the check that
  // keeps `fallback` meaning "not a secret" rather than "convenient".
  for (const source of KNOWN_SOURCES) {
    for (const requirement of credentialSpecs()[source].requires) {
      if (requirement.fallback === null) continue;
      assert.match(
        requirement.fallback,
        /^https:\/\//,
        `${requirement.variable} has a fallback that is not a public host`,
      );
    }
  }
});

test('the live set and the absent set together are always every known source', () => {
  // The invariant that makes "which is which" answerable at all: a source cannot be
  // silently dropped from both lists, which is how one would go dark unnoticed.
  for (const env of [{}, X_ONLY, { ...X_ONLY, ...TIKTOK_ONLY }, ALL, { APIFY_TOKEN: 't' }]) {
    const registry = resolvePlatforms(env, runtime);
    const named = [...ids(registry.all()), ...darkIds(registry.absent())].sort();
    assert.deepEqual(named, [...KNOWN_SOURCES].sort());
  }
});
