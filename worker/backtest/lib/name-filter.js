'use strict';

const { isGenericTicker, normalizeTicker } = require('../../score/lib/nameability');

const GENERIC_NAME_WORDS = new Set([
  'coin', 'token', 'meme', 'memecoin', 'crypto', 'solana', 'sol', 'pump', 'fun', 'official',
  'new', 'the', 'a', 'an', 'and', 'or', 'of', 'on', 'in', 'to', 'for', 'with', 'by', 'from',
  'just', 'launched', 'live', 'real', 'true', 'best', 'top', 'hot', 'viral', 'trend', 'trending',
  'moon', 'lfg', 'degen', 'based', 'goat', 'cat', 'dog', 'ai', 'agent', 'bot', 'test', 'v2', 'v3',
]);

const SPAM_NAME_PATTERNS = [
  /^test/i,
  /^xxx/i,
  /^aaa/i,
  /^111/,
  /^000/,
  /pepe\d{3,}/i,
  /^\d+$/,
  /^[^a-zA-Z0-9]+$/,
];

function tokenizeName(name) {
  return String(name || '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
}

function hasIdentifiableSubject(name, ticker) {
  const words = tokenizeName(name);
  if (words.length >= 1) return true;
  const t = normalizeTicker(ticker);
  if (t && t.length >= 4 && !isGenericTicker(t)) return true;
  return false;
}

/**
 * Pass 1 — name plausibility. Reject generic/spam tickers and names with no identifiable subject.
 */
function evaluateNamePlausibility({ ticker, name }) {
  const sym = normalizeTicker(ticker);
  const rawName = String(name || '').trim();
  const lowerName = rawName.toLowerCase();

  if (!sym && !rawName) {
    return { pass: false, reason: 'missing ticker and name' };
  }
  if (sym && isGenericTicker(sym)) {
    return { pass: false, reason: `generic ticker $${sym}` };
  }
  if (sym && sym.length < 2) {
    return { pass: false, reason: 'ticker too short' };
  }
  for (const re of SPAM_NAME_PATTERNS) {
    if (rawName && re.test(rawName)) return { pass: false, reason: `spam name pattern (${rawName})` };
    if (sym && re.test(sym)) return { pass: false, reason: `spam ticker pattern ($${sym})` };
  }
  if (rawName && rawName.length <= 2) {
    return { pass: false, reason: 'name too short' };
  }
  if (!hasIdentifiableSubject(rawName, sym)) {
    return { pass: false, reason: 'no identifiable subject in name/ticker' };
  }
  if (lowerName === sym?.toLowerCase() && isGenericTicker(sym)) {
    return { pass: false, reason: 'name equals generic ticker' };
  }
  return { pass: true, reason: null };
}

function distinctiveWords(name, ticker) {
  const words = tokenizeName(name);
  const sym = normalizeTicker(ticker);
  if (sym && !isGenericTicker(sym) && sym.length >= 4) words.unshift(sym.toLowerCase());
  return [...new Set(words)].slice(0, 5);
}

module.exports = {
  evaluateNamePlausibility,
  distinctiveWords,
  tokenizeName,
};
