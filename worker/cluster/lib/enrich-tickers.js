'use strict';

const { t, c, cs, row: dbRow } = require('../../../lib/db-schema');
const { lookupTicker } = require('../../../lib/token-lookup');
const { sleep } = require('../../lib/retry');

const LOOKUP_DELAY_MS = 250;

function rowPatch(result) {
  if (!result.found || !(Number(result.liquidity) > 0)) return null;
  return {
    first_deployed: true,
    mcap: result.mcap,
    liquidity: result.liquidity,
    vol24h: result.vol24h,
    age_min: result.ageMin,
    name: result.name,
  };
}

function rowPatchExtended(result) {
  return {
    mint_ca: result.mint,
    dex_url: result.dexUrl,
    pump_url: result.pumpUrl,
    lookup_at: new Date().toISOString(),
  };
}

async function updateTickerRow(sb, narrativeId, sym, result) {
  const core = rowPatch(result);
  const full = { ...core, ...rowPatchExtended(result) };
  let { error } = await sb
    .from(t('narrative_tickers'))
    .update(dbRow('narrative_tickers', full))
    .eq(c('narrative_tickers', 'narrative_id'), narrativeId)
    .eq(c('narrative_tickers', 'ticker'), sym);
  if (error && /column/i.test(error.message)) {
    ({ error } = await sb
      .from(t('narrative_tickers'))
      .update(dbRow('narrative_tickers', core))
      .eq(c('narrative_tickers', 'narrative_id'), narrativeId)
      .eq(c('narrative_tickers', 'ticker'), sym));
  }
  if (error) throw new Error(`enrich ${sym}: ${error.message}`);
}

async function enrichTicker(sb, narrativeId, ticker) {
  const sym = String(ticker || '').toUpperCase();
  if (!sym) return { ticker: sym, found: false, updated: false };

  let result;
  try {
    result = await lookupTicker(sym);
  } catch (e) {
    console.warn(`[token-lookup] ${sym}:`, e.message);
    return { ticker: sym, found: false, updated: false, error: e.message };
  }

  const patch = rowPatch(result);
  if (!patch) {
    return { ticker: sym, found: false, updated: false };
  }

  await updateTickerRow(sb, narrativeId, sym, result);

  const tag = result.onPumpFun ? 'pump.fun' : (result.dexId || 'dex');
  console.log(
    `[token-lookup] $${sym} → deployed (${tag}) mcap=${Math.round(result.mcap)} liq=${Math.round(result.liquidity)}`,
  );

  return { ...result, narrativeId, updated: true };
}

async function enrichNarrativeTickers(sb, narrativeId, tickers, opts = {}) {
  const list = [...new Set((tickers || []).map(t => (typeof t === 'string' ? t : t.ticker)).filter(Boolean))];
  const out = [];
  for (const ticker of list) {
    out.push(await enrichTicker(sb, narrativeId, ticker));
    if (opts.delayMs) await sleep(opts.delayMs);
  }
  return out;
}

async function enrichAllOpenTickers(sb, opts = {}) {
  const { data, error } = await sb
    .from(t('narrative_tickers'))
    .select(cs('narrative_tickers', 'narrative_id', 'ticker', 'first_deployed', 'canonical'))
    .order(c('narrative_tickers', 'canonical'), { ascending: false });

  if (error) throw new Error('enrich select: ' + error.message);

  const rows = (data || []).filter(r => opts.force || !r.first_deployed);
  let found = 0;
  let updated = 0;

  for (const row of rows) {
    const res = await enrichTicker(sb, row.narrative_id, row.ticker);
    if (res.found) found += 1;
    if (res.updated) updated += 1;
    await sleep(opts.delayMs ?? LOOKUP_DELAY_MS);
  }

  return { checked: rows.length, found, updated };
}

module.exports = { enrichTicker, enrichNarrativeTickers, enrichAllOpenTickers, rowPatch };
