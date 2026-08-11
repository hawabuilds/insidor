/**
 * The only dispatch in the platform layer. Adding a source is one line in
 * BUILDERS and one field in PlatformDeps — and nothing else in the repository
 * changes, which is the claim this file exists to keep true.
 *
 * Deps are per source and deliberately not unified: one source needs a handle
 * lookup to build a URL, another needs an API key, a third needs neither. A
 * single shared dependency bag would grow a field for every source and every
 * source would have to ignore most of it.
 *
 * The replay source is NOT registered here. It is a source with no network,
 * constructed directly by eval and by tests from a tape; putting it in the
 * production registry would make it one config line away from serving real
 * decisions off a recording.
 */

import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { SourceId } from '@insidor/contracts/ids.ts';
import { tiktokPlatform } from '@insidor/platform-tiktok';
import type { TikTokAdapterDeps } from '@insidor/platform-tiktok';
import { xPlatform } from '@insidor/platform-x';
import type { XAdapterDeps } from '@insidor/platform-x';

export interface PlatformDeps {
  readonly x: XAdapterDeps;
  readonly tiktok: TikTokAdapterDeps;
}

const BUILDERS = {
  x: (d: PlatformDeps) => xPlatform(d.x),
  tiktok: (d: PlatformDeps) => tiktokPlatform(d.tiktok),
} as const;

export type KnownSource = keyof typeof BUILDERS;

export const KNOWN_SOURCES = Object.keys(BUILDERS) as readonly KnownSource[];

export class UnknownSource extends Error {
  readonly source: string;

  constructor(source: string) {
    super(`no adapter registered for source '${source}' — add it to adapters/platform/registry`);
    this.name = 'UnknownSource';
    this.source = source;
  }
}

export interface PlatformRegistry {
  readonly get: (source: SourceId) => PlatformAdapter;
  readonly all: () => readonly PlatformAdapter[];
  readonly has: (source: SourceId) => boolean;
}

export function platformRegistry(deps: PlatformDeps): PlatformRegistry {
  const built = new Map<string, PlatformAdapter>();
  for (const key of KNOWN_SOURCES) {
    const adapter = BUILDERS[key](deps);
    // An adapter whose id disagrees with its registry key would be reachable
    // under one name and log under another. Caught at construction, once.
    if (adapter.id !== key) {
      throw new Error(`platform registry: '${key}' builds an adapter whose id is '${adapter.id}'`);
    }
    built.set(key, adapter);
  }

  return {
    get: (source) => {
      const adapter = built.get(source);
      if (adapter === undefined) throw new UnknownSource(String(source));
      return adapter;
    },
    all: () => [...built.values()],
    has: (source) => built.has(source),
  };
}
