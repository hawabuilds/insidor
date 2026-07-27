## 07. Wallet, onboarding, and the operator surface

**What it is**

Two surfaces that keep promises made elsewhere. The wallet layer makes reading Insidor free and complete and demands a wallet only at the instant an action needs one, never discarding the user's work at the gate — including the funding cliff, the highest-drop moment in the product. `/ops` is the other half: one page that says in three seconds whether the core claim is true right now, plus the honesty band that tells users on the public board when it isn't.

---

**How it looks**

*Signed out, the board is the board.* No blur, no overlay, no row cap, no "sign up to see more". The three tabs — Live feed, Search, You — are unchanged and every ranked table renders every column with real numbers. (Whether the stories lane stays merged into Live feed or splits out is still open with you; nothing here depends on the answer.) Three things differ: the nav's right slot renders `Connect` instead of the user chip; the comment composer becomes one quiet row on `#060607` ground with a hairline border — *"Connect a wallet to post. Reading is free — you don't need one to browse,"* cyan `Connect` inline; and the primaries relabel. It reads as a footnote, not a wall. Which is why the trade panel signed out still shows a live Jupiter quote — real `12,345.6789 HORN`, real min-received, real impact — with balance reading a dim `Connect wallet`, the note *"live route via Jupiter · connect to sign,"* and a button reading `Connect & buy 1 SOL of $HORN` in the cyan gradient rather than the lime execute gradient.

The primary is a pure function of the CONFIRMED coin count and auth never touches it: **0 → `Create coin`, 1 → `Buy $TICKER`, 2+ → `See the 3 coins`**. An UNSURE match renders no Buy at all — primary stays `Create the coin`, candidates collapse into a muted block: *"Possible match: $KANG — we're not confident this is related."* The 2+ branch opens a 440px sheet on the coins-table grid — rank · ticker · mcap · liquidity · age · action — sorted CONFIRMED-first then `first_deployed` ascending, temporal order rather than mcap, because mcap is the signal that gets front-run. CONFIRMED rows get a compact lime `Buy`; UNSURE rows get an `unverified` chip and no button, absent from the DOM rather than disabled.

*The connect sheet* is 440px, two tiles, no footer — the options are the actions. The subtitle carries the intent in mono: *"to buy 1 SOL of $HORN."* Tile A, `I have a Solana wallet`, shows the Phantom/Solflare/Backpack marks and `free · instant`. Tile B, `Create one for me` — *"Email or Google. We make a Solana wallet for you — you own it and can export the key any time"* — `free · ~20s`. Under Tile B only, never behind a toggle: *"New wallet, no crypto? Getting money in costs about 2.5–4.9% on a card, plus swap costs on the trade. Sending SOL from an exchange is free. We'll show both."*

*The funding cliff is not a modal.* It replaces the lower half of the trade panel in place, so the coin's icon, price and chart never leave the screen. Three lines head it, and the middle one is the point of the whole product:

> `You need 1.02 SOL · you have 0.14 SOL` — need in ink, have in red `#FF5C6E`
> `+31m ahead of crypto twitter on $HORN · 6m ago` — the same lead badge the board used, live-counting, amber past +58m (trailing-7d p75)
> `0.02 SOL is held back for network fees and never spent.`

Then three tiles ordered by measured seconds-to-SOL against that counter, not by our margin. **Send SOL**: client-rendered QR, address in mono with copy, `arrives in ~30s · costs ~0.000005 SOL · no fee from us`. **Card**: the first preset is computed from the actual deficit — `ceil(deficit_sol × SOL_PRICE / 5) × 5` → `$195 · covers it`, default-selected, with `$25 | $50 | $100 | $250` after it, over a four-row live recap: `Card fee −$7.60 (3.9%)` · `You get ~0.85 SOL` · `Then swap into $HORN −1.0% route · −0.5% Insidor · −0.9% impact` · `Ends up as ~$183 of $HORN`, closing *"Two steps, not one — there is no card-to-memecoin path on Solana."* **Swap what you have** appears only when a routable non-SOL token is held: `You have 42.10 USDC → 0.28 SOL`. The resume strip pinned at the bottom says what is actually true — *"Leave this tab open and we'll take you straight back to $HORN"* — and a bail-out link, `Not now — watch $HORN instead`, stars the coin and its story so the drop lands as a follow rather than a bounce.

*Balance lives in exactly three places*: a mono lime `1.2345` in the nav chip behind a hairline divider (no `SOL` suffix, no USD); a 284px account panel the chip toggles, carrying wallet type, address with copy, `1.2345 SOL` over `$284.10`, `Add funds`, `Export wallet`, `Disconnect`; and the trade panel's balance line. Not the rail, not per row. *Every comment carries a position stamp* — a 10px pill reading `holds 2.1 SOL of $HORN` in lime, `no position` in dim grey, `sold` in amber, or `position unknown` in dim with a hairline border. It names the mint and never updates; hover gives *"position when this was posted · 14:22 UTC."*

*Security is a section in `/you`, not a modal*, so it is findable when nothing is wrong: wallet type, recovery method, `Insidor's access: ✓ none — we cannot move or recover your funds`, then four flat sentences — your login is your recovery, losing it without exporting means the funds are gone permanently, export runs in Privy's window and our code never receives the key, and exporting changes nothing about the wallet. Then a red pill — *"Anyone with this key owns everything in this wallet, forever"* — over a full-width `Reveal private key (3)` disabled for three seconds after it scrolls into view, which exists to stop a fat-finger reveal during a screen share.

*`/ops`* reuses the app shell so nobody learns a second layout under stress. Region 0 is a 54px verdict strip at exactly one table-row height: a 14px dot, `HEALTHY` / `DEGRADED` / `DEAD` in Clash Display 18px uppercase, and — taking most of the width — the sentence that names the outage: *"worst: stage_output_stall = 7 consecutive zero runs · ingest · since 14:02 UTC (2h 11m)."* The dot pulses on DEGRADED and DEAD; healthy is static. Right edge: `evaluated 18s ago · watchdog ok · healthchecks ok 41s ago`. Region 1 is the ten SLIs — `# | SLI | Value | Warn | Page | State | Breaching for | Last 60m`, mono right-aligned, state cell reusing the timing pill, row click revealing the raw SQL with a copy control:

| # | SLI | Pages at | Class |
|---|---|---|---|
| 1 | `ingest_freshness` | 30 m | dead |
| 2 | `stage_output_stall` | 5 zero runs (~10 m) | dead |
| 3 | `gate_supply` | 0 eligible for 10 m | dead |
| 4 | `board_render_fallback` | ≥1, immediately | dead |
| 5 | `stage_liveness` | 3× interval | degraded |
| 6 | `funnel_yield` | −3σ | degraded |
| 7 | `budget_burn` | 1.0 before 12:00 UTC | degraded |
| 8 | `tick_freshness` | 120 s | dead |
| 9 | `lead_time_p50` | < 8 m | degraded |
| 10 | `delta_divergence` | 5 % | degraded |

Region 2 is the funnel — ARRIVED → ADMITTED → TRACKED → TRIGGERED → CLUSTERED → PROMOTED over the last 60 minutes, conversion rates in the arrows, change pills against the 7-day same-hour baseline. A zero renders as a 22px red `0`, never dim, never an em-dash: every real outage appears here as a column of zeros, naming the broken stage without reading a log. Region 3 is the stage table — `ingest`, `ingest-tiktok`, `snapshotter`, `score`, `cluster`, `trends`, the names the code actually writes — with `Last success | Last attempt | p50 dur | Errors 1h | Rows out | Last error`, that final cell rendering `402 payment_required · twitterapi.io · 14:02:11` in red. That is the cell that was invisible for two days. Region 4 is spend per API (today, cap, burn bar, projected EOD); region 5 a 24h stacked area of `gate_reason` with a red floor rule labelled `board empty` wherever the eligible band touches zero.

*The honesty band* is one strip above the public board. Fresh: nothing. Lagging (15–45m), amber: *"Detection is running slow — the newest story we've seen is 22m old."* Stale (>45m), amber: *"Live detection is down. The newest story on this board is 3h 12m old. We stopped receiving posts at 14:02 UTC and we know about it."* Fallback, red: *"These stories no longer pass our freshness gate. We're showing them because the alternative is an empty screen — treat every number here as historical."* Under stale and fallback every lead badge is **removed**, not greyed; a dimmed earliness claim is still an earliness claim. Buy and Create stay enabled — Jupiter and pump.fun are independent of our ingestion and still telling the truth.

---

**How it works**

One pure gate function decides all of it: reads and follows are open; comments need a wallet but never SOL; only `buy` and `create` return `needs-sol`, and only when `balance < amount_in + 0.02`. Nothing else in the app asks about auth.

One pure `primaryAction(narrative)` returns `{kind:'create'}` / `{kind:'buy', mint}` / `{kind:'multi', n}` from `count(narrative_tickers where match_state='CONFIRMED')` and nothing else. Every CTA and every trade-panel mount reads it. The existing `topCoin()` — which picks whichever mint has the largest market cap — is deleted; a helper that silently picks a winner cannot coexist with a rule that says the ambiguous state is never rendered. A mandatory test asserts it never returns `buy` for a zero-CONFIRMED narrative.

Fees are disclosed on the path most users take. The trade recap and the confirm dialog each gain a fifth row, `Insidor fee` / `0.50% (~0.005 SOL)`, in the same weight as Amount and Slippage. The Jupiter integrator fee has a 50 bps floor, so 0.5% per trade is the cheapest number that can ever be quoted, and it is stated rather than buried. Card arithmetic is two legs and says so: provider fee read from the live quote, never hardcoded, then route + 50 bps + impact + priority on the swap. No quote, no tile — a guessed percentage on a screen about money is worse than an absent one. The create sheet does not ship its current `3% / 1%` split bars, because the system doesn't implement them; until it does, one line: *"Deployer fee share is not live yet. You will not earn fees on coins created before it ships."*

The position stamp is written server-side at insert, once: verify the token, run the address gate (any base58 32–44 char string that isn't one of this narrative's mints is blocked, no appeal — about 90% of spam for one lookup), resolve the top CONFIRMED mint, one Helius token-account read. `holds` on a positive balance, `sold` when a prior nonzero snapshot exists for the same wallet and mint, `none` when neither, `unknown` on any RPC error or timeout. Rendering `no position` on a failed read is an unverified factual claim about a person — the same class of bug as a missing timestamp rendering `age = 0` on a terminal that sells earliness. `/api/balance` requires a Privy token and rejects any owner not linked to that DID, with a 10s server cache so the 30s nav poll and the 6s funding poll collapse onto it.

Healthy means all ten SLIs non-breaching, and every SLI is an **output** measure — a heartbeat proves a process ran, not that it produced anything, and `last_heartbeat` ticked happily through all 48 hours of the outage. SLI-2 only catches a silent death after two changes: `logCycle` moves into a `finally` in every worker, so a thrown cycle still writes a row with zero output and the error; and the query left-joins a fixed list of expected worker names so a worker that dies before it can log anything emits `zero_run_streak = 999` on absence rather than emitting no row at all. Absence and zero must both breach — today only zero does, and zero requires the worker to still be alive. `worker_cycle_log` gains one `rows_out` column each stage sets from its own output metric, so the query stops assuming `ingested` means output everywhere. It doesn't, and two of the four workers that log at all would otherwise page forever from day one.

Three independent observers, because any one of them can be the thing that died: an Inngest watchdog on a 2-minute cron; healthchecks.io as an external dead-man expecting that ping, which nothing inside the system can suppress; and `pg_cron` + `pg_net` calling `evaluate_health()` in the database, which survives total loss of the app platform. The watchdog asserts its own dependencies at startup against `information_schema.columns` — an SLI querying a nonexistent column evaluates to null and paints the board green, which is exactly how the original outage stayed invisible. Dead-class breaches (1, 2, 3, 4, 8) page with `@channel` and repeat every 15 minutes until acked; degraded-class post one threaded auto-resolving message and never touch a phone. Any `payment_required` or `unauthorized` stage row pages immediately regardless of thresholds — a billing failure is not a statistical condition to be averaged.

The honesty band is one pure `tier()` reading `minutesStale` from `max(narrative_posts.first_seen_at)` — the same column and query SLI-1 uses, so `/ops` and the board can never disagree about whether the pipeline is alive. `posted_at` stays for the Age column only, where author time is the right semantic. Unknown fails to stale; **negative fails to stale too**, because `posted_at` has a known double-conversion bug producing future dates, and one bad row would otherwise render every `+31m early` badge on a board dead for two days.

Replayed against the real incident: SLI-2 warns at T+4, pages at T+10, SLI-1 pages at T+30, and the first user to hit a fallback board pages immediately. Ten minutes instead of two days.

---

**States**

| State | What the user sees |
|---|---|
| Signed out | Everything readable is readable. `Connect` in nav, one footnote row on the composer, CTAs relabelled `Connect & buy…` |
| Privy not ready / SDK failed | Button disabled reading `Loading…`; on hard failure, *"Wallet unavailable — retry or use an external wallet."* Board untouched either way |
| Unverified (UNSURE) match | No Buy anywhere. Primary stays `Create the coin`; candidates collapsed and labelled unverified |
| Direct coin route, unverified story link | Buy stays enabled — the user named the mint. Story attribution reads `unverified link`; the lead badge is suppressed |
| Story with zero coins | Primary `Create coin`; `No coin deployed yet`; no position badges, since there is nothing to hold |
| Brand-new token, no market data | Price, 5m, 1h, 24h, vol, liq, mcap all render a literal `—`. Never `0`, never an inferred `NEW`. Buy stays enabled; Jupiter can still route |
| Negative lead time | `−14m` in red with a real minus sign. Never parenthesised, never absolute-valued, never hidden; same weight as a positive badge |
| Coinability tier 2 (surface, no Create) | Story renders in full; the 0-coin primary degrades to `Watch`: *"We don't support launching a coin from this story."* Tier 1 never appears |
| Story goes never-surface after its coin launched | The `/you` position row stays and stays claimable — the money is real. The story link becomes *"This story is no longer shown on Insidor."* |
| Not connected, You tab | The real shell, not a redirect: `Ready to claim $0.00`, `Holdings —`, Following genuinely populated from local storage, plus *"Connect to see money, positions and claims. Your saved stories are already here."* |
| Connected, first run, nothing held | Same shell, zero rows, one line: *"No positions yet. Your first buy shows up here with the lead time you got."* |
| Connected, zero SOL | Nav balance `0.0000` in dim, not lime; `Add funds` takes the cyan fill; any Buy or Create hands to the funding cliff |
| Balance fetch failed | `—` in dim. Never `0`, never a silent fallback to a cached number |
| Card quote pending / failed | Tile pulses with no numbers, then disables: `Card funding unavailable right now`. Send and Swap unaffected |
| Below provider minimum | Presets under ~$20 hard-disabled with `card minimum is $20`; a covers-it amount below the minimum snaps up and says so |
| Waiting for deposit | Tiles collapse to one line each, lime dot pulsing. On tab blur: *"Waiting — we'll pick this up when you return."* |
| Wrong asset arrives | The watcher reads token accounts too: *"42.10 USDC arrived, not SOL. Swap it to SOL →"* routing into Tile 3. Silence is never the answer to an arrival |
| Partial arrival | Deficit updates live; the button offers `Buy 0.62 SOL of $HORN instead` — what they can afford, minus reserve |
| Card settled, swap leg failed | *"Your $195 arrived as 0.85 SOL and is safe in your wallet. The $HORN route failed — retry, or hold the SOL."* The paid provider fee is named |
| Intent expired (30 min) | *"Your $HORN order expired — the price moved. Re-quote?"* |
| Token untradeable while waiting | *"$HORN has no route right now. Your SOL is safe in your wallet."* Intent dropped, not retried |
| Disconnected mid-session | Chip reverts to `Connect`; any open trade panel disables execute with `Wallet disconnected` |
| External wallet | No export block; one row: *"Your keys are in Phantom. Insidor never had them."* |
| Balance > 0, never exported | Amber nudge atop `/you`: *"You're holding $284 in a wallet you haven't backed up."* Per-session dismissible, weekly return, never modal |
| Watchlist merge failed on connect | Local key is **not** cleared: *"Your saved stories are still on this device — we couldn't sync them. Retry."* On success: `4 saved stories added · 11 already on your account` |
| Pipeline lagging / stale / fallback | The strip tiers above; lead badges removed entirely under stale and fallback. The Age column keeps counting, because that stays true |
| Recovering | Lime strip for 90s: `Back live — 41 new stories arrived`. Badges return only for stories promoted after recovery; an intent carried in from the stale window keeps its badge-less story |
| One platform down | *"X detection is down; TikTok stories are still arriving,"* with the platform badge inline |
| `/ops` evaluator stale (>3 min) | `UNKNOWN · the evaluator itself has not reported since 14:41`. A green board from a dead evaluator is never rendered |
| `/ops` cold start, zero samples | `UNKNOWN · the evaluator has never reported`. Every row reads `never reported` in red — empty must not look like healthy |
| `/ops` stage listed but never seen | `never reported` in red across the row |
| `/ops` no spend rows today | `no usage recorded today` in red, not `$0.00` — zero spend and no data are otherwise identical |
| `/ops` schema assertion failed | `UNKNOWN`, naming the object: `ops_funnel.promoted absent — SLI-6 not evaluated` |
| `/ops` unauthorised | Server 404. No login prompt, no hint the route exists |
| Earliness ledger, n < 30 | Median and percentiles render `—` with `not enough data (n=12)` rather than a noisy number |
| Earliness ledger, mint-clock gap | Amber strip naming the span; those stories are unmeasurable, never wins |

---

**What it needs**

Used as-is: `narratives` (`display_eligible`, `gate_reason`, `updated_at`, `combined_views`), `narrative_posts` (`first_seen_at` as the one ingest clock, `posted_at` for Age only, `platform_post_id` as permalink proof), `narrative_tickers` (`ticker`, `mint_ca`, `mcap`, `liquidity`, `first_deployed`), `worker_cycle_log`, `worker_usage`, `worker_budget_state`.

New on the wallet side: `app_user(privy_did unique, wallet_address unique, wallet_type)` — nothing maps a Privy DID to anything today; `follow(user_id, target_type, target_id)` — the watchlist is two in-memory Sets and dies on refresh; `holding(user_id, mint, narrative_id, tokens, cost_sol, entry_price, opened_at, minutes_early)`, where `minutes_early` is signed and renders negative; and `comment(…, snap_views, snap_coin_count, snap_age_min, snap_top_mcap, snap_position_lamports, snap_position_mint, snap_position_state)` — the stamp is unrecoverable retroactively, so it ships before comments do. Whether `trade_intent` also lives server-side is open: it survives a device switch and gives a real drop-off funnel, at the cost of storing unexecuted trading intentions.

New on the ops side: `narrative_tickers.match_state ('CONFIRMED'|'UNSURE'|'REJECTED')` plus `match_score`, `mint_time`, `evidence`, and `source ('cashtag'|'llm'|'mint_in_post')` — the primary button is uncomputable without `match_state`, and missing provenance is the root cause of the $KANG class; `narratives.promoted_at` and `earliness_eligible`; `coin_mints` and `ct_mentions`, the two clocks; `ops_stage_run`, `ops_event`, `ops_sli_sample`, `ops_funnel`, `ops_budget_cap`; and one `worker_cycle_log.rows_out` column.

Three flags to keep. `worker_pipeline_state`, `worker_crashes` and `worker_usage.cost_breakdown` are defined in SQL but absent from the 2026-07-23 live schema probe, so SLI-5, the errors rail and the spend region may be querying objects that were never migrated — verify the applied state, not the SQL files. `worker/trends.js` currently inserts `refreshed`/`open`/`trend_enriched`, which are not columns on `worker_cycle_log`; that insert fails into a swallowed warning, so `trends` has no cycle history at all right now. And `funnel-log.js` is a generic stepper with two call sites and arbitrary labels — a printing convention, not the six-stage taxonomy. Nothing anywhere emits `promoted`; there is no PROMOTE event in the repository. The funnel must be *defined* before it can be persisted.

---

**Build order**

1. **The incident fix — two hours, no new infra.** Widen the retry predicate to `{408, 425, 429, 500, 502, 503, 504}` so a 402 is loud instead of fatally silent; add `stage-run.js` + `ops_stage_run` and wrap all six real stages; move `logCycle` into a `finally`; add `rows_out`; fix the `trends` insert; emit `ops_event(kind='board_fallback')` from the `showingIneligible` the code already computes and discards. Add the one-line `.dim{color:var(--dim)}` rule while you're there — three honesty states render as confident primary text without it.
2. **`match_state` as a schema-only change**, defaulting every existing row to `UNSURE`, plus `primaryAction()` with its test and the deletion of `topCoin()`. This gates the whole wallet track: until it lands, every Buy button in the product is a market-cap guess.
3. **Watchdog and dead-man in one PR** — samples, events, budget caps, the 2-minute cron over the seven SLIs needing no new clocks, the Slack dead/degraded split, the healthchecks ping, the startup schema assertion. Alerting without a dashboard is useful; a dashboard nobody watches is not.
4. **Define, then persist, the funnel.** Name the six boundaries against real code points, make PROMOTE an explicit event stamping `promoted_at` once behind a `coalesce(promoted_at, now())` guard, then add the table and the in-database third observer.
5. **`/ops` regions 0–5** behind a server-side DID allowlist.
6. **The honesty band** — `tier()` with tests covering null and negative, the strip container, and the load-bearing part, lead-badge suppression under stale and fallback. Delete the interval that writes the literal string `now` every four seconds in the same PR.
7. **Wallet provider and gate** — Privy pinned to Solana-only, the 50-minute token refresh feeding realtime auth (without it every user silently drops off the live feed after an hour, the most likely launch-day bug), `gate.ts` with tests, `app_user` + `follow`, the footnote gate component, and a local follow set whose merge clears local storage only on a 2xx.
8. **Connect sheet, both paths**, plus the nav balance, the ported account panel, an authed and cached `/api/balance`, real signed-out quotes, and the intent handoff. The `Insidor fee` row lands here, on the ordinary funded buy.
9. **The funding cliff** as its own release, instrumented per tile: deficit-aware presets, the earliness counter, the two-leg cost line from live quotes, the watcher and auto-resume.
10. **Export and security** in `/you`, with the dwell timer and the never-exported nudge.
11. **The clocks** — `coin_mints` from a supervised PumpPortal stream with gap detection, `ct_mentions`, `earliness_eligible`. Nothing about lead time is measurable before this.
12. **`/ops/earliness` and the public record** off one identical query, with `All` as the default filter asserted in CI.
13. **The comment position stamp**, shipping with moderation in the same release and never before it.
