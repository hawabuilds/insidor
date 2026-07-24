/** Helius getTokenAccounts → holder count, top distribution, top10Pct. */

const cache = require('./_lib/cache');

const { cors, okJson } = require('./_lib/http');



module.exports = async function handler(req, res) {

  cors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });



  const mint = String(req.query?.mint || '').trim();

  if (!mint) return okJson(res, { holders: null, top: [], error: 'Missing mint' });



  const key = process.env.HELIUS_API_KEY;

  if (!key) return okJson(res, { holders: null, top: [], error: 'HELIUS_API_KEY not set' });



  const cacheKey = `holders:${mint}`;

  const hit = cache.get(cacheKey);

  if (hit) return okJson(res, hit);



  const RPC = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;



  try {

    let page = 1;

    let accounts = [];

    while (page <= 5) {

      const r = await fetch(RPC, {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({

          jsonrpc: '2.0',

          id: 'holders',

          method: 'getTokenAccounts',

          params: { mint, limit: 1000, page, options: { showZeroBalance: false } },

        }),

      });

      if (!r.ok) throw new Error('helius HTTP ' + r.status);

      const j = await r.json();

      const batch = j?.result?.token_accounts || [];

      accounts = accounts.concat(batch);

      if (batch.length < 1000) break;

      page++;

    }



    const byOwner = new Map();

    let total = 0n;

    for (const a of accounts) {

      const amt = BigInt(a.amount || 0);

      if (amt === 0n) continue;

      total += amt;

      byOwner.set(a.owner, (byOwner.get(a.owner) || 0n) + amt);

    }



    const sorted = [...byOwner.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1));

    const pct = (v) => (total > 0n ? Number((v * 10000n) / total) / 100 : 0);



    const top = sorted.slice(0, 20).map(([owner, amt], i) => ({

      rank: i + 1,

      wallet: owner,

      short: owner.slice(0, 4) + '…' + owner.slice(-4),

      pct: pct(amt),

    }));



    const top10Pct = sorted.slice(0, 10).reduce((s, [, v]) => s + pct(v), 0);



    const body = {

      holders: byOwner.size,

      top,

      top10Pct: Number(top10Pct.toFixed(2)),

      truncated: page > 5,

      source: 'helius',

      fetchedAt: Date.now(),

    };

    cache.set(cacheKey, body);

    return okJson(res, body);

  } catch (e) {

    return okJson(res, { holders: null, top: [], error: String(e.message) });

  }

};

