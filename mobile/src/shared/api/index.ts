/**
 * The phone app's read layer, as one barrel. Features import from here and nothing imports a
 * decoder directly, so there is no way to build a wire object by hand and skip the censor.
 */

export type { BoardProvenance, BoardRow, BoardTick, Spark, SparkPoint, Tone } from './wire/board.ts';
export type { Coin, CoinLink } from './wire/coin.ts';
export type { Candle, CoinMarket, MarketTimeframe, MarketTrade } from './wire/market.ts';
export type { DiscussionPost, Evidence, NarrativesList, Story, StoryProvenance } from './wire/story.ts';
export type { RisingFeed, RisingFeedId, RisingPost } from './wire/rising.ts';
export type { BuildResult, Holding, TradeQuote, TradeVenue } from './wire/trade.ts';
export type { OriginGap, SearchCoin, SearchCoins, SearchedCoin, SearchNarrative, SearchPost, SearchResults } from './wire/search.ts';

export {
  BOARD_VIEW,
  ReadError,
  SAMPLE_SCREENS,
  USING_FIXTURES,
  fetchBoard,
  fetchCoinMarket,
  fetchNarratives,
  fetchRising,
  buildTrade,
  fetchHolding,
  fetchSearch,
  fetchTradeQuote,
  fetchTradeVenue,
  sendSigned,
  fetchSearchedCoin,
  fetchStory,
  loadSampleMarket,
  loadSampleStory,
  submitTrade,
} from './client.ts';

export { WireLeakError, WireShapeError } from './decode.ts';
