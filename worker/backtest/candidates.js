#!/usr/bin/env node
'use strict';

/**
 * Stage 2 — name plausibility + X official post evidence.
 * Skips non_narrative calibration tokens; retains only viral posts (≥100k views).
 *
 *   npm run backtest:candidates -- --mint=<mint>
 *   npm run backtest:candidates -- --all
 */

const { loadEnvLocal } = require('../lib/env');
const { getServiceClient } = require('../lib/supabase');
const { CONFIG, parseArgs } = require('./lib/config');
const { assertOfficialBudget, recordOfficialReads, COST_PER_READ } = require('./lib/budget-guard');
const { evaluateNamePlausibility } = require('./lib/name-filter');
const { searchOriginatingPost, isPlausibleMatch } = require('./lib/post-search');
const { shouldSearchForViralPost, cohortAfterStage2 } = require('./lib/narrative-cohort');
const {
  createRun,
  finishRun,
  latestRunForStage,
  upsertCandidate,
  countCandidatesByStatus,
  fetchClassifiedTokens,
  updateTokenNarrativeCohort,
} = require('./lib/persist');

function printStage2Report({
  runId, tokenRunId, counts, retained, retainedNarrative, stopped, tokensPulled, searched,
}) {
  console.log('\n=== STAGE 2 · NARRATIVE SAMPLE — STOP HERE ===');
  console.log(`candidates run_id: ${runId}`);
  console.log(`tokens run_id: ${tokenRunId}`);
  console.log(`tokens in run: ${tokensPulled} · X searched: ${searched}`);
  console.log(`skipped non_narrative (no X): ${counts.skipped_non_narrative}`);
  console.log(`rejected on name: ${counts.rejected_name}`);
  console.log(`rejected on no viral post: ${counts.rejected_no_post}`);
  console.log(`retained (all): WINNER ${retained.winner} · LOSER ${retained.loser}`);
  console.log(
    `retained NARRATIVE: WINNER ${retainedNarrative.winner} · LOSER ${retainedNarrative.loser} ` +
    `(gate ≥${CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP}/group)`,
  );
  if (stopped) {
    console.log(
      `\n⛔ STOP — narrative retained below ${CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP} in at least one group.`,
    );
    console.log('Widen BACKTEST_LOOKBACK_DAYS or add narrative calibration mints.');
    console.log('Do NOT run backtest:features until narrative groups are large enough.');
  } else {
    console.log('\n✓ Narrative sample OK — npm run backtest:features');
  }
}

async function resolveTokenRunId(sb, flags) {
  if (flags.runId) return flags.runId;
  const latest = await latestRunForStage(sb, 'tokens');
  if (!latest) throw new Error('No tokens run found — run npm run backtest:tokens first');
  return latest.id;
}

async function processToken(sb, runId, token, { singleTest = false } = {}) {
  const cohortIn = token.narrative_cohort || 'unknown';

  if (!shouldSearchForViralPost(token)) {
    const cohort = 'non_narrative';
    await updateTokenNarrativeCohort(sb, token.id, cohort);
    if (singleTest) {
      console.log(`[backtest:candidates] SKIP X — non_narrative calibration (${token.ticker})`);
    }
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
    if (singleTest) console.log(`[backtest:candidates] NAME REJECT: ${nameCheck.reason}`);
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

  const search = await searchOriginatingPost(token, { printRaw: singleTest });
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

  if (singleTest) {
    console.log('\n--- SINGLE TOKEN TEST — STOP ---');
    console.log(`mint: ${token.mint} · ticker: ${token.ticker} · cohort: ${cohortIn} → ${cohortOut}`);
    console.log(`reads: ${search.tweetsRead} · queries: ${search.queriesRun}`);
    if (best) {
      console.log(`confidence: ${best.confidence.toFixed(2)} · retained: ${retained}`);
      console.log(`url: ${best.url}`);
    }
  }

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

async function main() {
  loadEnvLocal();
  if (!process.env.X_OFFICIAL_BEARER_TOKEN) {
    throw new Error('Missing X_OFFICIAL_BEARER_TOKEN');
  }

  const flags = parseArgs();
  const sb = getServiceClient();
  const tokenRunId = await resolveTokenRunId(sb, flags);

  const allClassified = await fetchClassifiedTokens(sb, tokenRunId, {});
  const tokensPulled = allClassified.length;

  if (!flags.mint && !flags.all) {
    console.log('[backtest:candidates] No --mint or --all — refusing to run.');
    console.log('  One token: npm run backtest:candidates -- --mint=<mint>');
    console.log('  Full set:  npm run backtest:candidates -- --all');
    process.exit(0);
  }

  const tokens = flags.mint
    ? await fetchClassifiedTokens(sb, tokenRunId, { mint: flags.mint })
    : allClassified;

  if (!tokens.length) {
    throw new Error(
      flags.mint
        ? `Mint ${flags.mint} not in tokens run ${tokenRunId}`
        : `No classified tokens in run ${tokenRunId}`,
    );
  }

  const runId = await createRun(sb, 'candidates', { ...CONFIG, tokenRunId, mint: flags.mint || null, all: !!flags.all });
  console.log(`[backtest:candidates] run ${runId} · token run ${tokenRunId}`);
  console.log(`viral bar: ≥${CONFIG.MIN_VIRAL_VIEWS} views · search window: ${CONFIG.POST_SEARCH_HOURS_BEFORE_LAUNCH}h`);

  if (flags.mint) {
    await processToken(sb, runId, tokens[0], { singleTest: true });
    const counts = await countCandidatesByStatus(sb, runId);
    await finishRun(sb, runId, { stats: counts });
    printStage2Report({
      runId,
      tokenRunId,
      counts,
      retained: counts.retained,
      retainedNarrative: counts.retained_narrative,
      stopped: false,
      tokensPulled,
      searched: 1,
    });
    return;
  }

  const toSearch = tokens.filter(shouldSearchForViralPost);
  await assertOfficialBudget({
    stage: 'candidates-full',
    projectedReads: Math.min(toSearch.length * 45, 500),
  });

  let nameRejected = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    try {
      if (shouldSearchForViralPost(token)) {
        const nameCheck = evaluateNamePlausibility({ ticker: token.ticker, name: token.name });
        if (!nameCheck.pass) nameRejected += 1;
      }
      await processToken(sb, runId, token);
    } catch (e) {
      console.warn(`[backtest:candidates] ${token.ticker || token.mint.slice(0, 8)}: ${e.message}`);
    }
    if ((i + 1) % 10 === 0) console.log(`[backtest:candidates] ${i + 1}/${tokens.length}`);
  }

  const counts = await countCandidatesByStatus(sb, runId);
  const retainedNarrative = counts.retained_narrative;
  const stopped =
    retainedNarrative.winner < CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP ||
    retainedNarrative.loser < CONFIG.MIN_RETAINED_NARRATIVE_PER_GROUP;

  await finishRun(sb, runId, {
    status: stopped ? 'stopped' : 'done',
    stats: { ...counts, stopped, nameRejectedLogged: nameRejected },
  });

  printStage2Report({
    runId,
    tokenRunId,
    counts,
    retained: counts.retained,
    retainedNarrative,
    stopped,
    tokensPulled,
    searched: toSearch.length,
  });
}

main().catch(err => {
  console.error('[backtest:candidates]', err.message || err);
  process.exit(1);
});
