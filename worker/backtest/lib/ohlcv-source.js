'use strict';

const { CONFIG } = require('./config');

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2';
const GECKO_DELAY_MS = Number(process.env.BACKTEST_GECKO_DELAY_MS) || 1200;

let lastGeckoCall = 0;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function geckoFetch(path, query = {}) {
  const wait = Math.max(0, GECKO_DELAY_MS - (Date.now() - lastGeckoCall));
  if (wait) await sleep(wait);
  lastGeckoCall = Date.now();

  const qs = new URLSearchParams(query);
  const url = `${GECKO_BASE}${path}${qs.size ? `?${qs}` : ''}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (r.status === 429) {
    await sleep(5000);
    return geckoFetch(path, query);
  }
  if (!r.ok) throw new Error(`GeckoTerminal HTTP ${r.status}`);
  return r.json();
}

function normalizeCandles(rawList) {
  return (rawList || [])
    .map(row => {
      if (!Array.isArray(row) || row.length < 5) return null;
      return {
        unixTime: Number(row[0]),
        o: Number(row[1]),
        h: Number(row[2]),
        l: Number(row[3]),
        c: Number(row[4]),
      };
    })
    .filter(c => c && Number.isFinite(c.h) && (Number.isFinite(c.o) || Number.isFinite(c.c)));
}

function pickGeckoPool(pools, launchMs, pairAddress) {
  const list = pools?.data || [];
  if (!list.length) return null;

  if (pairAddress) {
    const exact = list.find(p => p.attributes?.address === pairAddress);
    if (exact) return exact.attributes.address;
  }

  const scored = list
    .map(p => {
      const a = p.attributes || {};
      const created = a.pool_created_at ? Date.parse(a.pool_created_at) : 0;
      const reserve = Number(a.reserve_in_usd) || 0;
      const vol = Number(a.volume_usd?.h24) || 0;
      const dex = p.relationships?.dex?.data?.id || '';
      let score = reserve + vol * 0.01;
      if (/pump/i.test(dex)) score += 50_000;
      if (launchMs && created) score -= Math.min(Math.abs(created - launchMs) / 60_000, 10_000);
      return { address: a.address, score, reserve };
    })
    .filter(p => p.address && p.reserve > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.address || list[0]?.attributes?.address || null;
}

async function resolvePoolAddress(mint, pair, launchMs) {
  const pairAddress = pair?.pairAddress || pair?.address || null;
  if (pairAddress) return pairAddress;

  const pools = await geckoFetch(`/networks/solana/tokens/${encodeURIComponent(mint)}/pools`, {
    page: '1',
  });
  return pickGeckoPool(pools, launchMs, null);
}

async function geckoterminalOhlcv(mint, launchMs, pair) {
  const windowSec = (CONFIG.OHLCV_HOURS_AFTER_LAUNCH || 72) * 3600;
  const timeFrom = Math.floor(launchMs / 1000);
  const timeTo = Math.floor(Math.min(Date.now(), launchMs + windowSec * 1000) / 1000);

  let poolAddress = await resolvePoolAddress(mint, pair, launchMs);
  if (!poolAddress) throw new Error('no GeckoTerminal pool');

  let candles = [];
  try {
    candles = await fetchGeckoCandles(poolAddress, timeFrom, timeTo);
  } catch (_) {
    const pools = await geckoFetch(`/networks/solana/tokens/${encodeURIComponent(mint)}/pools`, {
      page: '1',
    });
    poolAddress = pickGeckoPool(pools, launchMs, pair?.pairAddress);
    if (!poolAddress) throw new Error('no GeckoTerminal pool');
    candles = await fetchGeckoCandles(poolAddress, timeFrom, timeTo);
  }
  return candles;
}

async function fetchGeckoCandles(poolAddress, timeFrom, timeTo) {
  const raw = await geckoFetch(
    `/networks/solana/pools/${encodeURIComponent(poolAddress)}/ohlcv/minute`,
    {
      aggregate: '15',
      limit: '1000',
      before_timestamp: String(timeTo),
    },
  );
  const candles = normalizeCandles(raw?.data?.attributes?.ohlcv_list);
  return candles.filter(c => c.unixTime >= timeFrom && c.unixTime <= timeTo);
}

async function birdeyeOhlcv(mint, launchMs, apiKey) {
  const windowMs = (CONFIG.OHLCV_HOURS_AFTER_LAUNCH || 72) * 3_600_000;
  const time_from = Math.floor(launchMs / 1000);
  const time_to = Math.floor(Math.min(Date.now(), launchMs + windowMs) / 1000);
  const qs = new URLSearchParams({
    address: mint,
    type: '15m',
    currency: 'usd',
    time_from: String(time_from),
    time_to: String(time_to),
  });
  const delay = Number(process.env.BACKTEST_BIRDEYE_DELAY_MS) || 1500;
  await sleep(delay);
  const r = await fetch(`https://public-api.birdeye.so/defi/ohlcv?${qs}`, {
    headers: { 'X-API-KEY': apiKey, 'x-chain': 'solana', Accept: 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.message || `Birdeye HTTP ${r.status}`);
  const items = body?.data?.items || body?.data?.candles || [];
  return items
    .filter(c => c.h != null && (c.o != null || c.c != null))
    .map(c => ({
      unixTime: c.unixTime ?? c.unix_time,
      o: Number(c.o),
      h: Number(c.h),
      l: Number(c.l),
      c: Number(c.c),
    }));
}

async function fetchLaunchOhlcv(mint, launchMs, pair) {
  const source = (CONFIG.ATH_OHLCV_SOURCE || 'geckoterminal').toLowerCase();

  if (source === 'none' || source === 'dexscreener') {
    return { candles: [], source: 'dexscreener_no_ohlcv' };
  }

  if (source === 'birdeye') {
    const apiKey = process.env.BIRDEYE_API_KEY || '';
    if (!apiKey) throw new Error('BIRDEYE_API_KEY required when BACKTEST_ATH_SOURCE=birdeye');
    const candles = await birdeyeOhlcv(mint, launchMs, apiKey);
    return { candles, source: 'birdeye_ohlcv' };
  }

  if (source === 'geckoterminal' || source === 'gecko') {
    const candles = await geckoterminalOhlcv(mint, launchMs, pair);
    return { candles, source: 'geckoterminal_ohlcv' };
  }

  throw new Error(`Unknown BACKTEST_ATH_SOURCE: ${source}`);
}

module.exports = {
  fetchLaunchOhlcv,
  normalizeCandles,
  pickGeckoPool,
};
