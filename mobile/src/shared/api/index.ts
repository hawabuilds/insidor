/**
 * The phone app's read layer, as one barrel. Features import from here and nothing imports a
 * decoder directly, so there is no way to build a wire object by hand and skip the censor.
 */

export type { BoardProvenance, BoardRow, BoardTick, Spark, SparkPoint, Tone } from './wire/board.ts';
export type { Coin, CoinEvidence, CoinLink, PostCoinLink } from './wire/coin.ts';
export type { Candle, CoinMarket, MarketTimeframe, MarketTrade } from './wire/market.ts';
export type { DiscussionPost, Evidence, NarrativeStage, NarrativesList, Story, StoryProvenance } from './wire/story.ts';
export type { OlderCoin, RisingFeed, RisingFeedId, RisingPage, RisingPost } from './wire/rising.ts';
export type { LaunchPreview, LaunchRules } from './client.ts';
export type { AboutLink, AboutLinkKind, AboutPost, CoinAbout } from './about.ts';
export type { PostSheetData, SheetCoin, SheetMedia, ViewReading } from './post-sheet.ts';
export type { BuildResult, Holding as TradeHolding, TradeLimits, TradeQuote, TradeVenue } from './wire/trade.ts';
export type { CreatedCoin, Holding, Portfolio, PortfolioRange } from './wire/wallet.ts';
export type { NameIdea, OriginGap, SameNameCoin, SameNameCoins, SearchCoin, TickerUse, SearchCoins, SearchedCoin, SearchNarrative, SearchPost, SearchResults } from './wire/search.ts';

export {
  BOARD_VIEW,
  ReadError,
  fetchBoard,
  fetchCoinAbout,
  fetchCoinMarket,
  fetchPostSheet,
  fetchNarratives,
  fetchRising,
  fetchRisingOlder,
  buildLaunchTx,
  buildTrade,
  confirmLaunch,
  fetchLaunchRules,
  fetchTickerSeen,
  imageAsDataUrl,
  previewLaunch,
  buildTransfer,
  fetchPortfolio,
  fetchWalletHistory,
  fetchHolding,
  fetchSearch,
  fetchTradeQuote,
  fetchTradeVenue,
  sendSigned,
  fetchSearchedCoin,
  fetchPostCoins,
  fetchPostNames,
  fetchTickerCoins,
  fetchStory,
  submitTrade,
} from './client.ts';

export { WireLeakError, WireShapeError } from './decode.ts';
