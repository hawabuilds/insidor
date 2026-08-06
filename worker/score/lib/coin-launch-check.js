'use strict';

const { searchTokens, normalizeSymbol, isPumpFunPair } = require('../../../lib/token-lookup');
const { normalizeTicker, isGenericTicker } = require('./nameability');

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const DEX_DELAY_MS = Number(process.env.RESCORE_DEX_DELAY_MS) || 350;
const GECKO_DELAY_MS = Number(process.env.RESCORE_GECKO_DELAY_MS) || 1200;

let lastDexCall = 0;
let lastGeckoCall = 0;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function rateLimitDex() {
  const wait = Math.max(0, DEX_DELAY_MS - (Date.now() - lastDexCall));
  if (wait) await sleep(wait);
  lastDexCall = Date.now();
}

async function rateLimitGecko() {
  const wait = Math.max(0, GECKO_DELAY_MS - (Date.now() - lastGeckoCall));
  if (wait) await sleep(wait);
  lastGeckoCall = Date.now();
}

/** Search terms from rescore output — subject words only, not story headlines. */
function buildSubjectSearchTerms(rescore) {
  const terms = new Set();
  const ticker = normalizeTicker(rescore?.suggested_ticker);
  if (ticker && !isGenericTicker(ticker)) terms.add(ticker);

  const name = String(rescore?.suggested_name || '').trim();
  if (name.length >= 3) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 1) terms.add(words[0].toUpperCase());
    else {
      for (const w of words) {
        if (w.length >= 4 && !isGenericTicker(w.toUpperCase())) terms.add(w.toUpperCase());
      }
      if (words.length <= 4) terms.add(words.join('').toUpperCase().slice(0, 10));
    }
  }

  return [...terms].filter(t => t.length >= 2).slice(0, 6);
}

function pairLaunchMs(hit) {
  if (hit?.pairCreatedAt) return Number(hit.pairCreatedAt);
  if (hit?.launchedAt) return Date.parse(hit.launchedAt);
  if (hit?.pool_created_at) return Date.parse(hit.pool_created_at);
  return null;
}

function hitMatchesTerm(hit, term) {
  const sym = normalizeSymbol(hit.ticker || hit.symbol);
  const name = String(hit.name || '').toLowerCase();
  const t = String(term || '').trim();
  if (!t) return false;
  if (sym === normalizeSymbol(t)) return true;
  if (t.length >= 4 && name.includes(t.toLowerCase())) return true;
  return false;
}

function mapGeckoPool(pool, included) {
  const attrs = pool.attributes || {};
  const baseId = pool.relationships?.base_token?.data?.id || '';
  const mint = baseId.replace(/^solana_/, '');
  let symbol = (attrs.name || '').split('/')[0]?.trim() || '';
  let tokenName = symbol;

  for (const inc of included || []) {
    if (inc.type !== 'token') continue;
    if (inc.id !== baseId && inc.id !== `solana_${mint}`) continue;
    symbol = inc.attributes?.symbol || symbol;
    tokenName = inc.attributes?.name || tokenName;
    break;
  }

  const launchedMs = attrs.pool_created_at ? Date.parse(attrs.pool_created_at) : null;
  const dexId = pool.relationships?.dex?.data?.id || '';

  return {
    mint,
    ticker: symbol,
    name: tokenName,
    pairCreatedAt: launchedMs,
    launchedAt: attrs.pool_created_at,
    pool_created_at: attrs.pool_created_at,
    onPumpFun: /pump/i.test(dexId) || /pump$/i.test(mint),
    dexId,
    source: 'gecko',
  };
}

async function geckoSearchPools(query) {
  await rateLimitGecko();
  const url = `${GECKO_BASE}/search/pools?query=${encodeURIComponent(query)}&network=solana&page=1`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 429) {
    await sleep(8000);
    return geckoSearchPools(query);
  }
  if (!r.ok) throw new Error(`GeckoTerminal HTTP ${r.status}`);
  const data = await r.json();
  return (data.data || []).map(p => mapGeckoPool(p, data.included));
}

async function dexSearch(query) {
  await rateLimitDex();
  return searchTokens(query, 15);
}

/**
 * Find a Solana token matching subject terms with pool/pair created after anchorMs.
 */
async function findCoinLaunchedAfter(anchorMs, rescore, opts = {}) {
  if (!anchorMs || !Number.isFinite(anchorMs)) {
    return { coined: false, reason: 'no_anchor_time' };
  }

  const terms = buildSubjectSearchTerms(rescore);
  if (!terms.length) {
    return { coined: false, reason: 'no_search_terms', terms: [] };
  }

  const graceMs = opts.graceMs ?? 5 * 60_000;
  const minLaunchMs = anchorMs - graceMs;
  let best = null;

  for (const term of terms) {
    let dexHits = [];
    let geckoHits = [];
    try {
      dexHits = await dexSearch(term);
    } catch (e) {
      if (opts.onError) opts.onError('dex', term, e);
    }
    try {
      geckoHits = await geckoSearchPools(term);
    } catch (e) {
      if (opts.onError) opts.onError('gecko', term, e);
    }

    for (const hit of [...dexHits, ...geckoHits]) {
      if (!hitMatchesTerm(hit, term)) continue;
      const launchMs = pairLaunchMs(hit);
      if (!launchMs || launchMs < minLaunchMs) continue;
      if (opts.pumpOnly && !hit.onPumpFun && !isPumpFunPair({ dexId: hit.dexId, baseToken: { address: hit.mint }, url: '' })) {
        continue;
      }
      const candidate = {
        coined: true,
        matchedQuery: term,
        mint: hit.mint,
        ticker: hit.ticker,
        name: hit.name,
        launchedAt: new Date(launchMs).toISOString(),
        launchMs,
        source: hit.source || 'dexscreener',
        onPumpFun: hit.onPumpFun,
      };
      if (!best || launchMs < best.launchMs) best = candidate;
    }
  }

  if (best) return best;
  return { coined: false, reason: 'no_match_after_anchor', terms, anchorMs: new Date(anchorMs).toISOString() };
}

module.exports = {
  buildSubjectSearchTerms,
  findCoinLaunchedAfter,
  geckoSearchPools,
  pairLaunchMs,
  hitMatchesTerm,
};
