'use strict';

const GENERIC_TICKERS = new Set([
  'MEME', 'VIRAL', 'THIS', 'NEWS', 'COIN', 'TOKEN', 'CRYPTO', 'SOLANA', 'SOL',
  'MOON', 'PUMP', 'LFG', 'CT', 'FYP', 'TREND', 'TRENDING', 'STORY', 'VIDEO',
  'TIKTOK', 'POST', 'LATEST', 'BREAKING', 'UPDATE', 'LIVE', 'NEW', 'HOT',
  'FUNNY', 'REAL', 'TRUE', 'FACT', 'GOAT', 'BASED', 'DEGEN', 'ALERT', 'JUST',
  'WATCH', 'OMG', 'WTF', 'LOL', 'NAH', 'BRO', 'GUYS', 'HERE', 'THE', 'AND',
]);

const NAMEABILITY_CAP = 0.3;

function normalizeTicker(ticker) {
  if (ticker == null) return null;
  const t = String(ticker).replace(/^\$/, '').trim().toUpperCase();
  if (!/^[A-Z]{2,10}$/.test(t)) return null;
  return t;
}

function isGenericTicker(ticker) {
  const t = normalizeTicker(ticker);
  if (!t) return true;
  return GENERIC_TICKERS.has(t);
}

/** Ticker looks like a sentence fragment (too many vowels / common words). */
function isSentenceDerivedTicker(ticker, postText) {
  const t = normalizeTicker(ticker);
  if (!t || t.length <= 3) return false;
  const text = (postText || '').toLowerCase();
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  const asPhrase = t.toLowerCase();
  if (words.join('').includes(asPhrase)) return false;
  const common = ['someone', 'should', 'would', 'could', 'about', 'think', 'needs'];
  return common.some(w => asPhrase.includes(w));
}

/**
 * Cap meme_score when ticker is not nameable as a one-word subject.
 * Returns updated result object.
 */
function applyNameabilityCap(result, postText) {
  if (!result || typeof result !== 'object') return result;
  const ticker = normalizeTicker(result.suggested_ticker);
  const unnameable = !ticker || isGenericTicker(ticker) || isSentenceDerivedTicker(ticker, postText);
  if (!unnameable) return result;

  const capped = Math.min(Number(result.meme_score) || 0, NAMEABILITY_CAP);
  const reason = result.reason
    ? `${result.reason} [nameability cap: ${ticker || 'no ticker'}]`
    : `nameability cap: ${ticker || 'no one-word subject ticker'}`;

  return {
    ...result,
    meme_score: capped,
    reason: reason.slice(0, 500),
    nameability_capped: true,
  };
}

module.exports = {
  GENERIC_TICKERS,
  NAMEABILITY_CAP,
  normalizeTicker,
  isGenericTicker,
  isSentenceDerivedTicker,
  applyNameabilityCap,
};
