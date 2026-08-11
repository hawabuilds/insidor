/**
 * The only dispatch in the venue layer. Adding a venue is one line in BUILDERS
 * and one field in VenueDeps.
 *
 * There are already two venues on one chain, and they differ more from each
 * other than either would from its counterpart on another chain: one is a
 * bonding curve with no reserve and a local price function, the other is a
 * pooled market read from an aggregator. That is the whole argument for the
 * venue layer, and it is visible in this file rather than argued for in a
 * document.
 *
 * `enabled` is honoured here: a broken venue is disabled, not deleted, and it
 * keeps answering `get()` so historical rows still resolve while `usable()`
 * stops routing new work to it.
 */

import type { VenueId } from '@insidor/contracts/ids.ts';
import type { Venue, VenueCapability } from '@insidor/contracts/ports/venue.ts';
import { dexscreenerVenue } from '@insidor/market-dexscreener';
import type { MarketVenueDeps } from '@insidor/market-dexscreener';
import { pumpfunVenue } from '@insidor/venue-solana-pumpfun';
import type { PumpfunVenueDeps } from '@insidor/venue-solana-pumpfun';

export interface VenueDeps {
  readonly pumpfun: PumpfunVenueDeps;
  readonly pool: MarketVenueDeps;
}

const BUILDERS = {
  'solana:pumpfun': (d: VenueDeps) => pumpfunVenue(d.pumpfun),
  'solana:pool': (d: VenueDeps) => dexscreenerVenue(d.pool),
} as const;

export type KnownVenue = keyof typeof BUILDERS;

export const KNOWN_VENUES = Object.keys(BUILDERS) as readonly KnownVenue[];

export class UnknownVenue extends Error {
  readonly venue: string;

  constructor(venue: string) {
    super(`no adapter registered for venue '${venue}' — add it to adapters/venue/registry`);
    this.name = 'UnknownVenue';
    this.venue = venue;
  }
}

export interface VenueRegistry {
  readonly get: (id: VenueId) => Venue;
  readonly all: () => readonly Venue[];
  /** Enabled venues only. New work routes through this, never through all(). */
  readonly usable: () => readonly Venue[];
  /** Venues that declare a capability AND carry its implementation. */
  readonly withCapability: (capability: VenueCapability) => readonly Venue[];
}

export function venueRegistry(deps: VenueDeps): VenueRegistry {
  const built = new Map<string, Venue>();
  for (const key of KNOWN_VENUES) {
    const venue = BUILDERS[key](deps);
    // A venue whose id disagrees with its registry key would be reachable under
    // one name and log under another. Caught at construction, once.
    if (String(venue.id) !== key) {
      throw new Error(`venue registry: '${key}' builds a venue whose id is '${String(venue.id)}'`);
    }
    built.set(key, venue);
  }

  const all = (): readonly Venue[] => [...built.values()];

  return {
    get: (id) => {
      const venue = built.get(String(id));
      if (venue === undefined) throw new UnknownVenue(String(id));
      return venue;
    },
    all,
    usable: () => all().filter((v) => v.enabled),
    withCapability: (capability) => all().filter((v) => v.enabled && v.capabilities.includes(capability)),
  };
}
