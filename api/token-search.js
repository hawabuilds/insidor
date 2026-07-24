/** DexScreener / pump.fun token search. GET ?q=ferry */
const cache = require('./_lib/cache');
const { cors, okJson } = require('./_lib/http');
const { searchTokens } = require('../lib/token-lookup');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = String(req.query?.q || '').trim();
  if (q.length < 2) return okJson(res, { tokens: [], query: q });

  const cacheKey = `token-search:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return okJson(res, cached);

  try {
    const tokens = await searchTokens(q, 25);
    const payload = { tokens, query: q, count: tokens.length };
    cache.set(cacheKey, payload, 90_000);
    return okJson(res, payload);
  } catch (e) {
    return okJson(res, { tokens: [], query: q, error: e.message });
  }
};
