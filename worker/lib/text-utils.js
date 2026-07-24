'use strict';

const STOP = new Set([
  'that', 'this', 'with', 'from', 'have', 'just', 'your', 'what', 'when', 'them',
  'then', 'than', 'they', 'will', 'would', 'could', 'should', 'about', 'into',
  'after', 'before', 'there', 'their', 'been', 'being', 'were', 'where', 'which',
  'while', 'only', 'also', 'very', 'some', 'more', 'most', 'much', 'like', 'know',
  'dont', 'does', 'did', 'not', 'but', 'and', 'the', 'for', 'you', 'are', 'was',
  'has', 'had', 'can', 'all', 'one', 'out', 'get', 'got', 'its', 'our', 'how',
  'why', 'who', 'she', 'his', 'her', 'any', 'may', 'way', 'new', 'now', 'too',
]);

function extractCashtags(text) {
  const m = (text || '').match(/\$[A-Za-z][A-Za-z0-9]{1,9}/g) || [];
  return [...new Set(m.map(t => t.slice(1).toUpperCase()))];
}

/** Remove handles, URLs, cashtags, hashtags — optional author handle tokens from body. */
function stripMatchingNoise(text, opts = {}) {
  let s = text || '';
  s = s.replace(/https?:\/\S+/gi, ' ');
  s = s.replace(/\bt\.co\/\S+/gi, ' ');
  s = s.replace(/\B@[A-Za-z0-9_]{1,15}/g, ' ');
  s = s.replace(/\$[A-Za-z][A-Za-z0-9]{1,9}/g, ' ');
  s = s.replace(/#[A-Za-z0-9_]+/g, ' ');
  if (opts.authorHandle) {
    for (const t of authorHandleTokens(opts.authorHandle)) {
      if (t.length >= 3) s = s.replace(new RegExp(`\\b${escapeRegExp(t)}\\b`, 'gi'), ' ');
    }
  }
  return s.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeHandle(handle) {
  return (handle || '').replace(/^@/, '').toLowerCase();
}

/** Tokens from @user_name for title rejection and matching exclusion. */
function authorHandleTokens(handle) {
  const h = normalizeHandle(handle);
  if (!h) return [];
  const parts = h.split(/[^a-z0-9]+/).filter(p => p.length >= 3);
  return [...new Set([h, ...parts])];
}

function authorTokensFromPosts(posts) {
  const set = new Set();
  for (const p of posts || []) {
    for (const t of authorHandleTokens(p.handle)) set.add(t);
  }
  return [...set];
}

function textForMatching(text, handle) {
  return stripMatchingNoise(text, { authorHandle: handle });
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/https?:\S+/gi, ' ')
    .replace(/\$[a-z0-9]+/gi, ' ')
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w));
}

function tokenizeForMatching(text, handle) {
  return tokenize(textForMatching(text, handle));
}

function keywords(text) {
  return [...new Set(tokenize(text))];
}

function keywordsForMatching(text, handle) {
  return [...new Set(tokenizeForMatching(text, handle))];
}

function keywordOverlap(textA, textB) {
  const ka = keywords(textA);
  const kb = new Set(keywords(textB));
  if (!ka.length || !kb.size) return 0;
  let inter = 0;
  for (const k of ka) if (kb.has(k)) inter += 1;
  const union = new Set([...ka, ...keywords(textB)]).size;
  return union ? inter / union : 0;
}

function keywordOverlapMatching(textA, handleA, textB, handleB) {
  const ka = keywordsForMatching(textA, handleA);
  const kb = new Set(keywordsForMatching(textB, handleB));
  if (!ka.length || !kb.size) return 0;
  let inter = 0;
  for (const k of ka) if (kb.has(k)) inter += 1;
  const union = new Set([...ka, ...kb]).size;
  return union ? inter / union : 0;
}

function maxKeywordOverlap(postText, memberTexts) {
  let best = 0;
  for (const t of memberTexts) {
    best = Math.max(best, keywordOverlap(postText, t));
  }
  return best;
}

function maxKeywordOverlapMatching(postText, postHandle, members) {
  let best = 0;
  for (const m of members) {
    const text = typeof m === 'string' ? m : m.text;
    const handle = typeof m === 'string' ? null : m.handle;
    best = Math.max(best, keywordOverlapMatching(postText, postHandle, text, handle));
  }
  return best;
}

/** Dominant 2–3 word phrase from token frequencies (legacy title seed). */
function dominantPhrase(texts) {
  const freq = new Map();
  const bigramFreq = new Map();

  for (const text of texts) {
    const toks = tokenize(stripMatchingNoise(text));
    for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
    for (let i = 0; i < toks.length - 1; i++) {
      const bg = `${toks[i]} ${toks[i + 1]}`;
      bigramFreq.set(bg, (bigramFreq.get(bg) || 0) + 1);
    }
  }

  let bestBg = '';
  let bestScore = 0;
  for (const [bg, n] of bigramFreq) {
    if (n > bestScore) {
      bestScore = n;
      bestBg = bg;
    }
  }
  if (bestBg) {
    return bestBg.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  let bestTok = 'Viral Story';
  let bestN = 0;
  for (const [t, n] of freq) {
    if (n > bestN) {
      bestN = n;
      bestTok = t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return bestTok;
}

/** Fallback title: first clause of cleaned post text (never random keyword freq). */
function firstClauseTitle(text) {
  const clean = stripMatchingNoise(text);
  if (!clean) return 'Viral Story';
  const clause = clean.split(/[.!?\n—–-]+/)[0].trim();
  const words = clause.split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return 'Viral Story';
  return words
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 72);
}

function titleContainsAuthorNoise(title, authorTokens) {
  if (!title) return true;
  if (/@/.test(title)) return true;
  const lower = title.toLowerCase();
  for (const t of authorTokens || []) {
    if (t.length >= 3 && new RegExp(`\\b${escapeRegExp(t)}\\b`, 'i').test(lower)) return true;
  }
  return false;
}

function slugify(s) {
  return (s || 'cluster')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'cluster';
}

function blurbFromPosts(posts) {
  const top = posts.slice().sort((a, b) => (b.latestViews || b.views || 0) - (a.latestViews || a.views || 0))[0];
  if (!top) return 'Emerging narrative cluster';
  const t = stripMatchingNoise(top.text || '');
  return t.length > 120 ? t.slice(0, 118) + '…' : t;
}

module.exports = {
  extractCashtags,
  stripMatchingNoise,
  textForMatching,
  authorHandleTokens,
  authorTokensFromPosts,
  normalizeHandle,
  keywords,
  keywordsForMatching,
  keywordOverlap,
  keywordOverlapMatching,
  maxKeywordOverlap,
  maxKeywordOverlapMatching,
  dominantPhrase,
  firstClauseTitle,
  titleContainsAuthorNoise,
  slugify,
  blurbFromPosts,
  tokenize,
  tokenizeForMatching,
};
