/**
 * The public surface of `@insidor/adapter-conformance`: the two suites, the case
 * shapes they take, and the no-network dependencies an adapter needs to be
 * constructed at all.
 *
 * ★ THE ARROWS POINT ONE WAY, AND THIS BARREL IS THE REASON THEY CAN. This
 * package depends on every adapter in the repository — its package.json names
 * each one, which is what lets `all.test.ts` run the suite over the whole
 * registry. So no adapter may depend on it back. That is why an adapter publishes
 * its samples as a plain `conformance` object instead of importing `PlatformCase`
 * from here, and why nothing in this file is ever imported by the packages it
 * tests. Add one such import and the cycle is real, at which point the fix is a
 * refactor of two packages rather than a deletion of one line.
 *
 * The stubs are exported for the same reason the suites are. An adapter cannot be
 * built without a Meter, a budget and a clock, and if each conformance run brings
 * its own the suite stops comparing like with like: an adapter held to a
 * permissive budget and a moving clock has passed a different contract from its
 * neighbours while appearing on the same report as them.
 */

export { runPlatformContract } from './platform.contract.ts';
export type { PlatformCase } from './platform.contract.ts';
export { runVenueContract } from './venue.contract.ts';
export type { VenueCase } from './venue.contract.ts';
export { platformDeps, venueDeps, meter, now, budget } from './stubs.ts';
