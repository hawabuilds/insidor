'use strict';

const TICKER_RE = /\$([A-Z]{2,10})\b/gi;

const PROPOSAL_PHRASE_RES = [
  /someone\s+deploy/i,
  /make\s+a\s+coin/i,
  /this\s+is\s+a\s+coin/i,
  /wen\s+coin/i,
  /needs\s+a\s+ticker/i,
  /deploy\s+this/i,
  /coin\s+it/i,
  /tokenize\s+this/i,
  /launch\s+a\s+coin/i,
  /should\s+be\s+a\s+coin/i,
];

const CT_SIGNAL_RES = [
  /\bsolana\b/i,
  /\bmemecoin/i,
  /\bpump\.fun\b/i,
  /\bdegen\b/i,
  /\$\w{2,10}\b/,
  /\bcontract\b/i,
  /\bca\s*[:=]/i,
  /\bjup(?:iter)?\b/i,
  /\bbonk\b/i,
  /\bpumpfun\b/i,
];

function extractCashtagTickers(text) {
  const set = new Set();
  const s = text || '';
  let m;
  const re = new RegExp(TICKER_RE.source, 'gi');
  while ((m = re.exec(s)) !== null) {
    set.add(m[1].toUpperCase());
  }
  return [...set];
}

function countProposalPhrases(text) {
  const s = text || '';
  let n = 0;
  for (const re of PROPOSAL_PHRASE_RES) {
    if (re.test(s)) n += 1;
  }
  return n;
}

/** Scan text (+ optional reply strings) for spontaneous ticker proposals. */
function scanTickerProposals(text, replies = []) {
  const chunks = [text, ...(replies || [])].filter(Boolean);
  const tickers = new Set();
  let phraseHits = 0;

  for (const chunk of chunks) {
    for (const t of extractCashtagTickers(chunk)) tickers.add(t);
    phraseHits += countProposalPhrases(chunk);
  }

  const count = tickers.size + phraseHits;
  return { count, tickers: [...tickers], phraseHits };
}

function bioFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const author = raw.author || raw.authorMeta || raw.user || {};
  return [
    author.signature,
    author.bio,
    author.desc,
    author.description,
    raw.authorBio,
  ].filter(Boolean).join(' ');
}

/** Crypto-native account or post with CT language. */
function isCtPickup(post) {
  const raw = post?.raw || {};
  const author = raw.author || raw.authorMeta || {};
  const blob = [
    post?.text,
    post?.handle,
    bioFromRaw(raw),
    author.nickname,
    author.uniqueId,
  ].filter(Boolean).join('\n');

  return CT_SIGNAL_RES.some(re => re.test(blob));
}

function scanPostSignals(post) {
  const replies = Array.isArray(post?.sample_replies)
    ? post.sample_replies
    : Array.isArray(post?.sampleReplies)
      ? post.sampleReplies
      : [];
  const proposals = scanTickerProposals(post?.text, replies);
  return {
    ticker_proposal_count: proposals.count,
    proposal_tickers: proposals.tickers,
    ct_pickup: isCtPickup(post),
  };
}

function aggregateNarrativeSignals(posts) {
  let ticker_proposals = 0;
  let ct_pickup = false;
  const allTickers = new Set();

  for (const p of posts || []) {
    const sig = scanPostSignals(p);
    ticker_proposals += sig.ticker_proposal_count;
    ct_pickup = ct_pickup || sig.ct_pickup;
    for (const t of sig.proposal_tickers) allTickers.add(t);
  }

  return { ticker_proposals, ct_pickup, proposal_tickers: [...allTickers] };
}

module.exports = {
  scanTickerProposals,
  scanPostSignals,
  aggregateNarrativeSignals,
  isCtPickup,
  extractCashtagTickers,
  PROPOSAL_PHRASE_RES,
};
