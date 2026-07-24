/* ============================================================================
   Insidor — live.js  (Layer 1: browser-direct, NO API KEY, NO BACKEND)

   Self-populating. You do NOT pick contracts — this discovers live Solana
   tokens from DexScreener's keyless endpoints, hydrates full market data,
   and rebuilds TOKENS[] in place. Your existing render functions are reused
   untouched.

   Load in site/index.html as the LAST script in <body>:
       <script src="live.js"></script>
   ========================================================================== */
(function () {
  'use strict';

  const CFG = {
    MAX_TOKENS: 40,
    REFRESH_MS: 30000,
    DISCOVER_MS: 120000,

    MIN_LIQ_USD: 5000,
    MIN_VOL24_USD: 10000,
    MAX_AGE_MIN: 60 * 24 * 14,

    /* Fast first paint: parallel search only (pairs include logos + prices) */
    BOOT_SEARCHES: ['pump', 'meme', 'SOL', 'dog'],
    SEARCH_SEEDS: ['SOL', 'pump', 'meme', 'dog', 'cat', 'AI'],
  };

  const API = {
    profiles: 'https://api.dexscreener.com/token-profiles/latest/v1',
    boosts:   'https://api.dexscreener.com/token-boosts/latest/v1',
    search:   'https://api.dexscreener.com/latest/dex/search?q=',
    tokens:   'https://api.dexscreener.com/latest/dex/tokens/',
  };

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const STABLE_QUOTES = new Set(['USDC', 'USDT']);

  let discovered = new Set();
  let iconCache = new Map();
  let lastDiscover = 0;
  let discoverRunning = false;
  let solPrice = null;
  let solChange24h = null;

  const j = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  };

  const isSol = (x) => (x.chainId || x.chain) === 'solana';

  const symFromPair = (p) =>
    (p.baseToken?.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'TOKEN';

  function cacheIcons(arr) {
    (Array.isArray(arr) ? arr : []).filter(isSol).forEach(t => {
      if (t.tokenAddress && t.icon) iconCache.set(t.tokenAddress, t.icon);
    });
  }

  function pickSolUsdPair(pairs) {
    return (pairs || [])
      .filter(p => STABLE_QUOTES.has((p.quoteToken?.symbol || '').toUpperCase()))
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
  }

  function renderSolNav() {
    const el = document.getElementById('solPrice');
    const pill = document.getElementById('solPill');
    const sd = pill?.querySelector('.sd');
    if (!el) return;
    if (solPrice == null) {
      el.textContent = '—';
      return;
    }
    el.textContent = '$' + solPrice.toFixed(2);
    if (!pill) return;
    pill.classList.remove('sol-up', 'sol-dn');
    if (solChange24h == null || !Number.isFinite(solChange24h)) {
      if (sd) sd.textContent = '';
      return;
    }
    const up = solChange24h >= 0;
    pill.classList.add(up ? 'sol-up' : 'sol-dn');
    if (sd) sd.textContent = `${up ? '▲' : '▼'} ${Math.abs(solChange24h).toFixed(1)}%`;
  }

  async function fetchSolPrice() {
    try {
      const data = await j(API.tokens + SOL_MINT);
      const pair = pickSolUsdPair(data.pairs);
      if (!pair) return;
      const px = parseFloat(pair.priceUsd);
      if (!Number.isFinite(px) || px <= 0) return;
      solPrice = px;
      window.SOL_PRICE = px;
      solChange24h = pair.priceChange?.h24 ?? null;
      renderSolNav();
      window.dispatchEvent(new Event('insidor-sol-price'));
    } catch (e) {
      console.warn('[live] SOL price:', e.message);
    }
  }

  async function loadIcons() {
    const [profiles, boosts] = await Promise.all([
      j(API.profiles).catch(e => { console.warn('[live] profiles:', e.message); return []; }),
      j(API.boosts).catch(e => { console.warn('[live] boosts:', e.message); return []; }),
    ]);
    cacheIcons(profiles);
    cacheIcons(boosts);
  }

  function logoForPair(p) {
    const ca = p.baseToken?.address;
    return p.info?.imageUrl || (ca && iconCache.get(ca)) || null;
  }

  async function fetchSearchPairs(queries) {
    const results = await Promise.all(
      queries.map(q => j(API.search + encodeURIComponent(q)).catch(e => {
        console.warn('[live] search', q, e.message);
        return { pairs: [] };
      }))
    );
    return results.flatMap(d => (d.pairs || []).filter(isSol));
  }

  async function hydrate(mints) {
    if (!mints.length) return [];
    const chunks = [];
    for (let i = 0; i < mints.length; i += 25) chunks.push(mints.slice(i, i + 25));
    const results = await Promise.all(
      chunks.map(chunk => j(API.tokens + chunk.join(',')).catch(e => {
        console.warn('[live] hydrate:', e.message);
        return { pairs: [] };
      }))
    );
    return results.flatMap(d => d.pairs || []);
  }

  function bestPairs(pairs) {
    const byMint = new Map();
    for (const p of pairs) {
      if (!isSol(p) || !p.baseToken?.address) continue;
      const k = p.baseToken.address;
      const cur = byMint.get(k);
      if (!cur || compareDexPairs(cur, p) > 0) byMint.set(k, p);
    }
    return [...byMint.values()];
  }

  function quoteSym(p) {
    return String(p.quoteToken?.symbol || '').toUpperCase();
  }

  function isSolQuote(p) {
    const sym = quoteSym(p);
    const addr = String(p.quoteToken?.address || '').toLowerCase();
    return sym === 'SOL' || sym === 'WSOL' || addr === SOL_MINT.toLowerCase();
  }

  function compareDexPairs(a, b) {
    const aSol = isSolQuote(a) ? 1 : 0;
    const bSol = isSolQuote(b) ? 1 : 0;
    if (aSol !== bSol) return bSol - aSol;
    const volDiff = (b.volume?.h24 || 0) - (a.volume?.h24 || 0);
    if (volDiff !== 0) return volDiff;
    return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
  }

  function toToken(p) {
    const ageM = p.pairCreatedAt
      ? Math.max(1, Math.round((Date.now() - p.pairCreatedAt) / 60000)) : 9999;
    const txns24 = (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0);

    const socials = {};
    (p.info?.socials || []).forEach(s => {
      if (s.type === 'twitter')  socials.x  = s.url;
      if (s.type === 'telegram') socials.tg = s.url;
    });
    if (p.info?.websites?.[0]?.url) socials.web = p.info.websites[0].url;

    const ca = p.baseToken.address;

    return {
      sym: symFromPair(p),
      name: p.baseToken?.name || symFromPair(p),
      ca,
      price: parseFloat(p.priceUsd) || 0,
      c5:  p.priceChange?.m5  ?? 0,
      c1h: p.priceChange?.h1  ?? 0,
      c24: p.priceChange?.h24 ?? 0,
      vol: p.volume?.h24 ?? 0,
      liq: p.liquidity?.usd ?? 0,
      mc:  p.marketCap ?? p.fdv ?? 0,
      ageM,
      txns: txns24,
      holders: null,
      live: true,
      narrIdx: null,
      logo: logoForPair(p),
      socials,
      dex: p.url || `https://dexscreener.com/solana/${ca}`,
      pump: `https://pump.fun/${ca}`,
      pairAddress: p.pairAddress || null,
      pairUrl: p.url || null,
      mintRevoked: null, freezeRevoked: null, lpBurned: null, top10: null,
      _liveAt: Date.now(),
    };
  }

  const passesFloor = (t) =>
    t.liq >= CFG.MIN_LIQ_USD && t.vol >= CFG.MIN_VOL24_USD &&
    t.ageM <= CFG.MAX_AGE_MIN && t.price > 0;

  function applyPairs(pairs) {
    let toks = bestPairs(pairs).map(toToken).filter(passesFloor);
    if (!toks.length) return false;

    toks.sort((a, b) => b.vol - a.vol);
    toks = toks.slice(0, CFG.MAX_TOKENS);
    toks.forEach(t => discovered.add(t.ca));

    TOKENS.length = 0;
    toks.forEach(t => TOKENS.push(t));
    rerender();
    console.log(`[live] TOKENS = ${TOKENS.length} live Solana tokens`);
    return true;
  }

  async function fastBoot() {
    if (typeof TOKENS === 'undefined') {
      console.warn('[live] TOKENS not found — load live.js AFTER the app script');
      return false;
    }
    const [pairs] = await Promise.all([
      fetchSearchPairs(CFG.BOOT_SEARCHES),
      loadIcons(),
    ]);
    return applyPairs(pairs);
  }

  async function refreshPrices() {
    if (!TOKENS.length) return;
    const pairs = bestPairs(await hydrate(TOKENS.map(t => t.ca)));
    const byCa = new Map(pairs.map(p => [p.baseToken.address, p]));
    let changed = false;
    TOKENS.forEach(t => {
      const p = byCa.get(t.ca);
      if (p) {
        const keep = t._enrichedAt ? {
          mintRevoked: t.mintRevoked,
          freezeRevoked: t.freezeRevoked,
          lpBurned: t.lpBurned,
          top10: t.top10,
          holders: t.holders,
          riskLabel: t.riskLabel,
          risks: t.risks,
          _enrichedAt: t._enrichedAt,
        } : {};
        Object.assign(t, toToken(p), keep);
        changed = true;
      }
    });
    if (changed) rerender();
  }

  async function discover() {
    const mints = new Set(discovered);

    try {
      const d = await j(API.profiles);
      (Array.isArray(d) ? d : []).filter(isSol).forEach(t => t.tokenAddress && mints.add(t.tokenAddress));
    } catch (e) { console.warn('[live] profiles:', e.message); }

    try {
      const d = await j(API.boosts);
      (Array.isArray(d) ? d : []).filter(isSol).forEach(t => t.tokenAddress && mints.add(t.tokenAddress));
    } catch (e) { console.warn('[live] boosts:', e.message); }

    const searchPairs = await fetchSearchPairs(CFG.SEARCH_SEEDS);
    searchPairs.forEach(p => p.baseToken?.address && mints.add(p.baseToken.address));

    console.log(`[live] discovered ${mints.size} candidate mints`);
    return [...mints];
  }

  async function expandDiscover() {
    if (discoverRunning) return;
    discoverRunning = true;
    try {
      await loadIcons();
      const mints = await discover();
      mints.forEach(m => discovered.add(m));
      lastDiscover = Date.now();
      if (discovered.size > 400) discovered = new Set(TOKENS.map(t => t.ca));

      const sample = [...discovered].slice(0, 120);
      const pairs = bestPairs(await hydrate(sample));
      const extra = await fetchSearchPairs(CFG.BOOT_SEARCHES);
      if (pairs.length || extra.length) applyPairs([...pairs, ...extra]);
    } catch (e) {
      console.warn('[live] expand:', e.message);
    } finally {
      discoverRunning = false;
    }
  }

  async function refresh() {
    if (typeof TOKENS === 'undefined') return;

    await fetchSolPrice();

    if (TOKENS.some(t => t._liveAt)) await refreshPrices();
    else await fastBoot();

    const now = Date.now();
    if (now - lastDiscover > CFG.DISCOVER_MS || discovered.size === 0) {
      expandDiscover();
    }
  }

  function rerender() {
    try {
      linkNarrativesToTokens();
      if (typeof renderTokens     === 'function') renderTokens();
      if (typeof renderNew        === 'function') renderNew();
      const l3 = window.InsidorConfig?.isLayer3?.();
      if (typeof renderTrending   === 'function' && (!l3 || window._narrativesReady)) renderTrending();
      if (typeof renderNarratives === 'function' && (!l3 || window._narrativesReady)) renderNarratives();
      if (typeof renderWatch      === 'function') renderWatch();
    } catch (e) { console.warn('[live] rerender:', e.message); }

    document.querySelectorAll('.simtag,[data-sim]').forEach(el => {
      if (el.id === 'narrSimTag') return;
      el.textContent = 'live market data · DexScreener';
      el.classList.add('is-live');
    });
  }

  const NARR_POST_MS = 3600000;
  const NARR_REALTIME_FALLBACK_MS = 60_000;
  const VIRAL_STREAM_POLL_MS = 20_000;
  const VIRAL_FEED_MAX_AGE_MS = Number(window.VIRAL_FEED_MAX_AGE_MS) || 24 * 60 * 60 * 1000;
  const VIRAL_FEED_MAX_AGE_MS_X = Number(window.VIRAL_FEED_MAX_AGE_MS_X) || VIRAL_FEED_MAX_AGE_MS;
  const VIRAL_FEED_MAX_AGE_MS_TT = Number(window.VIRAL_FEED_MAX_AGE_MS_TT) || VIRAL_FEED_MAX_AGE_MS;
  const MIN_INGEST_VIEWS = 30000;
  window.MIN_INGEST_VIEWS = MIN_INGEST_VIEWS;
  window.VIRAL_FEED_MAX_AGE_MS_X = VIRAL_FEED_MAX_AGE_MS_X;
  window.VIRAL_FEED_MAX_AGE_MS_TT = VIRAL_FEED_MAX_AGE_MS_TT;
  const MEME_MIN_X = Number(window.MEME_MIN_X) || 0.6;
  const MEME_MIN_TT = Number(window.MEME_MIN_TT) || 0.75;
  window.MEME_MIN_X = MEME_MIN_X;
  window.MEME_MIN_TT = MEME_MIN_TT;
  const NARR_SELECT =
    'select=*,narrative_posts!narrative_posts_narrative_id_fkey(' +
    '*,post_snapshots(captured_at,views,replies,quotes,likes,retweets,unavailable)' +
    '),narrative_tickers(*)';
  /** Fast boot — skip nested snapshots (uses denormalized views on posts). */
  const NARR_SELECT_LIGHT =
    'select=*,narrative_posts!narrative_posts_narrative_id_fkey(*),narrative_tickers(*)';
  const VIRAL_MEME_EMBED = 'post_meme_scores!inner(meme_score,suggested_ticker)';
  const VIRAL_POST_LIST_SELECT =
    'select=id,platform,platform_post_id,handle,text,image,media_url,media_type,views,replies,quotes,likes,retweets,notable,posted_at,first_seen_at,narrative_id,filter_label,tracking_status,' +
    VIRAL_MEME_EMBED;
  const VIRAL_POST_BOOT_SELECT =
    'select=id,platform,platform_post_id,handle,text,image,media_url,media_type,views,replies,quotes,likes,retweets,notable,posted_at,first_seen_at,narrative_id,filter_label,tracking_status,' +
    VIRAL_MEME_EMBED;
  const VIRAL_POST_SELECT =
    'select=id,platform,platform_post_id,handle,text,image,media_url,media_type,raw,views,replies,quotes,likes,retweets,notable,posted_at,first_seen_at,narrative_id,filter_label,tracking_status,' +
    'post_meme_scores(suggested_ticker,meme_score),' +
    'post_snapshots(captured_at,views,replies,quotes,likes,retweets,unavailable)';
  const VIRAL_FEED_BOOT_LIMIT = 15;
  const VIRAL_FEED_SYNC_LIMIT = 80;
  const VIRAL_CACHE_KEY = 'insidor_viral_feed_v1';
  const VIRAL_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

  let sbClient = null;
  let narrChannel = null;
  let pipelineChannel = null;
  let postsChannel = null;
  let realtimeConnected = false;
  let fallbackPollTimer = null;
  let viralPollTimer = null;
  let pipelineStatePollTimer = null;
  const PIPELINE_STATE_POLL_MS = 60_000;
  const knownEligibleIds = new Set();
  const knownPipelineIds = new Set();
  const knownViralPostIds = new Set();
  const LIVE_ALERT_GRACE_MS = 3000;
  let pageLiveAt = null;
  window._pageLiveReady = false;

  function markPageLiveAt() {
    if (pageLiveAt == null) pageLiveAt = Date.now();
    window._pageLiveAt = pageLiveAt;
  }

  function markPageLiveReady() {
    window._pageLiveReady = true;
  }

  /** Live slide-in alerts only — ingested after this page session started. */
  function shouldAnnounceViralPost(item) {
    if (!item?.postId || !window._pageLiveReady) return false;
    const ingested = parsePostedAt(item.firstSeenAt);
    if (ingested == null || pageLiveAt == null) return false;
    return ingested >= pageLiveAt - LIVE_ALERT_GRACE_MS;
  }

  function shouldAnnounceNarrativeArrival() {
    return !!window._pageLiveReady;
  }

  window.isViralIngestAlert = shouldAnnounceViralPost;

  function normalizeEpochMs(v) {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) {
      if (n > 1e12) return n;
      if (n > 1e9) return n * 1000;
      return null;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }

  function parsePostedAt(v) {
    return normalizeEpochMs(v);
  }

  function extractPostMedia(raw, row) {
    if (row?.media_url) {
      return {
        mediaUrl: row.media_url,
        mediaType: row.media_type || (row.image !== false ? 'photo' : null),
      };
    }
    if (!raw || typeof raw !== 'object') return { mediaUrl: null, mediaType: null };
    const list = raw.extendedEntities?.media || raw.media || [];
    if (!Array.isArray(list) || !list.length) return { mediaUrl: null, mediaType: null };
    const item = list[0];
    const type = item.type || 'photo';
    if (type === 'photo') {
      return {
        mediaUrl: item.media_url_https || item.media_url || null,
        mediaType: 'photo',
      };
    }
    const thumb = item.media_url_https
      || item.preview_image_url
      || (item.video_info?.variants || []).find(v => String(v.content_type || '').startsWith('image/'))?.url
      || null;
    return {
      mediaUrl: thumb,
      mediaType: type === 'animated_gif' ? 'gif' : 'video',
    };
  }

  function initNarrPostTimes(narratives) {
    narratives.forEach(n => {
      n.posts.forEach((p, i) => {
        if (p.postedAt != null) return;
        if (p.firstSeenAt != null) {
          p.postedAt = p.firstSeenAt;
          return;
        }
        if (window._narrativesLive) return;
        p.postedAt = n.createdAt + i * NARR_POST_MS * 2;
      });
    });
  }

  function latestPostSnapshot(p) {
    const snaps = (p.post_snapshots || [])
      .filter(s => !s.unavailable)
      .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
    return snaps[0] || null;
  }

  function mapPostRow(p) {
    const snap = latestPostSnapshot(p);
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const media = extractPostMedia(p.raw, p);
    return {
      platform: p.platform,
      platformPostId: p.platform_post_id || null,
      handle: p.handle,
      followers: p.followers,
      text: p.text,
      image: p.image !== false,
      mediaUrl: media.mediaUrl,
      mediaType: media.mediaType,
      views: num(snap?.views ?? p.views),
      replies: num(snap?.replies ?? p.replies),
      quotes: num(snap?.quotes ?? p.quotes),
      likes: num(snap?.likes ?? p.likes),
      retweets: num(snap?.retweets ?? p.retweets),
      notable: !!p.notable,
      sampleReplies: p.sample_replies || [],
      postedAt: parsePostedAt(p.posted_at),
      firstSeenAt: parsePostedAt(p.first_seen_at),
    };
  }

  function normalizeNarrativeMetrics(n) {
    const oldest = n.posts.reduce((min, p) => {
      const t = parsePostedAt(p.postedAt);
      if (t == null) return min;
      return min == null ? t : Math.min(min, t);
    }, null);
    if (oldest != null) {
      n.ageMin = Math.max(1, Math.round((Date.now() - oldest) / 60000));
    }
  }

  function mapTickerRow(t) {
    return {
      ticker: t.ticker,
      name: t.name,
      mcap: Number(t.mcap) || 0,
      liquidity: Number(t.liquidity) || 0,
      vol24h: Number(t.vol24h) || 0,
      holders: t.holders || 0,
      ageMin: t.age_min || 0,
      firstDeployed: !!t.first_deployed,
      endorsedBy: t.endorsed_by || null,
      canonical: !!t.canonical,
      mint: t.mint_ca || null,
      dexUrl: t.dex_url || null,
      pumpUrl: t.pump_url || null,
      safety: t.safety || null,
      smartMoney: t.smart_money || null,
    };
  }

  function applyLookupToToken(tok, hit) {
    if (!hit?.found || !(Number(hit.liquidity) > 0)) return;
    tok.firstDeployed = true;
    tok.mcap = hit.mcap ?? tok.mcap;
    tok.liquidity = hit.liquidity ?? tok.liquidity;
    tok.vol24h = hit.vol24h ?? tok.vol24h;
    tok.ageMin = hit.ageMin ?? tok.ageMin;
    tok.mint = hit.mint ?? tok.mint;
    tok.dexUrl = hit.dexUrl ?? tok.dexUrl;
    tok.pumpUrl = hit.pumpUrl ?? tok.pumpUrl;
    tok.onPumpFun = !!hit.onPumpFun;
    tok.name = hit.name || tok.name;
    tok.priceUsd = hit.priceUsd ?? tok.priceUsd;
    tok.pairAddress = hit.pairAddress ?? tok.pairAddress;
  }

  function applyHitToRegistryToken(t, hit) {
    if (!t || !hit?.found || !(Number(hit.liquidity) > 0)) return t;
    t.mc = hit.mcap ?? t.mc;
    t.liq = hit.liquidity ?? t.liq;
    t.vol = hit.vol24h ?? t.vol;
    t.price = hit.priceUsd ?? t.price;
    t.ageM = hit.ageMin ?? t.ageM;
    t.dex = hit.dexUrl || t.dex;
    t.pump = hit.pumpUrl || t.pump;
    t.onPumpFun = !!hit.onPumpFun;
    t.firstDeployed = true;
    t.live = true;
    if (hit.pairAddress) t.pairAddress = hit.pairAddress;
    return t;
  }

  function materializeLiveToken(tok, narr) {
    if (typeof TOKENS === 'undefined' || !tok?.mint) return;
    if ((Number(tok.liquidity) || 0) <= 0) return;
    if (TOKENS.some(x => x.ca === tok.mint || x.sym === tok.ticker)) return;
    TOKENS.push({
      sym: tok.ticker,
      name: tok.name || tok.ticker,
      ca: tok.mint,
      price: tok.priceUsd || 0,
      c5: 0,
      c1h: 0,
      c24: 0,
      vol: tok.vol24h || 0,
      liq: tok.liquidity || 0,
      mc: tok.mcap || 0,
      ageM: tok.ageMin || 1,
      live: true,
      firstDeployed: !!tok.firstDeployed,
      narrIdx: narr?.narrIdx ?? -1,
      holders: tok.holders || null,
      dex: tok.dexUrl || (tok.pairAddress ? `https://dexscreener.com/solana/${tok.pairAddress}` : `https://dexscreener.com/solana/${tok.mint}`),
      pump: tok.pumpUrl || `https://pump.fun/${tok.mint}`,
      onPumpFun: !!tok.onPumpFun,
      pairAddress: tok.pairAddress || null,
      mintRevoked: null,
      freezeRevoked: null,
      lpBurned: null,
      top10: null,
      _liveAt: Date.now(),
    });
  }

  function lookupHitToToken(hit) {
    if (!hit?.mint) return null;
    return {
      sym: hit.ticker,
      name: hit.name || hit.ticker,
      ca: hit.mint,
      price: hit.priceUsd || 0,
      c5: 0,
      c1h: 0,
      c24: 0,
      vol: hit.vol24h || 0,
      liq: hit.liquidity || 0,
      mc: hit.mcap || 0,
      ageM: hit.ageMin || 1,
      live: true,
      firstDeployed: true,
      dex: hit.dexUrl || (hit.pairAddress ? `https://dexscreener.com/solana/${hit.pairAddress}` : `https://dexscreener.com/solana/${hit.mint}`),
      pump: hit.pumpUrl || `https://pump.fun/${hit.mint}`,
      onPumpFun: !!hit.onPumpFun,
      pairAddress: hit.pairAddress || null,
      mintRevoked: null,
      freezeRevoked: null,
      lpBurned: null,
      top10: null,
      _liveAt: Date.now(),
    };
  }

  function upsertTokenFromLookup(hit) {
    if (typeof TOKENS === 'undefined' || !hit?.mint) return null;
    let t = TOKENS.find(x => x.ca === hit.mint || x.sym === hit.ticker);
    const mapped = lookupHitToToken(hit);
    if (t) {
      applyHitToRegistryToken(t, hit);
      return t;
    }
    TOKENS.push(mapped);
    return mapped;
  }

  function materializeAllNarrativeTokens() {
    if (typeof NARRATIVES === 'undefined') return;
    NARRATIVES.forEach(n => {
      (n.tokens || []).forEach(tok => {
        if (tok.mint) materializeLiveToken(tok, n);
      });
    });
  }

  async function fetchExternalTokens(q) {
    const nq = String(q || '').trim();
    if (nq.length < 2) return [];
    const r = await fetch(`/api/token-search?q=${encodeURIComponent(nq)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return data.tokens || [];
  }

  async function searchAndMergeTokens(q) {
    const hits = await fetchExternalTokens(q);
    return hits.map(h => upsertTokenFromLookup(h)).filter(Boolean);
  }

  async function lookupTickerRemote(ticker) {
    const r = await fetch(`/api/token-lookup?ticker=${encodeURIComponent(ticker)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function lookupMintRemote(mint) {
    const r = await fetch(`/api/token-lookup?mint=${encodeURIComponent(mint)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function resolveTokenPair(t) {
    if (!t?.ca) return t;
    const needsPair = !t.pairAddress || (t.dex && t.dex.includes(`/solana/${t.ca}`));
    if (!needsPair) return t;
    try {
      const hit = await lookupMintRemote(t.ca);
      if (hit.found) applyHitToRegistryToken(t, hit);
    } catch (e) {
      console.warn('[live] resolveTokenPair', t.sym, e.message);
    }
    return t;
  }

  async function enrichNarrativeTokens(narratives) {
    const tickers = [...new Set(
      narratives.flatMap(n => (n.tokens || []).map(t => t.ticker)).filter(Boolean),
    )];
    if (!tickers.length) return 0;

    let hits = 0;
    await Promise.all(tickers.map(async (sym) => {
      try {
        let hit = null;
        for (const narr of narratives) {
          const tok = (narr.tokens || []).find(t => t.ticker === sym);
          if (tok?.mint) {
            hit = await lookupMintRemote(tok.mint);
            break;
          }
        }
        if (!hit?.found) hit = await lookupTickerRemote(sym);
        if (!hit?.found || !(Number(hit.liquidity) > 0)) return;
        hits += 1;
        for (const narr of narratives) {
          for (const tok of narr.tokens || []) {
            if (tok.ticker !== hit.ticker) continue;
            applyLookupToToken(tok, hit);
            materializeLiveToken(tok, narr);
          }
        }
      } catch (e) {
        console.warn('[live] token-lookup', sym, e.message);
      }
    }));
    return hits;
  }

  function mapNarrativeRow(row) {
    const posts = (row.narrative_posts || [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(mapPostRow);
    const tokens = (row.narrative_tickers || []).map(mapTickerRow);
    const series = row.search_series ?? null;
    const topPost = posts.slice().sort((a, b) => (b.views || 0) - (a.views || 0))[0] || posts[0];
    return {
      id: row.id,
      title: row.title,
      blurb: row.blurb,
      image: row.img_seed,
      imgSeed: row.img_seed,
      mediaUrl: topPost?.mediaUrl || null,
      mediaType: topPost?.mediaType || null,
      createdAt: parsePostedAt(row.created_at) ?? Date.now(),
      narrIdx: row.narr_idx,
      searchSeries: series,
      viewsSeries: series,
      leadTimeMin: row.lead_time_min,
      organicScore: row.organic_score,
      combinedViews: row.combined_views ?? null,
      viewsVelocity: row.views_velocity ?? 0,
      authorVelocity: row.author_velocity ?? 0,
      distinctAuthors: row.distinct_authors ?? 0,
      tickerProposals: row.ticker_proposals ?? 0,
      ctPickup: !!row.ct_pickup,
      accel: row.accel ?? 0,
      engagementVelocity: row.engagement_velocity ?? null,
      lifecycle: row.lifecycle ?? null,
      boughtReach: !!row.bought_reach,
      ageMin: row.age_min ?? null,
      firstSeenAt: parsePostedAt(row.first_seen_at) ?? parsePostedAt(row.created_at) ?? Date.now(),
      gain24h: row.gain_24h ?? null,
      displayEligible: !!row.display_eligible,
      gateReason: row.gate_reason ?? null,
      platforms: Array.isArray(row.platforms) ? row.platforms : [],
      crossPlatform: !!row.cross_platform,
      posts,
      tokens,
    };
  }

  /** Link narrative_tickers ↔ live TOKENS by symbol; set narrIdx / canonical / firstDeployed. */
  function linkNarrativesToTokens() {
    if (typeof NARRATIVES === 'undefined' || typeof TOKENS === 'undefined') return;
    NARRATIVES.forEach(n => {
      n.tokens.forEach(tok => {
        const t = TOKENS.find(x => x.sym === tok.ticker || (tok.mint && x.ca === tok.mint));
        if (t) {
          tok.mcap = t.mc;
          tok.liquidity = t.liq;
          tok.vol24h = t.vol;
          tok.holders = t.holders ?? tok.holders;
          tok.ageMin = t.ageM;
          tok.name = t.name;
          if (t.ca && !tok.mint) tok.mint = t.ca;
          if (t.ca) tok.firstDeployed = true;
          if (tok.canonical && n.narrIdx != null && n.narrIdx >= 0) t.narrIdx = n.narrIdx;
          if (tok.canonical != null) t.canonical = tok.canonical;
          if (tok.firstDeployed != null) t.firstDeployed = tok.firstDeployed;
          return;
        }
        if (tok.mint) materializeLiveToken(tok, n);
      });
    });
  }

  function setNarrativesFallback(reason) {
    const msg = reason || 'unknown error';
    console.warn('[live] loadNarratives FALLBACK — using inline sample NARRATIVES:', msg);
    window._narrativesReady = true;
    window._narrativesLive = false;
    loadViralStream().catch(e => console.warn('[live] viral after fallback:', e.message));
    const tag = document.getElementById('narrDataTag');
    if (tag) {
      tag.hidden = false;
      tag.textContent = 'using sample data';
      tag.title = msg;
    }
    const sim = document.getElementById('narrSimTag');
    if (sim) {
      sim.textContent = 'sample data (Supabase unavailable)';
      sim.classList.remove('is-live');
    }
    return false;
  }

  function setNarrativesLive(count) {
    window._narrativesReady = true;
    window._narrativesLive = true;
    const tag = document.getElementById('narrDataTag');
    if (tag) tag.hidden = true;
    const sim = document.getElementById('narrSimTag');
    if (sim) {
      sim.textContent = `live · ${count} narratives`;
      sim.classList.add('is-live');
      sim.title = realtimeConnected ? 'Supabase Realtime connected' : 'Polling fallback (Realtime disconnected)';
    }
    const trendSim = document.querySelector('#v-trending .simtag');
    if (trendSim) {
      trendSim.textContent = 'live narratives · DexScreener tokens';
      trendSim.classList.add('is-live');
    }
  }

  function pulseLiveIndicator() {
    const dot = document.getElementById('narrLiveDot');
    if (!dot) return;
    dot.classList.remove('pulse');
    void dot.offsetWidth;
    dot.classList.add('pulse');
    setTimeout(() => dot.classList.remove('pulse'), 700);
  }

  function flashNarrativeRows(id) {
    if (!id) return;
    document.querySelectorAll(`[data-narrative="${CSS.escape(id)}"]`).forEach(el => {
      el.classList.remove('narr-flash');
      void el.offsetWidth;
      el.classList.add('narr-flash');
      setTimeout(() => el.classList.remove('narr-flash'), 1500);
    });
  }

  function rerenderNarrativesOnly(opts = {}) {
    try {
      linkNarrativesToTokens();
      if (opts.patchId && typeof window.patchNarrativeRow === 'function') {
        const list = typeof window.getNarrativeSourceList === 'function'
          ? window.getNarrativeSourceList()
          : (typeof NARRATIVES !== 'undefined' ? NARRATIVES : []);
        const n = list.find(x => x.id === opts.patchId);
        if (n && window.patchNarrativeRow(n)) {
          if (typeof renderTrending === 'function') renderTrending();
          return;
        }
      }
      if (typeof renderNarratives === 'function') renderNarratives();
      if (typeof renderTrending === 'function') renderTrending();
      if (typeof window.rebuildStreamFromNarratives === 'function') window.rebuildStreamFromNarratives();
      if (typeof renderStream === 'function') renderStream();
    } catch (e) {
      console.warn('[live] rerenderNarrativesOnly:', e.message);
    }
  }

  function removeNarrative(id) {
    if (!id) return;
    const idx = NARRATIVES.findIndex(n => n.id === id);
    if (idx >= 0) NARRATIVES.splice(idx, 1);
    knownEligibleIds.delete(id);
    setNarrativesLive(NARRATIVES.length);
    rerenderNarrativesOnly();
  }

  function mergeScalarFields(n, row) {
    if (row.title != null) n.title = row.title;
    if (row.blurb != null) n.blurb = row.blurb;
    if (row.img_seed != null) {
      n.image = row.img_seed;
      n.imgSeed = row.img_seed;
    }
    if (row.search_series) {
      n.searchSeries = row.search_series;
      n.viewsSeries = row.search_series;
    }
    if (row.combined_views != null) n.combinedViews = row.combined_views;
    if (row.views_velocity != null) n.viewsVelocity = row.views_velocity;
    if (row.author_velocity != null) n.authorVelocity = row.author_velocity;
    if (row.distinct_authors != null) n.distinctAuthors = row.distinct_authors;
    if (row.ticker_proposals != null) n.tickerProposals = row.ticker_proposals;
    if (row.ct_pickup != null) n.ctPickup = !!row.ct_pickup;
    if (row.accel != null) n.accel = row.accel;
    if (row.engagement_velocity != null) n.engagementVelocity = row.engagement_velocity;
    if (row.lifecycle != null) n.lifecycle = row.lifecycle;
    if (row.gain_24h != null) n.gain24h = row.gain_24h;
    if (row.age_min != null) n.ageMin = row.age_min;
    if (row.organic_score != null) n.organicScore = row.organic_score;
    if (row.lead_time_min != null) n.leadTimeMin = row.lead_time_min;
    if (row.bought_reach != null) n.boughtReach = !!row.bought_reach;
    if (row.display_eligible != null) n.displayEligible = !!row.display_eligible;
    if (row.gate_reason != null) n.gateReason = row.gate_reason;
    if (row.created_at != null) {
      const t = parsePostedAt(row.created_at);
      if (t != null) n.createdAt = t;
    }
    if (row.first_seen_at) {
      const t = parsePostedAt(row.first_seen_at);
      if (t != null) n.firstSeenAt = t;
    }
  }

  function mergeNarrativeMapped(mapped, opts = {}) {
    const idx = NARRATIVES.findIndex(n => n.id === mapped.id);
    const isNew = idx < 0;
    if (isNew) NARRATIVES.push(mapped);
    else Object.assign(NARRATIVES[idx], mapped);
    initNarrPostTimes([mapped]);
    normalizeNarrativeMetrics(isNew ? mapped : NARRATIVES[idx]);
    if (opts.arrivalAlert) {
      flashNarrativeRows(mapped.id);
      pulseLiveIndicator();
    }
    knownEligibleIds.add(mapped.id);
  }

  async function fetchNarrativeRow(id) {
    const url = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    const r = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/narratives?${NARR_SELECT}&id=eq.${encodeURIComponent(id)}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = await r.json();
    return rows[0] || null;
  }

  async function fetchNarrativeRows(opts = {}) {
    const url = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    const select = opts.light ? NARR_SELECT_LIGHT : NARR_SELECT;
    const qs = `${select}&display_eligible=eq.true&order=author_velocity.desc,views_velocity.desc,created_at.desc`;
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/narratives?${qs}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Supabase HTTP ${r.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('Supabase response was not a JSON array');
    return rows;
  }

  async function fetchPipelineNarrativeRows() {
    const url = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    const qs = `${NARR_SELECT}&source=eq.cluster&status=eq.open&order=author_velocity.desc,views_velocity.desc`;
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/narratives?${qs}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`pipeline HTTP ${r.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  }

  function postViewsFromRow(p) {
    const snap = latestPostSnapshot(p);
    return Number(snap?.views ?? p.views) || 0;
  }

  function mapViralStreamItem(p) {
    const mapped = mapPostRow(p);
    const views = mapped.views || postViewsFromRow(p);
    const posted = parsePostedAt(mapped.postedAt);
    const firstSeen = parsePostedAt(mapped.firstSeenAt);
    const memeScores = p.post_meme_scores;
    const memeRow = Array.isArray(memeScores) ? memeScores[0] : memeScores;
    const memeScore = memeScoreFromRow(p);
    const suggestedTicker = memeRow?.suggested_ticker || null;
    return {
      live: true,
      postId: p.id,
      narrativeId: p.narrative_id || null,
      plat: mapped.platform,
      badge: mapped.platform === 'tt' ? 'TikTok' : 'X',
      txt: mapped.text,
      rawViews: views,
      replies: mapped.replies,
      quotes: mapped.quotes,
      retweets: mapped.retweets,
      likes: mapped.likes,
      who: (mapped.handle || '').replace(/^@/, ''),
      at: mapped.handle || '@user',
      pal: ((pseed(mapped.text) % 6) + 1),
      media: mapped.mediaType === 'video' || mapped.mediaType === 'gif'
        ? 'video'
        : (mapped.mediaUrl || mapped.image ? 'photo' : 'none'),
      mediaUrl: mapped.mediaUrl || null,
      mediaType: mapped.mediaType || null,
      platformPostId: mapped.platformPostId,
      postedAt: posted,
      firstSeenAt: firstSeen,
      filterLabel: p.filter_label || null,
      suggestedTicker,
      memeScore,
    };
  }

  function memeScoreFromRow(row) {
    const memeScores = row?.post_meme_scores;
    const memeRow = Array.isArray(memeScores) ? memeScores[0] : memeScores;
    const score = Number(memeRow?.meme_score);
    return Number.isFinite(score) ? score : null;
  }

  function memeMinForPost(platform) {
    return platform === 'tt' ? MEME_MIN_TT : MEME_MIN_X;
  }

  function passesMemeGateRow(row) {
    const score = memeScoreFromRow(row);
    if (score == null) return false;
    return score >= memeMinForPost(row?.platform);
  }

  function passesMemeGateItem(item) {
    const score = Number(item?.memeScore);
    if (!Number.isFinite(score)) return false;
    return score >= memeMinForPost(item?.plat);
  }

  function isEligibleViralRow(row) {
    return isRecentViralRow(row) && passesMemeGateRow(row);
  }

  function isEligibleViralItem(item) {
    return isRecentViralItem(item) && passesMemeGateItem(item);
  }

  window.passesMemeGateItem = passesMemeGateItem;

  function viralMaxAgeMs(platform) {
    return platform === 'tt' ? VIRAL_FEED_MAX_AGE_MS_TT : VIRAL_FEED_MAX_AGE_MS_X;
  }

  /** Recency = platform posted_at only — never first_seen_at (re-ingest would bypass age). */
  function isRecentViralRow(row) {
    const ms = parsePostedAt(row?.posted_at);
    if (ms == null) return false;
    return ms >= Date.now() - viralMaxAgeMs(row?.platform);
  }

  function isRecentViralItem(item) {
    const ms = parsePostedAt(item?.postedAt);
    if (ms == null) return false;
    return ms >= Date.now() - viralMaxAgeMs(item?.plat);
  }

  window.isRecentViralItem = isRecentViralItem;

  async function fetchViralPosts(opts = {}) {
    const url = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    const postedCutoff = Date.now() - Math.min(VIRAL_FEED_MAX_AGE_MS_X, VIRAL_FEED_MAX_AGE_MS_TT);
    const limit = opts.limit ?? VIRAL_FEED_SYNC_LIMIT;
    const fetchLimit = Math.min(Math.max(limit * 5, limit), 150);
    const select = opts.boot ? VIRAL_POST_BOOT_SELECT : VIRAL_POST_LIST_SELECT;
    const qs =
      `${select}&` +
      `views=gte.${MIN_INGEST_VIEWS}` +
      '&platform=in.(x,tt)' +
      '&tracking_status=eq.active' +
      `&posted_at=gte.${postedCutoff}` +
      '&order=posted_at.desc.nullslast,first_seen_at.desc' +
      `&limit=${fetchLimit}`;
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/narrative_posts?${qs}`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: 'application/json',
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`viral posts HTTP ${r.status}${body ? `: ${body.slice(0, 120)}` : ''}`);
    }
    const rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  }

  function pseed(str) {
    let x = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i += 1) x = (x * 31 + s.charCodeAt(i)) >>> 0;
    return x;
  }

  function sortViralStreamItems(items) {
    return items.slice().sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
  }

  function rowsToViralItems(rows, max = VIRAL_FEED_SYNC_LIMIT) {
    return sortViralStreamItems(
      (rows || [])
        .filter(p => postViewsFromRow(p) >= MIN_INGEST_VIEWS)
        .filter(isEligibleViralRow)
        .map(mapViralStreamItem)
        .filter(isEligibleViralItem),
    ).slice(0, max);
  }

  function saveViralFeedCache(items) {
    try {
      const list = (items || window.VIRAL_STREAM || []).filter(isEligibleViralItem).slice(0, VIRAL_FEED_BOOT_LIMIT);
      if (!list.length) return;
      sessionStorage.setItem(VIRAL_CACHE_KEY, JSON.stringify({ at: Date.now(), items: list }));
    } catch (_) { /* private mode / quota */ }
  }

  function restoreViralFeedCache() {
    try {
      const raw = sessionStorage.getItem(VIRAL_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.items?.length || Date.now() - parsed.at > VIRAL_CACHE_MAX_AGE_MS) return null;
      return sortViralStreamItems(parsed.items.filter(isEligibleViralItem));
    } catch (_) {
      return null;
    }
  }

  function bootstrapViralFeed(items) {
    const recent = sortViralStreamItems((items || []).filter(isEligibleViralItem));
    window.VIRAL_STREAM = recent;
    window._viralStreamReady = true;
    recent.forEach(i => { if (i?.postId) knownViralPostIds.add(i.postId); });
    if (typeof window.markViralInventorySeen === 'function') {
      window.markViralInventorySeen(recent);
    }

    if (typeof window.renderViralStream === 'function') {
      window.renderViralStream({ full: true });
    }
    if (typeof window.updateViralFeedStatus === 'function') {
      window.updateViralFeedStatus();
    }
    saveViralFeedCache(recent);
  }

  /** Merge API rows without slide-in — used for refresh backfill and metric patches. */
  function mergeViralFeedSilently(items, opts = {}) {
    const announce = !!opts.announce;
    let list = sortViralStreamItems((window.VIRAL_STREAM || []).filter(isEligibleViralItem));
    const byId = new Map(list.map(p => [p.postId, p]));
    let added = 0;

    for (const item of items || []) {
      if (!item?.postId || !isEligibleViralItem(item)) continue;
      const prev = byId.get(item.postId);
      if (prev) {
        const merged = mergeViralMetrics(prev, item);
        byId.set(item.postId, merged);
        if (typeof window.patchViralPostCard === 'function') {
          window.patchViralPostCard(item.postId, merged.rawViews, merged);
        }
        continue;
      }
      knownViralPostIds.add(item.postId);
      if (announce && shouldAnnounceViralPost(item)) {
        list.unshift(item);
        byId.set(item.postId, item);
        added += 1;
        if (typeof window.announceViralPost === 'function') {
          window.announceViralPost(item);
        } else if (typeof window.prependViralPostCard === 'function') {
          window.prependViralPostCard(item);
        }
      } else {
        byId.set(item.postId, item);
      }
    }

    list = sortViralStreamItems([...byId.values()]).slice(0, VIRAL_FEED_SYNC_LIMIT);
    window.VIRAL_STREAM = list;
    window._viralStreamReady = true;
    if (typeof window.trimViralStreamDOM === 'function') window.trimViralStreamDOM(24);
    if (typeof window.updateViralFeedStatus === 'function') window.updateViralFeedStatus();
    return added;
  }

  let viralBackfillPromise = null;
  function scheduleViralBackfill() {
    if (viralBackfillPromise) return viralBackfillPromise;
    viralBackfillPromise = fetchViralPosts({ limit: VIRAL_FEED_SYNC_LIMIT })
      .then(rows => {
        const items = rowsToViralItems(rows, VIRAL_FEED_SYNC_LIMIT);
        mergeViralFeedSilently(items, { announce: false });
        saveViralFeedCache(window.VIRAL_STREAM);
        if (typeof window.renderViralStream === 'function') {
          window.renderViralStream({ full: true });
        }
        return items.length;
      })
      .catch(e => {
        console.warn('[live] viral backfill:', e.message);
        return 0;
      });
    return viralBackfillPromise;
  }

  function setViralStream(items, opts = {}) {
    window.VIRAL_STREAM = sortViralStreamItems(items);
    window._viralStreamReady = true;
    items.forEach(i => { if (i?.postId) knownViralPostIds.add(i.postId); });
    if (opts.silent) return;
    if (typeof window.renderViralStream === 'function') {
      window.renderViralStream({ full: opts.full !== false });
    }
  }

  function mergeViralMetrics(prev, next) {
    const merged = { ...prev, ...next };
    for (const key of ['rawViews', 'replies', 'quotes', 'retweets', 'likes']) {
      const p = Number(prev?.[key]) || 0;
      const n = Number(next?.[key]);
      if (!Number.isFinite(n) || n < p) merged[key] = p;
      else merged[key] = n;
    }
    if (next?.txt) merged.txt = next.txt;
    if (next?.mediaUrl) merged.mediaUrl = next.mediaUrl;
    if (next?.firstSeenAt != null) merged.firstSeenAt = next.firstSeenAt;
    return merged;
  }

  function upsertViralStreamItem(item, opts = {}) {
    if (!item?.postId) return;
    if (!isEligibleViralItem(item)) {
      removeViralStreamPost(item.postId);
      knownViralPostIds.add(item.postId);
      return;
    }
    const list = window.VIRAL_STREAM || [];
    const idx = list.findIndex(x => x.postId === item.postId);
    const isNewToList = idx < 0;
    const isNewToSession = !knownViralPostIds.has(item.postId);

    if (isNewToList) {
      knownViralPostIds.add(item.postId);
      if (!shouldAnnounceViralPost(item)) return;

      list.unshift(item);
      while (list.length > 80) list.pop();
      window.VIRAL_STREAM = sortViralStreamItems(list);
      window._viralStreamReady = true;
      if (opts.flash !== false && typeof window.announceViralPost === 'function') {
        window.announceViralPost(item);
      } else if (typeof window.prependViralPostCard === 'function') {
        window.prependViralPostCard(item);
      }
      return;
    }

    const prev = list[idx];
    const merged = mergeViralMetrics(prev, item);
    list[idx] = merged;
    window.VIRAL_STREAM = list;
    knownViralPostIds.add(item.postId);

    if (typeof window.patchViralPostCard === 'function') {
      window.patchViralPostCard(item.postId, merged.rawViews, merged);
    }
  }

  function removeViralStreamPost(postId) {
    if (!postId || !window.VIRAL_STREAM) return;
    window.VIRAL_STREAM = window.VIRAL_STREAM.filter(x => x.postId !== postId);
    knownViralPostIds.delete(postId);
    if (typeof window.unmarkViralAnnounced === 'function') window.unmarkViralAnnounced(postId);
    if (typeof window.removeViralPostCard === 'function') {
      window.removeViralPostCard(postId);
    } else if (typeof window.renderViralStream === 'function') {
      window.renderViralStream({ full: true });
    }
  }

  let viralPostFlushTimer = null;
  const viralPostPending = new Map();

  function queueViralPostUpdate(item) {
    viralPostPending.set(item.postId, item);
    if (viralPostFlushTimer) return;
    viralPostFlushTimer = setTimeout(async () => {
      viralPostFlushTimer = null;
      const pending = [...viralPostPending.values()];
      viralPostPending.clear();
      for (const it of pending) {
        try {
          const full = await fetchPostRow(it.postId);
          const fresh = full ? mapViralStreamItem(full) : it;
          upsertViralStreamItem(fresh, { patchOnly: true });
        } catch (e) {
          console.warn('[live] viral patch fetch:', e.message);
          upsertViralStreamItem(it, { patchOnly: true });
        }
      }
    }, 600);
  }

  async function loadViralStream(opts = {}) {
    if (!window.InsidorConfig?.isLayer3?.()) return 0;
    try {
      const boot = !window._viralStreamHydrated;
      const rows = await fetchViralPosts({
        boot: boot || !!opts.fast,
        limit: boot ? VIRAL_FEED_BOOT_LIMIT : VIRAL_FEED_SYNC_LIMIT,
      });
      const items = rowsToViralItems(rows, boot ? VIRAL_FEED_BOOT_LIMIT : VIRAL_FEED_SYNC_LIMIT);

      if (!window._viralStreamReady) {
        bootstrapViralFeed(items);
        console.log(
          `[live] VIRAL_STREAM boot = ${items.length} posts ` +
          `(meme≥${MEME_MIN_X} x / ${MEME_MIN_TT} tt)`,
        );
      } else {
        const added = mergeViralFeedSilently(items, { announce: !boot && !opts.silent });
        if (added) console.log(`[live] viral sync — ${added} new posts`);
        else saveViralFeedCache(window.VIRAL_STREAM);
      }

      if (boot) {
        window._viralStreamHydrated = true;
        scheduleViralBackfill();
      }
      return (window.VIRAL_STREAM || []).length;
    } catch (e) {
      console.warn('[live] loadViralStream:', e.message);
      window._viralStreamReady = true;
      if (typeof window.renderViralStream === 'function') {
        window.renderViralStream({ full: true });
      }
      return 0;
    }
  }

  async function loadPipelineNarratives() {
    if (typeof window.NARRATIVES_ALL === 'undefined') return 0;
    try {
      const rows = await fetchPipelineNarrativeRows();
      const mapped = rows.map(mapNarrativeRow);
      initNarrPostTimes(mapped);
      mapped.forEach(normalizeNarrativeMetrics);
      window.NARRATIVES_ALL.length = 0;
      mapped.forEach(n => window.NARRATIVES_ALL.push(n));
      mapped.forEach(n => knownPipelineIds.add(n.id));
      console.log(`[live] NARRATIVES_ALL = ${mapped.length} pipeline narratives`);
      return mapped.length;
    } catch (e) {
      console.warn('[live] loadPipelineNarratives:', e.message);
      return 0;
    }
  }

  function triggerNarrativeArrival(id) {
    if (typeof window.onNarrativeArrival === 'function') window.onNarrativeArrival(id);
    else {
      flashNarrativeRows(id);
      pulseLiveIndicator();
    }
  }

  function mergePipelineNarrative(mapped, opts = {}) {
    if (typeof window.NARRATIVES_ALL === 'undefined') return;
    const idx = window.NARRATIVES_ALL.findIndex(n => n.id === mapped.id);
    if (idx < 0) window.NARRATIVES_ALL.push(mapped);
    else Object.assign(window.NARRATIVES_ALL[idx], mapped);
    knownPipelineIds.add(mapped.id);
    if (opts.rerender && typeof window.renderNarratives === 'function') {
      /* pipeline list kept for internal use only */
    }
  }

  async function handlePipelineNarrativeChange(payload) {
    if (payload.eventType === 'DELETE') {
      if (typeof window.NARRATIVES_ALL !== 'undefined') {
        const idx = window.NARRATIVES_ALL.findIndex(n => n.id === payload.old?.id);
        if (idx >= 0) window.NARRATIVES_ALL.splice(idx, 1);
      }
      knownPipelineIds.delete(payload.old?.id);
      return;
    }
    const row = payload.new;
    if (!row?.id || row.source !== 'cluster') return;

    const existingPipe = window.NARRATIVES_ALL?.find(n => n.id === row.id);
    const existingCur = typeof NARRATIVES !== 'undefined' ? NARRATIVES.find(n => n.id === row.id) : null;

    if (payload.eventType === 'INSERT' || !existingPipe) {
      const full = await fetchNarrativeRow(row.id);
      if (!full) return;
      const mapped = mapNarrativeRow(full);
      mergePipelineNarrative(mapped, { rerender: true });
    } else {
      mergeScalarFields(existingPipe, row);
      normalizeNarrativeMetrics(existingPipe);
    }

    if (row.display_eligible) {
      const cur = typeof NARRATIVES !== 'undefined' ? NARRATIVES.find(n => n.id === row.id) : null;
      if (cur) {
        mergeScalarFields(cur, row);
        normalizeNarrativeMetrics(cur);
        rerenderNarrativesOnly({ patchId: row.id });
      }
    } else if (existingCur) {
      removeNarrative(row.id);
    }
  }

  async function handlePostChange(payload) {
    if (payload.eventType === 'DELETE') {
      removeViralStreamPost(payload.old?.id);
      return;
    }
    const row = payload.new;
    if (!row?.id) return;
    if (row.tracking_status === 'pruned') {
      removeViralStreamPost(row.id);
      return;
    }
    if (!['x', 'tt'].includes(row.platform)) return;

    let fullRow = row;
    if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT' || !row.text) {
      const fetched = await fetchPostRow(row.id);
      if (fetched) fullRow = fetched;
    }
    const views = postViewsFromRow(fullRow);
    if (views < MIN_INGEST_VIEWS) return;

    const item = mapViralStreamItem(fullRow);
    if (!isEligibleViralItem(item)) {
      removeViralStreamPost(row.id);
      knownViralPostIds.add(row.id);
      return;
    }

    if (payload.eventType === 'INSERT') {
      if (knownViralPostIds.has(row.id)) return;
      if (!shouldAnnounceViralPost(item)) {
        knownViralPostIds.add(row.id);
        return;
      }
      upsertViralStreamItem(item, { flash: true });
      return;
    }

    if (!knownViralPostIds.has(row.id)) {
      knownViralPostIds.add(row.id);
      if (shouldAnnounceViralPost(item)) {
        upsertViralStreamItem(item, { flash: true });
      }
      return;
    }

    queueViralPostUpdate(item);
  }

  async function fetchPostRow(id) {
    const url = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    const r = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/narrative_posts?${VIRAL_POST_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0] || null;
  }

  async function handleNarrativeChange(payload, opts = {}) {
    if (payload.eventType === 'DELETE') {
      removeNarrative(payload.old?.id);
      return;
    }

    const row = payload.new;
    if (!row?.id) return;

    const wasEligible = !!payload.old?.display_eligible;
    const nowEligible = !!row.display_eligible;

    if (!nowEligible) {
      if (!opts.fromPipeline) removeNarrative(row.id);
      return;
    }

    const existing = typeof NARRATIVES !== 'undefined' ? NARRATIVES.find(n => n.id === row.id) : null;
    const isArrival = shouldAnnounceNarrativeArrival()
      && ((payload.eventType === 'INSERT' && nowEligible) || (nowEligible && !wasEligible));
    const isNew = !existing;

    if (isNew || payload.eventType === 'INSERT') {
      const full = await fetchNarrativeRow(row.id);
      if (!full) return;
      const mapped = mapNarrativeRow(full);
      mergeNarrativeMapped(mapped, { arrivalAlert: isArrival });
      enrichNarrativeTokens([mapped]).then(hits => {
        if (hits) rerenderNarrativesOnly();
      }).catch(e => console.warn('[live] enrich on realtime insert:', e.message));
      if (isArrival) triggerNarrativeArrival(row.id);
      else if (isNew) renderNarratives();
    } else {
      mergeScalarFields(existing, row);
      normalizeNarrativeMetrics(existing);
      if (isArrival) triggerNarrativeArrival(row.id);
      else rerenderNarrativesOnly({ patchId: row.id });
    }

    setNarrativesLive(NARRATIVES.length);
  }

  function stopFallbackPoll() {
    if (!fallbackPollTimer) return;
    clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }

  function startFallbackPoll() {
    if (fallbackPollTimer) return;
    fallbackPollTimer = setInterval(() => {
      if (realtimeConnected) return;
      syncNarrativesFallback().catch(e => console.warn('[live] fallback poll:', e.message));
    }, NARR_REALTIME_FALLBACK_MS);
    console.log(`[live] Realtime fallback poll every ${NARR_REALTIME_FALLBACK_MS / 1000}s`);
  }

  function updateRealtimeStatus(status) {
    const sim = document.getElementById('narrSimTag');
    if (!sim || !window._narrativesLive) return;
    sim.title = realtimeConnected
      ? 'Supabase Realtime connected'
      : `Realtime ${status} — 60s poll fallback active`;
  }

  function renderScoringPausedBanner(state) {
    const banner = document.getElementById('scoringPausedBanner');
    const textEl = document.getElementById('scoringPausedText');
    if (!banner) return;
    const paused = !!state?.scoring_paused;
    banner.hidden = !paused;
    window._scoringPaused = paused;
    if (!paused) return;
    const reason = state?.pause_reason || 'anthropic_paused';
    const spent = state?.anthropic_spent_usd;
    const budget = state?.anthropic_budget_usd;
    let msg = 'Anthropic budget exhausted — new meme-scored posts will not appear until scoring resumes.';
    if (reason === 'anthropic_credits') {
      msg = 'Anthropic account credits exhausted — top up billing to resume meme scoring.';
    } else if (spent != null && budget != null) {
      msg = `Daily scoring budget reached ($${Number(spent).toFixed(2)} / $${Number(budget).toFixed(2)}). Feed will not refresh with new scored posts until UTC midnight or budget is raised.`;
    }
    if (textEl) textEl.textContent = msg;
  }

  async function fetchPipelineState() {
    const url = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    const r = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/worker_pipeline_state?id=eq.1&select=*`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0] || null;
  }

  async function refreshPipelineState() {
    if (!window.InsidorConfig?.isLayer3?.()) return;
    try {
      const state = await fetchPipelineState();
      if (state) renderScoringPausedBanner(state);
    } catch (e) {
      console.warn('[live] pipeline state:', e.message);
    }
  }

  function startPipelineStatePoll() {
    if (pipelineStatePollTimer) return;
    refreshPipelineState().catch(() => {});
    pipelineStatePollTimer = setInterval(() => {
      refreshPipelineState().catch(() => {});
    }, PIPELINE_STATE_POLL_MS);
  }

  function startViralPoll() {
    if (viralPollTimer) return;
    viralPollTimer = setInterval(() => {
      loadViralStream().catch(e => console.warn('[live] viral poll:', e.message));
    }, VIRAL_STREAM_POLL_MS);
  }

  function startNarrativesRealtime() {
    if (!window.InsidorConfig?.isLayer3?.()) return;
    if (!window.supabase?.createClient) {
      console.warn('[live] @supabase/supabase-js missing — using poll fallback only');
      startFallbackPoll();
      startViralPoll();
      startPipelineStatePoll();
      return;
    }

    sbClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    });

    sbClient
      .channel('worker-pipeline-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'worker_pipeline_state', filter: 'id=eq.1' },
        (payload) => {
          renderScoringPausedBanner(payload.new || payload.old);
        },
      )
      .subscribe();

    narrChannel = sbClient
      .channel('narratives-display-eligible')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'narratives',
          filter: 'display_eligible=eq.true',
        },
        (payload) => {
          handleNarrativeChange(payload).catch(e => {
            console.warn('[live] realtime handler:', e.message);
          });
        },
      )
      .subscribe((status) => {
        const prev = realtimeConnected;
        realtimeConnected = status === 'SUBSCRIBED';
        updateRealtimeStatus(status);

        if (realtimeConnected) {
          stopFallbackPoll();
          startPipelineStatePoll();
          if (!prev) console.log('[live] Supabase Realtime connected (display_eligible narratives)');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (prev) console.warn('[live] Realtime disconnected:', status);
          startFallbackPoll();
        }
      });

    pipelineChannel = sbClient
      .channel('narratives-pipeline')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'narratives',
          filter: 'source=eq.cluster',
        },
        (payload) => {
          handlePipelineNarrativeChange(payload).catch(e => {
            console.warn('[live] pipeline realtime:', e.message);
          });
        },
      )
      .subscribe();

    postsChannel = sbClient
      .channel('narrative-posts-firehose')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'narrative_posts',
        },
        (payload) => {
          handlePostChange(payload).catch(e => {
            console.warn('[live] post realtime:', e.message);
          });
        },
      )
      .subscribe(() => {
        startViralPoll();
      });
  }

  async function syncNarrativesFallback() {
    if (typeof NARRATIVES === 'undefined') return false;
    const rows = await fetchNarrativeRows();
    if (!rows.length) return false;

    const incomingIds = new Set(rows.map(r => r.id));
    for (let i = NARRATIVES.length - 1; i >= 0; i -= 1) {
      if (!incomingIds.has(NARRATIVES[i].id)) NARRATIVES.splice(i, 1);
    }

    let added = 0;
    for (const row of rows) {
      const mapped = mapNarrativeRow(row);
      const existing = NARRATIVES.find(n => n.id === mapped.id);
      if (!existing) {
        mergeNarrativeMapped(mapped);
        added += 1;
      } else {
        mergeScalarFields(existing, row);
        if (row.narrative_posts) {
          existing.posts = (row.narrative_posts || [])
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map(mapPostRow);
        }
        if (row.narrative_tickers) existing.tokens = row.narrative_tickers.map(mapTickerRow);
        normalizeNarrativeMetrics(existing);
      }
    }

    initNarrPostTimes(NARRATIVES);
    NARRATIVES.forEach(normalizeNarrativeMetrics);
    setNarrativesLive(NARRATIVES.length);
    await loadPipelineNarratives();
    await loadViralStream();
    rerenderNarrativesOnly();
    if (added) console.log(`[live] fallback sync — ${added} new eligible narratives`);
    return true;
  }

  /** Layer 3 — load NARRATIVES from Supabase; fall back to inline mock on failure. */
  async function loadNarratives(opts = {}) {
    if (!window.InsidorConfig?.isLayer3?.()) return false;
    if (typeof NARRATIVES === 'undefined') {
      return setNarrativesFallback('NARRATIVES array not defined — check script load order');
    }

    const url = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      return setNarrativesFallback(
        'SUPABASE_URL or SUPABASE_ANON_KEY missing — set both in site/config.js (anon key only, never service key)',
      );
    }

    try {
      const rows = await fetchNarrativeRows({ light: opts.lightFetch !== false });
      if (!rows.length && !opts.allowEmpty) {
        return setNarrativesFallback(
          'Supabase returned 0 display_eligible narratives — run seed or check display_eligible / RLS',
        );
      }

      const mapped = rows.map(mapNarrativeRow);
      initNarrPostTimes(mapped);
      mapped.forEach(normalizeNarrativeMetrics);
      NARRATIVES.length = 0;
      mapped.forEach(n => NARRATIVES.push(n));
      mapped.forEach(n => knownEligibleIds.add(n.id));
      console.log(`[live] NARRATIVES = ${NARRATIVES.length} from Supabase`);
      setNarrativesLive(NARRATIVES.length);
      rerenderNarrativesOnly();
      markPageLiveReady();
      if (!opts.skipRealtime) startNarrativesRealtime();

      const runEnrich = async () => {
        const lookupHits = await enrichNarrativeTokens(mapped);
        console.log(`[live] token enrich — ${lookupHits} on-chain`);
        rerenderNarrativesOnly();
      };
      const runPipeline = () => loadPipelineNarratives().catch(e => {
        console.warn('[live] loadPipelineNarratives:', e.message);
      });

      if (opts.deferEnrich) {
        runEnrich().catch(e => console.warn('[live] enrich:', e.message));
        runPipeline();
      } else {
        await runEnrich();
        await runPipeline();
      }

      if (!opts.skipViral) {
        await loadViralStream();
      }
      if (typeof window.rebuildStreamFromNarratives === 'function') {
        window.rebuildStreamFromNarratives();
      }
      return true;
    } catch (e) {
      return setNarrativesFallback(e.message || String(e));
    }
  }

  const enrichInflight = new Map();

  /** Layer 2 — safety + holders from /api/* (on demand only). */
  async function lazyEnrich(mint) {
    if (!mint || typeof TOKENS === 'undefined') return;
    const t = TOKENS.find(x => x.ca === mint);
    if (!t) return;
    if (t._enrichedAt && Date.now() - t._enrichedAt < 300000) return;
    if (enrichInflight.has(mint)) return enrichInflight.get(mint);

    const job = (async () => {
      try {
        const q = encodeURIComponent(mint);
        const [safety, holders] = await Promise.all([
          fetch(`/api/safety?mint=${q}`).then(r => r.json()).catch(() => null),
          fetch(`/api/holders?mint=${q}`).then(r => r.json()).catch(() => null),
        ]);

        if (safety && !safety.error) {
          if (safety.mintRevoked != null) t.mintRevoked = safety.mintRevoked;
          if (safety.freezeRevoked != null) t.freezeRevoked = safety.freezeRevoked;
          if (safety.lpBurned != null) t.lpBurned = safety.lpBurned;
          if (safety.top10 != null) t.top10 = safety.top10;
          if (safety.riskLabel != null) t.riskLabel = safety.riskLabel;
          if (Array.isArray(safety.risks)) t.risks = safety.risks;
        }
        if (holders && holders.holders != null) t.holders = holders.holders;
        if (holders && holders.top10Pct != null) t.top10 = holders.top10Pct;

        t._enrichedAt = Date.now();
        rerender();
        if (typeof refreshTokenEnrichedUI === 'function') refreshTokenEnrichedUI(t);
      } catch (e) {
        console.warn('[live] lazyEnrich:', e.message);
      } finally {
        enrichInflight.delete(mint);
      }
    })();

    enrichInflight.set(mint, job);
    return job;
  }

  async function fetchNarrativeById(id) {
    if (!id) return null;
    if (typeof NARRATIVES !== 'undefined') {
      const hit = NARRATIVES.find(n => n.id === id);
      if (hit) return hit;
    }
    try {
      const row = await fetchNarrativeRow(id);
      if (!row) return null;
      const mapped = mapNarrativeRow(row);
      initNarrPostTimes([mapped]);
      normalizeNarrativeMetrics(mapped);
      if (mapped.displayEligible && typeof NARRATIVES !== 'undefined') {
        const idx = NARRATIVES.findIndex(n => n.id === mapped.id);
        if (idx < 0) NARRATIVES.push(mapped);
        else Object.assign(NARRATIVES[idx], mapped);
      }
      return mapped;
    } catch (e) {
      console.warn('[live] fetchNarrativeById:', e.message);
      return null;
    }
  }

  window.InsidorLive = {
    refresh, discover, hydrate, toToken, fastBoot, lazyEnrich, fetchSolPrice,
    loadNarratives, loadViralStream, loadPipelineNarratives, linkNarrativesToTokens,
    enrichNarrativeTokens, materializeAllNarrativeTokens, fetchNarrativeById,
    upsertTokenFromLookup, searchAndMergeTokens, fetchExternalTokens, resolveTokenPair,
    setNarrativesFallback, setNarrativesLive, startNarrativesRealtime, syncNarrativesFallback,
    flashNarrativeRows, pulseLiveIndicator, MIN_INGEST_VIEWS, CFG,
    get mints() { return [...discovered]; },
    get solPrice() { return solPrice; },
    get realtimeConnected() { return realtimeConnected; },
  };

  const boot = async () => {
    try {
      markPageLiveAt();
      const l3 = window.InsidorConfig?.isLayer3?.();
      if (l3) {
        const cached = restoreViralFeedCache();
        if (cached?.length) {
          bootstrapViralFeed(cached);
          console.log(`[live] VIRAL_STREAM cache = ${cached.length} posts (instant)`);
        }
        loadViralStream().catch(e => console.warn('[live] viral boot:', e.message));
        await Promise.all([
          loadNarratives({ skipViral: true, deferEnrich: true, lightFetch: true }),
          fetchSolPrice(),
          fastBoot(),
        ]);
      } else {
        await Promise.all([fetchSolPrice(), loadNarratives(), fastBoot()]);
      }
      linkNarrativesToTokens();
      materializeAllNarrativeTokens();
      if (typeof renderNarratives === 'function') renderNarratives();
      if (typeof renderTrending === 'function') renderTrending();
      if (typeof window.rebuildStreamFromNarratives === 'function') window.rebuildStreamFromNarratives();
      if (typeof renderStream === 'function') renderStream();
      expandDiscover();
      if (typeof syncNarrSoundToggle === 'function') syncNarrSoundToggle();
      setInterval(refresh, CFG.REFRESH_MS);
    } catch (e) {
      console.error('[live] boot failed:', e.message || e);
      window._narrativesReady = true;
      if (typeof renderTrending === 'function') renderTrending();
      if (typeof renderNarratives === 'function') renderNarratives();
      if (typeof renderStream === 'function') renderStream();
      if (typeof renderTokens === 'function') renderTokens();
    }
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', boot)
    : boot();
})();
