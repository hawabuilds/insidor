/**
 * The composition root: the ONE file that knows the names of other packages.
 *
 * Everything else in this service talks to the small ports declared in
 * `loop.ts` and `run-record.ts`. That is not ceremony — it is what keeps the
 * supervision machinery testable without a database, and it means a change to
 * the store's export names costs one file rather than fifteen.
 *
 * WHY THIS IS A `withRuntime(cfg, log, use)` AND NOT A `buildRuntime` THAT
 * RETURNS: the singleton guard is a SESSION advisory lock, and a session lock
 * lives exactly as long as the client that took it. `withAdvisoryLock` therefore
 * scopes it to a callback, and the only honest way to hold it for the lifetime of
 * the process is to run the process inside that callback. A version that returned
 * a Runtime would have to keep the lock alive by some side channel, and a
 * singleton guard that is subtly not held is worse than none: it reads as held.
 * Failure mode #2 of the build this replaces was two runners draining one claim
 * queue, and it produced double spend with no error anywhere.
 *
 * ★ THE STAGE WORK IS WIRED, AND IT IS WIRED AGAINST THE STORE. Every `pull`
 * below reads rows we already hold; none of them calls a vendor. That is what
 * makes the decision log fillable today rather than on the day the last adapter
 * lands — and `internal.decisions` is one of the two tables SETUP.md says cannot
 * be backfilled, so a day spent waiting for adapters is a day of training data
 * that never existed. Which stage is wired and which still refuses, and the rule
 * that decides, is argued in `work/stages.ts`.
 *
 * THE SEVEN STAGES ARE STILL WIRED AGAINST THE STORE. Their store-backed pulls
 * stand in for observation and the judge; where an input genuinely needs a vendor
 * it arrives as its typed absence and the stage returns the verdict that names
 * the absence. Replacing one with a real adapter changes one `pull` and no other
 * line in this service.
 *
 * ★ THE ADAPTERS ARE NOW IMPORTED — FOR DISCOVERY ONLY, AND THROUGH ONE CALL.
 * `resolvePlatforms` takes the environment slice that config.ts captured at boot
 * and returns the sources that could be built AND the ones that could not, with the
 * reason. It cannot throw for a missing credential, so ZERO LIVE SOURCES BOOTS
 * NORMALLY: the process starts, the health rows say what is dark and why, and the
 * discovery loop runs over an empty set. That is the whole activation story — a
 * credential in the environment is the only thing that turns a source on, and its
 * absence is a displayed state rather than an outage.
 *
 * ★ AND EVERY LIVE ADAPTER IS WRAPPED BEFORE IT LEAVES THIS FILE. `watchedRegistry`
 * is applied here, at the one place a registry is constructed, rather than at each
 * call site — a loop written later would otherwise reach for the unwrapped registry,
 * because that is what the registry function returns, and its calls would work
 * perfectly while the health record said the source had never answered.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { Author, Item, Millis } from '@insidor/contracts';
import type { AssetKey, ItemId } from '@insidor/contracts/ids.ts';
import type { DurableMeter } from '@insidor/meter';
import type { DecisionRepo, SourceHealthRepo } from '@insidor/contracts/ports/store.ts';
import type { AskWith, Policy } from '@insidor/contracts/policy.ts';
import { jobVendorLines, learningDailyCapUsd, supplierRoles, vendorLines } from './vendor-lines.ts';
import { supplierWarnings } from './supplier-warnings.ts';
import { billingAlerts, SUPPLIER_NAMES } from './billing-alerts.ts';
import { languageAlarm } from './language-alarm.ts';
import { diskAlarm } from './disk-alarm.ts';
import { judgeCostAlarm } from './judge-cost-alarm.ts';
import { onOutOfCredit } from '@insidor/vendor-kit';
import { EXAMPLES_RECHECK_MS, learnedJudge } from './learned-examples.ts';
import type { JudgePort } from '@insidor/contracts/ports/judge.ts';
import { LEARN_ENDPOINT_PREFIX, type Meter } from '@insidor/contracts/ports/meter.ts';
import { JudgeNotConfigured, anthropicJudge, type JudgeQuestion, httpClient, priceFor, type JudgeClient } from '@insidor/judge-anthropic';
import { KNOWN_MODELS, OPEN_JUDGE_ENDPOINT, accountCredits, isOpenJudgeId, openChatClient, openJudge, openNamer, openSameSubject, openTitler, openTranslator, type HostModel, type OpenJudgeSetup, type OpenQuestion } from '@insidor/judge-openai-compatible';
import { describeRoles, openHostModel, postJudgeOrder, postsPerCall, rolesFor, sideName, type JudgeRole, type OpenSide } from './feed-judges.ts';
import { failoverJudge, failoverState } from './judge-failover.ts';
import { failoverNamer, failoverSameSubject, failoverTranslator, type SameSubjectPart } from './open-questions.ts';
import { SHADOW_ENDPOINT, judgeShadow } from './judge-shadow.ts';
import { openDurableMeter } from '@insidor/meter';
import { anthropicNamer } from '@insidor/judge-anthropic/name-guess.ts';
import { anthropicTranslator } from '@insidor/judge-anthropic/translate.ts';
import type { NamePort } from '@insidor/contracts/ports/names.ts';
import type { TranslatePort } from '@insidor/contracts/ports/translate.ts';
import { httpClient as voyageClient, voyageEmbed } from '@insidor/embed-voyage';
import { followLink, resolvePlatforms, SECOND_VIDEO_VENDOR, SHORT_LINKS, SUPPLIER_VENDORS, type PlatformRegistry, type PlatformRuntime } from '@insidor/platform-registry';
import {
  DB_ROLE,
  PgAssetRepo,
  PgAuthorRepo,
  PgDecisionRepo,
  PgBackfillRepo,
  PgCoinUniverseRepo,
  PgFinderRepo,
  PgCoinedVideoRepo,
  PgImageHashRepo,
  PgOlderCoinRepo,
  PgCryptoAttentionRepo,
  PgPostRefillRepo,
  PgReadingsRepo,
  PgGonePostRepo,
  PgFeedFloorRepo,
  PgJudgeShadowRepo,
  PgLaneSpendRepo,
  PgImageEmbeddingRepo,
  PgCoinFirstRepo,
  PgOneCoinRepo,
  PgOwnerCoinCallRepo,
  PgMissedRunnerRepo,
  PgImagePairRepo,
  PgJudgementRepo,
  PgLabelEmbeddingRepo,
  PgPostEmbeddingRepo,
  PgJunkFilterRepo,
  PgCoinModelRepo,
  PgNameExampleRepo,
  PgNameGuessRepo,
  PgTranslationRepo,
  PgLearningRepo,
  PgPostJudgementRepo,
  PgItemRepo,
  PgMissedPostRepo,
  PgObservationRepo,
  PgLanguageFindsRepo,
  PgDiskSampleRepo,
  PgOwnerAlertRepo,
  PgSourceHealthRepo,
  PgSpendRepo,
  PgRecallRepo,
  PgStageRunRepo,
  PgStoryRepo,
  PgNarrativeRepo,
  PgQuoteTargetRepo,
  PgWatchAccountRepo,
  asDb,
  createPool,
  withAdvisoryLock,
  withTransaction,
  type Db,
} from '@insidor/store';

import type { RunnerConfig } from './config.ts';
import { storeArrivals } from './work/arrivals.ts';
import { laneLedger, type LaneLedger } from './work/lane-ledger.ts';
import { scorePosts, type ScoringResult } from './work/score-posts.ts';
import { earlyJudge, type EarlyResult } from './work/early-judge.ts';
import { precedentsWanted, searchDayStart } from '@insidor/core';
import { precedentSource } from './work/precedents.ts';
import { nameGuesser, type NameGuessResult } from './work/name-guesses.ts';
import { readCryptoAttention, type AttentionResult } from './work/crypto-attention.ts';
import { refillMemory, refillPosts, type RefillResult } from './work/post-refill.ts';
import { narrativeGrouper, type NarrativeResult } from './work/narratives.ts';
import { launchClockPass } from './work/launch-clock.ts';
import { narrativeBackPass } from './work/narrative-back.ts';
import { scoreCoinModel, type CoinModelResult } from './work/coin-model.ts';
import { readingsMemory, readingsPass, type ReadingsResult } from './work/readings.ts';
import { sortTop } from './work/sort-top.ts';
import { narrativeNameClock, narrativeNamesPass, type NarrativeNamesResult } from './work/narrative-names.ts';
import { fightWordsPass } from './work/fight-words.ts';
import { quoteClock, quoteSearchPass, type QuoteSearchResult } from './work/quote-search.ts';
import { accountWatchPass, accountWatchState, type AccountWatchResult } from './work/account-watch.ts';
import { bioRefreshMemory, refreshBios } from './work/bio-refresh.ts';
import { translatePosts } from './work/translate-posts.ts';
import { embedImages } from './work/embed-images.ts';
import { backfillStories, type BackfillResult } from './work/backfill.ts';
import { type MetadataReader, type UniverseDeps } from './work/universe.ts';
import { coinLinksPass, type CoinLinkResult } from './work/coin-links.ts';
import { instantItems, instantJudge, type InstantResult } from './work/coin-instant.ts';
import { coinFirstPass, newCoinFirstState, type CoinFirstResult } from './work/coin-first.ts';
import { repostsPass, type RepostResult } from './work/reposts.ts';
import { searchWordClock, searchWordsPass, type SearchWordResult } from './work/search-words.ts';
import { trendingFeedClock, trendingFeedPass, type TrendingFeedResult } from './work/trending-feed.ts';
import { CREDIT_CHECK_MS, CREDIT_RATE_WINDOW_MS, creditWatch } from './open-credit.ts';
import { secondVendorWatch } from './second-vendor.ts';
import { chainClient, fetchDeclaredMetadata, fetchMetadata } from '@insidor/venue-solana-pumpfun';
import { dexscreenerSearch, dexscreenerStandings } from '@insidor/market-dexscreener';
import { geckoterminal } from '@insidor/market-geckoterminal';
import { keepCoins } from './work/coin-keep.ts';
import { lookUpCoins } from './work/coin-lookup.ts';
import { addOwnerCoins } from './work/owner-coins.ts';
import { checkOlderCoins } from './work/older-coins.ts';
import type { DiscoverDeps } from './work/discover.ts';
import { measureDiscovery } from './work/discovery-settings.ts';
import { sourceHandles } from './work/handle-cache.ts';
import { readOutages, SPEND_WINDOW_MS, workMissedPosts, type MissedResult } from './work/missed-posts.ts';
import { embedCoinPictures, pictureCoinMatches } from './work/coin-match.ts';
import { newOneCoinState, oneCoinPass, type OneCoinResult } from './work/one-coin.ts';
import { missedRunnerPass, newMissedRunnerState } from './work/missed-runners.ts';
import { hashPictures } from './work/picture-hashes.ts';

/** A coin search is abandoned after this long; the next pass asks again. */
const SEARCH_TIMEOUT_MS = 8_000;
/**
 * The posts supplier's endpoints on the X day's bill (`feed.searchDay`), as its adapter records them.
 * Not `responses`: the reply reads (work/crypto-attention.ts) keep their own count, `attention.postsPerDay`,
 * about $0.72 a day, and all of it lands in the first hour after 00:00 UTC. On the paced bill that hour's
 * spend held every search back until about 04:00 London on 2026-10-20. The day is $6.30 so the X total stays $7.
 */
const X_DAY_ENDPOINTS = ['search', 'lookup'] as const;
import { advisoryLockKey, policyHash } from './hash.ts';
import { errorText, type Logger } from './log.ts';
import type { DecisionLog, LoopDeps } from './loop.ts';
import type { StageRunRecorder } from './run-record.ts';
import { declareSources, watchedRegistry, type WatchDeps } from './sources.ts';
import { storeWork, type StageRepos } from './work/stages.ts';

export interface Runtime {
  readonly db: Db;
  readonly stageRuns: StageRunRecorder;
  readonly loopDeps: LoopDeps;
  /** Partition maintenance and the unapplied sweep. See `maintain` below. */
  readonly maintenance: Maintenance;
  /** Live sources, already wrapped so every call records its own outcome. */
  readonly platforms: PlatformRegistry;
  /** What `watched` needs, exposed so the discovery loop re-declares each pass. */
  readonly watch: WatchDeps;
  /** Where arrivals land. Narrow on purpose: discovery may write items and nothing else. */
  readonly store: (items: readonly Item[], authors: readonly Author[]) => Promise<number>;
  /**
   * The wallet. Exposed so the discovery loop can consult it BEFORE a call and record
   * a refusal with its numbers — a pause that says only "paused" is indistinguishable
   * from "we chose not to ask" a week later, when the question is whether the cap was
   * too low or the vendor was down.
   */
  readonly meter: DurableMeter;
  /** The catch-all search's lane floors, kept between passes. */
  readonly feedFloors: PgFeedFloorRepo;
  /** The X search day (`feed.searchDay`): a supplier's metered search bill since 00:00 UTC. */
  readonly searchDay: NonNullable<DiscoverDeps['searchDay']>;
  /** The middle lane's ledger (0088) and how many of its posts no lane holds yet (`feed.middle`). */
  readonly middleLane: { readonly ledger: LaneLedger; readonly uncredited: (itemIds: readonly string[]) => Promise<number> };
  /** Score the catch-all posts the judge has not seen, alone and once each. */
  readonly scorePosts: () => Promise<ScoringResult>;
  /** The likeliest catch-all posts judged before their views clear the bar, in their own loop. See work/early-judge.ts. */
  readonly earlyJudge: () => Promise<EarlyResult>;
  /** The names people will coin each new post as, after each scoring pass. See work/name-guesses.ts. */
  readonly guessNames: () => Promise<NameGuessResult>;
  /** Crypto talk under For You posts, read on the posts line and stored as facts. See work/crypto-attention.ts. */
  readonly cryptoAttention: () => Promise<AttentionResult>;
  /** Older feed posts' video files and authors read again, every half minute. See work/post-refill.ts. */
  readonly refillPosts: () => Promise<RefillResult>;
  /** For You's view readings and opened sheets, on their own cadence and ledger. See work/readings.ts. */
  readonly readings: () => Promise<ReadingsResult>;
  /** Each board narrative searched by its name, forward, on its own cadence and ledger. See work/narrative-names.ts. */
  readonly nameSearch: () => Promise<NarrativeNamesResult>;
  /** Big accounts' held posts' quotes searched at about 1 and 3 hours old, own ledger. See work/quote-search.ts. */
  readonly quoteSearch: () => Promise<QuoteSearchResult>;
  /** The accounts whose posts get coined again and again, asked by name every few minutes, own ledger. See work/account-watch.ts. */
  readonly accountWatch: () => Promise<AccountWatchResult>;
  /** Embed the first image of each new post once, for GROUP's image evidence. */
  readonly embedImages: () => Promise<unknown>;
  /** Follow promoted stories' quotes back to where they started. See work/backfill.ts. */
  readonly backfill: () => Promise<BackfillResult>;
  /** The coin universe loop's dependencies. See work/universe.ts. */
  readonly universe: Omit<UniverseDeps, 'now'>;
  /** Coins we never saw minted, looked up by a narrative's or post's name. See work/coin-lookup.ts. */
  readonly lookUpCoins: () => Promise<unknown>;
  /** Old coins asked about once, and the ones that do not matter deleted. See work/coin-keep.ts. */
  readonly keepCoins: () => Promise<unknown>;
  /** The owner's pasted missed posts, read on the learning book and diagnosed. See work/missed-posts.ts. */
  readonly missedPosts: () => Promise<MissedResult>;
  /** The posts the judge passed, regrouped into narratives every couple of minutes. See work/narratives.ts. */
  readonly narratives: () => Promise<NarrativeResult>;
  /** Each post the judge said no to, scored once by our own coin model (the safety net). See work/coin-model.ts. */
  readonly coinModel: () => Promise<CoinModelResult>;
  /** One post, one coin: launches matched to posts, their trades watched, each post's coin judged. See work/one-coin.ts. */
  readonly oneCoin: () => Promise<OneCoinResult>;
  /** The ways to find a post besides the searches (Policy.finders). See loops/finders.ts. */
  readonly finders: {
    readonly coinLinks: () => Promise<CoinLinkResult>;
    /** The posts a coin just named that the coin rule picks, judged at once (work/coin-instant.ts). */
    readonly instant: () => Promise<InstantResult>;
    /** The posts a running coin's own link ties: read, judged once and credited (work/coin-first.ts). */
    readonly coinFirst: () => Promise<CoinFirstResult>;
    readonly reposts: () => Promise<RepostResult>;
    readonly searchWords: () => Promise<SearchWordResult>;
    readonly trendingFeed: () => Promise<TrendingFeedResult>;
  };
}


/**
 * The judge port for this process, or null when it is dormant.
 *
 * ★ THE ONLY PLACE THE REAL `fetch` REACHES THE JUDGE, for the reason `runtimeDeps` below
 * gives for the platforms: every adapter takes it as a dependency so no test can reach
 * the network, and this file is the one entitled to hand over the real one.
 */
function buildJudge(
  cfg: RunnerConfig,
  meter: Meter,
  policy: Policy,
  log: Logger,
  /** The answer budget: QUALIFY's by default; the per-post score passes its smaller one. */
  maxOutputTokens: number = policy.judge.maxOutputTokens,
  /** QUALIFY asks about a group of posts; the feed's per-post score asks its own question. */
  question: JudgeQuestion = 'story',
  /** The owner's learned examples after the post question's rules (learned-examples.ts); null: none. */
  examples: string | null = null,
  /** Send each post's closest labelled posts as precedent (work/precedents.ts); post question only. */
  precedents = false,
  /** The ledger's endpoint for its calls; the adapter's own ('judge') when absent — the shadow passes its own. */
  endpoint?: string,
): JudgePort | null {
  const setup = cfg.judge;
  if (setup.state === 'dormant' || setup.state === 'misconfigured') {
    log.info('judge dormant: QUALIFY will abstain on every story (Q1_unjudged)', {
      set: 'ANTHROPIC_API_KEY and JUDGE_MODEL to turn it on',
    });
    return null;
  }
  /* A model with no key in a live run: the main judge is off (config.ts lets this boot only when
     the open model is configured — the owner stopped paying for the main one on 2026-10-16). */
  if (setup.state === 'priced' && cfg.spend.kind === 'live') return null;
  const price = priceFor(setup.model);
  if (price === null) {
    throw new JudgeNotConfigured('JUDGE_MODEL', `is ${JSON.stringify(setup.model)}, which has no price in prices.ts`);
  }
  const client: JudgeClient =
    setup.state === 'configured'
      ? httpClient({
          /* The host's smaller named size: ~25% less input per post. Tested 2026-10-13 twice each
             against full size: gold 27 and 30 of 41 vs 29 and 28, non-meme 2 and 0 of 43 vs 2 and 1 —
             the same within the judge's own run-to-run noise. */
          pictureSize: 'small',
          apiKey: setup.apiKey,
          baseUrl: setup.baseUrl,
          model: setup.model,
          maxOutputTokens,
          effort: price.effort,
          timeoutMs: policy.judge.timeoutMs,
          maxAttempts: policy.judge.maxAttempts,
          backoffMs: policy.judge.backoffMs,
          maxWaitMs: policy.judge.maxWaitMs,
          maxFrameBytes: policy.judge.maxFrameBytes,
          fetch: globalThis.fetch,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        })
      : {
          judge: () => Promise.reject(new JudgeNotConfigured('ANTHROPIC_API_KEY', 'is not set; this judge can only price calls')),
          frame: () => Promise.reject(new JudgeNotConfigured('ANTHROPIC_API_KEY', 'is not set; this judge can only price calls')),
        };
  log.info('judge resolved', {
    state: setup.state,
    model: setup.model,
    mode: cfg.spend.kind,
    usdPerMillionInput: price.usdPerMillionInput,
    usdPerMillionOutput: price.usdPerMillionOutput,
  });
  return anthropicJudge({
    client,
    meter,
    now: () => Date.now(),
    model: setup.model,
    policy: { ...policy.judge, maxOutputTokens },
    maxBatch: policy.qualify.batchSize,
    question,
    examples,
    precedents,
    ...(endpoint === undefined ? {} : { endpoint }),
  });
}
/**
 * The open model as the feed's judge (Policy.judge.primary, feed-judges.ts), or null when it is
 * dormant. Built like `buildJudge` builds the main one, with the same policy numbers: the same
 * prompt files and learned block (the adapter takes them from the main judge's package), the same
 * precedents, the same posts per batch, the same smaller picture size. Only the model and how it is
 * asked differ: fewer posts a call, side by side, skipped posts asked again, a timeout and retries
 * of its own, and an answer budget sized to the call (Policy.judge.open). Its pictures go as data URLs in the chat format rather than the main judge's
 * image blocks — the same bytes; and it has no prompt cache, which its estimate already counts.
 */
export function buildOpenJudge(
  /* The open model's setup, or the backup's (`openBackupSide`). */
  setup: OpenJudgeSetup,
  model: HostModel | null,
  meter: Meter,
  policy: Policy,
  maxOutputTokens: number,
  question: OpenQuestion,
  examples: string | null = null,
  precedents = false,
  /** The ledger's endpoint; the adapter's own when absent. */
  endpoint?: string,
  /** Posts a call (Policy.judge.open.batchSize, or primaryBatchSize for the primary model). */
  perCall: number = policy.judge.open.batchSize,
): JudgePort | null {
  if (setup.state === 'dormant' || model === null) return null;
  const client = openChatClient({
    vendor: setup.vendor,
    apiKey: setup.apiKey,
    baseUrl: setup.baseUrl,
    model: model.id,
    vision: model.vision,
    maxOutputTokens,
    /* Per call, and each retry at the next pinned provider (Policy.judge.open). */
    timeoutMs: policy.judge.open.timeoutMs,
    maxAttempts: policy.judge.open.maxAttempts,
    backoffMs: policy.judge.backoffMs,
    maxWaitMs: policy.judge.maxWaitMs,
    maxFrameBytes: policy.judge.maxFrameBytes,
    pictureSize: 'small',
    providers: setup.providers,
    router: setup.router !== false,
    answerTokensPerSubject: policy.judge.open.answerTokensPerPost,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return openJudge({
    client,
    meter,
    now: () => Date.now() as Millis,
    model,
    vendor: setup.vendor,
    policy: { ...policy.judge, maxOutputTokens },
    /* The feed hands it the same posts per batch as the main judge; it asks them in smaller calls side by side. */
    maxBatch: policy.qualify.batchSize,
    perCall,
    parallel: policy.judge.open.parallel,
    reask: policy.judge.open.reask,
    reaskWithinMs: policy.judge.open.reaskWithinMs,
    question,
    examples,
    precedents,
    ...(endpoint === undefined ? {} : { endpoint }),
  });
}


/**
 * The questions Policy.judge.askWith puts on the open model, built for one open model (`side`):
 * the narrative question and the kind question as judging ports (the main judge's prompt files,
 * as `buildOpenJudge` builds the post question), and the namer, the translator and the
 * same-subject question (adapters openai-compatible questions.ts). Each with its own client so
 * its answer budget is its own, the judge policy's retries and timeouts, the smaller picture size.
 */
function buildOpenQuestions(side: OpenSide, meter: Meter, policy: Policy) {
  const client = (maxOutputTokens: number) =>
    openChatClient({
      vendor: side.setup.vendor,
      apiKey: side.setup.apiKey,
      baseUrl: side.setup.baseUrl,
      model: side.model.id,
      vision: side.model.vision,
      maxOutputTokens,
      timeoutMs: policy.judge.timeoutMs,
      maxAttempts: policy.judge.maxAttempts,
      backoffMs: policy.judge.backoffMs,
      maxWaitMs: policy.judge.maxWaitMs,
      maxFrameBytes: policy.judge.maxFrameBytes,
      pictureSize: 'small',
      providers: side.setup.providers,
      router: side.setup.router !== false,
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
  const now = () => Date.now() as Millis;
  const judgeFor = (question: OpenQuestion, maxOutputTokens: number): JudgePort =>
    openJudge({ client: client(maxOutputTokens), meter, now, model: side.model, vendor: side.setup.vendor, policy: { ...policy.judge, maxOutputTokens }, maxBatch: policy.qualify.batchSize, question });
  const common = { meter, now, model: side.model, vendor: side.setup.vendor, providers: side.setup.providers, router: side.setup.router !== false, judge: policy.judge };
  return {
    story: () => judgeFor('story', policy.judge.maxOutputTokens),
    kind: () => judgeFor('kind', policy.judge.postBatchMaxOutputTokens),
    namer: (): NamePort => openNamer({ ...common, client: client(policy.names.maxOutputTokens), names: policy.names }),
    translator: (): TranslatePort => openTranslator({ ...common, client: client(policy.translate.maxOutputTokens), translate: policy.translate }),
    sameSubject: (): SameSubjectPart => {
      const pair = openSameSubject({ ...common, client: client(policy.judge.pairMaxOutputTokens) });
      return { id: pair.id, sameSubjectPromptId: pair.sameSubjectPromptId, estimateSameSubject: pair.estimateSameSubject, sameSubject: pair.sameSubject };
    },
  };
}

/**
 * The backup open model, behind the open model for every question it answers first — the post
 * question, the kind question, names and translations — or null when none is configured
 * (adapter setup.ts `readOpenJudgeBackupSetup`: OPEN_JUDGE_BACKUP_API_KEY or TOGETHER_API_KEY).
 * With none, an open-model outage leaves those questions unanswered, each in its typed absence —
 * never handed to the main judge.
 *
 * ★ PRICED FROM THE RECORDED LISTING, NOT THE HOST'S. The backup host's model list needs its key
 * (the router's does not), so its prices and whether it reads pictures come from KNOWN_MODELS; a
 * backup model not recorded there has no price, and an unpriced call is refused, so there is no
 * backup and `backupUnpriced` says why at boot.
 */
export function openBackupSide(cfg: Pick<RunnerConfig, 'openJudgeBackup'>): OpenSide | null {
  const setup = cfg.openJudgeBackup;
  if (setup.state !== 'configured') return null;
  const model = KNOWN_MODELS.find((m) => m.id === setup.model) ?? null;
  return model === null ? null : { setup, model };
}

/** Why a backup key at boot gives no backup, or null when it does (or there is no key). */
function backupUnpriced(cfg: RunnerConfig): string | null {
  const setup = cfg.openJudgeBackup;
  if (setup.state !== 'configured') return null;
  return KNOWN_MODELS.some((m) => m.id === setup.model) ? null : `${setup.model} has no recorded price (KNOWN_MODELS)`;
}

/**
 * The namer for this process (work/name-guesses.ts, Policy.names), or null when the judge is not
 * configured to call. The judge's own model, key and retries, its own client so its answer budget
 * is the namer's; metered on the judge's line under the `names` endpoint.
 */
function buildNamer(cfg: RunnerConfig, meter: Meter, policy: Policy): NamePort | null {
  const setup = cfg.judge;
  if (setup.state !== 'configured') return null;
  const price = priceFor(setup.model);
  if (price === null) return null;
  const client = httpClient({
    pictureSize: 'small',
    apiKey: setup.apiKey,
    baseUrl: setup.baseUrl,
    model: setup.model,
    maxOutputTokens: policy.names.maxOutputTokens,
    effort: price.effort,
    timeoutMs: policy.judge.timeoutMs,
    maxAttempts: policy.judge.maxAttempts,
    backoffMs: policy.judge.backoffMs,
    maxWaitMs: policy.judge.maxWaitMs,
    maxFrameBytes: policy.judge.maxFrameBytes,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return anthropicNamer({ client, meter, now: () => Date.now() as Millis, model: setup.model, judge: policy.judge, names: policy.names, effort: price.effort });
}

/**
 * The translator for this process (work/translate-posts.ts, Policy.translate, 0081), or null when
 * the judge is not configured to call. The judge's key and retries, its own client so its answer
 * budget is the translator's; always the cheap model (adapter translate.ts), metered on the
 * judge's line under the `translate` endpoint.
 */
function buildTranslator(cfg: RunnerConfig, meter: Meter, policy: Policy): ReturnType<typeof anthropicTranslator> | null {
  const setup = cfg.judge;
  if (setup.state !== 'configured') return null;
  const client = httpClient({
    apiKey: setup.apiKey,
    baseUrl: setup.baseUrl,
    model: setup.model,
    maxOutputTokens: policy.translate.maxOutputTokens,
    effort: null,
    timeoutMs: policy.judge.timeoutMs,
    maxAttempts: policy.judge.maxAttempts,
    backoffMs: policy.judge.backoffMs,
    maxWaitMs: policy.judge.maxWaitMs,
    maxFrameBytes: policy.judge.maxFrameBytes,
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return anthropicTranslator({ client, meter, now: () => Date.now() as Millis, judge: policy.judge, translate: policy.translate });
}

/**
 * The two calls on `PgDecisionRepo` that had no caller anywhere in the repository.
 *
 * They are a port rather than a direct use of the concrete class for the same reason
 * everything else in this service is: the supervision machinery stays testable without
 * a database. But the reason they exist AT ALL is worth stating, because both were
 * documented as "the runner does this" and neither was ever called:
 *
 *   ensurePartition — `internal.decisions` is partitioned by day, and 0006 defines a
 *   row landing in `decisions_default` as meaning "the partition-maintenance job
 *   stopped running". With nothing calling this, EVERY row lands there — so on day one
 *   a hundred percent of the log arrives in the signal that means the system is broken,
 *   and the signal is worthless from then on.
 *
 *   sweepUnapplied — `applied_at IS NULL` is the whole payoff of writing the log before
 *   performing the effect. `decisions_unapplied_idx` indexes it and nothing queried it,
 *   which means the asymmetry bought a repair queue nobody could see. Counting it at
 *   boot is the smallest honest version: a count that grows rather than drains is a
 *   stage failing after it logged.
 */
/** `2026-08-19`. The width of an ISO date, which is what ensure_decision_partition takes. */
const DATE_LENGTH = 10;
const MS_PER_DAY = 86_400_000;

export interface Maintenance {
  /** Create today's and tomorrow's partitions. Idempotent; safe to call every day. */
  ensurePartitions(now: Millis): Promise<readonly string[]>;
  /** How many logged decisions never had their side effect land. */
  countUnapplied(sinceMs: Millis, limit: number): Promise<number>;
}

/**
 * Opens the pool, takes the singleton lock, builds the ports, and runs `use`
 * inside all three. The lock is released and the pool closed only after `use`
 * resolves — releasing either while a loop is still writing would hand the queue
 * to a second runner mid-flight.
 */
export async function withRuntime<T>(
  cfg: RunnerConfig,
  log: Logger,
  use: (runtime: Runtime) => Promise<T>,
): Promise<T> {
  // The runner writes decisions and judgements, so it holds the `internal` role
  // and no other. Configuration owns the one read of process.env in this
  // service, which is why the URLs are handed in rather than read again here.
  //
  // TWO POOLS, ONE ROLE. The singleton lock is session state and gets a pool of one
  // client on a session-mode URL (createPool refuses the transaction pooler for it).
  // The loops' work runs on a second pool that may sit behind the transaction pooler,
  // so the runner holds ONE session-mode client however busy its loops are — the
  // session pooler caps clients per user, and seven loops used to take ten of them.
  const lockPool = createPool(DB_ROLE.internal, {
    applicationName: `insidor-runner-lock@${cfg.host}`,
    env: { DATABASE_URL_INTERNAL: cfg.lockDatabaseUrl },
    session: true,
    max: 1,
  });
  const pool = createPool(DB_ROLE.internal, {
    applicationName: `insidor-runner@${cfg.host}`,
    env: { DATABASE_URL_INTERNAL: cfg.databaseUrl },
  });

  try {
    // A session advisory lock, not a row. Session mode (5432) is required for
    // this to hold; transaction mode cannot keep a session lock, which is why
    // the lock pool is opened with `session: true`.
    //
    // The result is wrapped in an object so that "the lock was not free" (null)
    // stays distinguishable from "the work returned null" — the same distinction
    // between empty and dead that the rest of this service is built around.
    const outcome = await withAdvisoryLock(lockPool, advisoryLockKey(cfg.singletonLockName), async () => {
      // The lock-holding client does nothing else: repositories run on the pool,
      // so seven loops do not serialise behind one backend.
      const db = asDb(pool);
      const decisions = new PgDecisionRepo(db);
      const decisionRepo: DecisionRepo = decisions;

      /* ★ ASSIGNED DIRECTLY RATHER THAN THROUGH A LAMBDA, and that is what carries the
         widening. `StageRunRecorder.open` takes a `SupervisedName` — wider than the
         seven, because discovery is supervised and is not a decision stage — while
         `PgStageRunRepo.open` takes a `StageName`. A method parameter is bivariant in
         TypeScript, so the repository satisfies the wider port with nothing cast and
         nothing silenced; the column it writes to is free text, which is why the
         widening is safe at the database as well as at the type. chainwatch relies on
         exactly this and argues it at length. A wrapping lambda would have had to cast
         its own argument, which is the version that hides the decision. */
      const stageRuns: StageRunRecorder = new PgStageRunRepo(db);
      const sourceHealth: SourceHealthRepo = new PgSourceHealthRepo(db);

      const repos: StageRepos = {
        items: new PgItemRepo(db),
        authors: new PgAuthorRepo(db),
        observations: new PgObservationRepo(db),
        stories: new PgStoryRepo(db),
        assets: new PgAssetRepo(db),
        decisions,
        backfill: new PgBackfillRepo(db),
      };

      // The policy body lives in code and is hashed here, once, at boot. The
      // body is recorded under its hash before the first decision of that
      // version is written: a hash whose body nobody kept is not an audit
      // trail, it is a checksum of something we lost.
      const policy = DEFAULT_POLICY;
      const hash = policyHash(policy);
      await decisions.recordPolicy(hash, policy, `runner boot on ${cfg.host}`);
      log.info('policy loaded', { policyHash: hash });

      // Log first, act, then mark: `write` returns the row id the side effect is
      // stamped against, and nothing else in this service is allowed to reorder
      // those three.
      const decisionLog: DecisionLog = {
        write: (decision) => decisionRepo.append(decision),
        markApplied: (rowId, at) => decisionRepo.markApplied(rowId, at),
      };

      /* ── the sources ────────────────────────────────────────────────────
         Everything below is construction, and none of it can fail the boot. */

      const watch: WatchDeps = { health: sourceHealth, now: () => Date.now(), log };

      /**
       * ★ THE METER IS DURABLE, AND THAT IS THE DIFFERENCE BETWEEN A DAILY CAP AND A
       * PER-PROCESS-LIFETIME CAP.
       *
       * `openDurableMeter` reads today's ledger out of `internal.spend` before it
       * exists, so a process that boots into a day where $2.80 of a $3.00 line is
       * already gone gets $0.20 and not $3.00. Without that read, `main.ts` exiting on
       * an uncaught exception under any restarting supervisor hands out the whole
       * budget once per crash — each allocation individually enforced, the invoice a
       * multiple of the number in policy. It is the single failure mode where a cap
       * that genuinely refuses still fails to bound a bill.
       *
       * ★ AND IT IS AWAITED HERE, BEFORE ANY LOOP EXISTS. A meter that filled itself
       * in later would spend the first calls of every boot against a budget it had not
       * checked — and the first calls of a boot are exactly what a crash loop consists
       * of. A failed read fails the boot, which is the correct direction: a process
       * that cannot find out what it has already spent must not start spending.
       */
      const meter = await openDurableMeter({
        ledger: new PgSpendRepo(db),
        /* ★ THE LOWER OF THE TWO, ALWAYS. Policy is the ceiling any deployment may
           reach; the environment is this operator's tighter belt inside it. config.ts
           already refuses a value above the policy line at boot, so this `min` is the
           belt-and-braces spelling of a rule that is enforced there — and it is written
           out rather than assumed so that removing the check in config.ts cannot
           silently raise the cap here. */
        dailyCapUsd: Math.min(cfg.spend.dailyBudgetUsd, policy.budget.dailyUsd),
        /* ★ THE PER-SOURCE LINE, WHICH THE OLD WIRING SUPPORTED AND NEVER PASSED. One
           undifferentiated pot is spent in the order sources happen to be declared, so
           whichever source is asked first drains the day and the ones behind it are
           refused from mid-morning — which reads on the board as two dead sources
           rather than as one expensive one.

           It is the DEFAULT line rather than a map of named ones because the vendor
           token is an adapter's secret and this file holds source ids: the registry
           that could translate between them is built below, with this meter already in
           hand. A default is also the better rule — a source added next year gets a
           ceiling by existing rather than by somebody remembering to add it to a map,
           and the source nobody remembers is exactly the one that would have none. */
        defaultVendorCapUsd: policy.budget.perSourceUsdPerDay,
        /* ★ ONE LINE PER SUPPLIER, the owner's caps (Policy.budget.supplierLines), mapped
           here from role to the vendor that bills under it. Not paced: full speed every pass,
           the lines are brakes (see the note where policy once held `paceAheadMs`). */
        perVendorCapUsd: {
          ...vendorLines(policy),
          /* The backup open model's host bills under its own name: the judge's line again. */
          ...(cfg.openJudgeBackup.state === 'configured' ? { [cfg.openJudgeBackup.vendor]: policy.budget.supplierLines.judge } : {}),
        },
        /* Warn, never stop: only the day's total refuses a call (Policy.budget.vendorLinesStop). */
        vendorLinesWarnOnly: !policy.budget.vendorLinesStop,
        softStop: policy.budget.softStopFraction,
        now: () => Date.now(),
        /* Reported, not acted on. A write that failed means the NEXT process will not
           know about these dollars; refusing calls over it would let a database blip
           stop the ingest, which is the monitoring taking down the thing it monitors. */
        onWriteFailure: (spend, error) =>
          log.error('a spend could not be persisted; the next process will not see it', {
            vendor: spend.vendor,
            endpoint: spend.endpoint,
            usd: spend.usd,
            err: error instanceof Error ? error.message : String(error),
          }),
      });

      log.info('wallet opened', {
        mode: cfg.spend.kind,
        dailyCapUsd: Math.min(cfg.spend.dailyBudgetUsd, policy.budget.dailyUsd),
        perSourceCapUsd: policy.budget.perSourceUsdPerDay,
        /* ★ WHAT TODAY HAS ALREADY COST, PRINTED AT BOOT. On a first boot it is zero
           and says the ledger is reachable; on the fourth restart of a crash loop it is
           the number that tells somebody what is happening, and it is the one line that
           could not exist before the ledger was durable. */
        spentTodayUsd: meter.openedWith.totalUsd,
      });

      /* ★ THE LINES ARE SHARED WITH ANY ONE-OFF PAID JOB (tools/jobs.ts), which writes to the same
         ledger. Re-read it on a timer so what the job spends counts here too; see `refresh` in
         the meter. Unref'd: it must never be what keeps a stopping runner alive. */
      /* ★ THE OWNER'S EARLY WARNING rides the same minute: after each re-read, any supplier
         at 80% or 95% of its line (Policy.budget.warnAt) is logged and queued for the owner,
         once a level a day. See supplier-warnings.ts. A failed re-read still checks, against
         the last balance, which is the most the meter itself knows. */
      /* The learning and jobs books are watched as well: their lines warn the same way. Opened to
         be read and refreshed, never spent through — each paid tool opens its own. */
      const otherBooks = await Promise.all(
        (['learning', 'jobs'] as const).map(async (book) => ({
          book,
          meter: await openDurableMeter({
            ledger: new PgSpendRepo(db),
            book,
            dailyCapUsd: book === 'learning' ? policy.budget.learningLines.dailyUsd : policy.budget.jobLines.dailyUsd,
            perVendorCapUsd: jobVendorLines(policy, book),
            vendorLinesWarnOnly: !policy.budget.vendorLinesStop,
            softStop: policy.budget.softStopFraction,
            now: () => Date.now(),
            onWriteFailure: () => undefined,
          }),
        })),
      );
      const owner = new PgOwnerAlertRepo(db);
      const bookWarnings = otherBooks.map(({ book, meter: m }) =>
        supplierWarnings({
          roles: supplierRoles()
            .filter((r) => (jobVendorLines(policy, book)[r.vendor] ?? 0) > 0)
            .map((r) => ({ role: `${book} ${r.role}`, vendor: r.vendor })),
          line: (vendor) => m.line(vendor),
          warnAt: policy.budget.warnAt,
          buffer: policy.budget.lineBuffer,
          ownerWallets: cfg.ownerWallets,
          owner,
          log: log.child({ step: 'supplier-warnings', book }),
          now: () => Date.now(),
        }),
      );
      /* The post judge's suppliers, first first, in the order the judge below asks them (`firstSide`):
         the owner's "judge" line warning is about the supplier actually judging. */
      const postJudgeVendors = ((): readonly string[] | undefined => {
        const second = cfg.openJudgeBackup.state === 'configured' ? [cfg.openJudgeBackup.vendor] : [];
        const router = cfg.openJudge.state === 'configured' ? [cfg.openJudge.vendor] : [];
        const open = cfg.postJudgeFirst === 'second' ? [...second, ...router] : [...router, ...second];
        return policy.judge.primary === 'open' && open.length > 0 ? open : undefined;
      })();
      const warnings = supplierWarnings({
        roles: supplierRoles(postJudgeVendors),
        line: (vendor) => meter.line(vendor),
        warnAt: policy.budget.warnAt,
        buffer: policy.budget.lineBuffer,
        ownerWallets: cfg.ownerWallets,
        owner: new PgOwnerAlertRepo(db),
        log: log.child({ step: 'supplier-warnings' }),
        now: () => Date.now(),
      });
      /* ★ THE OWNER'S ALARM FOR AN EMPTY SUPPLIER ACCOUNT. Every adapter tells the process when a
         vendor refuses a call for billing (vendor-kit onOutOfCredit), whatever its caller then
         does with the error; this registry logs it at error level and queues a `supplier_account`
         alert once per supplier an hour, and once more when it answers again. Its pending alerts
         ride the same minute as the warnings. See billing-alerts.ts. */
      const billing = billingAlerts({
        ownerWallets: cfg.ownerWallets,
        owner: new PgOwnerAlertRepo(db),
        log: log.child({ step: 'supplier-billing' }),
        now: () => Date.now(),
      });
      onOutOfCredit({ refused: (e) => billing.refused(e), answered: (vendor) => billing.answered(vendor) });
      /* ★ THE SHORT-VIDEO SOURCE'S SECOND VENDOR (second-vendor.ts): its route between it and the
         backup set from policy before any adapter is built, the owner told of a switch and of a low
         balance through the same queue, the balance checked each `balanceEveryMs`. */
      const secondVendor = secondVendorWatch({
        ...SECOND_VIDEO_VENDOR,
        alerts: billing,
        names: SUPPLIER_NAMES,
        policy,
        log: log.child({ step: 'second-vendor' }),
      });
      setInterval(() => secondVendor.checkBalance(Date.now()), policy.feed.secondVendor.balanceEveryMs).unref();
      /* ★ THE OPEN JUDGE ACCOUNT'S CREDIT (open-credit.ts): read here, where its key already is, every
         quarter-hour; pushed once under two days of its spend (or $5) and once when topped up. */
      const openSetup = cfg.openJudge;
      if (openSetup.state === 'configured') {
        const spendLedger = new PgSpendRepo(db);
        const credit = creditWatch({
          vendor: openSetup.vendor,
          /* The lower of the account's credit and the key's own cap: either one stops the judge. */
          remaining: async () => (await accountCredits(globalThis.fetch, openSetup.baseUrl, openSetup.apiKey, policy.judge.timeoutMs)).spendableUsd,
          dailyUsd: async () => (await spendLedger.totalsSince((Date.now() - CREDIT_RATE_WINDOW_MS) as Millis)).byVendor[openSetup.vendor] ?? 0,
          alerts: billing,
          log: log.child({ step: 'open-credit' }),
          now: () => Date.now(),
        });
        void credit.check();
        setInterval(() => void credit.check(), CREDIT_CHECK_MS).unref();
      }
      /* ★ THE OWNER'S LANGUAGE-DROP ALARM (language-alarm.ts): each source's finds per language
         against the same hours the day before, every `everyMs`; a language that falls by more than
         the policy's share is queued for the owner as an outage alert, once a drop. */
      const languages = languageAlarm({
        policy: policy.notify.languageDrop,
        buckets: (source, lanes, fromMs, toMs, bucketMs) => new PgLanguageFindsRepo(db).buckets(source, lanes, fromMs, toMs, bucketMs),
        ownerWallets: cfg.ownerWallets,
        owner,
        log: log.child({ step: 'language-drop' }),
        now: () => Date.now(),
      });
      void languages.check();
      setInterval(() => void languages.check(), policy.notify.languageDrop.everyMs).unref();
      /* ★ THE OWNER'S DISK AND BILL ALERTS (disk-alarm.ts): the database's size sampled hourly into
         internal.disk_sample, the host's disk replayed from it, and the owner told at 80% of the disk,
         when it has grown, and when the month's projected bill first passes Policy.store.bill. */
      const diskSamples = new PgDiskSampleRepo(db);
      const disk = diskAlarm({
        policy: policy.store,
        sample: () => diskSamples.sample(),
        samples: () => diskSamples.since(0),
        ownerWallets: cfg.ownerWallets,
        owner,
        log: log.child({ step: 'disk-bill' }),
        now: () => Date.now(),
      });
      void disk.check();
      setInterval(() => void disk.check(), policy.store.disk.everyMs).unref();
      /* ★ THE MISSED-RUNNER NET (work/missed-runners.ts, Policy.runnerLink.missed): coins over the cap bar
         no pick holds, tied back to the post we hold they came from, and the owner told. DB only. */
      if (policy.runnerLink.missed.on) {
        const runnerRepo = new PgMissedRunnerRepo(db);
        const picksRepo = new PgOneCoinRepo(db);
        const runnerState = newMissedRunnerState();
        const runnerPass = () =>
          missedRunnerPass(
            {
              runners: (sinceMs, minCapUsd, origins, limit, minLiquidityUsd, minReadings) => runnerRepo.runners(sinceMs, minCapUsd, origins, limit, minLiquidityUsd, minReadings),
              postsFor: (phrases, keys, fromMs, toMs, limit) => runnerRepo.postsFor(phrases, keys, fromMs, toMs, limit),
              pictureSimilarity: (assetKey, itemIds) => runnerRepo.pictureSimilarity(assetKey, itemIds, policy.group.image.space),
              ownerCalled: async (ids) => {
                const newest = new Map<string, string>();
                for (const r of await new PgOwnerCoinCallRepo(db).rows(ids)) newest.set(r.itemId, r.verdict);
                return new Set([...newest].filter(([, v]) => v !== 'cleared').map(([id]) => id));
              },
              picks: (ids) => picksRepo.picks('post', ids),
              peaks: (addresses, sinceMs) => runnerRepo.peaks(addresses, sinceMs, policy.oneCoin.minLiquidityUsd),
              upsertCandidates: (rows, nowMs) => picksRepo.upsertCandidates(rows, nowMs),
              writePicks: (picks, previous, mode, nowMs) => picksRepo.writePicks('post', picks, previous, mode, nowMs),
              ownerWallets: cfg.ownerWallets,
              owner,
              policy,
              log: log.child({ step: 'missed-runners' }),
              now: () => Date.now(),
            },
            runnerState,
          );
        void runnerPass();
        setInterval(() => void runnerPass(), policy.runnerLink.missed.everyMs).unref();
      }
      /* ★ THE OWNER'S JUDGE COST ALARM (judge-cost-alarm.ts): the judge's booked cost a call over the
         last hour against the median hour of the week before; past twice it, the owner is told, at
         most once in six hours (Policy.notify.judgeCost). Read from the ledger, so it runs whichever
         host the judge is on. */
      const judgeCost = judgeCostAlarm({
        policy: policy.notify.judgeCost,
        buckets: (fromMs, toMs, bucketMs) => new PgSpendRepo(db).callBuckets(OPEN_JUDGE_ENDPOINT, fromMs as Millis, toMs as Millis, bucketMs),
        ownerWallets: cfg.ownerWallets,
        owner,
        log: log.child({ step: 'judge-cost' }),
        now: () => Date.now(),
      });
      void judgeCost.check();
      setInterval(() => void judgeCost.check(), policy.notify.judgeCost.everyMs).unref();
      log.info('supplier warnings', {
        at: policy.budget.warnAt,
        alert: cfg.ownerWallets.length === 0 ? 'no OWNER_WALLET; logged only' : 'queued for the owner',
      });
      setInterval(() => {
        meter
          .refresh()
          .catch((error: unknown) =>
            log.warn('the spend ledger could not be re-read; keeping the last balance', {
              err: error instanceof Error ? error.message : String(error),
            }),
          )
          .then(() => warnings.check())
          .then(() => billing.flush())
          .then(() => Promise.all(otherBooks.map(({ meter: m }) => m.refresh())))
          .then(() => Promise.all(bookWarnings.map((w) => w.check())))
          .catch((error: unknown) =>
            log.error('the supplier warning check failed', { err: error instanceof Error ? error.message : String(error) }),
          );
      }, policy.budget.ledgerRefreshMs).unref();

      /* ── the judge ──────────────────────────────────────────────────────
         Built after the meter, because every judge call is metered against it. Four
         states (config.ts has already failed the boot on the two that are faults):
           dormant      no judge; QUALIFY abstains with Q1 on every story
           priced       SPEND=dry with a model and no key: estimates only. The client it
                        holds refuses to run, and the dry run never asks it to.
           configured   the real client. In SPEND=dry it is still never called. */
      const mainStoryJudge = buildJudge(cfg, meter, policy, log);
      /* The video and author fill-in's tries and day count, kept across passes for this process (work/post-refill.ts). */
      const refills = refillMemory();
      const readingNotes = readingsMemory();
      /* The sorts' top text-source posts, ranked every few minutes and kept between passes (work/sort-top.ts). */
      const sortTopPosts = sortTop({
        members: () => new PgReadingsRepo(db).forYouMembers(),
        series: (ids, sinceMs) => repos.observations.seriesForItems(ids, sinceMs),
        policy,
        log: log.child({ step: 'sort-top' }),
        now: () => Date.now() as Millis,
      });
      /* Where each narrative's name search last began, and which ages each big post was asked at (this process). */
      const nameClock = narrativeNameClock();
      /* When the narrative-name search last ran: its loop now turns every `feed.fightWords.everyMs` for the
         meme-war word search, and the name search keeps its own `narrativeNames.everyMs`. */
      let namesRanAt = Number.NEGATIVE_INFINITY;
      const quotesAsked = quoteClock();
      /* The account watch's list and each account's last answered ask (this process). */
      const watchState = accountWatchState();
      /* Each poster's last profile re-read and the day's count (work/bio-refresh.ts). */
      const bioReads = bioRefreshMemory();
      /* The feed's translations table (work/translate-posts.ts); its translator is built below, with the open model. */
      const translations = new PgTranslationRepo(db);
      /* The per-post score's judge: the same model and prompt, with a smaller answer budget
         so ten short answers are not reserved at the cost of two long ones. */
      /* ★ WITH THE OWNER'S LEARNED EXAMPLES: the latest block the re-tune APPLIED (0056), read at
         boot and every few minutes, swapped in behind the same port (learned-examples.ts). None
         applied: no examples, the judge's rules alone. */
      /* ★ PRECEDENTS (work/precedents.ts): the owner's closest labelled posts ride along with each
         post, when the embeddings that find them are configured. They change the post question's id. */
      const withPrecedents = cfg.embeddings.state === 'configured' && precedentsWanted(policy) > 0;
      /* ★ THE FEED'S TWO JUDGES (feed-judges.ts): the main one and the open model, by the role
         Policy.judge.primary gives each, both with the same block, precedents and questions. */
      const openModel = await openHostModel(cfg.openJudge, policy.judge.timeoutMs, log.child({ step: 'open-judge' }));
      /* ★ THE SECOND OPEN HOST (openBackupSide): Nemotron 3.5 Super VL on Together by default. */
      const backupSide = openBackupSide(cfg);
      if (backupSide !== null) log.info('open judge second host: configured', { host: backupSide.setup.vendor, model: backupSide.model.id });
      else if (cfg.openJudgeBackup.state === 'configured') log.error('open judge second host: a key is set but there is no second model', { why: backupUnpriced(cfg) });
      else log.info('open judge second host: none (no OPEN_JUDGE_BACKUP_API_KEY or TOGETHER_API_KEY); the router\'s model alone', { failover: policy.judge.failover.on });
      const routerSide: OpenSide | null = openModel === null || cfg.openJudge.state !== 'configured' ? null : { setup: cfg.openJudge, model: openModel };
      /* ★ WHICH OPEN MODEL ASKS THE POST AND KIND QUESTIONS FIRST (adapter setup.ts `readPostFirst`;
         the owner, 2026-10-17: "Nemotron on Together at 0.70, Gemma 3 as its automatic fallback"):
         the second host's model first and the router's behind it; OPEN_JUDGE_POST_FIRST=router turns
         it round; with one host configured, that one alone. Each model's answers are held to its own
         cutoff whichever answers (Policy.judge.cutoffs, by the judge id). */
      const { first: firstSide, behind: behindSide } = postJudgeOrder(cfg.postJudgeFirst, routerSide, backupSide);
      const perCallOf = (side: OpenSide): number => postsPerCall(side, policy);
      const roles = rolesFor(policy.judge.primary, firstSide !== null, mainStoryJudge !== null);
      const said = describeRoles(policy.judge.primary, roles, { configured: firstSide !== null, model: firstSide === null ? null : sideName(firstSide) });
      log.info(said.message, said.fields);
      log.info('open judge order for the post and kind questions', { first: firstSide === null ? null : sideName(firstSide), behind: behindSide === null ? null : sideName(behindSide), postFirst: cfg.postJudgeFirst });
      /* ★ THE FAILOVER IS ON WHEN THERE IS A SECOND OPEN MODEL (the owner, 2026-10-16): with both hosts
         at boot the first model's failures go to the other whatever Policy.judge.failover.on says;
         with one, the policy's switch stands (off from v90: nothing to fail over to). */
      const failoverPolicy = firstSide !== null && behindSide !== null ? { ...policy.judge.failover, on: true } : policy.judge.failover;
      const mainPostJudge = buildJudge(cfg, meter, policy, log, policy.judge.postBatchMaxOutputTokens, 'post', null, withPrecedents);
      const postJudgeAs = (role: JudgeRole, examples: string | null, endpoint?: string): JudgePort | null =>
        role === 'open'
          ? firstSide === null
            ? null
            : buildOpenJudge(firstSide.setup, firstSide.model, meter, policy, policy.judge.postBatchMaxOutputTokens, 'post', examples, withPrecedents, endpoint, perCallOf(firstSide))
          : examples === null && endpoint === undefined
            ? mainPostJudge
            : buildJudge(cfg, meter, policy, log, policy.judge.postBatchMaxOutputTokens, 'post', examples, withPrecedents, endpoint);
      const kindJudgeAs = (role: JudgeRole): JudgePort | null =>
        role === 'open'
          ? firstSide === null
            ? null
            : buildOpenJudge(firstSide.setup, firstSide.model, meter, policy, policy.judge.postBatchMaxOutputTokens, 'kind')
          : buildJudge(cfg, meter, policy, log, policy.judge.postBatchMaxOutputTokens, 'kind');
      /* ★ FAILOVER (judge-failover.ts, Policy.judge.failover): a batch the primary fails — an error, a
         billing refusal, no reply in time — is answered by the other judge at once, and the primary
         rests before it is asked again. One memory for both questions: one supplier serves both. */
      const failover = failoverState();
      const failoverLog = log.child({ step: 'judge-failover' });
      const withFallback = (primary: JudgePort | null, fallback: JudgePort | null, question: string): JudgePort | null =>
        primary === null
          ? fallback
          : failoverJudge({ primary, fallback, state: failover, policy: failoverPolicy, names: { primary: roles.primary === 'open' && firstSide !== null ? sideName(firstSide) : roles.primary, fallback: roles.other ?? (behindSide === null ? 'none' : sideName(behindSide)) }, question, log: failoverLog, now: () => Date.now() });
      /* ★ THE SHADOW (judge-shadow.ts, Policy.judge.shadow): the role that did not answer, built with
         the same block on every swap, under its own ledger endpoint, its answers in their own table. */
      let shadowPort: JudgePort | null = null;
      /* The other open model asked the post question with the same block and precedents; only behind the first. */
      const behindPostJudge = (examples: string | null): JudgePort | null =>
        roles.primary !== 'open' || behindSide === null ? null : buildOpenJudge(behindSide.setup, behindSide.model, meter, policy, policy.judge.postBatchMaxOutputTokens, 'post', examples, withPrecedents, undefined, perCallOf(behindSide));
      /* The post judge for one learned block: the primary role's with the other behind it (the other open model when there is no other role). */
      const livePostJudge = (examples: string | null): JudgePort | null => {
        shadowPort = roles.other === null || !policy.judge.shadow.on ? null : postJudgeAs(roles.other, examples, SHADOW_ENDPOINT);
        return withFallback(postJudgeAs(roles.primary, examples), roles.other === null ? behindPostJudge(examples) : postJudgeAs(roles.other, examples), 'post');
      };
      const learning = new PgLearningRepo(db);
      /* With no main key the open model is the post judge (rolesFor): the feed must not stop for it. */
      const anyPostJudge = mainPostJudge ?? livePostJudge(null);
      const learned =
        anyPostJudge === null
          ? null
          : learnedJudge({
              latest: () => learning.latestApplied(),
              build: (examples) => livePostJudge(examples) ?? anyPostJudge,
              log: log.child({ step: 'learned-examples' }),
            });
      if (learned !== null) {
        await learned.refresh();
        setInterval(() => void learned.refresh(), EXAMPLES_RECHECK_MS).unref();
      }
      const postJudge = learned?.port ?? null;
      const shadow =
        roles.other === null || !policy.judge.shadow.on
          ? null
          : judgeShadow({
              port: () => shadowPort,
              ownAnswer: (judgeId) => isOpenJudgeId(judgeId) === (roles.other === 'open'),
              ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'judge-shadow' })),
              pairs: new PgJudgeShadowRepo(db),
              meter,
              policy,
              log: log.child({ step: 'judge-shadow' }),
              now: () => Date.now() as Millis,
            });
      if (shadow !== null) log.info('judge shadow on: the other judge answers every live batch beside it, never shown', { shadow: roles.other, capUsd: policy.judge.shadow.dailyUsd });
      /* The feed's second question — which kind of post — asked only of posts the first passed;
         see `kindJudge` in work/score-posts.ts. The primary role's model, its own prompt set and hash. */
      const mainKindJudge = (): JudgePort | null =>
        withFallback(
          kindJudgeAs(roles.primary),
          roles.other !== null ? kindJudgeAs(roles.other) : roles.primary === 'open' && behindSide !== null ? buildOpenJudge(behindSide.setup, behindSide.model, meter, policy, policy.judge.postBatchMaxOutputTokens, 'kind') : null,
          'kind',
        );

      /* ★ WHO ASKS THE OTHER QUESTIONS (Policy.judge.askWith, open-questions.ts): `open` puts a
         question on the open model with the other open model behind it, through the same failover
         rules, and the main judge nowhere in its chain (the owner, 2026-10-16: no main-judge API from
         now on); `main` leaves it on the main judge; `off` asks no one. Names, translations and the
         narrative and same-subject questions go to the router's model first (Gemma 3, the cheaper:
         $0.08 in a million tokens against Nemotron's $0.15) with the second host's behind it, one rest
         for all of them: its supplier being down is one fact. The kind question goes in the post
         question's order (`firstSide`) and shares its rest: the For You numbers the owner chose
         Nemotron on were measured with Nemotron naming the kind, and a kind call on the router while
         Nemotron answers the post would read, to the alarm, as a backup asked and answering nothing.
         A question whose model has no key is not asked, in its typed absence. */
      const askWith = policy.judge.askWith;
      const openSide: OpenSide | null = routerSide;
      const openAsk = openSide === null ? null : buildOpenQuestions(openSide, meter, policy);
      const backupAsk = backupSide === null ? null : buildOpenQuestions(backupSide, meter, policy);
      const openRest = failoverState();
      const openPair = <P,>(build: (q: ReturnType<typeof buildOpenQuestions>) => P, question: string) =>
        openAsk === null
          ? null
          : { primary: build(openAsk), fallback: backupAsk === null ? null : build(backupAsk), state: openRest, policy: failoverPolicy, names: { primary: 'open', fallback: 'backup' }, question, log: failoverLog, now: () => Date.now() };
      const firstAsk = firstSide === null ? null : firstSide === openSide ? openAsk : backupAsk;
      const behindAsk = behindSide === null ? null : behindSide === openSide ? openAsk : backupAsk;
      const openJudgePair = (question: 'story' | 'kind'): JudgePort | null => {
        if (question === 'kind')
          return firstAsk === null || firstSide === null
            ? null
            : failoverJudge({ primary: firstAsk.kind(), fallback: behindAsk === null ? null : behindAsk.kind(), state: failover, policy: failoverPolicy, names: { primary: sideName(firstSide), fallback: behindSide === null ? 'none' : sideName(behindSide) }, question, log: failoverLog, now: () => Date.now() });
        const pair = openPair((q) => q[question](), question);
        return pair === null ? null : failoverJudge(pair);
      };
      const pick = <T,>(who: AskWith, open: () => T | null, main: () => T | null): T | null => (who === 'open' ? open() : who === 'main' ? main() : null);
      /* ★ The kind question must never be left without a judge: a post the first question passed
         waits for it, so a missing one empties For You (2026-10-17 11:06–15:30 UTC: with Nemotron
         first and no separate backup host, the pair below had no first side and answered nothing).
         With no pair, the post question's own judges ask it, in the same order. */
      const kindJudge = pick(askWith.kind, () => openJudgePair('kind') ?? mainKindJudge(), mainKindJudge);
      /* QUALIFY's narrative question. */
      const judge = pick(askWith.stories, () => openJudgePair('story'), () => mainStoryJudge);
      /* The same-subject question for borderline pictures (work/image-pairs.ts), GROUP's and the coin match's. */
      const pairsJudge = pick<SameSubjectPart>(
        askWith.sameSubject,
        () => ((p) => (p === null ? null : failoverSameSubject(p)))(openPair((q) => q.sameSubject(), 'same-subject')),
        () => (mainStoryJudge?.sameSubject === undefined ? null : (mainStoryJudge as SameSubjectPart)),
      );
      const translator = pick<TranslatePort>(askWith.translate, () => ((p) => (p === null ? null : failoverTranslator(p)))(openPair((q) => q.translator(), 'translate')), () => buildTranslator(cfg, meter, policy));
      const namer = pick<NamePort>(askWith.names, () => ((p) => (p === null ? null : failoverNamer(p)))(openPair((q) => q.namer(), 'names')), () => buildNamer(cfg, meter, policy));
      log.info('the judge\'s other questions: who asks each', {
        askWith,
        open: openSide?.model.id ?? null,
        backup: backupSide?.model.id ?? null,
        names: namer?.model ?? null,
        translate: translator?.model ?? null,
        kind: kindJudge?.id ?? null,
        stories: judge?.id ?? null,
        sameSubject: pairsJudge?.id ?? null,
      });
      /* The embed port the narratives pass uses for a good post with no vector (work/narratives.ts). */
      const precedentsEmbed =
        cfg.embeddings.state === 'configured'
          ? voyageEmbed({
              client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
              meter,
              now: () => Date.now() as Millis,
            })
          : null;
      /* The labels and vectors behind the precedents and the not-a-meme hold, kept for the process. */
      const precedents =
        cfg.embeddings.state === 'configured'
          ? precedentSource({
              embed: voyageEmbed({
                client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                meter,
                now: () => Date.now() as Millis,
              }),
              labels: new PgLabelEmbeddingRepo(db),
              posts: new PgPostEmbeddingRepo(db),
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'precedents' }),
              now: () => Date.now() as Millis,
            })
          : null;
      /* Early judging's own precedents (work/early-judge.ts): the same labels and vectors, read by a
         second source whose embeddings are tallied, so the pass can charge its lane what they cost. */
      const earlyEmbedUsd = { total: 0 };
      const earlyPrecedents =
        cfg.embeddings.state === 'configured' && policy.judge.early.on
          ? precedentSource({
              embed: ((port) => ({
                ...port,
                ...(port.embedPosts === undefined
                  ? {}
                  : {
                      embedPosts: async (posts: Parameters<NonNullable<typeof port.embedPosts>>[0], budget: Parameters<NonNullable<typeof port.embedPosts>>[1]) => {
                        const r = await port.embedPosts!(posts, budget);
                        earlyEmbedUsd.total += r.spend.usd;
                        return r;
                      },
                    }),
              }))(
                voyageEmbed({
                  client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                  meter,
                  now: () => Date.now() as Millis,
                }),
              ),
              labels: new PgLabelEmbeddingRepo(db),
              posts: new PgPostEmbeddingRepo(db),
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'early-precedents' }),
              now: () => Date.now() as Millis,
            })
          : null;
      const early = earlyJudge({
        judge: postJudge,
        kindJudge,
        precedents: earlyPrecedents,
        junkFilter: new PgJunkFilterRepo(db),
        items: repos.items,
        scores: new PgPostJudgementRepo(db),
        ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'early-lane' })),
        embedSpentUsd: () => earlyEmbedUsd.total,
        watchHandles: () => watchState.list?.handles ?? [],
        meter,
        mode: cfg.spend.kind,
        policy,
        log: log.child({ step: 'early-judge' }),
        now: () => Date.now() as Millis,
      });
      /* The namer: example posts and their vectors kept for the process, guesses after each scoring pass. */
      const names = nameGuesser({
        namer,
        embed:
          cfg.embeddings.state === 'configured'
            ? voyageEmbed({
                client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                meter,
                now: () => Date.now() as Millis,
              })
            : null,
        examples: new PgNameExampleRepo(db),
        guesses: new PgNameGuessRepo(db),
        meter,
        mode: cfg.spend.kind,
        policy,
        log: log.child({ step: 'name-guesses' }),
        now: () => Date.now() as Millis,
      });

      const runtimeDeps: PlatformRuntime = {
        meter,
        now: () => Date.now(),
        /* Read off `globalThis` HERE and nowhere below. Every adapter takes it as a
           dep precisely so that no package under adapters/ can reach the network from
           a unit test; this is the one file entitled to hand over the real one. */
        fetch: globalThis.fetch,
        /**
         * ★ A WARMED HANDLE CACHE. One source addresses posts by URL, so re-reading one
         * needs the author's handle; this signature is synchronous and cannot await the
         * author row, so TRACK fills the cache from the store just before it asks
         * (work/handle-cache.ts). A post with no handle there is still SKIPPED rather
         * than requested under a guessed URL — a wrong URL costs a paid run and returns
         * nothing. Until 2026-10-13 this returned null for every post, and no short
         * video was ever re-read.
         */
        handles: (source, sourceItemId) => sourceHandles.get(String(source), sourceItemId),
      };

      const platforms = watchedRegistry(resolvePlatforms(cfg.sourceEnv, runtimeDeps), watch);

      /* Each coin's metadata document, through each gateway in turn; the last one's failure is the
         coin's, retried later. Shared by the universe loop and the coin-link finder. */
      const metadataReader: MetadataReader = {
        read: async (uri) => {
          let failure: unknown = null;
          for (const gateway of cfg.metadataGateways) {
            try {
              return await fetchMetadata(uri, { gateway, fetch: globalThis.fetch, timeoutMs: policy.universe.metadataTimeoutMs, maxBytes: policy.universe.metadataMaxBytes });
            } catch (e) {
              failure = e;
            }
          }
          throw failure ?? new Error('no metadata gateway configured');
        },
      };
      /* The finders' sources: on the live meter, with the handles the links they read carry, and
         the warmed cache behind them. Built per pass, as the missed-posts step builds its own. */
      const finderSources = (handles: (source: string, sourceItemId: string) => string | null) =>
        resolvePlatforms(cfg.sourceEnv, { ...runtimeDeps, handles: (source, id) => handles(String(source), id) ?? sourceHandles.get(String(source), id) }).all();
      const finderClock = searchWordClock();
      const feedClock = trendingFeedClock();

      /* Built after the sources, because TRACK's re-read is a call to one of them. */
      const work = storeWork(
        repos,
        policy,
        {
          judge,
          judgements: new PgJudgementRepo(db),
          meter,
          mode: cfg.spend.kind,
          policy,
          log: log.child({ step: 'judge' }),
        },
        {
          platforms,
          meter,
          mode: cfg.spend.kind,
          log: log.child({ step: 'track' }),
          now: () => Date.now() as Millis,
          spentSince: (vendor, endpoint, sinceMs) => new PgSpendRepo(db).usdSince(vendor, endpoint, sinceMs),
          gone: { repo: new PgGonePostRepo(db), log: log.child({ step: 'gone-posts' }) },
        },
        /* GROUP's picture evidence: stored image vectors, the judge's names, and the
           same-subject question for borderline pictures (asked with QUALIFY's judge). */
        {
          images: new PgImageEmbeddingRepo(db),
          postScores: new PgPostJudgementRepo(db),
          storyJudgements: new PgJudgementRepo(db),
          pairs:
            pairsJudge === null
              ? null
              : {
                  judge: pairsJudge,
                  pairs: new PgImagePairRepo(db),
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'image-pairs' }),
                  now: () => Date.now() as Millis,
                },
        },
      );

      /* ★ WRITTEN AT BOOT AND NOT ONLY PER PASS. The dormant/failing distinction has to
         be true on a deploy where discovery is switched off entirely, and it has to be
         true within seconds of a restart rather than at the end of the first cadence —
         otherwise a fresh process spends five minutes with an indicator that says
         nothing at all about sources it already knows everything about. */
      await declareSources(platforms, watch);
      log.info('sources resolved', {
        live: platforms.all().map((a) => String(a.id)),
        dark: platforms.absent().map((a) => `${a.source}:${a.configuration}`),
      });

      const loopDeps: LoopDeps = {
        policy,
        policyHash: hash,
        decisions: decisionLog,
        log,

        admit: work.admit,
        track: work.track,
        detect: work.detect,
        group: work.group,
        qualify: work.qualify,
        resolve: work.resolve,
        rank: work.rank,
      };

      /**
       * ★ THE PARTITION IS CREATED BEFORE THE FIRST DECISION OF THE DAY, NOT AFTER.
       *
       * Today's and tomorrow's, both, and tomorrow's is the one that matters: a runner
       * that only ever creates today's has nothing in place at midnight, and the first
       * rows of the new day land in `decisions_default` — which is the row the schema
       * defines as "the partition-maintenance job stopped running". Creating a day
       * ahead means the maintenance signal only ever fires when maintenance has
       * genuinely stopped for more than a day.
       */
      const maintenance: Maintenance = {
        ensurePartitions: async (now) => {
          const made: string[] = [];
          for (const offset of [0, MS_PER_DAY]) {
            const day = new Date(now + offset).toISOString().slice(0, DATE_LENGTH);
            await decisions.ensurePartition(day);
            made.push(day);
          }
          return made;
        },
        countUnapplied: async (sinceMs, limit) =>
          (await decisions.unapplied(sinceMs, limit)).length,
      };

      /* The coin lookup's sources, made once for the life of the process. The on-chain search
         keeps its own per-minute count and a minute's cache of answers; made afresh each pass,
         both were thrown away every minute and the count guarded nothing. With a CoinGecko key
         `cfg.marketData` is the paid plan at its own host, and its limit is that plan's. */
      const onChainMarket = geckoterminal({ ...cfg.marketData, fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS, now: Date.now });
      /* The keyless search, free a call: the narrative pages' posts are searched on it alone. */
      const freeSearch = dexscreenerSearch({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS });
      const lookupSources = [freeSearch, onChainMarket];
      /* The narrative posts' chain reads this process made today, kept across passes (coin-lookup.ts). */
      const narrativeChainReads = { day: 0, reads: 0 };
      log.info('coin lookup sources', { onChainPlan: cfg.marketData.plan });

      return {
        value: await use({
          db,
          stageRuns,
          loopDeps,
          maintenance,
          platforms,
          watch,
          meter,
          store: storeArrivals(repos, policy, () => Date.now() as Millis),
          feedFloors: new PgFeedFloorRepo(db),
          /* The posts supplier's catch-all endpoint, as its adapter records it (its SEARCH). */
          /* The whole X day: search, re-reads and replies on one bill, as the owner's $7 means. */
          searchDay: {
            spent: async (vendor, now) => {
              const spend = new PgSpendRepo(db);
              const from = searchDayStart(now, policy) as Millis;
              const parts = await Promise.all(X_DAY_ENDPOINTS.map((e) => spend.usdSince(vendor, e, from)));
              return parts.reduce((a, b) => a + b, 0);
            },
          },
          middleLane: {
            ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'middle-lane' })),
            uncredited: (ids) => repos.items.uncredited(ids),
          },
          readings: () =>
            readingsPass(
              {
                platforms,
                readings: new PgReadingsRepo(db),
                observations: repos.observations,
                ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'readings-lane' })),
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'readings' }),
                now: () => Date.now() as Millis,
                sortTop: sortTopPosts,
                gone: { repo: new PgGonePostRepo(db), log: log.child({ step: 'gone-posts' }) },
              },
              readingNotes,
            ),
          nameSearch: async () => {
            /* ★ The meme-war word search (`feed.fightWords`, work/fight-words.ts) every turn of this loop,
               inside the X search day's pace as the discover pass reads it. */
            const war = await fightWordsPass({
              sources: () => platforms.all(),
              narratives: new PgNarrativeRepo(db),
              store: storeArrivals(repos, policy, () => Date.now() as Millis),
              uncredited: (ids) => repos.items.uncredited(ids),
              ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'fight-words-lane' })),
              searchDay: {
                spent: async (vendor, now) => {
                  try {
                    const spend = new PgSpendRepo(db);
                    const from = searchDayStart(now, policy) as Millis;
                    const parts = await Promise.all(X_DAY_ENDPOINTS.map((e) => spend.usdSince(vendor, e, from)));
                    return parts.reduce((a, b) => a + b, 0);
                  } catch {
                    return null;
                  }
                },
              },
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'fight-words' }),
              now: () => Date.now() as Millis,
            });
            const now = Date.now();
            /* A minute's slack, so a loop turn a few seconds early does not skip the name search for a whole turn. */
            if (now - namesRanAt < policy.feed.narrativeNames.everyMs - 60_000) {
              return { narratives: 0, named: 0, asked: war.asked, returned: war.returned, fresh: war.fresh, usd: war.usd, stopped: null };
            }
            namesRanAt = now;
            const names = await narrativeNamesPass(
              {
                sources: () => platforms.all(),
                narratives: new PgNarrativeRepo(db),
                store: storeArrivals(repos, policy, () => Date.now() as Millis),
                uncredited: (ids) => repos.items.uncredited(ids),
                ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'name-search-lane' })),
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'name-search' }),
                now: () => Date.now() as Millis,
              },
              nameClock,
            );
            return { ...names, asked: names.asked + war.asked, returned: names.returned + war.returned, fresh: names.fresh + war.fresh, usd: names.usd + war.usd };
          },
          quoteSearch: () =>
            quoteSearchPass(
              {
                sources: () => platforms.all(),
                targets: new PgQuoteTargetRepo(db),
                store: storeArrivals(repos, policy, () => Date.now() as Millis),
                uncredited: (ids) => repos.items.uncredited(ids),
                ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'quote-lane' })),
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'quote-search' }),
                now: () => Date.now() as Millis,
              },
              quotesAsked,
            ),
          accountWatch: () =>
            accountWatchPass(
              {
                sources: () => platforms.all(),
                accounts: new PgWatchAccountRepo(db),
                store: storeArrivals(repos, policy, () => Date.now() as Millis),
                uncredited: (ids) => repos.items.uncredited(ids),
                ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'account-lane' })),
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'account-watch' }),
                now: () => Date.now() as Millis,
              },
              watchState,
            ),
          embedImages: () =>
            embedImages({
              embed:
                cfg.embeddings.state === 'configured'
                  ? voyageEmbed({
                      client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                      meter,
                      now: () => Date.now() as Millis,
                    })
                  : null,
              images: new PgImageEmbeddingRepo(db),
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'embed-images' }),
              now: () => Date.now() as Millis,
            }),
          universe: {
            coins: new PgCoinUniverseRepo(db),
            metadata: metadataReader,
            /* A link with no content id, from its own host behind the adapter's address fence. */
            declared: (uri) => fetchDeclaredMetadata(uri, { fetch: globalThis.fetch, timeoutMs: policy.universe.metadataTimeoutMs, maxBytes: policy.universe.metadataMaxBytes }),
            platforms,
            items: repos.items,
            authors: repos.authors,
            postScores: new PgPostJudgementRepo(db),
            images: new PgImageEmbeddingRepo(db),
            store: storeArrivals(repos, policy, () => Date.now() as Millis),
            postJudge,
            shadow,
            embed:
              cfg.embeddings.state === 'configured'
                ? voyageEmbed({
                    client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                    meter,
                    now: () => Date.now() as Millis,
                  })
                : null,
            pairs:
              pairsJudge === null
                ? null
                : { judge: pairsJudge, pairs: new PgImagePairRepo(db), mode: cfg.spend.kind, policy, log: log.child({ step: 'image-pairs' }), now: () => Date.now() as Millis },
            meter,
            mode: cfg.spend.kind,
            policy,
            log,
          },
          /* The lookup, then the picture evidence for what it found (work/coin-match.ts), then
             whether the older coins it saw are trading since their posts (work/older-coins.ts),
             read through the lookup's own on-chain instance so one per-minute count covers both. */
          lookUpCoins: async () => {
            const looked = await lookUpCoins({
              older: new PgOlderCoinRepo(db),
              coins: new PgCoinUniverseRepo(db),
              assets: repos.assets,
              sources: lookupSources,
              freeSources: [freeSearch],
              chainReads: narrativeChainReads,
              chain: cfg.chainRpcUrl === null ? null : chainClient({ launchpadBaseUrl: '', rpcUrl: cfg.chainRpcUrl, fetch: globalThis.fetch }),
              policy,
              log: log.child({ step: 'coin-lookup' }),
              now: () => Date.now() as Millis,
            });
            /* The coins the owner named by address and we do not hold yet (work/owner-coins.ts). */
            try {
              await addOwnerCoins({
                learning: new PgLearningRepo(db),
                assets: repos.assets,
                sources: lookupSources,
                chain: cfg.chainRpcUrl === null ? null : chainClient({ launchpadBaseUrl: '', rpcUrl: cfg.chainRpcUrl, fetch: globalThis.fetch }),
                log: log.child({ step: 'owner-coins' }),
                now: () => Date.now() as Millis,
              });
            } catch (e) {
              log.warn("the coins the owner named could not be added this pass; tried again next pass", { err: e instanceof Error ? e.message : String(e) });
            }
            await pictureCoinMatches(
              {
                coins: new PgCoinUniverseRepo(db),
                images: new PgImageEmbeddingRepo(db),
                embed:
                  cfg.embeddings.state === 'configured'
                    ? voyageEmbed({
                        client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                        meter,
                        now: () => Date.now() as Millis,
                      })
                    : null,
                pairs:
                  pairsJudge === null
                    ? null
                    : { judge: pairsJudge, pairs: new PgImagePairRepo(db), mode: cfg.spend.kind, policy, log: log.child({ step: 'image-pairs' }), now: () => Date.now() as Millis },
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'coin-match' }),
                now: () => Date.now() as Millis,
              },
              policy.universe.matchWindowMs,
            );
            /* Every new coin's logo and every feed post's picture hashed (work/picture-hashes.ts):
               free, so the coin match can find a coin by its picture whatever it is named. */
            try {
              await hashPictures({ hashes: new PgImageHashRepo(db), gateways: cfg.metadataGateways, fetch: globalThis.fetch, policy, log: log.child({ step: 'picture-hashes' }), now: () => Date.now() as Millis });
            } catch (e) {
              log.warn('pictures could not be hashed this pass; tried again next pass', { err: e instanceof Error ? e.message : String(e) });
            }
            try {
              await checkOlderCoins({ older: new PgOlderCoinRepo(db), candles: onChainMarket, log: log.child({ step: 'older-coins' }), now: () => Date.now() as Millis });
            } catch (e) {
              log.warn('older coins could not be measured this pass; tried again next pass', { err: e instanceof Error ? e.message : String(e) });
            }
            return looked;
          },
          /* ★ THE LEARNING BOOK, NOT THE LIVE ONE. Each pass with work opens its own meter on
             `learning` (Policy.budget.learningLines), reading today's ledger fresh, with every
             spend labelled `learn:` as tools/lib/shared-meter.ts labels it, and its own sources
             built on that meter with the handles the pasted links carry. The live meter above is
             never handed to it. */
          missedPosts: () =>
            workMissedPosts({
              missed: new PgMissedPostRepo(db),
              openLearning: async (handles) => {
                const book = await openDurableMeter({
                  ledger: new PgSpendRepo(db),
                  book: 'learning',
                  /* The re-tune's reserve is not this work's (Policy.budget.learningLines.retuneReserveUsd). */
                  dailyCapUsd: learningDailyCapUsd(policy, 'work'),
                  perVendorCapUsd: jobVendorLines(policy, 'learning'),
                  defaultVendorCapUsd: policy.budget.perSourceUsdPerDay,
                  vendorLinesWarnOnly: !policy.budget.vendorLinesStop,
                  softStop: policy.budget.softStopFraction,
                  now: () => Date.now(),
                  onWriteFailure: (spend, error) =>
                    log.error('a learning spend could not be persisted', { vendor: spend.vendor, usd: spend.usd, err: error instanceof Error ? error.message : String(error) }),
                });
                const learning: Meter = { ...book, record: (spend) => book.record({ ...spend, endpoint: `${LEARN_ENDPOINT_PREFIX}${spend.endpoint}` }) };
                const sources = resolvePlatforms(cfg.sourceEnv, { meter: learning, now: () => Date.now() as Millis, fetch: globalThis.fetch, handles: (source, id) => handles(String(source), id) });
                return { sources: sources.all(), meter: learning, close: () => book.drain() };
              },
              store: storeArrivals(repos, policy, () => Date.now() as Millis),
              coinSearch: lookupSources,
              settings: async () => (await measureDiscovery({ recall: new PgRecallRepo(db), floors: new PgFeedFloorRepo(db) }, Date.now() as Millis, policy))?.settings ?? null,
              outages: () => readOutages(new PgMissedPostRepo(db), policy, Date.now()),
              /* The posts supplier's catch-all endpoint, as its adapter records it (its SEARCH). */
              searchUsdPerDay: () => new PgMissedPostRepo(db).liveSpendSince(SUPPLIER_VENDORS.posts, 'search', (Date.now() - SPEND_WINDOW_MS) as Millis),
              /* ★ The live post judge, as the instant path asks it of a given queue, on the live line (policy.v145 `narrative.origin.missedJudge`). */
              judge: async (ids) => {
                const queue = [...(await repos.items.byIds(ids.map((id) => id as ItemId))).values()];
                const r = await scorePosts({
                  judge: postJudge,
                  kindJudge,
                  precedents,
                  items: instantItems(queue, repos.items),
                  scores: new PgPostJudgementRepo(db),
                  meter,
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'missed-judge' }),
                  now: () => Date.now() as Millis,
                });
                return { judged: r.scored, usd: r.spentUsd };
              },
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'missed-posts' }),
              now: () => Date.now() as Millis,
            }),
          oneCoin: (() => {
            const state = newOneCoinState();
            const embed =
              cfg.embeddings.state === 'configured'
                ? voyageEmbed({
                    client: voyageClient({ apiKey: cfg.embeddings.apiKey, baseUrl: cfg.embeddings.baseUrl, fetch: globalThis.fetch }),
                    meter,
                    now: () => Date.now() as Millis,
                  })
                : null;
            const pictures = { embed, meter, mode: cfg.spend.kind, images: new PgImageEmbeddingRepo(db), log: log.child({ step: 'one-coin' }), now: () => Date.now() as Millis };
            /* One repo for the process: it mirrors the candidate table and reads only what changed (store `PgOneCoinRepo`). */
            const oneCoinRepo = new PgOneCoinRepo(db, { mirrorCandidates: true });
            return () =>
              oneCoinPass(
                {
                  repo: oneCoinRepo,
                  coinFirstLaunches: (sinceMs, limit, hashVersion) => new PgOneCoinRepo(db).coinFirstLaunches(sinceMs, limit, hashVersion),
                  /* The posts whose newest coin call is not "cleared": the stated name never re-opens the owner's call. */
                  ownerCalled: async (ids) => {
                    const newest = new Map<string, string>();
                    for (const r of await new PgOwnerCoinCallRepo(db).rows(ids)) newest.set(r.itemId, r.verdict);
                    return new Set([...newest].filter(([, v]) => v !== 'cleared').map(([id]) => id));
                  },
                  ...(embed === null ? {} : { embed: (coins: readonly { readonly assetKey: string; readonly uri: string }[]) => embedCoinPictures(pictures, coins, 'one coin') }),
                  policy,
                  log: log.child({ step: 'one-coin' }),
                  now: () => Date.now() as Millis,
                },
                state,
              );
          })(),
          finders: {
            coinLinks: () =>
              coinLinksPass({
                finders: new PgFinderRepo(db),
                coins: new PgCoinUniverseRepo(db),
                metadata: metadataReader,
                declared: (uri) => fetchDeclaredMetadata(uri, { fetch: globalThis.fetch, timeoutMs: policy.universe.metadataTimeoutMs, maxBytes: policy.universe.metadataMaxBytes }),
                sources: finderSources,
                follow: (url) => followLink(url, globalThis.fetch),
                items: repos.items,
                store: storeArrivals(repos, policy, () => Date.now() as Millis),
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'coin-links' }),
                now: () => Date.now() as Millis,
              }),
            /* Built once: it keeps its own count of the last minute's posts. The same judges, precedents
               and line as the scoring pass below, over a queue of only the posts the coin rule picked. */
            instant: instantJudge({
              finders: new PgFinderRepo(db),
              items: repos.items,
              score: (queue) =>
                scorePosts({
                  judge: postJudge,
                  kindJudge,
                  precedents,
                  items: instantItems(queue, repos.items),
                  scores: new PgPostJudgementRepo(db),
                  meter,
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'coin-instant' }),
                  now: () => Date.now() as Millis,
                }),
              policy,
              log: log.child({ step: 'coin-instant' }),
              now: () => Date.now() as Millis,
            }),
            /* The coin-first route: its own clock and its own record (0116); the same judges as the instant judge. */
            coinFirst: (() => {
              const state = newCoinFirstState();
              return () =>
                coinFirstPass(
                  {
                    repo: new PgCoinFirstRepo(db),
                    items: repos.items,
                    sources: finderSources,
                    store: storeArrivals(repos, policy, () => Date.now() as Millis),
                    score: (queue) =>
                      scorePosts({
                        judge: postJudge,
                        kindJudge,
                        precedents,
                        items: instantItems(queue, repos.items),
                        scores: new PgPostJudgementRepo(db),
                        meter,
                        mode: cfg.spend.kind,
                        policy,
                        log: log.child({ step: 'coin-first' }),
                        now: () => Date.now() as Millis,
                      }),
                    meter,
                    mode: cfg.spend.kind,
                    policy,
                    log: log.child({ step: 'coin-first' }),
                    now: () => Date.now() as Millis,
                  },
                  state,
                );
            })(),
            reposts: () =>
              repostsPass({
                finders: new PgFinderRepo(db),
                shortLinks: SHORT_LINKS,
                sources: finderSources,
                follow: (url) => followLink(url, globalThis.fetch),
                items: repos.items,
                store: storeArrivals(repos, policy, () => Date.now() as Millis),
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'reposts' }),
                now: () => Date.now() as Millis,
              }),
            searchWords: () =>
              searchWordsPass(
                {
                  finders: new PgFinderRepo(db),
                  sources: () => platforms.all(),
                  store: storeArrivals(repos, policy, () => Date.now() as Millis),
                  meter,
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'search-words' }),
                  now: () => Date.now() as Millis,
                  /* The learned-tag lane (`finders.learnedTags`): the latest re-tune's tags, its own cap (0088). */
                  learnedTags: {
                    tags: () => new PgCoinedVideoRepo(db).latestTags(),
                    ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'learned-tags' })),
                    uncredited: (ids) => repos.items.uncredited(ids),
                  },
                },
                finderClock,
              ),
            trendingFeed: () =>
              trendingFeedPass(
                {
                  sources: () => platforms.all(),
                  store: storeArrivals(repos, policy, () => Date.now() as Millis),
                  meter,
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'trending-feed' }),
                  now: () => Date.now() as Millis,
                },
                feedClock,
              ),
          },
          keepCoins: () =>
            keepCoins({
              coins: new PgCoinUniverseRepo(db),
              standings: dexscreenerStandings({ baseUrl: 'https://api.dexscreener.com', fetch: globalThis.fetch, timeoutMs: SEARCH_TIMEOUT_MS }),
              policy,
              log: log.child({ step: 'coin-keep' }),
              now: () => Date.now() as Millis,
            }),
          backfill: () =>
            backfillStories({
              platforms,
              stories: repos.stories,
              names: new PgJudgementRepo(db),
              items: repos.items,
              backfill: new PgBackfillRepo(db),
              store: storeArrivals(repos, policy, () => Date.now() as Millis),
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'backfill' }),
              now: () => Date.now() as Millis,
            }),
          scorePosts: () =>
            scorePosts({
              judge: postJudge,
              kindJudge,
              precedents,
              shadow,
              /* Read only while Policy.judge.junkFilter.on; before 0091 it reads no fit and every post is judged. */
              junkFilter: new PgJunkFilterRepo(db),
              items: repos.items,
              scores: new PgPostJudgementRepo(db),
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'score-posts' }),
              now: () => Date.now() as Millis,
            }),
          earlyJudge: early,
          guessNames: () => names.pass(),
          cryptoAttention: () =>
            readCryptoAttention({
              platforms,
              attention: new PgCryptoAttentionRepo(db),
              kinds: new PgPostJudgementRepo(db),
              items: repos.items,
              meter,
              mode: cfg.spend.kind,
              policy,
              log: log.child({ step: 'crypto-attention' }),
              now: () => Date.now() as Millis,
            }),
          /* The poster-profile re-read rides the same half-minute loop after it (work/bio-refresh.ts):
             off until Policy.postCoin.bio.refreshOn, and then only every refreshEveryMs per poster.
             Then the feed's translations (work/translate-posts.ts): off until Policy.translate.on;
             a failure there is logged and never fails the refill. */
          /* ★ NARRATIVES (the owner, 2026-10-16): the judge's passed posts regrouped every couple of
             minutes and written in one short transaction; titled by the open model on its own ledger
             endpoint; a good post with no vector embedded on the live embeddings line. */
          narratives: (() => {
            const space = precedentsEmbed?.postSpace ?? null;
            /* The meme-war question rides on the title call (Policy.narrative.fight) and needs room in the answer. */
            const titleTokens = policy.narrative.fight.on ? Math.max(policy.narrative.title.maxOutputTokens, policy.narrative.fight.maxOutputTokens) : policy.narrative.title.maxOutputTokens;
            const grouper = narrativeGrouper({
              repo: new PgNarrativeRepo(db),
              save: (pass) => withTransaction(pool, (tx) => new PgNarrativeRepo(tx).save(pass)),
              block: async () => ((b) => ({ cutoff: b?.cutoff ?? null, chosenOn: b?.cutoffModel ?? null }))(await new PgLearningRepo(db).latestApplied()),
              titler:
                openSide === null
                  ? null
                  : openTitler({
                      client: openChatClient({
                        vendor: openSide.setup.vendor,
                        apiKey: openSide.setup.apiKey,
                        baseUrl: openSide.setup.baseUrl,
                        model: openSide.model.id,
                        vision: false,
                        maxOutputTokens: titleTokens,
                        timeoutMs: policy.judge.timeoutMs,
                        maxAttempts: policy.judge.maxAttempts,
                        backoffMs: policy.judge.backoffMs,
                        maxWaitMs: policy.judge.maxWaitMs,
                        maxFrameBytes: policy.judge.maxFrameBytes,
                        providers: openSide.setup.providers,
                        router: openSide.setup.router !== false,
                        fetch: globalThis.fetch,
                        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
                      }),
                      meter,
                      now: () => Date.now() as Millis,
                      model: openSide.model,
                      vendor: openSide.setup.vendor,
                      providers: openSide.setup.providers,
                      router: openSide.setup.router !== false,
                      charsPerToken: policy.judge.charsPerToken,
                      maxOutputTokens: titleTokens,
                      maxTitleChars: policy.narrative.title.maxTitleChars,
                      ...(policy.narrative.fight.on ? { maxCountries: policy.narrative.fight.maxCountries } : {}),
                    }),
              embed: precedentsEmbed,
              keepVectors: (rows, postSpace) => new PgPostEmbeddingRepo(db).putMany(rows, postSpace),
              meter,
              mode: cfg.spend.kind,
              policy,
              postSpace: space,
              log: log.child({ step: 'narratives' }),
              now: () => Date.now() as Millis,
            });
            /* After each pass, both on from 2026-10-18: the page coins' launch from the chain
               (work/launch-clock.ts) and one backward name search per new narrative (work/narrative-back.ts).
               Either failing is logged and never fails the narratives pass. */
            const chain = cfg.chainRpcUrl === null ? null : chainClient({ launchpadBaseUrl: '', rpcUrl: cfg.chainRpcUrl, fetch: globalThis.fetch });
            const launchTried = new Set<string>();
            const launchToday = { day: '', read: 0 };
            const backAsked = new Set<string>();
            return async () => {
              const r = await grouper.pass();
              await launchClockPass(
                {
                  due: (limit) => new PgNarrativeRepo(db).pageCoinsWithoutChainTime(limit),
                  oldestBlockTime: chain === null ? null : (address) => chain.oldestSignatureBlockTime(address),
                  keep: (address, atMs) => new PgAssetRepo(db).setMintTime(`solana:${address}` as AssetKey, { at: atMs, source: 'chain_rpc', confidence: 'exact', boundS: null }),
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'launch-clock' }),
                  now: () => Date.now() as Millis,
                },
                launchTried,
                launchToday,
              ).catch((e: unknown) => log.warn('launch times not read this pass', { err: errorText(e) }));
              await narrativeBackPass(
                {
                  sources: () => platforms.all(),
                  narratives: new PgNarrativeRepo(db),
                  store: storeArrivals(repos, policy, () => Date.now() as Millis),
                  uncredited: (ids) => repos.items.uncredited(ids),
                  ledger: laneLedger(new PgLaneSpendRepo(db), log.child({ step: 'name-back-lane' })),
                  meter,
                  mode: cfg.spend.kind,
                  policy,
                  log: log.child({ step: 'name-back' }),
                  now: () => Date.now() as Millis,
                },
                backAsked,
              ).catch((e: unknown) => log.warn('backward name search not run this pass', { err: errorText(e) }));
              return r;
            };
          })(),
          /* ★ OUR OWN COIN MODEL (the owner, 2026-10-18): the posts the judge said no to, scored once
             each on their facts at the answer, in its own loop; free, no paid call. Shadow until the
             owner switches Policy.judge.coinModel.on. */
          coinModel: () =>
            scoreCoinModel({
              repo: new PgCoinModelRepo(db),
              vectors: new PgJunkFilterRepo(db),
              policy,
              mode: cfg.spend.kind,
              log: log.child({ step: 'coin-model' }),
              now: () => Date.now() as Millis,
            }),
          refillPosts: async () => {
            const r = await refillPosts(
              {
                platforms,
                refill: new PgPostRefillRepo(db),
                authors: repos.authors,
                meter,
                mode: cfg.spend.kind,
                policy,
                log: log.child({ step: 'post-refill' }),
                now: () => Date.now() as Millis,
              },
              refills,
            );
            const bios = await refreshBios(
              { db, platforms, authors: repos.authors, meter, mode: cfg.spend.kind, policy, log: log.child({ step: 'bio-refresh' }), now: () => Date.now() as Millis, onlySources: cfg.bioRefreshSources },
              bioReads,
            );
            const translated = await translatePosts({ translator, translations, meter, mode: cfg.spend.kind, policy, log: log.child({ step: 'translate-posts' }), now: () => Date.now() as Millis }).catch((e: unknown) => {
              log.warn('feed translations failed this pass', { err: errorText(e) });
              return null;
            });
            return { ...r, due: r.due + bios.due, authors: r.authors + bios.read, wouldSpendUsd: r.wouldSpendUsd + bios.wouldSpendUsd, spentUsd: r.spentUsd + bios.spentUsd + (translated?.usd ?? 0) };
          },
        }),
      };
    });

    if (outcome === null) {
      throw new Error(
        `another runner already holds ${cfg.singletonLockName}; refusing to start a second one`,
      );
    }
    return outcome.value;
  } finally {
    await pool.end();
    await lockPool.end();
  }
}
