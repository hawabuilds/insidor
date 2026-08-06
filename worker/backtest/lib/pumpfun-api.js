'use strict';

const PUMP_FRONTEND = 'https://frontend-api-v3.pump.fun';
const PUMP_FRONTEND_LEGACY = 'https://frontend-api.pump.fun';

function pumpHeaders() {
  const token = process.env.PUMP_FUN_BEARER_TOKEN || process.env.PUMP_FUN_JWT || '';
  return {
    Accept: 'application/json',
    Origin: 'https://pump.fun',
    Referer: 'https://pump.fun/',
    'User-Agent': 'Mozilla/5.0 (compatible; InsidorBacktest/1.0)',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function mapPumpCoin(raw) {
  if (!raw || !raw.mint) return null;
  const twitter = raw.twitter || raw.x || raw.socials?.twitter || null;
  return {
    mint: raw.mint,
    ticker: raw.symbol || raw.ticker || null,
    name: raw.name || null,
    description: raw.description || null,
    image_url: raw.image_uri || raw.image || raw.imageUrl || null,
    twitter_url: typeof twitter === 'string' ? twitter : twitter?.url || null,
    website_url: raw.website || raw.website_url || null,
    created_at: raw.created_timestamp
      ? new Date(Number(raw.created_timestamp)).toISOString()
      : (raw.created_at ? new Date(raw.created_at).toISOString() : null),
    graduated_at: raw.complete || raw.graduated
      ? (raw.graduated_timestamp
        ? new Date(Number(raw.graduated_timestamp)).toISOString()
        : (raw.graduated_at ? new Date(raw.graduated_at).toISOString() : null))
      : null,
    source: 'pump.fun',
  };
}

async function pumpFetch(path, query = {}) {
  const qs = new URLSearchParams(query);
  const urls = [
    `${PUMP_FRONTEND}${path}${qs.size ? `?${qs}` : ''}`,
    `${PUMP_FRONTEND_LEGACY}${path}${qs.size ? `?${qs}` : ''}`,
  ];
  let lastErr = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: pumpHeaders() });
      if (r.status === 403 || r.status === 401) {
        lastErr = new Error(`pump.fun blocked (${r.status})`);
        continue;
      }
      if (!r.ok) {
        lastErr = new Error(`pump.fun HTTP ${r.status}`);
        continue;
      }
      return r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('pump.fun unreachable');
}

async function fetchPumpCoin(mint) {
  const raw = await pumpFetch(`/coins/${encodeURIComponent(mint)}`);
  return mapPumpCoin(raw);
}

async function searchGraduatedPumpCoins({ cutoffMs, limit = 5000 } = {}) {
  const out = [];
  const pageSize = 50;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const batch = await pumpFetch('/coins/search', {
      offset: String(offset),
      limit: String(pageSize),
      sort: 'created_timestamp',
      order: 'DESC',
      includeNsfw: 'false',
      complete: 'true',
    });
    const rows = Array.isArray(batch) ? batch : (batch?.coins || batch?.results || []);
    if (!rows.length) break;
    let stop = false;
    for (const row of rows) {
      const mapped = mapPumpCoin(row);
      if (!mapped?.mint) continue;
      const gradMs = mapped.graduated_at ? Date.parse(mapped.graduated_at) : 0;
      const createdMs = mapped.created_at ? Date.parse(mapped.created_at) : 0;
      const ts = gradMs || createdMs;
      if (ts && ts < cutoffMs) {
        stop = true;
        break;
      }
      if (ts && ts >= cutoffMs) out.push(mapped);
    }
    if (stop) break;
  }
  return out;
}

module.exports = {
  fetchPumpCoin,
  searchGraduatedPumpCoins,
  mapPumpCoin,
};
