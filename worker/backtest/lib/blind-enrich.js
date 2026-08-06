'use strict';

const { fetchPumpCoin } = require('./pumpfun-api');
const { fetchLaunchOhlcv } = require('./ohlcv-source');
const { pickBestPairLocal } = require('./token-source');
const { toIpfsIoGateway } = require('./ipfs-url');

const DEX_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
const HELIUS_DELAY_MS = Number(process.env.BACKTEST_HELIUS_DELAY_MS) || 120;

let lastHeliusCall = 0;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function heliusGetAsset(mint) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return null;
  const wait = Math.max(0, HELIUS_DELAY_MS - (Date.now() - lastHeliusCall));
  if (wait) await sleep(wait);
  lastHeliusCall = Date.now();
  const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'getAsset', params: { id: mint } }),
  });
  if (!r.ok) return null;
  const body = await r.json();
  return body.result || null;
}

async function fetchJsonUri(uri) {
  if (!uri) return null;
  try {
    const r = await fetch(uri, { headers: { Accept: 'application/json, */*' } });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('image/')) return null;
    const text = await r.text();
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

function pickSocial(info, type) {
  const socials = info?.socials || [];
  const hit = socials.find(s => (s.type || '').toLowerCase() === type);
  return hit?.url || null;
}

function metricsFromCandles(candles, priceUsd, fdv) {
  if (!candles.length) {
    return {
      ath_price: priceUsd || null,
      ath_mcap: fdv || null,
      peak_multiple: 1,
      current_mcap: fdv || null,
    };
  }
  const sorted = [...candles].sort((a, b) => a.unixTime - b.unixTime);
  const launchPrice = Number(sorted[0].o) || Number(sorted[0].c) || priceUsd || 0;
  let peakPrice = launchPrice;
  for (const c of sorted) {
    const h = Number(c.h) || 0;
    if (h > peakPrice) peakPrice = h;
  }
  const currentPrice = Number(sorted[sorted.length - 1].c) || launchPrice;
  const supply = priceUsd > 0 && fdv > 0 ? fdv / priceUsd : null;
  const peakMultiple = launchPrice > 0 ? peakPrice / launchPrice : 1;
  return {
    ath_price: peakPrice || null,
    ath_mcap: supply ? peakPrice * supply : (fdv ? fdv * peakMultiple : null),
    peak_multiple: peakMultiple,
    current_mcap: supply ? currentPrice * supply : fdv,
  };
}

async function enrichBlindRow(base) {
  const mint = base.mint;
  let ticker = base.ticker || null;
  let name = base.name || null;
  let description = base.description || '';
  let image_url = base.image_url || '';
  let twitter_url = base.twitter_url || '';
  let website_url = base.website_url || '';
  let created_at = base.created_at || null;
  let graduated_at = base.graduated_at || null;
  let pair = base.pair || null;

  if (process.env.PUMP_FUN_BEARER_TOKEN || process.env.PUMP_FUN_JWT) {
    try {
      const pump = await fetchPumpCoin(mint);
      if (pump) {
        ticker = pump.ticker || ticker;
        name = pump.name || name;
        description = pump.description || description;
        image_url = toIpfsIoGateway(pump.image_url || image_url);
        twitter_url = pump.twitter_url || twitter_url;
        website_url = pump.website_url || website_url;
        created_at = pump.created_at || created_at;
        graduated_at = pump.graduated_at || graduated_at;
      }
    } catch (_) { /* fall through */ }
  }

  const asset = await heliusGetAsset(mint);
  if (asset?.content) {
    const md = asset.content.metadata || {};
    const links = asset.content.links || {};
    const jsonMd = await fetchJsonUri(asset.content.json_uri);
    description = jsonMd?.description || md.description || description;
    name = jsonMd?.name || md.name || name;
    ticker = jsonMd?.symbol || md.symbol || ticker;
    image_url = toIpfsIoGateway(jsonMd?.image || links.image || image_url);
    twitter_url = jsonMd?.twitter || twitter_url;
    website_url = jsonMd?.website || website_url;
  }

  try {
    const dex = await fetchJson(`${DEX_TOKENS}${encodeURIComponent(mint)}`);
    const pairs = dex.pairs || [];
    const pumpfunPair = pairs
      .filter(p => p.chainId === 'solana' && String(p.dexId).toLowerCase() === 'pumpfun')
      .sort((a, b) => Number(a.pairCreatedAt) - Number(b.pairCreatedAt))[0];
    const pumpswapPair = pairs
      .filter(p => p.chainId === 'solana' && String(p.dexId).toLowerCase() === 'pumpswap')
      .sort((a, b) => Number(b.liquidity?.usd) - Number(a.liquidity?.usd))[0];
    pair = pickBestPairLocal(pairs, mint) || pair;

    if (pumpfunPair?.pairCreatedAt) {
      created_at = new Date(Number(pumpfunPair.pairCreatedAt)).toISOString();
    }
    if (pumpswapPair?.pairCreatedAt && !graduated_at) {
      graduated_at = new Date(Number(pumpswapPair.pairCreatedAt)).toISOString();
    }
    const info = (pumpswapPair || pumpfunPair || pair)?.info;
    if (info) {
      image_url = image_url || toIpfsIoGateway(info.imageUrl || '');
      twitter_url = twitter_url || pickSocial(info, 'twitter') || '';
      website_url = website_url || info.websites?.[0]?.url || pickSocial(info, 'website') || '';
    }
    if (!name) name = pair?.baseToken?.name || null;
    if (!ticker) ticker = pair?.baseToken?.symbol || null;
  } catch (_) { /* optional */ }

  if (!created_at && graduated_at) created_at = graduated_at;
  if (!graduated_at && base.graduated_at) graduated_at = base.graduated_at;

  const launchMs = created_at ? Date.parse(created_at) : Date.parse(graduated_at);
  let ath = {
    ath_price: null,
    ath_mcap: null,
    peak_multiple: null,
    current_mcap: null,
    liquidity_now: pair?.liquidity?.usd || null,
  };
  if (launchMs && Number.isFinite(launchMs)) {
    try {
      const { candles } = await fetchLaunchOhlcv(mint, launchMs, pair);
      const priceUsd = Number(pair?.priceUsd) || 0;
      const fdv = Number(pair?.fdv || pair?.marketCap) || 0;
      ath = { ...ath, ...metricsFromCandles(candles, priceUsd, fdv) };
    } catch (_) {
      const fdv = Number(pair?.fdv || pair?.marketCap) || null;
      ath.current_mcap = fdv;
      ath.ath_mcap = fdv;
      ath.ath_price = Number(pair?.priceUsd) || null;
      ath.peak_multiple = 1;
    }
  }

  return {
    mint,
    ticker: ticker || '',
    name: name || '',
    description: description || '',
    image_url: toIpfsIoGateway(image_url) || '',
    twitter_url: twitter_url || '',
    website_url: website_url || '',
    created_at: created_at || '',
    graduated_at: graduated_at || '',
    pumpfun_url: `https://pump.fun/${mint}`,
    liquidity_now: pair?.liquidity?.usd ?? null,
    ...ath,
  };
}

/** Metadata + liquidity only — no OHLCV / outcome fields (backtest2 blind). */
async function enrichBlindMetadata(base) {
  const mint = base.mint;
  let ticker = base.ticker || null;
  let name = base.name || null;
  let description = base.description || '';
  let twitter_url = base.twitter_url || '';
  let created_at = base.created_at || null;
  let graduated_at = base.graduated_at || null;
  let pair = null;

  if (process.env.PUMP_FUN_BEARER_TOKEN || process.env.PUMP_FUN_JWT) {
    try {
      const pump = await fetchPumpCoin(mint);
      if (pump) {
        ticker = pump.ticker || ticker;
        name = pump.name || name;
        description = pump.description || description;
        twitter_url = pump.twitter_url || twitter_url;
        created_at = pump.created_at || created_at;
        graduated_at = pump.graduated_at || graduated_at;
      }
    } catch (_) { /* fall through */ }
  }

  const asset = await heliusGetAsset(mint);
  if (asset?.content) {
    const md = asset.content.metadata || {};
    const jsonMd = await fetchJsonUri(asset.content.json_uri);
    description = jsonMd?.description || md.description || description;
    name = jsonMd?.name || md.name || name;
    ticker = jsonMd?.symbol || md.symbol || ticker;
    twitter_url = jsonMd?.twitter || twitter_url;
  }

  try {
    const dex = await fetchJson(`${DEX_TOKENS}${encodeURIComponent(mint)}`);
    const pairs = dex.pairs || [];
    const pumpfunPair = pairs
      .filter(p => p.chainId === 'solana' && String(p.dexId).toLowerCase() === 'pumpfun')
      .sort((a, b) => Number(a.pairCreatedAt) - Number(b.pairCreatedAt))[0];
    pair = pickBestPairLocal(pairs, mint);
    if (pumpfunPair?.pairCreatedAt) {
      created_at = new Date(Number(pumpfunPair.pairCreatedAt)).toISOString();
    }
    const info = pair?.info;
    if (info) {
      twitter_url = twitter_url || pickSocial(info, 'twitter') || '';
    }
    if (!name) name = pair?.baseToken?.name || null;
    if (!ticker) ticker = pair?.baseToken?.symbol || null;
  } catch (_) { /* optional */ }

  if (!created_at && graduated_at) created_at = graduated_at;
  if (!created_at && base.graduated_at) created_at = base.graduated_at;

  const sym = ticker || name || mint.slice(0, 8);
  const x_search_url = sym
    ? `https://x.com/search?q=${encodeURIComponent(sym)}&src=typed_query&f=top`
    : '';

  return {
    mint,
    ticker: ticker || '',
    name: name || '',
    description: description || '',
    coin_created_at: created_at || '',
    metadata_twitter: twitter_url || '',
    x_search_url,
    pumpfun_url: `https://pump.fun/${mint}`,
    liquidity_now: pair?.liquidity?.usd ?? null,
  };
}

module.exports = { enrichBlindRow, enrichBlindMetadata, metricsFromCandles };
