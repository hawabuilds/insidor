/**
 * THE PUBLIC VOCABULARY — the one legitimate barrel in the repository.
 *
 * It is legitimate because this genuinely is a public surface: every other package
 * imports it and it imports nothing. It stays a table of contents rather than fog by
 * re-exporting names, never modules — a barrel that re-exports two hundred names is
 * how import cycles get created without anybody choosing one.
 *
 * Deep imports are also supported and are preferred inside a package that needs one
 * corner of the vocabulary: `@insidor/contracts/policy.ts`, `@insidor/contracts/ports/venue.ts`.
 */

/* ── identity ─────────────────────────────────────────────────────────── */
export type {
  AssetKey,
  AssetRef,
  AuthorKey,
  CandidateId,
  ChainId,
  ItemId,
  SourceId,
  StoryId,
  VenueId,
} from './ids.ts';
export {
  assetKey,
  authorKey,
  candidateId,
  chainId,
  itemId,
  parseAssetKey,
  sourceId,
  storyId,
  venueId,
} from './ids.ts';

/* ── the nouns ────────────────────────────────────────────────────────── */
export type {
  Author,
  CensorReason,
  Counter,
  CounterKind,
  CounterSet,
  Fidelity,
  Fingerprint,
  FingerprintKind,
  Item,
  MediaRef,
  Millis,
  Observation,
  Rate,
  StoredRate,
} from './vocabulary.ts';
export {
  CENSOR_REASONS,
  COUNTER_KINDS,
  FINGERPRINT_KINDS,
  censoredRate,
  measuredRate,
  toStoredRate,
} from './vocabulary.ts';

/* ── stories ──────────────────────────────────────────────────────────── */
export type { MatchEvidence, Story, StoryMember, StoryOrigin, StoryState } from './story.ts';
export { coinOriginsVisibleTo, STORY_ORIGINS, STORY_STATES } from './story.ts';

/* ── assets and markets ───────────────────────────────────────────────── */
export type {
  Asset,
  AssetOrigin,
  Depth,
  MarketAbsenceReason,
  MarketCapBasis,
  MarketClass,
  MarketState,
  MintTime,
  MintTimeConfidence,
  MintTimeSource,
  ObservedAssetOrigin,
  TradeCost,
  TradeCostCode,
  TradeQuote,
  TransferRules,
} from './asset.ts';
export {
  ASSET_ORIGINS,
  MARKET_ABSENCE_REASONS,
  MARKET_CAP_BASES,
  MARKET_CLASSES,
  MINT_TIME_CONFIDENCES,
  MINT_TIME_SOURCES,
  OBSERVED_ASSET_ORIGINS,
  TRADE_COST_CODES,
} from './asset.ts';

/* ── judgement ────────────────────────────────────────────────────────── */
export type { Judgement } from './judgement.ts';

/* ── features and deciders ────────────────────────────────────────────── */
export type { FeatureSetId, FeatureVector, Scorer, Scorers, Shadow } from './features.ts';

/* ── decisions ────────────────────────────────────────────────────────── */
export type {
  Decision,
  DecisionDraft,
  ExploreArm,
  Stage,
  StageContext,
  StageName,
  SubjectKind,
  Verdict,
} from './decision.ts';
export { STAGE_NAMES, VERDICTS } from './decision.ts';

/* ── reasons ──────────────────────────────────────────────────────────── */
export type { ReasonCode } from './reasons.ts';
export { REASON_CODES, isReasonCode, reasonPrefix } from './reasons.ts';

/* ── policy ───────────────────────────────────────────────────────────── */
export type {
  AdmitPolicy,
  AssetPolicy,
  BudgetPolicy,
  DeepReadonly,
  DetectPolicy,
  ExplorePolicy,
  GroupPolicy,
  KineticsPolicy,
  MarketPolicy,
  Policy,
  QualifyPolicy,
  RankPolicy,
  ResolvePolicy,
  TrackPolicy,
} from './policy.ts';
export { DEFAULT_POLICY, deepFreeze } from './policy.ts';

/* ── ports ────────────────────────────────────────────────────────────── */
export type {
  Capabilities,
  Discovered,
  DiscoveryMode,
  DiscoveryQuery,
  PlatformAdapter,
} from './ports/platform.ts';
export { DISCOVERY_MODES } from './ports/platform.ts';

export type {
  MintEvent,
  MintPage,
  QuoteRequest,
  QuoteResult,
  Signer,
  TradeReceipt,
  Venue,
  VenueAssess,
  VenueCapability,
  VenueRead,
  VenueTrade,
  VenueWatch,
} from './ports/venue.ts';
export { VENUE_CAPABILITIES } from './ports/venue.ts';

export type { JudgeOutcome, JudgePort, JudgeSubject } from './ports/judge.ts';
export type { EmbedPort, Embedding } from './ports/embed.ts';

export type { BillingUnit, Budget, Meter, Metered, Spend } from './ports/meter.ts';
export { BILLING_UNITS } from './ports/meter.ts';

export type {
  AssetRepo,
  AuthorRepo,
  CarrierHit,
  CarrierRepo,
  CoverageRepo,
  DecisionRepo,
  ItemRepo,
  Label,
  LabelRepo,
  LabelStatus,
  ObservationRepo,
  PolicyRepo,
  StageRunOutcome,
  StageRunRepo,
  Store,
  StoryRepo,
} from './ports/store.ts';
export { LABEL_STATUSES, STAGE_RUN_OUTCOMES } from './ports/store.ts';
