/**
 * THE CLOSED REASON VOCABULARY. Every Decision carries exactly one of these,
 * including the ones that passed.
 *
 * WHY closed, and why never free text: a named reason is what turns "the pipeline
 * looks quiet" into a one-line query that says which gate ate the traffic. The
 * build this replaces lost seven hours to an outage it could not distinguish from
 * a quiet night, because nothing wrote down WHY the count was zero.
 *
 * WHY it survives the rule-to-model swap: when a stage becomes a model, the reason
 * stays one of these codes and the top contributing feature is recovered from the
 * logged feature vector. The diagnostic query does not change on the day the
 * decider does — which is the point of logging a `decider` string separately.
 *
 * Prefixes are the stage: A admit, T track, D detect, M group/match, Q qualify,
 * G resolve gates, V resolve verdicts, R rank, S shared. Numbers are stable
 * forever: renumbering breaks every dashboard and every historical comparison.
 * Add codes; never reuse one.
 */

/** code → the one-line meaning. The value is documentation, never rendered to a user. */
export const REASON_CODES = {
  /* ── ADMIT — is this worth spending money to track? ──────────────────── */
  A0_admitted: 'passed every gate and cleared the admission bar',
  A1_rebroadcast_not_original: 'a copy that created no new authored object',
  A2_empty: 'no text and no media',
  A3_too_old: 'older than the admission window at first sight',
  A4_score_below_bar: 'scored under the nightly admission quantile',
  A5_author_suppressed: 'author is on the suppression roster',
  A6_engagement_bait: 'solicits interaction rather than reproducing anything',
  A7_thread_continuation: 'a continuation of the author’s own prior item',
  A8_duplicate_item: 'already admitted under a different source id',
  A9_budget_exhausted: 'admission budget for the interval was spent',
  A10_holdout_admitted: 'admitted unconditionally as part of the holdout lane',
  A11_explore_admitted: 'admitted from below the cut as an exploration draw',

  /* ── TRACK — when do we look again? ──────────────────────────────────── */
  T0_scheduled: 'a read is due on the current tier',
  T1_tier_demoted: 'demoted a tier after a flat interval',
  T2_budget_shed: 'tier dropped under read-budget backpressure',
  T3_terminal: 'lifecycle reached a terminal state; tracking stops',
  T4_unreachable: 'the item could not be re-read; the source returned nothing',
  T5_holdout_full_grid: 'tracked on the full grid regardless of score',
  T6_not_due: 'the next read is not due yet',

  /* ── DETECT — is this accelerating relative to its own baseline? ─────── */
  D0_burst: 'atypical against its own trailing baseline',
  D1_insufficient_history: 'fewer readings than a difference requires',
  D2_rate_censored: 'the reading carried no usable rate; nothing was published',
  D3_below_absolute_floor: 'under the hard floor beneath the relative test',
  D4_baseline_unavailable: 'no population baseline for this cohort and hour',
  D5_no_acceleration: 'fast and slow averages agree; nothing is bending',

  /* ── GROUP — which story is this? ────────────────────────────────────── */
  M0_carrier_join: 'shares an exact carrier with an existing story',
  M1_lineage_join: 'points at a member through a reproduction pointer',
  M2_semantic_join: 'joined on representation similarity after the free tiers missed',
  M3_below_match_bar: 'best candidate scored under the match bar',
  M4_ambiguous_match: 'two candidates within the adjudication band',
  M5_generic_carrier: 'the shared carrier is too common to be evidence',
  M6_no_candidate_block: 'nothing to compare against in the candidate block',
  M7_promoted: 'crossed the promotion bar and became a story',
  M8_merged: 'merged into an older story that shares its carriers',
  M9_member_cap: 'story is at its member cap for the interval',

  /* ── QUALIFY — is there a nameable, coinable thing here? ─────────────── */
  Q0_coinable: 'nameable, specific, and judged coinable',
  Q1_unjudged: 'the judge was never called or failed; we abstain rather than guess',
  Q2_single_author: 'fewer distinct authors than the floor',
  Q3_too_thin: 'fewer members than the floor',
  Q4_unnameable: 'no name was proposed',
  Q5_generic_name: 'the proposed name is on the generic list',
  Q6_name_too_short: 'the proposed name is under the length floor',
  Q7_name_unspecific: 'the proposed name does not distinguish this story from its neighbours',
  Q8_score_below_bar: 'scored under the qualification bar',
  Q9_judged_not_coinable: 'our gates passed; the judge said there is nothing to name',

  /* ── RESOLVE gates, in the order they cost money ─────────────────────── */
  G1_mint_time_unknown: 'the asset’s origin time is not known to a usable confidence',
  G2_predates_post: 'the asset existed before the earliest post; not minted from it',
  G3_too_late: 'the asset appeared outside the trailing window',
  G4_major: 'an established asset, excluded by list',
  G5_transfer_rules_unread: 'the asset’s transfer rules could not be read in full',
  G6_nonstandard_transfer: 'the asset carries a non-standard transfer rule',
  G7_unquotable: 'no executable quote at the probe size',
  G7_vendor_unavailable: 'the quote could not be obtained; this is our outage, not their illiquidity',
  G8_cost_absurd: 'all-in cost above the ceiling a user should ever pay',

  /* ── RESOLVE verdicts ────────────────────────────────────────────────── */
  V0_confirmed: 'one candidate cleared the bar and beat the runner-up by the margin',
  V1_unsure_margin: 'the best candidate is not separated from the second',
  V2_unsure_score: 'no candidate cleared the confidence bar',
  V3_no_candidates: 'nothing was minted in the window',
  V4_venue_cold_start: 'this venue has too few adjudicated labels to confirm anything',
  V5_adopted: 'the asset predates the story and was adopted by it, not minted from it',

  /* ── RANK ────────────────────────────────────────────────────────────── */
  R0_ranked: 'placed on the board',
  R1_below_cut: 'outside the published slot count',
  R2_dwell_hold: 'held in place by the minimum dwell',
  R3_hysteresis_hold: 'challenger did not beat the incumbent by the swap edge',
  R4_new_entrant: 'entered early on the new-entrant escape hatch',
  R5_features_stale: 'the newest input is older than the tick allows',
  R6_explore_slot: 'placed from below the cut into an exploration slot',

  /* ── SHARED ──────────────────────────────────────────────────────────── */
  S0_not_applicable: 'this stage has nothing to say about this subject',
  S1_input_incomplete: 'a required input was missing; we abstain rather than decide blind',
  S2_stage_disabled: 'the stage is disabled by policy',
  S3_shadow_only: 'a challenger ran on the champion’s frozen features and changed nothing',
} as const;

/** The only legal value of `Decision.reason`. */
export type ReasonCode = keyof typeof REASON_CODES;

/** Guard for values arriving from storage or a wire, where the type is a promise. */
export function isReasonCode(value: string): value is ReasonCode {
  return Object.hasOwn(REASON_CODES, value);
}

/** The stage letter, for grouping in dashboards without a second table. */
export function reasonPrefix(code: ReasonCode): string {
  return code.slice(0, 1);
}
