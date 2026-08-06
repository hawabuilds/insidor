'use strict';

/**
 * Stage 2 post search — X API v2 official /2/tweets/search/recent ONLY.
 * Never imports worker/adapters/x/reader.js (TwitterAPI.io).
 */

const {
  searchRecent,
  launchSearchWindow,
  toIsoUtc,
  MAX_RESULTS,
} = require('../../lib/x-official-adapter');
const { distinctiveWords, tokenizeName } = require('./name-filter');
const { CONFIG } = require('./config');

const SOLANA_MINT_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}(?:pump|bonk)?\b/g;
const RT_PREFIX = /^rt @/i;

const NARRATIVE_SYNONYMS = {
  american: ['american', 'america', "america's"],
  hero: ['hero', 'honor', 'honour', 'brave', 'rescue', 'saved', 'lifeguard'],
  dragon: ['dragon', 'dragons'],
  flying: ['flying', 'spotted', 'soaring'],
};

/** Tickers that match common English — require $ prefix to count as ticker hit. */
const COMMON_WORD_TICKERS = new Set([
  'diary', 'hood', 'coin', 'meme', 'baby', 'alpha', 'sigma', 'trend', 'viral', 'rocky', 'paul',
]);

function extractMintAddresses(text) {
  return [...new Set(String(text || '').match(SOLANA_MINT_RE) || [])];
}

function mentionsWrongMint(text, mint) {
  if (!mint || mint === 'probe') return false;
  const addrs = extractMintAddresses(text);
  if (!addrs.length) return false;
  return addrs.some(a => a !== mint);
}

function mentionsOurMint(text, mint) {
  if (!mint || mint === 'probe') return false;
  return extractMintAddresses(text).includes(mint);
}

function textHasSynonym(text, word) {
  const syns = NARRATIVE_SYNONYMS[word] || [word];
  return syns.some(s => text.includes(s));
}

function postViews(post) {
  return Number(post?.views) || 0;
}

function meetsViewGate(hit) {
  const views = postViews(hit?.parsed);
  if (views >= CONFIG.MIN_VIRAL_VIEWS) return true;
  if ((hit?.reason || '').includes('mint in post')) return true;
  return false;
}

function buildNarrativeQueries(token) {
  const name = String(token.name || '').trim();
  const words = tokenizeName(name);
  const { startTime, endTime } = launchSearchWindow(
    token.launch_at,
    CONFIG.POST_SEARCH_HOURS_BEFORE_LAUNCH,
  );
  const noRt = '-is:retweet';
  const queries = [];

  const hasAmerican = words.some(w => w === 'american' || w === 'america');
  const hasHero = words.includes('hero');
  const hasDragon = words.includes('dragon');
  const hasFlying = words.includes('flying');

  if (hasAmerican && hasHero) {
    queries.push({
      label: 'narrative:eric-lifeguard',
      query: `from:EricTrump (lifeguard OR "best of America" OR "civilian honor") ${noRt} lang:en`,
      startTime,
      endTime,
    });
    queries.push({
      label: 'narrative:lifeguard-america',
      query: `lifeguard ("best of America" OR "civilian honor" OR american) ${noRt} lang:en`,
      startTime,
      endTime,
    });
  }

  if (hasDragon || (hasFlying && words.includes('dragon'))) {
    queries.push({
      label: 'narrative:dragon-spotted-flying',
      query: `dragon spotted flying ${noRt} lang:en`,
      startTime,
      endTime,
    });
    queries.push({
      label: 'narrative:dragon-spotted',
      query: `(dragon spotted OR "giant dragon") ${noRt} lang:en`,
      startTime,
      endTime,
    });
    if (hasFlying) {
      queries.push({
        label: 'narrative:flying-dragon',
        query: `"flying dragon" OR (dragon flying) ${noRt} lang:en`,
        startTime,
        endTime,
      });
    }
  }

  if (words.includes('fauci') && words.includes('diary')) {
    queries.push({
      label: 'narrative:fauci-diary',
      query: `("Fauci diary" OR "Fauci's diary" OR "Fauci's own diary") ${noRt} lang:en`,
      startTime,
      endTime,
    });
  }

  if (words.length >= 2) {
    const phrase = words.slice(0, 2).join(' ');
    queries.push({
      label: 'narrative:phrase',
      query: `"${phrase}" ${noRt} lang:en`,
      startTime,
      endTime,
    });
  }

  const strong = words.find(w => w.length >= 5 && !['american', 'hero', 'america', 'dragon', 'flying'].includes(w));
  if (strong) {
    queries.push({
      label: 'narrative:keyword',
      query: `${strong} ${noRt} lang:en`,
      startTime,
      endTime,
    });
  }

  return queries;
}

function buildPostSearchQueries(token) {
  const queries = [];
  const ticker = String(token.ticker || '').replace(/^\$/, '').toUpperCase();
  const name = String(token.name || '').trim();
  const { startTime, endTime } = launchSearchWindow(
    token.launch_at,
    CONFIG.POST_SEARCH_HOURS_BEFORE_LAUNCH,
  );
  const noRt = '-is:retweet';

  queries.push(...buildNarrativeQueries(token));

  if (name && name.length >= 3) {
    const safe = name.replace(/"/g, '').slice(0, 60);
    queries.push({ label: 'name', query: `"${safe}" ${noRt} lang:en`, startTime, endTime });
  }
  const words = distinctiveWords(name, ticker);
  if (words.length) {
    queries.push({
      label: 'distinctive',
      query: `${words.slice(0, 3).join(' ')} ${noRt} lang:en`,
      startTime,
      endTime,
    });
  }
  if (ticker && ticker.length >= 2) {
    queries.push({ label: 'ticker', query: `$${ticker} ${noRt} lang:en`, startTime, endTime });
  }
  return queries;
}

function scorePostMatch(post, token) {
  const text = (post.text || '').toLowerCase();
  const ticker = String(token.ticker || '').replace(/^\$/, '').toLowerCase();
  const name = String(token.name || '').toLowerCase();
  const mint = token.mint;
  const launchMs = Date.parse(token.launch_at);
  const postedMs = post.posted_at || 0;
  const views = postViews(post);
  const minViral = CONFIG.MIN_VIRAL_VIEWS;

  let score = 0;
  const reasons = [];
  let wrongCa = false;
  let hasMint = false;

  if (postedMs && launchMs && postedMs <= launchMs) {
    score += 0.15;
    reasons.push('posted before launch');
  } else if (postedMs && launchMs && postedMs > launchMs) {
    const minsAfter = (postedMs - launchMs) / 60_000;
    if (minsAfter <= 60) {
      score += 0.05;
      reasons.push('posted within 1h of launch');
    } else {
      score -= 0.35;
      reasons.push('posted after launch (penalty)');
    }
  }

  if (mint && mentionsOurMint(text, mint)) {
    score += 0.4;
    hasMint = true;
    reasons.push('mint in post');
  }

  if (ticker && (text.includes(`$${ticker}`) || (!COMMON_WORD_TICKERS.has(ticker) && text.includes(ticker)))) {
    if (mentionsWrongMint(text, mint)) {
      score -= 0.6;
      wrongCa = true;
      reasons.push('wrong CA in post');
    } else {
      score += 0.2;
      reasons.push('ticker in text');
    }
  }

  if (name && name.length >= 4 && text.includes(name)) {
    score += 0.15;
    reasons.push('name in text');
  }

  const nameWords = tokenizeName(token.name);
  for (const w of nameWords) {
    if (textHasSynonym(text, w)) {
      score += 0.12;
      reasons.push(`narrative:${w}`);
    }
  }
  if (nameWords.includes('dragon') && text.includes('dragon') && (text.includes('spotted') || text.includes('flying'))) {
    score += 0.2;
    reasons.push('dragon viral news pattern');
  }
  if (nameWords.includes('american') && nameWords.includes('hero') && text.includes('lifeguard')) {
    score += 0.15;
    reasons.push('lifeguard+america narrative');
  }

  if (views >= 1_000_000) {
    score += 0.4;
    reasons.push('1M+ views');
  } else if (views >= 500_000) {
    score += 0.3;
    reasons.push('500k+ views');
  } else if (views >= minViral) {
    score += 0.25;
    reasons.push(`${Math.round(minViral / 1000)}k+ views`);
  } else if (views >= 10_000) {
    score += 0.05;
    reasons.push('10k+ views (below viral bar)');
  } else if (views >= 1_000) {
    score -= 0.1;
    reasons.push('low views (< viral bar)');
  } else {
    score -= 0.25;
    reasons.push('negligible views');
  }

  if (post.media_url) {
    score += 0.05;
    reasons.push('has media');
  }

  if (RT_PREFIX.test(post.text || '')) {
    score -= 0.35;
    reasons.push('retweet (penalty)');
  }
  if ((post.handle || '').toLowerCase() === 'erictrump') {
    score += 0.2;
    reasons.push('original EricTrump post');
  }
  if ((post.handle || '').toLowerCase() === 'thesun' && text.includes('dragon')) {
    score += 0.15;
    reasons.push('TheSun dragon news');
  }

  const followers = Number(post.followers) || 0;
  if (text.includes('fauci') && text.includes('diary') && followers >= 100_000) {
    score += 0.12;
    reasons.push('fauci diary news narrative');
  }
  if (followers >= 500_000) {
    score += 0.1;
    reasons.push('major account');
  }

  if (wrongCa) score = Math.min(score, 0.2);
  if (!hasMint && views < minViral) score = Math.min(score, 0.34);

  return { score: Math.max(0, Math.min(1, score)), reasons, wrongCa, views, hasMint };
}

function isPlausibleMatch(hit) {
  if (!hit || hit.confidence < CONFIG.MATCH_CONFIDENCE_MIN) return false;
  if (hit.wrongCa) return false;
  return meetsViewGate(hit);
}

function isStrongMatch(hit) {
  if (!isPlausibleMatch(hit)) return false;
  const reason = hit.reason || '';
  if (reason.includes('mint in post') && hit.confidence >= CONFIG.MATCH_CONFIDENCE_MIN) return true;
  if (reason.includes('1M+ views') || reason.includes('500k+ views')) return true;
  if (reason.includes(`${Math.round(CONFIG.MIN_VIRAL_VIEWS / 1000)}k+ views`)) return true;
  if (reason.includes('original EricTrump post')) return true;
  if (reason.includes('dragon viral news pattern') && meetsViewGate(hit)) return true;
  return hit.confidence >= 0.65 && meetsViewGate(hit);
}

function buildHit(post, token, q, score, reasons, wrongCa) {
  return {
    confidence: score,
    reason: `${q.label}: ${reasons.join(', ') || 'weak match'}`,
    wrongCa,
    platform_post_id: post.platform_post_id,
    text: post.text,
    posted_at: post.posted_at ? new Date(post.posted_at).toISOString() : null,
    url: post.handle
      ? `https://x.com/${post.handle}/status/${post.platform_post_id}`
      : null,
    raw: post.raw,
    parsed: post,
    query: q,
  };
}

function pickBestEligible(candidates) {
  const eligible = candidates.filter(c => isPlausibleMatch(c.hit));
  if (!eligible.length) {
    const fallback = candidates.filter(c => c.hit && !c.hit.wrongCa);
    fallback.sort((a, b) => (b.hit.confidence - a.hit.confidence) || (postViews(b.hit.parsed) - postViews(a.hit.parsed)));
    return fallback[0]?.hit || null;
  }
  eligible.sort((a, b) => {
    const dv = postViews(b.hit.parsed) - postViews(a.hit.parsed);
    if (dv !== 0) return dv;
    return b.hit.confidence - a.hit.confidence;
  });
  return eligible[0].hit;
}

/**
 * Run narrative → name → distinctive → ticker. Pick best viral post across all queries.
 */
async function searchOriginatingPost(token, { printRaw = false } = {}) {
  const queries = buildPostSearchQueries(token);
  const allCandidates = [];
  let tweetsRead = 0;
  let queriesRun = 0;
  let lastRaw = null;
  let totalCost = 0;

  const win = launchSearchWindow(token.launch_at, CONFIG.POST_SEARCH_HOURS_BEFORE_LAUNCH);
  console.log(
    `[backtest:post-search] ${token.ticker || token.mint.slice(0, 8)} · ` +
    `window ${toIsoUtc(win.startTime)} → ${toIsoUtc(win.endTime)}` +
    (win.clamped ? ' (start clamped to X 7d floor)' : '') +
    ` · viral bar ≥${CONFIG.MIN_VIRAL_VIEWS} views`,
  );

  for (const q of queries) {
    queriesRun += 1;
    console.log(`[backtest:post-search] query ${q.label}: ${q.query}`);

    let result;
    try {
      result = await searchRecent(q.query, {
        startTime: q.startTime,
        endTime: q.endTime,
        maxResults: MAX_RESULTS,
        stage: `post-search:${q.label}`,
      });
    } catch (e) {
      console.warn(`  X official search failed: ${e.message}`);
      if (printRaw && e.raw) console.log(JSON.stringify(e.raw, null, 2));
      continue;
    }

    lastRaw = result.raw;
    tweetsRead += result.billableReads;
    totalCost += result.billableReads * (Number(process.env.X_OFFICIAL_COST_PER_READ) || 0.005);

    console.log(`  → ${result.posts.length} posts (${result.billableReads} billable reads)`);

    for (const post of result.posts) {
      const { score, reasons, wrongCa } = scorePostMatch(post, token);
      const hit = buildHit(post, token, q, score, reasons, wrongCa);
      allCandidates.push({ hit, raw: result.raw });
    }
  }

  const best = pickBestEligible(allCandidates);

  if (printRaw && lastRaw) {
    console.log('\n--- RAW X API RESPONSE (last query) ---');
    console.log(JSON.stringify(lastRaw, null, 2));
    console.log('--- END RAW ---\n');
  }

  if (best && isPlausibleMatch(best)) {
    console.log(
      `  ✓ best viral (${best.confidence.toFixed(2)}, ${postViews(best.parsed)} views) — ${best.url || 'n/a'}`,
    );
  } else if (best) {
    console.log(
      `  ⚠ best below viral bar (${best.confidence.toFixed(2)}, ${postViews(best.parsed)} views) — ${best.url || 'n/a'}`,
    );
  }

  return {
    queries,
    queriesRun,
    tweetsRead,
    totalCost,
    best: isPlausibleMatch(best) ? best : (best || null),
    bestBelowBar: best && !isPlausibleMatch(best) ? best : null,
    lastRaw,
    stoppedEarly: false,
    historicalNote: tweetsRead === 0
      ? 'X recent search returned zero posts — window may be outside last 7 days or query missed'
      : (best && !isPlausibleMatch(best)
        ? `no post ≥${CONFIG.MIN_VIRAL_VIEWS} views in window`
        : null),
  };
}

module.exports = {
  buildPostSearchQueries,
  buildNarrativeQueries,
  searchOriginatingPost,
  scorePostMatch,
  isPlausibleMatch,
  isStrongMatch,
  meetsViewGate,
  extractMintAddresses,
  mentionsWrongMint,
};
