/**
 * The public surface of the logic: seven stages and the constructor they all return.
 *
 * EIGHT NAMES, and the number is the point. A barrel listing eight names is a table
 * of contents; a barrel re-exporting two hundred is fog, and it is how import cycles
 * get created without anyone choosing one. Everything else in this package is a
 * helper that one of these eight calls, and a service that needs a helper directly is
 * a service doing something core should be doing.
 *
 * Every one of these is synchronous, and that is a guarantee rather than a style: a
 * function typed to return a Decision rather than a promise of one cannot suspend,
 * so it cannot fetch, cannot query, cannot call a hosted model, and cannot quietly
 * recompute a feature from data fresher than the vector it logged. Replaying any past
 * decision under a new policy therefore needs no network, no key and no clock — which
 * is what makes the whole learning plan possible.
 *
 * Types come from @insidor/contracts. Nothing is re-exported from here, so there is
 * exactly one place any type in this system is named.
 */

export { decide } from './decide.ts';

export { admit } from './admit/stage.ts';
export { track } from './track/stage.ts';
export { detect } from './detect/stage.ts';
export { group } from './group/stage.ts';
export { qualify } from './qualify/stage.ts';
export { resolve } from './resolve/stage.ts';
export { rank } from './rank/stage.ts';
