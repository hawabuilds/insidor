/** Proxy Jupiter quote API — key stays server-side. */
const { cors, okJson } = require('./_lib/http');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { inputMint, outputMint, amount, slippageBps } = req.query || {};
  if (!inputMint || !outputMint || !amount) {
    return okJson(res, { error: 'Missing required params: inputMint, outputMint, amount' });
  }

  const key = process.env.JUPITER_API_KEY;
  if (!key) return okJson(res, { error: 'JUPITER_API_KEY not configured' });

  const params = new URLSearchParams({
    inputMint: String(inputMint),
    outputMint: String(outputMint),
    amount: String(amount),
  });
  if (slippageBps != null && slippageBps !== '') params.set('slippageBps', String(slippageBps));

  try {
    const upstream = await fetch(`https://api.jup.ag/swap/v1/quote?${params}`, {
      headers: { 'x-api-key': key },
    });
    const text = await upstream.text();

    if (!upstream.ok) {
      let err;
      try {
        const parsed = JSON.parse(text);
        err = parsed.error || parsed.message || text;
      } catch {
        err = text || `HTTP ${upstream.status}`;
      }
      return okJson(res, { error: typeof err === 'string' ? err : JSON.stringify(err) });
    }

    cors(res);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(text);
  } catch (e) {
    return okJson(res, { error: e.message || 'Upstream fetch failed' });
  }
};
