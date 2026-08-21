/**
 * The pairs screen's surface. One component and the pure view it renders.
 *
 * `pairsView` and `pairRows` are exported for the tests that hold this screen's rules, and
 * for nothing else — `App.tsx` imports the component. Nothing outside this folder constructs
 * a row.
 */

export { Pairs } from './Pairs.tsx';
export { PAIR_FEED_ID, POLL_MS, pairRows, pairsView } from './pairs.ts';
export type { PairNote, PairRow, PairsInput, PairsView } from './pairs.ts';
