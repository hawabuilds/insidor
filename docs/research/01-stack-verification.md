# INSIDOR — IMPLEMENTATION FINDINGS PACK
**Compiled 26 July 2026 · supersedes the Jupiter, wallet, market-data, social and indexer sections of the 22 July spec**

Every claim below has been through an adversarial verification pass. Where the pass knocked something down, the correction — not the original — is what appears in the decided stack. Section 3 lists every knockdown explicitly, because several of them would have produced silent, expensive mistakes.

---

## 1. WHAT CHANGED SINCE THE 22 JULY SPEC

Ordered by how much of the build it moves.

**1.1 Jupiter Ultra is deprecated; the spec's endpoint constant is stale, and the *code* is on a worse surface than the spec.**
Jupiter's docs now carry a verbatim warning: *"Ultra Swap API is no longer actively maintained and has been superseded by Swap V2."* Swap API V2 launched 31 March 2026.

Two separate migrations, not one:
- **Spec** (`docs/DESIGN.md:294`, `docs/product/insidor-build-spec.html:254`) says `api.jup.ag/ultra/v1/order`. Migration to `api.jup.ag/swap/v2/order` is a path-prefix change only — params and response are documented identical, and both hosts return 200 today. Low risk.
- **Shipped code** (`api/quote.js:25`, `api/swap.js:30`) uses Metis V1 `api.jup.ag/swap/v1/quote` + `/swap/v1/swap`. That is a *different* legacy surface with a *non-trivial* migration to `/swap/v2/build`: parameter and response remapping, percent→bps in `routePlan`, and an address-lookup-table format change. **This is the real work item and it is not in the spec at all.**
- `lite-api.jup.ag` does **not** serve Swap V2 (`/swap/v2/order` → 404). Any keyless/lite fallback path breaks on migration.

**1.2 The new-token trade fee is 10 bps live, not the 50 bps Jupiter still publishes.**
Verified across 25 tokens minted 1–3 minutes before the query, at 0.01 / 0.1 / 1 / 5 / 20 SOL, on both `api.jup.ag` and `lite-api.jup.ag`, across dflow/okx/metis, in both directions: always `feeBps: 10`. Controls confirm the API is faithfully implementing every *other* row of the published table (SOL→USDC = 2 bps, SOL→JUP = 0 bps), so this is a live divergence from a still-current doc, not a fallback. Cost base on essentially every Insidor trade is 0.10%, not 0.50%. **Do not hardcode 10** — the 50 bps row is still published and can be switched on with no notice.

**1.3 A `/build` revenue path exists that the spec does not contain.** See §2 and §7 — this is a genuine fork in the business model, not a technical detail.

**1.4 Two-thirds of new pump.fun tokens declare their source tweet.** Independently re-measured today: 71.6% of the freshest 700 mints carry a parseable `x.com/<user>/status/<id>` in their `twitter` metadata field (65.6% over a wider 1,041-mint window; per-100 buckets swing 46–85%). Insidor **already** stores the join key — `narrative_posts.platform_post_id` with a `(platform, platform_post_id)` unique index (`worker/schema-ingest.sql:16-17`). The primary story→coin match is a deterministic SQL join, not an ML problem. This did not exist in the 22 July spec's thinking.

**1.5 pump.fun's `create` is deprecated in favour of `create_v2`, and `create_v2` mints Token-2022, not legacy SPL.** No Metaplex metadata account; metadata pointer points at the mint itself. Caps are name ≤32, **symbol ≤13 (not 10)**, uri ≤200. Any code that hardcodes `TokenkegQfeZ...`, derives ATAs, or builds transfer instructions will break on new launches.

**1.6 X moved off subscription tiers to pay-per-use on 6 Feb 2026 — and capped it.** No Free/Basic/Pro tiers for new signups. $0.005 per Post read, **hard-capped at 2,000,000 Post reads per monthly billing cycle**. Above that: Enterprise only. This is a volume ceiling, not a spend threshold.

**1.7 X banned "InfoFi" — apps that reward users for posting — on 15 Jan 2026,** with API revocations. The policy text is broader than the trade-volume-trigger distinction Insidor was relying on. See §3 and §7.

**1.8 `lite-api.jup.ag` is being retired.** Rate limits are being progressively throttled to zero. Returned 429 under light load today where `api.jup.ag` returned 200 keyless for the identical request.

**1.9 Perspective API is confirmed dead** (service ends after 2026; quota requests closed Feb 2026). **Mistral's moderation model string changed**: `mistral-moderation-2411` was deprecated 31 Mar 2026, now `mistral-moderation-2603`.

**1.10 Two live bugs in the repo, found during verification** — both shipped, both wrong today. See §3.11 and §3.12.

---

## 2. THE DECIDED STACK

One row per layer. Identifiers confirmed live on 26–27 July 2026.

| Layer | Tool | Exact identifier | Conf. |
|---|---|---|---|
| Swap quote/execute | Jupiter Swap V2, headless REST | `GET https://api.jup.ag/swap/v2/order` → `POST https://api.jup.ag/swap/v2/execute` | High |
| Swap monetisation | Jupiter referral on `/order` | `referralAccount` + `referralFee` (**50–255 bps**, Jupiter keeps 20%) | High |
| Referral setup | Jupiter Referral Dashboard | `https://referral.jup.ag/` (SDK `@jup-ag/referral-sdk@0.3.0` only if scripted) | High |
| Swap UI | **Custom, built in-house** — not the Jupiter Plugin | n/a (kills React 19 ERESOLVE *and* the `WalletContextState` shim in one decision) | High |
| Wallet | Privy, wallet-only | `@privy-io/react-auth@3.35.2`, subpath `/solana` | High |
| Signing | Privy raw-bytes API | `useSignTransaction()` → `{transaction: Uint8Array}` → `{signedTransaction: Uint8Array}` | High |
| Chart | DexScreener iframe embed | `https://dexscreener.com/solana/{pairAddress}?embed=1&theme=dark&interval=5` | High |
| Token market data | Jupiter Tokens API v2 | `GET https://api.jup.ag/tokens/v2/search?query={mint}` (10 credits, ≤100 mints) | High |
| Feed price refresh | Jupiter Price v3 | `GET https://api.jup.ag/price/v3?ids={mints}` (1 credit, ≤50 mints) | High |
| Rug safety | RugCheck **full report** | `GET https://api.rugcheck.xyz/v1/tokens/{mint}/report` — **not** `/report/summary` | High |
| Holder concentration | Standard Solana RPC via Helius | `getTokenLargestAccounts` (**1 credit**, 20 accounts) | High |
| Wallet position (comment stamp) | Standard Solana RPC via Helius | `getTokenAccountsByOwner(owner, {mint}, {encoding:'jsonParsed'})` (**1 credit**) | High |
| Trade history / "sold" flag | Helius | `getTransactionsForAddress`, `filters.tokenTransfer:{mint, direction:'out'}` | High |
| New-token discovery | pump.fun internal API, **server-proxied** | `GET https://frontend-api-v3.pump.fun/coins?limit=70&offset=N&sort=created_timestamp&order=DESC` | Med |
| Coin creation | pump.fun `create_v2` | `PUMP_SDK.createV2Instruction({mint,name,symbol,uri,creator,user,mayhemMode})`, `@pump-fun/pump-sdk@1.36.0` | High |
| Creator fee split | pump_fees | `createFeeSharingConfig` → `updateFeeSharesV2` (one-shot), `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | High |
| Fee payout crank | pump_fees, permissionless | `distributeCreatorFeesV2({payer, shouldInitializeAta:true})` — zero privileged signer | High |
| X ingestion | twitterapi.io | `GET https://api.twitterapi.io/twitter/tweet/advanced_search`, hdr `X-API-Key`, **$0.00015/tweet** | High |
| TikTok ingestion | Apify | `clockworks/tiktok-scraper` ($1.70/1k) — migrate the hashtag lane off `tiktok-hashtag-scraper` ($5/1k) | High |
| Comment transport | Supabase Broadcast from DB, **sharded per narrative** | AFTER INSERT trigger → `realtime.broadcast_changes('narrative:'||NEW.narrative_id, …)` | High |
| Comment auth | **Server-side write via route handler + service role** | Verify Privy token with `@privy-io/node@0.27.0`, write server-side. Supabase third-party-auth as phase 2 | High |
| Per-wallet write limits | Postgres BEFORE INSERT trigger | `count(*) … WHERE author_wallet=NEW.author_wallet AND created_at > now()-interval '60 seconds'` | High |
| Edge pre-filter | `@vercel/firewall` SDK | `checkRateLimit(id, {request, rateLimitKey: walletAddress})` — works on Pro | High |
| Generic moderation | OpenAI, free | `omni-moderation-latest` @ `POST /v1/moderations` | High |
| Crypto-native moderation | **Build it — no vendor ships this** | base58 32–44 char regex + mint allowlist + domain allowlist, deterministic pre-pass | High |
| Image copy-detection (phase 3) | SSCD | `sscd_disc_mixup.torchscript.pt`, ResNet50, 512-dim | Med |
| Vector store | pgvector in existing Supabase | `halfvec(512)` + HNSW `vector_cosine_ops`, pgvector 0.8.5 | High |

**Explicitly rejected, with the reason:**
- Jupiter Plugin / `enableWalletPassthrough` — drags `@solana/web3.js` v1 back in (peer `^1.87.6`) plus a hand-written 15-field `WalletContextState`, against a Privy v3 that deliberately shed both. Headless REST needs only base64↔Uint8Array conversion.
- Privy's swap API — developer fee is cross-chain only, *and* requires a sales-negotiated custom fee config even then. Same-chain Solana pays Insidor nothing while Privy takes up to 0.25% of input plus your gas credits.
- Direct Pump.fun/PumpSwap swap integration — hard-wires one venue. On brand-new tokens, dflow and okx won the *majority* of quotes (okx 4, dflow 3, metis 1 across 8 fresh mints, including pre-graduation with `liquidity: null`).
- Birdeye at launch — free tier is 30,000 CU/mo at 1 rps (~3,000 trade-feed calls *per month, total*), and its bonding-curve coverage is unverified. Ship v1 without recent-trades/top-traders.
- `pumpdotfun-sdk` (rckprtr) — third-party, 16 months stale, predates `create_v2`, fee sharing, Token-2022 and the entire pump_fees program.
- `@jup-ag/terminal` — deprecated on npm: *"Jupiter Terminal is now Jupiter Plugin."*
- Postgres Changes for comments — one auth check per subscriber per change on a single ordered thread; caps at 3,000–4,000 msg/s with RLS on, and bigger compute does not help.

---

## 3. REFUTED CLAIMS

These are the landmines. Each one was believed true by at least one research pass and is false.

**3.1 "The spec targets `ultra-api.jup.ag`."** — FALSE. `grep -ri "ultra-api.jup.ag"` over the repo returns **zero hits**. The actual constant is `api.jup.ag/ultra/v1/order`, which returns 200 today. And "every endpoint constant in the spec is wrong" is false: `api.jup.ag/tokens/v2/toptrending/{interval}` is the Tokens API, unaffected and current. **Correction:** migrate `/ultra/v1/*` → `/swap/v2/*` (same host, prefix only); the *harder* migration is Metis V1 → `/swap/v2/build` in `api/quote.js` and `api/swap.js`.

**3.2 "`update_fee_shares_v2` means the poster's address must be final at launch time."** — FALSE, and the supporting quote was **fabricated**. The sentence *"Replaces the current shareholders and sets admin_revoked = true, so this instruction can only effectively be used once per sharing_config"* appears **nowhere** in the SDK README, the IDL `docs` arrays, or any pump source. The real primary strings are IDL error 6009 `SharingConfigAdminRevoked` ("sharing config can only be updated once"), 6024 `FeeSharesAlreadyUpdated`, and README "Reward split can be setup once and once only". **Two further corrections:** (a) `reset_fee_sharing_config` / `_v2` **do** exist and reassign both admin and the full shareholder set — they are gated on the pump_fees global authority, so pump.fun can reset a locked config and Insidor cannot; correct framing is "no *permissionless* correction", not "unrecoverable". (b) The lock fires on the **shares update**, not on `create_fee_sharing_config` — `isSharingConfigEditable` returns true for a v2 config with no shares set. **So Insidor can create the config at launch and defer `updateFeeSharesV2` until the poster's derived address is verified.** That is a materially safer sequence than the one the research recommended. (The 40/60 split is Insidor's own design parameter, not a pump.fun fact.)

**3.3 "`create_v2` writes the creator into the Metaplex creators array."** — FALSE. That sentence in `PUMP_PROGRAM_README.md` describes the **legacy `create`** instruction. `create_v2` passes no `metadata` and no `mpl_token_metadata` account at all; it mints Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) with a self-pointing metadata pointer. Writing Metaplex creators on a `create_v2` mint requires the separate `set_metaplex_creator` instruction. **The core mechanism is confirmed and *stronger* than claimed** — the README states explicitly that `user` and `creator` "can be different, for example, on the free coin creation flow… `creator` pubkey is not required to be a signer." Launch-on-behalf-of is officially sanctioned. Read the creator from `bonding_curve` or the Token-2022 metadata extension, not from Metaplex.

**3.4 "Credit card → memecoin in one step does not exist; `SolanaFundingConfig.asset` is typed `'native-currency' | 'USDC'`."** — FALSE as generalised. That union is real but belongs to `SolanaFundingConfig`, consumed only by the **deprecated** `useFundWallet`. The current `useAddFunds` and `useFiatOnramp` type destination as `{address, chain: CAIP-2, asset: string}` — "Token address on the destination chain" — and `AddFundsCryptoOptions.slippageBps` shows Privy routes/swaps inside the flow. The REST Onramps API types it as `TokenIdentifier = string`. **Correction:** the constraint is *provider coverage and liquidity*, not the type system. Validate a live quote against a target mint before re-scoping the "one tap" promise. Both replacement hooks are `@experimental` — that is the real integration risk.

**3.5 "Supabase does not support Privy; there is no generic OIDC/JWKS option."** — FALSE. Supabase's live OpenAPI spec exposes `POST /v1/projects/{ref}/config/auth/third-party-auth` taking `{oidc_issuer_url?, jwks_url?, custom_jwks?}` with a generic `https://login.acme.com` example. The five named providers are integration *guides*, not an API allow-list. Privy meets the stated requirement (asymmetric + `kid`): `https://auth.privy.io/api/v1/apps/<app_id>/jwks.json` returns 200 with EC P-256 / `alg: ES256` / `kid`. **Correction:** the actual blocker is the **`role` claim** — Supabase reads `role` from every JWT to pick the Postgres role; a token without `role: "authenticated"` runs as `anon`. Auth0 injects it via a post-login Action, Clerk via JWT templates; Privy has no documented claim-injection hook. Privy also serves no `/.well-known/openid-configuration` (404), so pass `jwks_url`, not `oidc_issuer_url`. **This is why we ship server-side writes first** — but the JWKS route is a live phase-2 option, not dead.

**3.6 "Vercel WAF cannot key on wallet address below Enterprise, so limits must live in Postgres."** — FALSE conclusion. The plan gating (`IP, JA4 Digest` on Pro) applies to the **dashboard rule builder**. The Rate Limiting SDK does not: `checkRateLimit(id, {request, rateLimitKey})` from `@vercel/firewall` (npm latest 1.2.1) buckets on any arbitrary string, documented for "an authenticated user ID or organization ID", with no plan restriction. **Correction:** use the SDK keyed on wallet for cheap edge shedding; keep the Postgres trigger because SDK counters are still **per-region** and therefore not a global cap — not because wallet keying is unavailable.

**3.7 "Realtime 1+N billing forces per-narrative sharding as an architectural decision, and messages are the single largest cost variable."** — The billing quote is **exact** and confirmed: *"Each broadcast message counts as one message sent plus one message per subscribed client that receives it."* The two inferences are false. Sharding only shrinks N — that is an optimisation. **The real forcing constraint the research missed is the 500 messages/second Pro rate limit**, which caps throughput regardless of budget. And Realtime has a **second meter** the analysis ignored: peak concurrent connections at $10/1,000 above 500 included. At 2,000 concurrent and <2,500 comments/month, messages cost $0 and connections cost $15 — connections dominate first. Messages only dominate at high comment volume.

**3.8 "Jupiter `/tokens/v2/search` collapses Birdeye+Helius+RugCheck into one keyless call."** — Overstated on three counts. (a) **Keyless is 0.5 RPS.** Measured: requests 1–4 returned 200, requests 5–12 returned 429, `x-ratelimit-remaining: 3`. This is not a free unlimited path. (b) **`audit.topHoldersPercentage` was null on 4 of 6 sub-2-minute-old mints**; one fresh token returned an entirely empty `audit`. Wrapped SOL returns `topHoldersPercentage` but no `devBalancePercentage`. The four-field set was never returned intact on a fresh token. (c) `stats5m` on the freshest mints was as thin as `['buyVolume','numBuys']` — no `sellVolume`, no `priceChange`, no `volumeChange`. **Correction:** no OHLCV, no per-holder list, no LP burn/lock status, no tx-level data. It displaces Birdeye's price/mcap/liquidity calls. It does **not** replace RugCheck or Helius. Treat every `audit` subfield as nullable.

**3.9 "The pump.fun `/coins` endpoint is alive."** — True but unusably underspecified. `/coins` is 200 on **exactly one of six hosts**: `frontend-api-v3.pump.fun` → 200; `frontend-api.pump.fun` → 530; `frontend-api-v2.pump.fun` → 503; `api.pump.fun` → 530. And "supplies … the twitter source link in one call" is false as a guarantee: across the 50 newest coins, `twitter` was non-empty in 35/50 (70%) and an actual `/status/` permalink in only 32/50 (64%). `mint`, `image_uri`, `created_timestamp` are the only 100%-coverage fields. **Also:** response carries `access-control-allow-origin: https://pump.fun` — **not browser-callable, must be server-proxied** — and there is no official pump.fun API documentation at all (`pump.fun/docs` is a marketing page). The dead v1/v2 hosts are direct evidence it breaks without notice.

**3.10 "X's 'no third party actions attached to a post' rule is the binding constraint; without it the post-centric UI would be safe."** — The quote is **verbatim exact**, including the odd period-before-parenthetical. The counterfactual is false. Strike that bullet and a post-centric UI *still* must satisfy: Action icons (reply/repost/like) "must always be visible" and implemented via Web Intents or the authenticated API (or a "View on X" link); the Don't-list prohibition on "Use X content to promote any product or service … without explicit permission from the user" — **which is the more textually apposite rule for a Buy button, since "Buy" is not named anywhere**; unaltered post text; avatar/@username/display-name each linking to the profile; timestamp linking to permalink; X logo upper-right of each post; mobile deep links. **Also missed:** the page's own escape hatches — use `publish.x.com` embeds, or contact X's Policy Support form before displaying content. "Must be narrative-centric" is a design inference, not a documented requirement (it is still the right call — see §7).

**3.11 `api/safety.js` ships a false safety guarantee. CONFIRMED LIVE.** Lines 17–18 read `raw.mintAuthority ?? raw.token?.mintAuthority ?? null` off RugCheck's `/report/summary`. Per RugCheck's own swagger, `dto.TokenCheckSummary` has exactly: `error, lpLockedPct, mint, risks, score, score_normalised, tokenProgram, tokenType`. No authority fields. Lines 23–24 are `mintRevoked: mintAuthority == null ? true : false`. **Reproduced:** USDC has live `mintAuthority: BJE5MMbq…` and `freezeAuthority: 7dGbd2QZ…` on-chain, and `safety.js` emits `mintRevoked: true, freezeRevoked: true`. It reaches the UI unfiltered (`site/index.html:3366-3367` → green ✓; the `!= null` merge guards at `index.html:3108` and `live.js:1953` never fire because the value is always boolean `true`). **Fix:** call `/v1/tokens/{mint}/report` — the existing `??` chain works unmodified. `lpLockedPct` is the one field on that line that actually works today.

**3.12 TikTok budget under-counts ~3x.** `worker/lib/tiktok-reader.js:16` routes the hashtag lane to `clockworks/tiktok-hashtag-scraper` at **$0.005/item**, while `worker/lib/apify-budget.js:8-11` defaults `COST_PER_ITEM` to `0.00165`. Real burn at the `DAILY_BUDGET_USD=1` cap is ~$3/day. Fix: set `APIFY_COST_PER_ITEM=0.005` or move that lane to `clockworks/tiktok-scraper`.

**3.13 "twitterapi.io charges ~$0.005 per post read."** — FALSE by **33x**. That is the *official X API's* price. twitterapi.io is 15 credits/tweet at 100,000 credits = $1.00 → **$0.00015/tweet ($0.15/1k)**. The repo already has this right (`worker/lib/budget.js:5`, `:33-36`). The error is in the brief, not the code — anyone re-deriving the budget from the brief will overstate X costs 33x and conclude the product is unaffordable.

**3.14 "The InfoFi ban doesn't apply because Insidor's trigger is trading volume, not posting."** — FALSE. X Developer Policy, verbatim: *"you may not sell or receive monetary or virtual compensation for any X actions. This includes, but is not limited to, Posts, follows, unfollows, reposts, likes, comments, and replies."* The clause bans compensation **for** a Post and is silent on the trigger mechanism. No Post, no payment. The volume trigger is a distinction Insidor is drawing; the policy does not draw it.

**3.15 Two SDK-surface errors worth naming.** (a) `@pump-fun/pump-sdk@1.36.0`'s README documents `createSharingConfigWithSocialRecipients` and `updateSharingConfigWithSocialRecipients` seven times with full code samples — **zero occurrences in `src/`, `dist/index.js`, `dist/index.d.ts`**. It also names `isCreatorUsingSharingConfig`, which does not exist (real name: `hasCoinCreatorMigratedToSharingConfig`). Verify every symbol against `dist/index.d.ts`. (b) `WalletContextState` has **15 fields, not 16** — counted in `@solana/wallet-adapter-react@0.15.35` (the version `@jup-ag/plugin@1.0.16` transitively pins) and 0.15.39; identical. Also, `@jup-ag/plugin` is **not installed** in this repo — no `node_modules/@jup-ag`, zero `"jup-ag"` matches in `package-lock.json`. Any claim "verified from the installed plugin d.ts" is false provenance.

**3.16 "Image similarity can pick which coin to buy."** — FALSE on the raw mint stream. Independently reproduced: 522 logos downloaded from the newest 599 pump.fun coins → **216 unique = 58.6% byte-identical duplicates**. Largest groups: 56 tokens/1 creator, 53/30 creators, 50/26, 33/17. Expected top-1 accuracy under random tie-break: **41.4%**. **Important scope correction the research missed:** on a *liquidity-filtered* corpus (Jupiter search, 450 icons) duplication drops to **10.0%**, largest group 7 tokens/6 creators, ~90% expected top-1. Since the design already filters to nonzero volume/bonding-curve position, "wrong most of the time" holds pre-filter only. The candidate-set requirement holds in both regimes.

---

## 4. UNVERIFIABLE — PRE-DEVELOPMENT CHECKS

Nobody could confirm these from a primary source. Each has a one-line test. **Run all of these before the corresponding code is written.**

| # | Unknown | One-line test |
|---|---|---|
| U1 | Does `distribute_creator_fees_v2` throw error **6070 UnableToDistributeCreatorFeesToUninitializedAccount** for a zero-lamport system account on the SOL path? *(Insidor's entire model pays never-used addresses.)* | Devnet: create a coin, set shares to a freshly-generated unfunded pubkey, trade, crank `distributeCreatorFeesV2`. If 6070 fires, pre-fund every poster address with 890,880 lamports at launch. |
| U2 | True all-in cost of one `create_v2` launch (Token-2022 mint and `mayhem_state` byte sizes unverified). | Run one devnet `create_v2` and read the fee+rent delta. Budget 0.02 SOL until then. |
| U3 | Exact authority on `reset_fee_sharing_config` — the only post-lock recovery path. | `getAccountInfo` on the pump_fees `global` PDA and compare its `authority` field to any address Insidor controls. Assume no. |
| U4 | Does twitterapi.io return 402, 403, or 200-with-empty at zero credit balance? | Read Railway logs for `HTTP 4xx /twitter/tweet/advanced_search` from 25 July — the status code also distinguishes credit exhaustion from a revoked key. |
| U5 | Does Birdeye cover pre-graduation pump.fun tokens at all? | Free key → `GET /defi/v3/ohlcv` + `/defi/txs/token` against a live `complete: false` mint. If empty, Birdeye is worthless at any price. |
| U6 | What does Privy's "$1M transaction volume" measure — USD notional, count, or something else? And what are Developer-tier overage rates? | Email sales; get both in writing. Not published anywhere; `docs.privy.io` has no billing page. |
| U7 | Do self-minted JWTs (imported signing key) count toward Supabase's third-party MAU meter at $0.00325? | Ask Supabase billing. Docs enumerate only the four named providers. |
| U8 | Is Privy's per-app JWKS at `auth.privy.io/api/v1/apps/<id>/jwks.json` a supported public contract, and can a `role: "authenticated"` claim be injected into a Privy access token? | Ask Privy support directly. Determines whether phase-2 Supabase third-party auth is viable at all. |
| U9 | Can `useAddFunds`/`useFiatOnramp` actually deliver an arbitrary SPL mint on Solana via any configured provider? | Call `useFiatOnramp().fund()` with a real memecoin mint as `destination.asset` and see whether a quote returns. Determines whether "one tap" survives. |
| U10 | Is RugCheck's `X-Rate-Limit-Limit: 15` per second or per minute? | 20 sequential calls at 1.2 rps; if all 200, it is per-second. Cache regardless. |
| U11 | SSCD **model weights** licence (README covers the codebase as MIT, is silent on the `dl.fbaipublicfiles.com` checkpoint). | Lawyer, before shipping. DINOv3 / SigLIP 2 (Apache 2.0) are the fallbacks. |
| U12 | What fraction of tweet-linked coins actually join, i.e. P(status URL present) × P(that tweet already in `narrative_posts`)? | One SQL query against live data once the poller runs a day. Only the first factor (~66%) is known; the second determines whether embeddings are needed at all. |
| U13 | Jupiter Studio `/studio/v1/dbc-pool/create-tx` — documented only, never exercised. | Devnet dry run before this appears in any roadmap. |
| U14 | X Enterprise pricing (widely cited ~$42k/mo, never published). | Irrelevant unless someone proposes it; treat the 2M cap as absolute. |
| U15 | Azure Content Safety standard-tier text price (renders as `$-` on Microsoft's own page). | Not needed — OpenAI's endpoint is free. |
| U16 | DexScreener paid API tier pricing (`docs.dexscreener.com/api/pricing` → 404). | Only matters if 300 req/min becomes binding. |

---

## 5. COST MODEL

**Read this first:** ingestion cost is **DAU-independent**. It scales with coverage breadth and refresh rate, not user count. Presenting it per-user produces a badly wrong unit-economics model. The DAU-driven spend is Supabase, Helius, Jupiter and Privy.

Assumptions — Beta: <100 DAU, <500 Privy MAU, 10k tweets/day, 500 TikTok items/day. 1k DAU: ~2k MAU, 100k tweets/day, 3k TikTok items/day, 5k comments/day. 50k DAU: >10k MAU, 500k tweets/day, 15k TikTok items/day, 100k comments/day, ~5k peak concurrent.

| Line item | Beta | 1k DAU | 50k DAU | Basis |
|---|---:|---:|---:|---|
| Jupiter API | $0 | $25 | $100 | Free 1 rps → Developer 10 rps → Launch 50 rps |
| Helius | $0 | $49 | $499 | Free 1M cr → Developer 10M → Business 100M |
| DexScreener (chart + API) | $0 | $0 | $0 | Free, no key, 300 req/min |
| RugCheck | $0 | $0 | $0 | Free, unauthenticated GET |
| Birdeye | $0 | $0 | $199 | Deferred; Premium only if trades/top-traders ship |
| Supabase plan | $25 | $25 | $25 | Pro |
| Supabase compute | $0 | $10 | $110 | Micro → Large (8GB, holds HNSW graph) |
| Supabase Realtime messages | $0 | ~$5 | ~$370 | $2.50/1M above 5M incl., **per-narrative sharding assumed** |
| Supabase Realtime connections | $0 | $0 | ~$45 | $10/1,000 above 500 incl. |
| Privy | $0 | $299 | **Enterprise — unpriced** | Free <500 MAU → Core 500–2,499 → custom >10k |
| twitterapi.io (X) | $46 | $456 | $2,280 | $0.00015/tweet × 30.4 days |
| Apify (TikTok) | $29 | $199 | $775 | Starter → Scale plan; usage draws down plan allowance |
| Vercel | $20 | $20 | ~$100 | Pro + WAF from $0.50/1M allowed requests |
| Upstash (edge pre-filter) | $0 | $0 | ~$10 | 500K commands free, then $0.20/100K |
| OpenAI moderation | $0 | $0 | $0 | `omni-moderation-latest` is free |
| Modal (image embeddings) | $0 | ~$1 | ~$30 | L4 $0.799/hr; backfill is network-bound, not GPU-bound |
| **TOTAL** | **~$120** | **~$1,089** | **~$4,543 + Privy Enterprise** |

Not modelled: Anthropic Haiku scoring and SerpAPI (outside the researched tracks); pump.fun launches at ~0.02 SOL each (linear, trivial, but confirm via U2).

**Three notes that matter more than tier selection:**
1. **Caching beats upgrading.** DexScreener's 300 req/min and Jupiter's per-*organisation* RPS are whole-product ceilings shared across every user, because Vercel functions egress from a small IP pool. A burst of ~44 rapid DexScreener calls tripped Cloudflare 1015 from one IP. One scheduled poller writing hot tokens to Supabase is worth more than any tier upgrade — it is the difference between the $1,089 and the $4,543 column.
2. **X ingestion is the largest single line item at every stage** and it is not DAU-driven. It is a coverage dial the founder sets.
3. **Privy at 50k DAU is a negotiation, not a price.** Anchor on the published "as low as $0.001/signature". At 500 traders × $2k/mo you land on exactly $1,000,000 — precisely the stated free volume allowance — at an unpublished overage rate (U6).

---

## 6. GOTCHAS — ORDERED BY COST TO HIT LATE

**Tier 1 — unrecoverable or product-defining**

1. **`updateFeeSharesV2` is genuinely one-shot.** Errors 6009 / 6024 enforce it; `revoke_fee_sharing_authority` and `transfer_fee_sharing_authority` are zero-account, zero-arg stubs the README calls "no longer supported"; v1 configs are retroactively locked. Recovery exists only as a discretionary pump.fun-side `reset_fee_sharing_config` Insidor cannot invoke. **Mitigation (from §3.2): create the sharing config at launch, defer the shares write until the derived address is verified.** Do not put them in one transaction blindly — but note `updateFeeSharesV2` sweeps pending fees to the *current* list first, so any trading in the gap pays 100% to the original creator. Verify fast, then write.
2. **The safety-badge bug (§3.11) is a shipped false safety claim.** Users see "mint authority revoked ✓" on tokens where the deployer can mint infinite supply. Highest-priority fix in the repo.
3. **Ticker-only matching authorises a Buy button on the wrong token.** `lib/token-lookup.js:pickBestPair()` sorts by SOL-quote → 24h volume → liquidity. Reproduced: `q=PUMP` returns 18 exact-symbol Solana pairs and it selects the $1.8B platform token for *any* story proposing $PUMP. The ranking is optimising for the worst answer — highest volume means oldest, i.e. maximally unlikely to derive from a post published minutes ago. **Ticker must become a ≤0.10-weight tiebreaker that can never alone authorise a Buy.** Same mechanism produced the $KANG false positive.
4. **The stamp is a lie if the mint is fake.** "Holds 2.1 SOL of $TICKER" is trivially gamed by minting a worthless same-ticker token. Ticker is not identity on Solana; mint address is. Never render a ticker without having verified the mint behind it.
5. **X's InfoFi policy forecloses the author fee-share feature** (§3.14) and X's Display Requirements forbid attaching Buy/comment controls to a rendered post and require unaltered text plus visible Action icons (§3.10).

**Tier 2 — expensive rework**

6. **Realtime fan-out.** One global comment channel at 50k DAU is ~500M messages/day at $2.50/1M. Shard by narrative id from day one — retrofitting means changing the trigger topic *and* every client subscription while live. The hard wall is the 500 msg/s Pro rate limit, not the bill.
7. **Privy's 1-hour token vs Realtime's cached auth.** Realtime caches channel policies for the connection lifetime and disconnects on JWT expiry; Privy access tokens live ~1h. Without a refresh loop that re-mints and calls `supabase.realtime.setAuth()`, every user silently drops off the live feed after an hour. **Most likely launch-day bug in this design.**
8. **New pump.fun tokens are Token-2022.** Anything hardcoding `TokenkegQfeZ…`, deriving ATAs, or building transfer instructions breaks. Token-2022 also permits transfer fees and transfer hooks that silently alter swap outcomes — read RugCheck's `transferFee` and `token_extensions` and warn on non-zero.
9. **`referralFee` has a FLOOR of 50 bps, not just a ceiling.** Insidor cannot charge 10 or 25 bps on `/order`. Minimum viable take is 0.5% of the user's trade. The `/build` path has no documented floor.
10. **Referral fees need an on-chain token account per fee mint, rent-funded before any fee can land.** `initializeReferralTokenAccount({payerPubKey, referralAccountPubKey, mint})` takes one `mint`. Pre-create SOL and USDC. Miss this and fees silently do not accrue.
11. **pump.fun `/coins` CORS is locked to `https://pump.fun`** — server-proxy only, and pagination is hard-capped at ~1,050 records (offset ≥1,200 returns `[]`). At 18.9 tokens/min that is ~55 minutes of headroom; a 1-hour outage loses data permanently. `limit` is silently clamped to 70 with no warning.
12. **PDA seed strings are inconsistent *within* each program.** Pump: hyphens for `bonding-curve`/`creator-vault`/`mint-authority`, underscores for `user_volume_accumulator`. Pump AMM: underscores for `creator_vault`/`pool`, hyphen for `pool-v2`. Pump Fees: hyphens for `sharing-config`/`social-fee-pda`, underscore for `fee_config`. **Never hand-roll seeds — import the SDK helpers.**

**Tier 3 — silent failures and wasted spend**

13. **Trending category is `toptrending`, not `trending` — and the wrong string returns HTTP 200 with `[]`.** So does a deliberately bogus category. A trending page on the wrong string ships looking "quiet" and survives code review.
14. **`worker/lib/retry.js:15` retries only on HTTP 429.** A 402/403 throws immediately with no pause flag and no operator banner — the likely mechanism of the 25 July X outage. Mirror the Anthropic pattern (`worker/score.js:217-219` → `printExhaustionBanner` + `setScoringPaused`).
15. **Top-10 concentration is meaningless unless you exclude the bonding curve.** RugCheck's #1 holder on a fresh token is the pump.fun curve at 46.73%, labelled `{type: 'AMM'}` in its own `knownAccounts`. Raw top-10 = 67.89% and a scary red badge on a perfectly normal token. Filter `AMM`/`LOCKER` before summing; surface `CREATOR` separately as "dev holds X%".
16. **Jupiter's `audit.topHoldersPercentage` ≠ RugCheck's top-10** — 24.04% vs 67.89% on a bonding token, 32.70% vs 37.93% on BONK. Jupiter does not document what "top" means. **Pick one source and never mix them across feed and coin page.** Same for holder counts: Jupiter 163 vs RugCheck 518 on the same token at the same moment.
17. **Mint/freeze-revoked are near-useless signals for pump.fun tokens** — the program revokes both at creation, so every bonding-curve token passes. Two green ticks on every new coin teaches users the safety panel is noise. The discriminating signals are dev balance %, insider/bundler detection, single-holder concentration, and creator history.
18. **"LP burned" means nothing pre-graduation.** RugCheck returns `lpLockedPct: 100` because the curve *is* the liquidity. Hide the check while `complete: false` or relabel it.
19. **DexScreener returns no `liquidity` object at all for bonding-curve pairs** — absent, not zero. `pair.liquidity.usd` crashes. Source liquidity from Jupiter pre-graduation.
20. **Helius DAS `getTokenAccounts` is 10 credits *per page*.** `api/holders.js` paginates 5 pages = 50 credits per cache miss and still won't enumerate a large token. Use `getTokenLargestAccounts` (1 credit, 20 accounts) for concentration; take holder *count* from Jupiter's free field.
21. **Jupiter `/tokens/v2/search` is 10 credits, not 1.** If the search box fires per keystroke, that line item dominates. Debounce.
22. **Apify credits do not roll over** — "unused usage credits… expire at the end of the billing cycle." Don't pre-buy Scale for burst months.
23. **`@privy-io/react-auth` ships no `use client` banner** (grep count: 0 in `dist/esm/index.mjs`). Put it on your own provider wrapper, mount near root, gate all consumption on `usePrivy().ready`.
24. **`config.appearance.walletChainType` defaults to `'ethereum-only'`.** Without `'solana-only'`, no Solana external wallet appears in the modal. Silent, and eats an afternoon.
25. **`config.solana.rpcs.rpcSubscriptions` is required, not optional** — you need a `wss://` endpoint, not just HTTPS.
26. **Four Privy Solana peer deps are `optional: true` and won't reliably install.** The repo has `@solana/kit@5.5.1`, `@solana-program/system@0.10.0`, `@solana-program/token@0.9.0` via peer auto-install and declared nowhere; `@solana-program/memo` is missing entirely. A clean CI install resolves differently. Declare all four.
27. **`useSolanaWallets` no longer exists in v3** (zero hits across all `.d.ts`); split into `useWallets` + `useCreateWallet` + `useExportWallet`. Privy's own docs still reference it. Trust the `.d.ts`.
28. **Wallet-gating is weak sybil resistance** — a Solana wallet costs ~0.000005 SOL. Gate on holding duration, minimum balance, or `funded-by` clustering instead.
29. **Base58 addresses in comment bodies are the actual spam vector** and nothing off-the-shelf catches them. A 20-line pre-pass rejecting any 32–44 char base58 string that isn't the narrative's own mint blocks more real harm than the entire generic moderation layer.
30. **RugCheck's full report is 452 KB for BONK.** Never proxy it to the browser; normalise server-side and cache.
31. **The DexScreener embed is entirely undocumented** — zero occurrences of "embed" in `docs.dexscreener.com`. It works (verified rendering + streaming on a 13-minute-old bonding pair, `?embed=1` strips `X-Frame-Options` and bypasses Cloudflare's challenge), and it is TradingView `charting_library` v27.001 under the hood. Wrap it in one component so a silent change is a one-file fix. Fallback: the direct bars endpoint `io.dexscreener.com/dex/chart/amm/v3/pumpfun/bars/solana/{pair}?mc=1&res=1&q={quoteMint}` returns real OHLCV for bonding-curve pairs.
32. **2.5% of tokens are minted *before* their referenced tweet** (clock skew, quote-tweet chains). Allow ~60s negative tolerance or you drop real matches. Timing prior is tight: p50 lag 121s, 65.7% within 5 min, 91.1% within 15 min.
33. **43% of logo URLs point at `ipfs.io`.** Re-host to your own storage keyed by SHA-256 on ingest. SHA-256 dedupe also cuts the embedding corpus ~60% before a single GPU cycle, and the count of tokens sharing a hash *is* the IDF penalty term, free.

---

## 7. OPEN DECISIONS FOR THE FOUNDER

Research cannot settle these. Each is a product, legal, or margin judgement.

**D1 — Ship the post-author fee share, or not?**
Research says no. X's policy bans "monetary or virtual compensation for any X actions… including… Posts" and is silent on the trigger mechanism, so the volume-trigger defence does not hold. Blast radius is smaller than it was for Kaito (Insidor has no X developer account to revoke — it reads via twitterapi.io), but it permanently forecloses official X API access, creates C&D and account-suspension exposure for any X presence, and is a disclosed-risk item any acquirer finds. **If it is strategically essential:** pay the author for the *token*, sever the payment from any X identity or X action, and get counsel before shipping. This is the single largest legal call in the product.

**D2 — Custody of poster-derived keys.**
The architecture holds funds for a person who never consented, never signed up, and may never claim. Pump.fun's own social-fee primitive exists but is GitHub-only (`Platform.X = 1` is in the enum, but the README checklist says *"Only `Platform.GitHub` is supported. Any attempt to use a different platform value can result in the coin being banned or fees lost"*, TikTok is commented out, and claiming is gated behind a pump-held `social_claim_authority` with no external claim flow permitted). So Insidor must derive its own addresses — and then decide: PDA it cannot spend from, or KDF-derived custodial key it can. **This is a money-transmission question, not an engineering one.**

**D3 — `/order` + referral, or `/build` + own fee account?**
`/order`: managed execution, RTSE slippage, MEV protection, gasless, `/execute` landing, four competing routers — but 50–255 bps floor and Jupiter keeps 20%. `/build`: Jupiter charges no swap fee and takes no cut, `feeAccount` is a plain SPL token account, no documented bps floor — but Metis-only routing, raw instructions with no `transaction` field, and you own assembly and landing. Verified empirically: same token, same 1 SOL, `/order` 34,143,965,610,903 vs `/build` 34,177,054,747,825 — a 9.68 bps gap. **Recommendation is `/order`,** because on brand-new tokens dflow and okx won the majority of quotes and losing that competition costs more in fill quality than 20% costs in margin. Revisit only with measured A/B data on Insidor's own flow.

**D4 — 0.5% minimum user fee acceptable?**
The 50 bps `referralFee` floor means the cheapest Insidor can be on `/order` is 0.5% of the trade. On top of that the user already pays 10 bps Jupiter platform fee unless referral is active (in which case it's waived). Is 0.5% competitive for this audience, or does it push toward `/build`?

**D5 — Does the "create the first coin" flow launch on pump.fun or Jupiter Studio?**
Studio (`/studio/v1/dbc-pool/create-tx`) is native and covers creation without a separate integration, but graduates into a **Meteora** pool, not pump.fun. Traders arriving from a pump.fun-detection pipeline may expect a pump.fun launch. Positioning call.

**D6 — Display X post content at all?**
Compliant options are (a) X's `publish.x.com` embeds — visually incompatible with a trading terminal, or (b) render Insidor's own narrative object (clustered summary + computed metrics) and link out to the permalink, with the Buy action attached to the *narrative*, never to a post. Option (b) is also the better product — the narrative is the proprietary asset. But it is a UX change from what the spec assumed.

**D7 — DexScreener's competing-product clause.**
API T&C §1: *"Users cannot utilize the API Services to construct, enhance, or market a product or service whose primary purpose is to compete directly with DEX Screener's product."* §2 also prohibits making the API "available for third parties," which arguably covers proxying it through your own `/api` routes to browsers. The licence is explicitly revocable. A memecoin terminal with search, trending, watchlists and token pages is a reasonable reader's idea of direct competition. **Get a lawyer's read or an email from DexScreener before the embed and API become load-bearing.** The chart embed is a separate, entirely undocumented surface with its own no-notice-of-change risk.

**D8 — TikTok scraping risk appetite.**
There is categorically no lawful first-party TikTok discovery API for a for-profit company — the Research API FAQ answers "I am a creator, advertiser, or commercial user. Am I eligible?" with a flat "No," and the Commercial Content API returns EU paid ads only. Apify scraping breaches TikTok's ToS; remedies are civil (termination, C&D, unfair-competition suit). **Mitigation:** keep TikTok a secondary signal that degrades gracefully, so a C&D costs a feature and not the product. Founder decides whether that residual risk is acceptable at all.

**D9 — Do immutable position stamps survive comment deletion?**
The design says the stamp is permanent. Permanent public records of a named wallet's positions, alongside comments that read as trade calls, is a shape regulators look at. Separately you need a deletion path for illegal content regardless. **Decide now what "permanent" means.**

**D10 — Second X provider: pay for insurance, or accept the single point of failure?**
Sole dependency on one unofficial reseller is the largest existential risk in the stack — bigger than cost. `socialdata.tools` ($0.20/1k) or Apify `apidojo/tweet-scraper` ($0.40/1k) behind the same `x-reader` interface costs ~$100/mo kept warm. twitterapi.io's uptime is entirely self-reported (`status.twitterapi.io` does not resolve) and its own two published rate limits contradict each other (homepage "1,000+ req/s" vs docs "200 QPS").

**D11 — X coverage breadth.**
Ingestion is a dial, not a fixed cost: 10k tweets/day = $46/mo, 100k = $456, 500k = $2,280. The official API cannot buy above ~65k/day at any price below Enterprise, so this is Insidor's product-sensitivity choice alone.

---

### Where the research is thin

- **Image matching** rests on one 522-image sample from a single hour. The 58.6%-duplicate figure and the 10% post-filter figure are both directionally solid but not longitudinal. Phase 3, not phase 1.
- **Birdeye's entire value proposition is unverified** — no API key was available; its bonding-curve coverage is unknown either way (U5).
- **Jupiter Studio** is documentation-only; nothing was exercised live.
- **GeckoTerminal** was never established as a capability — every request 429'd from a shared IP. Do not let anyone cite a GeckoTerminal capability from this research.
- **Privy pricing above 500 MAU** is a negotiation with no published anchors beyond "$0.001/signature".
- **RugCheck paid tiers exist** (the `refresh` param is "paid API keys only") but no price list was found anywhere.
- **Broadcast Replay** is public alpha with 3-day retention. Keep a plain paginated REST query as the source of truth for comment history; use replay only as a reconnect nicety.

**One recurring meta-lesson from the adversarial pass:** roughly a third of "verified verbatim" quotes across the research were misattributed, drawn from a deprecated surface, or fabricated outright — including one quote attributed to pump.fun's official docs that appears in no primary source at all. **Before writing code against any identifier in this pack, re-verify it against the shipped `.d.ts`, the IDL, or a live HTTP call — not against a doc page and never against a README.**