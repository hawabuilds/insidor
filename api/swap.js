/** Build Jupiter swap transaction for client-side Privy signing. */
const { cors, okJson } = require('./_lib/http');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return okJson(res, { error: 'POST only' });

  const { userPublicKey, quoteResponse, feeAccount } = req.body || {};
  if (!userPublicKey || !quoteResponse) {
    return okJson(res, { error: 'userPublicKey and quoteResponse required' });
  }

  const key = process.env.JUPITER_API_KEY;
  if (!key) return okJson(res, { error: 'JUPITER_API_KEY not set' });

  try {
    const body = {
      userPublicKey,
      quoteResponse,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { priorityLevel: 'veryHigh', maxLamports: 1000000 },
      },
    };
    if (feeAccount) body.feeAccount = feeAccount;

    const r = await fetch('https://api.jup.ag/swap/v1/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
      },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) return okJson(res, { error: j?.error || 'jupiter HTTP ' + r.status });

    return okJson(res, {
      swapTransaction: j.swapTransaction,
      lastValidBlockHeight: j.lastValidBlockHeight,
      prioritizationFeeLamports: j.prioritizationFeeLamports,
    });
  } catch (e) {
    return okJson(res, { error: String(e.message) });
  }
};
