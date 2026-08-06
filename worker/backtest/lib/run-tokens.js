'use strict';

const { CONFIG, parseArgs } = require('./config');
const {
  createRun,
  finishRun,
  updateRunProgress,
  fetchRunById,
  fetchRunMintAddresses,
  latestRunForStage,
  upsertToken,
  countTokensByOutcome,
} = require('./persist');
const { exportTokensCsv } = require('./export-csv');
const { resolveNarrativeCohort } = require('./narrative-cohort');
const {
  discoverTokens,
  discoverFromBirdeye,
  enrichMint,
  classifyOutcome,
} = require('./token-source');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sortDiscoveryHits(hits, seedMints, counts) {
  const seedSet = new Set(seedMints);
  const needWinner = counts.winner < CONFIG.TARGET_PER_GROUP;
  const needLoser = counts.loser < CONFIG.TARGET_PER_GROUP;

  return [...hits].sort((a, b) => {
    const aSeed = seedSet.has(a.mint) ? 0 : 1;
    const bSeed = seedSet.has(b.mint) ? 0 : 1;
    if (aSeed !== bSeed) return aSeed - bSeed;
    if (needWinner !== needLoser) {
      return b.launchMs - a.launchMs;
    }
    return b.launchMs - a.launchMs;
  });
}

async function resolveResumeRunId(sb, flags) {
  if (flags.runId) return flags.runId;
  if (!flags.resume) return null;
  const latest = await latestRunForStage(sb, 'tokens');
  if (!latest) throw new Error('No tokens run to resume — run npm run backtest:tokens first');
  if (latest.status === 'done') {
    throw new Error(`Latest tokens run ${latest.id} already done — pass --run=<id> to resume a specific run`);
  }
  return latest.id;
}

async function loadResumeState(sb, runId) {
  const run = await fetchRunById(sb, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (run.stage !== 'tokens') throw new Error(`Run ${runId} is stage "${run.stage}", expected tokens`);

  const checkpoint = run.stats || {};
  const dbMints = await fetchRunMintAddresses(sb, runId);
  const processedMints = new Set([
    ...(checkpoint.processed_mints || []),
    ...dbMints,
  ]);

  const final = await countTokensByOutcome(sb, runId);
  const counts = {
    winner: final.winner,
    loser: final.loser,
    ignored: final.ignored,
    processed: checkpoint.processed || processedMints.size,
    skipped: checkpoint.skipped || 0,
  };

  const geckoStartPage = (checkpoint.gecko_last_pumpswap_page || 11) + 1;
  const skipNewPools = checkpoint.new_pools_scanned === true || dbMints.length > 0;
  const discoveryRound = checkpoint.discovery_round || 1;

  return {
    run,
    processedMints,
    counts,
    geckoStartPage,
    skipNewPools,
    discoveryRound,
    totalDiscovered: checkpoint.discovered || 0,
  };
}

async function saveCheckpoint(sb, runId, {
  processedMints, counts, discoveryRound, totalDiscovered, checkpoint,
}) {
  await updateRunProgress(sb, runId, {
    status: 'running',
    stats: {
      processed_mints: [...processedMints],
      gecko_last_pumpswap_page: checkpoint?.lastPumpswapPage ?? null,
      new_pools_scanned: checkpoint?.newPoolsScanned ?? false,
      discovery_round: discoveryRound,
      discovered: totalDiscovered,
      processed: counts.processed,
      skipped: counts.skipped,
      winner: counts.winner,
      loser: counts.loser,
      ignored: counts.ignored,
    },
  });
}

async function runTokensStage(sb, { loopUntilTarget = true, resumeRunId = null } = {}) {
  const cutoffMs = Date.now() - CONFIG.LOOKBACK_DAYS * 86_400_000;
  const target = CONFIG.TARGET_PER_GROUP;
  const minOk = CONFIG.MIN_RETAINED_PER_GROUP;
  const maxRounds = CONFIG.MAX_DISCOVERY_ROUNDS;
  const roundSleep = CONFIG.DISCOVERY_ROUND_SLEEP_MS;

  let runId;
  let processedMints;
  let counts;
  let discoveryRound;
  let totalDiscovered;
  let geckoStartPage = 1;
  let skipNewPools = false;

  if (resumeRunId) {
    const state = await loadResumeState(sb, resumeRunId);
    runId = resumeRunId;
    processedMints = state.processedMints;
    counts = state.counts;
    discoveryRound = state.discoveryRound;
    totalDiscovered = state.totalDiscovered;
    geckoStartPage = state.geckoStartPage;
    skipNewPools = state.skipNewPools;
    await updateRunProgress(sb, runId, { status: 'running' });
    console.log(
      `[backtest:tokens] RESUME run ${runId} · W${counts.winner}/L${counts.loser} · ` +
      `${processedMints.size} mints already tried · gecko from page ${geckoStartPage}` +
      `${skipNewPools ? ' · skip new_pools' : ''}`,
    );
  } else {
    runId = await createRun(sb, 'tokens', CONFIG);
    processedMints = new Set();
    counts = { winner: 0, loser: 0, ignored: 0, processed: 0, skipped: 0 };
    discoveryRound = 0;
    totalDiscovered = 0;
    console.log(
      `[backtest:tokens] run ${runId} · last ${CONFIG.LOOKBACK_DAYS}d · pump.fun only · no X API · ` +
      `discovery ${CONFIG.DISCOVERY_MODE} · ATH ${CONFIG.ATH_OHLCV_SOURCE} · ` +
      `${CONFIG.OHLCV_HOURS_AFTER_LAUNCH}h window · target ${target}/group · loop ${loopUntilTarget ? 'on' : 'off'}`,
    );
  }

  if (CONFIG.SEED_MINTS.length && !resumeRunId) {
    console.log(
      `[backtest:tokens] calibration seeds: ${CONFIG.SEED_MINTS.map(m => m.slice(0, 8) + '…').join(', ')}`,
    );
  }

  while (true) {
    const needMore = counts.winner < target || counts.loser < target;
    if (!needMore) break;
    if (loopUntilTarget && discoveryRound >= maxRounds) {
      console.warn(`[backtest:tokens] max discovery rounds (${maxRounds}) reached`);
      break;
    }
    if (!loopUntilTarget && discoveryRound > 0 && !resumeRunId) break;

    discoveryRound += 1;
    const supplementLegacy = CONFIG.LEGACY_SUPPLEMENT || CONFIG.DISCOVERY_MODE === 'legacy';

    console.log(
      `[backtest:tokens] discovery round ${discoveryRound} · exclude ${processedMints.size} processed · ` +
      `winners=${counts.winner}/${target} losers=${counts.loser}/${target} · gecko p${geckoStartPage}+`,
    );

    const { hits, checkpoint } = await discoverTokens(cutoffMs, CONFIG.SEED_MINTS, {
      excludeMints: processedMints,
      supplementLegacy,
      geckoStartPage,
      skipNewPools,
    });

    if (checkpoint?.lastPumpswapPage) {
      geckoStartPage = checkpoint.lastPumpswapPage + 1;
    }
    if (checkpoint?.newPoolsScanned) skipNewPools = true;

    let discovered = hits;
    if (CONFIG.ATH_OHLCV_SOURCE === 'birdeye' && process.env.BIRDEYE_API_KEY) {
      try {
        const bird = await discoverFromBirdeye(cutoffMs, process.env.BIRDEYE_API_KEY);
        const seen = new Set(discovered.map(d => d.mint));
        for (const b of bird) {
          if (!processedMints.has(b.mint) && !seen.has(b.mint)) discovered.push(b);
        }
      } catch (e) {
        console.warn(`[backtest:tokens] Birdeye discovery skipped: ${e.message}`);
      }
    }

    discovered = discovered.filter(h => !processedMints.has(h.mint));
    totalDiscovered += discovered.length;
    console.log(`[backtest:tokens] round ${discoveryRound}: ${discovered.length} new candidates`);

    if (!discovered.length) {
      if (loopUntilTarget && discoveryRound < maxRounds) {
        console.log(`[backtest:tokens] no new candidates — sleeping ${Math.round(roundSleep / 1000)}s before retry`);
        await sleep(roundSleep);
        continue;
      }
      break;
    }

    discovered = sortDiscoveryHits(discovered, CONFIG.SEED_MINTS, counts);

    for (const hit of discovered) {
      if (counts.winner >= target && counts.loser >= target) break;
      processedMints.add(hit.mint);
      counts.processed += 1;
      let enriched;
      try {
        enriched = await enrichMint(hit.mint, hit.launchMs);
      } catch (e) {
        counts.skipped += 1;
        if (counts.skipped <= 15 || counts.processed % 50 === 0) {
          console.warn(`[backtest:tokens] skip ${hit.mint.slice(0, 8)}… ${e.message}`);
        }
        continue;
      }
      const outcome = classifyOutcome(enriched);
      const narrative_cohort = resolveNarrativeCohort(enriched.mint);
      if (outcome === 'winner') counts.winner += 1;
      else if (outcome === 'loser') counts.loser += 1;
      else counts.ignored += 1;

      await upsertToken(sb, runId, { ...enriched, outcome, narrative_cohort });
      if (outcome !== 'ignored') {
        console.log(
          `[backtest:tokens] ${outcome.toUpperCase()} $${enriched.ticker || '?'} ` +
          `[${narrative_cohort}] ${Number(enriched.peak_multiple).toFixed(2)}x · ` +
          `peak mcap $${Math.round(enriched.peak_mcap || 0)} · ` +
          `W${counts.winner}/L${counts.loser}`,
        );
      }
      if (counts.processed % 25 === 0) {
        console.log(
          `[backtest:tokens] progress processed=${counts.processed} ` +
          `winners=${counts.winner} losers=${counts.loser} ignored=${counts.ignored} skipped=${counts.skipped}`,
        );
      }
    }

    await saveCheckpoint(sb, runId, {
      processedMints,
      counts,
      discoveryRound,
      totalDiscovered,
      checkpoint: { lastPumpswapPage: geckoStartPage - 1, newPoolsScanned: skipNewPools },
    });

    if (loopUntilTarget && (counts.winner < target || counts.loser < target) && discoveryRound < maxRounds) {
      await sleep(Math.min(roundSleep, 20_000));
    }
  }

  const final = await countTokensByOutcome(sb, runId);
  const stats = {
    discovered: totalDiscovered,
    discovery_rounds: discoveryRound,
    processed: counts.processed,
    skipped: counts.skipped,
    winner: final.winner,
    loser: final.loser,
    ignored: final.ignored,
    narrative_cohort: final.narrative,
    processed_mints: [...processedMints],
    gecko_last_pumpswap_page: geckoStartPage - 1,
    new_pools_scanned: skipNewPools,
  };
  const ok = final.winner >= minOk && final.loser >= minOk;
  const fullSample = final.winner >= target && final.loser >= target;

  await finishRun(sb, runId, {
    status: fullSample ? 'done' : (ok ? 'partial' : 'stopped'),
    stats,
  });

  let csvPath = null;
  try {
    const exp = await exportTokensCsv(sb, runId);
    csvPath = exp.filePath;
    console.log(`\nCSV exported: ${csvPath} (${exp.count} winner/loser rows)`);
  } catch (e) {
    console.warn(`[backtest:tokens] CSV export skipped: ${e.message}`);
  }

  return {
    runId,
    final,
    counts,
    stats,
    ok,
    fullSample,
    csvPath,
    target,
    minOk,
    resumed: !!resumeRunId,
  };
}

module.exports = { runTokensStage, resolveResumeRunId };
