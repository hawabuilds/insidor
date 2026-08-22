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
 * Types come from @insidor/contracts, with one exception noted below. Nothing else is
 * re-exported from here, so there is exactly one place any type in this system is
 * named.
 *
 * ★ AND THEN RANK MADE IT TWELVE, WHICH IS A DECISION RATHER THAN A DRIFT — so it is
 * argued here instead of appearing in a diff as three more lines.
 *
 * The rule above is "everything else is a helper that one of these calls". RANK
 * breaks it, because RANK is three public things and none of them calls another:
 *
 *   rank()          scores ONE subject against ONE incumbent and writes the row.
 *   commitBoard()   takes the whole tick's scores and produces the committed order.
 *   kendallTau()    says how much that order moved since the last tick.
 *
 * The first two are split by rank/heat.ts's candidate isolation, which is a product
 * requirement: a score that could see another candidate would make a past board
 * impossible to reproduce, so the board transition cannot live inside a per-subject
 * stage. It cannot live outside core either — it is the ordering the product ships,
 * and it is the one thing here a client is structurally forbidden from recomputing.
 * The third is a measurement of OUR OWN behaviour rather than of the world, which is
 * exactly why it is core's to compute, the decision log's to hold, and no screen's to
 * render; see rank/stability.ts.
 *
 * `BoardSlot` and `TickScore` come with them, and they are the stated exception to
 * "types come from contracts". They are core's own: a bench row is not a noun the
 * rest of the system knows about, and a caller cannot feed a tick in without them.
 *
 * The wide feature builders are NOT here, deliberately. Each is called at the moment
 * of the decision whose row it rides on, by that stage's own wiring, and a service
 * reaching for `itemFeatures` directly is a service about to write a vector that no
 * decision was ever made against.
 */

export { decide } from './decide.ts';

export { admit } from './admit/stage.ts';
export { track } from './track/stage.ts';
export { detect } from './detect/stage.ts';
export { group } from './group/stage.ts';
export { qualify } from './qualify/stage.ts';
export { resolve } from './resolve/stage.ts';
export { rank } from './rank/stage.ts';

export { commitBoard, committed } from './rank/hysteresis.ts';
export type { BoardSlot, TickScore } from './rank/hysteresis.ts';
export { kendallTau, stabilityState } from './rank/stability.ts';

/**
 * ★ AND THEN THIRTEEN, for a function that decides no verdict and writes no row —
 * so it is argued here rather than appearing in a diff as one more line.
 *
 * `sourceState` is not a stage. It answers "is this source live, dormant or
 * failing", which is a fact about OUR OWN machinery rather than about the world,
 * and by the rule stated for `kendallTau` above that is exactly the kind of thing
 * core computes and no screen re-derives. It is here for the reason everything
 * else here is here: it turns on two thresholds, and a threshold typed into the
 * process that displays it is a threshold nobody can find later.
 *
 * It has two callers with nothing else in common — the process that CALLS the
 * sources, which needs to know whether it is running on nothing, and the process
 * that DRAWS them. Neither may hold its own copy of the rule: two spellings of a
 * three-way call drift, and they drift toward `live`, because that is the branch
 * nobody notices being wrong.
 */
export { liveCount, sourceState } from './sources/state.ts';
