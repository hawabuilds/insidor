'use strict';

const {
  lookupMint,
  pickBestPair,
  isPumpFunPair,
  normalizeSymbol,
} = require('../../../lib/token-lookup');
const { CONFIG } = require('./config');
const { fetchLaunchOhlcv } = require('./ohlcv-source');
const { discoverFromGeckoGraduated } = require('./graduated-discovery');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const EXCLUDED_MINTS = new Set([SOL_MINT, USDC_MINT, USDT_MINT]);

const DEX_SEARCH = 'https://api.dexscreener.com/latest/dex/search?q=';
const DEX_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
const DEX_PROFILES = 'https://api.dexscreener.com/token-profiles/latest/v1';
const DEX_BOOSTS = 'https://api.dexscreener.com/token-boosts/latest/v1';
const BIRDEYE_NEW = 'https://public-api.birdeye.so/defi/v2/tokens/new_listing';

const SEARCH_SEEDS = [
  'pump', 'meme', 'trump', 'ai', 'cat', 'dog', 'pepe', 'viral', 'based', 'wif', 'bonk',
  'frog', 'elon', 'maga', 'hood', 'coin', 'fun', 'moon', 'baby', 'giga', 'chad', 'sigma',
  'tiktok', 'trend', 'naked', 'scream', 'hair', 'solana meme',
];

const MAX_SANITY_LIQ_USD = Number(process.env.BACKTEST_MAX_SANITY_LIQ_USD) || 5_000_000;
const BIRDEYE_DELAY_MS = Number(process.env.BACKTEST_BIRDEYE_DELAY_MS) || 1500;

let lastBirdeyeCall = 0;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url, headers = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function birdeyeFetch(url, apiKey, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const wait = Math.max(0, BIRDEYE_DELAY_MS - (Date.now() - lastBirdeyeCall));
    if (wait) await sleep(wait);
    lastBirdeyeCall = Date.now();

    const r = await fetch(url, {
      headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana', Accept: 'application/json' },
    });
    if (r.status === 429 && attempt < retries - 1) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }
  throw new Error('Birdeye retries exhausted');
}

function isSolanaChain(item) {
  const c = (item.chainId || item.chain || '').toLowerCase();
  return c === 'solana' || c === 'sol';
}

function isGraduatedPair(pair) {
  return String(pair?.dexId || '').toLowerCase() === 'pumpswap';
}

function isPumpCandidate(mint, pair) {
  if (!mint) return false;
  if (CONFIG.DISCOVERY_MODE === 'graduated') {
    return isGraduatedPair(pair);
  }
  if (/pump$/i.test(mint)) return true;
  if (pair && isPumpFunPair(pair)) return true;
  return false;
}

function isExcludedMint(mint, ticker, pair) {
  if (!mint || EXCLUDED_MINTS.has(mint)) return true;
  const sym = normalizeSymbol(ticker || pair?.baseToken?.symbol);
  if (sym === 'SOL' || sym === 'WSOL' || sym === 'USDC' || sym === 'USDT') return true;
  if (sym === 'SOL' && !/pump$/i.test(mint)) return true;
  return false;
}

function passesSanity(enriched) {
  const currentLiq = Number(enriched.raw?.pair?.liquidity?.usd) || 0;
  const currentMcap = Number(enriched.current_mcap)
    || Number(enriched.raw?.pair?.marketCap)
    || Number(enriched.raw?.pair?.fdv)
    || 0;
  if (currentLiq > MAX_SANITY_LIQ_USD) {
    return { ok: false, reason: `liquidity sanity cap ($${Math.round(currentLiq)})` };
  }
  if (currentMcap > MAX_SANITY_LIQ_USD * 2) {
    return { ok: false, reason: `mcap sanity cap ($${Math.round(currentMcap)})` };
  }
  if (isExcludedMint(enriched.mint, enriched.ticker, enriched.raw?.pair)) {
    return { ok: false, reason: 'excluded mint/ticker' };
  }
  return { ok: true };
}

function pickBestPairLocal(pairs, mint) {
  const pool = (pairs || []).filter(p => (p.chainId || p.chain) === 'solana');
  const forMint = mint ? pool.filter(p => p.baseToken?.address === mint) : pool;
  if (!forMint.length) return null;
  const graduated = forMint.filter(isGraduatedPair);
  const pumpFirst = forMint.filter(isPumpFunPair);
  let ranked = forMint;
  if (CONFIG.DISCOVERY_MODE === 'graduated') {
    ranked = graduated.length ? graduated : [];
  } else if (pumpFirst.length) {
    ranked = pumpFirst;
  }
  if (!ranked.length) return null;
  return pickBestPair(ranked, { mint });
}

function addDiscovery(map, mint, launchMs, pair, source) {
  if (!mint || !isPumpCandidate(mint, pair)) return;
  if (isExcludedMint(mint, pair?.baseToken?.symbol, pair)) return;
  const liq = Number(pair?.liquidity?.usd) || 0;
  const prev = map.get(mint);
  if (!prev || liq > prev.liq || launchMs > prev.launchMs) {
    map.set(mint, { mint, launchMs: launchMs || pair?.pairCreatedAt || Date.now(), liq, pair, source });
  }
}

async function resolveLaunchMs(mint, hintMs, pair) {
  if (hintMs) return hintMs;
  if (pair?.pairCreatedAt) return Number(pair.pairCreatedAt);
  try {
    const lookup = await lookupMint(mint);
    if (lookup.found && lookup.ageMin) {
      return Date.now() - lookup.ageMin * 60_000;
    }
  } catch (_) { /* fall through */ }
  return Date.now();
}

function metricsFromOhlcv(candles, pair, lookup, ohlcvSource = 'geckoterminal_ohlcv') {
  const currentLiq = Number(pair?.liquidity?.usd) || Number(lookup?.liquidity) || 0;
  const priceUsd = Number(pair?.priceUsd) || Number(lookup?.priceUsd) || 0;
  const fdv = Number(pair?.fdv || pair?.marketCap) || Number(lookup?.mcap) || 0;
  const supply = priceUsd > 0 && fdv > 0 ? fdv / priceUsd : null;

  if (!candles.length) {
    return {
      peak_multiple: 1,
      peak_mcap: fdv,
      current_mcap: fdv,
      peak_liquidity: currentLiq,
      holders: null,
      source: 'dexscreener_no_ohlcv',
    };
  }

  const sorted = [...candles].sort(
    (a, b) => (a.unixTime ?? a.unix_time ?? 0) - (b.unixTime ?? b.unix_time ?? 0),
  );
  const launchPrice = Number(sorted[0].o) || Number(sorted[0].c) || priceUsd || 0;
  let peakPrice = launchPrice;
  for (const c of sorted) {
    const h = Number(c.h) || 0;
    if (h > peakPrice) peakPrice = h;
  }
  const currentPrice = Number(sorted[sorted.length - 1].c) || launchPrice;
  const peakMultiple = launchPrice > 0 ? peakPrice / launchPrice : 1;
  const peakMcap = supply ? peakPrice * supply : fdv * peakMultiple;
  const currentMcap = supply ? currentPrice * supply : fdv;
  const peakLiqEstimate = currentLiq;

  return {
    peak_multiple: peakMultiple,
    peak_mcap: peakMcap,
    current_mcap: currentMcap,
    peak_liquidity: peakLiqEstimate,
    holders: null,
    source: ohlcvSource,
  };
}

async function enrichMint(mint, launchMsHint) {
  let pair = null;
  let lookup = { found: false };
  try {
    const data = await fetchJson(`${DEX_TOKENS}${encodeURIComponent(mint)}`);
    pair = pickBestPairLocal(data.pairs, mint);
    lookup = await lookupMint(mint);
  } catch (e) {
    throw new Error(`DexScreener: ${e.message}`);
  }

  if (!lookup.found && !pair) throw new Error('not found on DexScreener');
  if (!isPumpCandidate(mint, pair)) {
    throw new Error(
      CONFIG.DISCOVERY_MODE === 'graduated'
        ? 'not graduated (no pumpswap pair)'
        : 'not pump.fun candidate',
    );
  }

  const launchAt = new Date(await resolveLaunchMs(mint, launchMsHint, pair));

  let metrics;
  try {
    const { candles, source } = await fetchLaunchOhlcv(mint, launchAt.getTime(), pair);
    metrics = metricsFromOhlcv(candles, pair, lookup, source);
  } catch (e) {
    console.warn(`[backtest:tokens] ATH fallback for ${mint.slice(0, 8)}…: ${e.message}`);
    metrics = metricsFromOhlcv([], pair, lookup);
  }

  const liq = Number(pair?.liquidity?.usd) || Number(lookup.liquidity) || metrics.peak_liquidity || 0;
  const liquidityExists = liq >= CONFIG.LOSER_LIQ_FLOOR_USD;
  const ageH = (Date.now() - launchAt.getTime()) / 3_600_000;
  const liquidityDeadWithin24h = ageH <= CONFIG.LOSER_LIQ_DEAD_HOURS && !liquidityExists;

  const enriched = {
    mint,
    ticker: lookup.ticker || pair?.baseToken?.symbol || null,
    name: lookup.name || pair?.baseToken?.name || null,
    launch_at: launchAt.toISOString(),
    peak_mcap: metrics.peak_mcap,
    peak_multiple: metrics.peak_multiple,
    current_mcap: metrics.current_mcap,
    peak_liquidity: metrics.peak_liquidity ?? liq,
    holders: metrics.holders,
    liquidity_exists: liquidityExists,
    liquidity_dead_within_24h: liquidityDeadWithin24h,
    source: metrics.source,
    raw: { lookup, pair },
  };

  const sanity = passesSanity(enriched);
  if (!sanity.ok) throw new Error(sanity.reason);
  return enriched;
}

async function discoverFromDexSearch(cutoffMs, map) {
  for (const seed of SEARCH_SEEDS) {
    try {
      const data = await fetchJson(DEX_SEARCH + encodeURIComponent(seed));
      for (const pair of data.pairs || []) {
        if ((pair.chainId || pair.chain) !== 'solana') continue;
        const created = Number(pair.pairCreatedAt) || 0;
        if (!created || created < cutoffMs) continue;
        addDiscovery(map, pair.baseToken?.address, created, pair, `search:${seed}`);
      }
      await sleep(150);
    } catch (e) {
      console.warn(`[backtest:tokens] search "${seed}": ${e.message}`);
    }
  }
}

async function discoverFromDexProfiles(cutoffMs, map) {
  try {
    const profiles = await fetchJson(DEX_PROFILES);
    for (const p of (Array.isArray(profiles) ? profiles : [])) {
      if (!isSolanaChain(p)) continue;
      const mint = p.tokenAddress || p.token_address;
      addDiscovery(map, mint, null, null, 'profiles');
    }
  } catch (e) {
    console.warn(`[backtest:tokens] profiles: ${e.message}`);
  }

  try {
    const boosts = await fetchJson(DEX_BOOSTS);
    for (const p of (Array.isArray(boosts) ? boosts : [])) {
      if (!isSolanaChain(p)) continue;
      const mint = p.tokenAddress || p.token_address;
      addDiscovery(map, mint, null, null, 'boosts');
    }
  } catch (e) {
    console.warn(`[backtest:tokens] boosts: ${e.message}`);
  }

  for (const [mint, hit] of [...map.entries()]) {
    if (hit.source === 'seed' && hit.pair && hit.launchMs) continue;
    if (hit.launchMs && hit.launchMs >= cutoffMs && hit.pair) continue;
    try {
      const data = await fetchJson(`${DEX_TOKENS}${encodeURIComponent(mint)}`);
      const pair = pickBestPairLocal(data.pairs, mint);
      if (!pair || !isPumpCandidate(mint, pair)) {
        map.delete(mint);
        continue;
      }
      const created = Number(pair.pairCreatedAt) || 0;
      if ((!created || created < cutoffMs) && hit.source !== 'seed') {
        map.delete(mint);
        continue;
      }
      hit.launchMs = created;
      hit.pair = pair;
      hit.liq = Number(pair.liquidity?.usd) || 0;
      await sleep(80);
    } catch (_) {
      map.delete(mint);
    }
  }
}

async function discoverFromBirdeye(cutoffMs, apiKey) {
  const out = [];
  if (!apiKey) return out;
  let offset = 0;
  for (let page = 0; page < 6; page++) {
    try {
      const url = `${BIRDEYE_NEW}?limit=50&offset=${offset}`;
      const raw = await birdeyeFetch(url, apiKey);
      const items = raw?.data?.items || raw?.data?.tokens || raw?.data || [];
      if (!Array.isArray(items) || !items.length) break;
      for (const item of items) {
        const mint = item.address || item.mint;
        const ts = item.liquidityAddedAt || item.createdAt || item.createTime;
        const launchMs = ts ? (ts > 1e12 ? ts : ts * 1000) : 0;
        if (!mint || !launchMs || launchMs < cutoffMs) continue;
        if (!isPumpCandidate(mint, null) && !/pump$/i.test(mint)) continue;
        out.push({ mint, launchMs, liq: Number(item.liquidity) || 0, item });
      }
      offset += items.length;
      if (items.length < 50) break;
    } catch (e) {
      console.warn(`[backtest:tokens] Birdeye page ${page}: ${e.message}`);
      break;
    }
  }
  return out;
}

async function discoverFromSeedMints(cutoffMs, seeds = []) {
  const out = [];
  for (const mint of seeds) {
    if (!mint || !/pump$/i.test(mint)) continue;
    try {
      const data = await fetchJson(`${DEX_TOKENS}${encodeURIComponent(mint)}`);
      const pair = pickBestPairLocal(data.pairs, mint);
      if (!pair || !isPumpCandidate(mint, pair)) continue;
      const launchMs = Number(pair.pairCreatedAt) || Date.now();
      if (launchMs < cutoffMs) {
        console.log(`[backtest:tokens] seed ${mint.slice(0, 8)}… outside lookback (still included)`);
      }
      out.push({
        mint,
        launchMs,
        liq: Number(pair.liquidity?.usd) || 0,
        pair,
        source: 'seed',
      });
      await sleep(80);
    } catch (e) {
      console.warn(`[backtest:tokens] seed ${mint.slice(0, 8)}…: ${e.message}`);
    }
  }
  return out;
}

async function discoverFromGraduated(cutoffMs, seedMints = [], opts = {}) {
  const {
    excludeMints = new Set(),
    supplementLegacy = false,
    geckoStartPage = 1,
    skipNewPools = false,
  } = opts;
  const map = new Map();

  for (const hit of await discoverFromSeedMints(cutoffMs, seedMints)) {
    if (!excludeMints.has(hit.mint)) addDiscovery(map, hit.mint, hit.launchMs, hit.pair, hit.source);
  }
  if (seedMints.length && !excludeMints.size) {
    console.log(`[backtest:tokens] seed mints → ${map.size} pump candidates`);
  }

  const gecko = await discoverFromGeckoGraduated(cutoffMs, {
    excludeMints,
    startPage: geckoStartPage,
    skipNewPools,
  });
  for (const hit of gecko.hits) {
    if (!map.has(hit.mint)) map.set(hit.mint, hit);
  }

  if (supplementLegacy) {
    const legacyMap = new Map();
    await discoverFromDexSearch(cutoffMs, legacyMap);
    await discoverFromDexProfiles(cutoffMs, legacyMap);
    let added = 0;
    for (const hit of legacyMap.values()) {
      if (excludeMints.has(hit.mint)) continue;
      if (hit.launchMs < cutoffMs && hit.source !== 'seed') continue;
      if (!map.has(hit.mint)) {
        map.set(hit.mint, hit);
        added += 1;
      }
    }
    if (added) console.log(`[backtest:tokens] legacy supplement → +${added} (total ${map.size})`);
  }

  return {
    hits: [...map.values()],
    checkpoint: gecko.checkpoint,
  };
}

async function discoverTokens(cutoffMs, seedMints = [], opts = {}) {
  if (CONFIG.DISCOVERY_MODE === 'legacy') {
    return { hits: await discoverFromDexScreener(cutoffMs, seedMints, opts), checkpoint: null };
  }
  return discoverFromGraduated(cutoffMs, seedMints, opts);
}

async function discoverFromDexScreener(cutoffMs, seedMints = [], opts = {}) {
  const { excludeMints = new Set() } = opts;
  const map = new Map();
  for (const hit of await discoverFromSeedMints(cutoffMs, seedMints)) {
    if (!excludeMints.has(hit.mint)) addDiscovery(map, hit.mint, hit.launchMs, hit.pair, hit.source);
  }
  if (seedMints.length) {
    console.log(`[backtest:tokens] seed mints → ${map.size} pump candidates`);
  }
  await discoverFromDexSearch(cutoffMs, map);
  console.log(`[backtest:tokens] search seeds → ${map.size} pump candidates`);
  await discoverFromDexProfiles(cutoffMs, map);
  console.log(`[backtest:tokens] + profiles/boosts → ${map.size} pump candidates`);
  return [...map.values()].filter(h => !excludeMints.has(h.mint) && (h.launchMs >= cutoffMs || h.source === 'seed'));
}

function classifyOutcome(token) {
  const mult = Number(token.peak_multiple) || 0;
  const peakLiq = Number(token.peak_liquidity) || 0;
  const peakMcap = Number(token.peak_mcap) || 0;
  const winnerMcapOk = peakMcap >= (CONFIG.WINNER_PEAK_MCAP_USD || CONFIG.WINNER_PEAK_LIQ_USD);
  const winnerLiqOk = peakLiq >= CONFIG.WINNER_PEAK_LIQ_USD;
  const winner = mult >= CONFIG.WINNER_PEAK_MULTIPLE && (winnerLiqOk || winnerMcapOk);
  const loser = mult < CONFIG.LOSER_PEAK_MULTIPLE || token.liquidity_dead_within_24h;
  if (winner && !loser) return 'winner';
  if (loser && !winner) return 'loser';
  return 'ignored';
}

module.exports = {
  discoverTokens,
  discoverFromGraduated,
  discoverFromDexScreener,
  discoverFromSeedMints,
  discoverFromBirdeye,
  enrichMint,
  classifyOutcome,
  pickBestPairLocal,
  isPumpCandidate,
  isGraduatedPair,
  passesSanity,
};
