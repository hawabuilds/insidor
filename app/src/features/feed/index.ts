/**
 * The feed's surface to the rest of the app. Cross-feature imports go through this file and
 * never reach inside — that is a dependency rule, not a convention, so a component in
 * `story/` cannot start depending on the shape of a feed cell.
 */

export { BoardProvenanceBanner } from './BoardProvenance.tsx';
export { provenanceNotice } from './board-provenance.ts';
export type { ProvenanceNotice } from './board-provenance.ts';
export { Feed } from './Feed.tsx';
export type { FeedProps } from './Feed.tsx';
export { actionFor, actionLabel, rowAction } from './row-action.ts';
export type { BuyAction, CompareAction, CreateAction, NoAction, RowAction } from './row-action.ts';
