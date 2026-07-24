/* ============================================================================
   Insidor — tokenpage.js
   Makes the token detail page real.

   Replaces:
     - TradingView widget (which mapped memecoins to BINANCE proxy symbols —
       i.e. the chart was NOT the coin you clicked) with the DexScreener embed
       for the token's actual Solana pair. Keyless.
     - #exec's 700ms fake confirm with a real "you receive" calculation.

   Load AFTER live.js:
       <script src="tokenpage.js"></script>
   ========================================================================== */
(function () {
  'use strict';

  const SOL_MINT = 'So11111111111111111111111111111111111111112';

  const CFG = {
    // Jupiter quotes + swap only on Layer 3 deploy (see site/config.js).
    USE_JUPITER: typeof window !== 'undefined' && window.InsidorConfig?.isLayer3?.(),
    QUOTE_PATH: '/api/quote',
    DEFAULT_SLIPPAGE_BPS: 100,   // 1%
  };

  // ------------------------------------------------------------------
  // 1. REAL CHART — DexScreener embed for the token's actual pair
  // ------------------------------------------------------------------
  function pairAddressOf(t) {
    if (t.pairAddress) return t.pairAddress;
    const m = (t.dex || '').match(/dexscreener\.com\/solana\/([A-Za-z0-9]+)/);
    const id = m ? m[1] : null;
    // Embed needs the pool address — token mint URLs resolve to the wrong (often USDC) pair.
    if (id && t.ca && id === t.ca) return null;
    return id;
  }

  function chartURL(t) {
    const pair = pairAddressOf(t);
    if (!pair) return null;
    const q = new URLSearchParams({
      embed: '1',
      theme: 'dark',
      trades: '0',
      info: '0',
      chartLeftToolbar: '0',
      chartTheme: 'dark',
      chartType: 'usd',
      interval: '5',
    });
    return `https://dexscreener.com/solana/${pair}?${q}`;
  }

  function mountChart(el, t, retried) {
    if (!el) return;
    const url = chartURL(t);
    if (!url) {
      if (retried || !window.InsidorLive?.resolveTokenPair) {
        el.innerHTML = '<div class="chart-empty">No live SOL pair for this token yet</div>';
        return;
      }
      el.innerHTML = '<div class="chart-empty">Resolving live SOL pair…</div>';
      InsidorLive.resolveTokenPair(t)
        .then(() => mountChart(el, t, true))
        .catch(() => {
          el.innerHTML = '<div class="chart-empty">No live SOL pair for this token yet</div>';
        });
      return;
    }
    el.innerHTML = '';
    const f = document.createElement('iframe');
    f.src = url;
    f.style.cssText = 'width:100%;height:100%;min-height:420px;border:0;display:block;';
    f.setAttribute('loading', 'lazy');
    f.setAttribute('title', `${t.sym} chart`);
    el.appendChild(f);
  }

  // ------------------------------------------------------------------
  // 2. QUOTES
  // ------------------------------------------------------------------

  function estimateQuote(t, side, amountIn, solUsd) {
    const px = t.price || 0;
    if (!px || !amountIn) return null;

    if (side === 'buy') {
      const usdIn = amountIn * (solUsd || 0);
      return {
        outAmount: usdIn / px,
        outSymbol: t.sym,
        usdValue: usdIn,
        priceImpactPct: null,
        source: 'estimate',
      };
    }
    const usdIn = amountIn * px;
    return {
      outAmount: solUsd ? usdIn / solUsd : 0,
      outSymbol: 'SOL',
      usdValue: usdIn,
      priceImpactPct: null,
      source: 'estimate',
    };
  }

  async function jupiterQuote(t, side, amountIn, solUsd, decimals = 6) {
    const inputMint  = side === 'buy' ? SOL_MINT : t.ca;
    const outputMint = side === 'buy' ? t.ca : SOL_MINT;
    const dec = side === 'buy' ? 9 : decimals;
    const amount = Math.floor(amountIn * 10 ** dec);
    if (!amount) return null;

    const qs = new URLSearchParams({
      inputMint, outputMint, amount: String(amount),
      slippageBps: String(CFG.DEFAULT_SLIPPAGE_BPS),
    });

    const r = await fetch(`${CFG.QUOTE_PATH}?${qs}`);
    if (!r.ok) throw new Error('quote HTTP ' + r.status);
    const q = await r.json();
    if (q.error) throw new Error(q.error);

    const outDec = side === 'buy' ? decimals : 9;
    const out = Number(q.outAmount) / 10 ** outDec;
    return {
      outAmount: out,
      outSymbol: side === 'buy' ? t.sym : 'SOL',
      usdValue: side === 'buy' ? amountIn * (solUsd || 0) : out * (solUsd || 0),
      priceImpactPct: q.priceImpactPct != null ? Number(q.priceImpactPct) * 100 : null,
      route: (q.routePlan || []).map(r => r.swapInfo?.label).filter(Boolean),
      raw: q,
      source: 'jupiter',
    };
  }

  async function getQuote(t, side, amountIn, solUsd, decimals) {
    if (CFG.USE_JUPITER) {
      try {
        const q = await jupiterQuote(t, side, amountIn, solUsd, decimals);
        if (q) return q;
      } catch (e) {
        console.warn('[tokenpage] jupiter quote failed, estimating:', e.message);
      }
    }
    return estimateQuote(t, side, amountIn, solUsd);
  }

  function fmtQuote(q) {
    if (!q) return { out: '—', usd: '—', impact: '—', note: '' };
    const out = q.outAmount >= 1
      ? q.outAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })
      : q.outAmount.toPrecision(4);
    return {
      out: `${out} ${q.outSymbol}`,
      usd: '$' + (q.usdValue || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      impact: q.priceImpactPct != null ? q.priceImpactPct.toFixed(2) + '%' : '—',
      note: q.source === 'estimate'
        ? 'price estimate — routed quote needs Jupiter'
        : 'live route via Jupiter',
      route: q.route || [],
    };
  }

  window.InsidorTokenPage = {
    CFG, chartURL, mountChart, getQuote, estimateQuote, jupiterQuote, fmtQuote,
    pairAddressOf, SOL_MINT,
  };
})();
