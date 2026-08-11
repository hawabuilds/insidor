/** The conformance suites, exported so any new adapter can be held to them. */

export { runPlatformContract } from './platform.contract.ts';
export type { PlatformCase } from './platform.contract.ts';
export { runVenueContract } from './venue.contract.ts';
export type { VenueCase } from './venue.contract.ts';
export { platformDeps, venueDeps, meter, now, budget } from './stubs.ts';
