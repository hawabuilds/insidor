/** Helius wallet SOL + optional SPL token balance. */
const { cors, okJson } = require('./_lib/http');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const owner = String(req.query?.owner || '').trim();
  const mint = req.query?.mint ? String(req.query.mint).trim() : null;
  if (!owner) return okJson(res, { sol: null, token: null, error: 'Missing owner' });

  const key = process.env.HELIUS_API_KEY;
  if (!key) return okJson(res, { sol: null, token: null, error: 'HELIUS_API_KEY not set' });

  const RPC = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;

  const call = async (method, params) => {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
    });
    if (!r.ok) throw new Error(method + ' HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || method + ' RPC error');
    return j.result;
  };

  try {
    const solRes = await call('getBalance', [owner]);
    const sol = (solRes?.value ?? 0) / 1e9;

    let token = null;
    if (mint) {
      const t = await call('getTokenAccountsByOwner', [
        owner, { mint }, { encoding: 'jsonParsed' },
      ]);
      token = (t?.value || []).reduce(
        (s, acc) => s + (acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0
      );
    }

    return okJson(res, { sol, token, owner, mint, fetchedAt: Date.now() });
  } catch (e) {
    return okJson(res, { sol: null, token: null, error: String(e.message) });
  }
};
