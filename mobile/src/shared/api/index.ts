/**
 * The phone app's read layer, as one barrel. Features import from here and nothing imports a
 * decoder directly, so there is no way to build a wire object by hand and skip the censor.
 */

export type { BoardProvenance, BoardRow, BoardTick, Spark, SparkPoint, Tone } from './wire/board.ts';
export type { Coin, CoinEvidence, CoinLink, PostCoinLink } from './wire/coin.ts';
export type { Candle, CoinMarket, MarketPair, MarketTimeframe, MarketTrade, PairToken } from './wire/market.ts';
export type { DiscussionPost, Evidence, InWindow, NarrativeStage, NarrativesList, NarrativesPage, PostViews, Story, StoryProvenance, ViewsGained } from './wire/story.ts';
export type { OlderCoin, PostSortBy, PostSortWindow, PostSpeeds, RisingFeed, RisingFeedId, RisingPage, RisingPost, RisingSorted } from './wire/rising.ts';
export type { LaunchPreview, LaunchRules, NarrativeListSort } from './client.ts';
export type { AboutLink, AboutLinkKind, AboutPost, CoinAbout } from './about.ts';
export type { PostSheetData, SheetCoin, SheetMedia, ViewReading } from './post-sheet.ts';
export type { StoryMember, StorySheet } from './story-sheet.ts';
export type { BuildResult, Holding as TradeHolding, TradeLimits, TradeQuote, TradeVenue } from './wire/trade.ts';
export type { CreatedCoin, Gain, Holding, Portfolio, PortfolioRange } from './wire/wallet.ts';
export type { Catches, CatchStat, CatchWhy } from './catches.ts';
export type { RunningCoin } from './running.ts';
export type { NameIdea, OriginGap, SameNameCoin, SameNameCoins, SearchCoin, TickerUse, SearchCoins, SearchedCoin, SearchNarrative, SearchPost, SearchResults } from './wire/search.ts';

export {
  BOARD_VIEW,
  ReadError,
  fetchBoard,
  fetchCoinAbout,
  fetchCoinMarket,
  fetchPostSheet,
  fetchNarratives,
  fetchAllNarratives,
  fetchRising,
  fetchRisingOlder,
  fetchRisingSorted,
  buildLaunchTx,
  buildTrade,
  confirmLaunch,
  fetchLaunchRules,
  fetchTickerSeen,
  imageAsDataUrl,
  previewLaunch,
  buildTransfer,
  fetchPortfolio,
  fetchCatches,
  fetchRunningCoins,
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
  fetchStoryIfAny,
  fetchStorySheet,
  fetchStoryPosts,
  submitTrade,
} from './client.ts';

export { WireLeakError, WireShapeError } from './decode.ts';
