'use strict';

const { t, c, row: dbRow } = require('../../../lib/db-schema');

async function createRun(sb, stage, config) {
  const row = dbRow('backtest_runs', {
    stage,
    status: 'running',
    config: config || {},
    stats: {},
    started_at: new Date().toISOString(),
    finished_at: null,
  });
  const { data, error } = await sb.from(t('backtest_runs')).insert(row).select('id').single();
  if (error) {
    if (error.message?.includes('Could not find the table')) {
      throw new Error(
        'Backtest tables missing — run worker/schema-backtest.sql in Supabase SQL editor, then npm run schema:backtest',
      );
    }
    throw new Error('backtest run insert: ' + error.message);
  }
  return data.id;
}

async function finishRun(sb, runId, { status = 'done', stats = {} } = {}) {
  const { error } = await sb
    .from(t('backtest_runs'))
    .update({
      status,
      stats,
      finished_at: new Date().toISOString(),
    })
    .eq(c('backtest_runs', 'id'), runId);
  if (error) throw new Error('backtest run update: ' + error.message);
}

async function updateRunProgress(sb, runId, { status = 'running', stats = {} } = {}) {
  const { error } = await sb
    .from(t('backtest_runs'))
    .update({ status, stats })
    .eq(c('backtest_runs', 'id'), runId);
  if (error) throw new Error('backtest run progress: ' + error.message);
}

async function fetchRunById(sb, runId) {
  const { data, error } = await sb
    .from(t('backtest_runs'))
    .select('*')
    .eq(c('backtest_runs', 'id'), runId)
    .maybeSingle();
  if (error) throw new Error('backtest run fetch: ' + error.message);
  return data;
}

async function fetchRunMintAddresses(sb, runId) {
  const { data, error } = await sb
    .from(t('backtest_tokens'))
    .select('mint')
    .eq(c('backtest_tokens', 'run_id'), runId);
  if (error) throw new Error('backtest token mints: ' + error.message);
  return (data || []).map(row => row.mint).filter(Boolean);
}

async function fetchRunTokens(sb, runId) {
  const { data, error } = await sb
    .from(t('backtest_tokens'))
    .select('*')
    .eq(c('backtest_tokens', 'run_id'), runId);
  if (error) throw new Error('backtest tokens fetch: ' + error.message);
  return data || [];
}

async function deleteTokensByIds(sb, tokenIds) {
  if (!tokenIds.length) return 0;
  const { error } = await sb
    .from(t('backtest_tokens'))
    .delete()
    .in(c('backtest_tokens', 'id'), tokenIds);
  if (error) throw new Error('backtest token delete: ' + error.message);
  return tokenIds.length;
}

async function latestRunForStage(sb, stage) {
  const { data, error } = await sb
    .from(t('backtest_runs'))
    .select('*')
    .eq(c('backtest_runs', 'stage'), stage)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('backtest run fetch: ' + error.message);
  return data;
}

async function upsertToken(sb, runId, tokenRow) {
  const { narrative_cohort, raw: tokenRaw, ...rest } = tokenRow;
  const raw = {
    ...(tokenRaw && typeof tokenRaw === 'object' ? tokenRaw : {}),
    narrative_cohort: narrative_cohort || 'unknown',
  };
  const base = dbRow('backtest_tokens', { run_id: runId, ...rest, raw });
  let payload = narrative_cohort != null ? { ...base, narrative_cohort } : base;
  let { data, error } = await sb
    .from(t('backtest_tokens'))
    .upsert(payload, { onConflict: 'run_id,mint' })
    .select('*')
    .single();
  if (error?.message?.includes('narrative_cohort')) {
    ({ data, error } = await sb
      .from(t('backtest_tokens'))
      .upsert(base, { onConflict: 'run_id,mint' })
      .select('*')
      .single());
  }
  if (error) throw new Error('backtest token upsert: ' + error.message);
  return data;
}

async function upsertCandidate(sb, runId, candidateRow) {
  const row = dbRow('backtest_candidates', { run_id: runId, ...candidateRow });
  let { data, error } = await sb
    .from(t('backtest_candidates'))
    .upsert(row, { onConflict: 'run_id,token_id' })
    .select('*')
    .single();
  if (error?.message?.includes('narrative_cohort') || error?.message?.includes('skipped_non_narrative')) {
    const { narrative_cohort, status, ...rest } = candidateRow;
    const fallback = dbRow('backtest_candidates', {
      run_id: runId,
      ...rest,
      status: status === 'skipped_non_narrative' ? 'rejected_no_post' : status,
      match_reason: candidateRow.match_reason || (status === 'skipped_non_narrative'
        ? 'non_narrative cohort — no viral post expected'
        : null),
    });
    ({ data, error } = await sb
      .from(t('backtest_candidates'))
      .upsert(fallback, { onConflict: 'run_id,token_id' })
      .select('*')
      .single());
  }
  if (error) throw new Error('backtest candidate upsert: ' + error.message);
  return data;
}

async function countTokensByOutcome(sb, runId) {
  const { data, error } = await sb
    .from(t('backtest_tokens'))
    .select('outcome, raw')
    .eq(c('backtest_tokens', 'run_id'), runId);
  if (error) throw new Error('backtest token count: ' + error.message);
  const counts = {
    winner: 0, loser: 0, ignored: 0,
    narrative: { narrative: 0, non_narrative: 0, unknown: 0 },
  };
  for (const row of data || []) {
    counts[row.outcome] = (counts[row.outcome] || 0) + 1;
    if (row.outcome === 'winner' || row.outcome === 'loser') {
      const cohort = row.narrative_cohort || row.raw?.narrative_cohort || 'unknown';
      if (counts.narrative[cohort] != null) counts.narrative[cohort] += 1;
    }
  }
  return counts;
}

async function updateTokenNarrativeCohort(sb, tokenId, narrative_cohort) {
  const { data: token, error: fetchErr } = await sb
    .from(t('backtest_tokens'))
    .select('raw')
    .eq(c('backtest_tokens', 'id'), tokenId)
    .single();
  if (fetchErr) throw new Error('backtest token fetch: ' + fetchErr.message);
  const raw = { ...(token?.raw || {}), narrative_cohort };
  let { error } = await sb
    .from(t('backtest_tokens'))
    .update({ narrative_cohort, raw })
    .eq(c('backtest_tokens', 'id'), tokenId);
  if (error?.message?.includes('narrative_cohort')) {
    ({ error } = await sb
      .from(t('backtest_tokens'))
      .update({ raw })
      .eq(c('backtest_tokens', 'id'), tokenId));
  }
  if (error) throw new Error('backtest token cohort update: ' + error.message);
}

async function countCandidatesByStatus(sb, runId) {
  const { data, error } = await sb
    .from(t('backtest_candidates'))
    .select('status, outcome, narrative_cohort')
    .eq(c('backtest_candidates', 'run_id'), runId);
  if (error) throw new Error('backtest candidate count: ' + error.message);
  const out = {
    rejected_name: 0,
    rejected_no_post: 0,
    skipped_non_narrative: 0,
    retained: { winner: 0, loser: 0 },
    retained_narrative: { winner: 0, loser: 0 },
  };
  for (const row of data || []) {
    if (row.status === 'retained') {
      out.retained[row.outcome] += 1;
      if (row.narrative_cohort === 'narrative') out.retained_narrative[row.outcome] += 1;
    } else if (row.status === 'rejected_name') out.rejected_name += 1;
    else if (row.status === 'rejected_no_post') out.rejected_no_post += 1;
    else if (row.status === 'skipped_non_narrative') out.skipped_non_narrative += 1;
  }
  return out;
}

async function fetchClassifiedTokens(sb, runId, { mint } = {}) {
  let q = sb
    .from(t('backtest_tokens'))
    .select('*')
    .eq(c('backtest_tokens', 'run_id'), runId)
    .in(c('backtest_tokens', 'outcome'), ['winner', 'loser']);
  if (mint) q = q.eq(c('backtest_tokens', 'mint'), mint);
  const { data, error } = await q.order('launch_at', { ascending: false });
  if (error) throw new Error('backtest tokens fetch: ' + error.message);
  return (data || []).map(row => ({
    ...row,
    narrative_cohort: row.narrative_cohort || row.raw?.narrative_cohort || 'unknown',
  }));
}

module.exports = {
  createRun,
  finishRun,
  updateRunProgress,
  fetchRunById,
  fetchRunMintAddresses,
  fetchRunTokens,
  deleteTokensByIds,
  latestRunForStage,
  upsertToken,
  upsertCandidate,
  countTokensByOutcome,
  countCandidatesByStatus,
  fetchClassifiedTokens,
  updateTokenNarrativeCohort,
};
