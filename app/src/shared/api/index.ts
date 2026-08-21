/**
 * The read layer's public surface — the one barrel in this package.
 *
 * Narrow on purpose. A barrel listing twenty names is a table of contents; a barrel
 * re-exporting two hundred is fog, and it is how import cycles get created without anyone
 * choosing one. Features import from here; nothing imports a decoder directly.
 */

export type { BoardRow, BoardTick, RowPatch, Spark, SparkPoint, Tone } from './wire/board.ts';
export type { Coin, CoinLink, MarketCapBasis } from './wire/coin.ts';
export type { FeedSource, Launch, LaunchFeed } from './wire/launch.ts';
export type { Pair, PairFeed, PairHead, PairListing } from './wire/pair.ts';
export type { Story, Evidence, DiscussionPost } from './wire/story.ts';
export type { TradeQuote, TradeCost, TradeIntent, TradeResult } from './wire/trade.ts';

export type { BoardMeta, BoardStore, LinkState } from './live/boardStore.ts';
export { createBoardStore } from './live/boardStore.ts';
export { createLiveHandlers } from './live/wiring.ts';
export { useFreezeWhileInteracting } from './live/freeze.ts';
export {
  BoardStoreProvider,
  useBoardMeta,
  useBoardOrder,
  useBoardRow,
  useBoardStore,
} from './live/useBoard.ts';

export {
  ReadError,
  USING_FIXTURES,
  fetchBoard,
  fetchLaunches,
  fetchPairs,
  fetchQuote,
  fetchStory,
  openLiveChannel,
  submitTrade,
} from './client.ts';
export type { LiveChannel, LiveHandlers } from './client.ts';

/* The two failure types, so a screen can tell a bad payload from a bad connection.
   ★ THE DECODERS THEMSELVES ARE NO LONGER EXPORTED. They were, because the live wiring needed
   them and a socket payload does not arrive through `client.ts` — that wiring now lives in
   `live/wiring.ts`, inside this directory, and imports them directly. So the last reason for
   a feature to hold a decoder is gone, and with it the last way for one to construct a wire
   object by hand and skip the censor. */
export { WireLeakError, WireShapeError } from './decode.ts';
