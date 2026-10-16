/**
 * The public surface of the logic: seven stages and the constructor they all return.
 *
 * EIGHT NAMES, and the number is the point. A barrel listing eight names is a table
 * of contents; a barrel re-exporting two hundred is fog, and it is how import cycles
 * get created without anyone choosing one. Everything else in this package is a
 * helper that one of these eight calls, and a service that needs a helper directly is
 * a service doing something core should be doing.
 *
 * Every one of these is synchronous, and that is a guarantee rather than a style: a
 * function typed to return a Decision rather than a promise of one cannot suspend,
 * so it cannot fetch, cannot query, cannot call a hosted model, and cannot quietly
 * recompute a feature from data fresher than the vector it logged. Replaying any past
 * decision under a new policy therefore needs no network, no key and no clock — which
 * is what makes the whole learning plan possible.
 *
 * Types come from @insidor/contracts, with one exception noted below. Nothing else is
 * re-exported from here, so there is exactly one place any type in this system is
 * named.
 *
 * ★ AND THEN RANK MADE IT TWELVE, WHICH IS A DECISION RATHER THAN A DRIFT — so it is
 * argued here instead of appearing in a diff as three more lines.
 *
 * The rule above is "everything else is a helper that one of these calls". RANK
 * breaks it, because RANK is three public things and none of them calls another:
 *
 *   rank()          scores ONE subject against ONE incumbent and writes the row.
 *   commitBoard()   takes the whole tick's scores and produces the committed order.
 *   kendallTau()    says how much that order moved since the last tick.
 *
 * The first two are split by rank/heat.ts's candidate isolation, which is a product
 * requirement: a score that could see another candidate would make a past board
 * impossible to reproduce, so the board transition cannot live inside a per-subject
 * stage. It cannot live outside core either — it is the ordering the product ships,
 * and it is the one thing here a client is structurally forbidden from recomputing.
 * The third is a measurement of OUR OWN behaviour rather than of the world, which is
 * exactly why it is core's to compute, the decision log's to hold, and no screen's to
 * render; see rank/stability.ts.
 *
 * `BoardSlot` and `TickScore` come with them, and they are the stated exception to
 * "types come from contracts". They are core's own: a bench row is not a noun the
 * rest of the system knows about, and a caller cannot feed a tick in without them.
 *
 * The wide feature builders are NOT here, deliberately. Each is called at the moment
 * of the decision whose row it rides on, by that stage's own wiring, and a service
 * reaching for `itemFeatures` directly is a service about to write a vector that no
 * decision was ever made against.
 */

export { decide } from './decide.ts';

export { admit } from './admit/stage.ts';
export { track } from './track/stage.ts';
export { detect } from './detect/stage.ts';
export { group, joinTarget } from './group/stage.ts';
export { afterMembership, joinMember, owesASeed, seedStory } from './group/membership.ts';
export { withTextHash } from './group/text-carrier.ts';
export { NO_PICTURE_INPUTS, nameKey } from './group/picture.ts';
export { NAME_SPAN_PREFIX, nameCarriers, nameSpanKey, withNameCarriers } from './group/name-span.ts';
export type { PictureInputs } from './group/picture.ts';
export { qualify, worthJudging } from './qualify/stage.ts';
export { presentationFor } from './qualify/presentation.ts';
export { couldPassWithBoost, passesWithSignal, postScore, postScoreReason } from './qualify/post-score.ts';
export { KIND_LABELS, NEVER_SHOWN_KINDS, NEWS_KINDS, NOT_MEME_MATCH, heldKind, isNewsKind } from './qualify/kinds.ts';
export { closestNot, embedInput, heldAsNotMeme, nearestLabelled, ownSourceFirst, postPicture, precedentsFor, sourceOfItemId, type LabelledVector, type Neighbour } from './qualify/precedents.ts';
export type { HeldKind, NeverShownKind, NewsKind } from './qualify/kinds.ts';
export type { CryptoSignal, PassRoute, PostScoreReason } from './qualify/post-score.ts';
export { clearsReachBar } from './qualify/reach-bar.ts';
export type { ReachBar, ReachLevel } from './qualify/reach-bar.ts';
export { SCORE_SIGNALS, postRankScore, postSignals, termInput } from './qualify/post-rank.ts';
export type { PostSignals, RankFacts, ScoreFit, ScoreSignal, ScoreTerm } from './qualify/post-rank.ts';
export { addressesIn, attentionFacts, cashtagsIn, hasCryptoSignal, isCryptoAccount, isShill, isShillText, othersSignal } from './qualify/attention.ts';
export type { AnsweredPost, AttentionFacts, CoinTalk } from './qualify/attention.ts';
export type { PostScore } from './qualify/post-score.ts';
export { resolve } from './resolve/stage.ts';
export { rank } from './rank/stage.ts';

export { commitBoard, committed } from './rank/hysteresis.ts';
export type { BoardSlot, TickScore } from './rank/hysteresis.ts';
export { kendallTau, stabilityState } from './rank/stability.ts';

/**
 * ★ AND THEN THIRTEEN, for a function that decides no verdict and writes no row —
 * so it is argued here rather than appearing in a diff as one more line.
 *
 * `sourceState` is not a stage. It answers "is this source live, dormant or
 * failing", which is a fact about OUR OWN machinery rather than about the world,
 * and by the rule stated for `kendallTau` above that is exactly the kind of thing
 * core computes and no screen re-derives. It is here for the reason everything
 * else here is here: it turns on two thresholds, and a threshold typed into the
 * process that displays it is a threshold nobody can find later.
 *
 * It has two callers with nothing else in common — the process that CALLS the
 * sources, which needs to know whether it is running on nothing, and the process
 * that DRAWS them. Neither may hold its own copy of the rule: two spellings of a
 * three-way call drift, and they drift toward `live`, because that is the branch
 * nobody notices being wrong.
 */
export { liveCount, sourceState } from './sources/state.ts';

/**
 * The "is this ticker taken" rule, for the Create screen. Not a stage and it writes no row;
 * it is here because it turns on two policy numbers, and the line it produces — "You'd be
 * first" — is a claim a person acts on with money.
 */
export { tickerUse } from './create/ticker.ts';
export type { TickerEvidence, TickerUse } from './create/ticker.ts';
/* The Create sheet's name chips, from the judge's names for a post (create/name-ideas.ts). */
export { nameIdeas, tickerFor } from './create/name-ideas.ts';
export type { NameIdea, NameIdeaBars } from './create/name-ideas.ts';
/* The namer: example neighbours, clean guesses, and when a guess is a coin's name (create/name-guess.ts). */
export { cleanGuesses, cleanTicker, exampleShown, guessHit, guessIsCoin, guessesFirst, nameKeyOf, nearestExamples, sameName } from './create/name-guess.ts';
export type { ExampleVector } from './create/name-guess.ts';
/* Whether a feed post's words are sent for translation (translate/need.ts, Policy.translate). */
export { translateNeed, wordLetters } from './translate/need.ts';
export type { TranslateNeed } from './translate/need.ts';

/**
 * A re-read turned into the observations it appends. Not a stage: TRACK decides a read is
 * due, the runner takes it, and this decides what each counter's new rate is — a rule with
 * thresholds, so it lives here and nowhere else.
 */
export { latestCounters, observationsFrom } from './kinetics/readings.ts';
export { rankByVelocity } from './track/velocity.ts';
export type { VelocityRank } from './track/velocity.ts';

/**
 * The catch-all search's approval floor: what is sent, what each lane aims at, how a pass
 * moves it. Not a stage; a budget lever with policy thresholds, so it lives here.
 */
export { bandFloor, bandWindow, effectiveFloor, laneTargets, laneWindowMin, lateBandFloor, lateBands, nextFloor, sentFloors, sliceCoveredByBands, sliceCoveredByLateBand, slowLaneDue, startFloors } from './sources/feed-floor.ts';
export type { FloorMove, LaneFloors } from './sources/feed-floor.ts';
export { approvalsAt, crossingAgeMin, fitGrowthTau, inSearch, missReasonBefore, searchFilter, verdict } from './sources/recall.ts';
export type { DiscoverySettings, LaneSetting, PostFacts as RecallPostFacts, Verdict } from './sources/recall.ts';
export { MISSED_DIAGNOSES, MISSED_FAILURES, crossedBarAt, diagnoseMissed, missedSuggestion } from './learning/missed.ts';
export { outageGapMs, outages, postWindow } from './learning/outage.ts';
export type { Outage, PassRecord, PostWindow } from './learning/outage.ts';
export type { Diagnosed, MissedCase, MissedContext, MissedDiagnosis, MissedFailure, MissedJudgeAnswer, SearchKind, Suggestion, SuggestionInput } from './learning/missed.ts';
export { checkCreatorLink, decideOrigin, earliestByReproduction, earliestBySamePicture, matchCandidates, namesCoin } from './origin/check.ts';
export type { Candidate, CoinFacts, CreatorCheck, CreatorLink, MatchResult, OriginDecision, PostFacts } from './origin/check.ts';
export { mergeHits } from './search/merge.ts';
/* A feed post's coin, by evidence: the projector decides with it and the gold eval scores it,
   so both run the one rule (match/post-coin.ts). */
export { byEvidence, coinEvidence, compactName, descriptionMatch, linksAccount, matchPostCoin, nameMatch, pictureVerdict, postPictureVerdict, scoreOf, signals as postCoinSignals } from './match/post-coin.ts';
export type { CoinEvidence as PostCoinEvidence, CoinSide, MatchBars, NameMatch, PostCoinMatch, PostSide, ProvenBy } from './match/post-coin.ts';
export { postedAddresses } from './match/posted-addresses.ts';
export { bioAddresses } from './match/poster-bio.ts';
export type { PostedAddress } from './match/posted-addresses.ts';
/* The owner's coin calls on a post, folded in order: the projector, the re-tune and the coin-match
   refit read them through this one rule (match/owner-coin-calls.ts). */
export { addressOfCoinId, coinLabelOf, foldCoinCalls } from './match/owner-coin-calls.ts';
export type { CoinCallRow, PostCoinCalls } from './match/owner-coin-calls.ts';
/* "Coin for this story": the owner's confirmed coin on new posts about the same story (match/story-coin.ts). */
export { postWords, storyCoins } from './match/story-coin.ts';
export type { SharedDetail, StoryAnchor, StoryCoin, StoryCoinBars, StoryPost } from './match/story-coin.ts';
/* An older coin's trading against a post's time: the runner measures with it (match/older-coin.ts). */
export { olderCoinRun } from './match/older-coin.ts';
export type { OlderRun, OlderRunBars, VolumeBucket } from './match/older-coin.ts';
export { biggestFirst, groupCoins } from './history/group.ts';
export type { HistoryCoin, HistoryNarrative, PicturePair } from './history/group.ts';
export { RANKS, boughtEarly, earnsRep, goatCount, nextRank, rankFor, rankedUp, seasonOf, standings, votePoints } from './social/rank.ts';
export type { RankId, Standing } from './social/rank.ts';
export { ALERT_KINDS, FEED_KINDS, SWITCHES, defaultPrefs, deliveryFor, highestMilestone, isQuiet, normalisePrefs, spentWith, wants } from './notify/alerts.ts';
export type { AlertKind, AlertPrefs, AlertSwitch, Delivery } from './notify/alerts.ts';
