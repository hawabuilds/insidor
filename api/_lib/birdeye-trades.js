/** Shared Birdeye /defi/txs/token fetch + trade mapping + derived top traders. */
const cache = require('./cache');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TRADES_TTL_MS = 20000;
const PERIOD_24H_MS = 24 * 3600 * 1000;

function isSol(leg) {
  if (!leg) return false;
  const addr = (leg.address || '').toLowerCase();
  return addr === SOL_MINT.toLowerCase() || (leg.symbol || '').toUpperCase() === 'SOL';
}

function legAmt(leg) {
  if (!leg) return 0;
  const ui = leg.uiAmount ?? leg.ui_amount;
  if (ui != null) return Math.abs(Number(ui));
  if (leg.amount != null) return Math.abs(Number(leg.amount));
  return 0;
}

function legUsd(leg) {
  const amt = legAmt(leg);
  const px = Number(leg?.price ?? leg?.nearestPrice ?? leg?.nearest_price ?? 0);
  return amt > 0 && px > 0 ? amt * px : 0;
}

function mapTrade(t, mint) {
  const mintLower = mint.toLowerCase();
  const from = t.from || {};
  const to = t.to || {};

  const fromIsToken = (from.address || '').toLowerCase() === mintLower;
  const toIsToken = (to.address || '').toLowerCase() === mintLower;
  if (!fromIsToken && !toIsToken) return null;

  const tokenLeg = toIsToken ? to : from;
  const quoteLeg = toIsToken ? from : to;
  const side = toIsToken ? 'buy' : 'sell';

  const solLeg = isSol(quoteLeg) ? quoteLeg : (isSol(from) ? from : isSol(to) ? to : null);
  const solLegUsd = solLeg ? legUsd(solLeg) : 0;
  const tokenLegUsd = legUsd(tokenLeg);
  const usd = solLegUsd || tokenLegUsd || Number(t.volumeUSD ?? t.volume_usd ?? 0);

  const tokenAmount = legAmt(tokenLeg);
  const solAmount = solLeg ? legAmt(solLeg) : (isSol(quoteLeg) ? legAmt(quoteLeg) : 0);

  return {
    side,
    ts: (t.blockUnixTime || t.block_unix_time || 0) * 1000,
    wallet: t.owner || '',
    tokenAmount,
    solAmount,
    usd,
    price: tokenAmount > 0 && usd > 0 ? usd / tokenAmount : Number(t.priceUsd ?? t.price ?? 0),
    tx: t.txHash || t.tx_hash || '',
  };
}

function mapTrades(items, mint) {
  return (items || [])
    .map((t) => mapTrade(t, mint))
    .filter((t) => t && t.ts);
}

async function fetchTokenSwapItems(mint, limit, apiKey, { timeoutMs = 8000, minAgeMs = null } = {}) {
  const want = Math.min(Math.max(limit, 1), 400);
  const pageSize = 50;
  const items = [];
  let offset = 0;
  let upstreamStatus = 200;
  let upstreamBody = null;

  while (items.length < want) {
    const pageLimit = Math.min(pageSize, want - items.length);
    const url = 'https://public-api.birdeye.so/defi/txs/token'
      + `?address=${encodeURIComponent(mint)}&tx_type=swap`
      + `&sort_type=desc&offset=${offset}&limit=${pageLimit}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        signal: ac.signal,
        headers: {
          accept: 'application/json',
          'x-chain': 'solana',
          'X-API-KEY': apiKey,
        },
      });
      const text = await r.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      upstreamStatus = r.status;
      upstreamBody = body;
      if (!r.ok) {
        if (items.length) break;
        return { ok: false, upstreamStatus: r.status, upstreamBody: body, items: [] };
      }
      const page = body?.data?.items || body?.data || [];
      if (!page.length) break;
      items.push(...page);
      if (page.length < pageLimit) break;
      offset += page.length;

      if (minAgeMs != null) {
        const mapped = mapTrades(page, mint);
        const oldest = mapped[mapped.length - 1];
        if (oldest && oldest.ts <= minAgeMs) break;
      }
    } catch (e) {
      if (items.length) break;
      return {
        ok: false,
        upstreamStatus: e.name === 'AbortError' ? 408 : 0,
        upstreamBody: String(e.message),
        items: [],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: true, upstreamStatus, upstreamBody, items };
}

/** Cached mapped trades for a mint (shared by /api/trades and top-traders fallback). */
async function getTradesForMint(mint, limit, apiKey) {
  const cacheKey = `swaps:${mint}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit) return { trades: hit.trades, tradeCount: hit.tradeCount, cached: true };

  const upstream = await fetchTokenSwapItems(mint, limit, apiKey);
  if (!upstream.ok) return { ...upstream, trades: [], tradeCount: 0 };

  const trades = mapTrades(upstream.items, mint);
  const body = { trades, tradeCount: trades.length, fetchedAt: Date.now() };
  cache.set(cacheKey, body, TRADES_TTL_MS);
  return { ok: true, trades, tradeCount: trades.length, cached: false };
}

async function getTradesForPeriod(mint, apiKey, { periodMs = PERIOD_24H_MS, maxItems = 400 } = {}) {
  const cacheKey = `swaps:${mint}:24h:${maxItems}`;
  const hit = cache.get(cacheKey);
  if (hit) return { ok: true, trades: hit.trades, tradeCount: hit.tradeCount, cached: true };

  const cutoff = Date.now() - periodMs;
  const upstream = await fetchTokenSwapItems(mint, maxItems, apiKey, { minAgeMs: cutoff });
  if (!upstream.ok) return { ...upstream, trades: [], tradeCount: 0 };

  const trades = mapTrades(upstream.items, mint).filter((t) => t.ts >= cutoff);
  const body = { trades, tradeCount: trades.length, fetchedAt: Date.now() };
  cache.set(cacheKey, body, TRADES_TTL_MS);
  return { ok: true, trades, tradeCount: trades.length, cached: false };
}

/** Weighted-average cost basis — same method as DexScreener / Moralis realised PnL. */
function computeWalletStats(sortedTrades, currentPrice) {
  let tokensHeld = 0;
  let costBasisUsd = 0;
  let realizedPnl = 0;
  let buyUsd = 0;
  let sellUsd = 0;
  let buyTokens = 0;
  let sellTokens = 0;
  let buys = 0;
  let sells = 0;

  for (const t of sortedTrades) {
    if (t.side === 'buy') {
      tokensHeld += t.tokenAmount;
      costBasisUsd += t.usd;
      buyUsd += t.usd;
      buyTokens += t.tokenAmount;
      buys += 1;
    } else {
      sells += 1;
      sellUsd += t.usd;
      sellTokens += t.tokenAmount;
      const sellAmt = t.tokenAmount;
      if (sellAmt <= 0) continue;
      if (tokensHeld <= 0) {
        realizedPnl += t.usd;
        continue;
      }
      const fromInventory = Math.min(sellAmt, tokensHeld);
      const avgCost = costBasisUsd / tokensHeld;
      const costOfSold = avgCost * fromInventory;
      const proceeds = t.usd * (fromInventory / sellAmt);
      realizedPnl += proceeds - costOfSold;
      tokensHeld -= fromInventory;
      costBasisUsd -= costOfSold;
      const excess = sellAmt - fromInventory;
      if (excess > 0) realizedPnl += t.usd * (excess / sellAmt);
    }
  }

  const balance = tokensHeld;
  let unrealized = null;
  if (currentPrice != null && balance > 0) {
    unrealized = balance * currentPrice - costBasisUsd;
  }

  return {
    pnl: realizedPnl,
    realized: realizedPnl,
    unrealized,
    buyUsd,
    sellUsd,
    buyTokens,
    sellTokens,
    buys,
    sells,
    balance,
    volume: buyUsd + sellUsd,
    trades: buys + sells,
  };
}

function deriveTopTraders(trades, limit = 10, { periodMs = PERIOD_24H_MS } = {}) {
  const cutoff = Date.now() - periodMs;
  const inWindow = trades.filter((t) => t.ts >= cutoff);
  const pool = inWindow.length ? inWindow : trades;
  const currentPrice = pool.reduce((best, t) => (t.ts > (best?.ts || 0) ? t : best), null)?.price ?? null;

  const byWallet = new Map();
  for (const t of pool) {
    if (!t.wallet) continue;
    if (!byWallet.has(t.wallet)) byWallet.set(t.wallet, []);
    byWallet.get(t.wallet).push(t);
  }

  const ranked = [];
  const accumulating = [];

  for (const [wallet, wTrades] of byWallet) {
    const stats = computeWalletStats(wTrades.sort((a, b) => a.ts - b.ts), currentPrice);
    const row = {
      wallet,
      short: wallet.slice(0, 4) + '…' + wallet.slice(-4),
      ...stats,
    };
    if (stats.sells <= 0 && stats.buys > 0) {
      accumulating.push({ ...row, status: 'accumulating' });
    } else if (stats.sells > 0) {
      ranked.push(row);
    }
  }

  ranked.sort((a, b) => b.pnl - a.pnl);
  accumulating.sort((a, b) => b.buyUsd - a.buyUsd);

  const traders = ranked.slice(0, limit).map((t, i) => ({ ...t, rank: i + 1 }));
  const windowLabel = inWindow.length ? '24h' : `last ${pool.length} swaps`;

  return {
    traders,
    accumulating: accumulating.slice(0, 5),
    source: 'derived',
    label: `Top traders · ${windowLabel}`,
    caption: 'Ranked by realised PnL — cost-basis on sells, unrealised on open balance',
    window: pool.length,
    period: windowLabel,
    fetchedAt: Date.now(),
    stale: false,
  };
}

module.exports = {
  mapTrade,
  mapTrades,
  fetchTokenSwapItems,
  getTradesForMint,
  getTradesForPeriod,
  computeWalletStats,
  deriveTopTraders,
  TRADES_TTL_MS,
  PERIOD_24H_MS,
};
