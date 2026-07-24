'use strict';

const DEX_SEARCH = 'https://api.dexscreener.com/latest/dex/search?q=';
const DEX_TOKENS = 'https://api.dexscreener.com/latest/dex/tokens/';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PUMP_DEX_IDS = new Set(['pumpfun', 'pumpswap', 'pump']);

function normalizeSymbol(ticker) {
  return String(ticker || '').toUpperCase().replace(/^\$/, '').trim();
}

function isSolanaPair(pair) {
  return (pair.chainId || pair.chain) === 'solana';
}

function exactSymbolMatch(pair, ticker) {
  return normalizeSymbol(pair.baseToken?.symbol) === normalizeSymbol(ticker);
}

function isPumpFunPair(pair) {
  const dex = String(pair.dexId || '').toLowerCase();
  if (PUMP_DEX_IDS.has(dex)) return true;
  const mint = pair.baseToken?.address || '';
  if (/pump$/i.test(mint)) return true;
  return /pump\.fun/i.test(pair.url || '');
}

function pairLiquidity(pair) {
  return Number(pair.liquidity?.usd) || 0;
}

function pairVolume24h(pair) {
  return Number(pair.volume?.h24) || 0;
}

function quoteSymbol(pair) {
  return String(pair.quoteToken?.symbol || '').toUpperCase();
}

/** Prefer SOL/WSOL quote pairs over USDC/USDT for charts and pricing. */
function isSolQuotePair(pair) {
  const sym = quoteSymbol(pair);
  const addr = String(pair.quoteToken?.address || '').toLowerCase();
  return sym === 'SOL' || sym === 'WSOL' || addr === SOL_MINT.toLowerCase();
}

/** Higher return value = better pair (SOL quote first, then 24h volume, then liquidity). */
function comparePairs(a, b) {
  const aSol = isSolQuotePair(a) ? 1 : 0;
  const bSol = isSolQuotePair(b) ? 1 : 0;
  if (aSol !== bSol) return bSol - aSol;
  const volDiff = pairVolume24h(b) - pairVolume24h(a);
  if (volDiff !== 0) return volDiff;
  return pairLiquidity(b) - pairLiquidity(a);
}

function pickBestPair(pairs, { ticker, mint } = {}) {
  let pool = (pairs || []).filter(isSolanaPair);
  if (mint) pool = pool.filter(p => p.baseToken?.address === mint);
  if (ticker) {
    const sym = normalizeSymbol(ticker);
    const exact = pool.filter(p => exactSymbolMatch(p, sym));
    if (exact.length) pool = exact;
  }
  if (!pool.length) return null;
  return pool.reduce((best, p) => (!best || comparePairs(best, p) > 0 ? p : best));
}

function ageMinFromPair(pair) {
  if (!pair.pairCreatedAt) return 0;
  return Math.max(1, Math.round((Date.now() - pair.pairCreatedAt) / 60_000));
}

function mapPair(pair, ticker) {
  const mint = pair.baseToken?.address || null;
  const onPumpFun = isPumpFunPair(pair);
  return {
    found: true,
    ticker: normalizeSymbol(ticker),
    mint,
    name: pair.baseToken?.name || normalizeSymbol(ticker),
    mcap: Number(pair.marketCap ?? pair.fdv) || 0,
    liquidity: pairLiquidity(pair),
    vol24h: Number(pair.volume?.h24) || 0,
    ageMin: ageMinFromPair(pair),
    priceUsd: parseFloat(pair.priceUsd) || 0,
    dexUrl: pair.url || (pair.pairAddress ? `https://dexscreener.com/solana/${pair.pairAddress}` : (mint ? `https://dexscreener.com/solana/${mint}` : null)),
    pumpUrl: mint ? `https://pump.fun/${mint}` : null,
    onPumpFun,
    dexId: pair.dexId || null,
    pairAddress: pair.pairAddress || null,
  };
}

function pairMatchesQuery(pair, query) {
  const raw = String(query || '').trim();
  if (!raw) return false;
  const nq = raw.toLowerCase();
  const sym = normalizeSymbol(pair.baseToken?.symbol).toLowerCase();
  const name = (pair.baseToken?.name || '').toLowerCase();
  const mint = (pair.baseToken?.address || '').toLowerCase();
  if (mint.length >= 32 && mint.includes(nq)) return true;
  if (nq.length < 2) return false;
  return sym.includes(nq) || name.includes(nq) || mint.includes(nq);
}

/** Search Solana tokens on DexScreener / pump.fun by symbol, name, or mint. */
async function searchTokens(query, limit = 25, fetchImpl = fetch) {
  const raw = String(query || '').trim();
  if (raw.length < 2) return [];

  const r = await fetchImpl(`${DEX_SEARCH}${encodeURIComponent(raw)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`DexScreener HTTP ${r.status}`);

  const data = await r.json();
  const byMint = new Map();

  for (const pair of (data.pairs || []).filter(isSolanaPair)) {
    if (!pairMatchesQuery(pair, raw)) continue;
    const mint = pair.baseToken?.address;
    if (!mint) continue;
    const cur = byMint.get(mint);
    if (!cur || comparePairs(cur, pair) > 0) byMint.set(mint, pair);
  }

  const out = [];
  for (const pair of byMint.values()) {
    out.push(mapPair(pair, pair.baseToken?.symbol || raw));
    if (out.length >= limit) break;
  }

  out.sort((a, b) => (b.vol24h || 0) - (a.vol24h || 0));
  return out.slice(0, limit);
}

/** Find best Solana pair for ticker via DexScreener (also covers pump.fun pools). */
async function lookupTicker(ticker, fetchImpl = fetch) {
  const sym = normalizeSymbol(ticker);
  if (!sym) return { found: false, ticker: sym };

  const r = await fetchImpl(`${DEX_SEARCH}${encodeURIComponent(sym)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`DexScreener HTTP ${r.status}`);

  const data = await r.json();
  const best = pickBestPair(data.pairs || [], { ticker: sym });

  if (!best) return { found: false, ticker: sym };
  const mapped = mapPair(best, sym);
  if (mapped.liquidity <= 0) return { found: false, ticker: sym };
  return mapped;
}

/** Resolve mint to its best SOL/volume DexScreener pair. */
async function lookupMint(mint, fetchImpl = fetch) {
  const addr = String(mint || '').trim();
  if (!addr) return { found: false, mint: addr };

  const r = await fetchImpl(`${DEX_TOKENS}${encodeURIComponent(addr)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`DexScreener HTTP ${r.status}`);

  const data = await r.json();
  const best = pickBestPair(data.pairs || [], { mint: addr });
  if (!best) return { found: false, mint: addr };
  const mapped = mapPair(best, best.baseToken?.symbol || addr);
  if (mapped.liquidity <= 0) return { found: false, mint: addr };
  return mapped;
}

module.exports = {
  lookupTicker,
  lookupMint,
  searchTokens,
  normalizeSymbol,
  isPumpFunPair,
  isSolQuotePair,
  comparePairs,
  pickBestPair,
  mapPair,
  pairMatchesQuery,
};
