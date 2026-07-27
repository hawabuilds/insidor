# Insidor — Design & Build Document

**Status:** draft for team review · 26 July 2026
**Supersedes:** `docs/insidor-architecture.html`, `docs/insidor-user-flows.html` (both stale — they describe a mock-data-only build with no backend, which is no longer true)
**Incorporates:** the team feature map (7 features, priority-coded), `Insidor-Build-Spec` (stack verification, 22 Jul), `Insidor-Product-Flow` (object model, 3 tabs), `Insidor-Overview` (product thesis), `insidor-social.html` (social layer design)

This is the single source of truth for engineering. Where it conflicts with any earlier document, this wins. Every claim about existing code in §2 was verified against the repo at commit `a37d2e6`.

---

## 1. The product, in one page

Insidor watches social media for things going viral, surfaces them **before crypto traders find out**, and routes every user to exactly one action: buy the coin that exists, or create the first one if nobody has.

Competitors start at the coin. By the time Axiom or Photon shows you a token, you're racing ten thousand people to something that already exists. Insidor starts at the story — 20–90 minutes earlier. **That head start is the entire product.**

The number that carries it: **how early you were.** It must be provable (the source post is public and timestamped), and the misses must stay on the record next to the wins — a track record with no left tail reads as a casino ad.

### The one rule that removes all ambiguity

Every card's primary button is a **pure function of how many coins the story has**:

| Coin count | Button | Why |
|---|---|---|
| 0 | **Create coin** | You're minting first |
| 1 | **Buy $TICKER** | Unambiguous |
| 2+ | **See the N coins** | Never guess for the user |

No surface in the app renders "Buy" when more than one coin exists — not because the copy is careful, but because that state is unrepresentable in the component.

---

## 2. What already exists (honest inventory)

**This is the section none of the other documents have**, and it changes the plan. The build spec plans work that is partly already done, and the flow doc names a "root cause" bug that the database has already solved.

### Already built and working

| Thing | Where | State |
|---|---|---|
| **Six-stage narrative pipeline** | `worker/` (~11k lines) | Real. Ingest X → ingest TikTok → snapshot → score → cluster → trends |
| Meme-ability scoring | `worker/lib/meme-score.js` | Real, Claude Haiku, separate X and TikTok prompts |
| Narrative clustering | `worker/lib/cluster-engine.js` | Real — cashtag → keyword overlap → embedding cosine, in priority order |
| Google Trends momentum | `worker/lib/serp-trends.js` | Real, SerpAPI, feeds the sparkline |
| Cost governors | `worker/lib/budget.js`, `anthropic-budget.js`, `apify-budget.js` | Real and thorough — adaptive floors, daily caps, spend-blocking |
| Market data proxies | `api/` (14 routes) | Real — Birdeye OHLCV/trades/top-traders, Helius balances/holders |
| Safety checks | `api/safety.js` | Real — mint/freeze revoked, LP burned, top-10 concentration |
| **Jupiter quote + swap** | `api/quote.js`, `api/swap.js` | **Real, and already accepts `feeAccount`** |
| Token discovery | `site/live.js` | Real — DexScreener keyless, self-populating |
| Supabase persistence + Realtime | ~20 tables | Real, live project |

### Three findings that change the plan

**1. The flow doc's "root cause" is already fixed in the database.**
`Insidor-Product-Flow` identifies the structural bug as *"the story and the coin are the same record."* That is true of the **frontend** and false of the **backend** — `narratives`, `narrative_posts` and `narrative_tickers` are already three separate tables with proper foreign keys. Coins already hang off stories, many-to-one. The split the flow doc calls for is a **frontend-only** job. That is a much smaller task than the doc implies.

**2. Feature 2's revenue capture is one environment variable away.**
The build spec correctly killed Photon/Axiom and moved to Jupiter, and recommends setting an integrator fee. [`api/swap.js:28`](../api/swap.js) already forwards `feeAccount` to Jupiter's swap endpoint. The plumbing exists; nobody has set up the referral account. The build spec's "delete the build-our-own-terminal milestone" conclusion holds, and the head start is bigger than it estimated.

**3. The TikTok showstopper was already resolved in code, by a route the architecture doc didn't consider.**
`Insidor-Architecture` §00 showstopper 3 concludes there is *no lawful first-party discovery API* for TikTok. Correct. But `worker/ingest-tiktok.js` + `worker/lib/apify-budget.js` already ingest TikTok via **Apify scraping** — a third-party scraper, not a first-party API. That is a real, working path and a real, accepted ToS risk. **It is a decision that was made in code without being written down.** It belongs in the risk register (§10), not in a showstopper list, but counsel should see it.

### 🔴 The pipeline is currently dead, and here is exactly how

Diagnosed live against the production Supabase project on 26 Jul. The database holds **1,041 narratives, 1,718 posts, 916 tickers, 52,498 snapshots** — all real pipeline output. But:

- **0 narratives are `display_eligible`. 0 have `status = 'open'`.** Every one of the 200 most recently updated is gated `too_old`.
- **X ingestion stopped at 2026-07-25 08:54 UTC**, after 18,534 reads that day (~$2.78). Nothing on the 26th or 27th. The configured daily cap is 33,000, so **this is not the budget guard** — it looks like twitterapi.io credit exhaustion or a revoked key.
- **Anthropic stopped ~24h later**, 2026-07-26 08:51, after chewing through the remaining backlog (765 calls that day, 3,285 the day before).
- **TikTok has ingested 0 all along** — that lane has never run in production.
- `snapshot` and `trends` crons **are still firing normally** (snapshotter logged a cycle minutes before this was written) but do `0 calls · 0 tweets` because there is nothing fresh to snapshot.

**Causal chain:** X ingestion died → the backlog scored out over ~24h → everything aged past the freshness gate → `display_eligible` fell to zero → the site renders nothing. This is a **billing/credential problem, not a code problem** — code bugs don't wait until 08:54.

> **Fix this first.** Nothing in Weeks 1–3 can be validated against live data until X ingestion resumes. Check the twitterapi.io balance and the `X_API_KEY` / `ANTHROPIC_API_KEY` values in Vercel.

### 🔴 `narrative_tickers` is not a coin table, and Feature 2 cannot ship against it

Two defects found by pointing the new frontend at it:

**1. There is no mint address column.** `lib/token-lookup.js:75` resolves a mint from DexScreener (`pair.baseToken.address`) and then **discards it, because `narrative_tickers` has nowhere to put it.** A swap needs a mint. Feature 2 is blocked on a one-column migration plus a backfill.

**2. Ticker-string matching produces false positives, live, right now.** Two unrelated stories — *"just remembered i am a user of the…"* and *"gym day"* — both matched ticker `PUMP` to the **real $1.84B Pump.fun token**, flagged `canonical: true, first_deployed: true`. On the new Trending board, a story about an Atlético Madrid transfer renders a **"Buy $KANG"** button.

This is live proof of the gap the build spec named — *"match by ticker **and** image, not tickers alone"* — and of the structural finding in the architecture review that *no one had designed story-to-existing-coin matching*. **It promotes F3.2 (the indexer) from a post-MVP nicety to the thing that makes the buy path safe.** Until it exists, every coin match must be presented as a candidate, never as a fact.

**3. `docs/schema.md` is wrong in both directions** — it lists `mint_ca` on `narrative_tickers`, which does not exist, and omits `author_velocity`, `distinct_authors`, `ct_pickup`, `ticker_proposals`, `sound_id` and `subject_entity`, which do. Regenerate it from the real catalog.

### Where the mockup actually is

One file. [`site/index.html`](../site/index.html) — 3,852 lines: ~930 of inline CSS, ~2,400 of inline app script, everything in one global scope. Inside it: hardcoded `NARR[]`, `TOKENS[]` built by `mkToken()`, 14 fake narratives (`ferry-horn`, `porch-frog`), loremflickr images, a 700ms fake trade, watchlists in a session `Set`.

The consequence that matters: **`live.js` (2,057 lines) exists mostly to translate real pipeline rows back into the fake seed shape** so the untouched render functions keep working. Two data models are fighting, and the adapter between them is where the accidental complexity lives. That adapter gets deleted, not extended.

### Repo hygiene (all verified)

- **Missing dependency.** 12 scripts `require('pg')`; it is in neither `package.json` nor the lockfile. Every `npm run schema:*` crashes on a fresh clone.
- **Dead declared dependency.** `@privy-io/js-sdk-core` is declared but only the dead prototype uses it; `site/index.html` loads Privy from CDN.
- **Dual execution models.** `worker/index.js` runs the six stages as infinite loops; `api/cron/*` runs the same stages as Vercel Cron. Same logic, two lifecycles, nothing preventing both against one database.
- **Concurrency protection is zero.** `worker/lib/pipeline-lock.js` is a PID lockfile (can't work on serverless anyway) and `acquirePipelineLock` is **never called anywhere**.
- **`/api` is an open proxy to paid keys.** `Access-Control-Allow-Origin: *`, no auth, no rate limit. `api/_lib/cache.js` is an in-memory `Map` — per-instance and mostly cold on serverless, so near-zero protection. Anyone with the URL can burn Birdeye CU and Jupiter quota.
- **Every `/api` route returns HTTP 200 on error** (`api/_lib/http.js:7`), so clients can't distinguish success from failure.
- **Orphaned modules:** `worker/lib/ingest-age-log.js`, `worker/lib/pipeline-crash.js`, `worker/lib/pipeline-heartbeat.js`, `worker/reactivate-viral-posts.js`.
- **Zero tests, no lint, no CI** across 139 files — including the scoring and clustering heuristics that *are* the product.
- **Cron economics unchecked.** 5 crons at `*/2`–`*/3` ≈ 2,600 invocations/day at up to 60s. Confirm against the Vercel plan.

Not a problem, despite appearances: the anon key in `site/config.js:8` is public by design and RLS-protected. Correctly separated from the service key.

---

## 3. The canonical object model

Nine objects. If a feature doesn't touch one of these, it doesn't ship.

| Object | Plain English | Relationships | Status |
|---|---|---|---|
| **Narrative** *(UI: "Story")* | A thing going viral that people might coin | 1–n posts, 0–n coins, 0–1 top coin | ✅ `narratives` |
| **Post** | The actual tweet or video. Its permalink is the proof | belongs to 1 narrative | ✅ `narrative_posts` |
| **Poster** | Who posted it. Gets a cut whether they know or not | 1 → n narratives | ❌ **new** |
| **Coin** | A coin made from a narrative. There can be several | n → 1 narrative, 1 maker, 0–n holdings | ✅ `narrative_tickers` |
| **User** | A wallet, via Privy | 1 → n everything below | ❌ **new** |
| **Comment** | A take on a narrative, stamped with when it was written | n → 1 narrative, 1 author | ❌ **new** |
| **Follow** | Watchlist entry. Targets a narrative **or** a coin | n → 1 user | ❌ **new** |
| **Holding** | What you own, what you paid, how early you were | 1 coin, 1 narrative, 1 user | ❌ **new** |
| **Payout** | Money a coin owes somebody (maker 50 / poster 40 / Insidor 10) | 3 roles per coin | ❌ **new** — gated on §9 decision |

**Naming.** The database and worker code say `narrative`. The product docs and UI copy say "story". Renaming 20+ tables and columns across 11k lines of working worker code to match copy is a bad trade. **Decision: `narrative` in all code and SQL, "story" in all user-facing copy.** One mapping, written down once, here.

### The number that carries the product

`minutes_early` lives on every **Holding** and appears in no build so far:

> "You got in 41 minutes before crypto traders did."

It can be **negative, and we show it.** Roughly a third of real detections will be late. This is the honesty that makes the other two thirds credible.

### The stamp (from `insidor-social.html` — adopt as specified)

Every comment denormalises **the state of the narrative at the moment it was written** — views, coin count, age, top mcap — plus the author's on-chain position at write time. It is a historical fact, not a join, and it must never change.

This is the strongest idea in any of the documents, for three reasons:
1. It makes earliness **visible and permanent** — the product's whole thesis, applied to people.
2. The **position badge** (`holds 2.1 SOL` / `no position` / `sold`) shows whether someone is talking their book. No comment section in crypto can do this. We already have Helius (`api/balance.js`) to read it.
3. It gives **non-gameable ranking later** for free. A user's score becomes "how early were they, on things that worked, across how many independent stories" — which cannot be farmed without actually being right, repeatedly. Upvotes can be farmed; this cannot.

**Build the stamp into the schema from day one, even before comments ship.** It is unrecoverable retroactively.

---

## 4. Architecture decisions (locked)

| # | Decision | Rationale |
|---|---|---|
| **A1** | **Next.js (App Router) + TypeScript + Tailwind** on Vercel | Already on Vercel; the 14 `api/` routes port to route handlers near 1:1; Privy ships `@privy-io/react-auth`; Jupiter Plugin wants `enableWalletPassthrough` into a React wallet context; `site/index.html` already mounts Privy React from esm.sh. The current single-file architecture cannot carry realtime + comments + auth + watchlists + charts. |
| **A2** | **Port the design system, not the markup** | The two prototypes share a real, consistent visual language — Clash Display / General Sans / JetBrains Mono, near-black surfaces, cyan + lime accents. Extract to Tailwind tokens. The design is settled; do not redesign. |
| **A3** | **Frontend reads the pipeline shape directly. `live.js` is deleted.** | The translation layer is the single largest source of accidental complexity. Components consume `narratives`/`narrative_posts`/`narrative_tickers` as they are. |
| **A4** | **Vercel Cron is the only pipeline execution model** | DB-backed resumption (`worker/lib/cron-state.js`) already exists for it. `worker/index.js` becomes a local-dev-only harness, explicitly labelled, or is deleted. Add a DB advisory lock to replace the dead PID lockfile. |
| **A5** | **Jupiter for swaps, quotes, and trending coins** | Photon and Axiom have no public API — verified against Axiom's own `llms.txt` and QuickNode's directory. Jupiter also pays us an integrator fee; Photon charges our user 1% and pays us nothing. Already wired in `api/quote.js` / `api/swap.js`. |
| **A6** | **DexScreener iframe for charts** | Free, zero build. `?embed=1&theme=dark&info=0&trades=0`. Replaces the TradingView widget. |
| **A7** | **Pump.fun SDK for creation** | `@pump-fun/pump-sdk`, MIT, official. Creation costs $0 beyond rent and tx fees. |
| **A8** | **Privy for wallets** | Pump.fun and Jupiter both run on Privy — our competitors have load-tested the exact code paths. |
| **A9** | **Supabase Postgres + Realtime for comments** | Already the persistence layer. Do not build a websocket tier: under $150/mo saved at 50k DAU, against two weeks plus permanent on-call. |
| **A10** | **Comments attach to the narrative — never a post, never a coin** | **Policy:** X's Display Requirements forbid attaching third-party actions to a displayed Post, verbatim. **Product:** one story spawns several coins; attaching to coins fragments discussion across duplicates. Attaching to the story also means a story with *no coin yet* has a discussion — exactly where the earliest takes happen. |
| **A11** | **Moderation ships in the same release as the comment box** | A crypto comment section open for one week without a filter is unrecoverable. See §6 F1.3. |
| **A12** | **One repo, one deploy target** | Retire the `deploy-target` layer2/layer3 meta switch. It exists to straddle two deploys that should be one. |

### Navigation: three tabs

Adopt the flow doc's collapse from seven views to three. It is the better design and it absorbs the orphans cleanly.

| Tab | Its one job | Absorbs |
|---|---|---|
| **Trending** | See what's going viral and what to do about each one | the old `trending` + `narratives` + `new` + the live rail |
| **Search** | Find anything; browse what has no coin yet; read the honest record | the old `search` + `tokens`, via chips: *No coin yet · Just made · Trending now · Finished* |
| **You** | Everything that's yours, in one scroll, in dollars | the old `watchlist` + portfolio + launches + claims |

Story page and Coin page are pushed routes, not tabs. The live rail gains a fourth mode — **Chatter** — which is the cheapest way to make a new visitor feel the place is alive.

---

## 5. Database plan

### Existing (keep)
`narratives` · `narrative_posts` · `narrative_tickers` · `post_snapshots` · `post_meme_scores` · `post_embeddings` · `ingest_near_miss` · `worker_*` (budget, usage, cycle log)

### New tables

```sql
-- ── identity ──────────────────────────────────────────────────────────
create table app_user (
  id              uuid primary key default gen_random_uuid(),
  privy_did       text unique not null,
  wallet_address  text unique,
  handle          text unique,
  created_at      timestamptz default now()
);

create table poster (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null,              -- x | tiktok
  handle       text not null,
  derived_wallet text,                     -- deterministic, pre-claim (see §9 D2)
  claimed_by   uuid references app_user(id),
  opted_out    boolean default false,      -- ships with the payout release
  unique (platform, handle)
);

-- ── social ────────────────────────────────────────────────────────────
create table comment (
  id            uuid primary key default gen_random_uuid(),
  narrative_id  uuid not null references narratives(id),   -- never post, never coin
  author_id     uuid not null references app_user(id),
  body          text not null,
  created_at    timestamptz default now(),

  -- THE STAMP: narrative state frozen at write time. Denormalised on
  -- purpose — a historical fact, not a join. It must never change.
  snap_views       bigint,
  snap_coin_count  int,
  snap_age_min     int,
  snap_top_mcap    numeric,

  -- THE POSITION: read from chain at write time, same reasoning
  snap_position_lamports bigint,
  snap_position_mint     text,

  status  text default 'visible',           -- visible | held | removed
  flags   jsonb
);

create index on comment (narrative_id, created_at desc);
create index on comment (narrative_id, snap_views asc);   -- "earliest takes" sort

-- ── user state ────────────────────────────────────────────────────────
create table follow (
  user_id      uuid not null references app_user(id),
  narrative_id uuid references narratives(id),
  coin_mint    text,
  created_at   timestamptz default now(),
  check (num_nonnulls(narrative_id, coin_mint) = 1),   -- one or the other, never both
  unique (user_id, narrative_id, coin_mint)
);

create table holding (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references app_user(id),
  coin_mint      text not null,
  narrative_id   uuid references narratives(id),
  entry_price    numeric,
  amount         numeric,
  -- the emotional payload of the entire product. can be negative. we show it.
  minutes_early  int,
  opened_at      timestamptz default now(),
  closed_at      timestamptz
);
```

`launch` and `payout` are specified with Feature 3, gated on decision **D2**.

### Migration discipline

24 loose `schema-*.sql` files applied by 12 hand-rolled `apply-schema-*.js` scripts, with no ordering, no migration table and no rollback, is not a schema — it's an archaeology site. Consolidate to **ordered, idempotent, numbered migrations** with a `schema_migrations` table, and generate `docs/schema.md` from the real catalog (the current one lists every type as `(live)` and everything as nullable, which is a column-name listing, not a schema).

---

## 6. Features → build mapping

Priorities are the team's. The "already have" column is what changes the estimates.

### F1 · Live Feed — viral posts only
| Task | Priority | Already have | Net new |
|---|---|---|---|
| **F1.1** Social layer integration (ingest → detect → cluster → score) | **PRIORITY** | **Effectively all of it** — the six-stage worker | Frontend that reads it directly; delete the adapter |
| **F1.2** Trenches section | LATER | — | Ship last |
| **F1.3** Comments / share thoughts | **PRIORITY** | Supabase + Helius for positions | `comment` table, stamp, position badge, composer, Realtime, **+ filter in the same release** |
| **F1.4** Ranking, tags, rev-share | LATER | The stamp makes it non-gameable | Score from stamp data. **Do not pay for it** — see §10 |
| **F1.5** Social profiles | LATER | — | — |
| **F1.6** Flex cards | LATER | — | — |

**The moderation filter (F1.3), in order of cost.** Off-the-shelf moderation APIs — OpenAI, Perspective, Azure, Hive — classify hate, violence and sexual content and detect **exactly zero** of the harms that will actually appear. The crypto-native layer must be in-house. (Also: Perspective sunsets 31 Dec 2026 and closed quota increases in Feb 2026 — any plan naming it needs rewriting.)

1. **Address gate** — a base58 string 32–44 chars in the body that is **not** one of this narrative's mints → **block, no appeal.** This is ~90% of the spam, and it's one lookup against a table built for another feature. No ML, no vendor, no threshold tuning. *This is the cheapest, highest-leverage thing in the whole social layer.*
2. **Impersonation** — handle within edit-distance 2 of the narrative's poster or a top-50 account, unverified → hold for review.
3. **Wallet age** — under 24h with zero prior transactions → rate limit to 1 comment/narrative; hold if links present.
4. **Velocity** — >3 comments/60s per wallet, or identical body under >2 narratives in 10 min → silent drop, no error shown.
5. **Generic** — an off-the-shelf API for hate/violence/sexual. Necessary; catches none of 1–4.

**Require a connected wallet to post.** Not for identity — for cost. It's the cheapest sybil resistance available, and Privy is already in the stack.

### F2 · Live swap / chart / trade — **PRIORITY, 3-week clock**
Rewritten per the build spec: Photon and Axiom are out (no public API exists — not "hard to get", *does not exist*; the community "Axiom SDKs" require storing users' Axiom passwords and running headless Chrome past Cloudflare). Jupiter is in, and it pays us.

- **Swap:** Jupiter Plugin (`plugin.jup.ag/plugin-v1.js`), `displayMode: 'integrated'`, `enableWalletPassthrough: true` so we never ask the user to connect twice, `formProps: { referralAccount, referralFee }`.
- **Execute:** `api.jup.ag/ultra/v1/order` → `/execute`.
- **Fee:** we set the integrator fee, max 255 bps. Jupiter takes ~20% of it on the aggregated `/order` path, **0% on the raw `/build` path**.
- **Charts:** DexScreener iframe. Free.
- **Cost:** Jupiter Developer $25/mo (10 RPS); the free 1 RPS tier genuinely works for a private beta.

> ⚠️ **Measure before pricing.** Jupiter's docs describe a 50 bps platform fee on tokens under 24 hours old — essentially every Insidor trade. The live API returned **10 bps** on seconds-old tokens during verification. Docs and live behaviour disagree. Quote a real new token and measure; this decides our margin.

**Delete the "build our own terminal later to take all fees" milestone.** It was premised on renting a terminal that pays us nothing. Jupiter pays from week one. Spend that time on the indexer.

### F3 · Creating coins — CORE
- **F3.1 Create:** `@pump-fun/pump-sdk` `createV2Instruction`. Limits: name ≤32, symbol ≤13, uri ≤200. Metadata via `pump.fun/api/ipfs` — **have a Pinata fallback**, don't be single-homed on someone else's uploader.
- **F3.x The poster's 40%:** natively supported and permissionless — `create_fee_sharing_config` → `update_fee_shares_v2` → `distribute_creator_fees_v2`. Up to 10 shareholders, bps summing to exactly 10,000. Critically, `create_v2` takes `creator` as a pubkey **independent of the signing wallet**, so Insidor can pay for and sign a launch while assigning creatorship elsewhere. Gated on decision **D2**.
- **F3.2 Find the existing coin — NOT a 3-week feature.** There is no Pump.fun search API; `/coins/search` is dead. **We are building an indexer.** Stream `create_v2` instructions for mint/name/symbol/uri, hydrate images via Helius `getAssetBatch` (1,000 mints/call), filter to nonzero volume or bonding-curve position (1–3M images, not 12M), embed with self-hosted SSCD, search with pgvector HNSW combining image similarity + fuzzy ticker + text embedding.

> Published near-duplicate thresholds come from DISC21 — *transformed Flickr photos*, not memes with text overlay and AI-generated logos. **Hand-label a few hundred real post→token pairs and fit our own cutoff.** Don't ship a borrowed number.

### F4 · Connect wallet — CORE
`@privy-io/react-auth`. Solana is first-class. **Stop researching this layer.** Three things to price in:
- **The $1M/month volume ceiling.** 500 real traders at $2,000/mo of volume hits it; usage billing starts there. Model it now.
- **Privy's swap API pays us nothing on Solana** (developer fees are cross-chain only) and gas sponsorship is mandatory for it. Route swaps through Jupiter.
- **No card→memecoin.** Funding is SOL or USDC, so every new user is onramp → SOL → swap: two flows, ~2.5% card fee plus swap. That is a real conversion cliff against the "buy the viral coin in one tap" promise, and it needs a product answer.

### F5 · Watchlist — CORE
Two tables and a star button. **The value is the notification when a watched narrative finally mints** — that's the retention hook, not the list. Surfaces as **You → Following**.

### F6 · Search — CORE
Postgres full-text over our narrative corpus + the token index from F3.2. **Search is downstream of the indexer and cannot ship before it.** By CA: resolve the mint through the index, then show the coin *and* the narrative it came from.

### F7 · Trending — CORE
- **Narratives:** our own scoring, filterable by age / views / velocity. This is the part nobody else has, and it is already computed in `worker/score.js` + `worker/lib/velocity.js`.
- **Coins:** Jupiter `tokens/v2/toptrending/{5m|1h|6h|24h}` (free), or Birdeye ($99–199/mo, adds websockets).

---

## 7. Repo structure

Three folders currently hold this project. Consolidate to one.

```
Insidor/                         ← the git repo, keep
├── app/                         ← NEW Next.js App Router
│   ├── (tabs)/trending|search|you/
│   ├── story/[id]/  coin/[mint]/
│   └── api/                     ← the 14 routes, ported
├── components/                  ← extracted from the prototypes
├── lib/                         ← shared client+server (token-lookup lives here now)
├── worker/                      ← unchanged, minus orphans
├── supabase/migrations/         ← ordered, replaces 24 loose .sql + 12 apply scripts
├── docs/
│   ├── DESIGN.md                ← this file, the source of truth
│   ├── product/                 ← the 4 Insid0or docs, moved in
│   └── reference/               ← feature map + insidor-social.html
└── design/                      ← the 2 prototypes, read-only visual reference
```

**Actions:**
1. Move `Insid0or/docs/*` → `Insidor/docs/product/` — these are the real product docs and they're currently outside the repo, untracked.
2. Move the feature map and `insidor-social.html` → `docs/reference/`.
3. Keep `site/index.html` + `Insidor-prototype (2).html` in `design/` as visual reference until the port is done, then delete. *(Rename off `Insidor-prototype (2).html` — the space and parens break shell scripts.)*
4. `Insid0or/archive/` — 11 dead mockup iterations. **Delete, pending confirmation** (§9 D4). They're recoverable from Hawa's session history if wrong.
5. Delete `docs/insidor-architecture.html` + `docs/insidor-user-flows.html` — actively misleading ("Backend: **None** — all data in-memory"). Superseded by this file and `docs/product/`.
6. Delete the orphans: `worker/lib/ingest-age-log.js`, `pipeline-crash.js`, `pipeline-heartbeat.js`, `worker/reactivate-viral-posts.js`.
7. Add `pg` to `package.json`; drop `@privy-io/js-sdk-core`.
8. Add ESLint + Prettier + Vitest + a CI workflow. First tests go on `meme-score`, `cluster-engine` and `velocity` — the heuristics that are the product.

---

## 8. Sequence

The three-week clock applies to **the trading terminal, not the indexer.** The build spec's week plan assumed a frontend existed to put Jupiter into; it doesn't. That is the one correction — **Week 0 is foundation**, and it is not optional.

### Week 0 — Revive the pipeline, kill the assumptions, build the floor

**First, before anything else: get X ingestion running again** (§2). Everything downstream is unverifiable while the board has no live data. Then add the missing mint column to `narrative_tickers` and backfill it — Feature 2 is blocked on it.

Three cheap checks *before* code:
1. Quote a seconds-old token through Jupiter and **read the actual platform fee** (10 vs 50 bps).
2. Call `pump.fun/api/ipfs` and confirm it still accepts uploads.
3. Read live `update_fee_shares_v2` semantics on devnet — confirm how one-shot the split really is.

Then: repo consolidation (§7), Next.js scaffold, design tokens extracted, ordered migrations, `/api` hardened (auth + real rate limiting + honest status codes), one execution model (A4), `pg` fixed, CI up.

### Week 1 — Feed + trade
Trending tab reading pipeline data directly · Story page (evidence left, discussion column stubbed right) · Jupiter Plugin embedded with wallet passthrough · DexScreener charts · Privy wallets · Jupiter `toptrending` for the coin lens.
→ **F1.1, F2, F4, half of F7. The 3-week clock is met in week 1.**

### Week 2 — The social layer, filter included
`comment` table with the stamp · position badge via Helius · composer with live CA detection · Supabase Realtime · Chatter rail mode · **the full 5-stage filter in the same release** · Follow/watchlist + the mint notification.
→ **F1.3, F5.**

*(This swaps the build spec's week 2/3 order. The team notes rank comments PRIORITY and coin creation CORE-unranked, so comments come first.)*

### Week 3 — Creation
Pump.fun `createV2Instruction` · auto-namer from the post · safety defaults and cost shown before signing · fee-sharing config **if D2 is yes** · `launch` + `payout` tables.
→ **F3.1.**

### Weeks 4–7 — The indexer
Stream `create_v2` → corpus → filter → embed → pgvector. Hand-label an evaluation set and fit our own threshold. Search ships on top.
→ **F3.2, F6.**

### Later
Trenches · ranking from the stamp · profiles · flex cards. Take legal advice on rev-share **before designing it**, not before shipping it.

---

## 9. Decisions needed

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| **D1** | Confirm **Next.js + TypeScript + Tailwind** | Everything from Week 0 | Yes — A1 |
| **D2** | **Is the poster's 40% still in?** | F3, permanently | Decide before Week 3. The split is **set once at launch and cannot be added later**, so a coin minted without it can never have it. If yes, the architecture is to derive a Privy embedded wallet from the poster's handle at launch and set *that* as shareholder — addressable on-chain before the human has ever logged in, and `distribute_creator_fees_v2` will pay a wallet nobody has claimed. |
| **D3** | **Three tabs** (Trending / Search / You), or keep seven views? | Frontend structure | Three — it's the better design and absorbs the orphan views cleanly |
| **D4** | Delete `Insid0or/archive/` (11 dead mockups)? | Cleanup | Delete — recoverable from session history |
| **D5** | Has anyone emailed Photon/Axiom BD about a **private** partner API? | Nothing — F2 ships on Jupiter either way | One message answers it. Public API: definitively no. Behind a BD email: unverified. |
| **D6** | Is the live Supabase project seeded with real data right now, or do I seed? | Week 1 dev | — |

---

## 10. Risk register

| Risk | Severity | Standing |
|---|---|---|
| **X ingestion is dead in production** since 25 Jul 08:54 — no live data reaches the site | **Blocking** | Check twitterapi.io balance and Vercel `X_API_KEY`. **Nothing in Weeks 1–3 can be validated until this is restored.** See §2. |
| **No mint address stored for any coin** — token-lookup resolves one and throws it away | **Blocking F2** | One-column migration + backfill. A swap cannot be built without it. |
| **Ticker-only coin matching yields false positives** — unrelated stories linked to a $1.8B token | **High** | Present every match as a candidate until the F3.2 indexer lands. A wrong "Buy" button on a memecoin terminal is a user losing money. |
| **X ingestion is the entire cost story** — $0.005/post read, ~$200 beta → up to $10,000 at 50k DAU. Everything else together is under $1,200/mo at 50k. | **High** | The 2M read/month ceiling is both the budget *and* the product limit. **Curate accounts; don't chase the firehose.** |
| **X Display Requirements** forbid attaching third-party actions to a displayed Post | **High** | Mitigated by A10 — attach to the narrative. Keep it that way; it's a hard rule. |
| **X revoked API access for "InfoFi" apps** (15 Jan 2026) — apps attaching financial rewards to posting | **High** | Our distinction is that payout triggers on *trading volume*, never on posting — structurally a royalty, not a bounty on amplification. **That distinction is ours, not X's, and untested.** Counsel must read the mechanic against the actual Developer Agreement. |
| **TikTok ingestion is third-party scraping** (Apify), already live in code | **High** | Undocumented decision, now documented. No lawful first-party discovery API exists for TikTok. Counsel should see this. |
| **Paying a poster who never consented** | **High** | Now technically easy, which makes the legal question binding. Right of publicity is state law, no federal statute, consent is the primary defence. **Ship the opt-out registry and the "not created or endorsed by" disclaimer in the same release as the split.** |
| **Rev-share for commentary** | **High** | FTC Endorsement Guides ($51,744–$53,088/violation) + CFTC Rule 180.1 exposure when we also earn fees on the promoted thing. **Build the score, display the score, do not pay for the score.** Correctly LATER. |
| `sharing_config` **permanently disables** `collect_creator_fee_v2` for that mint | **High** | If the distribution cranker breaks there is **no fallback collection path.** Build and monitor it before shipping a single shared coin. |
| PDA seed mismatch: `[b"creator-vault", creator]` on Pump vs `[b"creator_vault", coin_creator]` on Pump AMM | Medium | **Hyphen vs underscore.** Easy and expensive. |
| `/api` open proxy to paid keys | Medium | Fix in Week 0. Currently anyone with the URL can drain Birdeye CU and Jupiter quota. |
| Zero tests on the scoring/clustering heuristics | Medium | Can't tune `meme-score` or `cluster-engine` with any confidence about what broke. First tests in Week 0. |
| **APIs in this space move weekly** | Medium | The build spec's adversarial pass refuted **15 of 26** specific claims — not the conclusions, but exact endpoints, prices and method names. **Treat every code identifier in this document as needing confirmation on the day it's used.** |

---

## Appendix — document lineage

| Document | Date | Standing |
|---|---|---|
| `docs/product/Insidor-Overview` | Jul 2026 | **Current** — product thesis, unchanged |
| `docs/product/Insidor-Product-Flow` | Jul 2026 | **Current** — object model and 3-tab navigation adopted here |
| `docs/product/Insidor-Build-Spec` | 22 Jul 2026 | **Current** — stack verification adopted wholesale. §6 sequence revised for Week 0 and comments/create order. |
| `docs/product/Insidor-Architecture` | Jul 2026 | **Partly superseded** — §07 and §12 assumed Meteora/Bags + Jupiter-only. Showstoppers 1 and 3 resolved (see §2). |
| `docs/reference/insidor-feature-map.html` | 26 Jul 2026 | **Current** — priorities are authoritative |
| `docs/reference/insidor-social.html` | Jul 2026 | **Current** — the stamp, position badge and CA gate adopted as specified |
| `docs/insidor-architecture.html` (in-repo) | Mar 2026 | **Delete** — "Backend: None", "No vercel.json". Both false. |
| `docs/insidor-user-flows.html` (in-repo) | Mar 2026 | **Delete** — describes the mock-only prototype |
