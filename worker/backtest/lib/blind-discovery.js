'use strict';

const { searchGraduatedPumpCoins } = require('./pumpfun-api');
const { discoverGraduatedDune } = require('./dune-discovery');

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_DELAY_MS = Number(process.env.BACKTEST_GECKO_DELAY_MS) || 2000;
const MAX_GECKO_PAGES = Number(process.env.BACKTEST_BLIND_GECKO_PAGES) || 80;

let lastGeckoCall = 0;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function geckoFetch(path, query = {}, attempt = 0) {
  const wait = Math.max(0, GECKO_DELAY_MS - (Date.now() - lastGeckoCall));
  if (wait) await sleep(wait);
  lastGeckoCall = Date.now();
  const qs = new URLSearchParams(query);
  const url = `${GECKO_BASE}${path}${qs.size ? `?${qs}` : ''}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if ((r.status === 429 || r.status === 401) && attempt < 5) {
    await sleep(Math.min(60_000, 8000 * (attempt + 1)));
    return geckoFetch(path, query, attempt + 1);
  }
  if (!r.ok) throw new Error(`GeckoTerminal HTTP ${r.status}`);
  return r.json();
}

function poolToGraduation(pool, cutoffMs) {
  const dex = pool.relationships?.dex?.data?.id || '';
  if (dex !== 'pumpswap') return null;
  const mint = (pool.relationships?.base_token?.data?.id || '').replace(/^solana_/, '');
  if (!mint || !/pump$/i.test(mint)) return null;
  const attrs = pool.attributes || {};
  const graduatedMs = attrs.pool_created_at ? Date.parse(attrs.pool_created_at) : null;
  if (!graduatedMs || graduatedMs < cutoffMs) return null;
  const symbol = (attrs.name || '').split('/')[0]?.trim() || null;
  return {
    mint,
    ticker: symbol,
    name: symbol,
    graduated_at: new Date(graduatedMs).toISOString(),
    graduatedMs,
    pair: {
      chainId: 'solana',
      dexId: 'pumpswap',
      pairAddress: attrs.address,
      pairCreatedAt: graduatedMs,
      liquidity: { usd: Number(attrs.reserve_in_usd) || 0 },
      priceUsd: attrs.base_token_price_usd,
      fdv: attrs.fdv_usd,
      marketCap: attrs.market_cap_usd,
      baseToken: { address: mint, symbol, name: symbol },
    },
    source: 'gecko:pumpswap',
  };
}

async function discoverGraduatedGecko(cutoffMs) {
  const byMint = new Map();
  for (let page = 1; page <= MAX_GECKO_PAGES; page += 1) {
    const data = await geckoFetch('/networks/solana/dexes/pumpswap/pools', { page: String(page) });
    const pools = data?.data || [];
    if (!pools.length) break;

    let inWindow = 0;
    let oldestOnPage = Infinity;
    for (const pool of pools) {
      const created = pool.attributes?.pool_created_at;
      if (created) oldestOnPage = Math.min(oldestOnPage, Date.parse(created));
      const hit = poolToGraduation(pool, cutoffMs);
      if (hit) {
        inWindow += 1;
        const prev = byMint.get(hit.mint);
        if (!prev || hit.graduatedMs > prev.graduatedMs) byMint.set(hit.mint, hit);
      }
    }
    if (oldestOnPage < cutoffMs && inWindow === 0) break;
    if (inWindow === 0 && page > 5) break;
  }

  for (let page = 1; page <= 15; page += 1) {
    try {
      const data = await geckoFetch('/networks/solana/new_pools', { page: String(page) });
      const pools = data?.data || [];
      if (!pools.length) break;
      let oldestOnPage = Infinity;
      for (const pool of pools) {
        const created = pool.attributes?.pool_created_at;
        if (created) oldestOnPage = Math.min(oldestOnPage, Date.parse(created));
        const hit = poolToGraduation(pool, cutoffMs);
        if (hit) {
          const prev = byMint.get(hit.mint);
          if (!prev || hit.graduatedMs > prev.graduatedMs) byMint.set(hit.mint, hit);
        }
      }
      if (oldestOnPage < cutoffMs) break;
    } catch (e) {
      console.warn(`[blind] gecko new_pools p${page}: ${e.message}`);
      break;
    }
  }

  return [...byMint.values()];
}

async function discoverGraduatedInWindow(cutoffMs, lookbackDays) {
  if (process.env.PUMP_FUN_BEARER_TOKEN || process.env.PUMP_FUN_JWT) {
    try {
      const rows = await searchGraduatedPumpCoins({ cutoffMs });
      if (rows.length) {
        console.log(`[blind] pump.fun API → ${rows.length} graduated in window`);
        return { rows, source: 'pump.fun' };
      }
    } catch (e) {
      console.warn(`[blind] pump.fun API skipped: ${e.message}`);
    }
  } else {
    console.log('[blind] pump.fun API skipped (set PUMP_FUN_BEARER_TOKEN to try first)');
  }

  if (process.env.DUNE_API_KEY) {
    try {
      const rows = await discoverGraduatedDune(lookbackDays);
      if (rows.length) {
        return { rows, source: 'dune' };
      }
    } catch (e) {
      console.warn(`[blind] Dune skipped: ${e.message}`);
    }
  } else {
    console.log('[blind] Dune skipped (set DUNE_API_KEY to use on-chain graduations)');
  }

  const rows = await discoverGraduatedGecko(cutoffMs);
  console.log(`[blind] GeckoTerminal pumpswap → ${rows.length} graduated in window`);
  return { rows, source: 'gecko:pumpswap' };
}

module.exports = { discoverGraduatedInWindow, discoverGraduatedGecko, poolToGraduation };
