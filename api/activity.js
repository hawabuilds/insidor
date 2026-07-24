/** Birdeye trades + top traders in one request (single cold start, parallel upstream). */
const cache = require('./_lib/cache');
const { cors, okJson } = require('./_lib/http');

const TTL_MS = 20000;

function mapTrades(items, mint) {
  return (items || []).map((t) => {
    const from = t.from || {};
    const to = t.to || {};
    const tokenIsTo = (to.address || '').toLowerCase() === mint.toLowerCase();
    const side = tokenIsTo ? 'buy' : 'sell';
    const tokenLeg = tokenIsTo ? to : from;
    const solLeg = tokenIsTo ? from : to;
    return {
      side,
      ts: (t.blockUnixTime || 0) * 1000,
      wallet: t.owner || '',
      tokenAmount: Number(tokenLeg.uiAmount ?? tokenLeg.amount ?? 0),
      solAmount: Number(solLeg.uiAmount ?? 0),
      usd: Number(t.volumeUSD ?? t.volume_usd ?? 0),
      price: Number(t.priceUsd ?? t.price ?? 0),
      tx: t.txHash || '',
    };
  }).filter((t) => t.ts);
}

function mapTraders(items) {
  return (items || []).map((t, i) => {
    const wallet = t.owner || t.address || '';
    return {
      rank: i + 1,
      wallet,
      short: wallet ? wallet.slice(0, 4) + '…' + wallet.slice(-4) : '—',
      pnl: Number(t.total_pnl ?? t.pnl ?? 0),
      realized: Number(t.realized_pnl ?? 0),
      unrealized: Number(t.unrealized_pnl ?? 0),
      volume: Number(t.volume_usd ?? t.volume ?? 0),
      trades: Number(t.trade_count ?? t.trades ?? 0),
    };
  });
}

async function birdeye(url, key) {
  const r = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-chain': 'solana',
      'X-API-KEY': key,
    },
  });
  if (!r.ok) throw new Error('birdeye HTTP ' + r.status);
  return r.json();
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const mint = String(req.query?.mint || '').trim();
  const limit = Math.min(Number(req.query?.limit) || 50, 50);
  if (!mint) return okJson(res, { trades: [], traders: [], error: 'Missing mint' });

  const key = process.env.BIRDEYE_API_KEY;
  if (!key) return okJson(res, { trades: [], traders: [], error: 'BIRDEYE_API_KEY not set' });

  const cacheKey = `activity:${mint}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit) return okJson(res, hit);

  const tradesUrl = 'https://public-api.birdeye.so/defi/txs/token'
    + `?address=${encodeURIComponent(mint)}&tx_type=swap&sort_type=desc&offset=0&limit=${limit}`;
  const tradersUrl = 'https://public-api.birdeye.so/defi/v2/tokens/top_traders'
    + `?address=${encodeURIComponent(mint)}&time_frame=24h&sort_by=total_pnl&sort_type=desc&offset=0&limit=10`;

  const [tradesRes, tradersRes] = await Promise.allSettled([
    birdeye(tradesUrl, key),
    birdeye(tradersUrl, key),
  ]);

  const errors = [];
  let trades = [];
  let traders = [];

  if (tradesRes.status === 'fulfilled') {
    const items = tradesRes.value?.data?.items || tradesRes.value?.data || [];
    trades = mapTrades(items, mint);
  } else {
    errors.push(String(tradesRes.reason?.message || tradesRes.reason));
  }

  if (tradersRes.status === 'fulfilled') {
    const items = tradersRes.value?.data?.items || tradersRes.value?.data || [];
    traders = mapTraders(items);
  } else {
    errors.push(String(tradersRes.reason?.message || tradersRes.reason));
  }

  const body = {
    trades,
    traders,
    source: 'birdeye',
    fetchedAt: Date.now(),
    error: errors.length ? errors.join('; ') : undefined,
  };
  cache.set(cacheKey, body, TTL_MS);
  return okJson(res, body);
};
