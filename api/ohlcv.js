/** Birdeye OHLCV proxy — aggressive cache for free-tier CU limits. */
const cache = require('./_lib/cache');
const { cors, okJson } = require('./_lib/http');

const TF_SEC = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
  '1H': 3600, '1h': 3600, '2H': 7200, '4H': 14400, '6H': 21600,
  '8H': 28800, '12H': 43200, '1D': 86400, '1d': 86400,
};

const CACHE_MS = 900000; // 15 min — Birdeye CU conservation
const MAX_BARS = 120;

function normaliseTf(tf) {
  const t = String(tf || '1H').trim();
  if (t === '1h') return '1H';
  if (t === '1d') return '1D';
  return TF_SEC[t] ? t : '1H';
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const mint = String(req.query?.mint || '').trim();
  const tf = normaliseTf(req.query?.tf);
  if (!mint) return okJson(res, { candles: null, tf, error: 'Missing mint' });

  const key = process.env.BIRDEYE_API_KEY;
  if (!key) return okJson(res, { candles: null, tf });

  const cacheKey = `ohlcv:${mint}:${tf}`;
  const hit = cache.get(cacheKey);
  if (hit) return okJson(res, hit);

  const now = Math.floor(Date.now() / 1000);
  const step = TF_SEC[tf] || 3600;
  const time_to = now;
  const time_from = now - step * MAX_BARS;

  try {
    const qs = new URLSearchParams({
      address: mint,
      type: tf,
      currency: 'usd',
      time_from: String(time_from),
      time_to: String(time_to),
    });

    const upstream = await fetch(`https://public-api.birdeye.so/defi/v3/ohlcv?${qs}`, {
      headers: {
        'X-API-KEY': key,
        'x-chain': 'solana',
        accept: 'application/json',
      },
    });

    const raw = await upstream.json();
    if (!upstream.ok || !raw?.success) {
      return okJson(res, { candles: null, tf });
    }

    const items = raw.data?.items || raw.data?.candles || [];
    const candles = items.map(c => ({
      t: c.unixTime ?? c.unix_time ?? c.time,
      o: c.o, h: c.h, l: c.l, c: c.c,
      v: c.v ?? c.vUsd ?? c.v_usd,
    })).filter(c => c.t != null);

    const body = { mint, tf, candles, time_from, time_to };
    cache.set(cacheKey, body, CACHE_MS);
    return okJson(res, body);
  } catch {
    return okJson(res, { candles: null, tf });
  }
};
