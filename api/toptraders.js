/** Top traders — DexScreener-style: Birdeye 24h PnL primary, swap-derived fallback. */
const cache = require('./_lib/cache');
const { cors, okJson } = require('./_lib/http');
const { getTradesForPeriod, deriveTopTraders, PERIOD_24H_MS } = require('./_lib/birdeye-trades');

const TTL_MS = 120000;
const STALE_MS = 900000;
const FETCH_TIMEOUT_MS = 8000;
const BIRDEYE_SAMPLE_LOGGED = new Set();

function pickNum(obj, keys) {
  for (const k of keys) {
    if (obj != null && obj[k] != null && Number.isFinite(Number(obj[k]))) return Number(obj[k]);
  }
  return null;
}

function mapBirdeyeTrader(t) {
  const wallet = t.owner || t.address || '';
  if (!wallet) return null;

  const realized = pickNum(t, ['realizedPnl', 'realized_pnl']);
  const unrealized = pickNum(t, ['unrealizedPnl', 'unrealized_pnl']);
  const buyUsd = pickNum(t, ['volumeBuyUSD', 'volume_buy_usd']);
  const sellUsd = pickNum(t, ['volumeSellUSD', 'volume_sell_usd']);
  const buys = pickNum(t, ['tradeBuy', 'trade_buy']);
  const sells = pickNum(t, ['tradeSell', 'trade_sell']);
  const buyTokens = pickNum(t, ['volumeBuy', 'volume_buy']);
  const sellTokens = pickNum(t, ['volumeSell', 'volume_sell']);
  const balance = pickNum(t, ['holdVolume', 'hold_volume']);
  const volume = pickNum(t, ['volumeUsd', 'volume_usd']);

  if (realized == null && unrealized == null && buyUsd == null && sellUsd == null) {
    return null;
  }

  const row = {
    wallet,
    short: wallet.slice(0, 4) + '…' + wallet.slice(-4),
    buyUsd,
    sellUsd,
    buyTokens,
    sellTokens,
    buys,
    sells,
    balance,
    volume,
    trades: (buys || 0) + (sells || 0),
  };
  if (realized != null) {
    row.pnl = realized;
    row.realized = realized;
  }
  if (unrealized != null) row.unrealized = unrealized;
  return row;
}

async function fetchBirdeyeTopTraders(mint, limit, apiKey) {
  const url = 'https://public-api.birdeye.so/defi/v2/tokens/top_traders'
    + `?address=${encodeURIComponent(mint)}&time_frame=24h`
    + `&sort_by=realized_pnl&sort_type=desc&offset=0&limit=${limit}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

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
    let upstreamBody;
    try {
      upstreamBody = JSON.parse(text);
    } catch {
      upstreamBody = text;
    }

    if (!r.ok) {
      return {
        ok: false,
        upstreamStatus: r.status,
        upstreamBody,
        planBlocked: r.status === 401 || r.status === 403,
      };
    }

    const items = upstreamBody?.data?.items || upstreamBody?.data || [];
    const sampleKey = mint;
    if (items[0] && !BIRDEYE_SAMPLE_LOGGED.has(sampleKey)) {
      BIRDEYE_SAMPLE_LOGGED.add(sampleKey);
      console.log('[toptraders] birdeye raw sample:', JSON.stringify(items[0]));
    }

    const mapped = items.map(mapBirdeyeTrader).filter(Boolean);
    const withSells = mapped.filter((t) => (t.sells || 0) > 0 && t.pnl != null);
    const accumulating = mapped
      .filter((t) => (t.sells || 0) <= 0 && (t.buys || 0) > 0)
      .slice(0, 5);

    const traders = withSells
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, limit)
      .map((t, i) => ({ ...t, rank: i + 1 }));

    if (!traders.length && !mapped.some((t) => t.pnl != null)) {
      return {
        ok: false,
        upstreamStatus: r.status,
        upstreamBody: { note: 'birdeye returned no PnL fields', sample: items[0] || null },
      };
    }

    return {
      ok: true,
      traders,
      accumulating,
      source: 'birdeye',
      label: 'Top traders · 24h',
      caption: 'Ranked by realised PnL — same window as DexScreener',
      period: '24h',
      fetchedAt: Date.now(),
      stale: false,
    };
  } catch (e) {
    return {
      ok: false,
      upstreamStatus: e.name === 'AbortError' ? 408 : 0,
      upstreamBody: String(e.message),
      planBlocked: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDerivedTopTraders(mint, limit, apiKey) {
  const result = await getTradesForPeriod(mint, apiKey, { periodMs: PERIOD_24H_MS, maxItems: 400 });
  if (!result.ok) {
    return {
      ok: false,
      upstreamStatus: result.upstreamStatus,
      upstreamBody: result.upstreamBody,
      traders: [],
    };
  }
  const body = deriveTopTraders(result.trades, limit, { periodMs: PERIOD_24H_MS });
  return { ok: true, body };
}

async function buildTopTradersResponse(mint, limit, apiKey) {
  const birdeye = await fetchBirdeyeTopTraders(mint, limit, apiKey);
  if (birdeye.ok && birdeye.traders?.length) {
    return birdeye;
  }

  const derived = await fetchDerivedTopTraders(mint, limit, apiKey);
  if (derived.ok) {
    return {
      ...derived.body,
      fallback: true,
      birdeyeFailed: !birdeye.ok,
      upstreamStatus: birdeye.upstreamStatus,
      upstreamBody: birdeye.upstreamBody,
    };
  }

  return {
    traders: [],
    accumulating: [],
    fetchedAt: Date.now(),
    stale: false,
    error: 'top traders unavailable',
    birdeyeFailed: true,
    upstreamStatus: birdeye.upstreamStatus || derived.upstreamStatus,
    upstreamBody: birdeye.upstreamBody || derived.upstreamBody,
  };
}

async function refreshCache(cacheKey, mint, limit, apiKey) {
  try {
    const body = await buildTopTradersResponse(mint, limit, apiKey);
    cache.setSwr(cacheKey, body, { staleMs: STALE_MS });
  } catch {
    /* keep existing stale entry */
  }
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const mint = String(req.query?.mint || '').trim();
  const limit = Math.min(Number(req.query?.limit) || 10, 10);
  if (!mint) return okJson(res, { traders: [], error: 'Missing mint' });

  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) return okJson(res, { traders: [], error: 'BIRDEYE_API_KEY not set' });

  const cacheKey = `toptraders:${mint}:${limit}`;
  const hit = cache.swr(cacheKey, { ttlMs: TTL_MS, staleMs: STALE_MS });

  if (hit.hit && hit.fresh) {
    return okJson(res, { ...hit.value, stale: false });
  }

  if (hit.hit && hit.stale) {
    cache.refreshBackground(cacheKey, () => refreshCache(cacheKey, mint, limit, apiKey));
    return okJson(res, { ...hit.value, stale: true });
  }

  const body = await buildTopTradersResponse(mint, limit, apiKey);
  if (body.traders?.length || body.accumulating?.length) {
    cache.setSwr(cacheKey, body, { staleMs: STALE_MS });
  }
  return okJson(res, body);
};
