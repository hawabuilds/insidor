/**
 * The source indicator's surface. Features import each other only through these barrels.
 *
 * Three names reach the shell, and the split between them is the design: `useSourceHealth`
 * owns the one frame, and the two components are two renderings of it in two places in the
 * DOM. The shell holds no state of its own about this and makes no decision about it — it
 * puts one element in the nav and one under it.
 */

export { SourceBanner, SourceStatus, useSourceHealth } from './SourceStatus.tsx';
export { POLL_MS, SHAPE_OF, SOURCE_VIEW_ID, sourceNotice, sourcePips, sourcesView } from './sources.ts';
export type {
  PipShape,
  SourceNote,
  SourceNotice,
  SourcePip,
  SourcesInput,
  SourcesView,
} from './sources.ts';
