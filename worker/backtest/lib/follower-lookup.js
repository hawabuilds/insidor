'use strict';

const UA = 'Mozilla/5.0 (compatible; InsidorBacktest/1.0)';

const NITTER_INSTANCES = [
  'https://nitter.poast.org',
  'https://nitter.privacydev.net',
  'https://nitter.net',
  'https://nitter.cz',
  'https://nitter.tiekoetter.com',
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeHandle(handle) {
  return String(handle || '').replace(/^@/, '').trim();
}

function parseFollowerCount(raw) {
  const s = String(raw || '').trim().replace(/,/g, '');
  if (!s) return null;
  const m = s.match(/^([\d.]+)([KMB])?$/i);
  if (!m) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'K') n *= 1_000;
  if (suffix === 'M') n *= 1_000_000;
  if (suffix === 'B') n *= 1_000_000_000;
  return Math.round(n);
}

async function scrapeXProfile(handle) {
  for (const base of [`https://x.com/${handle}`, `https://twitter.com/${handle}`]) {
    try {
      const r = await fetch(base, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow',
      });
      if (!r.ok) continue;
      const html = await r.text();
      const patterns = [
        /followers:(\d+),following:/,
        /"followers_count":(\d+)/,
        /followers_count\\":(\d+)/,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) {
          const n = parseFollowerCount(m[1]);
          if (n != null) return { followers: n, method: 'x_profile', error: '' };
        }
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

async function scrapeNitter(handle) {
  for (const base of NITTER_INSTANCES) {
    try {
      const r = await fetch(`${base}/${encodeURIComponent(handle)}`, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) continue;
      const html = await r.text();
      const patterns = [
        /profile-stat-num[^>]*>([\d,]+)<\/span>\s*<span class="profile-stat-header">Followers/i,
        /followers[^0-9]*([\d,]+)/i,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) {
          const n = parseFollowerCount(m[1]);
          if (n != null) return { followers: n, method: 'nitter', error: '' };
        }
      }
    } catch (_) { /* try next instance */ }
  }
  return null;
}

async function lookupFollowers(handle, { getUserByUsername, delayMs = 350 } = {}) {
  const h = normalizeHandle(handle);
  if (!h) return { followers: '', method: 'failed', error: 'empty handle' };

  await sleep(delayMs);
  const profile = await scrapeXProfile(h);
  if (profile) return profile;

  await sleep(delayMs);
  const nitter = await scrapeNitter(h);
  if (nitter) return nitter;

  if (!getUserByUsername) {
    return { followers: '', method: 'failed', error: 'profile and nitter failed; no X_OFFICIAL_BEARER_TOKEN' };
  }

  try {
    const user = await getUserByUsername(h, { stage: 'follower_lookup' });
    if (user.followers != null) {
      return { followers: String(user.followers), method: 'x_official', error: '' };
    }
    return { followers: '', method: 'failed', error: 'official API returned no followers_count' };
  } catch (err) {
    return { followers: '', method: 'failed', error: err.message || String(err) };
  }
}

module.exports = {
  normalizeHandle,
  lookupFollowers,
  parseFollowerCount,
};
