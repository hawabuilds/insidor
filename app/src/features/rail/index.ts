/**
 * The rail's surface to the rest of the app: one component, and deliberately nothing else.
 *
 * ★ THE ASYMMETRY WITH pairs/ AND sources/ IS THE DECISION HERE. Those two barrels publish
 * their view functions and their `POLL_MS`; this one publishes neither, though `railView`,
 * `LAUNCH_FEED_ID` and `POLL_MS` all exist next door in launches.ts. They are not published
 * because nothing outside this folder needs them — launches.test.ts imports launches.ts
 * directly, which is inside the folder and therefore allowed — and publishing a decision
 * layer nobody asked for is how the shell starts owning the rail's polling cadence or
 * assembling its own launch row.
 *
 * That would undo the argument LiveRail.tsx makes at length: every decision lives in
 * launches.ts so that it is reachable from a test, because this runner has no DOM and a
 * `.tsx` cannot be imported by a test at all. A decision that migrates outward into
 * `App.tsx` is a decision that has left the only place it can be asserted.
 *
 * Features import each other only through these barrels — a dependency rule, not a
 * convention. What it buys, concretely: `App.tsx` knows the rail as one element it places
 * in a grid column, so the rail can be rewritten without the shell being opened.
 */

export { LiveRail } from './LiveRail.tsx';
