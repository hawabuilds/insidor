/**
 * The evaluation surface: replay, the frozen gold set, the blind protocol.
 *
 * Nothing in this package touches the network. That is enforced structurally —
 * eval is forbidden from importing adapters — and it is what makes a replay a
 * replay rather than a re-run against whatever the vendors say today.
 */

export { laneOf, populationCaveat, supportsArrivalStreamClaim, LANES } from './lane.ts';
export type { Lane } from './lane.ts';

export { replay } from './replay/harness.ts';
export type { Redecider, Redecision, ReplayOptions, ReplayResult, ReplayFlip, ReplayLimits } from './replay/harness.ts';
export { fromArray, fromJsonl, asDecision, DecisionParseError } from './replay/source.ts';
export type { DecisionSource } from './replay/source.ts';
export { summarise, transitionMatrix, countTransition, VERDICTS } from './replay/diff.ts';
export type { ReplaySummary, TransitionCell } from './replay/diff.ts';
export { renderReport } from './replay/report.ts';
export type { ReportMeta } from './replay/report.ts';
export { coreStages, requireStage, gateRedecider, scoredRedecider, STAGE_NAMES } from './replay/core-stages.ts';
export type { GatedStage, GateRedeciderOptions, ScoredRedeciderOptions } from './replay/core-stages.ts';

export { GOLD_CASES, toGateInput, SYMBOL_PROVENANCE } from './gold/cases.ts';
export type { GoldCase, GoldCandidate, GoldStory, GoldGateInput, SymbolProvenance, MintTimeConfidence } from './gold/cases.ts';
export { runGold, describeGold } from './gold/run.ts';
export type { GoldOutcome, GoldReport, GoldRunOptions, ResolverGate } from './gold/run.ts';

export { buildBlindSheet, caseKeyFor } from './blind/sheet.ts';
export type { BlindSheet, BlindRow, BlindUnit, AnswerFile, AnswerRow, SheetMeta } from './blind/sheet.ts';
export { redact, assertBlind, BlindnessError, SHEET_FIELDS, FORBIDDEN_SUBSTRINGS } from './blind/redact.ts';
export { reveal, renderReveal, RevealError } from './blind/reveal.ts';
export type { FilledRow, RevealResult, Cell } from './blind/reveal.ts';
export { shuffle, mulberry32 } from './blind/seeded-random.ts';
