## 04. The Coin page — chart, swap, trade

**What it is**

One coin, told honestly, and the only surface in Insidor where money moves. Chart, stats and swap box are table stakes — Axiom and Photon render all of it. The job only this page can do is prove this coin exists because of a story we caught first, say by how many minutes, and refuse to sell you anything on a claim we do not stand behind.

**How it looks**

#060607 page, max-width 1560: a wide main column beside a 356px right rail sticking 72px under the header.

Main column, top down. **Identity header**: 52px logo, `$FERRY` in Clash Display 27px, token name, a `new` chip under 10 minutes old, a `live` dot while page data is under 120s fresh, the mint as `4mZq…8xPq` that copies on click and flashes lime, socials; right-aligned `$0.000221` in mono 26px with the 24h change in lime `#9BF03C` or red `#FF5C6E`.

Then the **origin band** — the reason the page exists. Not a hero card: a ranked row in the terminal's own grammar, ~60px tall, hairline column headers, right-aligned mono, the whole row a button to the story.

| Cell | Shows |
|---|---|
| thumb, 42px | the post's media |
| story, flex | `@lasthorn · 2h ago` at 10px uppercase --dim; `Harbor horn goes viral in Bergen` in Clash Display 13.5px; the post text curly-quoted at 72 chars in mono 11.5px --muted |
| SPOTTED, 92px | `14:02` — a literal clock time. Relative-only is unfalsifiable; an absolute time is what a sceptic checks against the permalink |
| CRYPTO, 92px | `14:33`, or `—` when nobody in crypto has posted |
| LEAD, 108px | `+31m` mono 22px cyan, sub-label `EARLY VS CRYPTO`. Beneath it in mono 10.5px, the reader's *live* lead: `your lead now +18m` counting down, flipping amber to `crypto caught up 7m ago`, red past 30m. The big number is Insidor's record; the small one is where the reader actually stands |
| matched, 76px | a categorical chip `matched · image + name`, opening the evidence popover |

That popover is 320px: post media beside the token logo, chips `image ✓` `name ✓` `ticker ~` `mint-in-post —`, one line `Minted 4 minutes after the post — 14:04 vs 14:00`, footer `Matched by Insidor · Report a wrong match`. **Never a numeric score** — "73% match" beside a spend button makes the user do their own thresholding, which is what the abstain band exists to prevent.

Under the band, in the main column and not the rail, the **sibling strip**: `2 MORE COINS FROM THIS STORY`, rows of logo · $TICKER · mcap · age, the earliest tagged `earliest` in --dim and the deepest book tagged `deepest` in cyan. Two neutral facts, no verdict word. It renders at one or more confirmed siblings and lists confirmed ones only — an unsure candidate here would read as endorsed.

Then the **stat grid**: eight hairline-divided cells — `5m` `1h` `24h` (signed %) · `Mkt cap` · `Liquidity` · `24h vol` · `Holders` · `Age`. Prices from the DexScreener pair; Holders from Helius RPC, which needs no pair; Age from `coin_mints.minted_at`, ticking live as `0:47` under an hour.

Then the **chart card**, 468px: a 40px head with the mono price and a `DexScreener` tag over a 440px embed of the *pool* address — never the mint, which resolves to the wrong pair, usually USDC. Then tabs: `Trades` (default, 10s poll, your fills highlighted cyan, click a wallet to filter), `Top traders` (only when a ranked trader returns), `Holders`, `Info`.

Right rail: **position card** (only when you hold), **trade box**, **safety box**.

The position card leads with dollars — `$179.60` mono 22px, then `+$38.40 (+27.2%)`, never a bare percentage — then `Qty 231,402 · Avg paid $0.000174 · Now $0.000221`, then the sentence nobody else can print: `You bought 41 minutes before crypto traders did.` The negative ships in identical weight: `Crypto traders posted 12 minutes before you bought.`

The trade box: Buy/Sell toggle; amount field in mono 20px with presets `0.1 | 0.5 | 1 | 2 | MAX` (MAX = balance − 0.02 SOL for network fee, Token-2022 rent and retry headroom); a SOL⇄USD toggle defaulting to USD in Simple, SOL in Pro; a `YOU RECEIVE` panel reading `231,402.55 FERRY` at mono 19px over `$47.20 · 1 FERRY = $0.000204`; then five recap rows at one uniform 12px mono weight — `Min received 228,120 FERRY` · `Price impact 0.42%` (lime ≤1.5%, amber >1.5%, red >5%) · `Route dflow` · `Network + priority ~0.0009 SOL` · **`Insidor + Jupiter fee 0.60% · $0.28 ⓘ`**. All five come from the order response; nothing is a literal.

The fee row is the same colour, size and weight as its siblings — no badge, no box. The ⓘ opens: `Insidor fee 0.50% $0.24` / `Jupiter platform 0.10% $0.05` / `Total 0.60% $0.29` / `Jupiter keeps 20% of the Insidor fee.` / `0.50% is the minimum Jupiter permits on integrator fees — it is not a number we chose.` The confirm dialog repeats it uncollapsed before any signature. Ambient at equal weight plus pre-signature at full weight is disclosure without shouting.

Under the button, ordinary text rather than a red box: `If this goes to zero you lose $50. That happens most of the time.` A red box gets dismissed; a sentence gets read.

**How it works**

The page loads in one round trip: `tokens` left-joined to `coin_matches`, `narratives`, `story_clocks`, the top post and a `clock_health` row, ordered confirmed-first then score desc.

The numeral is `lead_time_min = t_crypto − promoted_at`, where `t_crypto = min(first matching mint, first crypto-Twitter post)`. `promoted_at` is written once at PROMOTE and never overwritten; it is NULL for every row predating the migration, NULL forces `earliness_eligible = false`, and those stories read `—` / `NOT MEASURABLE` forever. Backfilling it from `created_at` or `first_seen_at` would inflate every historical lead by roughly the pipeline's own latency — it would manufacture the number the product is sold on.

`FIRST` requires positive evidence of a live clock, not merely a null `t_crypto`: `gap_window = false`, a PumpPortal heartbeat inside 120s, a crypto poll inside 4 minutes. Otherwise LEAD reads `—` / `CLOCK DOWN` with a tooltip naming the blind sensor. Absent must never collapse into best-case.

Age uses `coin_mints.minted_at` — the same timestamp that produces `delta_minutes` in the band, so the two cannot contradict each other 150px apart. The fallback, `min(pairCreatedAt)` across all Solana pairs, carries a `pool age` micro-label, because a graduated pump.fun coin's pair timestamp is the graduation, not the mint. Missing returns null and renders `—`; unknown age must never present as brand new on a terminal that sells earliness.

The primary is a pure function of confirmed coin count on the matched story: 0 → Create, 1 → Buy, 2+ → Compare. **On an UNSURE match, Buy is not rendered at all** — not greyed, not gated, absent. The panel still quotes, the primary is cyan `Create the coin for this story`, and a 44px band under the origin band reads `The verified coin from this story is $FERRY →` when one exists. A coin with *no* story keeps a normal lime Buy: an unmatched coin carries no claim from us; an unsure one carries a claim we decline to monetise. Sell is never suppressed in any state.

Quotes: 250ms debounce → `POST /api/order` → Jupiter Swap V2, referral account and fee injected server-side from env, never from the client. TTL 20s, refresh every 15s while visible, suspended entirely while the confirm dialog is open — never re-quote under a finger. A refresh moving `outAmount` more than 1.0% against the user flashes amber and holds. `requestId` is single-use so every retry re-orders; the `trades` row is written at ORDERING with `request_id` unique, so the database enforces single submission across tabs. The displayed fee is frozen from the order that produced the signed transaction and re-asserted server-side against that requestId inside `/api/execute`; the actual charged fee is parsed post-fill into `fee_bps_charged`. Slippage defaults to Auto (Jupiter RTSE) under 30 minutes old — a fixed 1% on a live bonding curve reverts constantly, and every revert is a trust event.

Safety is four blocking checks on the **buy direction only**: mint authority active, freeze authority active, Token-2022 transfer fee or hook present, and no sell route (a reverse order call for ~1% of the intended out; buy route present with sell route absent is the honeypot signature, and worth more than the other three combined). Authorities come from Helius `getAccountInfo(mint, jsonParsed)` with three-valued logic — absent → `—`, null or the system address → revoked, pubkey → active. On pump.fun mints both are revoked by construction, so they collapse into one --dim line: `Mint & freeze authority — revoked by pump.fun on every coin (not a signal)`. Green ticks are reserved for checks that discriminate. Top-10 concentration is computed over circulating supply with the bonding-curve PDA, pool vault and burn address excluded; if the curve cannot be resolved the row reads `Top 10 holders — (bonding curve holds most of supply)` rather than a number that means nothing. Unknown never blocks, it discloses — and the block reason renders directly above the button, never in a side panel.

Selling is never blocked by a safety check; stranding a holder just moves the unfairness. A transfer-fee token discloses in amber in that same slot, and the fee is subtracted from `You receive` and added as a sixth recap row. `Take back what I put in` is solved against a real reverse order — binary-searched until net-of-fee proceeds meet cost basis, not `cost_basis / spot`, which is short by the fee and the impact — and labelled in the denomination it was computed in: `Take back my $141.20 (after fees)`. Below cost it stays visible and disabled: `Not enough value left to take back what you put in.` Hiding it hides a loss.

Cost basis never touches the browser's SOL price global: `/api/execute` captures SOL/USD server-side at submission into `sol_usd_at_trade`, and every PnL number derives from that column.

The band links to the story detail; whether stories keep a lane in Live feed or get their own tab is still open, and the link target is the same either way.

**States**

| State | What the user sees |
|---|---|
| Brand-new, no pair (0–60s) | Chart card reads `Pool not indexed yet` with a live `mint 0:34 ago` counter — not an error. Price-derived stats `—`, never `$0`; Holders and Age live. **The panel still quotes**: `No chart yet — routed on the bonding curve`. Once a pair exists but history is thin, the chart mounts under `First trades — 4 minutes of history` |
| No route either way | Panel disabled, primary reads `Watch for a route` |
| Unverified match | Amber band, kicker `POSSIBLE ORIGIN · UNVERIFIED`, numeral replaced by `Unverified match`, a line reading `We are not confident $KANG came from this story. Matched on ticker only.` + `Why? →`. No Buy; primary is Create; the verified sibling is promoted to a cyan band under the origin band |
| Match withdrawn (REJECTED) | `This coin was matched to Bergen Horn and the match has since been withdrawn.` No lead number, no sibling promotion; Buy behaves as unmatched |
| No story | 40px neutral bar: `No story matched — this coin is not linked to anything Insidor detected.` + `Search stories →`. No earliness claim; normal Buy. The default for a pasted CA, so it must read neutral, not broken |
| Negative lead | `−12m` in red, label flips to `LATE VS CRYPTO`, sub-line `crypto posted first`, plus a footer line `Insidor was late on 31% of the last 200 detections — see the record →` |
| Lead pending, clocks healthy | `FIRST` in cyan, `NOBODY IN CRYPTO HAS POSTED YET`. Best possible news; must read as such |
| Clock down or gap window | `—` / `CLOCK DOWN`, tooltip naming the blind sensor. Never counted as a win |
| Adopted coin | Cyan chrome, kicker `ADOPTED BY THIS STORY`, sub-label `coin is 604 days old` |
| Two confirmed stories | The **smaller** lead is the headline; the larger is reachable as `also matched to Bergen Horn (+31m) →`. Score measures confidence, not earliness, and must not pick the flattering number |
| Stale pipeline | Amber strip: `Live data paused — prices last updated 4m ago`, `live` dot greys, panel notes `Quotes still live (Jupiter) — page metrics are stale` |
| SOL price unavailable | Every dollar slot `—`, never `$0`. Fee falls back to `0.60% · 0.0026 SOL`, the amount field to SOL, the risk line to `you lose 0.22 SOL` |
| Decimals unknown | Panel holds in QUOTING until the mint account answers. A receive figure wrong by a power of ten is worse than a spinner |
| Checks pending (the common case) | `Checks pending — this coin is 47 seconds old.` **We do not block on unknown** — blocking every genuinely early buy deletes the product |
| Blocked (buy only) | Disabled with a red outline; the strip names it: `No sell route — we could not find a way to sell this` |
| Wallet not connected | Page fully readable and quoting; position card absent, button reads `Connect wallet to buy`. Amount and settings survive the Privy round trip |
| First run, no SOL | Three-step explainer replaces the panel body — but never over a block: it collapses to `We block buying on this coin — see why below` above a full-weight block strip, primary becomes ghost `Find a safer coin →`. Precedence: blocked, then unverified, then checks-pending, then no-route |
| Insufficient balance | Not disabled — cyan `Add 0.34 SOL`, opening the funding sheet with the shortfall prefilled |
| Back from funding, price moved | `When you left, $47.30 bought 231,402 FERRY. It now buys 96,110 (−58%).` at equal weight, `Buy anyway` / `Change amount`. Explicit tap past 5% drift; intents older than 30 minutes or for another mint are discarded |
| Trade failed, transaction exists | Slippage revert or on-chain failure: `Price moved more than your 1% limit. Nothing was spent except the network fee.` **with the signature and a Solscan link**, plus `Retry at 3%` (pre-computed) and `Retry same`. Expired blockhash reads `did not land in time`; retry bumps priority one tier, and from Turbo it retries at Turbo and says so |
| Trade failed, no signature | `We lost contact before confirming. Check your balance before retrying.` + `Check status`. **Never auto-retry** — that is how a user gets filled twice. With a signature but no status: `Still confirming (0:47)`, polling 90s |
| Declined in wallet | `You cancelled. Nothing was sent.` in --muted, not red. Declining is a normal outcome, not an error |
| Filled | `Filled — 231,402 $FERRY`, sub `1.00 SOL · avg $0.000204 · you were 41 minutes early`, signature copyable; the position card flashes in behind |
| Match revoked while held | Badge greys: `We are no longer confident this coin came from Last Horn.` The claim is withdrawn out loud, not left as a stale boast |
| Cost basis stale | Chain qty differs by >0.5%: PnL renders `—` with `You have traded this outside Insidor — we cannot compute your cost basis.` |
| Two wallets hold it | Position card shows the active wallet only, with a `2 wallets hold this` chip. The frozen earliness belongs to the wallet-scoped row |
| Token dead | `This coin appears to be dead. Liquidity $0.` Buy closed, sell open |

**What it needs**

Reused: `narratives`, `narrative_posts`, the trades/holders/top-traders endpoints, the DexScreener embed logic, the format helpers.

New, none of which exists today. **`narratives.promoted_at`** (write-once, NULL for all pre-existing rows). **`story_clocks`** (narrative_id, promoted_at, t_mint, t_ct, t_crypto, lead_time_min, earliness_eligible, unmeasurable, gap_window). **`coin_matches`** (narrative_id, mint, relation, verdict, score, s_img/s_text/s_tick/s_mint_in_post, mint_time, delta_minutes). **`coin_mints`** (mint, minted_at, creator, program, image_url, phash) and **`mint_stream_gaps`**. **`crypto_mentions`**. **`tokens`** as a mint-keyed table (mint, ticker, name, decimals, token_program, logo_url, pair_address, socials) **plus `liquidity_usd` and `liquidity_updated_at`**, without which the sibling sort does not compile — minutes-stale is fine for a tiebreak. **`token_safety`** (authorities and source, transfer_fee_bps, has_transfer_hook, sell_route_ok, top10_pct). **`holdings`** unique on **(user_id, wallet, mint)** — not (user_id, mint), or a second wallet corrupts both cost basis and the frozen earliness. **`trades`** with `request_id` unique and `sol_usd_at_trade`. **`clock_health`** (sensor, last_heartbeat).

Routes: `POST /api/order`, `POST /api/execute`, and **`GET /api/txstatus?sig=`** — without it, "a fill is confirmed by signature status, never inferred from a balance change" has nothing to call. Poll at 1s for 15s, then 3s.

Before holdings ship: Privy configured as a third-party JWT issuer on Supabase with `sub` mapped to `user_id`; RLS owner-read on `holdings` and `trades`, public-read on `coin_matches` and `story_clocks`; both of the latter added to the realtime publication; and a refresh loop calling `setAuth()`, because Privy tokens live about an hour and without it every user silently drops off the live feed.

**Build order**

1. Fix the safety endpoint — Helius as primary authority source, three-valued absent/null/present logic, the full RugCheck report for LP and holders, `token_safety` cache. Ships alone, and stops telling every user that every token is safe.
2. Fix the age lookup — missing `pairCreatedAt` fails closed to null; age becomes `min(pairCreatedAt)` across all Solana pairs until `coin_mints` lands.
3. Add `promoted_at` and `story_clocks`, with the NULL-forever policy in the migration and a never-clobber guard in the persist layer. Nothing about earliness renders honestly before this.
4. Migrate to Jupiter Swap V2: order, execute and txstatus routes, server-side referral injection, referral token accounts initialised for wSOL and USDC with a boot assertion.
5. Rebuild the trade panel on those endpoints — fee row and popover, real route/impact/priority values, new presets, Auto slippage under 30 minutes, SOL-price fallbacks.
6. Implement the buy machine end to end with `trades` behind it. Ship every failure state in the first cut; lost-contact and still-confirming are not polish, they are where trust is won.
7. Add `coin_matches` and the day-1 non-ML matching rules. This is what makes the origin band possible and it needs no models.
8. Build the band on the ranked-row grid, plus the evidence popover, the live-lead line, and the clock-health gate on `FIRST`.
9. Build the brand-new tiers and enforce `—` versus `$0` across the stat grid. This is the modal case, not an edge case.
10. Add the four buy-side blocks, sell-route check first, with the sell-side transfer-fee disclosure alongside it.
11. Add `holdings`, the position card, and the earliness snapshot-and-backfill job including the negative and pending cases.
12. Sell sheet, with the reverse-quoted `Take back what I put in` and the no-buyers state.
13. Add-money sheet: computed end-to-end arithmetic, the intent return contract, the first-run explainer and its precedence rules.
14. Realtime on `coin_matches` and `story_clocks`. An unsure match upgrading to confirmed in front of a user — band turning cyan, lead counting into place, Buy appearing where there was none — is something nobody else can render.
