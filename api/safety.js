/** RugCheck summary → normalised safety fields for TOKENS. */
const cache = require('./_lib/cache');
const { cors, okJson } = require('./_lib/http');

const NULL_SAFETY = {
  mintRevoked: null,
  freezeRevoked: null,
  lpBurned: null,
  top10: null,
  riskLabel: null,
  risks: [],
};

function normalise(raw) {
  if (!raw || typeof raw !== 'object') return { ...NULL_SAFETY };

  const mintAuthority = raw.mintAuthority ?? raw.token?.mintAuthority ?? null;
  const freezeAuthority = raw.freezeAuthority ?? raw.token?.freezeAuthority ?? null;
  const lpLocked = raw.lpLocked === true || (raw.lpLockedPct != null && raw.lpLockedPct >= 95);
  const top10 = raw.topHoldersPct ?? raw.top10 ?? null;

  return {
    mintRevoked: mintAuthority == null ? true : false,
    freezeRevoked: freezeAuthority == null ? true : false,
    lpBurned: raw.lpLocked != null || raw.lpLockedPct != null ? lpLocked : null,
    top10: top10 != null && Number.isFinite(Number(top10)) ? Number(top10) : null,
    riskLabel: raw.riskLevel ?? raw.riskLabel ?? null,
    risks: Array.isArray(raw.risks) ? raw.risks : [],
  };
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const mint = String(req.query?.mint || '').trim();
  if (!mint) return okJson(res, { ...NULL_SAFETY, error: 'Missing mint' });

  const cacheKey = `safety:${mint}`;
  const hit = cache.get(cacheKey);
  if (hit) return okJson(res, hit);

  try {
    const upstream = await fetch(
      `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`,
      { headers: { accept: 'application/json' } }
    );
    const text = await upstream.text();
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return okJson(res, { ...NULL_SAFETY });
    }

    if (!upstream.ok) return okJson(res, { ...NULL_SAFETY });

    const body = normalise(raw);
    cache.set(cacheKey, body);
    return okJson(res, body);
  } catch {
    return okJson(res, { ...NULL_SAFETY });
  }
};
