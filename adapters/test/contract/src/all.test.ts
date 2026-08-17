/**
 * The suite, run against everything registered.
 *
 * Adding a platform is one line in the platform registry and one line in
 * PLATFORM_SAMPLES below — and the first test in this file fails if you do the
 * first without the second. That is deliberate: a source with no recorded
 * payload is a source whose translation nobody has ever checked, and the defect
 * this whole layer exists to prevent lives exactly there.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { MarketState, TradeQuote } from '@insidor/contracts/asset.ts';
import { platformRegistry } from '@insidor/platform-registry';
import { venueRegistry } from '@insidor/venue-registry';

import { conformance as xConformance } from '@insidor/platform-x/conformance.ts';
import { conformance as tiktokConformance } from '@insidor/platform-tiktok/conformance.ts';
import { conformance as redditConformance } from '@insidor/platform-reddit/conformance.ts';
import { conformance as replayConformance, tape } from '@insidor/platform-replay/conformance.ts';
import { replayPlatform } from '@insidor/platform-replay';
import { conformance as pumpfunConformance } from '@insidor/venue-solana-pumpfun/conformance.ts';
import { conformance as poolConformance } from '@insidor/market-dexscreener/conformance.ts';

import { runPlatformContract } from './platform.contract.ts';
import { runVenueContract } from './venue.contract.ts';
import { now, platformDeps, venueDeps } from './stubs.ts';

const platforms = platformRegistry(platformDeps());
const venues = venueRegistry(venueDeps());

/** One line per source. The registry decides what runs; this decides against what. */
const PLATFORM_SAMPLES = new Map<string, readonly unknown[]>([
  [String(xConformance.source), xConformance.samples],
  [String(tiktokConformance.source), tiktokConformance.samples],
  [String(redditConformance.source), redditConformance.samples],
]);

interface VenueSamples {
  readonly states: readonly MarketState[];
  readonly quotes: readonly TradeQuote[];
}

const VENUE_SAMPLES = new Map<string, VenueSamples>([
  [String(pumpfunConformance.venueId), { states: pumpfunConformance.states, quotes: pumpfunConformance.quotes }],
  [String(poolConformance.venueId), { states: poolConformance.states, quotes: poolConformance.quotes }],
]);

test('every registered platform has recorded payloads to be tested against', () => {
  for (const adapter of platforms.all()) {
    assert.ok(
      PLATFORM_SAMPLES.has(String(adapter.id)),
      `${String(adapter.id)} is registered but ships no conformance samples`,
    );
  }
});

test('every registered venue has a recorded state to be tested against', () => {
  for (const venue of venues.all()) {
    assert.ok(
      VENUE_SAMPLES.has(String(venue.id)),
      `${String(venue.id)} is registered but ships no conformance samples`,
    );
  }
});

for (const adapter of platforms.all()) {
  runPlatformContract({ adapter, samples: PLATFORM_SAMPLES.get(String(adapter.id)) ?? [] });
}

/**
 * The replay source is not in the production registry — a recording must never
 * be one config line away from serving real decisions — so it is constructed
 * here and held to exactly the same contract. It is the second implementation
 * that proves the port is a shape rather than a description of one vendor.
 */
runPlatformContract({
  adapter: replayPlatform(tape, { now }),
  samples: replayConformance.samples,
  label: 'replay',
});

for (const venue of venues.all()) {
  const recorded = VENUE_SAMPLES.get(String(venue.id));
  runVenueContract({
    venue,
    states: recorded?.states ?? [],
    quotes: recorded?.quotes ?? [],
  });
}
