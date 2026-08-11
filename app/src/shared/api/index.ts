/**
 * The read layer's public surface — the one barrel in this package.
 *
 * Narrow on purpose. A barrel listing twenty names is a table of contents; a barrel
 * re-exporting two hundred is fog, and it is how import cycles get created without anyone
 * choosing one. Features import from here; nothing imports a decoder directly.
 */

export type { BoardRow, BoardTick, RowPatch, Spark, SparkPoint, Tone } from './wire/board.ts';
export type { Coin, CoinLink, MarketCapBasis } from './wire/coin.ts';
export type { Story, Evidence, DiscussionPost } from './wire/story.ts';
export type { TradeQuote, TradeCost, TradeIntent, TradeResult } from './wire/trade.ts';

export type { BoardMeta, BoardStore } from './live/boardStore.ts';
export { createBoardStore } from './live/boardStore.ts';
export { useFreezeWhileInteracting } from './live/freeze.ts';
export {
  BoardStoreProvider,
  useBoardMeta,
  useBoardOrder,
  useBoardRow,
  useBoardStore,
} from './live/useBoard.ts';

export { ReadError, fetchBoard, fetchQuote, fetchStory, openLiveChannel, submitTrade } from './client.ts';
export type { LiveChannel, LiveHandlers } from './client.ts';

/* The two decoders the live wiring needs, because a socket payload does not arrive through
   `client.ts`. Everything else in decode.ts stays private to this directory: a feature that
   can decode can also construct, and a hand-constructed wire object skips the censor. */
export { WireLeakError, WireShapeError, decodeBoardTick, decodeRowPatch } from './decode.ts';
