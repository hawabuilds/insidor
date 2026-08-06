'use strict';

const { normalizeSymbol } = require('../../../lib/token-lookup');
const { CONFIG } = require('./config');

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_DELAY_MS = Number(process.env.BACKTEST_GECKO_DELAY_MS) || 2000;

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
  if (r.status === 429 || r.status === 401) {
    const backoff = Math.min(60_000, 8000 * (attempt + 1));
    await sleep(backoff);
    if (attempt < 5) return geckoFetch(path, query, attempt + 1);
    throw new Error(`GeckoTerminal rate limited (${r.status})`);
  }
  if (!r.ok) throw new Error(`GeckoTerminal HTTP ${r.status}`);
  return r.json();
}

function geckoPoolToPair(pool) {
  const a = pool.attributes || {};
  const mint = (pool.relationships?.base_token?.data?.id || '').replace(/^solana_/, '');
  const symbol = (a.name || '').split('/')[0]?.trim() || null;
  return {
    chainId: 'solana',
    pairAddress: a.address,
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    liquidity: { usd: Number(a.reserve_in_usd) || 0 },
    priceUsd: a.base_token_price_usd,
    fdv: a.fdv_usd,
    marketCap: a.market_cap_usd,
    baseToken: { address: mint, symbol, name: symbol },
    dexId: pool.relationships?.dex?.data?.id || 'pumpswap',
  };
}

function hitFromGeckoPool(pool, cutoffMs) {
  const dex = pool.relationships?.dex?.data?.id || '';
  if (dex !== 'pumpswap') return null;

  const pair = geckoPoolToPair(pool);
  const mint = pair.baseToken?.address;
  if (!mint || !/pump$/i.test(mint)) return null;

  const launchMs = pair.pairCreatedAt;
  if (!launchMs || launchMs < cutoffMs) return null;

  const liq = Number(pair.liquidity?.usd) || 0;
  const minReserve = CONFIG.MIN_GRADUATED_RESERVE_USD || 0;
  if (liq < minReserve) return null;

  return {
    mint,
    launchMs,
    liq,
    pair,
    ticker: pair.baseToken?.symbol,
    source: 'gecko:graduated',
  };
}

function dedupeByTicker(hits, seedMints = []) {
  if (CONFIG.TICKER_DEDUP === false) return { hits, dropped: 0 };

  const seedSet = new Set(seedMints);
  const seeds = [];
  const byTicker = new Map();
  let dropped = 0;

  for (const hit of hits) {
    if (seedSet.has(hit.mint)) {
      seeds.push(hit);
      continue;
    }
    const key = normalizeSymbol(hit.ticker || hit.pair?.baseToken?.symbol || '');
    if (!key) {
      byTicker.set(`__${hit.mint}`, hit);
      continue;
    }
    const prev = byTicker.get(key);
    if (!prev) {
      byTicker.set(key, hit);
    } else if (hit.liq > prev.liq || (hit.liq === prev.liq && hit.launchMs > prev.launchMs)) {
      byTicker.set(key, hit);
      dropped += 1;
    } else {
      dropped += 1;
    }
  }

  return { hits: [...seeds, ...byTicker.values()], dropped };
}

async function discoverFromGeckoGraduated(cutoffMs, {
  excludeMints = new Set(),
  startPage = 1,
  skipNewPools = false,
} = {}) {
  const byMint = new Map();
  const maxPages = CONFIG.GECKO_MAX_PAGES || 30;
  let lastPumpswapPage = Math.max(0, startPage - 1);

  for (let page = startPage; page <= maxPages; page++) {
    try {
      const data = await geckoFetch('/networks/solana/dexes/pumpswap/pools', { page: String(page) });
      const pools = data?.data || [];
      if (!pools.length) break;

      lastPumpswapPage = page;
      let inWindow = 0;
      for (const pool of pools) {
        const hit = hitFromGeckoPool(pool, cutoffMs);
        if (hit && !excludeMints.has(hit.mint)) {
          inWindow += 1;
          const prev = byMint.get(hit.mint);
          if (!prev || hit.liq > prev.liq) byMint.set(hit.mint, hit);
        }
      }

      if (inWindow === 0 && page > startPage + 2) break;
    } catch (e) {
      console.warn(`[backtest:tokens] gecko pumpswap page ${page}: ${e.message}`);
      lastPumpswapPage = page;
      break;
    }
  }

  let newPoolsScanned = skipNewPools;
  if (!skipNewPools) {
    for (let page = 1; page <= Math.min(10, maxPages); page++) {
      try {
        const data = await geckoFetch('/networks/solana/new_pools', { page: String(page) });
        const pools = data?.data || [];
        if (!pools.length) break;

        let oldestOnPage = Infinity;
        for (const pool of pools) {
          const created = pool.attributes?.pool_created_at;
          if (created) oldestOnPage = Math.min(oldestOnPage, Date.parse(created));
          const hit = hitFromGeckoPool(pool, cutoffMs);
          if (hit && !excludeMints.has(hit.mint)) {
            const prev = byMint.get(hit.mint);
            if (!prev || hit.liq > prev.liq) byMint.set(hit.mint, hit);
          }
        }
        if (oldestOnPage < cutoffMs) break;
      } catch (e) {
        console.warn(`[backtest:tokens] gecko new_pools page ${page}: ${e.message}`);
        break;
      }
    }
    newPoolsScanned = true;
  }

  const raw = [...byMint.values()];
  const { hits: deduped, dropped } = dedupeByTicker(raw);
  deduped.sort((a, b) => b.launchMs - a.launchMs);

  const cap = CONFIG.MAX_DISCOVERY_CANDIDATES || 500;
  const capped = deduped.slice(0, cap);

  console.log(
    `[backtest:tokens] gecko graduated: pumpswap p${startPage}–p${lastPumpswapPage} · ` +
    `${raw.length} mints in window · ticker dedup −${dropped} → ${deduped.length} · cap ${cap} → ${capped.length}`,
  );

  return {
    hits: capped,
    checkpoint: { lastPumpswapPage, newPoolsScanned },
  };
}

module.exports = {
  discoverFromGeckoGraduated,
  dedupeByTicker,
  geckoPoolToPair,
};
