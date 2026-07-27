## 02. Live Feed — the coins lane, and Trending

**What it is**

A ranked terminal board answering two questions at once: what is moving right now, and where did it come from. The second half is what nobody else renders — every row carries a STORY column in the slot DexScreener and Pump.fun spend on a fake sparkline. Trending is the slower companion: a 24-hour survey of what you should know about, not a second copy of the board.

**How it looks**

Content column plus the 460px rail, rail gone below 1040px. Lane tabs, then a band strip, then the table. Nothing centred, nothing spacious.

The band strip is a segmented control (`.chips`, not `.trend-subs` — four bands plus counts plus a toggle need an active pill): **Fresh · Graduating · Live · From a Story**, each with a mono count. `Fresh 38 · 6 hidden` — the hidden count is rows the risk gates removed, and it is always stated. `From a Story 7 · 4 unverified`, with a cyan dot when that count moved in the last 60s. Beside it, **Show risky**, a loud switch, off by default; it relaxes a hard gate, so it does not live in a drawer. Route is `/feed?lane=coins&band=fresh` — lane and band both in the URL, so a trader can send a colleague exactly what they are looking at.

Four bands, never one list. A 3-minute $8k curve token and a $40M AMM token are not comparable quantities, and each band gets its own columns — four structural dashes per row across a whole band is a table admitting it was built for the wrong data.

| Band | Columns |
|---|---|
| Fresh (`curve_pct < 50`, age ≤ 6h) | # · COIN · STORY · AGE · PRICE · MCAP · CURVE · VOL · HLD · RISK · action |
| Graduating (`curve_pct ≥ 50`, not migrated) | same, CURVE promoted to slot 4 as the sort key, LIQ replacing MCAP |
| Live (migrated / has a pool) | # · COIN · STORY · PRICE · 5M · 1H · 24H · VOL 24H · LIQ · MCAP · HLD · AGE · RISK · action |
| From a Story | grouped by story, not by coin — below |

**#** is dim mono, not sortable: rank is the output of the sort. **COIN** is a 32px logo, symbol 13.5px/600, name muted beneath, socials in fixed order, lime NEW badge for 300s. **AGE** renders `4m` / `2h` / `3d`, computed at render, and goes full ink under 60 minutes — on a board selling earliness, age is a headline number, not chrome. **PRICE** is `$0.0000123` at 7dp below a cent, flashing lime/red for 850ms on change. **MCAP** is exact even at four minutes: pump supply is a fixed 1e9, so mcap = price × 1e9, no vendor involved. **CURVE** is a 44px cyan track with the percentage beneath, going lime above 80% so about-to-graduate is findable by peripheral vision. **VOL** is 5-minute on Fresh, 24-hour on Live; under five minutes old it shows volume since mint with the elapsed window as an 8px superscript (`$4.2K` over `3m`). **HLD** goes amber under 25 and renders `>5,000` when the account scan truncates, never a fabricated exact figure. **5M / 1H / 24H** are signed one-decimal `.chgpill`s; a window longer than the coin's age renders `—` with `title="coin is 41m old"` — never a `0.0%` pill, which reads as flat rather than undefined and is the most misleading render available here.

**STORY has six states.** CONFIRMED: 16px thumb, title at 12px, cyan `.lead-badge.sm` — cyan, not lime, because every earliness affordance in the app is cyan and lime means gain. MULTI: the same plus `· 1 of 3 coins`; a coin whose story has siblings says so wherever it appears. UNSURE: thumb at 60% behind a dashed ring, muted title, amber `UNVERIFIED`, no lead chip, no cyan. ADOPTED: amber `ADOPTED` plus the coin's true age, because the earliness claim is inverted there. MATCHING: `matching…` in dim mono with the existing pulse. NONE: the literal string `no story` in dim mono — no border, no chip, no box. On Fresh that is 85–95% of rows and any badge treatment turns the column into static.

The lead chip has **three branches, because negative lead time is common**: discovery latency is p50 ~12 minutes and a fast deployer mints four minutes after the post. Measured against `t_crypto = min(t_mint, t_ct)`: `+18m vs CT` in cyan at ≥ +2m, `same minute` in plain dim inside ±2m, `−8m vs CT` in amber below — we were late on that one, said plainly. Beside it, when a story is still unpicked by crypto Twitter, the `.timing-pill.timing-early` **Early** pill. That is the only earliness question a trader actually asks, and it is live rather than historical.

**From a Story is grouped by narrative — one row per story.** Three confirmed mints under one story is one row reading `See the 3 coins`, expanding in place to a sub-table ranked by match score, then earliest mint, then liquidity. Not three rows with three identical titles and three Buy buttons. The action is the settled coin-count function: **0 → Create Coin**, drawn as the existing `.tk.pend` row (dashed icon, `no coin yet`, `awaiting launch`, numerics `—`) — the head start while it is still spendable, which belongs here and not only in retrospect as a chip on a coin that already exists; **1 → Buy $TICKER**; **2+ → See the N coins**. The band adds a LEAD column and widens STORY at COIN's expense: here the story is the subject and the coin is the instrument. Clicking `4 unverified` reveals the abstained candidates inline under a dashed separator in the UNSURE treatment — labelled unverified, primary still Create, **no Buy rendered on those rows at all**. Abstain never means hide, and it never means Buy either.

On the three coin-subject bands the action is a cyan `Buy`, but it is navigation: it opens the coin page with the tradebox focused, where the quote is fresh and the fee is disclosed before any confirm. The floor is real — the Jupiter integrator fee has a 50 bps minimum, so 0.5% per trade is the cheapest number that can ever appear.

**RISK is a two-part chip, 62px, reusing `.risk-pill`:** worst discriminating signal left, fixed obtainability denominator right — `T10 78 · 4/9`, `H 11 · 4/9`, `NO SELL · 4/9`, `DEV ×7 · 5/9`. Nine signals exist, we check four, five are not obtainable: dev holding, sniper %, bundle % and insider % need first-slot analysis we are not building, and a missing chip reads as "fine." A lime `✓ 5/9` is unreachable until creator history has a verdict for that wallet; before then the chip reads `? 4/9`. A clean tick can never be manufactured by absence of data — that is the entire design of the cell. Hover opens a 260px popover listing all nine, the five unobtainable ones named as "not available at launch" rather than omitted.

**Fit budget.** Live's 14 columns need ~1750px with the rail, ~1290px without. On a 1440px laptop with the rail the table gets ~928px and renders **9 of 14 columns**, the container query dropping HLD → 24H → LIQ → VOL → AGE. Container query on the table's width, not the viewport — the rail vanishing at 1040px gives back 460px and a media query gets the direction backwards. Every numeric track has an explicit minimum (PRICE 78px, change pills 66px, MCAP/VOL/LIQ 72px) so the grid drops columns instead of squashing `$1.23M` into 35px. COIN, STORY, PRICE, MCAP, RISK and the action never drop; STORY surviving to the narrowest breakpoint is not negotiable, because without it this is DexScreener.

**How it works**

```
V5      = vol_buy_5m + vol_sell_5m
accel   = (V5 * 12) / max(V1h, 1)                1.0 = steady state
breadth = clamp(log1p(traders5) / log1p(50), 0, 1)
netBuy  = net_buyers_5m / max(traders5, 1)       Jupiter's own net-buyer count
org     = (organic_buy_5m + organic_sell_5m) / max(V5, 1)   only when age >= 10min

quality      = (0.30 + 0.70*org) * clamp(1 + 0.5*netBuy, .6, 1.5) * safetyMult
quality_cold =                    clamp(1 + 0.5*netBuy, .6, 1.5) * safetyMult
coreHeat     = log1p(V5) * breadth * min(accel, 6)^0.5 * quality
```

`CoinHeat_fresh = coreHeat / ((age_min+20)/20)^0.9` · `CoinHeat_live = coreHeat` · `CoinHeat_story = coreHeat × (0.5 + 0.5×narrative_heat) × (t_ct IS NULL ? 1.0 : 0.35)`. Graduating ignores heat and sorts by curve progress, which is the question that band exists to answer. The cold path is mandatory, not an edge case: Jupiter's organic score is unreliable under ten minutes — precisely our window — so `quality_cold` never reads it. The 0.35 CT-pickup factor is the thesis in the formula: the moment crypto Twitter finds a story, our edge is gone and the coin should fall off the board even while it is still climbing.

Four things stop a $1.8B token owning rank one. **Band partition** — it is in Live, structurally never in the same ordered list as a curve token. **Mcap and liquidity are not terms** anywhere; mcap is a display column and a gate. **Acceleration is self-normalised** — `V5×12 / V1h` compares a coin to its own last hour, so being big earns nothing. And the **Fresh age penalty** (1.87× at 20m, 3.48× at 60m, 7.94× at 3h) turns that band over completely in about forty minutes.

Story attachment does **not** multiply rank in the other three bands. It is a filter and a tiebreak only. If it multiplied, the incentive would be to game the matcher — and the matcher is the 0.97-precision-critical component. Keeping story off the multiplier keeps the attack surface off the correctness-critical path.

Hard gates hide a row unless Show risky is on: mint or freeze authority active, Live liquidity under $3,000, `sells_5m = 0 AND buys_5m > 30` (honeypot proxy), `mint_time IS NULL`, and top-10 concentration above **85% on Fresh / 60% on Live** — band-dependent, because a flat 60% gate empties Fresh on day one, when a three-minute-old token has nine buyers and is legitimately concentrated. Two facts decide whether the column works at all: the **bonding-curve PDA must be excluded** from top-N and holder count, or every pre-graduation token reads 80–95% concentrated; and RugCheck's authority fields must go tri-state, since the wired endpoint currently treats `mintAuthority == null` as revoked-and-safe, so an unreachable vendor passes every row. Null fails closed and increments the unknown count.

`safetyMult` multiplies down for concentration (>60% ×0.35, >40% ×0.70), a >25% top-1 holder (×0.50), under 25 holders (×0.60), the honeypot proxy (×0.20), creator history (two prior rugs ×0.30; 20+ mints with a sub-$15k median peak ×0.55), thin Live liquidity (×0.40), plus two cheap wash detectors — trade-size Gini under 0.25 over 30+ trades (×0.5), and >60% of trades at exactly 0.1/0.5/1.0 SOL (×0.6). Clamped to [0.15, 1.0]. Creator history is free: the PumpPortal socket already running as the earliness clock carries the creator wallet on every create event, so persisting it gives prior mints, median peak mcap and rug count (peak ≥ $30k, current ≤ 10% of peak, age ≥ 24h) after ~14 days at zero marginal cost.

**Cadence.** The rank commit is 20s, so the data behind it cannot be 5-minute grain — `accel`, the term doing the actual work, would update twelve times slower than the board claims. Poll Jupiter every 30s for the ~120 mints on any board (≈4 RPS batched on the $25/mo Developer tier) and roll *down* to 5-minute grain for 48h retention; off-board mints stay at 5 minutes. Holders move slowly and get their own 5-minute Postgres-cached refresh, cutting RPC volume ~15×. Staleness fires at 3× each feed's nominal interval — ~90s for prices.

Stability: `EPS_SWAP 0.08`, enter after 2 ticks, exit after 3, pin 90s, max 5 positions per tick, freeze-on-hover, new entrants above row 12 batched into a cyan `3 new` pill. Values update every tick from a `Map<mint, Row>`; only the ordering array is held. The escape hatch covers **movement, not just entry**: a coin clearing a hard V5 threshold skips the dwell, ignores MAX_MOVE for that tick and jumps to its true rank with a NEW badge and a one-tick lime flash. Otherwise a coin entering at 40 and deserving 1 takes 160 seconds — the core claim spent on anti-jitter.

**Trending** keeps its settled weights — `0.40·min(vol24h/mcap /3,1) + 0.25·min(txns24h/4800,1) + 0.20·min(max(chg24h,0)/85,1) + 0.15·min(max(chg1h,0)/55,1)`, × `safetyMult`, recomputed every 5 minutes. Eligibility: mcap ≥ $30k, liq ≥ $5k, vol24h ≥ $10k, **age ≥ 6h** — exactly where Fresh's ceiling ends, so no coin falls between the surfaces. Between 6 and 24 hours the 24h terms use since-mint quantities and the row carries a dim `partial windows` qualifier. The real boundary between the two surfaces is window length, not age: the board measures five minutes of flow inside a comparable band; Trending measures a day. Layout is `/trending`, no sub-tabs — Stories and Coins side by side at ≥1240px in a 1140px wrapper, stacking below that, eight rows each so both are visible at once instead of one being a scroll away. Coins header: `# | TOKEN | 24H | VOL | RISK | MCAP`, the TOKEN cell gaining a second line (10px cyan dot plus story title) on a confirmed match and omitting it otherwise. Not sortable — a sortable top-8 is a bad version of the board — with one interaction, a 24h/6h/1h selector re-scoping the change column.

**States**

| State | What the user sees |
|---|---|
| Default | 40 rows, 20s rank commit, values ticking live, reorders frozen while the pointer is in the table |
| Brand-new token, no market data | Pre-rank zone above row 1, max 5 rows, dashed top border, `·` in #, `··` in every numeric, a live `MINTED 8s AGO` chip. Selection among ~40 arrivals per 90s: story match by narrative heat, then creator median peak mcap, then arrival order, with a dim `and 38 more minted in the last 90s`. Unranked is not rank one |
| Zero trades at 90s | Dropped from the surface, not silently zero-ranked into row 40 |
| Can't-get vs not-yet vs pending | `—` dim = unobtainable; `—` dim with `title="coin is 41m old"` = window not elapsed; `··` = expected imminently. Never 0, never 0.0%, never a green tick |
| Unverified match | Dashed ring, muted title, amber `UNVERIFIED`, no lead chip. Click opens the evidence popover, not the story — navigating asserts a claim we have not established. The popover routes to the **coin** page; any story page reached from an unsure cell mounts with Create as primary and no Buy control of any kind |
| Story with no coin | `.tk.pend` row in From a Story: `no coin yet`, `awaiting launch`, numerics `—`, action `Create Coin` |
| Multi-coin story | One row, `See the 3 coins`, expanding to a ranked sub-table; siblings elsewhere read `· 1 of 3 coins` |
| Negative lead time | Amber `−8m vs CT`, plainly. Inside ±2m, `same minute` in dim, no colour |
| Stale pipeline | Per-feed stacked amber lines with live counters (`prices 4m 12s · Jupiter degraded`). Only the price feed dims PRICE and VOL; **Buy stays primary** — it is navigation, and the quote is refetched at the destination where `#quoteNote` reads `board prices were 4m stale — quote refreshed just now`. Safety past 30m dims the RISK chip with an age suffix: `T10 78 · 42m` |
| Show risky ON | Gated rows appear with a red chip naming the gate: `MINT AUTH` / `NO SELL` / `T10 91` / `LIQ $1.2K` |
| Wallet not connected | Buy renders fully live in cyan → coin page → tradebox with the Privy modal and `Connect wallet to trade`. Greying it out kills the connect funnel |
| Matcher abstaining | Dim line under the band strip: `matcher abstaining on 34% of candidates` — a corpus-staleness signal, not a failure, but visible rather than buried in ops |
| Matcher down | No verdict in 20 minutes → `matcher offline 22m` in amber replaces the pulse, which otherwise reads as activity rather than a dead component |
| Story withdrawn | Row flashes amber once and settles to `story withdrawn`, rather than silently reverting to `no story` |
| Band transition | A migrating coin flashes lime, animates out over 400ms, enters Live with a NEW badge. Not a rank move; the stability rules don't apply |
| Non-pumpfun launchpad | NULL `curve_pct`, so band is a CASE with an explicit else: Fresh while age ≤ 6h, Live once a pool exists. Never nowhere; CURVE shows a dim `DEX` badge |
| Empty band | `No coins under 50% curve right now.` / `Nothing approaching graduation.` / `No story-linked coins in the last 6 hours — the matcher abstains when it is not sure.` |
| Thin Trending | Only qualifiers, plus `only 6 coins cleared the floor in the last 24h.` Never padded to eight — a padded top-10 is the same lie as a hits-only track record |
| First run | One dismissible dim line per band: `From a Story: coins we traced back to a viral post before crypto found it.` First visit lands here — smallest, most explicable band, the only one whose rows carry a human reason to care |
| Loading | 12 skeleton rows sized to the active band's template so nothing jumps |

**What it needs**

The headline: **the coins lane has no table.** `narrative_tickers` is the only coin storage and its spine is `narrative_id`, so a coin with no story — 85–95% of this board — has nowhere to live. A missing entity, not a missing column.

New: **`coins`** keyed on `mint` (symbol, name, logo_url, decimals, creator_wallet, `mint_time timestamptz`, launchpad, curve_pct, migrated, pool_address, socials, first_trade_price, first_seen_at). `mint_time` replaces the stored `age_min` scalar, which is wrong the second after it is written; precedence is the PumpPortal create event, then `min(pairCreatedAt)` across *all* Solana pairs, NULL only if both are absent — the best-pair method reports 418 days for a token that is 647 days old. `band` is generated, not stored. **`coin_snapshots`**: there is no price column anywhere in the schema today and no coin time series at all, so every window and the whole formula are currently uncomputable — price_usd, mcap, liquidity, 5m/1h/24h buy and sell volume, buys/sells/buyers/sellers/**net_buyers**/traders, organic fields, holder_count, top1_pct, top10_pct, captured_at. **`coin_matches`**: match state has no home, since `canonical` and `first_deployed` are booleans and cannot express UNSURE — mint, narrative_id, match_state, relation, score, the five-channel evidence vector for the popover, matcher_version, `UNIQUE(mint, narrative_id)`. Lead time is computed at render, never stored. Log every confirmed and unsure row with its vector; that is the eval set growing itself.

Also new: **`narratives.promoted_at`**, set once forever, NULL for pre-migration narratives — which renders no lead chip and excludes them from From a Story rather than fabricating a time; **`narrative_tickers.source`** ('cashtag' | 'llm' | 'mint_in_post'), whose absence is the root of the $KANG defect where an LLM-invented ticker can become canonical; **`creator_history`**; **`coin_board_ticks`** (band, captured_at, mint, rank, heat, plus p95 heat per band for the presented-heat normalisation); and **`coin_safety`**, a Postgres RugCheck cache, because the current 300s in-memory cache is per-lambda and effectively always cold.

Two queries per band, not one: rows via a `LEFT JOIN LATERAL` collapsing to one match per mint (confirmed before unsure, then score) with a sibling count for the MULTI state, plus a `LEFT JOIN` to the latest snapshot so pre-trade coins survive; and a second aggregate for the gated-row count. Delta push via Supabase Broadcast keyed by mint — values apply immediately, positions on the tick.

Two things stay flagged as unverified. Whether excluding the curve PDA yields a top-10 distribution with real spread needs checking against 20 live pre-graduation tokens before the RISK column is designed around it. And the graduation threshold is SOL-denominated (~85 SOL) — read it from the deployed program once per deploy, never a hardcoded USD figure. Separately: whether the stories lane stays merged into Live Feed or becomes its own tab is still open with you; this is written merged.

**Build order**

1. **`coins`**, keyed on mint, backfilled from `narrative_tickers.mint_ca`. Nothing else is possible first.
2. **`mint_time`** from the create event with pair-minimum backfill; delete `if (!pair.pairCreatedAt) return 0;` at `lib/token-lookup.js:70` and fail closed instead.
3. **`coin_snapshots`** on the Jupiter Developer tier, 30s board polling rolled down to 5-minute grain.
4. **Fresh band only**, ranked by `CoinHeat_fresh` with `quality_cold`. No story column, no risk chip — a shippable terminal that validates the ranking first.
5. **Risk chip and safety multiplier** from the already-wired holders and safety endpoints, including the curve-PDA exclusion, the RugCheck tri-state fix and the Postgres cache. Without the exclusion the column is uniformly red.
6. **Graduating and Live**, with `curve_pct` from the PumpPortal trade stream's reserve fields — correct by construction; RPC reads only for stream-missed mints.
7. **`coin_matches` + `promoted_at` + `source`**, shipped with the day-one matcher fixes. Scope it honestly: 40+ lines across three files plus a migration and a backfill.
8. **The STORY column, all six states, and the story-grouped From a Story band.** This is the step that makes the product differentiated; everything before it is a competent DexScreener clone.
9. **First-trade capture** from the trade stream, written once and immutably — only then does Δ MINT ship. Until then Fresh shows VOL-since-mint with the elapsed-window superscript, honest at any grain.
10. **Trending** — existing mini-tables plus the story line, risk column and 6h floor. Deliberately last: a digest of untrustworthy data is worse than no digest.
11. **`creator_history`**, shipping dark and accumulating ~14 days, after which the DEV signal turns on and the lime tick becomes reachable.
12. **Realtime** — Broadcast, the five stability constants, freeze-on-hover, the new-entrant pill, the movement escape hatch. Polish over a board that must already be correct.
