## 05. Creating coins

**What it is**

Creating is what the product does when a story has no coin yet — the other half of the same sentence as buying. The primary button is a pure function of how many coins the matcher stands behind, and at zero it says Create. The job: turn a detected story into a live pump.fun coin in two steps and one signature, with the source post locked at the top so a coin can never be made out of nothing, and with the naming step doing the thing the user can't — knowing which phrase 44 posts are already repeating.

**How it looks**

*Entry.* Not a page. A button that appears only where the coin count is zero: the story footer (`Create coin`), a small `Create` pill in the market-cap column of a stories-lane row in Live feed, `Create Coin` on a viral post row (which carries *that* post, not the story's top post), Search's no-coin-yet rows and empty state, and one quiet secondary on a coin page — `Make your own coin` — for the deliberate second coin. Every one reads a single server row and nothing else: `select can_create, buy_count, unsure_count from story_cta_v where id = $1`. No client-side coinability logic exists anywhere. (The pill sits in Live feed's stories lane today; if stories become their own tab it travels unchanged.)

*Step 1 · Name it.* A 472px sheet — the same width as every other sheet, because this must not read like a fintech onboarding flow to someone who arrived from a ranked table.

Locked at the top: the source post. 42px thumbnail, `@nordkyst_ferge`, two clamped lines of text, and above it a 9px mono label `STORY · CANNOT BE CHANGED`. Down its right edge, three mono cells:

`SPOTTED 31m ago` · `CRYPTO TWITTER not yet` · `STORY accelerating`

`CRYPTO TWITTER` flips to `6m ago` in a red `.timing-pill.timing-late` the moment `t_crypto` fires — same border, size and weight as the early state. No closed `+31m early` badge here: on the create path no coin exists by definition, so lead time is an interval still running, and a closed figure would state a final number for a live measurement. `STORY` reads `accelerating` / `cooling` / `peaked 11m ago` from the lifecycle field the snapshot grid already computes. The question a creator is asking is "is the window still open," and these three cells answer it. They are also the part a competitor can't rebuild without a detection pipeline.

Below: a 96px crop preview left; coin name (32 chars) over ticker (13 chars, `$` prefix, sanitised to `[A-Z0-9]` per keystroke) right. Under them `.namer-why`, the trust line — `named from the phrase repeated in 31 of 44 posts`, or `the cashtag in the post`, or `from the video's on-screen text`. Then three alternative chips chosen for diversity of kind, not next-best score — a compression, an entity, one from a different post — each with dim provenance beneath (`in the caption` / `said in 34 posts` / `from the replies`), and `↻ Try another` with a `2 left` counter.

Then `.coll`, the availability line: `Enter a ticker for your coin.` → `✓ $CHILLGUY is free on Solana — you'd be first to deploy it.`

Then the fixed facts, as a mono key/value block with right-aligned values — not sentences:

```
SUPPLY          1,000,000,000 · FIXED
YOUR SUPPLY     0
FREEZE          NONE
TRANSFER FEE    0
LIQUIDITY       SELF-SEEDED
```

`YOUR SUPPLY 0` is first and deliberate. The most reliable first-timer misconception about a bonding curve is that creating a coin means receiving the coins. With the first buy defaulted to None — which it is — the modal first launch leaves the creator holding exactly zero, and if no screen says so they'll tap Trade on the success screen, see nothing, and conclude they were robbed.

Then the fee split panel (§07) and two disclaimers — `Not created or endorsed by @nordkyst_ferge.` and `Anyone can make a coin from this story, including someone else, right now.` — placed *above* the optional first-buy chips (`None | 0.1 | 0.5 | 1 SOL`, default None), so the load-bearing disclosure is above the fold and the optional field is what scrolls.

Footer: `COST TO LAUNCH ~0.02 SOL ≈ $4.02` left, `Review $CHILLGUY` right. Nothing signs from this screen. The cost label opens an itemised popover ending in `Insidor's cut  0.0000 SOL now — 10% of your fee stream (0.1% of each trade)`, because a breakdown that omits our cut reads as a claim that we charge nothing.

Editing the image expands **inline**, replacing the identity block — never a second modal, since opening one destroys the other. 1:1 crop frame, drag, zoom, Fit/Fill, and for video a scrubber of five frames at 10/25/40/55/70% of duration with the auto-pick outlined in cyan.

*Step 2 · Confirm.* Same sheet, body replaced. 72px image, `$CHILLGUY` in Clash Display. A red-bordered, non-dismissible `PERMANENT` list: ticker and name can't be edited, image can't be replaced, the split is written once, the coin exists on Solana forever — Insidor can hide it, can't delete it. Then mono rows: `Story` (with `↗`), the same three earliness cells **re-read at mount**, `Signed by`, `Creator on-chain` (only when it differs from the signer), `First buy`, `Your $CHILLGUY` (`0` or `about 4,120,000`), `Total cost`, `Your balance after`. Beneath, a pulsing cyan dot: `Re-checking nobody minted this…` → `✓ Still free, checked 2s ago`. Then the loss line in plain muted text, never a red box, because a box gets dismissed and text gets read: `Most coins go to zero. If this one does, you lose the 0.5 SOL you're putting in and earn no fees.`

`Create $CHILLGUY` is the only button in the flow that signs. On press it reads `Waiting for your wallet…`, and backdrop-click and Esc are dead until resolution.

*Signing* replaces the body with four mono rows — upload, sign, land, assign the split. Success is declared on step 3; step 4 failing gives a retryable amber band, never a failure screen.

*Success* gives the lime check, `$CHILLGUY is live`, the line people screenshot (`Just a Chill Guy · made from "Norwegian ferry horn" · 4 minutes after we spotted it`), the full mint with `Copy CA`, Solscan / pump.fun / DexScreener links, a share card, `Trade $CHILLGUY`, and `Done` — which returns to the **story page**, so the user sees their coin in the story's coin list. That's the proof it attached.

**How it works**

*The namer never authors a token.* A memecoin's name is the phrase people are already repeating — WIF keeps the misspelling because the misspelling is the meme; MOODENG is a name; HAWKTUAH is an utterance. So this is retrieval, not generation, and retrieval is ours to do because we hold the whole cluster and pump.fun holds one form.

Stage 0 runs at PROMOTE, no model, ~4ms, cached. Six sources with weights: `cashtag` 1.00 (`\$([A-Za-z][A-Za-z0-9]{1,12})\b` over post text *and* sample replies across the cluster), `onscreen` 0.85 (OCR — on TikTok the caption is the meme more often than the audio), `ngram` 0.80, `entity` 0.75, `llm_prior` 0.35. A base58 mint pasted in a post isn't a name candidate; it's a duplicate signal.

```
distinctiveness(span) = (df_in_story/n_posts) × ln( N_posts_24h / (1 + df_global_24h) )

score(c) = 0.34·w_source + 0.26·min(df_in_story / max(3, 0.25·n_posts), 1)
         + 0.18·clamp01(distinctiveness/10) + 0.12·len_fit + 0.10·(1 − collision_pressure)

len_fit            = 1.0 (4–9ch) | 0.7 (3, 10–11) | 0.35 (12–13) | 0
collision_pressure = clamp01( log10(1 + max_liquidity_usd of live tokens with that symbol) / 7 )
```

`llm_prior` can never be primary without corroboration from one of the other four. Normalisation uppercases and joins with no separator; over-length drops stopwords first (`JUSTACHILLGUY` → `CHILLGUY`), then the most distinctive word, then initials — **never truncate mid-word**, `CHILLG` signals low effort to every trader who sees it. Deliberate misspellings are preserved. `collision_pressure` exists because a symbol already carrying a $10M token makes your coin unfindable — a distribution problem, not a legal one.

One `claude-haiku-4-5` call fires on form open and caches on the story for 20 minutes. It ranks and title-cases grounded spans; it does not invent. Then the gate, server-side — any failure discards the *entire* model output and the deterministic ranking stands: (1) `source_span` must be a case-insensitive substring of the concatenated post text, OCR, replies and entity keys; (2) `^[A-Z][A-Z0-9]{2,12}$`; (3) lengths; (4) not blocklisted; (5) `symbol == norm(source_span)` or a whole-word subset of it — blocks creative leaps, allows stopword-dropping; (6) the generic test. A ticker appearing nowhere in the corpus cannot survive rule 1.

**The same gate runs on any prefilled symbol.** A ticker arriving from a Search row is not privileged because a user clicked it: rules 1, 2, 4 and 6 run before it touches the field, and we only prefill from `narrative_tickers.source IN ('cashtag','mint_in_post')`, never `'llm'`. An ungrounded suggestion drops to alternative slot 3 labelled `suggested, not found in the posts`. Otherwise we'd launder model output as user intent through the front door of the gate we just built.

*The form never waits on the model.* Haiku's p50 is ~700–900ms; the sheet opens in under 100ms on the deterministic #1 with `.namer-why` shimmering. The model result swaps in only if neither field has been touched; if the user typed anything it silently becomes alternative slot 1. The namer is an accelerant, never a gate — even `namable=false` opens the form.

*The image is the post's media, cropped and re-hosted. Never generated.* It's the evidence, and a generated logo severs the visual link that makes the coin recognisable to the next 10,000 people who watch the same video — recognition is distribution. It's also what our own matcher needs: a crop of the post media confirms at `S_img = 1.00` on pHash distance ≤ 6, while a generated logo lands in the SigLIP channel capped at 0.60, **which cannot confirm alone** — we'd be minting coins our own pipeline can't verify. Text-only posts render the post itself in Clash Display on `#0C0C0E`: not art, a screenshot of the evidence, still pHash-matchable.

*The anti-duplicate check* is Search's reason to exist, run inside the create flow — on open, on every 250ms-debounced keystroke ≥2 chars, and again before signing, because ~40 seconds elapse between open and sign and that's exactly the window in which someone else mints.

Per-keystroke it hits local sources only: `coin_index` by `symbol_norm` plus an explicit `similarity(symbol_norm, $1) >= 0.6` (the bare `%` operator tests a GUC defaulting to 0.3 and would return double the candidate set), and the in-memory PumpPortal create-event ring buffer for the last 15 minutes. Ordering is `liquidity_usd desc, first_mint_at asc` — never 24h volume, which is what selects a $1.8B major for a fresh story. Jupiter fires exactly twice per session, server-side, behind a 30s per-symbol cache shared across users, so a hot symbol costs one call for everyone; keyless it measures 0.5 RPS and a 250ms debounce would 429 on the first user.

The **pre-sign re-check reads the mint stream first**, not the index and not Jupiter. The coins it exists to catch are 0–90s old, and at that age there's no DexScreener pair and Jupiter returns null audit data — both fallbacks are blind to exactly the window that matters. Stream liveness, not index freshness, is the health metric.

| Band | Fires when | What happens |
|---|---|---|
| **D-CONFIRMED** | matcher confirmed a coin for *this* story | Form doesn't open — entry reads `Buy $TICKER`. Landing mid-session swaps to the interstitial. |
| **D-STRONG** | exact symbol, minted within 10 min of the earliest post, ≥$1k liquidity, image-or-name agreement | Card expands, `.coll` amber, cost line gains `You'd be the second $FERRY. The first has $18.2K in it.` Bordered secondary `See $FERRY`. **Primary stays `Review $TICKER`.** |
| **D-WEAK** | exact symbol but >48h older, zero liquidity, or a different subject | One amber line: `$PUMP already exists — a $1.8B token from 2024, unrelated to this story. Yours would be a different coin with the same ticker.` Primary unchanged. |
| **D-IMAGE** | pHash ≤ 6 against a recent mint, symbol differs | `This image is already a coin — $CUPS, made 12m ago, $4.1K in it.` Secondary `See $CUPS`. Primary unchanged — same image, different ticker is a fork. |

D-STRONG does not flip the primary to Buy, and that's load-bearing. This band only fires on coins the matcher did *not* confirm — if it had, the form wouldn't have opened. Flipping there ships a second, looser, undocumented matcher and hands it the Buy button the real one withheld. It's also trivially attackable and pays the attacker: mint $FERRY with the post's image inside the window, seed $1k, and we'd point every would-be creator at your coin. Instead the D-STRONG feature vector goes to the real matcher; if it returns CONFIRMED, D-CONFIRMED handles it. One matcher, one threshold, one Buy button. UNSURE behaves the same, plus one more reason: score-gated suppression is a denial-of-creation vector — mint a decoy and you suppress everyone's create flow on a hot story.

D-IMAGE needs more than distance. Against a corpus where 58.6% of new mints carry byte-identical logos, `hamming ≤ 6` fires constantly, hardest on the low-information images where it means least. So: suppress when the matched SHA-256 group exceeds 3 or the pHash group exceeds 5, require `liquidity_usd > 0` on the match, tighten to `≤ 4` for non-singleton SHA groups. `bit_count()` isn't indexable — this precomputes into a BK-tree or it doesn't ship.

*The transaction.* The mint keypair is generated and persisted encrypted **before** the first signature, so a retry reuses it and a late confirmation fails with `account already in use` rather than minting twice. `/api/launch/prepare` returns a transaction already partially signed by the mint keypair — "one signature" is true from the user's side, and the server contract must say so. The first buy is bundled into the launch tx; unbundled, the sniper bots win the gap.

**FLAG:** exact `create_v2` rent is unmeasured, so the UI shows `about 0.02 SOL`, never a precise figure, and the balance gate requires 0.03 so we never quote a number the transaction exceeds. `is_mayhem_mode` and `is_cashback_enabled` are required instruction fields and undecided product parameters — they change what the safety block means. Every `@pump-fun/pump-sdk` fee-sharing symbol is a placeholder until the SDK is installed and its types grepped; the README documents functions absent from the shipped types.

The first buy executes on the bonding curve inside the launch tx, so the Jupiter integrator fee doesn't touch it — but every later trade routes through the buy path, where that fee has a 50 bps floor, making 0.5% per trade the cheapest possible user cost.

*Propagation.* On landing, one transaction writes `launch`, then `narrative_tickers` with `source='insidor_launch', match_state='CONFIRMED', match_score=1.0` — **bypassing the matcher, because we have ground truth: we minted it from this story** — then `coin_index` with `is_insidor_launch=true` so the next user's duplicate check catches it in seconds, then two follow rows, the coin *and* the story, because following a story must never silently become following a coin. Realtime flips every viewer's primary to `Buy $CHILLGUY` in under a second. The new coins-lane row carries a `NEW` badge with **all nine numeric cells as `—`, never `0`**.

*The count behind every button.* `buy_count = count(match_state IN ('CONFIRMED','ADOPTED'))` — an ADOPTED coin is a story that legitimately attached to a pre-existing token, and it must not render Create over a real buy; it gets a `.timing-pill` reading `existed before this story` rather than an earliness badge. `can_create = coinability_tier = 2`. The classifier's `coinable` flag is a naming-quality judgement and **does not** gate the CTA — a story with no obvious ticker candidate is precisely what the harvester exists to fix. The 50–70% figure in the pipeline research is that suppression rate, not a create rate.

*Rate limits.* `launches_last_1h` / `launches_last_24h` read into `story_cta_v`. Above 3/hour the CTA becomes a cooldown chip rather than vanishing. A per-poster daily cap too, because 40 coins off one creator's posts is what produces a takedown — and uncapped, spam is directly monetised for us.

**States**

| State | What the user sees |
|---|---|
| Loading | Sheet open <100ms on the deterministic candidate, `.namer-why` shimmering |
| Namer unavailable / >2.5s | Deterministic list stands: `Suggestions are off right now — pick a name yourself.` |
| `namable = false` | Fields empty, `We couldn't find a name in this story — no phrase repeats across the posts. Pick one yourself.` plus five `words from the posts` chips. Create still reachable. |
| Ticker free | `✓ $CHILLGUY is free on Solana — you'd be first to deploy it.` |
| Over 13 chars | `Ticker is 13 characters max. We'd have to cut it to $CHILLGUYWORL.` + `Use that`. Never silent truncation. |
| Blocked / leading digit | `We don't allow this ticker.` (no list, no explanation) · `Tickers start with a letter.` |
| Unverified match | Muted card above the grid: `Possibly already made: $KANG — we're not confident it's from this story.` Buy is not rendered at all; primary stays Create. |
| One coin lands mid-form | `$FERRY was made 40 seconds ago.` → primary `Buy $FERRY`, then `Make a different one`, `Show me the story` |
| **Two coins land mid-form** | `Two $FERRY coins were made while you were here.` Both cards stacked with liquidity, holders, age. Primary `See the 2 coins`. Never a Buy aimed at whichever row sorted first. |
| Duplicate <90s old | Money row dropped: `made 12 seconds after the post · nobody has traded it yet`, from the mint stream. Never `$— in it · — owners`. |
| Brand-new token after launch | Every numeric `—`, chart `No live SOL pair for this token yet`, age `just now`, DexScreener disabled with `chart appears once there's a pair` |
| Negative lead time | `CRYPTO TWITTER 6m ago` in red `.timing-pill.timing-late`, identical weight to the early state; subtitle `crypto Twitter got here 6 minutes before us`. Same on the share card and the public `/c/{mint}` route. |
| `promoted_at` backfilled | Earliness sentence and share-card line **suppressed** — falls back to `made from "Norwegian ferry horn"`, no minute figure. A fabricated screenshot number is the most expensive dishonesty we can ship. |
| Story merged since promote | Lead time may be inherited from the merge target — rendered only when no merge has occurred since `promoted_at`, otherwise marked. |
| Mint stream down >60s | `We can't see brand-new coins right now — someone may have minted this in the last 4 minutes.` Non-blocking. |
| Jupiter bucket empty · index stale | `Live check unavailable — checked against our index only.` · `Checking against coins up to 4 minutes old.` |
| Pipeline stale | `Story data last updated 14 minutes ago.` No block — creation doesn't need a live pipeline. |
| Wallet not connected | Form fully usable; step 2 reads `Connect wallet to create` → Privy → returns with every field preserved |
| Insufficient SOL | `Add money to create` + `You need about 0.03 SOL. You have 0.004 SOL.` |
| Rate limited | `You've launched 3 coins in the last hour. The next one unlocks in 14 minutes.` |
| Tier 1 | No CTA anywhere. Via stale link: `This story isn't available to coin.` + `Back to the story`. No mechanics, no `why?` — explaining the boundary is a bypass manual. |
| Tier 0 | Story never surfaces. Not a create-flow state. |
| Image unfetchable | Rendered-text card + `We couldn't fetch the video's image. Using the post text instead — or upload your own.` |
| Wallet rejected | Returns to step 2 unchanged, one muted line: `Cancelled. Nothing was spent.` No red, no icon, no "are you sure?" |
| Unconfirmed at 45s | `We haven't seen this land yet. It may still go through — we're watching for 60 more seconds.` Never claim failure while a signature is unresolved. |
| Blockhash expired | `That transaction expired before it landed. Nothing was spent. Try again — the details are still here.` Retry reuses the same keypair. |
| Any pre-signature failure | `Nothing has been signed and nothing has been spent.` Verbatim, every time. |
| Split pending / failed at 24h | `Until it lands, 100% of fees go to you.` → `We couldn't write the fee split. Nothing is lost — 100% of fees go to you. We've flagged this.` |
| Tapping a duplicate's coin page | Opens in a **new browser tab**, as the post permalink does. One modal root; in-app navigation destroys the form. |

**What it needs**

Used as-is: `narratives.{title, blurb, platforms, combined_views, lifecycle, top_post_id}`; `narrative_posts.{handle, text, media_url, media_type, views, sample_replies}` — replies are a first-class namer input, because replies are where a phrase proves it's being repeated; `narrative_tickers.{ticker, mint_ca, liquidity, mcap, holders, first_deployed}`; `post_meme_scores.suggested_ticker`, whose **only** sanctioned consumer in the product is this form, ranked last at 0.35 and never primary without corroboration.

Does not exist yet. On `narratives`: `promoted_at` (set once, immutable) plus `promoted_at_backfilled boolean` so the earliness claim can be suppressed on backfilled rows; `coinability_tier smallint`; `subject`, `subject_type`, `entity_keys text[]`; `titled_at`. On `narrative_tickers`: `source`, `match_state`, `match_score`, `match_features`. On `narrative_posts`: `ocr_text`, `media_sha256`, `media_phash bit(64)`, `media_local_url`. New tables: `launch`, `namer_run`, `fee_share`, `coin_index`, plus `app_user`, `poster`, `follow`. New health field: `pipeline_health.mint_stream_connected_at`.

`namer_run` is written **at form open, not at submit**, with `outcome` in `accepted | edited | abandoned | typed_over` and `time_to_first_keystroke_ms`. Abandonment is the strongest negative signal the namer produces, and a schema that only records submissions fits the weights on a hits-only sample.

Non-DB gaps, all real: `coin_index` has no producer today; there is no OCR service, no ffmpeg frame extractor, no rendered-text image generator, no share-card renderer, no `/c/{mint}` route, and no `/api/launch/*` endpoints — today's `deployFiled()` fabricates a base58 string and mutates a module-scope array. Unhandled anywhere: pump.fun controls `toggle_create_v2`, so a third party can switch this whole feature off.

**Build order**

1. **Migration 001** — every column the rest reads. Ships alone, changes no UI.
2. **`story_cta_v` + server-side gating** on all existing Create affordances. Tier ≤ 1 renders nothing, enforced in the query. The safety floor, before any new create UI exists.
3. **Deterministic harvester** at `GET /api/story/:id/name-candidates`, replacing `deriveTicker()` in the current sheet. Better naming, zero model spend, zero new UI.
4. **Image pipeline** — fetch, SHA-256, re-host, crop, frame selection, rendered-text fallback. Also kills the placeholder-image hack across the app.
5. **Haiku namer** + `namer_run` + the gate + the never-wait render contract. Feature-flagged; the deterministic path is the permanent fallback, not a stub.
6. **Anti-dupe, read-only.** 6a Jupiter symbol search with the shared cache — three of the four bands on its own. 6b the create-event stream into `coin_index` and the ring buffer. 6c pHash + BK-tree for D-IMAGE.
7. **Step 1, wallet-optional, ending at Review.** No signing, no chain. Shippable internally as a naming tool.
8. **Real launch** — IPFS with Pinata fallback, `createV2Instruction`, bundled first buy, partial-sign contract, Privy raw bytes, send and confirm, keypair retry safety, the full failure taxonomy and its copy.
9. **Propagation** — the single-transaction write, both follow rows, Realtime, optimistic rows with `—` not `0`.
10. **Success + `/c/{mint}` + share card**, rendering negative lead time at the same weight as positive, and an X compose intent that never auto-posts.
11. **Fee split**, gated on D2, shipped in one release with the disclaimer.
12. **Rate limits, regeneration UX, and the label loop** refitting the ranking weights on `outcome` — the only step that makes the namer improve rather than merely exist.
