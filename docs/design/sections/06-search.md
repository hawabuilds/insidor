## 06. Search and Watchlist

**What it is**

One box that takes a contract address, a `$TICKER`, an `@handle` or plain English and answers one question: does a coin already exist for this, and if so, which one is real. The star (★) is the other half — it turns "I'm waiting on this" into a notification the moment a watched story actually mints. Search is the anti-duplicate surface; the star is what you press when search tells you nothing exists yet.

---

**How it looks**

Tab two of three. Near-black page, one 56px input across the column, cyan focus ring, and inside the field on the right a small mono chip reading `CONTRACT`, `TICKER`, `POSTER`, or nothing. That chip is the entire mode UI — the user never picks a mode, they watch which one fired.

Under it, a chip rail with live counts: **All · No coin yet (34) · Crypto hasn't seen it (11) · Just made (12) · Trending now (28) · Finished (214)**, scoped to the query or global when the box is empty. `No coin yet` is the default view: every promoted story nobody has minted, sorted by how fast it's spreading, Create one tap away. Below, a mono strip — `34 results · 88ms · updated 4s ago` — plus one disclosure, `results with a tradeable coin rank slightly higher`. When the pipeline is behind, an amber band: *"Pipeline stale — newest post is 47m old."*

Results are **sectioned, not interleaved** — three object types, three column grammars, and a terminal user scans columns. The winner is lifted into a normal-height row with a 2px cyan left edge, a reason (`exact ticker match`) and a right-aligned button; suppressed when the top two scores land within 8% of each other, and suppressed entirely when the winner is a coin with no story, because "exact ticker match" is not an answer to "is this the real one."

**Stories (≤6):** rank · 56px thumb · title with `<mark>` hits over a one-line snippet · views with `1.2K/min` beneath · age since `promoted_at` · Lead (`+31m early` lime / `−6m late` red / `live`) · action. Rows target 54–60px; twelve results above the fold at 900px is an acceptance criterion, not a preference. Lead is sortable everywhere it appears.

**Coins (≤8):** `# · Token · Price · 24h · Mcap · Liq · Age · MATCH · Story · action`. The Story column is the whole differentiator against DexScreener and it is an independent link. MATCH is categorical — `CONFIRMED` lime, `UNVERIFIED` amber, `ADOPTED` cyan, `NO STORY` grey — and clicking it opens the evidence: the post's image beside the token logo, `minted 4m after the post`, and which channels fired as words (`image + name`). The numeric score is stored for calibration and rendered nowhere.

**Posts (≤10, folded to 3):** platform badge · two lines of post text · `@handle` + followers · views · age · `↗ post` `→ story`. Never a Create button on a post row — creation is always anchored to a story.

**A pasted address** drops the sections: a compact identity card (52px logo, `$SYM`, truncated mint with copy, price and 24h) over a strip of 5m · 1h · 24h · Mcap · Liquidity · 24h vol · Holders. Under the ticker, the MATCH stamp and one plain clause — *"matched · image + name · minted 4m after the post."* Then the origin story, then **Posts containing this address** (your "search a CA, the post appears," which mechanically is the strongest evidence channel the matcher has), then a collapsed same-ticker family when two or more coins share the symbol. At the bottom one dim line: `resolved from our index · 4ms` or `resolved live from DexScreener · 240ms`. A terminal user needs to know whether they're reading indexed truth or a cold single-source lookup.

**`$FERRY` is the anti-duplicate screen, and it is a sentence** — a full-width band, Clash 20px, one of six:

| Situation | Verdict |
|---|---|
| No live mint | `$FERRY is free on Solana — you'd be first.` (lime) |
| 1 mint, matched | `$FERRY exists. 1 coin, matched to a story.` (cyan) |
| N mints, 1 matched | `$FERRY exists 4 times. 1 is matched to a story.` |
| N mints, none matched | `$FERRY exists 4 times. None matched to a story.` |
| N mints, 2+ matched to **different** stories | `$FERRY exists 4 times. 2 are matched to different stories — we can't tell you which one you mean.` |
| Lookup failed | `We couldn't check whether $FERRY exists right now.` — Create **suppressed** |

Beneath it the collision line, in words and never a number: *"PUMP is a common ticker — 4 live coins share it."* Then the family table — `# · Mint · Name · Age · Mcap · Liq · Vol 24h · MATCH · action` — **sorted by mint time ascending**, earliest row badged `FIRST`, with a caption saying why: *"oldest first — the first mint is usually the real one."* Every competitor sorts by volume, which ranks whichever copycat got pumped. Buy appears only on rows that are confirmed *and* currently tradeable, and nowhere at all in the fifth case. Below: stories proposing `$FERRY` with no coin, each tagged `cashtag` (someone typed it) or `suggested` (an LLM proposed it). Then Create — full-width primary when the ticker is free, demoted to a dim link *"Make another $FERRY anyway →"* when a coin exists. Demotion, not removal.

**Zero results** is the best state in the feature: *"Nothing called 'ferry horn' yet. No story, no post, no coin. That is usually the good news."* + `Make the first $FERRYHORN coin`, prefilled.

**The star** sits inline in every row and as `☆ Watch` / `★ Watching` on story and coin pages. No wallet, no account — saved against a device id, claimed on first login. It never silently converts: when a watched story mints, the follow stays a *story* follow (a story can mint again) and an explicit `+ Watch $CUPS too` writes the second row. **/you** stacks by urgency, empty sections unrendered: **Just minted** (confirmed in 24h, unopened, lime-pinned) · **Waiting — no coin yet** · **With coins** · **Coins you watch** · **Gone quiet** (collapsed, `Clear all 7`). Watchlist rot is the real reason watchlists get abandoned. The empty state teaches — *"Tap ★ on any story and we'll tell you the moment somebody mints it. No wallet needed."* — then three **real live rows** starrable in place, and one honest stat: *"Last week, 61% of watched stories got a coin within 3 hours. 34% never did."*

**The notification** is a 380px toast, lime edge. Line one is the story then the ticker — *"Wrong Name is now $CUPS"* — because the user followed a story and must recognise it before parsing a ticker. Line two: `Minted 2m ago · $18.4K · you're 31m early`; when the lead is negative, same slot, same size: `crypto traders got here 6m before us`. Two buttons, and above the primary — always, at the weight of the lead line — `fee 0.50% · impact 2.3% · you get ≈1.42M $CUPS`. If the toast can't render a live quote it navigates instead of trading; 400ms is not worth an undisclosed fee on a push-driven buy. Miss it and the next open shows a **while-you-were-away** band at position one, which is also the only place push permission is ever asked.

---

**How it works**

`parseQuery` is pure and ordered: 32–44 base58 chars decoding to exactly 32 bytes → CONTRACT; `$XXX` → TICKER; a bare 2–13 alphanumeric word → **ambiguous, run ticker and text and section both**; `@handle` → POSTER; else TEXT. Ambiguity is resolved by showing both, never by guessing. A pasted CA skips the 250ms debounce — a pasted address is never exploratory.

Three retrievers fused by Reciprocal Rank Fusion, because `ts_rank_cd`, trigram similarity and cosine distance sit on incomparable scales and normalising them needs a calibration set we don't have. FTS carries relevance; trigram at 0.30 (0.18 on ticker columns, since ticker drift is one or two characters) carries FERRY/FERRIE/FERY; pgvector carries paraphrase. Each returns its own top 100; `RRF = Σ w/(60+rank)`, weights 1.00 / 0.60 / 0.80. Eligibility is hoisted into **one** `eligible_narratives` CTE — `promoted_at IS NOT NULL`, `status IN ('open','dormant')`, `coinability_tier <> 'never'` — that all three legs join, posts and coins inheriting from their narrative. A tier-`never` story must not be reachable through the vector leg because somebody paraphrased its title; a CI test seeds one and asserts zero rows.

`score = (0.70·rel + 0.30·vir) × boost × typePrior`, where `rel = RRF/max(RRF)` and `vir = ln(1+heat)/ln(101)`. There is no separate recency term — heat is already age-decayed and p95-normalised, and a third decay penalised a 90-minute story three times over. What replaces it is the thing that *is* the product: ×1.20 when `t_crypto IS NULL` (crypto hasn't touched this), ×1.10 when `lead_time_min > 20`. Also ×1.35 exact ticker equality, ×1.15 query-in-title, ×1.05 for ≥1 confirmed coin (disclosed on screen, measured in `search_log`), ×0.60 when `needs_review`. Relevance dominates because a search box that reorders your query by popularity is a trending board wearing a search box. Earliness is a boost, a sortable column *and* a chip — otherwise this is a generic screener any company with no detection pipeline could ship.

Snippets come from `ts_headline` but **not as HTML** — Postgres doesn't escape the source document and that source is scraped social text. Delimiters are sentinel control characters; the fragment is escaped client-side, then split and rendered as real `<mark>` elements.

The CA ladder is four rungs, each a write-through cache: `narrative_tickers.mint` (~4ms) → `coin_index.mint` (~4ms) → live DexScreener (~250ms) → RPC owner check (~120ms; a non-token owner renders *"That's a wallet, not a token."*). `mint_time` is `min(pairCreatedAt)` across **all** pairs, never the best pair; missing means `null`, never `0`. In parallel with every rung: `posts WHERE text ILIKE '%mint%'`. The lookup layer returns a discriminated `status: 'found' | 'absent' | 'unavailable'`, never a boolean — today a DexScreener 429 and a genuinely free ticker are the same value, which means under load, on the hottest ticker, this screen renders "you'd be first to deploy it" and a full-width Create button. A zero-liquidity mint is a coin that exists — exactly the case this screen is for — and returns `found` with `hasMarket: false`.

**One resolver, eight surfaces.** `resolveAction()` takes two inputs, not one: confirmed identity **and** current tradeability. 0 confirmed → **Create** (or a non-interactive `Not mintable` pill at tier `no_create`). 1 confirmed and tradeable → **Buy $FERRY**. 1 confirmed, not tradeable → **View** + `liquidity gone` or the red `Risky` pill. 2+ → **See the 3 coins**. Unsure only → primary stays **Create**, candidates show `UNVERIFIED` and `View anyway`, and Buy is not rendered at all. `match_status = 'confirmed'` is an identity assertion, not a tradeability assertion, and it never expires — a rugged coin would otherwise render Buy forever. Tradeable means liquidity above zero, no hard safety gate (mint or freeze authority, top-10 over 60%, live under $3k liquidity, zero sells against 30+ buys) and price under five minutes old. Every market number carries a freshness treatment; a 40-minute-old mcap must not render identically to a two-second-old one.

**Notifications** fire on `confirmed_coin_count: 0 → ≥1` and only on `confirmed`. Unsure never notifies — pushing "your story minted" on a 0.6-confidence match is what the abstain band exists to prevent. An unsure that later promotes fires in-app only, with the honest lead (*"we confirmed this 40m after it minted"*).

```
dedupe_key = coalesce(user_id::text,'dev:'||device_id) || ':' || narrative_id
             || ':' || floor(extract(epoch from now())/21600)::text   -- NOT NULL
topic      = coalesce('user:'||user_id, 'device:'||device_id)
```

Anonymous device follows are the highest-volume follower class and get the same delivery path. Coins confirmed within 90 seconds coalesce into one message — swarms mint three to eight in under a minute — and 2+ makes the copy *"Wrong Name got 3 coins in 90 seconds"* with `See the 3 coins`. A mounted toast **subscribes** to its narrative's confirmed count rather than snapshotting it; a second coin landing past the window re-resolves the button with an amber flash and *"another coin just appeared."* Budget, mint to glass: p50 under 20s, p90 under 60s — a product requirement, not an SLO. Two alerts serve the thesis better and ship alongside: **window closing** (`t_ct` fires while confirmed count is still 0 — crypto found your story and there's still no coin) and **accelerating** (heat rank crosses into the top N, one per story). The first is the most on-thesis message we can send, and it drives Create.

**The honest record** (`Finished`) states its denominator and defaults to All as a route constant, not a remembered preference: `Stories 214 · got a coin 71% · never did 29%`, then `Of the 152 that got a coin: early 61% (median +23m), late 34% (median −7m)`, then a permanent `Abstained 22%` cell, amber only above 30%. Columns: `# · thumb · Story · We saw it · Crypto saw it · Lead · Coin · Outcome · Proof`, with absolute clock times, Lead sortable ascending in one click, and Proof as two external permalinks that belong to somebody else. No `Peak mcap` column and no `FLAT` outcome until `coin_snapshots` exists — a last-observed value labelled "peak" is a fabrication.

---

**States**

| State | What the user sees |
|---|---|
| Empty box | The `No coin yet` list + six Try chips seeded from live data (2 hot tickers, 2 entity words, 1 recent CA, 1 handle) — never hardcoded |
| First-ever visit | *"Search what you saw on TikTok"* above the input, and a dismissible strip naming the four non-obvious columns: Ticker, Velocity, Lead, Match |
| Zero results | *"Nothing called 'ferry horn' yet… That is usually the good news."* + `Make the first $FERRYHORN coin` |
| Story with no coin | The normal case. `Create coin` primary; ticker cell shows the proposed cashtag or `no ticker` |
| Unverified match | Amber `UNVERIFIED`, candidate shown, `View anyway`, Buy not rendered, primary stays `Create` |
| Confirmed but not tradeable | `View` + `liquidity gone`, or the red `Risky` pill. Never Buy |
| Two mints confirmed to two stories | Fifth verdict sentence; every family row gets `View`; no Buy on the screen |
| Brand-new token, no market | Price / 24h / Mcap / Liq all `—` in grey, never `0`, never a green chip; `no market yet` under the ticker. Buy stays enabled — a bonding-curve buy is valid |
| `mint_time` null | `Age: unknown`, MATCH forced to `NO STORY`, Buy suppressed. Fails closed |
| Lookup unavailable (429 / timeout) | *"We couldn't check whether $FERRY exists right now."* Create suppressed + retry. Never "you'd be first" |
| Valid address, nothing anywhere | *"Valid Solana address. No pair, no story, no post. Nothing has traded."* A result with the address echoed, not an error toast |
| Address is a wallet | *"That's a wallet, not a token."* + `View trader →` |
| Negative lead time | `−6m late` in red, same slot and weight as `+31m early`; on Finished, a grey line: *"Crypto traders got here 6 minutes before us."* |
| Tier `never` | Absent entirely — no row, no count, no gap, no trace |
| Tier `no_create` | Row renders; action is a non-focusable `Not mintable` pill with *"Public tragedy — discussable, not mintable."* The story page still opens |
| Story aged out | One grey row: *"This story closed 12 days ago — see it in Finished →"*, not an empty page |
| Stale pipeline | Amber banner, results still render. If nothing passes the freshness gate, fall back to most-recent and say so |
| Degraded vector leg | Many narratives have no embedded post, so the meta strip reads `semantic recall partial` rather than implying full coverage |
| Search error | *"Search is down. The board still works."* + retry. Chips stay usable — plain table queries that bypass the fused function |
| Wallet not connected | Everything renders. ★ works via device id; Create opens connect inside the flow. Only the signature gates |
| Watchlist empty | The teaching state: copy, three real starrable rows, the honest 61% / 34% stat |
| Anonymous follower | Fully functional; a dim `saved to this device` once, on the first follow ever; delivery on the device topic |
| Story merged | Follow repoints to the survivor with a `merged into <title>` caption for 24h — the one case where the target changes, and it is disclosed |
| Held for quiet hours | Every number recomputed at render: *"Minted 8h ago · $4.1K now (was $18.4K) · we told you 31m before crypto, 8h ago."* Never a replayed payload |
| Match retracted | In-app correction — *"we were wrong about $CUPS — it is not from this story"* — in the away band, original notification marked corrected |

---

**What it needs**

On `narrative_tickers`: `mint` — but **verify first** whether the live catalog already has `mint_ca`. `docs/schema.md` lists it and was generated from a live probe; the claim that it's absent is unverified, and if it exists we rename rather than adding a second column for one concept. Then `source` (`cashtag|llm|mint_in_post`), `relation`, `match_status`, `match_score` (stored, never rendered), `match_channels` jsonb, `mint_time` nullable. Without these, every Match stamp is a lie and the primary button can't be computed — today it keys off `ticker && mcap != null`, the string matching that produced the live `$KANG` and `$PUMP` bugs.

On `narratives`: `promoted_at` (set once, never overwritten — the clock every lead-time claim is measured from; `created_at` moves on merge), `heat` / `heat_rank`, `coinability_tier`, `needs_review` / `coherence`, `search_doc` + GIN, `search_vec` + HNSW. Verify the embedding dimension **and model** against `post_embeddings` before writing the vector leg.

New tables: `coin_index` (search can't answer "how many $FERRY coins exist" without it; holders belong here as a refreshed column with a `captured_at`, not one Helius call per visible row) · `app_user` · `follow` (+ `device_id`, `notify_mint`, `muted_until`, `last_notified_at`) · `notification` (+ `corrected_at`) · `push_subscription` · `notification_prefs` · `search_log` (ship with v1 or the weights stay guesses) · `coin_snapshots` · `story_outcome` · and the clocks `t_mint` and `t_ct`, which are designed and **persisted nowhere** — meaning today's `+31m early` badges have no prospective clock behind them.

Do not use: the `combined_views * 0.14` gain fallback or its sibling `searchSeries` delta, both invented data currently driving search ordering, and `PENDING{}`, never populated but read by five render paths. The extended search row is `.ttr-narr`; the existing `.sr-narr` is a two-column thumb-and-text row and reusing the name is a live selector collision. Roughly fifteen components here are new, not two.

---

**Build order**

1. **Migration A** — the columns above, `mint` backfilled from the DexScreener path the lookup already resolves and discards. Nothing else ships first: every screen computes its button from a number that doesn't exist yet.
2. **Rework the lookup layer** (~60 lines, gates five screens): `null` not `0` for absent numerics; `mintTime` as absolute `min(pairCreatedAt)` over all Solana pairs; stop treating `liquidity <= 0` as not-found; return the discriminated status. Update the three consumers.
3. **The resolver** — replace `ticker && mcap != null` with `resolveAction(confirmed, tradeable)` and add the match stamp. Two files, and it kills the live "Buy $KANG" bug on every surface shipping today.
4. **Migration B** — generated tsvectors + GIN, trigram indexes, `search_log`. No UI.
5. **/search free text**, FTS + trigram only: sections, the sentinel-escaped snippet path, the zero-result Create block, and `?q=` in the URL — the app's first linkable route.
6. **CA mode** — the four-rung ladder, the mint-in-post band, fail-closed on null `mint_time`.
7. **$TICKER mode** — family table by mint time ascending, all six verdicts, and the availability line lifted verbatim from the create sheet so the warning can't drift between the two.
8. **⌘K palette** as a strict projection of `/search`: same parse, same query, same ranking, thirteen rows, navigate and star only. It cannot buy and cannot create; on `/search` itself ⌘K just focuses the field.
9. **Migration C + Following** — `app_user`, `follow`, `notification`, `notification_prefs`; ★ on one store with an optimistic toggle; then the Following sections and the teaching empty state. Ships before any notification — the list is useful alone and it's what the notification will point at.
10. **The notification, in-app only** — trigger, dedupe key, coalescing, live-subscribed toast, fee line, away band. The retention hook; it must not wait behind push.
11. **Web Push** — VAPID, service worker, the earned-moment prompt, quiet hours with render-time recomputation, safety-gate toggle. Measure push→buy via `?src=push` before spending more.
12. **Chips in value order** — No coin yet (blocked on `coinability_tier` being real and evaluated; do not ship a browsable, one-tap-mintable list before then) → Just made with the loud `From a story only` toggle → Trending now.
13. **The two clocks**, then `coin_snapshots`, then `story_outcome`, then Finished with All-default and the stated denominator. A record built from `lead_time_min` alone would be fabricating the product's central claim.
14. **pgvector** as a third RRF leg, A/B'd against real `search_log` click-through.
15. **Coin index (F3.2)** — CA and ticker search over mints that never touched a story, the true collision count, and the rail's live `Matches` mode.

*Still open with you: whether the stories lane stays merged into Live feed or becomes its own tab — the chip rail absorbs Narratives / Tokens / New Pairs either way, but a split changes where `No coin yet` lives.*
