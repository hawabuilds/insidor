/** Birdeye recent swaps for a token. */
const cache = require('./_lib/cache');
const { cors, okJson } = require('./_lib/http');
const { getTradesForMint, TRADES_TTL_MS } = require('./_lib/birdeye-trades');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const mint = String(req.query?.mint || '').trim();
  const limit = Math.min(Number(req.query?.limit) || 50, 50);
  if (!mint) return okJson(res, { trades: [], error: 'Missing mint' });

  const key = process.env.BIRDEYE_API_KEY;
  if (!key) return okJson(res, { trades: [], error: 'BIRDEYE_API_KEY not set' });

  const cacheKey = `trades:${mint}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit) return okJson(res, hit);

  const result = await getTradesForMint(mint, limit, key);
  if (!result.ok) {
    return okJson(res, {
      trades: [],
      error: 'birdeye upstream failed',
      upstreamStatus: result.upstreamStatus,
      upstreamBody: result.upstreamBody,
    });
  }

  const body = {
    trades: result.trades,
    source: 'birdeye',
    fetchedAt: Date.now(),
  };
  cache.set(cacheKey, body, TRADES_TTL_MS);
  return okJson(res, body);
};
