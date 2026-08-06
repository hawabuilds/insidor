#!/usr/bin/env node
'use strict';

/**
 * Combined stage 1 + 2 — loop discovery until full sample, then X narrative search.
 * Run: npm run backtest:pipeline
 */

const { loadEnvLocal } = require('../lib/env');
const { getServiceClient } = require('../lib/supabase');
const { CONFIG } = require('./lib/config');
const { runTokensStage } = require('./lib/run-tokens');
const { assertOfficialBudget, recordOfficialReads, COST_PER_READ } = require('./lib/budget-guard');
const { evaluateNamePlausibility } = require('./lib/name-filter');
const { searchOriginatingPost, isPlausibleMatch } = require('./lib/post-search');
const { shouldSearchForViralPost, cohortAfterStage2 } = require('./lib/narrative-cohort');
const {
  createRun,
  finishRun,
  upsertCandidate,
  countCandidatesByStatus,
  fetchClassifiedTokens,
  updateTokenNarrativeCohort,
} = require('./lib/persist');

async function processToken(sb, runId, token) {
  const cohortIn = token.narrative_cohort || 'unknown';

  if (!shouldSearchForViralPost(token)) {
    const cohort = 'non_narrative';
    await updateTokenNarrativeCohort(sb, token.id, cohort);
    return upsertCandidate(sb, runId, {
      token_id: token.id,
      outcome: token.outcome,
      status: 'skipped_non_narrative',
      narrative_cohort: cohort,
      name_pass: true,
      name_reject_reason: null,
      post_search_queries: null,
      match_confidence: null,
      match_reason: 'non_narrative cohort — no viral post expected',
    });
  }

  const nameCheck = evaluateNamePlausibility({ ticker: token.ticker, name: token.name });
  if (!nameCheck.pass) {
    return upsertCandidate(sb, runId, {
      token_id: token.id,
      outcome: token.outcome,
      status: 'rejected_name',
      narrative_cohort: cohortIn,
      name_pass: false,
      name_reject_reason: nameCheck.reason,
      post_search_queries: null,
      match_confidence: null,
      match_reason: nameCheck.reason,
    });
  }

  await assertOfficialBudget({ stage: 'candidates', projectedReads: 90 });

  const search = await searchOriginatingPost(token, { printRaw: false });
  await recordOfficialReads(sb, {
    runId,
    stage: 'candidates',
    reads: search.tweetsRead,
    cost: search.totalCost || search.tweetsRead * COST_PER_READ,
    note: `${token.ticker || token.mint} queries=${search.queriesRun}`,
  });

  const best = search.best;
  const hit = best ? {
    confidence: best.confidence,
    wrongCa: best.wrongCa,
    reason: best.reason,
    parsed: best.parsed,
  } : null;
  const retained = isPlausibleMatch(hit);
  const cohortOut = cohortAfterStage2(token, retained);
  await updateTokenNarrativeCohort(sb, token.id, cohortOut);

  const base = {
    token_id: token.id,
    outcome: token.outcome,
    narrative_cohort: cohortOut,
    name_pass: true,
    name_reject_reason: null,
    post_search_queries: search.queries,
    match_confidence: best?.confidence ?? 0,
    x_queries_run: search.queriesRun,
    x_tweets_read: search.tweetsRead,
    matched_platform_post_id: best?.platform_post_id || null,
    matched_post_text: best?.text || null,
    matched_post_at: best?.posted_at || null,
    matched_post_url: best?.url || null,
    matched_post_raw: best?.raw || null,
  };

  if (!retained) {
    const reason = search.tweetsRead === 0
      ? (search.historicalNote || 'X returned zero posts for pre-launch window')
      : (search.bestBelowBar
        ? `below viral bar (${CONFIG.MIN_VIRAL_VIEWS} views) — best: ${best?.url || 'n/a'}`
        : `no viral match (confidence ${best?.confidence?.toFixed?.(2) ?? '0'})`);
    return upsertCandidate(sb, runId, {
      ...base,
      status: 'rejected_no_post',
      match_reason: reason,
    });
  }

  return upsertCandidate(sb, runId, {
    ...base,
    status: 'retained',
    match_reason: best.reason,
  });
}

async function runCandidatesStage(sb, tokenRunId) {
  const tokens = await fetchClassifiedTokens(sb, tokenRunId, {});
  const toSearch = tokens.filter(shouldSearchForViralPost);

  await assertOfficialBudget({
    stage: 'candidates-full',
    projectedReads: Math.min(toSearch.length * 45, 500),
  });

  const runId = await createRun(sb, 'candidates', { ...CONFIG, tokenRunId, all: true });
  console.log(`\n[backtest:pipeline] stage 2 run ${runId} · ${tokens.length} tokens · ${toSearch.length} X searches`);

  for (let i = 0; i < tokens.length; i++) {
    try {
      await processToken(sb, runId, tokens[i]);
    } catch (e) {
      console.warn(`[backtest:candidates] ${tokens[i].ticker || tokens[i].mint.slice(0, 8)}: ${e.message}`);
    }
    if ((i + 1) % 10 === 0) console.log(`[backtest:pipeline] stage 2 · ${i + 1}/${tokens.length}`);
  }

  const counts = await countCandidatesByStatus(sb, runId);
  const retainedNarrative = counts.retained_narrative;
  const stopped =
    retainedNarrative.winner < CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP ||
    retainedNarrative.loser < CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP;

  await finishRun(sb, runId, {
    status: stopped ? 'stopped' : 'done',
    stats: { ...counts, stopped },
  });

  return { runId, counts, retainedNarrative, stopped, tokensPulled: tokens.length, searched: toSearch.length };
}

async function main() {
  loadEnvLocal();
  if (!process.env.X_OFFICIAL_BEARER_TOKEN) {
    throw new Error('Missing X_OFFICIAL_BEARER_TOKEN — required for stage 2 in pipeline');
  }

  const sb = getServiceClient();
  console.log(
    `[backtest:pipeline] ${CONFIG.LOOKBACK_DAYS}d lookback · target ${CONFIG.TARGET_PER_GROUP}/group · ` +
    `loop until full sample then stage 2`,
  );

  const stage1 = await runTokensStage(sb, { loopUntilTarget: true });

  console.log('\n=== STAGE 1 · OUTCOMES ===');
  console.log(`run_id: ${stage1.runId}`);
  console.log(`WINNER: ${stage1.final.winner} · LOSER: ${stage1.final.loser}`);

  if (!stage1.fullSample && !stage1.ok) {
    console.log('\n⛔ Stage 1 failed — not enough winners/losers. Re-run after fixing discovery.');
    process.exit(1);
  }

  const stage2 = await runCandidatesStage(sb, stage1.runId);

  console.log('\n=== STAGE 2 · NARRATIVE SAMPLE ===');
  console.log(`candidates run_id: ${stage2.runId}`);
  console.log(`tokens run_id: ${stage1.runId}`);
  console.log(`retained (all): WINNER ${stage2.counts.retained.winner} · LOSER ${stage2.counts.retained.loser}`);
  console.log(
    `retained NARRATIVE: WINNER ${stage2.retainedNarrative.winner} · LOSER ${stage2.retainedNarrative.loser} ` +
    `(gate ≥${CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP}/group)`,
  );

  if (stage2.stopped) {
    console.log('\n⛔ Narrative gate not met — widen lookback or add calibration mints.');
    process.exit(1);
  }

  console.log('\n✓ Pipeline OK — npm run backtest:features');
}

main().catch(err => {
  console.error('[backtest:pipeline]', err.message || err);
  process.exit(1);
});
