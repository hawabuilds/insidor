# Token

Token detail page: DexScreener chart, Jupiter quotes, swap exec, trades/holders/safety panels.

**What breaks here:** Blank token view, wrong/missing chart, swap quotes or balance stale, trades/holders panels empty, exec button stays disabled.

**Tables (read-only via globals from `live.js`):** `narrative_tickers` (linked through `NARRATIVES` / `TOKENS`).

**APIs:** `/api/quote`, `/api/trades`, `/api/toptraders`, `/api/holders`, `/api/safety`, `/api/balance`, `/api/swap`; DexScreener embed (external).
