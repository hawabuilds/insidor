/**
 * The only dispatch in the platform layer, and the one place that turns an
 * environment into a set of sources we can actually call.
 *
 * Adding a source is one entry in BUILDERS and one field in PlatformDeps —
 * nothing else in the repository changes, which is the claim this file exists to
 * keep true. Its credential declaration, its client and its translation all live
 * in its own package; this file knows only that every source HAS those things.
 *
 * ── ★ THE PROPERTY THIS FILE WAS REWRITTEN TO ESTABLISH ────────────────────
 *
 * CONSTRUCTION IS TOTAL AND NEVER THROWS FOR A MISSING CREDENTIAL.
 *
 * It used to be total in the other direction: `platformRegistry` took a bag with
 * every source's deps present, built all of them eagerly, and had no way to say
 * "two of three are configured". So the only way to run without a credential was
 * not to call it, and the only way to report one missing was to throw — which
 * makes "nobody turned this on" arrive at the caller in the same shape as "this
 * is broken".
 *
 * Those two demand opposite responses. The first is a person deciding to pay for
 * something, on their own schedule, and is not a fault. The second is a retry, or
 * somebody being woken up. Collapsing them is how a permanently unconfigured
 * source spends a quarter looking like an intermittently flaky one — the exact
 * argument `RedditNotConfigured` already makes for one source, made here for all
 * of them and made structural: an absence is a VALUE on the way out, listed by
 * `absent()`, with the reason attached, because the caller's job is to display it.
 *
 * ── ★ AND A CONSTRUCTOR THAT THROWS IS CAUGHT, NOT PROPAGATED ──────────────
 *
 * Some clients validate their credentials at construction and are right to: the
 * reddit client refuses a spoofed user agent there, because discovering that rule
 * as a ban three weeks later is far worse. But a throw from ONE source's
 * constructor must not take the other two down with it. Zero live sources is a
 * legitimate state; a process that will not boot because one key is malformed is
 * not, and it is precisely the failure mode that makes people stop adding
 * sources. So every build runs inside a `try`, and a throw becomes
 * `misconfigured` — the same state a half-filled environment reaches by the other
 * road, carrying the constructor's own message as the reason.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
 *
 * The replay source is not registered. It is a source with no network,
 * constructed directly by eval and by tests from a tape; putting it here would
 * make it one config line away from serving real decisions off a recording.
 *
 * And no source's HEALTH is here. Whether a configured source is actually
 * answering is a fact about calls that have been made, it lives in the store, and
 * it changes every minute — this file answers a different question, asked once at
 * boot: what did the environment say. Merging the two would make a registry that
 * has to be rebuilt whenever a vendor has a bad afternoon.
 */

import type { Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { SourceId } from '@insidor/contracts/ids.ts';
import { readCredentials } from '@insidor/vendor-kit';
import type { CredentialCheck, CredentialEnv, CredentialSpec, CredentialValues } from '@insidor/vendor-kit';

import {
  CREDENTIALS as REDDIT_CREDENTIALS,
  clientConfig as redditClientConfig,
  httpClient as redditHttpClient,
  redditPlatform,
} from '@insidor/platform-reddit';
import type { RedditAdapterDeps } from '@insidor/platform-reddit';
import {
  CREDENTIALS as TIKTOK_CREDENTIALS,
  SOURCE as TIKTOK_SOURCE,
  clientConfig as tiktokClientConfig,
  httpClient as tiktokHttpClient,
  tiktokPlatform,
} from '@insidor/platform-tiktok';
import type { TikTokAdapterDeps } from '@insidor/platform-tiktok';
import {
  CREDENTIALS as X_CREDENTIALS,
  clientConfig as xClientConfig,
  httpClient as xHttpClient,
  xPlatform,
} from '@insidor/platform-x';
import type { XAdapterDeps } from '@insidor/platform-x';

/* ── what a source is supplied with, or why it is not ─────────────────── */

/**
 * One source's deps, or the reason there are none.
 *
 * ★ THREE MEMBERS AND NOT `D | null`, because a null says a source is absent and
 * says nothing about why — and "why" is the entire product requirement above this
 * layer. A caller holding nulls can render three dark pips and cannot tell the
 * reader which of them is somebody's decision and which is somebody's mistake.
 *
 * It is also not optional-and-omitted. Under `exactOptionalPropertyTypes` an
 * omitted field and an explicitly-undefined one are different types, and more to
 * the point silence has to be CHOSEN: a caller that forgets a source should fail
 * to typecheck, not quietly ship a pipeline missing an input. Same argument as
 * `capabilities.absent` being required, and as HEARTBEAT having to be `off`
 * rather than merely unset.
 */
export type SourceSupply<D> =
  | { readonly kind: 'configured'; readonly deps: D }
  | { readonly kind: 'dormant'; readonly missing: readonly string[] }
  | { readonly kind: 'misconfigured'; readonly problems: readonly string[] };

/**
 * Deps are per source and deliberately not unified: one source needs a handle
 * lookup to build a URL, another needs an API key, a third needs neither. A single
 * shared dependency bag would grow a field for every source and every source would
 * have to ignore most of it.
 */
export interface PlatformDeps {
  readonly x: SourceSupply<XAdapterDeps>;
  readonly tiktok: SourceSupply<TikTokAdapterDeps>;
  /**
   * The first source here whose client actually makes the request rather than
   * describing it. Its deps are the same three as the others' — a client, the
   * meter and an injected clock — because whether a client is real or a stub is
   * not a fact this file is entitled to know.
   */
  readonly reddit: SourceSupply<RedditAdapterDeps>;
}

/* ── the non-credential half of what a source needs ───────────────────── */

/**
 * Everything a source needs that does NOT come out of the environment.
 *
 * This bag is shared where the deps above are not, and the difference is the test
 * for whether something belongs in it: a clock, a meter and a `fetch` are needed
 * by every source in the same shape, and no source has to ignore any of them.
 *
 * `handles` is the edge case and is keyed by source for exactly that reason. Some
 * sources address a post by URL rather than by id, so re-reading one needs the
 * author's handle — which only the caller can look up, because it lives in the
 * store. Keying it by source keeps it a shared CAPABILITY rather than one source's
 * field leaking into everybody's bag: a second URL-addressed source uses the same
 * function, and the sources that do not need it simply never call it.
 */
export interface PlatformRuntime {
  readonly meter: Meter;
  /** Injected so a recorded run replays to the same Items. Never `Date.now`. */
  readonly now: () => Millis;
  /** Injected so a unit test cannot reach the network, ever, by construction. */
  readonly fetch: typeof globalThis.fetch;
  /**
   * The author handle for one of our ids, or null when we do not hold one. An
   * absent handle means that post is skipped rather than guessed: a wrong URL
   * costs a paid run and returns nothing.
   */
  readonly handles: (source: SourceId, sourceItemId: string) => string | null;
}

/* ── the sources ──────────────────────────────────────────────────────── */

interface SourceBuilder {
  /** What this source needs from the environment. Declared in its own package. */
  readonly spec: CredentialSpec;
  /** Deps from resolved values. May throw; every caller builds inside a try. */
  readonly deps: (values: CredentialValues, runtime: PlatformRuntime) => unknown;
  /**
   * The adapter from deps. Split from `deps` so a caller holding PRE-BUILT deps —
   * the conformance suite, whose every client throws — enters at the second step
   * and never touches an environment.
   */
  readonly build: (deps: never) => PlatformAdapter;
}

const BUILDERS = {
  x: {
    spec: X_CREDENTIALS,
    deps: (values: CredentialValues, runtime: PlatformRuntime): XAdapterDeps => ({
      client: xHttpClient(xClientConfig(values, runtime)),
      meter: runtime.meter,
      now: runtime.now,
    }),
    build: (deps: XAdapterDeps) => xPlatform(deps),
  },
  tiktok: {
    spec: TIKTOK_CREDENTIALS,
    deps: (values: CredentialValues, runtime: PlatformRuntime): TikTokAdapterDeps => ({
      client: tiktokHttpClient(tiktokClientConfig(values, runtime)),
      meter: runtime.meter,
      now: runtime.now,
      handleOf: (sourceItemId) => runtime.handles(TIKTOK_SOURCE, sourceItemId),
    }),
    build: (deps: TikTokAdapterDeps) => tiktokPlatform(deps),
  },
  reddit: {
    spec: REDDIT_CREDENTIALS,
    deps: (values: CredentialValues, runtime: PlatformRuntime): RedditAdapterDeps => ({
      client: redditHttpClient(redditClientConfig(values, runtime)),
      meter: runtime.meter,
      now: runtime.now,
    }),
    build: (deps: RedditAdapterDeps) => redditPlatform(deps),
  },
} as const satisfies Readonly<Record<string, SourceBuilder>>;

export type KnownSource = keyof typeof BUILDERS;

export const KNOWN_SOURCES = Object.keys(BUILDERS) as readonly KnownSource[];

/* ── errors: two of them, because they are two different mistakes ─────── */

export class UnknownSource extends Error {
  readonly source: string;

  constructor(source: string) {
    super(`no adapter registered for source '${source}' — add it to adapters/platform/registry`);
    this.name = 'UnknownSource';
    this.source = source;
  }
}

/**
 * Asked for a source that IS registered and is not configured.
 *
 * Distinct from `UnknownSource` because the answers differ completely: an unknown
 * source is a typo or a stale row, a dark one is a credential somebody has to
 * supply. It carries the configuration verdict and the detail so a caller failing
 * closed can say which — and so nobody has to parse this message to find out.
 */
export class SourceNotLive extends Error {
  readonly source: string;
  readonly configuration: 'dormant' | 'misconfigured';
  readonly detail: readonly string[];

  constructor(source: string, configuration: 'dormant' | 'misconfigured', detail: readonly string[]) {
    super(
      configuration === 'dormant'
        ? `source '${source}' is not configured; nothing was supplied for: ${detail.join(', ')}`
        : `source '${source}' is configured incorrectly: ${detail.join('; ')}`,
    );
    this.name = 'SourceNotLive';
    this.source = source;
    this.configuration = configuration;
    this.detail = detail;
  }
}

/* ── the registry ─────────────────────────────────────────────────────── */

/**
 * A source that could not be built, and why.
 *
 * `configuration` is the machine-readable half and the ONLY half anything should
 * branch on. `detail` is variable names and vendor messages — operator-facing text
 * that names environment variables, so it belongs in a log and never on a screen
 * without going through something that rewrites it.
 */
export interface SourceAbsence {
  readonly source: KnownSource;
  readonly configuration: 'dormant' | 'misconfigured';
  readonly detail: readonly string[];
}

export interface PlatformRegistry {
  /** Throws `SourceNotLive` for a dark source and `UnknownSource` for a typo. */
  readonly get: (source: SourceId) => PlatformAdapter;
  /**
   * ★ ONLY THE LIVE ONES, and the emptiness of this list is a legitimate answer.
   * A caller iterating it works identically with one source and with three; that
   * is the whole degradation story, and it is the reason this returns adapters
   * rather than a map keyed by every known source with holes in it.
   */
  readonly all: () => readonly PlatformAdapter[];
  readonly has: (source: SourceId) => boolean;
  /** Every source that is NOT live, with the reason. Never empty by accident. */
  readonly absent: () => readonly SourceAbsence[];
}

/**
 * Build one source, catching whatever its constructor decides to throw.
 *
 * ★ THE `catch` IS THE POINT. A client that validates its credentials at
 * construction is doing the right thing, and its throw still must not be able to
 * stop the process — one malformed key would otherwise take down two sources that
 * were fine. The throw becomes a misconfiguration carrying the constructor's own
 * message, which is the same state a half-filled environment reaches by the other
 * road, so downstream there is exactly one shape to handle.
 */
type Resolution =
  | { readonly kind: 'live'; readonly adapter: PlatformAdapter }
  | { readonly kind: 'absent'; readonly absence: SourceAbsence };

const absent = (
  source: KnownSource,
  configuration: 'dormant' | 'misconfigured',
  detail: readonly string[],
): Resolution => ({ kind: 'absent', absence: { source, configuration, detail } });

function attempt(source: KnownSource, make: () => PlatformAdapter): Resolution {
  let adapter: PlatformAdapter;
  try {
    adapter = make();
  } catch (e) {
    return absent(source, 'misconfigured', [e instanceof Error ? e.message : String(e)]);
  }
  // An adapter whose id disagrees with its registry key would be reachable under
  // one name and log under another. Caught here, once, and reported as a
  // misconfiguration rather than thrown: it is our bug, but it is still one dark
  // source and not a dead process.
  if (String(adapter.id) !== source) {
    return absent(source, 'misconfigured', [
      `'${source}' builds an adapter whose id is '${String(adapter.id)}'`,
    ]);
  }
  return { kind: 'live', adapter };
}

function assemble(results: ReadonlyMap<KnownSource, Resolution>): PlatformRegistry {
  const live = new Map<string, PlatformAdapter>();
  const dark: SourceAbsence[] = [];

  /* Iterated over KNOWN_SOURCES rather than over the map, so the order of both
     lists is the declaration order and not insertion order. A caller rendering
     pips wants the same order on every frame; an order that changed when a source
     went dark would move the pip under the reader's cursor. */
  for (const source of KNOWN_SOURCES) {
    const result = results.get(source);
    if (result === undefined) continue;
    if (result.kind === 'absent') dark.push(result.absence);
    else live.set(source, result.adapter);
  }

  return {
    get: (source) => {
      const adapter = live.get(String(source));
      if (adapter !== undefined) return adapter;
      const absence = dark.find((a) => a.source === String(source));
      if (absence !== undefined) {
        throw new SourceNotLive(absence.source, absence.configuration, absence.detail);
      }
      throw new UnknownSource(String(source));
    },
    all: () => [...live.values()],
    has: (source) => live.has(String(source)),
    absent: () => [...dark],
  };
}

/**
 * Build from deps a caller already holds.
 *
 * The entry point for anything that constructs its own clients — the conformance
 * suite does, with every client replaced by one that throws, which is what lets it
 * exercise the capability declarations and the translation layer without a socket.
 * Production does not come through here; see `resolvePlatforms`.
 */
export function platformRegistry(deps: PlatformDeps): PlatformRegistry {
  const results = new Map<KnownSource, Resolution>();

  for (const source of KNOWN_SOURCES) {
    const supply: SourceSupply<unknown> = deps[source];
    if (supply.kind === 'dormant') {
      results.set(source, absent(source, 'dormant', supply.missing));
      continue;
    }
    if (supply.kind === 'misconfigured') {
      results.set(source, absent(source, 'misconfigured', supply.problems));
      continue;
    }
    /* `build` is typed against its own source's deps, and `supply.deps` is that
       matching type by construction of PlatformDeps. This is the one place the
       per-source shapes meet a loop that walks all of them; it is sound because
       BUILDERS and PlatformDeps are keyed by the same union, which the `satisfies`
       above and this file's tests both hold to. */
    const builder = BUILDERS[source] as unknown as { build: (deps: unknown) => PlatformAdapter };
    results.set(source, attempt(source, () => builder.build(supply.deps)));
  }

  return assemble(results);
}

/**
 * ★ THE PRODUCTION ENTRY POINT: an environment in, a live set out.
 *
 * Given the environment, it returns the sources that are constructible AND the ones
 * that are not, with the reason — which is what makes activation a configuration
 * change and nothing else. Adding a credential to the environment turns a source on
 * at the next boot; removing it turns the source off just as cleanly, and neither
 * is a code change, a redeploy of anything but config, or a line in this file.
 *
 * It never throws. Every failure a source can have at this stage — nothing
 * supplied, half supplied, a constructor that refused — comes back inside the
 * registry as an absence with a reason, because the caller's job is to display it
 * rather than to survive it.
 */
export function resolvePlatforms(env: CredentialEnv, runtime: PlatformRuntime): PlatformRegistry {
  const results = new Map<KnownSource, Resolution>();

  for (const source of KNOWN_SOURCES) {
    const builder = BUILDERS[source] as unknown as SourceBuilder;
    const check: CredentialCheck = readCredentials(builder.spec, env);

    if (check.kind === 'dormant') {
      results.set(source, absent(source, 'dormant', check.missing));
      continue;
    }
    if (check.kind === 'misconfigured') {
      results.set(source, absent(source, 'misconfigured', check.problems));
      continue;
    }

    /* Deps and adapter are built inside ONE attempt, because a client constructor
       that validates its credentials — reddit's does — throws here rather than at
       `build`, and both throws mean the same thing to a reader: this source was
       configured and cannot be used. */
    const values = check.values;
    results.set(
      source,
      attempt(source, () => {
        const deps = builder.deps(values, runtime) as never;
        return builder.build(deps);
      }),
    );
  }

  return assemble(results);
}

/**
 * What each source would need, for a caller that wants to offer help rather than
 * only report a state. Read-only, derived from the same declarations the resolution
 * uses, so it cannot describe a different set of variables from the one that is
 * actually checked.
 */
export const credentialSpecs = (): Readonly<Record<KnownSource, CredentialSpec>> => {
  const out: Partial<Record<KnownSource, CredentialSpec>> = {};
  for (const source of KNOWN_SOURCES) out[source] = BUILDERS[source].spec;
  return out as Readonly<Record<KnownSource, CredentialSpec>>;
};
