# Feed

Narratives table, trending panel, live viral rail, narrative modals, deploy-from-post flows.

**What breaks here:** Empty/frozen narratives list, viral rail stuck, sort chips or column sort wrong, post/narrative modals or “Create coin” actions dead.

**Tables (via `live.js` / `InsidorLive`, read-only):** `narratives`, `narrative_posts`, `narrative_tickers`. Realtime on `narratives` (`display_eligible`).

**APIs:** None in this folder — Supabase REST + Realtime are in `site/live.js`.
