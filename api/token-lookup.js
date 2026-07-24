/** DexScreener / pump.fun token lookup. GET ?ticker=JIMOTHY or ?mint=4mZq… */
const cache = require('./_lib/cache');
const { cors, okJson } = require('./_lib/http');
const { lookupTicker, lookupMint } = require('../lib/token-lookup');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const mint = String(req.query?.mint || '').trim();
  const ticker = String(req.query?.ticker || '').trim();

  if (!mint && !ticker) return okJson(res, { found: false, error: 'Missing ticker or mint' });

  const cacheKey = mint ? `token-lookup:mint:${mint}` : `token-lookup:${ticker.toUpperCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return okJson(res, cached);

  try {
    const result = mint ? await lookupMint(mint) : await lookupTicker(ticker);
    cache.set(cacheKey, result, 120_000);
    return okJson(res, result);
  } catch (e) {
    return okJson(res, {
      found: false,
      ticker: ticker ? ticker.toUpperCase() : undefined,
      mint: mint || undefined,
      error: e.message,
    });
  }
};
