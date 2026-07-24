'use strict';

const INTERVALS = require('./pipeline-intervals');
const { costFromUsage } = require('./anthropic-pricing');
const { utcDateStr, msUntilUtcMidnight } = require('./budget');

const INGEST_LOOKBACK_DAYS = Number(process.env.ANTHROPIC_INGEST_LOOKBACK_DAYS) || 7;
const DEFAULT_TT_VISION_RATE = Number(process.env.ANTHROPIC_TT_VISION_RATE_EST) || 0.05;
const DEFAULT_TITLE_RATE = Number(process.env.ANTHROPIC_TITLE_RATE_EST) || 0.08;

const CALL_TYPES = ['score_x', 'score_tt', 'title'];

const CONFIG = {
  DAILY_BUDGET_USD: Number(process.env.ANTHROPIC_DAILY_BUDGET) || 2,
  /** Fallback estimates until measured — replaced by cost_breakdown averages. */
  COST_SCORE_X: Number(process.env.ANTHROPIC_COST_SCORE_X) || 0.003,
  COST_SCORE_TT: Number(process.env.ANTHROPIC_COST_SCORE_TT) || 0.012,
  COST_TITLE: Number(process.env.ANTHROPIC_COST_TITLE) || 0.002,
  SCORE_BUDGET_PCT: Number(process.env.ANTHROPIC_SCORE_BUDGET_PCT) || 0.75,
  TITLE_BUDGET_PCT: Number(process.env.ANTHROPIC_TITLE_BUDGET_PCT) || 0.25,
  WARN_PCT: Number(process.env.ANTHROPIC_WARN_PCT) || 0.8,
  SOURCE: 'anthropic',
};

const DEFAULT_BREAKDOWN = () => ({
  score_x: { calls: 0, usd: 0, input_tokens: 0, output_tokens: 0 },
  score_tt: { calls: 0, usd: 0, input_tokens: 0, output_tokens: 0 },
  title: { calls: 0, usd: 0, input_tokens: 0, output_tokens: 0 },
});

function costToday(usage) {
  return Number(usage?.cost_usd) || 0;
}

function callsToday(usage) {
  return Number(usage?.reads_today) || 0;
}

function parseBreakdown(usage) {
  const base = DEFAULT_BREAKDOWN();
  const raw = usage?.cost_breakdown;
  if (!raw || typeof raw !== 'object') return base;
  for (const key of CALL_TYPES) {
    const row = raw[key];
    if (!row) continue;
    base[key] = {
      calls: Number(row.calls) || 0,
      usd: Number(row.usd) || 0,
      input_tokens: Number(row.input_tokens) || 0,
      output_tokens: Number(row.output_tokens) || 0,
    };
  }
  return base;
}

function avgCostForType(usage, type) {
  const row = parseBreakdown(usage)[type];
  if (row?.calls > 0 && row.usd > 0) return row.usd / row.calls;
  if (type === 'score_x') return CONFIG.COST_SCORE_X;
  if (type === 'score_tt') return CONFIG.COST_SCORE_TT;
  return CONFIG.COST_TITLE;
}

function estimatedCallCost(usage, type) {
  return avgCostForType(usage, type);
}

function getCycleSettings() {
  return {
    dailyBudget: CONFIG.DAILY_BUDGET_USD,
    scoreMs: INTERVALS.SCORE_MS,
    clusterMs: INTERVALS.CLUSTER_MS,
    scoreTopN: Number(process.env.SCORE_TOP_N) || 10,
    scoreTtMax: Number(process.env.SCORE_TT_MAX) || 3,
    titlesPerCycle: Number(process.env.ANTHROPIC_TITLES_PER_CYCLE) || 8,
  };
}

function scoreCallsPerCycle(settings) {
  const topN = Math.max(0, settings.scoreTopN);
  const ttMax = Math.max(0, Math.min(settings.scoreTtMax, topN));
  const xMax = Math.max(0, topN - ttMax);
  return { xMax, ttMax, total: topN };
}

function projectWorstCaseDailySpend(usage, settings = getCycleSettings()) {
  const msDay = 86_400_000;
  const scoreCycles = msDay / Math.max(1, settings.scoreMs);
  const clusterCycles = msDay / Math.max(1, settings.clusterMs);
  const perScore = scoreCallsPerCycle(settings);

  const avgX = avgCostForType(usage, 'score_x');
  const avgTt = avgCostForType(usage, 'score_tt');
  const avgTitle = avgCostForType(usage, 'title');

  const xCallsDay = scoreCycles * perScore.xMax;
  const ttCallsDay = scoreCycles * perScore.ttMax;
  const titleCallsDay = clusterCycles * settings.titlesPerCycle;

  const scoreXUsd = xCallsDay * avgX;
  const scoreTtUsd = ttCallsDay * avgTt;
  const titleUsd = titleCallsDay * avgTitle;
  const projectedWorstCase = scoreXUsd + scoreTtUsd + titleUsd;

  const breakdown = parseBreakdown(usage);
  const measured = CALL_TYPES.some(t => breakdown[t].calls > 0);

  return {
    projectedWorstCase,
    scoreXUsd,
    scoreTtUsd,
    titleUsd,
    xCallsDay,
    ttCallsDay,
    titleCallsDay,
    scoreCycles,
    clusterCycles,
    avgX,
    avgTt,
    avgTitle,
    measured,
    settings,
    perScore,
  };
}

/** @deprecated alias */
function projectDailySpend(usage, settings) {
  const w = projectWorstCaseDailySpend(usage, settings);
  return { ...w, projected: w.projectedWorstCase };
}

function dateDaysAgo(n) {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function load7DayIngestStats(sb) {
  if (!sb) return { avgDailyX: 0, avgDailyTt: 0, avgDailyTotal: 0, source: 'none' };

  const sinceDate = dateDaysAgo(INGEST_LOOKBACK_DAYS);
  const { data, error } = await sb
    .from('worker_usage')
    .select('utc_date, source, posts_ingested')
    .in('source', ['x', 'tiktok'])
    .gte('utc_date', sinceDate);

  if (!error && data?.length) {
    const byDate = new Map();
    let totalX = 0;
    let totalTt = 0;
    for (const row of data) {
      const n = Number(row.posts_ingested) || 0;
      if (row.source === 'x') totalX += n;
      if (row.source === 'tiktok') totalTt += n;
      byDate.set(row.utc_date, (byDate.get(row.utc_date) || 0) + n);
    }
    if (totalX + totalTt > 0) {
      const days = Math.max(1, byDate.size);
      return {
        avgDailyX: totalX / INGEST_LOOKBACK_DAYS,
        avgDailyTt: totalTt / INGEST_LOOKBACK_DAYS,
        avgDailyTotal: (totalX + totalTt) / INGEST_LOOKBACK_DAYS,
        daysWithData: days,
        source: 'worker_usage',
      };
    }
  }

  const sinceIso = new Date(Date.now() - INGEST_LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: cycles, error: cErr } = await sb
    .from('worker_cycle_log')
    .select('worker, ingested, ran_at')
    .in('worker', ['ingest', 'ingest-tiktok'])
    .gte('ran_at', sinceIso);

  if (cErr || !cycles?.length) {
    return { avgDailyX: 0, avgDailyTt: 0, avgDailyTotal: 0, source: 'none' };
  }

  let totalX = 0;
  let totalTt = 0;
  for (const row of cycles) {
    const n = Number(row.ingested) || 0;
    if (row.worker === 'ingest') totalX += n;
    else totalTt += n;
  }

  return {
    avgDailyX: totalX / INGEST_LOOKBACK_DAYS,
    avgDailyTt: totalTt / INGEST_LOOKBACK_DAYS,
    avgDailyTotal: (totalX + totalTt) / INGEST_LOOKBACK_DAYS,
    source: 'worker_cycle_log',
  };
}

async function load7DayAnthropicStats(sb) {
  if (!sb) return { avgDailyTitleCalls: 0, avgDailyScoreTtCalls: 0, ttVisionRate: DEFAULT_TT_VISION_RATE };

  const sinceDate = dateDaysAgo(INGEST_LOOKBACK_DAYS);
  const { data, error } = await sb
    .from('worker_usage')
    .select('utc_date, cost_breakdown')
    .eq('source', CONFIG.SOURCE)
    .gte('utc_date', sinceDate);

  if (error || !data?.length) {
    return { avgDailyTitleCalls: 0, avgDailyScoreTtCalls: 0, ttVisionRate: DEFAULT_TT_VISION_RATE };
  }

  let titleCalls = 0;
  let scoreTtCalls = 0;
  for (const row of data) {
    const b = parseBreakdown(row);
    titleCalls += b.title.calls;
    scoreTtCalls += b.score_tt.calls;
  }

  return {
    avgDailyTitleCalls: titleCalls / INGEST_LOOKBACK_DAYS,
    avgDailyScoreTtCalls: scoreTtCalls / INGEST_LOOKBACK_DAYS,
    ttVisionRate: DEFAULT_TT_VISION_RATE,
  };
}

async function projectIngestBasedDailySpend(sb, usage, settings = getCycleSettings()) {
  const ingest = await load7DayIngestStats(sb);
  const hist = await load7DayAnthropicStats(sb);

  const avgX = avgCostForType(usage, 'score_x');
  const avgTt = avgCostForType(usage, 'score_tt');
  const avgTitle = avgCostForType(usage, 'title');

  let ttVisionRate = hist.ttVisionRate;
  if (ingest.avgDailyTt > 0 && hist.avgDailyScoreTtCalls > 0) {
    ttVisionRate = Math.min(1, hist.avgDailyScoreTtCalls / ingest.avgDailyTt);
  }

  const scoreXUsd = ingest.avgDailyX * avgX;
  const scoreTtUsd = ingest.avgDailyTt * ttVisionRate * avgTt;

  let avgDailyTitleCalls = hist.avgDailyTitleCalls;
  if (avgDailyTitleCalls <= 0 && ingest.avgDailyTotal > 0) {
    avgDailyTitleCalls = ingest.avgDailyTotal * DEFAULT_TITLE_RATE;
  }

  const titleUsd = avgDailyTitleCalls * avgTitle;
  const projectedIngest = scoreXUsd + scoreTtUsd + titleUsd;

  return {
    projectedIngest,
    scoreXUsd,
    scoreTtUsd,
    titleUsd,
    ingest,
    hist,
    ttVisionRate,
    avgDailyTitleCalls,
    avgX,
    avgTt,
    avgTitle,
    settings,
  };
}

async function buildFullProjection(sb, usage, settings = getCycleSettings()) {
  const worst = projectWorstCaseDailySpend(usage, settings);
  const ingest = await projectIngestBasedDailySpend(sb, usage, settings);
  return {
    ...worst,
    ...ingest,
    projected: ingest.projectedIngest,
    measured: worst.measured,
  };
}

function formatMeasuredCosts(usage) {
  const b = parseBreakdown(usage);
  const parts = CALL_TYPES.map((type) => {
    const row = b[type];
    if (!row.calls) {
      return `${type}: (no calls yet, est $${estimatedCallCost(usage, type).toFixed(4)})`;
    }
    const avg = row.usd / row.calls;
    return `${type}: ${row.calls} calls · $${row.usd.toFixed(4)} total · $${avg.toFixed(4)}/call`;
  });
  return parts.join(' · ');
}

function formatProjectionLine(usage, projection) {
  const ingestSrc = projection.ingest?.source || 'none';
  const costSrc = projection.measured ? 'measured' : 'estimated';
  const ingestLine =
    `projected from ingest: $${(projection.projectedIngest ?? 0).toFixed(2)}/day ` +
    `(${ingestSrc}, ${INGEST_LOOKBACK_DAYS}d avg · ${(projection.ingest?.avgDailyTotal ?? 0).toFixed(1)} posts/d · ` +
    `tt vision ${((projection.ttVisionRate ?? 0) * 100).toFixed(0)}% · ${costSrc} $/call)`;
  const worstLine =
    `worst case at full batches: $${(projection.projectedWorstCase ?? 0).toFixed(2)}/day ` +
    `(budget $${projection.settings.dailyBudget.toFixed(2)})`;
  return `${ingestLine} · ${worstLine}`;
}

function suggestBudgetKnobs(projection) {
  const over = (projection.projectedIngest ?? 0) - projection.settings.dailyBudget;
  if (over <= 0) return ['Within ingest-based budget — no changes needed.'];

  const tips = [];
  tips.push(
    `raise ANTHROPIC_DAILY_BUDGET above $${projection.projectedIngest.toFixed(2)} ` +
    `(currently $${projection.settings.dailyBudget.toFixed(2)})`,
  );
  if (projection.ingest?.avgDailyTotal > 0) {
    tips.push(
      `ingest volume drives cost — ${projection.ingest.avgDailyTotal.toFixed(1)} posts/d ` +
      `(${projection.ingest.avgDailyX.toFixed(1)} x + ${projection.ingest.avgDailyTt.toFixed(1)} tt)`,
    );
  }
  if (projection.projectedWorstCase > projection.settings.dailyBudget) {
    tips.push(
      `worst-case batch ceiling is $${projection.projectedWorstCase.toFixed(2)}/day — ` +
      'daily cap still protects you; throughput stays at SCORE_POLL_MS=60s',
    );
  }
  tips.push('TikTok vision is gated behind replication/CT/ticker signals — keeps TT spend low');
  return tips;
}

function printStartupBudgetReport(usage, projection) {
  console.log(`[anthropic] ${formatMeasuredCosts(usage)}`);
  console.log(`[anthropic] ${formatProjectionLine(usage, projection)}`);
  if (projection.projectedWorstCase > projection.settings.dailyBudget) {
    console.warn(
      `[anthropic] ⚠ worst-case batch ceiling $${projection.projectedWorstCase.toFixed(2)}/day ` +
      `exceeds budget — OK while ingest-based projection is within cap`,
    );
  }
}

function printDryRunReport(usage, projection) {
  console.log('');
  console.log('=== Anthropic dry-run cost (no API calls) ===');
  console.log(formatMeasuredCosts(usage));
  console.log(formatProjectionLine(usage, projection));
  console.log('');
  console.log('Throughput settings (latency-first — daily cap is the throttle):');
  console.log(
    `  SCORE_TOP_N=${projection.settings.scoreTopN} · SCORE_POLL_MS=${projection.settings.scoreMs} · ` +
    `ANTHROPIC_TITLES_PER_CYCLE=${projection.settings.titlesPerCycle} · ` +
    `CLUSTER_POLL_MS=${projection.settings.clusterMs}`,
  );
  console.log(`  ANTHROPIC_DAILY_BUDGET=$${projection.settings.dailyBudget.toFixed(2)}`);
  console.log('');
  if (projection.projectedIngest > projection.settings.dailyBudget) {
    console.log(`⚠ OVER BUDGET (ingest-based) by $${(projection.projectedIngest - projection.settings.dailyBudget).toFixed(2)}/day`);
    suggestBudgetKnobs(projection).forEach(t => console.log(`  → ${t}`));
  } else {
    console.log(`✓ Within ingest-based budget ($${(projection.settings.dailyBudget - projection.projectedIngest).toFixed(2)} headroom)`);
  }
  if (projection.projectedWorstCase > projection.settings.dailyBudget) {
    console.log(`  (worst-case full batches would be $${projection.projectedWorstCase.toFixed(2)}/day — daily cap stops actual spend)`);
  }
  console.log('');
}

function printExhaustionBanner(usage, reason = 'anthropic_daily_budget') {
  const spent = costToday(usage);
  const lines = [
    '',
    '='.repeat(72),
    '  ANTHROPIC SCORING PAUSED',
    reason === 'anthropic_credits'
      ? '  Account credits exhausted — top up Anthropic balance to resume.'
      : `  Daily budget cap reached ($${spent.toFixed(2)} / $${CONFIG.DAILY_BUDGET_USD.toFixed(2)}).`,
    '  New meme scores will not appear until budget resets (UTC midnight) or cap is raised.',
    '  Frontend flag: worker_pipeline_state.scoring_paused = true',
    '='.repeat(72),
    '',
  ];
  console.error(lines.join('\n'));
}

async function loadUsage(sb, source = CONFIG.SOURCE) {
  const today = utcDateStr();
  const { data, error } = await sb
    .from('worker_usage')
    .select('*')
    .eq('source', source)
    .eq('utc_date', today)
    .maybeSingle();

  if (error) throw new Error(`worker_usage load (${source}): ` + error.message);

  if (!data) {
    const row = {
      source,
      utc_date: today,
      reads_today: 0,
      cost_usd: 0,
      cost_breakdown: DEFAULT_BREAKDOWN(),
      updated_at: new Date().toISOString(),
    };
    const { error: insErr } = await sb.from('worker_usage').insert(row);
    if (insErr) throw new Error(`worker_usage insert (${source}): ` + insErr.message);
    return row;
  }

  return { ...data, cost_breakdown: parseBreakdown(data) };
}

async function recordCall(sb, callType, apiPayload, source = CONFIG.SOURCE) {
  if (!CALL_TYPES.includes(callType)) {
    throw new Error(`recordCall: unknown type ${callType}`);
  }

  const model = apiPayload?.model;
  const usageBlock = apiPayload?.usage || apiPayload;
  const measured = costFromUsage(model, usageBlock);
  const usd = apiPayload?.usd != null ? Number(apiPayload.usd) : measured.usd;

  if (!usd || usd <= 0) return loadUsage(sb, source);

  const row = await loadUsage(sb, source);
  const breakdown = parseBreakdown(row);
  const bucket = breakdown[callType];
  bucket.calls += 1;
  bucket.usd += usd;
  bucket.input_tokens += measured.input_tokens;
  bucket.output_tokens += measured.output_tokens;

  const nextCost = costToday(row) + usd;
  const nextCalls = callsToday(row) + 1;

  const { data, error } = await sb
    .from('worker_usage')
    .update({
      reads_today: nextCalls,
      cost_usd: nextCost,
      cost_breakdown: breakdown,
      updated_at: new Date().toISOString(),
    })
    .eq('source', source)
    .eq('utc_date', row.utc_date)
    .select('*')
    .single();

  if (error) throw new Error(`worker_usage record (${source}): ` + error.message);

  const avg = bucket.usd / bucket.calls;
  console.log(
    `[anthropic] ${callType} $${usd.toFixed(4)} (${measured.input_tokens}in/${measured.output_tokens}out) · ` +
    `avg $${avg.toFixed(4)}/call · today $${nextCost.toFixed(2)}/$${CONFIG.DAILY_BUDGET_USD.toFixed(2)}`,
  );

  await setScoringPaused(sb, false, null, { spent: nextCost }).catch(() => {});

  return data;
}

/** @deprecated use recordCall */
async function recordSpend(sb, usd, calls = 1, source = CONFIG.SOURCE) {
  if (!usd || usd <= 0) return loadUsage(sb, source);
  const usage = await loadUsage(sb, source);
  const nextCost = costToday(usage) + usd;
  const nextCalls = callsToday(usage) + calls;
  const { data, error } = await sb
    .from('worker_usage')
    .update({ reads_today: nextCalls, cost_usd: nextCost, updated_at: new Date().toISOString() })
    .eq('source', source)
    .eq('utc_date', usage.utc_date)
    .select('*')
    .single();
  if (error) throw new Error(`worker_usage record (${source}): ` + error.message);
  return data;
}

async function setScoringPaused(sb, paused, reason = null, extra = {}) {
  const usage = extra.spent != null
    ? { cost_usd: extra.spent, cost_breakdown: extra.cost_breakdown || DEFAULT_BREAKDOWN() }
    : await loadUsage(sb).catch(() => null);
  const projection = extra.projection || (sb ? await buildFullProjection(sb, usage || {}).catch(() => null) : null);
  const row = {
    id: 1,
    scoring_paused: !!paused,
    pause_reason: paused ? (reason || 'anthropic_paused') : null,
    anthropic_spent_usd: usage ? costToday(usage) : null,
    anthropic_budget_usd: CONFIG.DAILY_BUDGET_USD,
    projected_daily_usd: projection?.projectedIngest ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await sb.from('worker_pipeline_state').upsert(row);
  if (error) {
    console.warn('[anthropic] worker_pipeline_state upsert failed:', error.message);
    return false;
  }
  return true;
}

function isDormant(usage) {
  return costToday(usage) >= CONFIG.DAILY_BUDGET_USD - 1e-9;
}

function isWarn(usage) {
  return costToday(usage) / CONFIG.DAILY_BUDGET_USD >= CONFIG.WARN_PCT;
}

function canSpend(usage, usd) {
  return costToday(usage) + usd <= CONFIG.DAILY_BUDGET_USD + 1e-9;
}

function canSpendType(usage, type) {
  return canSpend(usage, estimatedCallCost(usage, type));
}

function scoreBudgetUsd(usage) {
  return Math.max(0, CONFIG.DAILY_BUDGET_USD * CONFIG.SCORE_BUDGET_PCT - costToday(usage));
}

function titleBudgetUsd(usage) {
  const spent = costToday(usage);
  const scoreCap = CONFIG.DAILY_BUDGET_USD * CONFIG.SCORE_BUDGET_PCT;
  const titleCap = CONFIG.DAILY_BUDGET_USD * CONFIG.TITLE_BUDGET_PCT;
  const titleSpent = Math.max(0, spent - scoreCap);
  return Math.max(0, titleCap - titleSpent);
}

function maxScoreCallsRemaining(usage) {
  const avg = (estimatedCallCost(usage, 'score_x') + estimatedCallCost(usage, 'score_tt')) / 2;
  return Math.floor(scoreBudgetUsd(usage) / Math.max(avg, 1e-6));
}

function formatBudgetLine(usage) {
  const spent = costToday(usage);
  const pct = ((spent / CONFIG.DAILY_BUDGET_USD) * 100).toFixed(1);
  return (
    `anthropic · ${callsToday(usage)} calls · today $${spent.toFixed(2)}/` +
    `$${CONFIG.DAILY_BUDGET_USD.toFixed(2)} (${pct}%)`
  );
}

function isCreditError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('credit balance') || msg.includes('http 402') || msg.includes('http 400');
}

async function runDryRunCost(sb) {
  let usage = { cost_usd: 0, cost_breakdown: DEFAULT_BREAKDOWN() };
  if (sb) {
    try {
      usage = await loadUsage(sb);
    } catch (e) {
      console.warn('[anthropic] dry-run: could not load worker_usage — using estimates only:', e.message);
    }
  }
  const projection = await buildFullProjection(sb, usage);
  printDryRunReport(usage, projection);
}

async function assertStartupBudget(sb) {
  const usage = await loadUsage(sb);
  const projection = await buildFullProjection(sb, usage);
  printStartupBudgetReport(usage, projection);

  if (projection.projectedIngest > projection.settings.dailyBudget + 1e-6) {
    console.error('');
    console.error('[anthropic] REFUSING TO START — ingest-based projection exceeds ANTHROPIC_DAILY_BUDGET');
    suggestBudgetKnobs(projection).forEach(t => console.error(`  → ${t}`));
    console.error('');
    return { ok: false, usage, projection };
  }

  if (projection.projectedWorstCase > projection.settings.dailyBudget) {
    console.warn(
      `[anthropic] ⚠ worst-case full-batch ceiling $${projection.projectedWorstCase.toFixed(2)}/day — ` +
      'daily cap is the runtime throttle (SCORE_POLL_MS stays at 60s)',
    );
  }

  if (isDormant(usage)) {
    await setScoringPaused(sb, true, 'anthropic_daily_budget', { projection });
  } else {
    await setScoringPaused(sb, false, null, { projection });
  }

  return { ok: true, usage, projection };
}

module.exports = {
  CONFIG,
  CALL_TYPES,
  loadUsage,
  recordCall,
  recordSpend,
  setScoringPaused,
  costToday,
  callsToday,
  parseBreakdown,
  avgCostForType,
  estimatedCallCost,
  getCycleSettings,
  projectWorstCaseDailySpend,
  projectDailySpend,
  projectIngestBasedDailySpend,
  buildFullProjection,
  load7DayIngestStats,
  formatMeasuredCosts,
  formatProjectionLine,
  suggestBudgetKnobs,
  printStartupBudgetReport,
  printDryRunReport,
  printExhaustionBanner,
  runDryRunCost,
  assertStartupBudget,
  isDormant,
  isWarn,
  canSpend,
  canSpendType,
  scoreBudgetUsd,
  titleBudgetUsd,
  maxScoreCallsRemaining,
  formatBudgetLine,
  isCreditError,
  msUntilUtcMidnight,
};
