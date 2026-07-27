## 03. The Story page

**What it is.** `/story/[id]` is where a user settles two questions — "is this real?" and "am I early or late?" — and then takes exactly one action. It is a routed page, not a modal: the lead-time claim is unfalsifiable without a URL a stranger can open and check, and the discussion layer lives here.

### How it looks

Two columns on `#060607`. Left is evidence, one document scroll. Right is the persistent rail, which on this route opens on a fourth tab mode — **Discussion** — beside the existing tape modes. The rail does not disappear here; a trader sits on this page longest and no terminal hides the tape on its analysis view. With zero comments the rail stays on the tape and the invitation becomes a 52px "Add your take" strip pinned under the coin section, where a first commenter will actually see it. Full-width amber bands sit above everything when they apply: stale pipeline, then coinability `no_create`.

**Head**, 52px: a back chip carrying the real referrer (`← Live feed`, `← Search`, `← You`), the title in Clash Display 30px clamped to two lines, then `☆ Follow`, a copy-link button that flashes lime for a second, and a chip reading `live` or `stale 34m`.

**Verdict bar**, 84px, five cells with hairline dividers. A readout, not a control.

| Cell | Shows |
|---|---|
| LEAD TIME | Our record, mono 24px: `+31m` lime · `−12m` red · `+2h14m` cyan · `unmeasurable` amber · `not promoted` dim |
| YOUR CLOCK | `promoted 4h12m ago · 2 coins since · you are not early` (amber) / `promoted 6m ago · no coin yet · you are ahead` (lime) |
| STATE | Dot + lifecycle word, sub `posts/5min 14 → 22` |
| REACH | `2.4M` · `1.2K/min` |
| COINS | `1 confirmed` / `0 confirmed · 2 unverified`, coloured to match the section below |

Those first two cells are the correction that matters most. `+31m` is a fact about the detector, frozen at promote; it says nothing about whether the head start still belongs to the person reading. YOUR CLOCK is `now − promoted_at` against `count(confirmed)`, and it is the only number that answers "am I early." They never share a component, and the sticky action bar never renders `+31m`.

**Source post**, 132px: 96px media with a `from video` / `no media` chip, then handle, followers, platform, clock time, three lines of text, and `2.4M views · open post ↗` in cyan mono. The card links to the real permalink from `platform_post_id`; if that id is missing no link renders and a footnote reads `permalink unavailable for this post`. We never synthesise one.

**Virality grid**, 62px, seven cells — mono value, 9.5px uppercase label, 30-minute delta: VIEWS `2.4M` `+310K/30m` · REPOSTS `5.4K` · LIKES `115K` · REPLIES `8.2K` · AUTHORS `14` `+4/30m` · PLATFORMS (marks, no number) · AGE `4h`.

**The coin section** — the action, fully above the fold at ~574px on a 1440×900 screen. One panel shell in every state. A count chip in the header carries the state's signature so a zero never reads as an error: `NO COIN` dim, `1 CONFIRMED` lime, `0 CONFIRMED · 2 UNVERIFIED` amber. The primary is always bottom-right, 40px, min-width 168px; only the label moves.

*No coin* — the panel tints cyan, the only state that does. "No coin exists for this story." Prefill chips `$FERRY from post` (cyan) or `$FERRY suggested` (dashed — the only place in the product an LLM-suggested ticker may appear). Primary: **Create coin**.

*One confirmed* — a match chip in categorical words only, `matched · image + name · minted 4m after the post`. No percentage is ever rendered beside an actionable control. The row: 36px logo, `$HORN` + name + copyable truncated mint, MCAP `$799.6K`, LIQ `$41.2K`, AGE `2h`, then **Buy $HORN**, which navigates to `/coin/<mint>`. Stories never buy; coins buy. An ADOPTED match shows its real age in amber and adds "This coin existed before the story. It was not made from it."

*Two or more confirmed* — a ranked table, `# | | Coin | Mcap | Liq | Age | Δ from post`, three rows and a `+2 more` that expands in place. **No per-row Buy chips**: N Buy controls in a table is the exact ambiguous state the one rule deletes. Rows navigate, nothing more. Default sort is `mint_time ASC` — "the first one made from this story" — because sorting by market cap systematically demotes the freshly minted derived coin, which is the coin the pipeline exists to find. `FIRST` (cyan) marks the earliest mint. `BIGGEST` (lime) marks row 1 only when `mcap[0] >= 2 × mcap[1]` and both are non-null; otherwise nothing is badged and a line reads "No coin is clearly biggest — the top two are within 2×." Printed beneath: `FIRST = made from this story before any other. BIGGEST = most money in it.` Primary: **See the 3 coins**.

*Unsure* — the hardest one. The panel is not dimmed and not greyed; grey reads as broken. Region 1 is full brightness and cyan-tinted exactly like the no-coin state: "No confirmed coin for this story." with an enabled **Create coin**. The page's centre of gravity stays a live cyan button, and that is what stops the state from looking like a failure. Region 2 sits below a dashed rule under an amber `UNVERIFIED CANDIDATES · 2`: "These mints share a ticker or a name with this story. We could not confirm they are related." Candidate rows carry an amber left bar, a placeholder glyph rather than the token's logo (a logo borrows credibility we declined to grant), mcap and age one contrast step down, a channel readout `ticker matches · name does not · image not checked · minted 3d after the post`, and one action: **View anyway**. Buy does not exist in this region at any size.

Fees sit in the section footer, always: `Insidor takes 50 bps on trades routed from here — the floor, not an estimate.` The create line reads "Creating costs about 0.021 SOL in rent and fees, quoted live. The fee split is not final." We do not print "you keep 50% forever" while that is undecided; when it lands, all three shares render together — `you 50% · the poster 40% · Insidor 10%`.

**Momentum**, 172px: a cyan filled views area with lime posts-per-5-min bars behind it — the acceleration signal the trigger actually uses, visible because views can climb while the rate collapses. Markers: PROMOTED cyan solid, FIRST CT POST amber dashed, FIRST MINT lime dashed. Beneath, the lifecycle word in Clash with a 3px coloured bar and then a mono readout, not a paragraph: `R̂ 1.40 · v 0.52/min · g +0.020 · 22 posts/5m · 2 platforms`. The page keeps exactly two sentences of English — the lead-time claim and the outcome verdict — because both are falsifiable assertions and should read as such. Everything else tabulates.

**Lead-time proof**, 92px: four marks with the gaps on the connectors — `FIRST POST 14:02` —9m— `WE SAW IT 14:11` —**+31m**— `FIRST CRYPTO POST 14:42` —+3m— `FIRST MINT 14:45`, the lead connector 2px lime. Below it the claim sentence, two external permalinks, and always the provenance footnote: `measured against 41,208 mints streamed + 300 crypto accounts polled every 2 min · t_crypto = first of either`.

Then the **outcome band** when the story is finished, and the **posts table** last: `# | | Post | Views | Reposts | Δ30m | Age`, sortable, rows opening externally.

### How it works

The primary is one pure, unit-tested function with no I/O:

```
confirmed = matches.filter(verdict === 'CONFIRMED' && mint_time && ticker && mint)
0 → Create coin     1 → Buy $TICKER     2+ → See the N coins
```

`unsure.length` is in the return value and nowhere in the branch condition. The `ticker` guard is load-bearing: ticker comes from `narrative_tickers`, which enrichment truncates and re-inserts every cycle, so a page load racing a cycle would render `Buy $undefined`. Ticker and name are denormalised onto `coin_match` at match time so the button never reads a table that can vanish underneath it.

Lead time is `t_crypto = min(t_mint, t_ct)`, `lead_min = (t_crypto − promoted_at)/60000`, with `promoted_at` written once and never recomputed. Negative renders `−12m` red, the marks reorder so crypto sits left of us, and the sentence is "Crypto got here first. The first crypto mention was 12 minutes before we promoted this." No hedging adverb exists in that path.

Gap detection has to be symmetric or the number is a lie. `mint_stream_gap` **and** `ct_poll_gap` are both written by a supervisor; if either overlaps `[promoted_at, t_crypto]` the verdict is `unmeasurable` and the story leaves the aggregate record. `+2h14m and counting` additionally requires both clocks green for the whole window — a live-incrementing cyan earliness claim generated by a dead poller is the worst failure available here. The existing `ct_pickup` boolean is a second, regex-based definition of the same event; one is canonical and the provenance line says which.

The momentum series is a rollup **table** in 5-minute buckets, written incrementally by the snapshotter with last-observation-carried-forward per post — not a matview over raw snapshots. Posts are sampled on a per-post geometric grid, so summing by minute makes the story's total drop whenever fewer posts happened to snapshot. `v`, `v_peak`, `g` and `R̂` all read off that series, so COOLING would fire on a sampling artefact and the page would print "window narrowing" over a story that is accelerating.

Staleness is per-worker with a work-done check, not `max(ran_at)`. The one outage that has actually happened — X ingestion dead while the snapshot and trends crons fired normally with zero results — reads as `live` under a global max. So: stale if the ingest worker's last cycle is over 10 minutes old, **or** the last six ingest cycles ingested zero, **or** the last three snapshotter cycles wrote zero. The band names the dead lane: "X ingestion last produced a post 34 minutes ago."

Realtime does not use `postgres_changes` on `comment`. That stream ignores the read-path status filter and would broadcast every address-gated and silently dropped row to every client — delivering the spammer's contract address faster than an unmoderated feed. Comments broadcast from the insert handler on a server-owned channel, sanitised row only, after the status check.

A second channel, `coin:<narrative_id>`, carries the transition the product exists to occupy. The button does **not** mutate under a travelling finger: it freezes, and a 44px cyan interstitial appears — "A coin was just made for this story. $HORN, 40 seconds ago." with an explicit **Show it**. Demotion uses the same pattern in reverse. `/create?story=<id>` is gated server-side on a fresh `count(confirmed) = 0` at submit, so nobody pays to duplicate a coin the page was hiding.

Discussion sorts `snap_views ASC, created_at ASC` — earliest means *written when the story was smallest*, not oldest by clock. Each comment carries a stamp frozen at insert, one line with ellipsis: `posted when 340K views · no coin yet · 40m old · early`. Three facts at zero coins, four when a coin existed; `$0 mcap` reads as a bug, not a fact. Every snap column including `snap_early` is written once and guarded by a BEFORE UPDATE trigger — computing `early` at render against live views would let the badge drift monotonically in the author's favour as the story grows.

The position badge is read once server-side at write time and stored as raw amount, decimals and mint: `holds 2.1M $HORN`. Not SOL — native SOL is unrelated to the coin, and SOL-denominating a token position needs a price quote we do not fetch. A failed read renders `position unknown`, dashed, never `no position`.

The address gate blocks **every** base58 run of 32–44 characters, including this story's own mints. There is nothing a user can say with a contract address that they cannot say with `$KANG`, which is already auto-linked — and letting UNSURE mints through was the page's highest-value shill vector, since landing a copycat in the abstain band is the expected path, not an exploit. The run is replaced inline with the ticker chip and the comment posts. The client check is a courtesy; the server runs the same function and is the enforcement, shipping in the same release as the composer.

Outcome classification runs nightly on `now − promoted_at > 48h` regardless of lifecycle: gap → UNMEASURABLE, 0 confirmed → NO_COIN, `lead_min < 0` → LATE, `peak_mcap >= 250K` → HIT, else DUD. A story whose snapshots stop terminates as `lifecycle_reason = 'starved'` after six quiet hours — otherwise `v` goes NULL, neither DEAD predicate fires, and misses never enter the record while hits do. A monitor holds `count(outcome IS NULL AND promoted_at < now − 72h)` at zero.

The share card branches on state: `no_create` emits the title, "A story on Insidor" and a generated placeholder — no lead-time claim, no coin count. Negative, unmeasurable and not-promoted stories never emit a boast. Images are generated from our own palette, never hotlinked.

### States

| State | What the user sees |
|---|---|
| Loading | Skeletons for the verdict bar and source post; the coin section a 96px pulsing block with its label already in place; discussion on its own boundary so a slow query never blocks the evidence |
| First visit | Cell 1 gains "before the first crypto account mentioned it"; the count chip gains a one-line gloss; the Earliest definition renders inline instead of on hover. One story, dismissed on any interaction |
| New token, pool unindexed | `indexing…` with a pulse in MCAP/LIQ, `NEW` badge, Buy enabled |
| New token, bonding curve live | `— · no trades yet`, "you would be the first buyer" — enabled only after a real Jupiter quote returns a route |
| New token, no route | Primary becomes a disabled-with-reason line: "Not tradeable yet. Watch it." plus Follow |
| Unverified match | Amber region, `View anyway` only. `/coin/<mint>?unverified=<story_id>` names the referring story; the warning belongs to the (story, mint) pair, never the mint alone |
| Coin arrives / match demoted while open | Button freezes, cyan interstitial, re-render only on click |
| Story with no coin | Every stamp reads `no coin yet`, every badge `no coin to hold`, `· early` common. A cyan divider marks where the first coin appeared, once it does |
| Negative lead time | `−12m` red, timeline reordered, "Crypto got here first." The outcome band later reads "We were 12 minutes late." Every region agrees |
| Unmeasurable | Amber dashed: "The mint stream dropped from 14:31 to 14:52. We will not claim a number we could not verify." |
| Not promoted | `not promoted`; the timeline is replaced by one line. `created_at` is never substituted |
| Already hot | Dim dashed chip: "We first saw this post already large. Excluded from our lead-time record." |
| Stale pipeline | Amber band naming the dead lane; REACH stops animating and gains a `stale` chip. Numbers still shown, all labelled |
| Match run stale, not absent | "Coins last checked 3h ago" — never a confident "No coin exists" that is merely old |
| Matching not yet run | "Checking for coins…", no button, times out to the no-coin state after 60s with a footnote |
| Coinability `never` | 404. Not a hidden page, not an empty state |
| Coinability `no_create` | Full page, discussion open, amber band: "…You can discuss it here. Insidor will not help you make a coin from it. Coins that already exist are listed below and we earn a routing fee if you trade them." No primary button — not a disabled one |
| Wallet not connected | Fully readable, Follow works, composer collapses to a 40px connect row, the primary keeps its label and opens Privy first |
| Insufficient SOL | The Create primary carries a sub-line with the shortfall — before the sheet, not at signing |
| Never traded | Pre-stamp reads `no position` as a neutral uncoloured fact, not a judgement |
| Position read failed | `position unknown`, dashed. A chain read never blocks a post |
| Blocked / held comment | Struck through with a red note, visible to its author only. Everyone else sees nothing |
| Empty discussion | "No takes yet." plus the pre-stamp as invitation, inside the collapsed strip under the coin section |
| Merged while open | "This story was merged into another cluster" + link to the survivor; the comment channel closes rather than writing to a dead id |
| Post deleted upstream | Red left bar: "This post has been deleted. Last seen at 2.4M views, 14:41." |
| Momentum series empty | "Too new to plot — first snapshot at t+4m"; the state word still reads "Just spotted" |
| Reduced motion | Tick animations, flashes, arrivals and the 60s counter resolve instantly to their end state |
| Not found | "No story with that id. It may have been merged into another cluster." Merged ids 301 to the survivor |

### What it needs

Usable now: `narratives`, `narrative_posts`, `narrative_tickers`, `post_snapshots`, `post_meme_scores`, `worker_cycle_log`. Note that `distinct_authors`, `author_velocity`, `ct_pickup` and `subject_entity` **do exist** (`worker/schema-replication.sql`, written by `cluster-persist.js`) despite being absent from `docs/schema.md`; `narrative_tickers.mint_ca` has a migration and a writer but its application to the live catalog is unverified — and the coin query, the one rule and the address gate all sit on top of it. Regenerate `docs/schema.md` from the live catalog before step 1 and re-derive this list.

Missing: **`coin_match`** (narrative_id, mint, verdict, relation, **ticker**, **name**, per-channel scores, strong_channels, mint_time, delta_min) · earliness columns on `narratives` (`promoted_at` with an immutability trigger, `t_mint`, `t_ct`, `first_crypto_post_url`, `first_crypto_handle`, `first_post_at`, `earliness_eligible`) · `coinability_tier` and `coinability_reason` · the social layer (`app_user`; `comment` with the snap columns plus `snap_early` and the three position columns; `comment_vote`; `holding`, without which `sold` is indistinguishable from "never bought") · the 5-minute rollup table plus an index on `post_snapshots (post_id, captured_at)`, verifying `captured_at`'s real type first · `mint_stream_gap` and `ct_poll_gap` · outcome columns (`outcome`, `lifecycle_reason`, `peak_mcap`, `current_top_mcap`) with `ticker_mcap_series` sampled every 5 minutes for 24h · `narrative_tickers.source`, so a suggested ticker can be a Create prefill and never a coin. `narratives.search_series` is the fabricated sine wave and must never render here.

### Build order

1. **Schema.** Regenerate the schema doc from the live catalog, then one migration for the earliness and coinability columns. Backfill `promoted_at` only where recoverable; render "not promoted" everywhere else. Ships nothing; unblocks everything.
2. **Route and evidence, read-only.** Head, verdict bar (LEAD TIME reading "not promoted" until step 3), source post, virality grid, posts table, branched OG metadata. Delete `renderNarrativeModal()` and repoint every narrative click at the route.
3. **Momentum and lead-time proof.** The rollup table and snapshotter write, lifecycle with hysteresis and the starved terminal, the chart, the mono readout, the four-mark timeline including negative and unmeasurable — and both gap tables in the same PR, because without them every lead time is silently inflated.
4. **`coin_match` and the coin section.** Pipeline writes, denormalised ticker, `min(pairCreatedAt)` across all pairs, fail closed on null mint_time. Then the four states, the evidence popover, the quote probe and the fee footer. Until this lands the page can only show NONE or ONE — say so in the PR, do not fake it.
5. **Discussion.** `app_user` + `comment` with every snap column and its trigger, the insert handler, the composer with its pre-stamp, and the address gate client and server. Stamp and position badge ship here too — snap columns are unrecoverable after the fact.
6. **Moderation ladder** beyond the gate: impersonation hold, new-wallet limit, velocity drop, speed limit with countdown, report menu, author-only visibility.
7. **Realtime**: server-owned comment broadcast, the `3 new ↑` pill, and the coin channel with freeze-and-interstitial in both directions.
8. **Outcome band**: mcap sampling, the nightly classifier on the 48h rule, the band, and Search's Finished chip defaulting to All.
9. **Votes and one level of replies.** Last on purpose — the stamp is the better ranking signal and votes are farmable. Ship the stamp for eight weeks before deciding whether the vote button earns its place.

One thing stays open: whether stories keep their lane inside Live feed or graduate to their own tab. This page is unaffected either way — only the back chip's default label changes.
