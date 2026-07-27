## 01. Live Feed — the posts lane

**What it is**

A ranked terminal board of the 40 posts going viral right now, ordered by how fast each is accelerating against its own author's baseline — not by how many views it has. One job: *what is blowing up, and how much head start do I still have.* This is the pre-coin surface. Most rows have no ticker and nothing to buy, and that is the point — if you can buy it here, you were late.

**How it looks**

Three tabs: Live feed · Search · You. Inside Live feed a segmented switch — POSTS · STORIES · COINS — POSTS default. (Whether stories stay a sibling switch here or become their own top-level tab is still open with you; this assumes merged.)

A 44px sticky control strip on near-black glass: lane switch, platform chips, age window (15m · 1h · **4h** · 24h), sort chips (HEAT · RATE · ACCEL · NEW · REACH), threshold popovers reading `MEME ≥ 0.35` and `ORG ≥ 0.30`, and one loud red toggle, SHOW RISKY. Right side: COLLAPSE BY STORY, SINCE OPEN, Δ10m, `LAST TICK 4s`, `40 posts`.

Then the board — one dense table on a #0C0C0E card, sticky header, **54px rows**, matching the stories and coins boards so the three lanes read as one instrument. Every row carries a 3px lifecycle rail on its left edge (lime heating, cyan peaking, dim cooling), then eleven columns:

| Col | Shows |
|---|---|
| `#` | Rank 1–40 plus a one-tick caret `▲2` / `▼1` that fades after 20s; in Δ10m mode it is relative to ten minutes ago. **Rows never physically slide.** |
| POST | Thumbnail · author · text · chip slot (below). |
| HEAT | 0–100 mono white over a 3px cyan bar. The composite sort key made legible. |
| REACH | Cumulative views (`2.4M`) in **muted grey, not white** — it is an eligibility gate, not the score, and every competitor trains users to read it as the score. |
| RATE | `12.4K/m` view arrival, coloured by lifecycle; dim sub-line `48 rt/m`, because the reshare rate is what actually gates the post. |
| ACCEL | Burst as a multiple, `3.2×`. Lime ≥1.3, amber 0.8–1.3, dim below. `—` on a single snapshot, never a fabricated `1.0×`. Moves ~40s before the rank does. |
| 20M | 22px sparkline of the last 8 view-rate deltas. One vertical step then flat is bought reach, legible in a second. |
| ORG | Organic multiplier 0–100. Red <30, amber 30–60, muted 60–85, white above. |
| MEME | meme_score 0–100 plus an amber `⊘` when coinability is `no_create`. |
| AGE | `14m` / `2h`, with the CT lead on a sub-line. |
| *(action)* | 118px, one primary button, behind a 1px divider. |

The POST cell is four lines. Thumbnail: real image; or a video poster frame with a play overlay and a `from video` chip; or, with no media, a deterministic gradient seeded by post id plus `no media`. **The loremflickr → picsum stock-photo fallback is deleted** — fabricating media on a terminal whose thesis is precision is a lie told in pixels. Author line: platform mark · name · `@handle` · `· 412K` followers inline (the plausibility denominator, not a sortable fact). Then the post text, verbatim, one line, CSS-clipped only. TikTok hashtags render dim; when a caption is >65% hashtags we show Insidor's own one-line subject prefixed with a mono `DERIVED` label so it never passes as the author's words.

The chip slot is a fixed 14px line, always present, so chips never reflow the row. At ≤1040px it clamps to two, precedence `RISK` → `NOT MINTABLE` → `ALREADY HOT` → `ADOPTED` → `FROZEN` → `2ND WAVE` → `→ STORY` → `+4 posts`, overflow `+2`. The honesty labels are never what gets dropped.

Nothing in the post cell is an engagement control — no like, repost, reply, follow. `Create coin` and `Buy` are Insidor actions on an Insidor object, which is why they sit outside that cell behind a divider. Name, handle and timestamp link out in a new tab.

Under the board: `40 of 63 eligible · 12 hidden by gate`, opening `meme_score 7 · O 3 · author cap 2 · coinability 4`. On wide viewports a 460px rail logs board events: `ENTERED #7 · @handle`, `LEFT · cooling`, `2ND WAVE · #12`, `CT PICKUP · 3 accts`, `MATCH RETRACTED · $KANG`, `NORMS REBASED`, `SNAPSHOT GAP · 4m`.

**How it works**

```
base     = rate_LCB_norm × burst^0.5
PostHeat = (base × O)^0.85 / ((age_min + 12)/12)^1.35 × C × E
```

`rate_LCB_norm` is a Gamma-Poisson lower confidence bound on the **view arrival rate**, normalised by the platform's 24h median. The prior comes from the author's follower-decile bucket, which *is* the cold-start answer — no null, no blind window. The lower bound punishes small n, which kills the 3→30 false positive and prices in bought views.

`burst = S_fast / S_slow`, continuous-time EWMA, τ 20min over 6h: `S ← S·exp(−Δt/τ) + (1 − exp(−Δt/τ))·(ΔV/Δt)`. Continuous, not `α·x + (1−α)·S`, because the snapshot grid is irregular (4/9/14/21/30/42/58/78 min) and the discrete form biases hot-tier posts upward by construction. Burst is scale-free — a 300-follower account spiking outranks a 500k account's normal traffic — and it detects a **second wave**, which an HN-shaped score provably cannot and which is the dominant pattern in memecoin attention.

`O` ∈ [0.15, 1.0] multiplies five tests: step detection on the delta distribution, likes/views depth, replies/likes conversation, audience plausibility, monotonicity. Failing one caps the score; floored at 0.15 not 0, so a false positive demotes rather than erases. **Plausibility is exempt on TikTok** — the parser hardcodes `quotes: 0` and For-You routinely puts views at 200× followers organically, so leaving it armed applies 0.35 to every TikTok breakout and gates out virality on the platform where memes originate.

`C` = 0.35 once three crypto-native accounts have quoted the post: when CT finds it our edge is gone and it should fall off the board *while still growing*. `E` = 0.70 on censored entry (first seen already large, or >20 min after posting); those rows get an amber `ALREADY HOT` chip, no lead figure, and permanent exclusion from the earliness denominator. **⚠ 0.70 is judgement, not a fitted value** — the backfill settles it.

Displayed heat is `round(100 · min(1, PostHeat / p95_heat_1h))`, self-calibrating so a dead night still shows spread. That denominator rebases hourly, so a row can jump 61 → 88 with nothing changing underneath — the tick animation is **suppressed on the first frame after a rebase**, with a dim `NORMS REBASED` rail event. The HEAT popover decomposes base · burst · O · C · E · age penalty **plus the denominator and its updated_at**.

Eligibility, applied to every sort and filter identically: age ≤ 240min, reshare-rate LCB above an absolute floor (reshares, never views), a view floor, meme ≥ 0.35, O ≥ 0.30, coinability ≠ blocked, author <3× in the top 20, two qualifying ticks. Sorting by NEW still gates — otherwise "newest" returns 40,000 pieces of junk and the product looks broken. SHOW RISKY is the one exception, which is why it is loud and never persisted.

**Stability.** Commit every 20s: a challenger must beat an incumbent by 8% to pass it, two ticks to enter, three to leave, 90s dwell, max 5 positions per tick. Then freeze-on-hover (reorders queue, strip reads `PAUSED · 3 QUEUED`), never reflow below the fold (entrants above row 12 batch into `↑ 3 new`), and the load-bearing rule: **values update live, positions do not.** Rows live in a `Map<post_id, Row>` updated on every push; only the ordering array is held.

**The action.** The primary button is a pure function of *n* — coins on the post's story that are `verdict = confirmed` **and** pass the §4.4 hard safety gates (mint authority, freeze authority, top holders >60%, live with <$3k liquidity, honeypot proxy). Confirmed answers "is this the right coin", not "is this safe to buy". n=0 → `Create coin`; n=1 → `Buy $TICKER`; n≥2 → `See the 3 coins`.

*n* is **market-data independent**: a coin confirmed four minutes ago with a null mcap is still n=1, still Buy, with mcap and liquidity as a dim `—`. `lib/stories.ts`'s `tradeable()`/`storyAction()` pair, which requires a non-null mcap, is deleted — under it a four-minute-old mint flips back to Create and drives a duplicate mint in the exact window this product exists to serve.

An **UNSURE** match makes Buy unrenderable; `Create coin` stays primary and the candidate shows as a muted `$KANG · UNVERIFIED` chip. Abstain never means hide, and confidence is categorical — never "73% match" beside an actionable control, because users treat 73% as good enough and do their own thresholding. **Confirmed but unsafe** → `See the coin` (outline) plus a red `RISK · mint authority` chip; only SHOW RISKY promotes it to Buy. **Adopted** (a pre-existing mint a story attaches to) → Buy plus a mandatory amber `ADOPTED · 604d`; without it a 604-day-old shell with $3k liquidity renders as an ordinary buy.

**Fees are disclosed before every confirm.** The action cell carries a dim `+0.5% fee` second line, read from config, never hardcoded — the Jupiter integrator fee has a 50 bps floor, so 0.5% is the cheapest possible cost per trade and we say so rather than implying zero. The trade modal renders expected received, price impact and max slippage before confirm goes live, red above threshold; `dynamicSlippage` is already on and this board specialises in sub-10-minute curves. Create shows the pump.fun creator-fee share and any Insidor share before submit.

`Create coin` prefills ticker, name and media from the LLM suggestion. **That is the only place the suggested ticker may exist** — it must never reach enrichment or `narrative_tickers`, which is the live $KANG bug at `cluster.js:310`.

**Lead time.** An unclustered post has no narrative, so no `promoted_at`, so no computable lead — we suppress the figure there rather than invent a second clock that silently means something else. Once CT picks it up, AGE's sub-line renders cyan `+31m early`, dim `CT +0m` (a genuine tie only), or red **`CT −7m late`**. Roughly a third of real detections are late; the number that proves the claim has to render its own failure.

**Story collapse.** A row never vanishes because a job clustered it. On clustering it stays put, gains `→ STORY`, and the button re-resolves — `Create coin` → `Buy $TICKER` in place with a one-time 850ms cyan pulse, the most important state change here. The reverse is equally visible: retraction reverts to Create, drops the candidate to the unverified chip, and logs an amber `MATCH RETRACTED` event — never silent, never the celebratory pulse. Later members fold into one row as `+4 posts`. With COLLAPSE off, members render individually with a colour-keyed left marker and **share one resolved action state** — twelve rows of one story is not twelve independent Buy buttons.

**States**

| State | What the user sees |
|---|---|
| First run | One-time dismissible strip naming the three columns that decide a row — HEAT, ACCEL, AGE lead. Every hover popover has a tap equivalent. |
| Loading | 12 skeleton rows; header and strip render immediately, already interactive. |
| Empty — quiet | `No posts currently qualify.` plus LAST TICK age and the gate breakdown *including a bare coinability count*, so a filtered window is never confusable with a slow night. |
| Empty — broken | LAST TICK >120s: amber `PIPELINE STALE — last snapshot 6m ago. Ranks are frozen.` Last tick still rendered, HEAT dimmed. |
| Error | Red banner, retry, last good tick from cache stamped `as of 14:22`. |
| Cold start (1 snapshot) | ACCEL `—`, blank sparkline, HEAT with a dim asterisk. Enters after 2 ticks unless the hard rate floor fires the escape hatch (lime `NEW`, 120s). |
| Censored entry | Amber `ALREADY HOT`, E=0.70, AGE sub-line blank. Never a fake `+31m early`. |
| Second wave | Cyan `2ND WAVE`; original posted_at kept so the age penalty stays honest. |
| Negative lead | Red `CT −7m late` on the row, in the sheet subtitle, and as a `CT BEAT US` rail event. |
| Story with no coin | The normal case. `Create coin`, prefilled. |
| Unverified match | Buy **unrenderable**. `Create coin` primary; muted `$KANG · UNVERIFIED`, no one-tap path to buying. |
| Confirmed, no market data | `Buy $TICKER` normally; mcap and liquidity dim `—`, never `$0`, never a reassuring green. |
| Confirmed but unsafe | `See the coin` outline + red `RISK` naming the failing gate. |
| Adopted coin | Buy + amber `ADOPTED · 604d`; sheet reads "existing coin, adopted by this story". |
| Match retracted live | Reverts to Create, candidate drops to unverified, amber rail event. |
| `no_create` | Ranks and displays normally; action cell reads `NOT MINTABLE` + reason. Discussable, not mintable. |
| `blocked` | Never enters board or rail. Counted, uncatalogued, in the gate breakdown. |
| Wallet not connected | Buttons show their **true label**, fully enabled; click opens Privy then completes the intent. Never greyed for auth. |
| Insufficient SOL | Modal states the shortfall inclusive of the 0.5% fee, before any signature request. |
| Create fails | Ticker taken, mint rejected, signature declined: sheet stays open, reason inline, prefill intact. |
| Ingest gap | Amber `FROZEN`, HEAT dimmed, ACCEL `—`. EWMA frozen, not decayed; window marked unmeasurable, not a win. |
| Post deleted upstream | Keeps rank, gains dim `UNAVAILABLE · as of 14:22`, counters stop, action suppressed to Create. |
| Author capped | Third row suppressed; the author's top row gains a dim `+2 more from @handle`. |
| Media fetch failed | Gradient placeholder + `no media`. Never a stock-photo substitute. |
| Frozen on hover | Cyan inset ring, `PAUSED · 3 QUEUED`. Values tick, positions hold. |
| Polling fallback | Live dot amber, rail reads `polling fallback`, row age from the response Age header. |
| Scoring paused | Existing budget-exhausted banner verbatim; existing rows keep updating. |

**What it needs**

Used as-is: `narrative_posts`, `post_snapshots`, `post_meme_scores`, `narratives`, `narrative_tickers`, `worker_cycle_log`, `worker_budget_state`.

⚠ Does not exist:

- **`post_heat`** (PK post_id): heat, base, presented_heat, rate_lcb_views, rate_lcb_reshares, rate_lcb_norm, s_fast, s_slow, ewma_updated_at, burst, organic_o, organic_features, ct_pickup_count, ct_first_seen_at, lifecycle, v_peak, censored_entry, second_wave, frozen, ticks_qualified, computed_at. **Nothing in the formula has a home today.**
- **`board_ticks` + `board_state`** (rank, prev_rank, entered_at, pinned_until, exit_ticks) — without them there is no rank delta, no enter/exit counting, no Δ10m, no rail log. ⚠ Retention unresolved: ~173k rows/day/lane, and the Δ10m lookback blocks aggressive trimming.
- **`platform_norms`** (median_view_rate_24h, median_views_at_age, p95_heat_1h) and **`author_roster`** (follower_decile, a0, b0).
- **`coin_matches`** (narrative_id, mint, verdict, score, evidence, mint_created_at, matched_at) — the story-to-coin workstream's deliverable, not this one's. `narrative_tickers` has no verdict column and **no `source` column**, so an invented ticker and a real cashtag are indistinguishable downstream.
- **`narrative_posts.coinability`** enum + reason + model. D3 has no schema representation today.
- **`narratives.promoted_at`** — the lead-time clock, genuinely absent.
- `followers_at_post` (current `followers` grew *because of* the post — plausibility against it is circular), `media_phash`, `post_derived_subject`, `ingest_gaps`, a real `watchlist` table (today two in-memory Sets), and an index on `post_snapshots(post_id, captured_at desc)`.
- **Not needed:** `media_poster_url` — both parsers already write poster frames into `media_url` with type video/gif. ⚠ Unverified: whether TikTok CDN cover URLs are signed and expiring. Check a 24h-old row.
- Platform chips render from `select distinct platform` — today exactly X and TikTok. Three hardcoded chips reading 0 forever is the same lie as the stock photos.
- ⚠ Settle before the Buy path: `schema.md` lists `narrative_tickers.mint_ca`; `lib/types.ts` asserts there is no mint column.
- New CSS: `.ptk`/`.pthd`, `.pd-rank`, `.newpill`, `.storydot`, `.lead-late`, and a new `.pbtn.buy` — `.pbtn.trade` already means Create Coin in the rail.
- The sparkline lateral needs `and unavailable is not true` with views carried forward across gaps, or a deleted-then-restored post draws the exact one-step shape we flag as bought reach.

**Build order**

1. **Migration only.** All of the above, the snapshot index, drop `replica identity full`. **1a** norms pass over raw snapshots; **1b** `post_heat` backfill reading 1a's norms, replayed in continuous time against real `captured_at` deltas so backfill and live accumulator agree exactly. That equality is the test.
2. **Coinability classifier + enum.** A column and a model call, not a dependency — and the one thing deciding whether a row may exist. Nothing below goes on a public route until it lands.
3. **Offline control.** Seven days scored with HN's `(P−1)/(T+2)^G` against PostHeat, judged on whether the top-10 at *t* held posts whose stories produced a ≥$100k coin after *t*. If HN wins, steps 4–5 shrink to one line.
4. **Pipeline scorer.** EWMA, Gamma-Poisson LCB for views and reshares, the five O features with the TikTok exemption, lifecycle hysteresis, censored entry. Fixes the cold-start null at `velocity.js:50`. Pure functions, tested, no mocks.
5. **commit_board().** Heat 60s, commit 20s with swap/enter/exit/pin/move plus author cap, story cap, phash dedup; norms hourly. Verifiable from SQL before a pixel exists.
6. **Static board.** ISR at `revalidate = 2`, hydration query, eleven columns, responsive collapse. Already a real product: a board that reranks every two seconds beats a feed that doesn't rank.
7. **Media.** Three-case thumbnail, source chips, TikTok hashtag treatment and DERIVED subject, deletion of the fabrication chain.
8. **Control strip.** Filters, sorts, thresholds, SHOW RISKY, COLLAPSE BY STORY, persistence, gate disclosure.
9. **Realtime.** Broadcast `board:posts`, 500ms coalescing, value-update map, tick animations, new-posts pill, freeze-on-hover, staleness states.
10. **Action resolution.** Story collapse, the safety-gated count, fee and slippage disclosure on both paths, promotion pulse and retraction demotion. Depends on `coin_matches`.
11. **Rail posts mode**, then the **detail sheet** with score decomposition, then the **compare surface** for n≥2 — mints ordered by score, `first` badge on the earliest, per-coin safety state, per-coin Buy each with its own confirm.
