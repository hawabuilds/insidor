/**
 * The phone app's read layer, as one barrel. Features import from here and nothing imports a
 * decoder directly, so there is no way to build a wire object by hand and skip the censor.
 */

export type { BoardProvenance, BoardRow, BoardTick, Spark, SparkPoint, Tone } from './wire/board.ts';
export type { Coin, CoinLink } from './wire/coin.ts';
export type { DiscussionPost, Evidence, Story, StoryProvenance } from './wire/story.ts';

export {
  BOARD_VIEW,
  ReadError,
  SAMPLE_SCREENS,
  USING_FIXTURES,
  fetchBoard,
  fetchStory,
  loadSampleNarratives,
  loadSampleStory,
  submitTrade,
} from './client.ts';

export { WireLeakError, WireShapeError } from './decode.ts';
