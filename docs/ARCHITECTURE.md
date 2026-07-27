# Insidor — Engineering Architecture

This is the document you open to set up the repository and start building. It covers
the shape of the system, the schema, the boundaries, and the machinery that keeps
them honest. Its companion, `docs/DESIGN.md`, covers the product and the screens;
nothing here repeats it.

Two rules govern every decision below.

**A wrong state should be unrepresentable, not merely discouraged.** Every defect the
last build shipped — an LLM-invented ticker resolved against a live market, a safety
checker that reported every token safe because it read fields the endpoint did not
have, an age of zero for a coin whose mint time was unknown, a lead time nobody could
reproduce — passed code review. So the controls live in CHECK constraints, generated
columns, column-level grants, type brands, and failing tests. Not in conventions.

**Absent is not zero.** A missing number renders as an em dash with a reason, at every
layer, from the column type to the React component. `?? 0` is a lint error.

---

## 1. THE SHAPE

Two deployables, four shared packages, one Postgres.

**`apps/web`** — Next.js 16 on Vercel. Renders every surface, holds every route
handler, and is the only thing Vercel builds. It reads through RLS-scoped policies
and writes only through server routes holding the service role. It never imports
`apps/pipeline`.

**`apps/pipeline`** — a long-lived Node service on Fly.io, scheduled by Inngest. It
holds the service-role key, a PumpPortal websocket, and every metered vendor
credential. It is the sole writer of story, post, coin, match, clock, board and ops
state. It never imports React and never imports `apps/web`.

They share a database and nothing else. All common code goes through
`packages/contracts`, which is a leaf with one runtime dependency (`zod`).

### What runs where

| Concern | Home | Why not the other place |
|---|---|---|
| Board ranking (20s commit) | pipeline | A board that ranks inside the request gets slower exactly when it gets popular, and rank stability (dwell, hysteresis, MAX_MOVE) cannot be expressed in a request-scoped `ORDER BY`. |
| Board read | web, 40-row index scan on `board_state` | — |
| Coin matching | pipeline | Needs image embeddings, mint-stream history and a matcher version. Nothing about it is request-shaped. |
| Quote / order / execute | web route handlers | Needs the user's wallet, an edge rate limit keyed on that wallet, and a `request_id` uniqueness check at submit. |
| Launch (pump.fun `create_v2`) | web route handlers | Same. The mint keypair is generated and persisted encrypted before the first signature. |
| Comment insert | web route handler | The honesty stamp needs a server-side chain read; a client-supplied stamp is a fabricated stamp. |
| Follow / watchlist | web route handler | The highest-volume follower class is anonymous device follows, which have no principal a policy could scope. |
| Notifications fan-out | pipeline | Triggered by a 0 → ≥1 confirmed-coin transition, which only the matcher observes. |
| Scheduling | Inngest, inside the pipeline | Vercel Cron has no singleton, no backpressure, no retries, and no concept of "ran but produced nothing" — which is the exact failure that went unnoticed for two days. |

```mermaid
flowchart TB
  subgraph vendors["External"]
    TW["twitterapi.io"]
    AP["Apify · TikTok"]
    PP["PumpPortal WS<br/>mint stream"]
    DS["DexScreener"]
    RC["RugCheck"]
    HE["Helius RPC"]
    JU["Jupiter"]
    AN["Anthropic · Gemini"]
    PF["pump.fun create_v2"]
  end

  subgraph fly["apps/pipeline — Fly.io, Inngest"]
    ING["ingest-x · ingest-tiktok"]
    SNAP["snapshot"]
    SCORE["score<br/>meme + coinability"]
    CLU["cluster → promote"]
    RES["resolve-coins<br/>the matcher"]
    CLK["clocks-mint · clocks-ct"]
    RANK["rank-commit<br/>every 20s"]
    OUT["outcomes · watchdog"]
  end

  subgraph db["Supabase Postgres — 46 tables"]
    CORE[("story · post · coin<br/>coin_match · coin_safety")]
    CLOCKS[("story_clock · story_outcome<br/>sensor_heartbeat · sensor_gap")]
    BOARD[("board_state · board_tick")]
    APP[("app_user · follow · holding<br/>comment · trade · launch")]
    OPS[("ops_stage_run · ops_sli_sample<br/>ops_spend")]
  end

  subgraph vercel["apps/web — Vercel"]
    RSC["RSC screens<br/>features/*/server"]
    API["route handlers<br/>order · execute · launch<br/>comments · watchlist"]
    CLIENT["client components<br/>anon key only"]
  end

  TW & AP --> ING --> CORE
  PP --> CLK
  DS --> SNAP --> CORE
  RC & HE --> RES
  AN --> SCORE
  ING --> SCORE --> CLU --> CORE
  CLU --> RES --> CORE
  CLK --> CLOCKS
  RANK --> BOARD
  CORE --> RANK
  OUT --> CLOCKS
  ING & SNAP & SCORE & CLU & RES & RANK --> OPS

  CORE & BOARD & CLOCKS --> RSC
  RSC -- props + tick_seq --> CLIENT
  BOARD -. "realtime broadcast<br/>one frame / 500ms" .-> CLIENT
  CLIENT --> API
  API -- service role --> APP
  API --> JU & PF & HE

  packages["packages/contracts<br/>types · zod · agreed functions"]
  packages -.-> vercel
  packages -.-> fly
```

### The shared packages

| Package | Contents | Dependencies |
|---|---|---|
| `packages/contracts` | branded ids, enums mirrored from the database, generated row types, `Pending<T>`, `BuyableCoin`, `primaryAction()`, the lead-time formatter, every wire and input zod schema | `zod` only |
| `packages/db` | three client factories — `browser.ts` (anon), `server.ts` (request-scoped), `service.ts` (service role, `import 'server-only'`, firewalled) — plus `types.generated.ts` | `@supabase/supabase-js`, `contracts` |
| `packages/env` | the only module in the repository permitted to read `process.env`; zod schemas with no defaults and no fallbacks | `zod` |
| `packages/config` | shared tsconfig, eslint and vitest bases | — |

Packages are **source-only**: no build step, no `dist/`, no `.d.ts` emit. `apps/web`
compiles them via `transpilePackages`; `apps/pipeline` compiles them in one esbuild
call. That is deliberate — it removes the build graph, and with it the case for
Turborepo. Build order is `nothing → nothing → (next build | esbuild)`. Adopt Turbo
when CI wall time exceeds five minutes or a third deployable appears; record the
reversal in `docs/adr/0001-no-turborepo.md` so it is a decision and not a drift.

---

## 2. THE REPOSITORY

### The tree

```
insidor/
├─ package.json                     # npm workspaces: apps/*, packages/*. Root holds no source.
├─ tsconfig.base.json
├─ eslint.config.mjs                # flat config; feature zones GENERATED from the graph
├─ .dependency-cruiser.cjs          # authoritative boundary gate; same graph
├─ .nvmrc
├─ CONTRIBUTING.md                  # the shared/ graduation rule, verbatim
├─ .github/
│  ├─ actions/setup/action.yml
│  ├─ workflows/{ci,db,release,preview,nightly}.yml
│  ├─ CODEOWNERS                    # supabase/migrations/** requires a founder review
│  └─ pull_request_template.md
├─ docs/
│  ├─ DESIGN.md  ARCHITECTURE.md  environments.md  schema.md
│  ├─ architecture.svg              # GENERATED + COMMITTED. CI fails if stale.
│  ├─ runbooks/rollback.md
│  └─ adr/{0001-no-turborepo,0002-feature-dag,0003-stamp-is-structural}.md
├─ scripts/
│  ├─ migrate.mjs                   # the ONLY path to a database
│  ├─ feature-graph.json            # THE module boundary, as data
│  ├─ feature-graph.mjs             # ESM view + cycle assertion
│  ├─ check-model-tests.mjs         # every model/*.ts needs a sibling test
│  ├─ check-app-thin.mjs            # app/** exports only Next's contract names
│  ├─ check-migrations.mjs          # immutability, ordering, phase, lock safety
│  ├─ check-env-parity.mjs
│  ├─ check-vercel-env-scopes.mjs   # no secret scoped to two environments
│  ├─ release-plan.mjs              # reads @phase -> emits db_first
│  ├─ render-architecture.mjs
│  └─ smoke.mjs
├─ supabase/
│  ├─ config.toml                   # [db.seed] sql_paths -> seed/*.sql
│  ├─ migrations/0000..0015_*.sql   # timestamps are ordinals; immutable once merged
│  ├─ seed/
│  │  ├─ 00_fixtures.sql            # captured from staging, redacted, frozen
│  │  └─ scenarios/01..09_*.sql     # hand-written, never captured, never deleted
│  ├─ queries/hot-queries.sql       # the four hot queries + the index each drives
│  ├─ tests/{invariants,plans}.sql
│  └─ schema.sql                    # pg_dump snapshot; CI diffs against it
│
├─ apps/
│  ├─ pipeline/                     # Node. Never built by Vercel. Never imported by web.
│  │  ├─ Dockerfile  docker-entrypoint.sh  build.mjs
│  │  ├─ fly.staging.toml  fly.production.toml
│  │  └─ src/
│  │     ├─ main.ts                 # Inngest serve + /health/live + /health/ready
│  │     ├─ preflight.ts            # env, ops_environment, schema version, vendor ping
│  │     ├─ inngest/{client.ts,functions.ts}
│  │     ├─ stages/
│  │     │  ├─ ingest-x/  ingest-tiktok/  snapshot/
│  │     │  ├─ score/               # meme_score + coinability — the ONLY LLM tier
│  │     │  ├─ cluster/  promote/   # promote writes promoted_at exactly once
│  │     │  ├─ resolve-coins/       # the matcher. 0.97 precision, abstain band.
│  │     │  ├─ clocks-mint/  clocks-ct/
│  │     │  ├─ rank-commit/         # board_state + board_tick, every 20s
│  │     │  └─ outcomes/  watchdog/
│  │     │     └─ (each: index.ts · model/ · io/ · __tests__/)
│  │     ├─ adapters/               # ONE file per vendor; the only place a base URL exists
│  │     │  ├─ twitterapi.ts  apify.ts  pumpportal.ts  dexscreener.ts
│  │     │  ├─ rugcheck.ts  helius.ts  jupiter.ts  pumpfun.ts  anthropic.ts  gemini.ts
│  │     │  └─ __tests__/           # recorded-fixture contract test per adapter
│  │     └─ lib/{budget.ts,retry.ts,gaps.ts,logger.ts,sli.ts,stage.ts}
│  │
│  └─ web/                          # THE ONLY THING VERCEL BUILDS
│     ├─ next.config.ts  vercel.json  vitest.config.ts  instrumentation.ts
│     └─ src/
│        ├─ app/                    # ROUTING MANIFEST. 40 lines max per file. No logic.
│        │  ├─ layout.tsx  globals.css
│        │  ├─ (app)/layout.tsx  (app)/page.tsx
│        │  ├─ (app)/feed/page.tsx      (app)/trending/page.tsx
│        │  ├─ (app)/search/page.tsx    (app)/you/page.tsx
│        │  ├─ (app)/story/[id]/page.tsx  (app)/story/[id]/opengraph-image.tsx
│        │  ├─ (app)/coin/[mint]/page.tsx (app)/create/page.tsx
│        │  ├─ c/[mint]/page.tsx         # public share card, revalidate 300
│        │  ├─ (ops)/ops/page.tsx        (ops)/ops/earliness/page.tsx
│        │  └─ api/
│        │     ├─ order/route.ts  execute/route.ts  txstatus/route.ts
│        │     ├─ launch/prepare/route.ts  launch/confirm/route.ts
│        │     ├─ comments/route.ts  watchlist/route.ts  push/subscribe/route.ts
│        │     ├─ board/[lane]/route.ts   # hydration + disconnect fallback
│        │     ├─ health/route.ts
│        │     └─ telemetry/{search,resync}/route.ts
│        │
│        ├─ features/               # eleven. See the DAG below.
│        │  ├─ feed/                ===== EXPANDED =====
│        │  │  ├─ README.md         # ≤15 lines: what breaks here, which tables, which vendors
│        │  │  ├─ index.ts          # PUBLIC, client-safe
│        │  │  ├─ server.ts         # PUBLIC, first line: import 'server-only'
│        │  │  ├─ types.ts          # PostRowVM, CoinRowVM, LaneState, RailEvent
│        │  │  ├─ model/            # PURE. no react, no I/O, no Date.now(), no Math.random()
│        │  │  │  ├─ eligibility.ts       # age ≤240m, reshare LCB floor, meme ≥.35, O ≥.30, author cap
│        │  │  │  ├─ presented-heat.ts    # round(100·min(1, heat/p95_1h)) + rebase-frame suppression
│        │  │  │  ├─ ordering.ts          # EPS 0.08, 2 ticks in / 3 out, 90s dwell, MAX_MOVE 5
│        │  │  │  ├─ chip-precedence.ts   # RISK > NOT MINTABLE > ALREADY HOT > …, overflow +N
│        │  │  │  ├─ columns.ts           # per-column min width + container-query drop order
│        │  │  │  ├─ lane.ts              # /feed?lane=coins&band=fresh parse + serialise
│        │  │  │  ├─ gate-breakdown.ts    # "40 of 63 eligible · 12 hidden by gate"
│        │  │  │  └─ rail-events.ts
│        │  │  ├─ server/           # never imported by ui/ or hooks/
│        │  │  │  ├─ FeedScreen.tsx       # async RSC. The page's ONLY import.
│        │  │  │  ├─ posts-board.query.ts
│        │  │  │  ├─ coins-board.query.ts # LEFT JOIN LATERAL, one match per mint
│        │  │  │  ├─ story-band.query.ts
│        │  │  │  └─ gate-counts.query.ts
│        │  │  ├─ hooks/
│        │  │  │  ├─ use-board-rows.ts    # Map<id,Row>: values live, positions on tick
│        │  │  │  ├─ use-board-channel.ts # subscribes via shared/realtime (ref-counted)
│        │  │  │  ├─ use-freeze-on-hover.ts
│        │  │  │  └─ use-lane-state.ts
│        │  │  ├─ ui/
│        │  │  │  ├─ ControlStrip.tsx  LaneSwitch.tsx  BandStrip.tsx
│        │  │  │  ├─ ThresholdPopover.tsx  ShowRiskyToggle.tsx  CollapseByStory.tsx
│        │  │  │  ├─ Rail.tsx  RailEvent.tsx  NewRowsPill.tsx  GateBreakdown.tsx
│        │  │  │  ├─ posts/{PostsBoard,PostRow,PostCell,LifecycleRail,HeatCell,
│        │  │  │  │         AccelCell,Sparkline20m,OrgCell,AgeLeadCell,ActionCell,Thumbnail}.tsx
│        │  │  │  ├─ coins/{CoinsBoard,CoinRow,StoryCell,CurveCell,RiskChip,
│        │  │  │  │         ChangePill,PreRankZone}.tsx
│        │  │  │  ├─ story-band/{StoryGroupedBoard,StoryGroupRow,UnverifiedDrawer}.tsx
│        │  │  │  └─ states/{BoardSkeleton,EmptyQuiet,EmptyBroken,BoardError}.tsx
│        │  │  └─ __tests__/        # one per model file. MANDATORY, CI-checked.
│        │  │
│        │  ├─ trading/             ===== EXPANDED =====
│        │  │  ├─ README.md  index.ts  server.ts  types.ts
│        │  │  ├─ model/
│        │  │  │  ├─ quote.ts             # order response -> the five recap rows
│        │  │  │  ├─ fee.ts               # split arithmetic; bps read from config
│        │  │  │  ├─ slippage.ts          # Auto under 30min; hold on >1.0% adverse drift
│        │  │  │  ├─ risk.ts              # the four buy-side blocks; consumes coins' SafetyFacts
│        │  │  │  ├─ max-amount.ts        # balance − 0.02 SOL
│        │  │  │  ├─ take-back.ts         # binary search vs reverse quote, net of fee
│        │  │  │  ├─ cost-basis.ts        # sol_usd_at_trade; chain divergence >0.5% -> "—"
│        │  │  │  ├─ position.ts  decimals.ts
│        │  │  │  └─ tx-state.ts          # ORDERING→SIGNED→SUBMITTED→LANDED|… taxonomy
│        │  │  ├─ server/
│        │  │  │  ├─ CoinScreen.tsx       # owns /coin/[mint]; composes coins/ui + trading/ui
│        │  │  │  ├─ order.handler.ts     # referralAccount injected from env HERE, never client
│        │  │  │  ├─ execute.handler.ts   # re-asserts fee against request_id; captures SOL/USD
│        │  │  │  ├─ txstatus.handler.ts
│        │  │  │  ├─ trades.repo.ts       # writes at ORDERING; request_id UNIQUE is the guard
│        │  │  │  ├─ holdings.repo.ts
│        │  │  │  └─ sol-price.ts
│        │  │  ├─ hooks/{use-quote,use-trade-machine,use-tx-status,use-position}.ts
│        │  │  ├─ ui/
│        │  │  │  ├─ TradeBox.tsx  AmountField.tsx  PresetRow.tsx  ReceivePanel.tsx
│        │  │  │  ├─ RecapRows.tsx  ConfirmDialog.tsx  BlockStrip.tsx  SafetyBox.tsx
│        │  │  │  ├─ PositionCard.tsx  SellSheet.tsx  TakeBackRow.tsx
│        │  │  │  ├─ FundingSheet.tsx  PriceMovedGate.tsx
│        │  │  │  └─ states/{Filled,Declined,LostContact,StillConfirming,Reverted}.tsx
│        │  │  └─ __tests__/        # ten files, one per model file
│        │  │
│        │  ├─ coins/               # mint identity, market data, safety FACTS, matches
│        │  │  ├─ index.ts server.ts types.ts README.md
│        │  │  ├─ model/{action,stamp,safety,pending,heat,age,supply}.ts
│        │  │  ├─ server/{coin,market,safety,matches}.query.ts
│        │  │  ├─ ui/{IdentityHeader,OriginBand,EvidencePopover,SiblingStrip,
│        │  │  │      StatGrid,ChartCard,MarketNumeric,PrimaryAction}.tsx
│        │  │  └─ __tests__/        # action.test.ts is the single most important test here
│        │  ├─ stories/             # promoted_at, clocks, momentum, outcome, /story/[id]
│        │  ├─ discussion/          # comments, snap columns, address gate, moderation ladder
│        │  ├─ wallet/              # Privy provider, connect sheet, session, balance, signing
│        │  ├─ watchlist/           # the star, /you sections, mint notification, push
│        │  ├─ launch/              # create sheet, namer, anti-dupe, create_v2, share card
│        │  ├─ search/              # the box, four modes, anti-duplicate verdict, family table
│        │  ├─ trending/            # 24h survey, its own weights
│        │  └─ ops/                 # /ops, SLIs, earliness ledger. Graph root; imports nothing.
│        │
│        └─ shared/
│           ├─ ui/                  # design system. NO domain vocabulary in props.
│           ├─ db/                  # re-export of packages/db factories
│           ├─ realtime/            # ONE ref-counted socket + the 50-minute setAuth loop
│           ├─ rpc/                 # Helius client factory. No domain.
│           ├─ format/              # numbers, time, addresses
│           │  └─ pending.tsx       # ALLOWLISTED domain: the — / —+title / ·· contract
│           ├─ stamp/               # ALLOWLISTED domain: the confidence stamp
│           ├─ lead/                # ALLOWLISTED domain: the lead-time claim
│           ├─ staleness/           # ALLOWLISTED domain: tier() + the band
│           ├─ fee/                 # ALLOWLISTED domain: the fee line
│           ├─ routes.ts            # every href in the product. Pure strings.
│           └─ hooks/               # useInterval, useMediaQuery, useLocalStorage
│
└─ packages/
   ├─ contracts/src/
   │  ├─ index.ts  ids.ts  enums.ts  naming.ts
   │  ├─ generated/database.types.ts    # GENERATED. NEVER HAND-EDITED.
   │  ├─ rows.ts                        # the ONLY file that imports generated/
   │  ├─ pending.ts  match.ts  action.ts  lead.ts  safety.ts
   │  ├─ wire/{envelope,board,coin,comment}.ts
   │  ├─ input/{follow,comment,order,execute,launch,prefs,report,telemetry}.ts
   │  ├─ __tests__/{action,pending,lead}.test.ts
   │  └─ __typetests__/{brand,pending,drift}.test-d.ts
   ├─ db/src/{index,browser,server,service,types.generated}.ts
   ├─ env/src/index.ts
   └─ config/{tsconfig.base.json,eslint.base.mjs,vitest.base.ts}
```

### The feature-folder contract

Eleven features. Each exposes **exactly two** entry points and nothing else:

- `index.ts` — client-safe. View-models, pure model functions, client components,
  hooks. Nothing exported here may transitively reach a database client, a
  `features/*/server` module, or a Node builtin.
- `server.ts` — first line `import 'server-only'`. RSC screens, queries, route
  handlers, repositories.

Inside a feature there are exactly four segments, and the rules differ per segment:

| Segment | Contains | Nesting | Rule |
|---|---|---|---|
| `model/` | pure functions | **flat** — files only | No React, no I/O, no `async`, no `new Date()`, no `Date.now()`, no `Math.random()`. Takes `now: number` as a parameter. Every file has a sibling test; CI enforces it. |
| `server/` | RSC screens, queries, handlers | **flat** | The only place a service-role client may be constructed. |
| `hooks/` | client hooks | **flat** | May not name any server module. |
| `ui/` | components | **one level**, for lane grouping | May not name any server module. Takes view-models, never an id to fetch by. |

Flat segments are what makes "which file is this bug in" answerable by reading the
tree. `ui/` gets one level of nesting because the two lanes genuinely are two
component families.

`app/` is a routing manifest. Files there are capped at 40 lines and may import
**only** `@features/<name>`, `@server/<name>`, `@shared/ui` and `@shared/routes`.
The cap alone would just produce a 39-line page with a query inlined; the import
restriction is what removes the cause — a page with no database client, no formatter
and no model import has nothing in scope to write business logic with.

### The dependency graph

One data file, read by both lint configs. Adding an edge is a one-line diff a
reviewer can argue with.

```json
{
  "$comment": "THE module boundary. Read by eslint.config.mjs and .dependency-cruiser.cjs. Edit in its own PR.",

  "features": {
    "wallet":     { "deps": [], "owns": "Privy provider, session, address, balance, signing, token refresh" },
    "coins":      { "deps": [], "owns": "mint identity, market data, safety facts, coin_match, primaryAction, stamp derivation" },
    "ops":        { "deps": [], "owns": "/ops, SLI evaluation, earliness ledger, public record" },

    "discussion": { "deps": ["wallet", "coins"], "owns": "comments, snap columns, address gate, moderation ladder, position badge" },
    "stories":    { "deps": ["coins", "discussion"], "owns": "story rows, promoted_at, clocks, momentum, outcome, /story/[id]" },

    "trading":    { "deps": ["wallet", "coins", "stories"], "owns": "quote/order/execute, trade box, positions, /coin/[mint]" },
    "launch":     { "deps": ["wallet", "coins", "stories"], "owns": "create sheet, namer, anti-dupe, create_v2, share card" },
    "watchlist":  { "deps": ["wallet", "coins", "stories"], "owns": "the star, /you, mint notification, push" },

    "feed":       { "deps": ["coins", "stories", "watchlist"], "owns": "both lanes, control strip, rail, board stability" },
    "trending":   { "deps": ["coins", "stories", "watchlist"], "owns": "/trending, the 24h weights" },
    "search":     { "deps": ["coins", "stories", "watchlist"], "owns": "the box, four modes, anti-duplicate verdict, family table" }
  },

  "$comment_feed": "feed does NOT depend on trading. The feed's Buy is navigation to the coin page, where the quote is fresh and the fee is disclosed. The board therefore cannot open a trade, structurally.",
  "$comment_stories": "stories -> discussion, never the reverse. The caller supplies the snap-column values, so 'written once at insert' is a function signature rather than a convention.",

  "sharedDomainAllowlist": [
    "shared/stamp",
    "shared/lead",
    "shared/staleness",
    "shared/fee",
    "shared/format/pending.tsx"
  ],
  "$comment_allowlist": "The ONLY shared modules permitted domain vocabulary. A sixth entry requires editing this array, which is visible in the diff.",

  "appMayImport": ["@features/*", "@server/*", "@shared/ui", "@shared/routes"],

  "serviceKeyReachableFrom": [
    "apps/web/src/features/[^/]+/server/",
    "apps/pipeline/src/"
  ]
}
```

Three structural facts fall out of that graph and are worth stating plainly.
`coins` is a root because mint identity, safety facts and `primaryAction()` are
depended on by everything and depend on nothing. `feed → trading` is absent, so the
board physically cannot execute a swap. And `stories → discussion` runs that
direction because the comment stamp is written by the caller, which makes
"written once at insert" a type signature rather than a habit.

### Enforcement, in the order a developer hits it

**Layer 1 — TypeScript path mapping. Fires in the editor, before any lint runs.**

There is no `@/*` wildcard. That single alias is what made every reach-in import in
the old build compile cleanly.

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": false,
    "checkJs": false,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

```jsonc
// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],

    // THE BOUNDARY.
    //   @features/feed        -> src/features/feed/index.ts    (client-safe entry)
    //   @server/feed          -> src/features/feed/server.ts   (server-only entry)
    //   @features/feed/ui/Row -> DOES NOT RESOLVE. ts(2307), in the editor.
    //
    // The two entry points use DIFFERENT ALIAS PREFIXES, and that is not
    // cosmetic. TypeScript ranks path patterns by the length of the text
    // BEFORE the wildcard and nothing else (findBestPatternMatch), so a
    // second pattern "@features/*/server" would tie with "@features/*" on a
    // 10-character prefix, lose the strict-greater comparison, and be
    // silently ignored — binding @features/x/server to
    // src/features/x/server/index.ts, the INTERNAL segment barrel, which has
    // no `import 'server-only'`. That resolves, typechecks clean, and quietly
    // routes around the service-key firewall. A distinct prefix cannot tie.
    "paths": {
      "@features/*":        ["./src/features/*/index.ts"],
      "@server/*":          ["./src/features/*/server.ts"],
      "@shared/*":          ["./src/shared/*"],
      "@insidor/contracts": ["../../packages/contracts/src/index.ts"],
      "@insidor/db":        ["../../packages/db/src/index.ts"],
      "@insidor/env":       ["../../packages/env/src/index.ts"]
    }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

Do **not** try `"@features/*": ["src/features/*.ts", "src/features/*/index.ts"]` as a
way to make both entry points resolve under one prefix. It works, and it opens a
strictly wider hole than the one it closes: every deep `.ts` file becomes importable,
re-exposing `model/` and `server/` wholesale.

TypeScript project references are deliberately absent. They govern build ordering,
not import boundaries — a file importing a package missing from `references` still
resolves via source paths — and at this size a full typecheck is seconds.

**Layer 2 — ESLint. Fires on save.** Zones are generated from the graph; there is no
hand-maintained list to drift.

```js
// scripts/feature-graph.mjs — ESM view over the JSON, with a cycle assertion that
// runs every time lint starts. .dependency-cruiser.cjs requires the JSON directly.
// One source of truth, two module systems.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const graph = JSON.parse(readFileSync(join(here, 'feature-graph.json'), 'utf8'));

export const FEATURES = Object.keys(graph.features);
export const DEPS = Object.fromEntries(FEATURES.map((f) => [f, graph.features[f].deps]));
export const SHARED_DOMAIN_ALLOWLIST = graph.sharedDomainAllowlist;

for (const [f, deps] of Object.entries(DEPS)) {
  for (const d of deps) {
    if (!FEATURES.includes(d)) {
      throw new Error(`feature-graph.json: '${f}' depends on unknown feature '${d}'`);
    }
  }
}

// A cycle is a build-stopping error, not a lint warning: it means two features can
// no longer be reasoned about apart.
const WHITE = 0, GREY = 1, BLACK = 2;
const colour = Object.fromEntries(FEATURES.map((f) => [f, WHITE]));
function visit(node, stack) {
  if (colour[node] === GREY) {
    throw new Error(
      `feature-graph.json: cycle ${[...stack, node].join(' -> ')}. ` +
      `Break it by moving the shared part into a feature lower in the graph, or into packages/contracts.`,
    );
  }
  if (colour[node] === BLACK) return;
  colour[node] = GREY;
  for (const d of DEPS[node]) visit(d, [...stack, node]);
  colour[node] = BLACK;
}
FEATURES.forEach((f) => visit(f, []));

export function forbiddenSiblings(name) {
  const allowed = new Set([name, ...DEPS[name]]);
  return FEATURES.filter((f) => !allowed.has(f));
}

export function allowedSentence(name) {
  const d = DEPS[name];
  return d.length
    ? `features/${name} may import [${d.join(', ')}] and nothing else`
    : `features/${name} is a graph root and may import no other feature`;
}
```

```js
// eslint.config.mjs
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { FlatCompat } from '@eslint/eslintrc';
import {
  FEATURES, forbiddenSiblings, allowedSentence, SHARED_DOMAIN_ALLOWLIST,
} from './scripts/feature-graph.mjs';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
const F = 'apps/web/src/features';
const BRANDS = 'BuyableCoin|ConfirmedCoin|MintAddress|Ticker|Instant|Minutes|Usd|Lamports|StoryId';

const featureZones = FEATURES.map((name) => {
  const denied = forbiddenSiblings(name).flatMap((f) => [`@features/${f}`, `@server/${f}`]);
  return {
    files: [`${F}/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          ...(denied.length ? [{
            group: denied,
            message:
              `${allowedSentence(name)}. Either add the edge to scripts/feature-graph.json ` +
              `in this PR and defend it, or move the shared part down the graph.`,
          }] : []),
          {
            group: ['@features/*/*', '@server/*/*'],
            message:
              'Reach a feature through index.ts or server.ts. Internals are not public API — ' +
              'if you need it, export it from the entry point deliberately.',
          },
          {
            group: ['../../../*', '../../../../*'],
            message:
              'This escapes the feature folder. Import the other feature through @features/<name>. ' +
              'dependency-cruiser is authoritative here and catches shallower escapes too.',
          },
          {
            group: ['@insidor/pipeline', '@insidor/pipeline/*'],
            message: 'apps/web never imports apps/pipeline. Share through packages/contracts.',
          },
        ],
      }],
    },
  };
});

export default tseslint.config(
  { ignores: ['**/.next/**', '**/dist/**', '**/node_modules/**', '**/*.generated.ts'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...compat.extends('next/core-web-vitals'),

  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // The three that actually catch a laundered brand. Type-aware, so they
      // require projectService above.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/strict-boolean-expressions': ['error', {
        allowNullableObject: false, allowNullableString: false, allowNullableNumber: false,
      }],
      eqeqeq: ['error', 'always'],

      'no-restricted-syntax': ['error',
        // Absent is not zero. This is the token-lookup `return 0` bug as a lint rule.
        { selector: 'LogicalExpression[operator="??"][right.value=0]',
          message: 'Absent is not zero. Return Pending<T>; see @insidor/contracts/pending.' },
        { selector: 'LogicalExpression[operator="||"][right.value=0]',
          message: 'Absent is not zero. Return Pending<T>.' },
        { selector: 'CallExpression[callee.name="Number"][arguments.0.type="Identifier"]',
          message: 'Number(x) coerces null to 0. Parse into Pending<T>.' },
        // Brands are constructed only inside packages/contracts. BOTH assertion
        // forms — `x as Brand` and `<Brand>x` are different AST nodes.
        { selector: `TSAsExpression[typeAnnotation.typeName.name=/^(${BRANDS})$/]`,
          message: 'Branded types are constructed only in packages/contracts. ' +
                   'Casting here is how a Buy button reaches an unconfirmed coin.' },
        { selector: `TSTypeAssertion[typeAnnotation.typeName.name=/^(${BRANDS})$/]`,
          message: 'Same rule, angle-bracket form.' },
      ],
    },
  },

  ...featureZones,

  // model/ is PURE. This is what makes it testable with five-line tests and no mocks.
  {
    files: [`${F}/*/model/**/*.ts`, 'apps/pipeline/src/stages/*/model/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            'react', 'react-dom', 'react/*', 'next', 'next/*',
            '@supabase/*', '@privy-io/*', '@solana/*', '@insidor/db',
            '@shared/db', '@shared/db/*', '@shared/realtime', '@shared/rpc',
            '**/server/**', '../server/*', './server/*', '@server/*',
          ],
          message:
            'model/ is pure: no React, no I/O, no async, no clients. ' +
            'If you need data, take it as an argument — that is the whole point of the segment.',
        }],
      }],
      'no-restricted-globals': ['error',
        { name: 'fetch', message: 'model/ does no I/O. Pass the data in.' },
        { name: 'window', message: 'model/ is environment-free.' },
        { name: 'document', message: 'model/ is environment-free.' },
        { name: 'localStorage', message: 'model/ is environment-free.' },
      ],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'model/ must be deterministic. Inject the value.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date']",
          message: 'Take `now: number` as a parameter. A model that reads the clock cannot be tested, ' +
                   'and age-of-coin is the one axis this product sells.' },
        { selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Take `now: number` as a parameter. Same reason.' },
      ],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    },
  },

  // THE SERVICE-KEY FIREWALL. Client code cannot name server code.
  {
    files: [`${F}/*/ui/**/*.{ts,tsx}`, `${F}/*/hooks/**/*.ts`],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '**/server/**', '../server', '../server/*', './server/*',
            '@server/*', '@shared/db', '@shared/db/*',
            '@insidor/db', '@insidor/env', 'server-only', 'next/headers',
          ],
          message:
            'ui/ and hooks/ ship to the browser. They may not name server modules. ' +
            'Pass the data down as props from the RSC in server/, or call a route handler.',
        }],
      }],
    },
  },

  // app/ is a routing manifest.
  {
    files: ['apps/web/src/app/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'no-restricted-imports': ['error', {
        patterns: [{
          group: [
            '@shared/*', '!@shared/ui', '!@shared/routes',
            '@insidor/db', '@insidor/env', '@supabase/*', '@features/*/*', '@server/*/*',
          ],
          message:
            'app/ delegates and does nothing else. It may import @features/<name>, @server/<name>, ' +
            '@shared/ui and @shared/routes. If a page needs a query, the query belongs to a feature ' +
            'and the page renders that feature’s Screen component.',
        }],
      }],
    },
  },

  // shared/ is one-way, and only five modules may speak domain.
  {
    files: ['apps/web/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@features/*', '@server/*'],
          message:
            'shared/ never imports a feature. If shared needs it, it is not shared — ' +
            'it belongs in the feature that owns the concept.',
        }],
      }],
    },
  },
  {
    files: ['apps/web/src/shared/**/*.{ts,tsx}'],
    ignores: SHARED_DOMAIN_ALLOWLIST.map((p) => `apps/web/src/${p}${p.includes('.') ? '' : '/**'}`),
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'Identifier[name=/(?:coin|mint|ticker|story|narrative|cashtag|rugcheck|jupiter)/i]',
        message:
          'shared/ carries no domain vocabulary. <Table columns rows/> is shared; <CoinRow coin/> is a feature. ' +
          'The five exceptions are listed in scripts/feature-graph.json#sharedDomainAllowlist.',
      }],
    },
  },

  // ONE VOCABULARY. The tables say story; nothing says narrative.
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/pipeline/src/**/*.ts'],
    ignores: ['packages/contracts/src/naming.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'Identifier[name=/narrative/i]',
        message:
          'The product word and the table name are both “story”. `narrative` is vocabulary from a ' +
          'codebase being deleted. Two words for one concept is how a codebase grows two ' +
          'implementations of the same rule — which is literally what happened to ct_pickup ' +
          '(a boolean and a regex, two definitions of one event).',
      }],
    },
  },

  // THE TWO CORRECTNESS PROPERTIES, AS LINT RULES.
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['apps/web/src/shared/stamp/**'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "JSXExpressionContainer > MemberExpression[property.name=/^(mint|mint_ca|ca|contract_address)$/]",
        message:
          'A mint may not be rendered as bare text. Use <MintRef value={stampedMint} /> from @shared/stamp. ' +
          'The stamp is a property of the (story, mint) pair and travels with it everywhere.',
      }],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    ignores: [`${F}/coins/ui/PrimaryAction.tsx`, `${F}/coins/model/action.ts`, `${F}/coins/__tests__/**`],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'Literal[value=/^(Buy \\$|See the \\d+ coins|Create coin)/]',
        message:
          'Primary-action labels are produced by primaryAction(), never written at a call site. ' +
          'Render <PrimaryAction action={…} /> from @features/coins.',
      }],
    },
  },

  // apps/pipeline is a Node service and never imports React.
  {
    files: ['apps/pipeline/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['react', 'react-dom', 'next', 'next/*', '@insidor/web', '@insidor/web/*'],
          message: 'apps/pipeline is a Node service and never imports the web app or React.',
        }],
      }],
    },
  },

  // packages/contracts is a leaf: zero runtime deps except zod.
  {
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@insidor/*', '@shared/*', '@features/*', '@server/*', 'react', 'next', 'next/*', '@supabase/*'],
          message: 'packages/contracts is a leaf with zero runtime deps. Only zod is permitted.',
        }],
      }],
    },
  },
);
```

**Layer 3 — dependency-cruiser. The authoritative gate, in CI.** It catches what
`no-restricted-imports` patterns cannot see: dynamic `import()`, relative-path
escapes, and transitive reachability.

```js
// .dependency-cruiser.cjs
const graph = require('./scripts/feature-graph.json');

const FEATURES = Object.keys(graph.features);
const W = '^apps/web/src';

// One generated rule per feature. The CI output names the edge you added.
const dagRules = FEATURES.map((f) => {
  const allowed = [f, ...graph.features[f].deps].join('|');
  return {
    name: `dag-${f}`,
    severity: 'error',
    comment:
      `features/${f} may import [${graph.features[f].deps.join(', ') || 'nothing'}]. ` +
      `Source: scripts/feature-graph.json.`,
    from: { path: `${W}/features/${f}/` },
    to: { path: `${W}/features/([^/]+)/`, pathNot: `${W}/features/(${allowed})/` },
  };
});

// no-deep-feature-import is generated per feature too, rather than relying on a
// $1 back-reference in to.pathNot — the back-reference form is version-sensitive
// and this costs eleven objects and zero coverage.
const deepImportRules = FEATURES.map((f) => ({
  name: `no-deep-import-${f}`,
  severity: 'error',
  comment: 'A feature is reached through index.ts (client-safe) or server.ts (server-only). Nothing else is public.',
  from: { path: `${W}/(features|app|shared)/`, pathNot: `${W}/features/${f}/` },
  to: {
    path: `${W}/features/${f}/.+`,
    pathNot: `${W}/features/${f}/(index|server)\\.ts$`,
  },
}));

module.exports = {
  forbidden: [
    ...dagRules,
    ...deepImportRules,

    {
      name: 'client-never-touches-server',
      severity: 'error',
      comment: 'ui/ and hooks/ ship to the browser.',
      from: { path: `${W}/features/[^/]+/(ui|hooks)/` },
      to: { path: [`${W}/features/[^/]+/server`, `${W}/shared/db`, '^packages/db/src/(server|service)'] },
    },

    // ===================================================================
    // THE SERVICE-KEY FIREWALL. `reachable: true` is the whole point:
    // the leak that matters is TRANSITIVE. A client component importing a
    // feature barrel that re-exports a repo that constructs the service
    // client is invisible to a direct-edge rule.
    // ===================================================================
    {
      name: 'service-key-firewall',
      severity: 'error',
      comment: 'The service role is reachable from exactly two places: a feature server/ folder, and the pipeline.',
      from: { pathNot: graph.serviceKeyReachableFrom.join('|') },
      to: { path: '^packages/db/src/service\\.ts$', reachable: true },
    },
    {
      name: 'client-entry-never-reaches-service-key',
      severity: 'error',
      comment: 'Transitive reachability from anything that ships to a browser.',
      from: { path: [`${W}/app/.+\\.tsx$`, `${W}/features/[^/]+/(ui|hooks)/`] },
      to: { path: '^packages/db/src/service\\.ts$', reachable: true },
    },

    {
      name: 'model-is-pure',
      severity: 'error',
      from: { path: '(apps/web/src/features|apps/pipeline/src/stages)/[^/]+/model/' },
      to: {
        path: [
          '^node_modules/(react|react-dom|next|@supabase|@privy-io|@solana)',
          '/server/', '/shared/db', '/shared/realtime', '/shared/rpc',
        ],
      },
    },
    {
      name: 'app-has-no-logic',
      severity: 'error',
      comment: 'With no db client and no formatters in scope, a page cannot hold business logic.',
      from: { path: `${W}/app/` },
      to: {
        path: `${W}/`,
        pathNot: [
          `${W}/features/[^/]+/(index|server)\\.ts$`,
          `${W}/shared/ui/`,
          `${W}/shared/routes\\.ts$`,
          `${W}/app/`,
        ],
      },
    },
    { name: 'shared-never-imports-features', severity: 'error',
      from: { path: `${W}/shared/` }, to: { path: `${W}/features/` } },
    { name: 'contracts-is-a-leaf', severity: 'error',
      from: { path: '^packages/contracts/' }, to: { path: '^(apps|packages/db)/' } },
    { name: 'web-never-imports-pipeline', severity: 'error',
      from: { path: '^apps/web/' }, to: { path: '^apps/pipeline/' } },
    { name: 'pipeline-never-imports-web', severity: 'error',
      from: { path: '^apps/pipeline/' }, to: { path: '^apps/web/' } },
    {
      name: 'segments-are-flat',
      severity: 'error',
      comment: 'model/ server/ hooks/ hold files, not folders. ui/ may nest exactly one level.',
      from: {},
      to: { path: `${W}/features/[^/]+/(model|server|hooks)/[^/]+/` },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'not-to-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        'Also load-bearing for segments-are-flat: an UNIMPORTED nested file is invisible to a ' +
        'from/to rule, so orphan detection is what makes the flat-segment rule total.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)(\\.[^/]+|tsconfig|.*\\.config)\\.(js|cjs|mjs|ts)$', '__tests__'] },
      to: {},
    },
  ],

  required: [
    {
      name: 'server-entry-is-server-only',
      severity: 'error',
      comment:
        'Every features/*/server.ts imports server-only. NOTE the unanchored to.path: ' +
        'in an npm workspace, server-only hoists to the repo root and resolves as ' +
        '../../node_modules/server-only/index.js, so ^node_modules/server-only flags every ' +
        'CORRECT file. This rule is a convention check, not the firewall — the firewall is the ' +
        'reachable:true rule above.',
      module: { path: `${W}/features/[^/]+/server\\.ts$` },
      to: { path: 'node_modules/server-only' },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(\\.next|dist|coverage)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'apps/web/tsconfig.json' },  // pipeline is cruised in a second pass
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: { dot: { collapsePattern: '^apps/web/src/(features|shared)/[^/]+' } },
  },
};
```

Two operational notes on that config, both learned the expensive way.

**Exit 0 is not evidence.** dependency-cruiser declares support for
`typescript >=2 <7`. With a TypeScript major it does not support, it prints an
advisory to stderr, reports *"no dependency violations found (0 modules, 0
dependencies cruised)"*, and **exits 0**. The gate goes green having inspected
nothing. So the CI step asserts a floor on the module count, not just the exit code:

```bash
npx depcruise apps/web/src packages --config .dependency-cruiser.cjs --output-type json \
  | tee /tmp/dc.json \
  | jq -e '.summary.totalCruised > 60' > /dev/null \
  || { echo '::error::dependency-cruiser cruised almost nothing — check the TypeScript version'; exit 1; }
```

**The `required` rule is a convention check, not the firewall.** It asserts a
property of files literally named `features/*/server.ts` and says nothing about
`features/x/repo.ts` or any other new file that touches the key. The firewall is
`service-key-firewall` with `reachable: true`, which is why both exist.

**Layer 4 — `server-only`, at build time.** A `'use client'` file that imports
`@server/feed` fails the Vercel build outright. Three characters that turn a lint
bypass into a failed deployment rather than a service-role key in a JS chunk.

**Layer 5 — a test, because the `server-only` import must actually be there.** No
custom ESLint plugin: the repository already ships vitest, and the position of the
import does not matter (ES modules hoist, so any top-level import throws).

```ts
// apps/web/src/__tests__/server-entries.test.ts
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { expect, test } from 'vitest';

test('INVARIANT every feature server entry imports server-only', () => {
  const entries = globSync('src/features/*/server.ts', { cwd: process.cwd() });
  expect(entries.length).toBeGreaterThan(8);
  for (const f of entries) {
    expect(readFileSync(f, 'utf8'), f).toMatch(/^\s*import ['"]server-only['"];?\s*$/m);
  }
});
```

### What a reach-past looks like, in firing order

```
1. IN THE EDITOR (TypeScript path mapping)
     import { PostRow } from '@features/feed/ui/posts/PostRow';
   -> ts(2307) Cannot find module '@features/feed/ui/posts/PostRow'.
   No alias resolves a feature internal and there is no '@/*' to fall back to.
   This is the layer that changes behaviour, because it fires while you type.

2. ON SAVE (ESLint), for the relative-path workaround
     import { PostRow } from '../../../feed/ui/posts/PostRow';
   -> error  'This escapes the feature folder. Import the other feature
              through @features/<name>.'  no-restricted-imports

3. IN CI (dependency-cruiser), for everything else including dynamic import()
     error no-deep-import-feed: features/search/ui/Row.tsx
                              -> features/feed/ui/posts/PostRow.tsx
     error dag-search: features/search may import [coins, stories, watchlist].
                       Source: scripts/feature-graph.json.
   and docs/architecture.svg changes, so the PR shows a new arrow between two boxes.

4. AT BUILD (server-only), for the one that costs real money
     import { getPostsBoard } from '@server/feed';   // inside a 'use client' file
   -> Error: You're importing a component that needs "server-only".
   A lint bypass becomes a failed build instead of a service key in a JS chunk.
```

### The shared/ graduation rule

Something moves from a feature into `shared/` only when **all three** hold:

1. **Three call sites in three different features.** Not three call sites in one.
2. **Zero domain vocabulary.** If a prop is named `coin`, `mint`, `story` or
   `ticker`, it is not shared.
3. **You would publish it to npm** without embarrassment and without explaining
   Insidor.

Until all three hold, duplicate the code. Two copies of a twenty-line component are
cheaper than one wrong abstraction in `shared/` that four features bend around.

Promotion is a PR titled `promote: <thing> -> shared/<module>` that **deletes both
originals in the same commit**. Demotion is the half people forget: anything in
`shared/` with one importer for thirty days moves back into that importer.
`npm run depcruise:graph` makes single-importer shared modules visible.

The five domain exceptions — `stamp`, `lead`, `staleness`, `fee`,
`format/pending.tsx` — are exempt *because* they are the contracts. Where a
component renders differently in two places, the product contradicts itself, and on
this product every contradiction is about money or about a claim. Putting them in a
feature would mean six features importing a seventh to render a stamp.

Wallet context lives in `features/wallet/`, **not** `shared/`. A `WalletContext` in
`shared/` means `shared/` imports Privy, which means `shared/` has business rules,
which means the next thing goes in there too.

---

## 3. THE DATABASE

One Postgres, one schema (`public`), 46 tables, plus an `insidor` schema holding the
migration framework and the trigger functions. Everything the browser can see is
governed by RLS and column-level grants; there is no second schema and no PostgREST
exposure trick, because the grants already do that job with one fewer moving part.

**Naming, decided once so nobody has to remember a list: tables are singular, enums
are singular, columns are `snake_case`, every foreign key to a story is `story_id`.**
The route is `/story/[id]`, every surface's copy says story, and the design document
calls the story the spine. `narrative` is vocabulary from a codebase being deleted;
carrying it forward means every developer translates between the URL and the schema
forever. A lint rule bans the identifier in both apps.

### 3.1 The five product rules the schema enforces

These are the rules that cost money when they are wrong. Each is enforced by a
constraint, a generated column, a type, or a foreign key — never by convention.

| # | Rule | Mechanism | File |
|---|---|---|---|
| **1** | A CONFIRMED match cannot exist without the evidence that justifies it | `CHECK coin_match_confirmed_requires_evidence` — score ≥ 0.80, `ticker_source <> 'llm'`, `mint_time NOT NULL`, `relation <> 'mentioned'`, and either near-proof or two strong channels | 0004 |
| **2** | A ticker without provenance cannot be inserted at all | `story_ticker.source ticker_source NOT NULL` **with no default**, plus `CHECK (source <> 'llm' OR resolved_mint IS NULL)`. The table carries **no market columns at all** | 0004 |
| **3** | A tier-`never` story is unreadable, and a launch against a non-`normal` story is a foreign-key violation | `story.display_eligible` GENERATED + the RLS policy reading it; `launch.story_coinability_tier` with a composite FK to `story(id, coinability_tier)` `ON UPDATE RESTRICT` and `CHECK (= 'normal')` | 0002, 0008, 0011 |
| **4** | `promoted_at` is set once and never moves | `insidor.freeze_columns('promoted_at')` BEFORE UPDATE trigger | 0002 |
| **5** | A lead time cannot exist without both clock readings that produced it | `story_clock.lead_time_min` is GENERATED; both sensor watermarks are `NOT NULL` and must be ≥ `promoted_at`; `promoted_at` is overwritten at INSERT by a trigger reading `story.promoted_at` | 0005 |

Four supporting rules are enforced the same way and belong in the same list, because
each of them corresponds to a defect that shipped:

- **Unknown authority fails closed.** `coin_safety` has *no boolean anywhere* for an
  authority. `authority_state NOT NULL DEFAULT 'unknown'` with only the literal
  `'revoked'` passing the generated `intrinsic_gate_pass`. The old `api/safety.js`
  wrote `x == null ? true` against an endpoint with no authority fields and reported
  every token safe. That write now has nowhere to land.
- **Unknown age is not zero.** `coin.minted_at` is nullable with
  `CHECK ((minted_at IS NULL) = (minted_at_source = 'unknown'))` — if we claim to know
  when it was minted, we must say how we know — and it is write-once.
- **A top-10 figure that includes the bonding-curve PDA is not stored.**
  `CHECK (top10_pct IS NULL OR curve_pda_excluded)`. That figure reads 80–95% on every
  healthy pre-graduation token.
- **A "peak" from one observation is a last-observed value with a flattering label.**
  `story_outcome` refuses `hit`/`dud` below six samples of `coin_mcap_series`.

### 3.2 A note on where Postgres enforces immutability, and where it does not

This matters because the schema leans on it and the enforcement is **asymmetric**.

- **Generated columns are checked at DDL time.** `cookDefault()` calls
  `contain_mutable_functions_after_planning()` and raises
  `generation expression is not immutable`. A STABLE function in a generated column is
  a migration that fails on first apply.
- **CHECK constraints are not checked at all.** Postgres *assumes* immutability and
  documents the consequence: *"PostgreSQL does not disallow that, but it will not
  notice if there are rows in the table that now violate the CHECK constraint. That
  would cause a subsequent database dump and restore to fail."* `CHECK (x <= now())`
  applies green and breaks a restore months later.

So every CHECK in this schema is written immutable-safe as a **convention**, and the
convention is backed by two mechanical checks rather than by discipline: a
**dump→restore round trip** in CI (see §8), and an assertion in
`supabase/tests/invariants.sql` scanning `pg_constraint` for functions whose
`pg_proc.provolatile <> 'i'`.

Three concrete traps that follow from this, all of which the DDL below already avoids:

1. **`extract(field FROM timestamptz)` is STABLE and is rejected in a generated
   column.** `extract(field FROM interval)` is immutable. The subtraction must stay
   *inside* the extract: `extract(epoch FROM (a - b))` works because
   `timestamptz − timestamptz` yields `interval`. The obvious-looking simplification
   `extract(epoch FROM t_crypto)` fails at migration time.
2. **`array_to_string` is STABLE**, permanently and deliberately — it invokes the
   element type's output function, which may be timezone-dependent. It cannot appear
   in a generated column. `0009` therefore declares a typed immutable wrapper first:

   ```sql
   -- text elements use textout, which IS immutable, so this wrapper is sound
   -- for text[] and only for text[]. `entity_keys::text` is NOT a shortcut —
   -- that CoerceViaIO resolves to array_out, also STABLE, and fails identically.
   CREATE OR REPLACE FUNCTION insidor.text_array_to_string(text[], text)
   RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
   $$ SELECT array_to_string($1, $2) $$;
   ```

   Once a generated column depends on it, the wrapper is frozen: redefining it later
   will not re-validate stored rows.
3. **`to_tsvector(text, text)` is STABLE; `to_tsvector(regconfig, text)` is
   immutable.** The `'english'::regconfig` cast in `0009` is load-bearing.

One arithmetic detail with a product consequence. `lead_time_min` is
`round(extract(epoch FROM (…)) / 60.0)::int`. Since PG14, `extract` returns `numeric`,
and `round(numeric)` breaks ties away from zero, while `round(double precision)` is
round-half-to-even. A −30-second lead rounds to `-1` under the numeric path and `0`
under the float path — and `lead_time_min < 0` is the LATE predicate on the public
record. Pin local development to the deployed Postgres major, or the same clock
readings publish two different verdicts.

### 3.3 The enums

Declaration order is load-bearing where an enum is ordered — but note that no
generated column in this schema uses an ordered enum comparison. Ordered gates encode
a product rule in declaration order, where `ALTER TYPE … ADD VALUE … BEFORE` changes
which future labels pass, silently and with no recompute. Gates use explicit equality
and fail closed.

```sql
-- 0001_extensions_and_types.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm   WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS vector    WITH SCHEMA public;   -- halfvec + HNSW
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;

-- pg_cron and pg_net need shared_preload_libraries. Optional here, asserted
-- present by the pipeline's boot check, so a missing one is loud in production
-- and quiet in CI rather than the reverse.
DO $$
BEGIN
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_cron; EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable: scheduled jobs must be installed separately'; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS pg_net;  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_net unavailable: the in-database health observer is not installed'; END;
END $$;

SELECT insidor.create_enum('platform',           ARRAY['x','tiktok']);
SELECT insidor.create_enum('story_status',       ARRAY['provisional','open','dormant','closed','merged']);
SELECT insidor.create_enum('lifecycle',          ARRAY['heating','peaking','cooling','dead']);
SELECT insidor.create_enum('coinability_tier',   ARRAY['never','no_create','normal']);
-- The provenance column whose absence produced the $KANG Buy button.
SELECT insidor.create_enum('ticker_source',      ARRAY['cashtag','mint_in_post','llm','insidor_launch']);
-- verdict is CONFIDENCE. relation is PROVENANCE. Conflating them is how an
-- adopted coin got sold as derived; an adopted coin can legitimately be unsure.
SELECT insidor.create_enum('match_verdict',      ARRAY['confirmed','unsure','rejected']);
SELECT insidor.create_enum('match_relation',     ARRAY['derived','adopted','mentioned']);
-- Three-valued, never boolean. There is no `mint_revoked boolean` in this
-- schema, so the api/safety.js defect is unwritable.
SELECT insidor.create_enum('authority_state',    ARRAY['unknown','revoked','active']);
SELECT insidor.create_enum('route_state',        ARRAY['unknown','ok','absent']);
SELECT insidor.create_enum('coin_band',          ARRAY['fresh','graduating','live']);
SELECT insidor.create_enum('board_lane',         ARRAY['posts','coins']);
SELECT insidor.create_enum('comment_status',     ARRAY['visible','held','blocked','removed']);
SELECT insidor.create_enum('position_state',     ARRAY['holds','sold','none','unknown']);
SELECT insidor.create_enum('story_outcome_kind', ARRAY['hit','dud','no_coin','late','unmeasurable']);
-- ONE table, ONE enum, so shipping gap detection for the mint stream and
-- forgetting it for the CT poller is impossible.
SELECT insidor.create_enum('sensor',             ARRAY['mint_stream','ct_poll','ingest_x','ingest_tiktok','snapshotter']);
SELECT insidor.create_enum('notification_kind',  ARRAY['mint','window_closing','accelerating','correction']);
SELECT insidor.create_enum('trade_side',         ARRAY['buy','sell']);
SELECT insidor.create_enum('trade_status',       ARRAY['ordering','signed','submitted','confirmed','failed','expired','cancelled']);
SELECT insidor.create_enum('media_kind',         ARRAY['image','video','gif']);
SELECT insidor.create_enum('wallet_kind',        ARRAY['embedded','external']);
```

Four trigger functions carry the write-once semantics the whole schema depends on:

```sql
-- Once a listed column is non-NULL it can never change. Convention beats
-- nothing; a trigger beats convention. Dynamic EXECUTE per column per row, so
-- it is used only on low-rate tables (story, coin, story_clock, comment,
-- holding, trade, launch, fee_share, app_user) and never on post or
-- coin_snapshot.
CREATE OR REPLACE FUNCTION insidor.freeze_columns() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE col text; oldv text; newv text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::text', col) INTO oldv USING OLD;
    EXECUTE format('SELECT ($1).%I::text', col) INTO newv USING NEW;
    IF oldv IS NOT NULL AND newv IS DISTINCT FROM oldv THEN
      RAISE EXCEPTION '%.% is write-once: it was set to % and cannot be changed to %',
        TG_TABLE_NAME, col, oldv, COALESCE(newv, 'NULL');
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- Rejects the known posted_at double-conversion bug at the door, rather than
-- letting one future-dated row render "+31m early" on a board dead for two days.
CREATE OR REPLACE FUNCTION insidor.reject_future_timestamp() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE col text; v timestamptz;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I', col) INTO v USING NEW;
    IF v IS NOT NULL AND v > now() + interval '5 minutes' THEN
      RAISE EXCEPTION '%.% is % which is in the future; refusing the row', TG_TABLE_NAME, col, v;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION insidor.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- base58 run detector for the comment address gate. Deliberately in the
-- database: the client check is a courtesy, the server route is the policy,
-- this is the enforcement that survives both being wrong.
CREATE OR REPLACE FUNCTION insidor.base58_runs(p_text text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(m[1]), ARRAY[]::text[])
  FROM regexp_matches(COALESCE(p_text,''), '([1-9A-HJ-NP-Za-km-z]{32,44})', 'g') m
$$;
```

### 3.4 `story` — where coinability, display eligibility and promote immutability live

```sql
CREATE TABLE IF NOT EXISTS public.story (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status story_status NOT NULL DEFAULT 'provisional',
  title text, title_version integer NOT NULL DEFAULT 0, titled_at timestamptz,
  title_centroid halfvec(768), blurb text, subject text, subject_type text,
  entity_keys text[] NOT NULL DEFAULT '{}',
  cashtags    text[] NOT NULL DEFAULT '{}',
  platforms   platform[] NOT NULL DEFAULT '{}',

  first_post_at timestamptz,                        -- the author's clock
  first_seen_at timestamptz NOT NULL DEFAULT now(), -- ours
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- THE lead-time clock. Set once at PROMOTE, frozen by the trigger below.
  promoted_at            timestamptz,
  promoted_at_backfilled boolean NOT NULL DEFAULT false,
  censored_entry         boolean NOT NULL DEFAULT false,

  -- The LEAST permissive tier is the default: an unclassified story is
  -- invisible until the classifier explicitly relaxes it. Fail closed.
  coinability_tier       coinability_tier NOT NULL DEFAULT 'never',
  coinability_reason     text, coinability_model text, coinability_confidence real,

  needs_review boolean NOT NULL DEFAULT false, coherence real,
  centroid halfvec(768), centroid_n real NOT NULL DEFAULT 0,
  exemplar_post_ids uuid[] NOT NULL DEFAULT '{}',

  n_posts integer NOT NULL DEFAULT 0, distinct_authors integer NOT NULL DEFAULT 0,
  combined_views bigint NOT NULL DEFAULT 0,
  lifecycle lifecycle, lifecycle_reason text,
  heat double precision, presented_heat smallint, heat_rank integer,
  top_post_id uuid,

  merged_into_id uuid REFERENCES public.story(id) ON DELETE SET NULL,
  merged_at timestamptz, merge_count_hour smallint NOT NULL DEFAULT 0,

  -- Maintained by trigger from coin_match. The primary button is a pure
  -- function of confirmed_coin_count and nothing else.
  confirmed_coin_count smallint NOT NULL DEFAULT 0,
  unsure_coin_count    smallint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  earliness_eligible boolean GENERATED ALWAYS AS (
    promoted_at IS NOT NULL AND NOT promoted_at_backfilled AND NOT censored_entry) STORED,

  -- A tier-`never` story is not "hidden by a filter". It is unreadable: the
  -- RLS policy in 0011 reads this column.
  display_eligible boolean GENERATED ALWAYS AS (
    promoted_at IS NOT NULL AND coinability_tier <> 'never'
    AND status IN ('open','dormant','closed')) STORED,

  can_create boolean GENERATED ALWAYS AS (
    coinability_tier = 'normal' AND status IN ('open','dormant','closed')
    AND needs_review = false AND promoted_at IS NOT NULL) STORED
);

-- The composite key that lets child tables carry the tier and be constrained on
-- it. This is how "a story surfacing when its coinability forbids it" becomes a
-- foreign-key violation instead of a code review comment.
SELECT insidor.add_constraint('public.story','story_id_tier_key','UNIQUE (id, coinability_tier)');

SELECT insidor.add_constraint('public.story','story_merged_needs_target',
  $$CHECK (status <> 'merged' OR (merged_into_id IS NOT NULL AND merged_at IS NOT NULL))$$);
SELECT insidor.add_constraint('public.story','story_no_self_merge',
  $$CHECK (merged_into_id IS DISTINCT FROM id)$$);
SELECT insidor.add_constraint('public.story','story_promote_after_first_post',
  $$CHECK (promoted_at IS NULL OR first_post_at IS NULL
           OR promoted_at >= first_post_at - interval '2 minutes')$$);
SELECT insidor.add_constraint('public.story','story_promoted_not_provisional',
  $$CHECK (promoted_at IS NULL OR status <> 'provisional')$$);
SELECT insidor.add_constraint('public.story','story_tier_needs_reason',
  $$CHECK (coinability_tier = 'never' OR coinability_reason IS NOT NULL)$$);
SELECT insidor.add_constraint('public.story','story_counts_nonneg',
  $$CHECK (confirmed_coin_count >= 0 AND unsure_coin_count >= 0)$$);

-- RULE 4. The single most load-bearing trigger in the schema.
DROP TRIGGER IF EXISTS story_freeze_promoted_at ON public.story;
CREATE TRIGGER story_freeze_promoted_at BEFORE UPDATE ON public.story
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('promoted_at');
DROP TRIGGER IF EXISTS story_touch ON public.story;
CREATE TRIGGER story_touch BEFORE UPDATE ON public.story
  FOR EACH ROW EXECUTE FUNCTION insidor.touch_updated_at();

CREATE INDEX IF NOT EXISTS story_board_idx   ON public.story (heat DESC NULLS LAST) WHERE display_eligible;
CREATE INDEX IF NOT EXISTS story_no_coin_idx ON public.story (heat DESC NULLS LAST)
  WHERE display_eligible AND confirmed_coin_count = 0 AND can_create;   -- "No coin yet"
CREATE INDEX IF NOT EXISTS story_promoted_at_idx ON public.story (promoted_at) WHERE promoted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS story_merged_into_idx  ON public.story (merged_into_id) WHERE merged_into_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS story_status_idx ON public.story (status);

-- Deliberately absent, and why:
--   search_series  a fabricated sine wave that drove search ordering
--   gain_24h       combined_views * 0.14, an invention
--   lead_time_min  derived, and only from story_clock where both clocks exist
--   age_min, accel, trend_*, img_seed, narr_idx, bought_reach
```

### 3.5 `post` and the heat tables

```sql
CREATE TABLE IF NOT EXISTS public.post (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id            uuid REFERENCES public.story(id) ON DELETE SET NULL,
  platform            platform NOT NULL,
  platform_post_id    text NOT NULL,

  author_handle       text NOT NULL,
  author_name         text,
  author_id           text,
  author_followers    integer,   -- current, display only
  -- The plausibility denominator, kept SEPARATE: `followers` grew BECAUSE of
  -- the post, so scoring reach against it is circular.
  followers_at_post   integer,

  posted_at           timestamptz NOT NULL,   -- timestamptz, not bigint ms
  first_seen_at       timestamptz NOT NULL DEFAULT now(),

  text                text NOT NULL DEFAULT '',
  lang                text,
  sample_replies      jsonb NOT NULL DEFAULT '[]'::jsonb,

  media_url text, media_kind media_kind, media_sha256 bytea, media_phash bit(64),
  media_local_url text, ocr_text text,
  derived_subject     text,   -- rendered under a DERIVED label only

  entity_keys         text[] NOT NULL DEFAULT '{}',
  cashtags            text[] NOT NULL DEFAULT '{}',
  mints_in_text       text[] NOT NULL DEFAULT '{}',  -- S_mint_in_post, the strongest channel

  -- Latest observed counters. Every one is NULLABLE: absent is not zero.
  views bigint, likes integer, reposts integer, replies integer,
  quotes integer, bookmarks integer,
  unavailable boolean NOT NULL DEFAULT false,
  second_wave boolean NOT NULL DEFAULT false,
  censored_entry boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT insidor.add_constraint('public.post','post_platform_key','UNIQUE (platform, platform_post_id)');

DROP TRIGGER IF EXISTS post_reject_future ON public.post;
CREATE TRIGGER post_reject_future BEFORE INSERT OR UPDATE ON public.post
  FOR EACH ROW EXECUTE FUNCTION insidor.reject_future_timestamp('posted_at');

CREATE INDEX IF NOT EXISTS post_story_views_idx ON public.post (story_id, views DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS post_recent_idx      ON public.post (posted_at DESC);

-- post_snapshot: PK (post_id, captured_at), plus the DESC index the old build
-- never had.
CREATE INDEX IF NOT EXISTS post_snapshot_post_time_idx
  ON public.post_snapshot (post_id, captured_at DESC);

-- post_heat. ACCEL renders an em dash on a single snapshot, never a
-- fabricated 1.0x.
SELECT insidor.add_constraint('public.post_heat','post_heat_burst_needs_ticks',
  $$CHECK (burst IS NULL OR ticks_qualified >= 2)$$);

-- story_momentum is a TABLE in five-minute buckets carrying member_count, NOT a
-- matview over raw snapshots: posts sample on a per-post geometric grid, so
-- summing by minute makes a story's total DROP when fewer posts happened to
-- snapshot, and COOLING then fires on a sampling artefact.
SELECT insidor.add_constraint('public.story_momentum','story_momentum_aligned',
  $$CHECK ((extract(epoch FROM (bucket_at - timestamptz 'epoch'))::bigint % 300) = 0)$$);
```

`post_meme_score`, `post_embedding` (`halfvec(768)` + HNSW), `platform_norm` and
`author_roster` complete `0002`. `post_embedding.model` is load-bearing:
`gemini-embedding-001` and `-2` spaces are documented as incompatible. There is no
constraint enforcing a single model across the corpus, because a re-embed necessarily
has both present transiently — so the pipeline asserts it instead, at the start of
every retrieval run.

### 3.6 `coin`, `coin_snapshot`, `coin_mcap_series`, `coin_safety`

```sql
CREATE TABLE IF NOT EXISTS public.coin (
  mint text PRIMARY KEY,
  symbol text, name text, decimals smallint, token_program text,
  logo_url text, logo_sha256 bytea, logo_phash bit(64), creator_wallet text,
  -- NULL is legal and meaningful: unknown age. Never 0.
  minted_at timestamptz,
  minted_at_source text NOT NULL DEFAULT 'unknown',
  launchpad text, curve_pct real, migrated boolean NOT NULL DEFAULT false,
  pool_address text, socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata_twitter text,          -- attacker-controlled; S_social caps at 0.85
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  is_insidor_launch boolean NOT NULL DEFAULT false,
  is_major boolean NOT NULL DEFAULT false,   -- excluded from DERIVED
  updated_at timestamptz NOT NULL DEFAULT now(),

  symbol_norm text GENERATED ALWAYS AS (
    upper(regexp_replace(COALESCE(symbol,''), '[^A-Za-z0-9]', '', 'g'))) STORED,

  -- `band` is generated from row-local facts only. The Fresh 6h ceiling depends
  -- on now() and therefore CANNOT live here — it is an eligibility filter in the
  -- board query, not part of the band. A non-pump.fun launchpad has NULL
  -- curve_pct and lands in 'fresh' until a pool exists, never nowhere.
  band coin_band GENERATED ALWAYS AS (
    CASE WHEN migrated OR pool_address IS NOT NULL       THEN 'live'::coin_band
         WHEN curve_pct IS NOT NULL AND curve_pct >= 50  THEN 'graduating'::coin_band
         ELSE 'fresh'::coin_band END) STORED
);

SELECT insidor.add_constraint('public.coin','coin_mint_base58',
  $$CHECK (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')$$);
SELECT insidor.add_constraint('public.coin','coin_symbol_len',
  $$CHECK (symbol IS NULL OR length(symbol) <= 13)$$);   -- create_v2 cap is 13
SELECT insidor.add_constraint('public.coin','coin_minted_at_source_enum',
  $$CHECK (minted_at_source IN ('pumpportal_create','pair_min','launch','unknown'))$$);
-- If we claim to know when it was minted, we must say how we know.
SELECT insidor.add_constraint('public.coin','coin_minted_at_needs_source',
  $$CHECK ((minted_at IS NULL) = (minted_at_source = 'unknown'))$$);
SELECT insidor.add_constraint('public.coin','coin_curve_range',
  $$CHECK (curve_pct IS NULL OR curve_pct BETWEEN 0 AND 100)$$);

-- minted_at is write-once. Precedence is decided at write time: PumpPortal create
-- event > min(pairCreatedAt) across ALL Solana pairs > NULL. Letting a later
-- best-pair read overwrite it reintroduces the 418-vs-647-day defect.
DROP TRIGGER IF EXISTS coin_freeze_mint_time ON public.coin;
CREATE TRIGGER coin_freeze_mint_time BEFORE UPDATE ON public.coin
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('minted_at','creator_wallet');

CREATE INDEX IF NOT EXISTS coin_symbol_norm_idx ON public.coin (symbol_norm);
CREATE INDEX IF NOT EXISTS coin_symbol_trgm_idx ON public.coin USING gin (symbol_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS coin_band_minted_idx ON public.coin (band, minted_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS coin_creator_idx     ON public.coin (creator_wallet) WHERE creator_wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS coin_logo_sha_idx    ON public.coin (logo_sha256) WHERE logo_sha256 IS NOT NULL;

COMMENT ON TABLE public.coin IS
  'There is no age_min column. A stored age scalar is wrong the second after it is written.';
```

`coin_snapshot` is the time series — PK `(mint, captured_at)`, index
`(mint, captured_at DESC)`. There was no price column anywhere in the old schema, so
every window and the whole CoinHeat formula were uncomputable. **Every numeric is
nullable: absent is not zero.**

```sql
SELECT insidor.add_constraint('public.coin_snapshot','coin_snapshot_price_positive',
  $$CHECK (price_usd IS NULL OR price_usd > 0)$$);   -- $0 claims worthlessness
SELECT insidor.add_constraint('public.coin_snapshot','coin_snapshot_mcap_positive',
  $$CHECK (mcap_usd IS NULL OR mcap_usd > 0)$$);
SELECT insidor.add_constraint('public.coin_snapshot','coin_snapshot_top10_needs_exclusion',
  $$CHECK (top10_pct IS NULL OR curve_pda_excluded)$$);

-- coin_mcap_series: five-minute mcap for 24h, the ONLY source of peak_mcap.
SELECT insidor.add_constraint('public.coin_mcap_series','coin_mcap_series_aligned',
  $$CHECK ((extract(epoch FROM (bucket_at - timestamptz 'epoch'))::bigint % 300) = 0)$$);
```

```sql
-- ===========================================================================
-- coin_safety. There is NO boolean anywhere in this table for an authority.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.coin_safety (
  mint text PRIMARY KEY REFERENCES public.coin(mint) ON DELETE CASCADE,
  mint_authority   authority_state NOT NULL DEFAULT 'unknown',
  freeze_authority authority_state NOT NULL DEFAULT 'unknown',
  authority_source text, transfer_fee_bps integer, has_transfer_hook boolean,
  sell_route route_state NOT NULL DEFAULT 'unknown', sell_route_checked_at timestamptz,
  top1_pct real, top10_pct real, holder_count integer,
  curve_pda_excluded boolean NOT NULL DEFAULT false,
  lp_locked_pct real, honeypot_proxy boolean,
  signals_checked smallint NOT NULL DEFAULT 0, signals_total smallint NOT NULL DEFAULT 9,
  raw jsonb, checked_at timestamptz NOT NULL DEFAULT now(),

  -- Unknown fails closed BY CONSTRUCTION: only the literal 'revoked'/'ok'
  -- passes. Note `has_transfer_hook = false` and not `IS NOT TRUE` — the latter
  -- would let NULL through, which is precisely the old bug's shape. Liquidity
  -- and band-dependent concentration are applied in the board query, because
  -- they are market data and change every tick.
  intrinsic_gate_pass boolean GENERATED ALWAYS AS (
        mint_authority   = 'revoked'
    AND freeze_authority = 'revoked'
    AND sell_route       = 'ok'
    AND COALESCE(transfer_fee_bps, 0) = 0
    AND COALESCE(has_transfer_hook, true) = false
    AND top10_pct IS NOT NULL
    AND curve_pda_excluded) STORED
);
SELECT insidor.add_constraint('public.coin_safety','coin_safety_signals',
  $$CHECK (signals_checked BETWEEN 0 AND signals_total)$$);
SELECT insidor.add_constraint('public.coin_safety','coin_safety_top10_needs_exclusion',
  $$CHECK (top10_pct IS NULL OR curve_pda_excluded)$$);
SELECT insidor.add_constraint('public.coin_safety','coin_safety_route_needs_check',
  $$CHECK (sell_route = 'unknown' OR sell_route_checked_at IS NOT NULL)$$);
```

`coin_image_embedding` is `halfvec(512)` + HNSW — a **separate space** from
`post_embedding`'s `halfvec(768)`. Mixing them in one column is a silent recall bug.
`creator_stat` carries
`CHECK (has_verdict = false OR (mint_count >= 1 AND first_mint_at IS NOT NULL))`, so a
clean tick can never be manufactured by absence of data.

### 3.7 `story_ticker` and `coin_match` — the two tables that cannot touch

`narrative_tickers` held five concepts in one row: a ticker, a mint, market data, a
verdict, and a provenance it did not have. That is *the mechanism* by which an
LLM-invented ticker got resolved against a live market and rendered a Buy button. It
becomes two tables that cannot reach each other.

```sql
-- ===========================================================================
-- story_ticker. Candidates and create-path prefills. Deliberately carries NO
-- mcap, liquidity, holders, vol24h, safety, canonical or first_deployed column.
-- Their absence is the fix: removing the columns makes the defect
-- unrepresentable rather than merely discouraged.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.story_ticker (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id      uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  ticker        text NOT NULL,
  name          text,
  -- NOT NULL, NO DEFAULT. An INSERT that forgets provenance fails. There is no
  -- value this column can hold that means "we don't know where this came from".
  source        ticker_source NOT NULL,
  source_span   text,
  post_id       uuid REFERENCES public.post(id) ON DELETE SET NULL,
  resolved_mint text REFERENCES public.coin(mint) ON DELETE SET NULL,
  score         real,
  created_at    timestamptz NOT NULL DEFAULT now()
);

SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_shape',
  $$CHECK (ticker ~ '^[A-Z][A-Z0-9]{1,12}$')$$);
-- THE constraint. The $KANG defect, expressed as an impossibility.
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_llm_never_resolves',
  $$CHECK (source <> 'llm' OR resolved_mint IS NULL)$$);
-- An ungrounded LLM suggestion cannot even be stored.
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_llm_needs_span',
  $$CHECK (source <> 'llm' OR source_span IS NOT NULL)$$);
-- A cashtag or mint-in-post claim must name the post it came from.
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_evidence_needs_post',
  $$CHECK (source NOT IN ('cashtag','mint_in_post') OR post_id IS NOT NULL)$$);
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_launch_has_mint',
  $$CHECK (source <> 'insidor_launch' OR resolved_mint IS NOT NULL)$$);
SELECT insidor.add_constraint('public.story_ticker', 'story_ticker_unique',
  'UNIQUE (story_id, ticker, source)');

CREATE INDEX IF NOT EXISTS story_ticker_story_idx ON public.story_ticker (story_id);
-- The create-form prefill reads only non-'llm' sources.
CREATE INDEX IF NOT EXISTS story_ticker_prefill_idx
  ON public.story_ticker (ticker) WHERE source IN ('cashtag','mint_in_post');
CREATE INDEX IF NOT EXISTS story_ticker_trgm_idx
  ON public.story_ticker USING gin (ticker gin_trgm_ops);
```

```sql
-- ===========================================================================
-- coin_match. One row per (story, mint). The only input to the primary button.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.coin_match (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id         uuid NOT NULL REFERENCES public.story(id) ON DELETE CASCADE,
  mint             text NOT NULL REFERENCES public.coin(mint) ON DELETE CASCADE,
  verdict          match_verdict  NOT NULL,
  relation         match_relation NOT NULL,
  -- Denormalised at match time: the pipeline truncates and re-inserts ticker
  -- rows every cycle, so a page load racing a cycle would render
  -- "Buy $undefined". The button never reads a table that can vanish.
  ticker           text NOT NULL,
  name             text,
  ticker_source    ticker_source NOT NULL,
  score            real NOT NULL,
  -- NULL means NOT CHECKED, rendered "not checked", never "failed", never 0.
  s_mint_in_post   real,
  s_img            real,
  s_text           real,
  s_tick           real,
  s_social         real,
  time_prior           real NOT NULL,
  market_plausibility  real,
  mint_time        timestamptz,
  earliest_post_at timestamptz NOT NULL,
  matcher_version  text NOT NULL,
  evidence         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- server-only
  evidence_public  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- categorical prose
  matched_at       timestamptz NOT NULL DEFAULT now(),
  retracted_at     timestamptz,

  channels_ran smallint GENERATED ALWAYS AS (
      (s_mint_in_post IS NOT NULL)::int + (s_img  IS NOT NULL)::int
    + (s_text         IS NOT NULL)::int + (s_tick IS NOT NULL)::int
    + (s_social       IS NOT NULL)::int
  ) STORED,
  strong_channels smallint GENERATED ALWAYS AS (
      (COALESCE(s_img,  0) >= 0.55)::int
    + (COALESCE(s_text, 0) >= 0.55)::int
    + (COALESCE(s_tick, 0) >= 0.60)::int
  ) STORED,
  -- The subtraction stays INSIDE the extract: timestamptz - timestamptz yields
  -- interval, and extract(text, interval) is immutable. extract from a bare
  -- timestamptz is STABLE and would be rejected here.
  delta_min integer GENERATED ALWAYS AS (
    CASE WHEN mint_time IS NULL THEN NULL
         ELSE round(extract(epoch FROM (mint_time - earliest_post_at)) / 60.0)::int END
  ) STORED
);

SELECT insidor.add_constraint('public.coin_match', 'coin_match_pair_key',
  'UNIQUE (story_id, mint)');
SELECT insidor.add_constraint('public.coin_match', 'coin_match_score_range',
  $$CHECK (score BETWEEN 0 AND 1)$$);
SELECT insidor.add_constraint('public.coin_match', 'coin_match_channel_ranges',
  $$CHECK ((s_mint_in_post IS NULL OR s_mint_in_post BETWEEN 0 AND 1)
       AND (s_img    IS NULL OR s_img    BETWEEN 0 AND 1)
       AND (s_text   IS NULL OR s_text   BETWEEN 0 AND 1)
       AND (s_tick   IS NULL OR s_tick   BETWEEN 0 AND 1)
       -- capped: the metadata twitter field is attacker-controlled and must
       -- never be able to confirm alone.
       AND (s_social IS NULL OR s_social BETWEEN 0 AND 0.85))$$);
SELECT insidor.add_constraint('public.coin_match', 'coin_match_ticker_shape',
  $$CHECK (ticker ~ '^[A-Z][A-Z0-9]{1,12}$')$$);

-- RULE 1. Written out in full rather than calling a function, because a CHECK
-- depending on a user-defined function is a pg_dump/restore ordering hazard and
-- this is the one constraint that must never fail to restore.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_confirmed_requires_evidence',
$$CHECK (
  verdict <> 'confirmed' OR (
        score >= 0.80
    AND ticker_source <> 'llm'      -- an invented ticker can never confirm
    AND mint_time IS NOT NULL       -- unknown age fails closed, never "brand new"
    AND relation <> 'mentioned'     -- a typed cashtag is candidate generation
    AND (
          COALESCE(s_mint_in_post, 0) >= 0.90
       OR ( (COALESCE(s_img,  0) >= 0.55)::int
          + (COALESCE(s_text, 0) >= 0.55)::int
          + (COALESCE(s_tick, 0) >= 0.60)::int ) >= 2
        )
  )
)$$);

-- The identical predicate, exported for the matcher's tests and the eval
-- harness. If the two ever disagree, CI catches it.
CREATE OR REPLACE FUNCTION public.confirmable(
  p_mint_in_post real, p_img real, p_text real, p_tick real
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p_mint_in_post, 0) >= 0.90
      OR ( (COALESCE(p_img,  0) >= 0.55)::int
         + (COALESCE(p_text, 0) >= 0.55)::int
         + (COALESCE(p_tick, 0) >= 0.60)::int ) >= 2
$$;

-- Kills the GYATT class: a 604-day-old shell can never be DERIVED. The 10-minute
-- negative tolerance is clock skew; roughly 2.5% of tokens are minted before
-- their referenced post.
SELECT insidor.add_constraint('public.coin_match', 'coin_match_derived_temporal_gate',
$$CHECK (
  relation <> 'derived' OR (
        mint_time IS NOT NULL
    AND mint_time >= earliest_post_at - interval '10 minutes'
    AND mint_time <= earliest_post_at + interval '48 hours'
  )
)$$);

SELECT insidor.add_constraint('public.coin_match', 'coin_match_adopted_predates',
$$CHECK (relation <> 'adopted'
         OR (mint_time IS NOT NULL AND mint_time < earliest_post_at - interval '10 minutes'))$$);
SELECT insidor.add_constraint('public.coin_match', 'coin_match_mentioned_not_actionable',
  $$CHECK (relation <> 'mentioned' OR verdict = 'unsure')$$);
SELECT insidor.add_constraint('public.coin_match', 'coin_match_retraction',
  $$CHECK (retracted_at IS NULL OR verdict = 'rejected')$$);
SELECT insidor.add_constraint('public.coin_match', 'coin_match_public_evidence_present',
  $$CHECK (verdict = 'rejected'
           OR (jsonb_typeof(evidence_public) = 'object' AND evidence_public <> '{}'::jsonb))$$);

CREATE INDEX IF NOT EXISTS coin_match_story_idx
  ON public.coin_match (story_id, verdict, score DESC) WHERE retracted_at IS NULL;
CREATE INDEX IF NOT EXISTS coin_match_mint_idx
  ON public.coin_match (mint, verdict, score DESC) WHERE retracted_at IS NULL;
CREATE INDEX IF NOT EXISTS coin_match_confirmed_mint_time_idx
  ON public.coin_match (story_id, mint_time)
  WHERE verdict = 'confirmed' AND retracted_at IS NULL;

-- The counters behind the primary button. IDENTITY ONLY: safety is not a term.
-- If it were, a four-minute-old mint with a null mcap would flip the button back
-- to Create and drive a duplicate launch in the exact window this product exists
-- to serve.
CREATE OR REPLACE FUNCTION insidor.recount_story_coins() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_story uuid;
BEGIN
  v_story := COALESCE(NEW.story_id, OLD.story_id);
  UPDATE public.story s SET
    confirmed_coin_count = (
      SELECT count(*) FROM public.coin_match m
       WHERE m.story_id = v_story AND m.retracted_at IS NULL
         AND m.verdict = 'confirmed' AND m.mint_time IS NOT NULL AND m.ticker IS NOT NULL),
    unsure_coin_count = (
      SELECT count(*) FROM public.coin_match m
       WHERE m.story_id = v_story AND m.retracted_at IS NULL AND m.verdict = 'unsure')
  WHERE s.id = v_story;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS coin_match_recount ON public.coin_match;
CREATE TRIGGER coin_match_recount
  AFTER INSERT OR UPDATE OR DELETE ON public.coin_match
  FOR EACH ROW EXECUTE FUNCTION insidor.recount_story_coins();
```

`match_label` is the gold set and the eval set growing itself:
`UNIQUE (story_id, mint, matcher_version)`, `CHECK ((label IS NULL) = (labelled_at IS NULL))`,
and a `stratum` column so precision can be reported per band.

### 3.8 The clocks — `ct_mention`, `sensor_*`, `story_clock`, `story_outcome`

Clock A — every Solana mint — **is `coin` itself** (`coin.minted_at` with
`minted_at_source = 'pumpportal_create'`). There is no separate `coin_mints` table:
two tables holding a mint time is two tables that can disagree.

```sql
-- Clock B.
CREATE TABLE IF NOT EXISTS public.ct_mention (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid REFERENCES public.story(id) ON DELETE CASCADE,
  mint text REFERENCES public.coin(mint) ON DELETE CASCADE,
  handle text NOT NULL, platform_post_id text NOT NULL,
  posted_at timestamptz NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
  permalink text NOT NULL, matched_on text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
SELECT insidor.add_constraint('public.ct_mention','ct_mention_key','UNIQUE (handle, platform_post_id)');
SELECT insidor.add_constraint('public.ct_mention','ct_mention_targets_something',
  $$CHECK (story_id IS NOT NULL OR mint IS NOT NULL)$$);
SELECT insidor.add_constraint('public.ct_mention','ct_mention_permalink_present',
  $$CHECK (length(permalink) > 0)$$);

-- Symmetric by construction: ONE table, ONE enum.
CREATE TABLE IF NOT EXISTS public.sensor_heartbeat (
  sensor sensor PRIMARY KEY,
  last_beat_at timestamptz NOT NULL,
  observed_through timestamptz NOT NULL,      -- the watermark
  connected_at timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb);
SELECT insidor.add_constraint('public.sensor_heartbeat','sensor_watermark_not_future',
  $$CHECK (observed_through <= last_beat_at + interval '1 minute')$$);

CREATE TABLE IF NOT EXISTS public.sensor_gap (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sensor sensor NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz,
  detected_by text NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now());
SELECT insidor.add_constraint('public.sensor_gap','sensor_gap_ordered',
  $$CHECK (ended_at IS NULL OR ended_at > started_at)$$);
```

```sql
-- ===========================================================================
-- story_clock. RULE 5. Four mechanisms make "a lead time without both clock
-- readings" a row Postgres will not accept:
--   1. promoted_at is copied by trigger from story.promoted_at, itself
--      write-once; the row cannot exist before PROMOTE.
--   2. Both sensor watermarks are NOT NULL: you cannot record a clock without
--      recording how far that sensor had actually scanned.
--   3. Both watermarks must reach past promoted_at.
--   4. t_crypto and lead_time_min are GENERATED. There is no INSERT or UPDATE
--      that can write a lead time by hand at all.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.story_clock (
  story_id uuid PRIMARY KEY REFERENCES public.story(id) ON DELETE CASCADE,
  promoted_at timestamptz NOT NULL,
  t_mint timestamptz,
  t_mint_mint text REFERENCES public.coin(mint) ON DELETE SET NULL,
  t_ct timestamptz, t_ct_handle text, t_ct_url text,
  t_mint_observed_through timestamptz NOT NULL,
  t_ct_observed_through   timestamptz NOT NULL,
  first_post_at timestamptz,
  unmeasurable boolean NOT NULL DEFAULT false,
  unmeasurable_sensor sensor,
  unmeasurable_gap_id bigint REFERENCES public.sensor_gap(id) ON DELETE SET NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- LEAST() is avoided: an explicit CASE is unambiguously immutable.
  t_crypto timestamptz GENERATED ALWAYS AS (
    CASE WHEN t_mint IS NULL THEN t_ct
         WHEN t_ct   IS NULL THEN t_mint
         WHEN t_mint < t_ct  THEN t_mint ELSE t_ct END) STORED,

  -- The CASE is re-inlined rather than referencing t_crypto, because a
  -- generation expression cannot reference another generated column.
  lead_time_min integer GENERATED ALWAYS AS (
    CASE WHEN t_mint IS NULL AND t_ct IS NULL THEN NULL
         ELSE round(extract(epoch FROM (
                (CASE WHEN t_mint IS NULL THEN t_ct
                      WHEN t_ct   IS NULL THEN t_mint
                      WHEN t_mint < t_ct  THEN t_mint ELSE t_ct END) - promoted_at
              )) / 60.0)::int END) STORED
);

SELECT insidor.add_constraint('public.story_clock','story_clock_mint_within_watermark',
  $$CHECK (t_mint IS NULL OR t_mint <= t_mint_observed_through)$$);
SELECT insidor.add_constraint('public.story_clock','story_clock_ct_within_watermark',
  $$CHECK (t_ct IS NULL OR t_ct <= t_ct_observed_through)$$);
-- THE constraint: both sensors must have scanned past the promote moment. A
-- lead measured against a poller that had not caught up is rejected here, not
-- caught in review.
SELECT insidor.add_constraint('public.story_clock','story_clock_both_sensors_past_promote',
  $$CHECK (t_mint_observed_through >= promoted_at AND t_ct_observed_through >= promoted_at)$$);
SELECT insidor.add_constraint('public.story_clock','story_clock_unmeasurable_names_sensor',
  $$CHECK (unmeasurable = false OR unmeasurable_sensor IS NOT NULL)$$);
-- The proof travels with the claim.
SELECT insidor.add_constraint('public.story_clock','story_clock_ct_needs_proof',
  $$CHECK (t_ct IS NULL OR (t_ct_handle IS NOT NULL AND t_ct_url IS NOT NULL))$$);
SELECT insidor.add_constraint('public.story_clock','story_clock_mint_needs_mint',
  $$CHECK (t_mint IS NULL OR t_mint_mint IS NOT NULL)$$);

-- A later sighting must never move an already-recorded first sighting.
DROP TRIGGER IF EXISTS story_clock_freeze ON public.story_clock;
CREATE TRIGGER story_clock_freeze BEFORE UPDATE ON public.story_clock
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns('promoted_at','t_mint','t_ct');

-- lead_time_min needs promoted_at in the same row, so it must be duplicated,
-- and duplication invites drift. The trigger makes the story the sole source
-- and refuses the insert if the story has not promoted.
CREATE OR REPLACE FUNCTION insidor.story_clock_copy_promoted_at() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_promoted timestamptz;
BEGIN
  SELECT promoted_at INTO v_promoted FROM public.story WHERE id = NEW.story_id;
  IF v_promoted IS NULL THEN
    RAISE EXCEPTION 'story % has no promoted_at; a clock cannot exist before PROMOTE', NEW.story_id;
  END IF;
  NEW.promoted_at := v_promoted;   -- not the caller's value. The story is the source.
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS story_clock_promoted_at ON public.story_clock;
CREATE TRIGGER story_clock_promoted_at BEFORE INSERT ON public.story_clock
  FOR EACH ROW EXECUTE FUNCTION insidor.story_clock_copy_promoted_at();

CREATE INDEX IF NOT EXISTS story_clock_lead_idx
  ON public.story_clock (lead_time_min) WHERE unmeasurable = false;
-- "+2h14m and counting": no t_crypto yet.
CREATE INDEX IF NOT EXISTS story_clock_open_idx
  ON public.story_clock (promoted_at DESC) WHERE t_mint IS NULL AND t_ct IS NULL;
```

A note for whoever has to change this later: **if a generated column ever has to
become writable, the replacement is a `BEFORE INSERT OR UPDATE` trigger writing a
plain integer column guarded by `freeze_columns`, not a view.** A view would keep the
single-implementation guarantee but break `story_clock_lead_idx`, which is a partial
index on the generated column and the reason lead is sortable everywhere it appears.

```sql
-- story_outcome. Misses are visible by default.
CREATE TABLE IF NOT EXISTS public.story_outcome (
  story_id uuid PRIMARY KEY REFERENCES public.story(id) ON DELETE CASCADE,
  outcome story_outcome_kind NOT NULL,
  lead_time_min integer,
  first_coin_mint text REFERENCES public.coin(mint) ON DELETE SET NULL,
  peak_mcap numeric(20,2),
  peak_mcap_samples integer NOT NULL DEFAULT 0,
  hit_threshold numeric(20,2),
  lifecycle_reason text,
  classified_at timestamptz NOT NULL DEFAULT now(),
  classifier_version text NOT NULL);

SELECT insidor.add_constraint('public.story_outcome','story_outcome_late_is_negative',
  $$CHECK (outcome <> 'late' OR (lead_time_min IS NOT NULL AND lead_time_min < 0))$$);
SELECT insidor.add_constraint('public.story_outcome','story_outcome_no_coin_has_no_coin',
  $$CHECK (outcome <> 'no_coin' OR first_coin_mint IS NULL)$$);
SELECT insidor.add_constraint('public.story_outcome','story_outcome_hit_dud_need_coin',
  $$CHECK (outcome NOT IN ('hit','dud') OR first_coin_mint IS NOT NULL)$$);
-- A "peak" from one observation is a last-observed value with a flattering
-- label. Six samples is thirty minutes of coin_mcap_series.
SELECT insidor.add_constraint('public.story_outcome','story_outcome_peak_needs_series',
  $$CHECK (outcome NOT IN ('hit','dud')
           OR (peak_mcap IS NOT NULL AND peak_mcap_samples >= 6 AND hit_threshold IS NOT NULL))$$);
SELECT insidor.add_constraint('public.story_outcome','story_outcome_unmeasurable_has_no_lead',
  $$CHECK (outcome <> 'unmeasurable' OR lead_time_min IS NULL)$$);
```

That six-sample floor has a consequence the nightly classifier must handle
explicitly: a story whose coin dies inside thirty minutes cannot be classified
`hit` or `dud`. It is classified `unmeasurable` with a `lifecycle_reason`, never left
NULL — the watchdog holds `count(outcome IS NULL AND promoted_at < now() - 72h)` at
zero.

### 3.9 The board — ranking is not a query

```sql
CREATE TABLE IF NOT EXISTS public.board_state (
  lane         board_lane NOT NULL,
  band         coin_band,                     -- NULL on the posts lane
  post_id      uuid REFERENCES public.post(id) ON DELETE CASCADE,
  mint         text REFERENCES public.coin(mint) ON DELETE CASCADE,
  rank         smallint NOT NULL,
  prev_rank    smallint,
  heat         double precision NOT NULL,
  presented_heat smallint,
  entered_at   timestamptz NOT NULL DEFAULT now(),
  pinned_until timestamptz NOT NULL DEFAULT now(),   -- 90s dwell
  enter_ticks  smallint NOT NULL DEFAULT 0,
  exit_ticks   smallint NOT NULL DEFAULT 0,
  escape_hatch boolean NOT NULL DEFAULT false,       -- skipped the dwell, NEW badge
  tick_seq     bigint NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now()
);

SELECT insidor.add_constraint('public.board_state', 'board_state_entity_xor',
  $$CHECK ((post_id IS NOT NULL)::int + (mint IS NOT NULL)::int = 1)$$);
SELECT insidor.add_constraint('public.board_state', 'board_state_lane_entity_agrees',
  $$CHECK ((lane = 'posts' AND post_id IS NOT NULL AND band IS NULL)
        OR (lane = 'coins' AND mint    IS NOT NULL AND band IS NOT NULL))$$);
SELECT insidor.add_constraint('public.board_state', 'board_state_rank_range',
  $$CHECK (rank BETWEEN 1 AND 200)$$);

-- Q1 and Q2 both open here: a 40-row ordered index scan, no Sort node.
CREATE UNIQUE INDEX IF NOT EXISTS board_state_rank_key
  ON public.board_state (lane, COALESCE(band, 'fresh'::coin_band), rank);
```

`board_tick` is RANGE-partitioned by day with 48-hour retention: ~173k rows per day
per lane at a 20-second commit, and the Δ10m lookback needs only ten minutes. Dropping
a partition is a DETACH, not a DELETE storm against a table being written three times
a minute. Partitions are created a week ahead by `pg_cron`; two are created in the
migration so a fresh database is immediately writable.

`board_gate_count` carries `eligible`, `shown` and `by_reason jsonb` per commit, so
the line under the board — *"40 of 63 eligible · 12 hidden by gate"* — can distinguish
a filtered window from a slow night, including a bare coinability count.

### 3.10 User, social, trading and launch

`app_user` maps a Privy DID to an internal uuid: `id uuid PRIMARY KEY`,
`privy_did text UNIQUE NOT NULL`, `wallet_address text UNIQUE`, both frozen by
trigger. An address is identity on Solana; it must never be reassigned to a new DID.

`follow` targets a story **XOR** a coin, and carries a `user_id` **XOR** a `device_id`,
with four partial unique indexes. A story follow never silently becomes a coin follow:
when a watched story mints, the story row stays and an explicit second row is written
for the coin.

`holding` is unique on `(user_id, wallet, mint)` — **not** `(user_id, mint)`, or a
second wallet holding the same coin corrupts both cost basis and the frozen earliness.
`minutes_early` is a *signed*, nullable integer, and it cannot exist without the flag
that says it was measurable:

```sql
SELECT insidor.add_constraint('public.holding', 'holding_minutes_early_requires_measurable',
  $$CHECK (minutes_early IS NULL OR (minutes_early_measurable AND story_id IS NOT NULL))$$);
```

The flag itself is set by a `BEFORE INSERT OR UPDATE` trigger that refuses unless a
`story_clock` row exists with `unmeasurable = false` and a computed lead — a trigger
and not a composite FK, because `ON UPDATE CASCADE` would make it impossible to later
mark a clock unmeasurable while anyone held the coin, and *discovering a sensor gap
must never be blocked by a user's position*.

`comment` carries the honesty stamp: `snap_views`, `snap_coin_count`,
`snap_unsure_count`, `snap_age_min`, `snap_top_mcap`, `snap_early`,
`snap_position_state`, `snap_position_lamports`, `snap_position_mint`,
`snap_position_decimals` — all frozen by `freeze_columns`, plus `created_at`,
`author_wallet` and `body`. Three triggers guard it: `comment_assert_tier` (refuses a
tier-`never` story), `comment_address_gate` (blocks every base58 32–44 run **including
this story's own mints**), and `comment_speed_limit` (three per wallet per sixty
seconds, because edge limits are per-region and therefore not a global cap). Two
constraints matter:

```sql
SELECT insidor.add_constraint('public.comment', 'comment_position_holds_needs_amount',
  $$CHECK (snap_position_state <> 'holds'
           OR (snap_position_lamports > 0 AND snap_position_mint IS NOT NULL
               AND snap_position_decimals IS NOT NULL))$$);
-- "$0 mcap" reads as a bug, not as "no coin yet".
SELECT insidor.add_constraint('public.comment', 'comment_zero_coin_has_no_mcap',
  $$CHECK (snap_coin_count > 0 OR snap_top_mcap IS NULL)$$);

-- "Earliest" means written when the story was SMALLEST, not oldest by clock.
CREATE INDEX IF NOT EXISTS comment_story_earliest_idx
  ON public.comment (story_id, snap_views, created_at) WHERE status = 'visible';
```

`trade` puts single-submission in the database rather than in a UI disabled state:

```sql
SELECT insidor.add_constraint('public.trade', 'trade_request_id_key', 'UNIQUE (request_id)');
SELECT insidor.add_constraint('public.trade', 'trade_signature_key',  'UNIQUE (signature)');
-- Deliberately wide. Jupiter documents a 50 bps referral floor but a 10 bps
-- platform fee was measured live on fresh mints, so this number is READ from
-- the order response and displayed, never hardcoded.
SELECT insidor.add_constraint('public.trade', 'trade_fee_bps_range',
  $$CHECK (fee_bps_quoted BETWEEN 0 AND 255
       AND (fee_bps_charged IS NULL OR fee_bps_charged BETWEEN 0 AND 255))$$);
-- A fill is confirmed by signature status, never inferred from a balance change.
SELECT insidor.add_constraint('public.trade', 'trade_confirmed_needs_signature',
  $$CHECK (status <> 'confirmed'
           OR (signature IS NOT NULL AND out_amount_raw IS NOT NULL AND confirmed_at IS NOT NULL))$$);

CREATE TRIGGER trade_freeze BEFORE UPDATE ON public.trade
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns(
    'request_id', 'signature', 'fee_bps_quoted', 'sol_usd_at_trade',
    'in_amount_raw', 'min_out_raw');
```

`sol_usd_at_trade` is `NOT NULL` and captured server-side. Every PnL number in the
product derives from that column, never from a browser price global.

`launch` is where Rule 3 becomes a foreign key:

```sql
SELECT insidor.add_constraint('public.launch', 'launch_story_tier_fk',
  $$FOREIGN KEY (story_id, story_coinability_tier)
      REFERENCES public.story (id, coinability_tier) ON UPDATE RESTRICT$$);
SELECT insidor.add_constraint('public.launch', 'launch_requires_normal_tier',
  $$CHECK (story_coinability_tier = 'normal')$$);
SELECT insidor.add_constraint('public.launch', 'launch_landed_has_mint',
  $$CHECK (status <> 'landed' OR (mint IS NOT NULL AND tx_signature IS NOT NULL AND landed_at IS NOT NULL))$$);

CREATE TRIGGER launch_freeze BEFORE UPDATE ON public.launch
  FOR EACH ROW EXECUTE FUNCTION insidor.freeze_columns(
    'mint_keypair_enc', 'mint', 'tx_signature', 'creator_wallet', 'ticker');
```

`mint_keypair_enc` is `NOT NULL` and persisted encrypted **before the first
signature**, so a retry reuses it and a late confirmation fails with
*"account already in use"* rather than minting twice.

`ON UPDATE RESTRICT` has a deliberate and slightly startling consequence:
**reclassifying a story that has already launched a coin fails with a foreign-key
error.** That is intended — it surfaces the question rather than resolving it with a
silent cascade — but it needs a runbook entry before creation ships, or it lands as a
confusing production error.

`namer_run` is written at **form open**, not at submit, with an outcome in
`accepted | edited | abandoned | typed_over` and `time_to_first_keystroke_ms`.
Abandonment is the strongest negative signal the namer produces, and a table that
only records submissions fits its weights on a hits-only sample.

`fee_share` is `UNIQUE (mint, role)` with `freeze_columns('written_at','recipient','bps')`,
because `updateFeeSharesV2` is one-shot on chain.

### 3.11 Search and ops

```sql
-- 0009_search.sql — the immutable wrapper comes FIRST, before any column that
-- depends on it.
CREATE OR REPLACE FUNCTION insidor.text_array_to_string(text[], text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS
$$ SELECT array_to_string($1, $2) $$;

SELECT insidor.add_column('public.story', 'search_doc',
  $$tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce(title, '')),   'A')
   || setweight(to_tsvector('english'::regconfig, coalesce(subject, '')), 'A')
   || setweight(to_tsvector('english'::regconfig,
        insidor.text_array_to_string(entity_keys, ' ')), 'B')
   || setweight(to_tsvector('english'::regconfig, coalesce(blurb, '')),   'C')
    ) STORED$$);
```

Three retrieval legs are fused with RRF: FTS (GIN on `search_doc`), trigram
(`gin_trgm_ops` on `story.title`, `story_ticker.ticker`, `coin.symbol_norm`, at 0.30
on titles and 0.18 on tickers because ticker drift is one or two characters), and
vector (HNSW on `story.centroid` and `post_embedding.embedding`,
`halfvec_cosine_ops`, `m=16`, `ef_construction=64`). **All three legs join
`eligible_story`**, the single eligibility view, so a tier-`never` story cannot be
reached through the vector leg because somebody paraphrased its title.

The seven `ops_*` tables are the observability substrate. Three of their constraints
encode lessons rather than schema:

```sql
-- rows_out is the column that makes the output-freshness SLI work. `ingested`
-- does not mean "output" everywhere, and two of the four workers that logged at
-- all would otherwise page from day one.
SELECT insidor.add_constraint('public.ops_stage_run', 'ops_stage_run_ok_finished',
  $$CHECK (ok = false OR finished_at IS NOT NULL)$$);

-- ops_stage_expected is the FIXED list the SLI query LEFT JOINs, so a worker
-- that dies before it can log anything emits a 999 streak on ABSENCE. Absence
-- and zero must both breach.
INSERT INTO public.ops_stage_expected(stage, interval_seconds) VALUES
  ('ingest', 180), ('ingest-tiktok', 600), ('snapshotter', 60), ('score', 120),
  ('cluster', 45), ('resolve-coins', 60), ('trends', 300), ('rank-commit', 20)
ON CONFLICT (stage) DO NOTHING;

-- A green board painted by an SLI querying a nonexistent column is exactly how
-- the original outage stayed invisible.
SELECT insidor.add_constraint('public.ops_sli_sample', 'ops_sli_null_is_unknown',
  $$CHECK ((value IS NULL) = (state = 'unknown'))$$);
```

`ops_spend` deserves one line of its own: **absence of a row means no data, not zero
spend.**

### 3.12 The views — one row for every Create affordance

```sql
-- Identity is not tradeability. `verdict = 'confirmed'` never expires — a rugged
-- coin would otherwise render Buy forever — so the resolver takes two inputs and
-- this is the second. Concentration is band-dependent on purpose: a flat 60%
-- gate empties Fresh on day one, when a three-minute-old token has nine buyers
-- and is legitimately concentrated.
CREATE OR REPLACE FUNCTION public.coin_tradeable(
  p_band coin_band, p_intrinsic_gate boolean, p_liquidity_usd numeric,
  p_top10_pct real, p_buys_5m integer, p_sells_5m integer,
  p_price_captured_at timestamptz, p_minted_at timestamptz
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(p_intrinsic_gate, false)          -- unknown fails closed
     AND p_minted_at IS NOT NULL                    -- unknown age fails closed
     AND p_top10_pct IS NOT NULL
     AND p_top10_pct <= CASE WHEN p_band = 'fresh' THEN 85 ELSE 60 END
     AND (p_band <> 'live' OR COALESCE(p_liquidity_usd, 0) >= 3000)
     AND NOT (COALESCE(p_sells_5m, 0) = 0 AND COALESCE(p_buys_5m, 0) > 30)
     AND p_price_captured_at IS NOT NULL
     AND p_price_captured_at > now() - interval '5 minutes'
$$;

-- ONE row read, and no client-side coinability logic anywhere:
--   select can_create, buy_count, unsure_count from story_cta_v where id = $1
CREATE OR REPLACE VIEW public.story_cta_v AS
SELECT s.id, s.can_create, s.coinability_tier,
       s.confirmed_coin_count AS buy_count,
       s.unsure_coin_count    AS unsure_count,
       s.needs_review,
       (SELECT count(*) FROM public.launch l WHERE l.story_id = s.id
         AND l.created_at > now() - interval '1 hour')   AS launches_last_1h,
       (SELECT count(*) FROM public.launch l WHERE l.story_id = s.id
         AND l.created_at > now() - interval '24 hours') AS launches_last_24h,
       (SELECT m.mint   FROM public.coin_match m WHERE m.story_id = s.id
         AND m.verdict = 'confirmed' AND m.retracted_at IS NULL
         ORDER BY m.mint_time NULLS LAST LIMIT 1)        AS first_confirmed_mint,
       (SELECT m.ticker FROM public.coin_match m WHERE m.story_id = s.id
         AND m.verdict = 'confirmed' AND m.retracted_at IS NULL
         ORDER BY m.mint_time NULLS LAST LIMIT 1)        AS first_confirmed_ticker
  FROM public.story s
 WHERE s.display_eligible;

COMMENT ON VIEW public.story_cta_v IS
  'The gate is in the query. A no_create story returns can_create = false, and a tier `never` story returns NO ROW because it is not display_eligible.';
```

`record_summary_mv` is the public record's denominators, computed once so `/ops/earliness`
and the public page read the same numbers from the same place. `late_n` is published
in the same weight as `early_n`; a record with no left tail is marketing. Below `n = 30`
every percentile renders as an em dash with *"not enough data (n=12)"*.

### 3.13 The four hot queries

`supabase/queries/hot-queries.sql` holds them in full, with the index each one drives.
`supabase/tests/plans.sql` asserts the plan shape in CI — no `Seq Scan` on
`board_state`, `coin_snapshot`, `coin_match`, `comment` or `story_outcome`, and no
`Sort` on Q1, Q3-discussion or Q4.

| Query | Surface | Target | Opens on |
|---|---|---|---|
| **Q1** posts board | `/feed?lane=posts` | < 8 ms | `board_state_rank_key`, ordered scan, no Sort; then 40 primary-key joins |
| **Q2** coins board | `/feed?lane=coins&band=fresh` | < 15 ms | same, plus two `LATERAL`s — a coin with no trades yet must still appear (pre-rank zone, every numeric `··`), and a coin with no story is 85–95% of that band. An inner join to either would delete the modal row. |
| **Q3** story page | `/story/[id]` | < 25 ms, one round trip | `story_pkey`, `coin_match_story_idx`, `post_story_views_idx`, `story_momentum_recent_idx`. Discussion is a **second** query on its own Suspense boundary so a slow comment scan never blocks the evidence. |
| **Q4** the record | `/search?chip=finished`, `/ops/earliness` | < 30 ms | `story_outcome_recent_idx`. Default filter is All, asserted in CI. |

Two details in Q2 and Q3 are product decisions living in SQL. Q2 applies the Fresh
six-hour ceiling as a `WHERE` clause — `c.minted_at IS NULL OR c.minted_at > now() - interval '6 hours'` —
because it depends on `now()` and a generated column cannot. Q3 sorts a story's
matches by `verdict` then `mint_time ASC`, *"the first one made from this story"*;
sorting by market cap systematically demotes the freshly minted derived coin, which is
the coin the pipeline exists to find.

Q3 also carries the staleness readout, and its shape matters:

```sql
(SELECT jsonb_object_agg(e.stage, jsonb_build_object(
          'last_output_at', r.last_output_at,
          'zero_streak', COALESCE(r.zero_streak, 999)))
   FROM public.ops_stage_expected e
   LEFT JOIN LATERAL (
     SELECT max(sr.finished_at) FILTER (WHERE sr.rows_out > 0) AS last_output_at,
            count(*) FILTER (WHERE sr.rows_out = 0)            AS zero_streak
       FROM public.ops_stage_run sr
      WHERE sr.stage = e.stage AND sr.started_at > now() - interval '2 hours') r ON true
  WHERE e.enabled) AS pipeline_health
```

`max(ran_at)` alone reads `live` during the exact outage that has actually happened.
The `FILTER (WHERE rows_out > 0)` is the work-done check, and the `LEFT JOIN` against
a fixed expected-stage list is what makes absence breach as loudly as zero.

---

## 4. MIGRATIONS

The old build had 24 loose `schema-*.sql` files applied by 12 ad-hoc scripts with no
record of what was live. Everything below exists to make that state unreachable.

### 4.1 The files, in order

| # | File | Contents |
|---|---|---|
| 0000 | `migration_framework.sql` | `insidor.schema_migrations`, `migration_begin` (advisory lock + ordering + drift), `migration_end`, `add_constraint`, `add_column`, `create_enum` |
| 0001 | `extensions_and_types.sql` | pgcrypto, pg_trgm, vector, btree_gin; pg_cron/pg_net optional; 21 enums; `freeze_columns`, `reject_future_timestamp`, `touch_updated_at`, `base58_runs` |
| 0002 | `story_and_post.sql` | `story`, `post`, `post_snapshot`, `post_heat`, `post_meme_score`, `post_embedding`, `story_momentum`, `platform_norm`, `author_roster` |
| 0003 | `coin.sql` | `coin`, `coin_snapshot`, `coin_mcap_series`, `coin_safety`, `coin_image_embedding`, `creator_stat` |
| 0004 | `matching.sql` | `story_ticker`, `coin_match`, `match_label`, `confirmable()`, the recount trigger |
| 0005 | `clocks_and_outcome.sql` | `ct_mention`, `sensor_heartbeat`, `sensor_gap`, `story_clock`, `story_outcome` |
| 0006 | `board.sql` | `board_state`, `board_tick` (RANGE-partitioned by day, 48h retention), `board_gate_count` |
| 0007 | `user_and_social.sql` | `app_user`, `follow`, `holding`, `comment`, `comment_report`, `notification`, `push_subscription`, `notification_prefs` |
| 0008 | `trading_and_launch.sql` | `trade`, `launch`, `namer_run`, `fee_share` |
| 0009 | `search.sql` | `insidor.text_array_to_string()`, generated `search_doc` tsvectors, GIN, trgm, HNSW, `search_log`, `eligible_story` |
| 0010 | `ops.sql` | `ops_stage_run`, `ops_stage_expected`, `ops_event`, `ops_sli_sample`, `ops_funnel`, `ops_budget_cap`, `ops_spend` |
| 0011 | `rls.sql` | RLS on all 46 tables, policies, column-level grants |
| 0012 | `views.sql` | `coin_tradeable()`, `story_cta_v`, `record_summary_mv` |
| 0013 | `realtime.sql` | replica identity DEFAULT, comment and coin_match broadcast triggers |
| 0014 | `environment_and_budget.sql` | `ops_environment` singleton, `reserve_units()`, `audit_ddl()` event trigger, the `migrator` role |
| 0015 | `roles_bootstrap.sql` | `anon` / `authenticated` / `service_role` creation guards for non-Supabase Postgres |

Version numbers are **ordinals, not timestamps**. Concurrent PRs adding `0016` collide
in git rather than silently interleaving, which is the correct place for that argument
to happen.

### 4.2 The framework

Every file from `0001` on follows the same contract:

```sql
BEGIN;
SELECT insidor.migration_begin('0007','user_and_social','@@CHECKSUM_0007@@');
  -- ... DDL, every statement idempotent ...
SELECT insidor.migration_end('0007','user_and_social','@@CHECKSUM_0007@@');
COMMIT;
```

```sql
-- 0000_migration_framework.sql
CREATE SCHEMA IF NOT EXISTS insidor;

CREATE TABLE IF NOT EXISTS insidor.schema_migrations (
  version     text        PRIMARY KEY,
  name        text        NOT NULL,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text        NOT NULL DEFAULT current_user,
  duration_ms integer,
  CONSTRAINT schema_migrations_version_fmt CHECK (version ~ '^[0-9]{4}$')
);
COMMENT ON TABLE insidor.schema_migrations IS
  'The record of what is applied to this database. If a version is not here, it is not applied.';

CREATE TABLE IF NOT EXISTS insidor.migration_run (
  version text PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION insidor.migration_begin(p_version text, p_name text, p_checksum text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_existing insidor.schema_migrations%ROWTYPE; v_ahead text;
BEGIN
  -- SINGLETON: released automatically at COMMIT/ROLLBACK. Two deploys racing
  -- serialise instead of interleaving DDL.
  PERFORM pg_advisory_xact_lock(hashtext('insidor.schema_migrations'));
  SELECT * INTO v_existing FROM insidor.schema_migrations WHERE version = p_version;
  IF FOUND THEN
    -- DRIFT
    IF v_existing.checksum <> p_checksum THEN
      RAISE EXCEPTION
        'migration % (%) was applied at % with checksum %, but the file on disk now hashes to %. '
        'Migrations are immutable once applied. Write a new migration.',
        p_version, v_existing.name, v_existing.applied_at, v_existing.checksum, p_checksum;
    END IF;
    INSERT INTO insidor.migration_run(version) VALUES (p_version)
      ON CONFLICT (version) DO UPDATE SET started_at = clock_timestamp();
    RETURN true;   -- already applied; the DDL below must be a no-op
  END IF;
  -- ORDERING
  SELECT version INTO v_ahead FROM insidor.schema_migrations
   WHERE version > p_version ORDER BY version LIMIT 1;
  IF v_ahead IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to apply % after %: migrations must be applied in ascending order',
      p_version, v_ahead;
  END IF;
  INSERT INTO insidor.migration_run(version) VALUES (p_version)
    ON CONFLICT (version) DO UPDATE SET started_at = clock_timestamp();
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION insidor.migration_end(p_version text, p_name text, p_checksum text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_started timestamptz;
BEGIN
  SELECT started_at INTO v_started FROM insidor.migration_run WHERE version = p_version;
  INSERT INTO insidor.schema_migrations(version, name, checksum, duration_ms)
  VALUES (p_version, p_name, p_checksum,
    GREATEST(0, (EXTRACT(epoch FROM clock_timestamp() - COALESCE(v_started, clock_timestamp())) * 1000)::int))
  ON CONFLICT (version) DO NOTHING;
  DELETE FROM insidor.migration_run WHERE version = p_version;
END $$;

-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS, and a schema this
-- constraint-heavy needs one or every file is 40% DO-block noise.
CREATE OR REPLACE FUNCTION insidor.add_constraint(p_table regclass, p_name text, p_def text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = p_table AND conname = p_name) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', p_table::text, p_name, p_def);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION insidor.add_column(p_table regclass, p_name text, p_def text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS %I %s', p_table::text, p_name, p_def);
END $$;

CREATE OR REPLACE FUNCTION insidor.create_enum(p_name text, p_values text[])
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = p_name) THEN
    EXECUTE format('CREATE TYPE public.%I AS ENUM (%s)',
      p_name, (SELECT string_agg(quote_literal(v), ', ') FROM unnest(p_values) v));
  END IF;
END $$;

INSERT INTO insidor.schema_migrations(version, name, checksum)
VALUES ('0000', 'migration_framework', 'bootstrap') ON CONFLICT (version) DO NOTHING;
```

### 4.3 The applier

`scripts/migrate.mjs` is the **only** way migrations reach any database — local,
preview, staging or production. Node ESM, `pg` only, no CLI, no dashboard.

```js
#!/usr/bin/env node
// node scripts/migrate.mjs status | up | verify
//
// Checksums: each file contains a literal `@@CHECKSUM_NNNN@@` placeholder. The
// hash is taken over the file WITH the placeholder intact, then substituted in
// before execution. So the recorded checksum is a stable hash of the source
// text, and editing one character of an applied migration makes
// insidor.migration_begin() refuse it.

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const DIR = path.resolve('supabase/migrations');
const RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

async function load() {
  const files = (await readdir(DIR)).filter((f) => RE.test(f)).sort();
  return Promise.all(files.map(async (file) => {
    const [, version, name] = file.match(RE);
    const raw = await readFile(path.join(DIR, file), 'utf8');
    const checksum = createHash('sha256').update(raw).digest('hex').slice(0, 32);
    const sql = raw.replaceAll(`@@CHECKSUM_${version}@@`, checksum);
    if (version !== '0000' && !raw.includes(`@@CHECKSUM_${version}@@`)) {
      throw new Error(`${file}: missing @@CHECKSUM_${version}@@ placeholder`);
    }
    return { file, version, name, checksum, sql };
  }));
}

async function main() {
  const cmd = process.argv[2] ?? 'status';
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const migrations = await load();
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const has = await client.query(
    `select to_regclass('insidor.schema_migrations') is not null as ok`);
  const applied = has.rows[0].ok
    ? (await client.query('select version, checksum from insidor.schema_migrations')).rows
    : [];
  const appliedBy = new Map(applied.map((r) => [r.version, r.checksum]));

  if (cmd === 'status') {
    for (const m of migrations) {
      const a = appliedBy.get(m.version);
      const state = !a ? 'PENDING' : a === m.checksum || a === 'bootstrap' ? 'applied' : 'DRIFT';
      console.log(`${m.version}  ${state.padEnd(8)}  ${m.name}`);
    }
    await client.end();
    return;
  }

  if (cmd !== 'up' && cmd !== 'verify') throw new Error(`unknown command: ${cmd}`);

  for (const m of migrations) {
    const already = appliedBy.has(m.version);
    if (already && cmd === 'up') { console.log(`${m.version}  skip     ${m.name}`); continue; }
    // `verify` deliberately re-runs applied migrations: every statement is
    // idempotent, so a second pass must be a no-op. If it is not, the DDL is
    // wrong and CI fails here rather than during a production deploy.
    process.stdout.write(`${m.version}  apply    ${m.name} ... `);
    const t0 = Date.now();
    await client.query(m.sql);
    console.log(`${Date.now() - t0}ms`);
  }
  await client.end();
}

main().catch((e) => { console.error(`\nmigration failed: ${e.message}`); process.exit(1); });
```

**Do not let the Supabase CLI apply these files, anywhere, ever.** Two independent
incompatibilities make it silently wrong. First, the CLI executes the raw bytes, so it
records `checksum = '@@CHECKSUM_0013@@'` in its own ledger — after which
`scripts/migrate.mjs` computes the real sha256, mismatches, and the drift guard bricks
the database permanently against the project's own tool. Second, the CLI's batch
apply is implicitly transactional and appends its ledger INSERT to the same batch; our
inner `COMMIT;` closes that transaction early, so a failure after it leaves committed
DDL with **no row in either ledger** — a half-migrated database that neither
`supabase migration list` nor `migrate.mjs status` reports as broken.

Consequently Supabase Branching's automatic Migrate step is **disabled**. Branch
databases are migrated by the workflow, calling `migrate.mjs` against the branch's
`DATABASE_URL`. One applier, one ledger.

(The CLI's filename regex is `^([0-9]+)_(.*)\.sql$`, so `0001_…` is accepted. Do not
rename these files to timestamps; that is not the incompatibility.)

### 4.4 Authoring rules, enforced by `scripts/check-migrations.mjs`

Blocking in CI. Every rule corresponds to something the old build broke.

1. **Filename** is `NNNN_snake_case.sql`, four digits.
2. **Immutable once merged.** The script diffs each file against `origin/main`; a
   changed byte in an applied migration fails the PR. Deleting one fails too.
3. **Strictly increasing.** A new version must exceed every merged version.
4. **Required header**: `@phase`, `@lock`, `@ticket`, `@summary`.
5. **Every statement idempotent** — `CREATE TABLE IF NOT EXISTS`, `add_constraint`,
   `add_column`, `create_enum`. `migrate.mjs verify` re-runs the whole set and it must
   be a no-op.
6. **`ADD COLUMN … NOT NULL` without `DEFAULT` is rejected** outside a `contract`
   phase. It breaks every INSERT from the code currently deployed the instant it
   lands.
7. **`ALTER TABLE … ADD CONSTRAINT` must be `NOT VALID`**, with `VALIDATE CONSTRAINT`
   in a later migration, unless `@lock: takes-access-exclusive` is set deliberately.
   Inline CHECKs inside `CREATE TABLE` are unaffected.
8. **`CREATE INDEX` on a populated table** lives in `supabase/migrations-concurrent/`
   and uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. Those files run in autocommit
   and carry no `BEGIN`/`COMMIT`.
9. **Every transactional file opens with the three guards:**

```sql
set local lock_timeout = '3s';        -- an unbounded ALTER queued behind a long
set local statement_timeout = '60s';  -- read stalls every writer
set local app.migration = 'on';       -- or ops.audit_ddl() pages the on-call
```

10. **A `@phase: contract` PR may contain nothing outside `supabase/` and `docs/`.**
    This is what makes "drop the column one release after the code stopped reading it"
    mechanical rather than remembered.

```sql
-- supabase/migrations/_TEMPLATE.sql
-- @phase: expand          # expand | backfill | contract
-- @lock: safe             # safe | takes-access-exclusive
-- @ticket: INS-000
-- @summary: one line, present tense, what this adds.
--
-- Reviewer checklist (the linter enforces 1-5; a human must do 6-8):
--   1. Version is greater than every merged migration.
--   2. Every statement is idempotent; re-running is a no-op.
--   3. New columns nullable or defaulted.
--   4. ADD CONSTRAINT is NOT VALID; VALIDATE ships later.
--   5. Indexes on populated tables live in migrations-concurrent/.
--   6. Does the code currently deployed to production still work after this?
--   7. Can this be a CHECK constraint or a generated column instead of a rule
--      someone remembers? Product rules belong in the schema.
--   8. If this touches coin_match, coinability_tier, promoted_at or anything the
--      primary-action resolver reads: has the frozen regression set been re-run?

BEGIN;
SELECT insidor.migration_begin('00NN', 'name', '@@CHECKSUM_00NN@@');

set local lock_timeout = '3s';
set local statement_timeout = '60s';
set local app.migration = 'on';

-- your DDL here

SELECT insidor.migration_end('00NN', 'name', '@@CHECKSUM_00NN@@');
COMMIT;
```

### 4.5 Forward-only, expand → backfill → contract

There are **no down migrations**. A down migration is written once, never tested, and
does not fix the failure that actually matters — a migration that already ran and
corrupted data. What exists instead: expand-only phases enforced by the linter, a
pre-migration dump retained ninety days, and PITR marked in the runbook as
founder-authorised, because restoring it deletes real trades.

A breaking change — say `coin_match.ticker` moving to `coin.symbol` — takes five
releases:

| Release | Migration | Apps |
|---|---|---|
| R1 | `@phase: expand` — add the new column nullable; add an `AFTER INSERT/UPDATE` trigger mirroring writes from the old column | unchanged |
| R2 | none | both apps **dual-write**; readers prefer new, fall back to old |
| R3 | `@phase: backfill` — fill history in batches, resumable and idempotent; add `CHECK … NOT VALID` | unchanged |
| R4 | `@phase: expand` — `VALIDATE CONSTRAINT` | both apps read **new only**; the fallback is deleted |
| R5 | `@phase: contract` — drop the trigger, drop the old column | unchanged |

Never reuse a name with a new meaning. That is the one change whose failure mode is
silent wrongness rather than an error.

### 4.6 Out-of-band DDL cannot hide

Four mechanisms, in the order they fire:

1. **`ops.audit_ddl()`**, an event trigger on `ddl_command_end`, records every DDL
   statement and flags any not carrying `app.migration = 'on'`. A `pg_cron` job posts
   flagged rows to Slack through `pg_net` every five minutes. It survives total loss
   of the app platform.
2. **Only `migrator` can do DDL.** `CREATE` on `public` and `insidor` is revoked from
   `public`, `anon`, `authenticated` and `service_role`.
3. **The credential does not exist outside the gate.** `MIGRATOR_DATABASE_URL` for
   production is a GitHub *Environment* secret on `production`, which has required
   reviewers and a wait timer. No human holds it.
4. **And the next PR fails.** CI builds a database from scratch and diffs it against
   `supabase/schema.sql` — the committed dump of what production actually runs,
   refreshed by the release workflow after every production migration. Hand-run DDL
   makes that diff non-empty and blocks everyone until it is reconciled by a real
   migration.

---

## 5. AUTH AND SECURITY

### 5.1 The write model, stated once

**The browser writes nothing.** Every write goes through a server route holding the
service role. Three reasons, in order of weight:

1. **There is no reliable `authenticated` principal.** Supabase inspects the literal
   `role` claim in a JWT to choose a Postgres role, and falls back to `anon` when it
   is absent. Privy's access token has a closed claim set — `sid`, `sub`, `iss`,
   `aud`, `iat`, `exp` — with no claim-injection surface. A Privy JWT presented
   directly to PostgREST runs as `anon`.
2. **The highest-volume follower class is anonymous device follows**, which have no
   principal at all. No policy could distinguish an owner from anyone who guesses a
   `device_id`.
3. **Every write has an invariant needing a server-side READ.** The comment stamp
   needs a Helius call. The launch needs a fresh `count(confirmed) = 0` at submit. The
   trade needs the SOL price captured server-side.

So the policies in `0011` are almost entirely SELECT policies. They exist to make the
coinability tier and the moderation state unbypassable on the **read** path — the half
a browser can actually reach.

### 5.2 The end-to-end flow

```
1.  Browser loads. No session required. `anon` reads the board, a story, a coin.
2.  Connect wallet -> Privy embedded or external. Privy issues an access token
    (~1h) whose `sub` is a Privy DID: `did:privy:cl...`.
3.  The browser calls a route handler with `Authorization: Bearer <privy token>`.
4.  The route verifies it with @privy-io/node against
    https://auth.privy.io/api/v1/apps/<app-id>/jwks.json
    — pass jwks_url, NOT oidc_issuer_url; auth.privy.io has no
    /.well-known/openid-configuration.
5.  The route resolves the DID to app_user.id, upserting on first sight.
6.  The route constructs a SERVICE-ROLE Supabase client from env — never from the
    forwarded request header — and performs the write with an explicit
    `user_id = <resolved uuid>` predicate written by hand.
7.  Realtime frames reach the browser over one ref-counted socket. A 50-minute
    loop re-mints the token and calls supabase.realtime.setAuth().
```

Step 6 has a trap worth naming explicitly, because it is the mistake that will be
made: **never construct the Supabase client from a forwarded `Authorization` header.**
Supabase's documentation is unambiguous — *"Supabase will adhere to the RLS policy of
the signed-in user, even if the client library is initialized with a Service Key."*
Since every write route already verifies a Privy token, forwarding that header is the
natural thing to type, and it silently demotes the route off the service role.

Step 7 is the single most likely launch-day bug. Realtime caches channel authorisation
for the connection lifetime and Privy tokens live about an hour, so without the
refresh loop every user silently drops off the live feed after sixty minutes. It ships
in the **same release** as the first authenticated channel.

### 5.3 RLS — the read path

```sql
-- 0015_roles_bootstrap.sql runs FIRST on non-Supabase Postgres. Without it the
-- GRANTs below abort with `role "anon" does not exist`, and the whole migration
-- set is undeployable to a plain container — which is where CI runs.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
    THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
    THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
    THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
END $$;
```

```sql
-- 0011_rls.sql

-- The JWT subject, resolved to our own primary key.
--
-- THIS IS THE LOAD-BEARING DETAIL. Privy's `sub` is a DID (`did:privy:...`) and
-- app_user.id is a uuid. A policy written `user_id::text = ... ->> 'sub'` compiles,
-- runs, and evaluates FALSE forever — returning HTTP 200 with ZERO ROWS, which
-- renders a portfolio page reading "$0" for a user who is holding. It is the
-- silent-wrongness shape this whole document exists to prevent, so the DID is
-- resolved through app_user, which is correct under a Privy JWT AND under a
-- server-minted Supabase JWT.
--
-- nullif(...) is not decoration: PostgREST sets request.jwt.claims to the EMPTY
-- STRING on some paths, and ''::jsonb raises inside a policy, failing the entire
-- query rather than the row.
CREATE OR REPLACE FUNCTION public.current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT u.id FROM public.app_user u
   WHERE u.privy_did = (
     nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
   )
$$;

-- Baseline: nothing readable or writable until named.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'story','post','post_snapshot','post_heat','post_meme_score','post_embedding',
    'story_momentum','platform_norm','author_roster','coin','coin_snapshot',
    'coin_mcap_series','coin_safety','coin_image_embedding','creator_stat',
    'story_ticker','coin_match','match_label','ct_mention','sensor_heartbeat',
    'sensor_gap','story_clock','story_outcome','board_state','board_tick',
    'board_gate_count','app_user','follow','holding','comment','comment_report',
    'notification','push_subscription','notification_prefs','trade','launch',
    'namer_run','fee_share','search_log','ops_stage_run','ops_stage_expected',
    'ops_event','ops_sli_sample','ops_funnel','ops_budget_cap','ops_spend'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- The coinability tier is enforced HERE. A tier-`never` story is not filtered out
-- of a query; it is unreadable. "Absent entirely — no row, no count, no gap, no
-- trace" is a policy, not a WHERE clause someone can forget.
GRANT SELECT ON public.story TO anon, authenticated;
CREATE POLICY story_public_read ON public.story FOR SELECT TO anon, authenticated
  USING (display_eligible);
CREATE POLICY story_merged_redirect_read ON public.story FOR SELECT TO anon, authenticated
  USING (status = 'merged' AND coinability_tier <> 'never');   -- 301, never 404

-- Tables whose visibility follows their story.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['post','story_ticker','story_clock','story_outcome','story_momentum'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated
        USING (EXISTS (SELECT 1 FROM public.story s
                        WHERE s.id = %I.story_id AND s.display_eligible))
    $f$, t || '_public_read', t, t);
  END LOOP;
END $$;

-- Coins are public unconditionally: a coin exists on Solana whether or not we like
-- the story it came from, and a pasted contract address must resolve to something.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coin','coin_snapshot','coin_safety','coin_mcap_series',
                           'creator_stat','platform_norm','board_state',
                           'board_gate_count','sensor_heartbeat','sensor_gap'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)',
                   t || '_public_read', t);
  END LOOP;
END $$;

-- ===========================================================================
-- coin_match: public read, but NOT of the score. The numeric score is stored and
-- never sent to the client — not in a tooltip, not in a data attribute, not in an
-- API response. A COLUMN-LEVEL GRANT is the only version of that rule that
-- survives someone writing `select *`. A user shown "73%" beside a Buy button
-- does their own thresholding and the abstain band stops functioning.
-- ===========================================================================
CREATE POLICY coin_match_public_read ON public.coin_match FOR SELECT TO anon, authenticated
  USING (retracted_at IS NULL
         AND EXISTS (SELECT 1 FROM public.story s
                      WHERE s.id = coin_match.story_id AND s.display_eligible));
REVOKE SELECT ON public.coin_match FROM anon, authenticated;
GRANT SELECT (id, story_id, mint, verdict, relation, ticker, name, ticker_source,
              mint_time, earliest_post_at, delta_min, channels_ran, strong_channels,
              evidence_public, matched_at)
  ON public.coin_match TO anon, authenticated;
-- Withheld: score, s_mint_in_post, s_img, s_text, s_tick, s_social, time_prior,
--           market_plausibility, evidence, matcher_version.

-- ct_mention: the proof surface. Handle, timestamp and permalink are public; they
-- belong to somebody else and that is the point.
GRANT SELECT (id, story_id, mint, handle, posted_at, permalink, matched_on)
  ON public.ct_mention TO anon, authenticated;
CREATE POLICY ct_mention_public_read ON public.ct_mention FOR SELECT TO anon, authenticated USING (true);

-- comment: visible rows are public; a held or blocked comment is visible to its
-- author ONLY. Everyone else sees nothing — not a placeholder, nothing.
GRANT SELECT ON public.comment TO anon, authenticated;
CREATE POLICY comment_public_read ON public.comment FOR SELECT TO anon, authenticated
  USING (status = 'visible'
         AND EXISTS (SELECT 1 FROM public.story s
                      WHERE s.id = comment.story_id AND s.display_eligible));
CREATE POLICY comment_author_read ON public.comment FOR SELECT TO authenticated
  USING (user_id = public.current_app_user());

-- Owner-scoped reads.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holding','trade','notification','notification_prefs',
                           'push_subscription','follow'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (user_id = public.current_app_user())
    $f$, t || '_owner_read', t);
  END LOOP;
END $$;

-- NEVER READABLE BY A BROWSER, and why:
--   post_snapshot, post_heat, post_meme_score, post_embedding  raw sensor data and
--                    scoring internals; the board reads board_state
--   coin_image_embedding, match_label, author_roster            model internals
--   app_user, launch, namer_run, fee_share, search_log          operational
--   ops_*                                DID allowlist; /ops 404s otherwise
--   board_tick                173k rows/day; the rail is pushed, not queried
```

`launch`, `comment` and `trade` INSERT are deliberately **not** granted even to
`authenticated`. The comment position stamp requires a chain read; the launch requires
a fresh confirmed-count at submit; the trade requires a server-captured SOL price. A
direct client insert would produce a fabricated stamp, a duplicate mint, or a wrong
cost basis. The route is the only path, permanently.

### 5.4 The service-role boundary

| Layer | Mechanism |
|---|---|
| Module | `packages/db/src/service.ts` is the only file constructing a service-role client. First line `import 'server-only'`. |
| Graph | dependency-cruiser `service-key-firewall`, `reachable: true` — transitive, so a client component importing a barrel that re-exports a repo is caught. |
| Build | `server-only` throws at build time if it reaches a `'use client'` graph. |
| Runtime | `SUPABASE_SERVICE_ROLE_KEY` is not in the `NEXT_PUBLIC_` namespace and is absent from the client env schema, so it cannot be read from a browser bundle even if imported. |
| Database | `service_role` is the only role with INSERT/UPDATE/DELETE on any table. |

### 5.5 Rate limiting, in three places because each catches something different

| Where | What | Why not one of the others |
|---|---|---|
| **Edge**, `@vercel/firewall` `checkRateLimit({ request, rateLimitKey: wallet })` | `/api/execute`, `/api/order`, `/api/launch/*` | Runs before a function holding a service key starts. Needs a `request`, which is why money endpoints are Route Handlers and never Server Actions. |
| **Database trigger** | `comment_speed_limit` — 3 per wallet per 60s | Edge limits are per-region. A global cap has to be global. |
| **Row uniqueness** | `trade.request_id UNIQUE`, `launch.mint_keypair_enc` reuse | The only mechanism that survives two tabs, two devices, and a retry spanning a deploy. A `23505` is a **409**, never a retry. |

### 5.6 Every write the browser can initiate

The complete set. Every table not named here has zero browser-initiated writes.

| # | Write | Mechanism | Validation | Authorisation |
|---|---|---|---|---|
| 1 | follow / unfollow | Route `POST /api/watchlist` | `FollowInput` | Privy token OR signed device cookie; 60/min per subject |
| 2 | claim device follows on login | Route | `ClaimInput` | Privy token; local storage cleared only on 2xx |
| 3 | post comment | Route `POST /api/comments` | `CommentInput`, body ≤ 2000 | Privy token; server runs the base58 gate (client check is a courtesy); trigger caps 3/60s; `snap_*` written server-side and frozen |
| 4 | report a wrong match | Route | `ReportInput` | Privy or device; 5/day |
| 5 | notification prefs | Route | `PrefsInput` | Privy token, owner-scoped |
| 6 | push subscription | Route `POST /api/push/subscribe` | `PushSubInput` | Privy token. A Route because the **service worker** calls it |
| 7 | search telemetry | Route `POST /api/telemetry/search` | `SearchLogInput` | anonymous; `sendBeacon`, so not an Action |
| 8 | order (quote) | Route `POST /api/order` | `OrderInput` | Privy token; referral + fee injected from env, never the client |
| 9 | execute (fill) | Route `POST /api/execute` | `ExecuteInput` | + `request_id` UNIQUE + wallet-keyed edge limit + explicit 409 |
| 10 | tx status | Route `GET /api/txstatus` | base58 signature | Privy token, owner-scoped |
| 11 | launch prepare | Route `POST /api/launch/prepare` | `LaunchPrepareInput` | Privy token; mint keypair persisted encrypted **before** the first signature |
| 12 | launch submit | Route `POST /api/launch/confirm` | `LaunchSubmitInput` | + server-side re-check of `buy_count = 0` at submit, so nobody pays to duplicate a coin the page was hiding; 3/hour per wallet |
| 13 | client resync beacon | Route `POST /api/telemetry/resync` | `ResyncInput` | anonymous; feeds the delta-divergence SLI |

Every zod schema lives in `packages/contracts/src/input/` and is imported **by both**
the client (optimistic validation) and the server (enforcement), so the two cannot
drift.

### 5.7 Server Actions vs Route Handlers

Server Action **iff all three** hold: initiated by a React event in our own tree;
mutates our Postgres and nothing else; the result is a UI change expressed by
`revalidatePath` / `revalidateTag`.

Route Handler otherwise — and **unconditionally for anything touching money**. Three
reasons that are not stylistic: Server Action ids rotate per build, so a retry
spanning a deploy is unroutable, and the retry path is precisely where a user gets
filled twice; `/api/execute` must return an explicit **409** against a unique
`request_id`, not a thrown error the client reads as generic failure; and
`checkRateLimit` needs a `request` object, which a Server Action does not have.

In practice every write in the table above is a Route Handler. Server Actions are
available and currently unused; when one appears, it appears under that rule.

### 5.8 Realtime

`0013` sets `REPLICA IDENTITY DEFAULT` on `story`, `post`, `coin` and `coin_match`,
and broadcasts through triggers calling `realtime.send()` — **never** through
`postgres_changes`. Two reasons. `postgres_changes` caps at roughly five changes per
second under RLS and forces replica identity full. And more importantly it ignores the
read-path status filter, so it would deliver a held, address-gated comment containing a
spammer's contract address **faster** than an unmoderated feed. The
`broadcast_comment()` trigger returns early unless `status = 'visible'`, so such a row
never leaves the database.

Topics are sharded from day one: `story:<id>` for comments, `coin:<story_id>` for match
promotions and retractions. The board is broadcast by the rank-commit job rather than a
trigger — change-driven, coalesced into at most one frame per 500 ms.

---

## 6. THE PIPELINE SERVICE

### 6.1 Execution model

`apps/pipeline` is a single long-lived Node process on Fly.io serving three things:
an Inngest handler, two health endpoints, and one websocket client. Two machines in
production (canary deploy), one in staging.

Scheduling is **Inngest**, not `pg_cron` and not Vercel Cron. The requirement list is
short and every item is a thing that failed before: a singleton per stage so two
machines do not double-ingest; concurrency keys; retries with backoff; and a
first-class notion of "ran and produced nothing", which is the state that went
unnoticed for two days.

```ts
// apps/pipeline/src/inngest/functions.ts — the shape every stage shares
export const resolveCoins = inngest.createFunction(
  {
    id: 'resolve-coins',
    // One at a time, globally. Two machines must not both write coin_match.
    concurrency: { limit: 1, key: '"resolve-coins"' },
    retries: 3,
  },
  { cron: '*/1 * * * *' },
  async ({ step }) => runStage('resolve-coins', step, resolveCoinsStage),
);
```

`main.ts` also holds the PumpPortal websocket, because a mint stream is not a cron
job — it is a subscription whose *silence* is the signal. It lives in the process, not
in a stage.

Boot is `docker-entrypoint.sh → node dist/preflight.js → node dist/main.js`. Preflight
does four things and exits non-zero on any failure, which means Fly's health check
never passes and the release rolls back on its own:

1. Parse the env schema (`packages/env`). No defaults, no fallbacks.
2. `assertEnvironment()` — `ops_environment.name` must equal `APP_ENV`. A production
   connection string in a laptop's `.env.local` crashes here.
3. Assert `max(version) FROM insidor.schema_migrations >= REQUIRED_SCHEMA_VERSION`. A
   build that needs an unapplied migration refuses to serve rather than throwing
   *"column does not exist"* at users.
4. Ping each vendor once and record the result in `ops_event`.

### 6.2 The stage contract

Every stage is a folder under `src/stages/` with `index.ts`, a pure `model/`, an
`io/`, and `__tests__/`. Every stage is wrapped by one function, and that wrapper is
where the observability guarantees live.

```ts
// apps/pipeline/src/lib/stage.ts
export type StageResult = {
  /** THE column that makes the output-freshness SLI work. Each stage sets it
   *  from its OWN output metric. `ingested` does not mean "output" everywhere,
   *  and two of the four workers that logged at all would page from day one if
   *  it did. rows_out = 0 with ok = true is a legal, meaningful state: the stage
   *  ran correctly and there was nothing to do. It is also what the zero-streak
   *  counter measures. */
  rowsOut: number;
  rowsIn?: number;
  apiReads?: number;
  costUsd?: number;
  detail?: Record<string, unknown>;
};

export async function runStage(
  stage: StageName,
  step: StepTools,
  fn: (ctx: StageCtx) => Promise<StageResult>,
): Promise<StageResult> {
  const startedAt = new Date();
  const runId = await openRun(stage, startedAt);   // ops_stage_run, ok = false

  try {
    const result = await fn({ db: service, budget: budgetFor(stage), log: logger(stage, runId) });
    await closeRun(runId, { ok: true, finishedAt: new Date(), ...result });
    return result;
  } catch (err) {
    const e = classify(err);                        // the taxonomy below
    await closeRun(runId, {
      ok: false, finishedAt: new Date(), rowsOut: 0,
      errorCode: e.code, errorDetail: e.detail,
    });
    if (e.retryable) throw err;                     // Inngest retries
    await opsEvent('stage_failed_permanent', 'page', stage, e);
    return { rowsOut: 0 };                          // do not retry a 402
  }
}
```

Four properties follow from that wrapper and are worth stating as guarantees:

- **A row is opened before the work starts.** A stage that is killed mid-run leaves
  `ok = false, finished_at NULL`, which the watchdog reads as a crash rather than as
  silence.
- **`rows_out` is always recorded**, including on failure, including zero.
- **The pipeline is idempotent per stage.** Every write is an upsert on a natural key
  (`post(platform, platform_post_id)`, `coin(mint)`, `coin_match(story_id, mint)`,
  `coin_snapshot(mint, captured_at)`), so a retry after a partial failure converges.
  The only non-idempotent operation in the system is PROMOTE, and `promoted_at` is
  frozen by trigger, so a second attempt is a no-op rather than a corrupted clock.
- **Nothing catches broadly.** `classify()` is total over a closed taxonomy; an
  unmatched error is `internal`, retryable, and pages.

### 6.3 The stages

| Stage | Cadence | `rows_out` means | Notes |
|---|---|---|---|
| `ingest-x` | 180 s | posts admitted | twitterapi.io at $0.00015/post; reserves budget before every call |
| `ingest-tiktok` | 600 s | posts admitted | Apify |
| `snapshot` | 60 s | snapshots written | per-post geometric grid; writes `post_snapshot` and `coin_snapshot` |
| `score` | 120 s | posts scored | the **only** LLM tier: meme score + coinability |
| `cluster` | 45 s | stories touched | embedding + centroid; writes `story`, never `promoted_at` |
| `promote` | inside cluster | stories promoted | writes `promoted_at` **exactly once**, and emits `ops_funnel.promoted` — nothing in the old repo ever emitted that counter |
| `resolve-coins` | 60 s | matches written | the matcher; 0.97 precision floor, 0.15–0.30 abstain band |
| `clocks-mint` | continuous | clock rows written | consumes the PumpPortal stream; maintains `sensor_heartbeat` |
| `clocks-ct` | 60 s | mentions written | the CT poller; maintains its own watermark |
| `rank-commit` | **20 s** | rows committed | writes `board_state`, `board_tick`, `board_gate_count`; broadcasts one coalesced frame |
| `outcomes` | nightly | stories classified | `story_outcome`; refreshes `record_summary_mv` |
| `watchdog` | 60 s | SLIs evaluated | writes `ops_sli_sample`; pings the dead-man's switch |

### 6.4 Budgets — enforced by the database, not by discipline

Ingestion costs $0.00015 per post. A cap that lives in a config file is a cap that a
loop can outrun between two reads. So the reservation *is* the increment, in one
statement, atomic under concurrency.

```sql
-- 0014_environment_and_budget.sql
CREATE TABLE IF NOT EXISTS public.ops_environment (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),  -- singleton
  name           text NOT NULL CHECK (name IN ('local','preview','staging','production')),
  network        text NOT NULL CHECK (network IN ('mainnet-beta','devnet')),
  ingest_mode    text NOT NULL CHECK (ingest_mode IN ('off','replay','live')),
  trading_mode   text NOT NULL CHECK (trading_mode IN ('off','simulate','live')),
  daily_unit_cap integer NOT NULL CHECK (daily_unit_cap >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- The dangerous combinations are unrepresentable, not merely discouraged.
  CONSTRAINT env_live_trading_is_production_only
    CHECK (trading_mode <> 'live' OR (name = 'production' AND network = 'mainnet-beta')),
  CONSTRAINT env_live_ingest_is_deployed_only
    CHECK (ingest_mode <> 'live' OR name IN ('staging','production')),
  CONSTRAINT env_local_cannot_spend
    CHECK (name <> 'local' OR (ingest_mode = 'replay' AND daily_unit_cap = 0)),
  CONSTRAINT env_preview_cannot_spend
    CHECK (name <> 'preview' OR (ingest_mode = 'off' AND daily_unit_cap = 0))
);

CREATE OR REPLACE FUNCTION public.reserve_units(
  p_vendor text, p_units integer, p_micro_usd bigint DEFAULT 0
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_cap integer; v_mode text; v_now bigint;
BEGIN
  IF p_units <= 0 THEN
    RAISE EXCEPTION 'reserve_units: p_units must be positive' USING ERRCODE = 'check_violation';
  END IF;

  SELECT daily_unit_cap, ingest_mode INTO v_cap, v_mode FROM public.ops_environment;

  IF v_mode <> 'live' THEN
    RAISE EXCEPTION
      'reserve_units called with ingest_mode=% — this environment must not spend money. '
      'Set INGEST_MODE=replay and use fixtures.', v_mode USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.ops_spend (day, vendor)
  VALUES ((now() AT TIME ZONE 'utc')::date, p_vendor)
  ON CONFLICT (day, vendor) DO NOTHING;

  -- The cap is inside the same UPDATE that increments the counter, so parallel
  -- stages cannot race past it.
  UPDATE public.ops_spend
     SET units = units + p_units, micro_usd = micro_usd + p_micro_usd
   WHERE day = (now() AT TIME ZONE 'utc')::date
     AND vendor = p_vendor
     AND units + p_units <= v_cap
  RETURNING units INTO v_now;

  RETURN v_now IS NOT NULL;   -- false => cap reached; the caller STOPS, never retries
END $$;
```

Every metered vendor call goes through `apps/pipeline/src/lib/budget.ts`, which is the
only module permitted to construct the raw fetch wrapper for a paid endpoint — enforced
by a dependency-cruiser rule, the same way the service key is. A `false` return is
`budget_exhausted`: a non-retryable error, an `ops_event` at `warn`, and a quiet board
until UTC midnight. **Never raise the cap to make the alert stop.** The usual cause is
a cadence change shipped without the matching per-cycle budget reduction, which is a
revert.

Caps: production is set by the founder; staging is 2 000 units/day (about $0.30);
preview and local are 0, and cannot be otherwise, because the CHECK constraints above
refuse.

### 6.5 The error taxonomy

Closed, exhaustive, and the discriminator for whether Inngest retries.

```ts
// apps/pipeline/src/lib/errors.ts
export type StageErrorCode =
  // --- retryable: transient, the next run probably succeeds -------------
  | 'vendor_timeout'        // no response inside the budget
  | 'vendor_5xx'            // upstream broken
  | 'vendor_429'            // rate limited; backoff, do not widen concurrency
  | 'db_conflict'           // serialisation failure / deadlock
  | 'internal'              // unclassified. Retries AND pages — silence is worse.

  // --- terminal: retrying makes it worse or costs money -----------------
  | 'budget_exhausted'      // reserve_units() returned false
  | 'vendor_402'            // payment required. Retrying spends nothing and fixes nothing.
  | 'vendor_auth'           // 401/403. A key rotated. Page.
  | 'vendor_contract'       // 200 with a shape we do not recognise — see below
  | 'constraint_violation'  // the DATABASE refused the row. This is a WIN.
  | 'schema_assert_failed'; // REQUIRED_SCHEMA_VERSION not applied

export type Classified = {
  code: StageErrorCode;
  retryable: boolean;
  /** page immediately, or accumulate into an SLI */
  severity: 'info' | 'warn' | 'page';
  detail: string;
};
```

Three entries carry more weight than the rest.

**`vendor_contract`** is a 200 response whose shape we do not recognise. It exists
because the worst vendor failure is not an outage — it is an endpoint that quietly
stops returning a field, and a caller that reads `?? null` and then treats null as
"fine". Every adapter parses its response through a zod schema; a parse failure is
`vendor_contract`, terminal, and pages. It never degrades to a default.

**`constraint_violation`** is logged at `warn`, not `page`, and it is a **success**:
the schema refused a row the pipeline should not have built. It carries the constraint
name straight into `ops_stage_run.error_detail`, so `coin_match_confirmed_requires_evidence`
appearing in the log is a matcher bug found before a user saw a Buy button. A rising
rate is a matcher regression; a flat low rate is the system working.

**`internal`** is retryable *and* pages. An unclassified error is a gap in the
taxonomy, and a gap that fails quietly is exactly how two days of silence happened.

### 6.6 The websocket clock

Two prospective clocks, symmetric by construction because they share one table and one
enum. Both are **prospective**: they record what a sensor had scanned *before* any
lead time is computed from it, so a claim can never be measured against a sensor that
had not caught up.

- **Clock A — the mint stream.** A PumpPortal websocket subscribed to token creations.
  Every event upserts `coin` with `minted_at_source = 'pumpportal_create'`.
- **Clock B — the CT poller.** A 60-second poll over a curated handle list, writing
  `ct_mention` with a permalink, because the proof must travel with the claim.

Each maintains one row in `sensor_heartbeat`:

```ts
// Two distinct facts, and conflating them is the bug this shape prevents.
//   last_beat_at     — "the sensor is alive"
//   observed_through — "the sensor has scanned up to HERE"
// A websocket that reconnects and receives nothing has a fresh last_beat_at and
// a stale watermark. Only the watermark may be used to justify a lead time,
// which is why story_clock requires both watermarks >= promoted_at.
await db.from('sensor_heartbeat').upsert({
  sensor: 'mint_stream',
  last_beat_at: now,
  observed_through: lastEventTime ?? previousWatermark,
  connected_at: socketConnectedAt,
});
```

Reconnect handling is where the honesty lives. On `close`, the process opens a
`sensor_gap` row **before** attempting to reconnect. On successful reconnect it closes
the gap with `ended_at`. Any story promoted inside an open gap is marked
`unmeasurable` with `unmeasurable_sensor` and `unmeasurable_gap_id`, and its lead time
is suppressed everywhere — not estimated, not backfilled, suppressed. Backoff is
exponential with jitter to 30 s, and a gap open longer than five minutes pages.

Every write to `sensor_gap` happens **before** any alert fires, so the ledger is
complete even if alerting is down.

### 6.7 The rank-commit clock

`rank-commit` runs every 20 seconds and is the only writer of `board_state`. Each
commit:

1. reads eligible entities and computes heat;
2. applies rank stability — `EPS_SWAP = 0.08`, two ticks to enter, three to leave,
   a 90-second dwell (`pinned_until`), `MAX_MOVE = 5` ranks per tick, and an escape
   hatch that skips the dwell for a genuine breakout and flags it `NEW`;
3. writes `board_state` and one `board_tick` row per rank;
4. writes `board_gate_count` with `eligible`, `shown` and a `by_reason` breakdown;
5. increments `tick_seq` and broadcasts one frame.

`tick_seq` is a monotonic watermark and it is what makes hydration and the live stream
provably consistent. The RSC snapshot returns rows **and** `tick_seq` from one
statement (a separate `select max(tick_seq)` could observe a commit the row query did
not, and the client would silently drop the first real frame). The client applies a
frame iff `frame.tickSeq > watermark`; on a gap it calls a bounded catch-up route
rather than re-fetching the board.

**Values update live; positions do not.** Rows live in a `Map<id, Row>` updated on
every frame; only the ordering array is gated on the tick, and it is frozen while the
pointer is over the board.

The `p95` heat denominator rebases hourly, so a row can move 61 → 88 with nothing
changing underneath. That commit writes `event = 'rebased'` and the client suppresses
the tick animation for that frame.

### 6.8 Observability

**Ten SLIs**, evaluated every 60 s by the watchdog into `ops_sli_sample`. The design
principle is that **absence and zero must both breach**, because the outage that
happened produced neither an error nor a metric.

| # | SLI | Definition | Warn / Page |
|---|---|---|---|
| 1 | `ingest_freshness` | `now() − max(first_seen_at)` on `post` | 15 m / 30 m |
| 2 | `stage_output_stall` | consecutive `ops_stage_run` rows with `rows_out = 0`, **LEFT JOINed from `ops_stage_expected`** so a dead worker scores 999 on absence | 3 / 5 |
| 3 | `funnel_yield` | `promoted / arrived` over 1 h | < 0.5% / < 0.1% |
| 4 | `board_render_fallback` | fraction of board reads served from the polling fallback | 2% / 10% |
| 5 | `match_abstain_rate` | `unsure / (confirmed + unsure)` | outside 0.15–0.30 |
| 6 | `sensor_gap_open` | seconds of the longest open `sensor_gap` | 120 s / 300 s |
| 7 | `budget_burn` | `units / daily_unit_cap`, projected to UTC midnight | 80% / 100% |
| 8 | `unclassified_outcomes` | `count(story_outcome IS NULL AND promoted_at < now() − 72h)` | 1 / 10 |
| 9 | `e2e_lead_time_p50` | median `lead_time_min` over 24 h, measurable stories only | < 5 m / < 0 m |
| 10 | `delta_divergence` | client resync beacons per 1 000 sessions | 2% / 5% |

Three implementation details that are the difference between this working and looking
like it works:

- **The work-done check.** Freshness is `max(finished_at) FILTER (WHERE rows_out > 0)`,
  never `max(ran_at)`. The latter reads `live` during the exact outage that happened.
- **`ops_sli_sample` has `CHECK ((value IS NULL) = (state = 'unknown'))`.** An SLI that
  cannot be evaluated is `unknown`, which is a distinct colour on `/ops` and is never
  green. A green board painted by an SLI querying a nonexistent column is how the
  original outage stayed invisible.
- **A dead-man's switch.** The watchdog pings healthchecks.io after each successful
  evaluation. If the watchdog itself dies, healthchecks.io alerts. Nothing inside the
  system can report that the system is not running.

Alerts route to `#insidor-page` at `page` severity and `#insidor-ops` at `warn`.
`/ops` reads `ops_sli_sample` directly and is behind a Privy DID allowlist; it 404s
for everyone else, so the allowlist is not a discoverable surface.

Logging is structured JSON on stdout, one line per stage run plus one per vendor call,
carrying `stage`, `run_id`, `vendor`, `units`, `cost_usd`, `error_code`. Fly ships it;
nothing is parsed for correctness — the database rows are the record, and the logs are
for reading during an incident.

---

## 7. CONTRACTS

`packages/contracts` is a leaf with one runtime dependency. It holds three kinds of
thing: **generated** row types, **hand-written** domain types that encode rules the
database cannot express, and **agreed** functions that both apps must implement
identically or the product lies.

### 7.1 Row types are generated, never hand-written

Hand-written types "tested against the schema" sound rigorous and fail silently: the
test asserts what you remembered to assert, and the column you forgot is the one that
drifts. `supabase gen types typescript` runs in CI against a database built from the
migrations, and the committed output must be byte-identical.

`packages/contracts/src/rows.ts` is the only file that imports `generated/`. Everything
else imports named row aliases from it, so a column rename breaks the build in exactly
one file.

### 7.2 An unconfirmed Buy is a compile error

TypeScript is structural, so a discriminated union alone is not enough — an object with
the right field names satisfies `ConfirmedCoin` whatever produced it. Two devices fix
that, and a third makes it survive contact with real data.

```ts
// packages/contracts/src/match.ts
import type { Instant, MintAddress, Ticker } from './ids';
import type { SafetyGate } from './enums';
import type { CoinMatchRow, CoinSafetyRow } from './rows';

/* ------------------------------------------------------------------ *
 * Nominal brands. DECLARED, never exported as values. A module that does
 * not live in this file cannot write these keys, so the only way to obtain
 * a ConfirmedCoin or a BuyableCoin is to call a constructor below.
 * ------------------------------------------------------------------ */
declare const IDENTITY_CONFIRMED: unique symbol;
declare const SAFE_TO_BUY: unique symbol;

/** Identity is settled: this mint is the coin for this story.
 *  Says NOTHING about whether it is safe to buy. */
export type ConfirmedCoin = {
  readonly [IDENTITY_CONFIRMED]: true;
  readonly storyId: string;
  readonly mint: MintAddress;
  readonly ticker: Ticker;      // denormalised at match time, so the button
  readonly coinName: string;    // never reads a table enrichment truncates
  readonly mintTime: Instant;
  readonly relation: 'derived' | 'adopted';
  readonly channels: EvidenceChannels;
};

/** Identity AND every hard safety gate passed, on a check fresh enough to
 *  mean something. The ONLY type <BuyButton> accepts. */
export type BuyableCoin = ConfirmedCoin & {
  readonly [SAFE_TO_BUY]: true;
  readonly gatesCheckedAt: Instant;
};

/** Field names are deliberately NOT mint/ticker. If this shape were
 *  { mint, ticker, … } a spread or a widened literal would satisfy
 *  ConfirmedCoin minus the brand, leaving exactly one cast between an
 *  abstained match and a Buy button. */
export type UnsureCandidate = {
  readonly storyId: string;
  readonly candidateMint: MintAddress;
  readonly candidateTicker: Ticker | null;
  readonly channels: EvidenceChannels;
  readonly channelsRun: number;   // the denominator is the channels that RAN
};

/** Categorical only. The numeric score is not granted to anon at the database
 *  level and is absent from CoinMatchRow, so it cannot be represented here
 *  even by mistake. 'not_checked' is distinct from 'weak': a channel that did
 *  not run must never read as a failed check. */
export type ChannelState = 'strong' | 'weak' | 'not_checked';
export type EvidenceChannels = {
  readonly img: ChannelState;
  readonly text: ChannelState;
  readonly tick: ChannelState;
  readonly mintInPost: ChannelState;
  readonly social: ChannelState;
};

export type CoinMatch =
  | { readonly kind: 'confirmed'; readonly coin: ConfirmedCoin }
  | { readonly kind: 'unsure'; readonly candidate: UnsureCandidate }
  | { readonly kind: 'retracted'; readonly candidateMint: MintAddress; readonly at: Instant };

export type SafetyVerdict =
  | { readonly pass: true; readonly checkedAt: Instant }
  | { readonly pass: false; readonly failingGate: SafetyGate; readonly checkedAt: Instant }
  | { readonly pass: 'unknown'; readonly reason: 'never_checked' | 'stale' };

/* ------------------------------------------------------------------ *
 * The only two constructors in the codebase. Both take a PARSED row —
 * see §7.4; the parse is the real boundary and the brand only guarantees
 * that no other path exists.
 * ------------------------------------------------------------------ */

/** Mirrors coin_match_confirmed_requires_evidence in 0004. Both must hold;
 *  neither is trusted alone. */
export function toCoinMatch(row: CoinMatchRow): CoinMatch {
  if (row.retracted_at !== null) {
    return { kind: 'retracted', candidateMint: row.mint, at: row.retracted_at };
  }
  const settled =
    row.verdict === 'confirmed' &&
    row.mint_time !== null && row.ticker !== null && row.name !== null;

  if (!settled) {
    return {
      kind: 'unsure',
      candidate: {
        storyId: row.story_id,
        candidateMint: row.mint,
        candidateTicker: row.ticker,
        channels: row.channels,
        channelsRun: row.channels_ran,
      },
    };
  }
  return {
    kind: 'confirmed',
    coin: {
      [IDENTITY_CONFIRMED]: true,
      storyId: row.story_id,
      mint: row.mint,
      ticker: row.ticker,
      coinName: row.name,
      mintTime: row.mint_time,
      relation: row.relation === 'adopted' ? 'adopted' : 'derived',
      channels: row.channels,
    } as ConfirmedCoin,
  };
}

/** Safety is a SEPARATE input. A confirmed coin cannot be upgraded to buyable
 *  without one, and 'unknown' fails closed — the inverse of the old
 *  api/safety.js, which reported every token as revoked-and-safe. */
export function toBuyable(coin: ConfirmedCoin, s: SafetyVerdict): BuyableCoin | null {
  if (s.pass !== true) return null;
  return { ...coin, [SAFE_TO_BUY]: true, gatesCheckedAt: s.checkedAt } as BuyableCoin;
}
```

The component signature is the whole point:

```ts
// apps/web/src/features/trading/ui/BuyButton.tsx
export function BuyButton(props: {
  coin: BuyableCoin;
  size: 'row' | 'panel';
  feeBps: number;            // from config, never a literal
}): ReactElement
```

Every one of these is a build failure:

| Call | Error |
|---|---|
| `BuyButton({ coin: rowFromSupabase })` | **TS2322** — `[IDENTITY_CONFIRMED]` missing |
| `BuyButton({ coin: confirmedButUnsafe })` | **TS2322** — `[SAFE_TO_BUY]` missing in `ConfirmedCoin` |
| `BuyButton({ coin: unsureCandidate })` | **TS2322** |
| `switch (m.kind)` missing `'retracted'` | **TS2322** on `never` (or **TS2345** via `assertNever`) |

Note the code: the brand is an **intersection** (`Coin & { [b]: true }`), and an
intersection target always elaborates as TS2322, not TS2741. TS2741 appears only for a
flat object type. This matters because the negative type tests assert on the failure,
and asserting the wrong code makes the test pass for the wrong reason — so they use
`@ts-expect-error` with a description rather than literal error codes, which are not a
stable API.

### 7.3 The one rule, once

```ts
// packages/contracts/src/action.ts
export type StoryAction =
  | { readonly kind: 'create'; readonly storyId: string; readonly label: 'Create coin' }
  | { readonly kind: 'buy'; readonly coin: BuyableCoin; readonly label: `Buy $${string}` }
  | { readonly kind: 'multi'; readonly coins: readonly BuyableCoin[];
      readonly label: `See the ${number} coins` }
  | { readonly kind: 'view'; readonly coin: ConfirmedCoin; readonly reason: 'unsafe';
      readonly failingGate: SafetyGate; readonly label: 'See the coin' }
  | { readonly kind: 'none'; readonly reason: 'no_create'; readonly label: 'Not mintable' };

/** NOTE THE INPUT TYPE. No mcap, no price, no liquidity, no `tradeable` boolean
 *  anywhere in it — so the deleted behaviour where a four-minute-old confirmed
 *  coin flips back to Create because mcap was null is not merely forbidden, it
 *  is unwritable. */
export type PrimaryActionInput = {
  readonly storyId: string;
  readonly coinability: CoinabilityTier;
  readonly matches: readonly CoinMatch[];
  readonly safety: ReadonlyMap<MintAddress, SafetyVerdict>;
};

export function primaryAction(i: PrimaryActionInput): StoryAction {
  if (i.coinability === 'never') {
    // Unreachable in practice — tier 'never' rows are unreadable through RLS.
    // Present so the branch is total and the case is documented.
    return { kind: 'none', reason: 'no_create', label: 'Not mintable' };
  }

  const confirmed: ConfirmedCoin[] = [];
  for (const m of i.matches) if (m.kind === 'confirmed') confirmed.push(m.coin);
  // UNSURE is never counted, in any branch. It has no route into this loop.

  const buyable: BuyableCoin[] = [];
  const unsafe: { coin: ConfirmedCoin; gate: SafetyGate }[] = [];
  for (const c of confirmed) {
    const s = i.safety.get(c.mint) ?? ({ pass: 'unknown', reason: 'never_checked' } as const);
    const b = toBuyable(c, s);
    if (b) buyable.push(b);
    else unsafe.push({ coin: c, gate: s.pass === false ? s.failingGate : 'unknown' });
  }

  if (buyable.length === 1) {
    const c = buyable[0]!;
    return { kind: 'buy', coin: c, label: `Buy $${c.ticker}` };
  }
  if (buyable.length >= 2) {
    return { kind: 'multi', coins: buyable, label: `See the ${buyable.length} coins` };
  }
  if (unsafe.length > 0) {
    const u = unsafe[0]!;
    // SHOW RISKY promotes to Buy only by re-running with a relaxed safety map
    // UPSTREAM. It cannot be applied here, because that would mean this function
    // can mint a BuyableCoin, which it cannot.
    return { kind: 'view', coin: u.coin, reason: 'unsafe', failingGate: u.gate, label: 'See the coin' };
  }
  if (i.coinability === 'no_create') {
    return { kind: 'none', reason: 'no_create', label: 'Not mintable' };
  }
  return { kind: 'create', storyId: i.storyId, label: 'Create coin' };
}
```

### 7.4 Missing data cannot render as zero

The old defect — `if (!pair.pairCreatedAt) return 0` — is not a missing null check. It
is a type that permits `number` to mean both "a value" and "we do not know". `Pending<T>`
removes the second meaning by removing the shape.

```ts
// packages/contracts/src/pending.ts
import type { Instant, Minutes, Usd } from './ids';

/** 'No data yet' is a different SHAPE, not a different value. There is no 0
 *  inhabiting this type, so `?? 0` cannot typecheck upstream of a formatter. */
export type Pending<T> =
  | { readonly state: 'known'; readonly value: T }
  /** Cannot obtain, ever. dev%, sniper%, bundle%. Renders an em dash. */
  | { readonly state: 'unobtainable'; readonly reason: UnobtainableReason }
  /** The window has not elapsed. 24H on a 41-minute coin. Renders an em dash
   *  with title="coin is 41m old". NEVER 0.0%. */
  | { readonly state: 'not_yet'; readonly note: string }
  /** Expected imminently. Price before the first trade. Renders two dots. */
  | { readonly state: 'awaiting' };

export type UnobtainableReason =
  | 'not_modelled'   // needs first-slot tx analysis we are not building
  | 'vendor_absent'  // the API returned no field
  | 'vendor_error'   // 429 / timeout — distinct from absent, fails closed
  | 'no_mint_time';  // the age axis is unknown; suppresses Buy

export const known = <T,>(value: T): Pending<T> => ({ state: 'known', value });
export const awaiting = <T,>(): Pending<T> => ({ state: 'awaiting' });
export const unobtainable = <T,>(reason: UnobtainableReason): Pending<T> =>
  ({ state: 'unobtainable', reason });
export const notYet = <T,>(note: string): Pending<T> => ({ state: 'not_yet', note });

/** Absence is contagious. There is deliberately no getOrElse and no unwrapOr —
 *  offering one reintroduces the defect with a nicer name. */
export function mapPending<A, B>(p: Pending<A>, f: (a: A) => B): Pending<B> {
  return p.state === 'known' ? { state: 'known', value: f(p.value) } : p;
}
export function zipPending<A, B, C>(
  a: Pending<A>, b: Pending<B>, f: (a: A, b: B) => C,
): Pending<C> {
  if (a.state !== 'known') return a;
  if (b.state !== 'known') return b;
  return { state: 'known', value: f(a.value, b.value) };
}

export type PendingRender =
  | { readonly text: string; readonly tone: 'ink' }
  | { readonly text: '—'; readonly tone: 'dim'; readonly title?: string }
  | { readonly text: '··'; readonly tone: 'dim' };

export function render<T>(p: Pending<T>, fmt: (v: T) => string): PendingRender {
  switch (p.state) {
    case 'known':        return { text: fmt(p.value), tone: 'ink' };
    case 'not_yet':      return { text: '—', tone: 'dim', title: p.note };
    case 'unobtainable': return { text: '—', tone: 'dim' };
    case 'awaiting':     return { text: '··', tone: 'dim' };
    default: { const _x: never = p; return _x; }
  }
}

/* ------------------------------------------------------------------ *
 * Age — the exact defect, closed by the signature.
 *
 * OLD:  function ageMin(pair) { if (!pair.pairCreatedAt) return 0; … }
 * NEW:  the parameter type cannot hold a number, so there is no value to
 *       default. Passing `number | null` does not compile.
 * ------------------------------------------------------------------ */
export function ageMinutes(mintTime: Pending<Instant>, now: Instant): Pending<Minutes> {
  return mapPending(mintTime, (t) => ((now - t) / 60000) as Minutes);
}

/** A window longer than the coin's own age is not_yet, never 0.0%. A 0.0% pill
 *  reads as FLAT, which is a different assertion from undefined and the most
 *  misleading render available. */
export function windowChange(
  raw: Pending<number>, windowMin: number, age: Pending<Minutes>,
): Pending<number> {
  if (age.state === 'known' && age.value < windowMin) {
    return notYet(`coin is ${Math.floor(age.value)}m old`);
  }
  return raw;
}

/** Dollars fall back to the SOL denomination, never to $0.00. */
export function formatUsd(p: Pending<Usd>): PendingRender {
  return render(p, (v) =>
    v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M`
  : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K`
             : `$${v.toFixed(2)}`);
}

/* WIRE CODEC. The database decides WHICH pending state, because only it knows
 * minted_at and the window length; doing it per component means eleven
 * implementations of a rule that must be identical everywhere. Compact keys —
 * this ships in every broadcast frame, 40 rows at a time. */
export type PendingWire<T> =
  | readonly ['k', T] | readonly ['u', UnobtainableReason]
  | readonly ['n', string] | readonly ['a'];

export function decode<T>(w: PendingWire<T>): Pending<T> {
  switch (w[0]) {
    case 'k': return { state: 'known', value: w[1] };
    case 'u': return { state: 'unobtainable', reason: w[1] };
    case 'n': return { state: 'not_yet', note: w[1] };
    case 'a': return { state: 'awaiting' };
  }
}
```

### 7.5 What the brand does not do, stated plainly

A brand is compile-time only, and it is not airtight. These all compile clean with **no
cast token at all**, and each is closed by something other than the type:

| Escape | Closed by |
|---|---|
| `x as BuyableCoin` | ESLint `TSAsExpression` selector |
| `<BuyableCoin>x` | ESLint `TSTypeAssertion` selector (a **different** AST node) |
| `function f(x: any): BuyableCoin { return x }` | `@typescript-eslint/no-unsafe-return` + `no-explicit-any` |
| `const c: BuyableCoin = await res.json()` | `@typescript-eslint/no-unsafe-assignment` — and this is the one that matters, because on this product every coin arrives over HTTP |
| `const c: BuyableCoin = JSON.parse(s)` | same |
| `parse<BuyableCoin>(raw)` | the parse function's own signature (below) |
| `String(coin.mint)` in JSX | the `MintRef` lint rule, imperfectly |

So the brand is not the correctness boundary. **The parse is.** Exactly one function
mints a branded row, it lives in `packages/contracts`, it runs a zod schema derived
from the generated row type, and it is under CODEOWNERS:

```ts
// packages/contracts/src/rows.ts — the sole entry for untrusted row data.
export function parseCoinMatchRow(u: unknown): CoinMatchRow {
  return CoinMatchRowSchema.parse(u);   // throws; never returns a partial
}
```

A hand-written `x is BuyableCoin` predicate is banned: its body can be wrong and still
compile, which relocates the risk into an unreviewed one-liner.

And the layer that actually holds is the database. The column-level `GRANT` in `0011`
means the score is not fetchable; `coin_match_confirmed_requires_evidence` means an
unconfirmable row cannot be stored. Even a developer who defeats every TypeScript
layer gets an *unstamped* mint, never a **wrong** stamp and never a Buy button on an
unconfirmed match.

### 7.6 The confidence stamp

```tsx
// apps/web/src/shared/stamp/index.tsx
// ONE implementation, four states. It renders on the coins lane, in search
// results, on the CA card, on Trending, in Following sections, in the story
// evidence popover, and in the coin page origin band. If it renders differently
// in any two of those, the product contradicts itself about money.

export type StampState = 'CONFIRMED' | 'UNVERIFIED' | 'ADOPTED' | 'NO_STORY';

const WORDS = {
  CONFIRMED:  { cls: 'match-stamp is-confirmed',  words: 'matched' },
  UNVERIFIED: { cls: 'match-stamp is-unverified', words: 'we could not confirm this' },
  ADOPTED:    { cls: 'match-stamp is-adopted',    words: 'existing coin · adopted by this story' },
  NO_STORY:   { cls: 'match-stamp is-nostory',    words: 'no story' },
} as const;

/** A mint that has passed through toCoinMatch(). The only renderable mint. */
export type StampedMint = { readonly mint: MintAddress; readonly stamp: ConfidenceStamp };

/** The only exported component that renders a mint address. It cannot be called
 *  without a stamp, because StampedMint has no other shape. */
export function MintRef({ value, copy = true }: { value: StampedMint; copy?: boolean }) {
  return (
    <span className="mintref" data-copy={copy ? value.mint : undefined}>
      <span className="mintref-addr">{truncateMint(value.mint)}</span>
      <MatchStamp stamp={value.stamp} />
    </span>
  );
}
```

Categorical prose only — the numeric score is never sent to the client, and it is not
in the row type, so it cannot be.

### 7.7 Agreed functions

Three functions must be implemented identically by both apps or the product publishes
two different truths. They live in `packages/contracts/src/` with mandatory tests, and
neither app is permitted a second implementation.

| Function | Guarantee |
|---|---|
| `leadTime()` | `t_crypto = min(t_mint, t_ct)`; the signed minute count; the seven render branches including negative, gap, backfilled and unmeasurable. Negative renders at identical weight, geometry and size to positive. |
| `confirmedSet()` | Mirrors `coin_match_confirmed_requires_evidence` exactly. A CI test asserts the TypeScript predicate and the SQL `confirmable()` function agree over a 10 000-row generated grid. |
| `band()` | `fresh \| graduating \| live`, plus the Fresh six-hour eligibility ceiling as a **separate** function taking `now`, because it is not part of the band. |

### 7.8 Ownership — is any table written by both apps?

Two candidates. Both overlaps are removed rather than justified.

**`coin` + `coin_match` after an Insidor launch.** A launch must bypass the matcher — we
minted it from this story, we have ground truth, and waiting a cycle drives a duplicate
mint in exactly the window the product exists to serve. But two application writers on
the correctness-critical table is structurally how the old build put an LLM ticker on a
live market. **Resolution:** the web writes `launch` only. An
`AFTER UPDATE … WHEN (new.status = 'landed')` trigger calls
`insidor.promote_launch()`, `SECURITY DEFINER`, which inserts the `coin` row and the
`coin_match` row with `matcher_version = 'launch:v1'`, `relation = 'derived'`,
`ticker_source = 'insidor_launch'`, `s_mint_in_post = 1.0`. The writer is the database,
in one function, and it still has to satisfy every CHECK in `0004` — a launch cannot
write a confirmed row with a null `mint_time` either.

**`holding`.** The web owns cost basis at fill; the pipeline backfills `minutes_early`
once the clocks resolve. Split by **column ownership**, enforced by a `BEFORE UPDATE`
trigger that raises if the service-role caller touches a cost-basis column or the web
caller touches `minutes_early`. Triggers are invisible at the call site, so this one is
documented in `docs/schema.md` and named in the runbook.

Everything else is single-writer. Repointing `follow` rows on a story merge is also a
database function, for the same reason.

---

## 8. ENVIRONMENTS, CI AND DEPLOYMENT

### 8.1 Four environments over three Postgres instances

| | `local` | `preview` | `staging` | `production` |
|---|---|---|---|---|
| Postgres | Supabase CLI (Docker) on the laptop | Supabase **branch** DB, one per PR, destroyed on close | dedicated project | dedicated project |
| Data | committed seed fixtures | committed seed fixtures | real, capped live pipeline | real |
| `apps/web` | `next dev` | Vercel preview | Vercel, `staging.insidor.app` | Vercel, `insidor.app` |
| `apps/pipeline` | runs, `INGEST_MODE=replay` | **not deployed** | Fly, 1 machine | Fly, 2 machines, canary |
| `INGEST_MODE` | `replay` (fixtures) | `off` | `live`, cap 2 000 units/day (~$0.30) | `live`, cap set by founder |
| `TRADING_MODE` | `simulate` | `simulate` | `simulate` | `live` |
| Metered vendor keys | **forbidden** | **forbidden** | yes, capped | yes |
| Who deploys | — | any PR author | merge to `main` | merge to `main` **+ named reviewer** |

**Staging is not optional.** The defect this project must never repeat is a pipeline
that died silently for two days. The SLIs alarm on output freshness and funnel yield,
which need a database where ingestion is actually running and actually spending. That
cannot be production, and it cannot be a database with no ingestion, where every SLI
reads zero forever and is therefore meaningless.

**Local never runs against real data,** and it is not a policy — it is three
independent mechanisms, any one sufficient. `ops_environment` names the database and
every process asserts `APP_ENV` matches at boot. The env schema refuses to start when
a metered key is present with `INGEST_MODE <> 'live'`. And `reserve_units()` raises
when the database's `ingest_mode` is not `live`. Paste a production connection string
into `.env.local` and you get a crash on the first boot, not a live feed of real users'
wallets on a laptop.

**Previews get a branch database and no pipeline.** The pipeline is the component that
costs money per post. If a PR needs pipeline output to be reviewable, the case goes in
the seed.

Two things must be true before the first preview is useful, and neither is polish:

- **Supabase Branching's automatic Migrate step is disabled** and the seed is SQL. The
  CLI cannot apply our migrations (§4.3), and Supabase seeds only from
  `supabase/seed.sql` paths declared in `config.toml` — it will never execute a Node
  seed script. The preview workflow runs `migrate.mjs up` then `psql -f supabase/seed/*.sql`
  against the branch's `DATABASE_URL`.
- **Privy refuses wildcard preview domains.** `https://*.vercel.app` is not an
  allowlistable origin, and the `*-<hash>.domain.com` partial-wildcard form Vercel
  generates is explicitly unsupported. Configure a Vercel Preview Deployment Suffix on
  a domain we own (`*.preview.insidor.app`) and allowlist that, or every preview fails
  wallet connect before a single query reaches the branch database.

Branch cost is per branch-hour, not per branch-day: **$0.01344/hour on Micro** —
about $0.32/day, ~$9.81/month — Pro plan or above, **Compute Credits do not apply**,
and branches are **not covered by the Spend Cap**. That last point is why a stale-PR
reaper runs nightly; the spend cap will not save you.

If Branching proves unworkable, the fallback is **one long-lived staging project that
PRs deploy to serially**, plus the existing ephemeral-Postgres CI job. It is explicitly
*not* "a Postgres schema per PR on a shared project": these migrations hardcode
`public.` and `insidor.` throughout, `CREATE EXTENSION … WITH SCHEMA public`,
cluster-global `anon`/`authenticated` grants, and project-global `realtime.send()`
channel names that would cross-broadcast between PRs.

### 8.2 Secrets

One rule: **`packages/env` is the only module permitted to read `process.env`**,
enforced by ESLint and dependency-cruiser. There are no defaults and no fallbacks;
`process.env.X ?? 'something'` is banned, because it is the same shape as the
token-lookup returning age 0 — failing open on the one axis the product sells.

| Secret | local | preview | staging | production | Store |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | from `supabase start` | injected per-PR | Vercel, **Preview only** | Vercel, **Production only** | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | local stack | branch DB | Vercel + Fly | Vercel + Fly | Vercel / Fly |
| `MIGRATOR_DATABASE_URL` | — | — | GH env `staging` | **GH env `production` only** | GitHub Environments |
| `TWITTERAPI_IO_KEY`, `APIFY_TOKEN` | **forbidden** | **forbidden** | Fly secret | Fly secret | Fly |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | **forbidden** | **forbidden** | Fly secret | Fly secret | Fly |
| `JUPITER_API_KEY`, `JUPITER_REFERRAL_ACCOUNT`, `HELIUS_API_KEY` | dev tier | dev tier | prod | prod | Vercel / Fly |
| `PRIVY_APP_SECRET` | dev app | dev app | dev app | prod app | Vercel |
| `INNGEST_SIGNING_KEY` / `_EVENT_KEY` | — | — | branch env | prod env | Fly |
| `SLACK_ALERT_WEBHOOK`, `HEALTHCHECKS_PING_URL` | — | — | separate channel | `#insidor-page` | Fly |
| `VERCEL_TOKEN`, `FLY_API_TOKEN` | — | — | GH env `staging` | GH env `production` | GitHub Environments |

**No secret is ever scoped to "All Environments" in Vercel.** That single
misconfiguration is how a preview deployment ends up on the production database;
`scripts/check-vercel-env-scopes.mjs` fails the PR if any variable carries more than
one target.

Failure behaviour: `next.config.ts` imports `@insidor/env`, so a missing
`NEXT_PUBLIC_*` **fails the Vercel build** with the variable named and the deployment
never exists. `instrumentation.ts`'s `register()` parses the server schema and calls
`assertEnvironment()` before the first request. The pipeline's preflight does the same
and exits non-zero, failing Fly's health check and rolling the release back. Error
output names variables only, never values.

### 8.3 CI

Wall clock ≈ 3.5 minutes. `ci` is the single required status check on `main`, so branch
protection has one name to require.

```yaml
name: db

on:
  pull_request:
    paths: ['supabase/**', 'scripts/migrate.mjs', '.github/workflows/db.yml']
  push:
    branches: [main]

jobs:
  migrations:
    runs-on: ubuntu-latest
    services:
      postgres:
        # supabase/postgres, NOT stock postgres and NOT pgvector/pgvector.
        # The reason is `anon` and `authenticated`: 0011 grants to them, and only
        # this image's init scripts create them. (0015 has a creation guard, but
        # the platform image is what makes CI match production's PRIVILEGE model:
        # `postgres` is NOSUPERUSER and supautils mediates CREATE EXTENSION.)
        # Pin an explicit tag and bump it as a reviewed change that regenerates
        # supabase/schema.sql — there is no floating `17` tag and build numbers
        # move daily.
        image: supabase/postgres:17.6.1.156
        env:
          POSTGRES_PASSWORD: postgres
          # MUST be `postgres`. pg_cron's install script refuses any database
          # other than cron.database_name (default `postgres`), and GitHub
          # Actions services cannot override a container command to change it.
          # A custom name also drops the whole Supabase bootstrap into the wrong
          # database.
          POSTGRES_DB: postgres
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres"
          --health-interval 5s --health-timeout 5s --health-retries 40
        # TCP, not the unix socket: the image runs ~60 platform migrations through
        # docker-entrypoint-initdb.d with listen_addresses='', so a socket probe
        # goes green before TCP:5432 exists.
    env:
      FRESH_URL:    postgres://postgres:postgres@localhost:5432/fresh
      UPGRADED_URL: postgres://postgres:postgres@localhost:5432/upgraded
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci

      - name: create the two databases
        run: psql "postgres://postgres:postgres@localhost:5432/postgres" -v ON_ERROR_STOP=1
             -c 'create database fresh' -c 'create database upgraded'

      # 1. Build from empty, in order.
      - name: apply migrations to an empty database
        run: DATABASE_URL="$FRESH_URL" node scripts/migrate.mjs up

      # 2. IDEMPOTENCY PROOF. Every migration runs a second time and must be a
      #    no-op — the property the 24 loose schema files never had.
      - name: re-apply
        run: DATABASE_URL="$FRESH_URL" node scripts/migrate.mjs verify

      # 3. Build from what production is ACTUALLY running, then apply the new
      #    migrations on top.
      - name: apply new migrations over production's schema
        run: |
          psql "$UPGRADED_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
          DATABASE_URL="$UPGRADED_URL" node scripts/migrate.mjs up

      # 4. DRIFT PROOF. If these differ, a migration is order-dependent, was
      #    hand-edited, or someone ran DDL in the dashboard.
      - name: drift check (fresh vs upgraded)
        run: |
          pipx install migra --include-deps
          migra --unsafe "$FRESH_URL" "$UPGRADED_URL" > /tmp/drift.sql || true
          if [ -s /tmp/drift.sql ]; then
            echo "::error title=Schema drift::A database built from scratch differs from production+migrations."
            cat /tmp/drift.sql; exit 1
          fi

      # 5. ORDERING PROOF.
      - name: ordering guard
        run: |
          psql "$FRESH_URL" -v ON_ERROR_STOP=1 -c "delete from insidor.schema_migrations where version='0004';"
          if DATABASE_URL="$FRESH_URL" node scripts/migrate.mjs up 2>&1 | tee /tmp/o; then
            echo "expected migrate to refuse out-of-order 0004"; exit 1; fi
          grep -q "must be applied in ascending order" /tmp/o

      # 6. DRIFT GUARD PROOF. Editing an applied migration must be refused.
      - name: drift guard
        run: |
          psql "$UPGRADED_URL" -v ON_ERROR_STOP=1 -c "update insidor.schema_migrations set checksum='tampered' where version='0002';"
          if DATABASE_URL="$UPGRADED_URL" node scripts/migrate.mjs verify 2>&1 | tee /tmp/o2; then
            echo "expected migrate to refuse a drifted migration"; exit 1; fi
          grep -q "Migrations are immutable once applied" /tmp/o2

      # 7. DUMP -> RESTORE ROUND TRIP. THE ONLY test that reproduces the failure
      #    Postgres documents for a non-immutable CHECK constraint: it applies
      #    green and breaks a restore months later. A schema-only diff does NOT
      #    catch this, because pg_dump happily emits the constraint text.
      #    pg_dump's major MUST match the server's or it refuses to run.
      - name: dump and restore
        run: |
          psql "postgres://postgres:postgres@localhost:5432/postgres" -c 'create database restored'
          docker run --rm --network host -e PGPASSWORD=postgres supabase/postgres:17.6.1.156 \
            pg_dump -h localhost -U postgres -d fresh --no-owner --no-privileges \
              --schema=public --schema=insidor > /tmp/dump.sql
          psql "postgres://postgres:postgres@localhost:5432/restored" -v ON_ERROR_STOP=1 -f /tmp/dump.sql

      # 8. Snapshot diff. supabase/schema.sql is the reviewable artefact.
      - name: schema snapshot
        run: |
          docker run --rm --network host -e PGPASSWORD=postgres supabase/postgres:17.6.1.156 \
            pg_dump -h localhost -U postgres -d fresh --schema-only --no-owner --no-privileges \
              --schema=public --schema=insidor > /tmp/schema.sql
          diff -u supabase/schema.sql /tmp/schema.sql

      # 9. Generated types. This is what makes a schema change mechanically touch
      #    both apps.
      - name: generated types are in sync
        run: |
          supabase gen types typescript --db-url "$FRESH_URL" --schema public \
            > packages/contracts/src/generated/database.types.ts
          git diff --exit-code -- packages/contracts/src/generated/ \
            || { echo '::error::Run `npm run db:types` and commit. Never hand-edit.'; exit 1; }

      - run: node scripts/check-migrations.mjs
        env: { MIGRATION_BASE_REF: origin/${{ github.base_ref || 'main' }} }

  invariants:
    runs-on: ubuntu-latest
    needs: migrations
    services:
      postgres:
        image: supabase/postgres:17.6.1.156
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: postgres }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -h 127.0.0.1 -p 5432 -U postgres -d postgres"
          --health-interval 5s --health-timeout 5s --health-retries 40
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: node scripts/migrate.mjs up

      # Every constraint gets a NEGATIVE test: the bad write must be REJECTED.
      # A constraint with no failing test is a constraint nobody has proved exists.
      - name: product-rule invariants
        run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invariants.sql

      # No CHECK constraint may depend on a non-immutable function.
      - name: check-constraint immutability audit
        run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/immutability.sql

      # The four hot queries must not regress into a Seq Scan or a Sort.
      - name: hot query plans
        run: |
          node scripts/db/seed.mjs --url "$DATABASE_URL"
          psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/plans.sql

      # The frozen regression set. The 0.97 precision floor is a product
      # commitment, so it is a failing test and not a dashboard.
      - name: match precision regression
        run: npm run test:match-regression
```

The application workflow (`ci.yml`) runs four static tasks in parallel — `lint`,
`typecheck`, `boundaries`, `test` — plus a guards job (`check-env-parity`,
`check-vercel-env-scopes`, `check-model-tests`, `check-app-thin`, `gitleaks`), both app
builds, and two jobs that matter more than they look:

- **`architecture-drift`** renders the dependency graph with graphviz and fails if
  `docs/architecture.svg` differs from the committed file. A new coupling then shows up
  as a *picture* in the PR rather than as a line in a config nobody reads.
- **`back-compat`** checks out the `prod-current` tag's `apps/` and runs *its*
  integration tests against the *new* schema. This is the N-1 rule as a test rather
  than a convention.

Blocking versus advisory:

| Blocking | Advisory |
|---|---|
| typecheck (both apps, `allowJs: false`, no `exclude`), lint, boundaries (with the `totalCruised` floor), unit tests, `check-model-tests`, both builds, migration linter, schema drift, dump→restore, generated types, seed + nine scenarios, `back-compat`, match precision ≥ 0.970 with abstain in 0.15–0.30, gitleaks, Vercel env scopes | coverage delta (PR comment), bundle size, `architecture.svg` diff — advisory to *fail*, but a reviewer must look |

### 8.4 The deploy-order rule for schema changes

`apps/web` and `apps/pipeline` share a database and are never deployed atomically.
There is always a window where one is new and the other is old.

> **N-1 both ways.** Every deploy must be correct against the schema that was live
> immediately before it, *and* the schema that will be live immediately after it.

Three obligations, each mechanically checked rather than remembered:

1. **Migrations are expand-only within a release** — the linter rejects `DROP`,
   `RENAME` and `ALTER … TYPE` outside a `contract` phase.
2. **New columns are nullable or defaulted** — `ADD COLUMN … NOT NULL` without a
   `DEFAULT` breaks the currently-deployed writer the instant it lands.
3. **The `back-compat` job runs the deployed code's tests against the new schema.**

Readers never `select *`; they select named columns from the generated types, so an
added column cannot break an old reader.

**Order is derived from the migration header, not chosen at 2 am.**
`scripts/release-plan.mjs` reads the `@phase` of every migration new since the
`prod-current` tag and emits `db_first=true|false`:

```
expand / backfill   ->  DB, then pipeline (the WRITER), then web (the READER)
contract            ->  web, then pipeline, then DB (the drop goes LAST)
```

For an additive change: between steps 1 and 2 the column exists and is empty —
harmless. Between 2 and 3 it is populated and unread — harmless. For a contract
change the order inverts, because the drop must land only after every process that
referenced the column is gone.

```yaml
# .github/workflows/release.yml — the ONLY path to staging or production.
# Vercel's git integration is DISABLED (vercel.json git.deploymentEnabled.main =
# false) because the integration deploys on push and cannot be ordered against a
# migration — and ordering is the whole problem.
concurrency:
  group: release
  cancel-in-progress: false      # never cancel a half-finished deploy

jobs:
  plan:
    outputs:
      phase:    ${{ steps.p.outputs.phase }}
      db_first: ${{ steps.p.outputs.db_first }}
      has_migrations: ${{ steps.p.outputs.has_migrations }}
    steps:
      - id: p
        run: node scripts/release-plan.mjs >> "$GITHUB_OUTPUT"

  production:
    needs: [plan, staging]
    # This environment has REQUIRED REVIEWERS and a wait timer.
    # MIGRATOR_DATABASE_URL exists ONLY in this scope, so a job that has not
    # passed the reviewer gate physically cannot reach the production database.
    environment: { name: production, url: https://insidor.app }
    steps:
      - name: pre-migration snapshot        # 20-90s. Retained 90 days.
        if: needs.plan.outputs.has_migrations == 'true'
        run: |
          pg_dump --schema-only --no-owner "$DATABASE_URL" > schema.before.sql
          pg_dump --format=custom --no-owner \
            --table=public.trade --table=public.holding --table=public.app_user \
            "$DATABASE_URL" > money.before.dump

      - name: migrate (expand / backfill order)
        if: needs.plan.outputs.db_first == 'true' && needs.plan.outputs.has_migrations == 'true'
        run: node scripts/migrate.mjs up
        env: { DATABASE_URL: '${{ secrets.MIGRATOR_DATABASE_URL }}' }

      - name: deploy pipeline
        run: flyctl deploy apps/pipeline --config apps/pipeline/fly.production.toml
             --strategy canary --wait-timeout 300

      - name: deploy web
        run: |
          npx vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
          npx vercel build --prod --token="$VERCEL_TOKEN"
          npx vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"

      - name: migrate (contract order — the drop goes LAST)
        if: needs.plan.outputs.db_first == 'false' && needs.plan.outputs.has_migrations == 'true'
        run: node scripts/migrate.mjs up
        env: { DATABASE_URL: '${{ secrets.MIGRATOR_DATABASE_URL }}' }

      - name: smoke
        run: node scripts/smoke.mjs --base https://insidor.app --require-pipeline

      # Refresh the committed schema so the CI drift check keeps comparing
      # against reality rather than against last month.
      - name: record applied schema
        if: needs.plan.outputs.has_migrations == 'true'
        run: pg_dump --schema-only --no-owner --no-privileges --no-comments
             --schema=public --schema=insidor "$DATABASE_URL" > supabase/schema.sql
      - uses: peter-evans/create-pull-request@v7
        with: { branch: 'chore/schema-snapshot-${{ github.sha }}', labels: automated }

      - name: tag the release
        run: git tag -f prod-current && git push --tags --force
```

The smoke step is not a 200 check: it asserts `/api/health` reports the right
environment and trading mode, **and** that a new `ops_stage_run` row with
`rows_out > 0` has appeared since the deploy started. A healthy process that produces
nothing is the failure this whole document is organised around.

### 8.5 Rollback

Decide in this order. **Is money at risk?** If yes, kill trading first — one statement,
no deploy, because the resolver renders nothing when `trading_mode = 'off'`:

```sql
update public.ops_environment set trading_mode = 'off';
```

**Is the board wrong, or empty?** Wrong is worse than empty. Then roll back whatever
changed most recently.

| Fault | Action | Done when |
|---|---|---|
| Bad web deploy | `vercel promote <previous-url>` — 45 s, no rebuild | `/api/health` reports the previous SHA |
| Bad pipeline deploy | `fly deploy -a insidor-pipeline --image $(fly releases --json \| jq -r '.[1].ImageRef')` | `/health/ready` is ok **and** a new `ops_stage_run` row exists |
| Pipeline will not start | Read the last 20 log lines; preflight names the variable or the mismatched environment. `fly secrets set` and it restarts. **Never remove the preflight.** | — |
| Budget exhausted | It is working. Accept a quiet board until UTC midnight, or raise the cap deliberately with the founder and write down why. **Never raise it to silence the alert.** | — |
| Migration failed partway | Transactional files roll themselves back; check `insidor.schema_migrations`. Concurrent-index files can half-apply: `select indexrelid::regclass from pg_index where not indisvalid` then `drop index concurrently`. | — |
| Migration applied and is wrong | Roll the **apps** back first — expand-only means the previous version works against the new schema. Then write a forward revert migration through the normal gate. | — |
| Data destroyed | Freeze writes, restore from the 90-day pre-migration dump (surgical, one table). **PITR is last resort and founder-authorised**: it deletes every write since the restore point, which on this product means real trades disappear. | — |
| Hand-run DDL | Do not undo it by hand — that is a second undocumented change. Write a migration that reconciles reality, merge it, drift goes green. | — |

After any rollback: one line in `#insidor-page`; check `e2e_lead_time_p50`, because a
rollback that restores availability but leaves lead time at four minutes has not
restored the product; and open the incident note the same day. The question is always
the same — **what would have made this state unrepresentable?**

---

## 9. TESTING

### 9.1 Strategy

Four layers, chosen because each catches something the others structurally cannot.

**Pure unit tests over `model/`.** Vitest cannot render async Server Components, so if
"test the components" is the standard, testing dies in week two when someone hits that
wall. The architecture's answer is that all decision logic lives in a segment that is
pure by lint rule — no React, no I/O, no clock — and every file there has a sibling
test, enforced by `scripts/check-model-tests.mjs`. Five-line tests, no mocks. That is
the whole cost, and it is why the rule is non-negotiable rather than aspirational.

**Negative constraint tests in SQL.** `supabase/tests/invariants.sql` asserts that bad
writes are **rejected**. A constraint with no failing test is a constraint nobody has
proved exists. It runs as one transaction ending in `ROLLBACK`, with two helpers:
`pg_temp.rejects(sql, label)` raises unless the statement errors, and
`pg_temp.accepts(sql, label)` raises if it does.

**Type tests.** `packages/contracts/src/__typetests__/*.test-d.ts` compile under
`tsc --noEmit` and assert that the *wrong* code does not compile, using
`@ts-expect-error` with a description — never a literal `TSxxxx` code, which is not a
stable API and which is easy to get subtly wrong in a way that makes the test pass for
the wrong reason.

**Query plan assertions.** `supabase/tests/plans.sql` runs `EXPLAIN` and fails on
forbidden nodes. A board that quietly regresses to a Seq Scan is a correctness problem
here, because the product's whole claim is that it is early.

Deliberately thin: no end-to-end browser suite in v1. It is the slowest, flakiest layer
and it would duplicate coverage the four above already give. Reconsider once the trade
flow stops changing weekly.

### 9.2 The correctness-critical set

These are the tests that stop money being lost. They are tagged `INVARIANT` and run as
their own CI step, so a failure is never buried in a list of 400 passes.

| Area | What must hold |
|---|---|
| `primaryAction()` | Buy appears iff exactly one confirmed **and safe** coin exists. Never on unsure. Never suppressed by absent market data. |
| `coin_match` constraints | A confirmable-false row cannot be stored, at any score. |
| `story_ticker` provenance | An LLM-sourced ticker cannot carry a mint and cannot reach a confirmed match. |
| Coinability | A tier-`never` story is unreadable, un-commentable and un-launchable. |
| `promoted_at` | Write-once, enforced under UPDATE. |
| `lead_time_min` | Generated; unwritable by hand; requires both watermarks past promote. |
| Safety | `unknown` fails closed. `intrinsic_gate_pass` is false on an all-unknown row. |
| `Pending<T>` | No input path yields `0` for absent data, at any age. |
| `trade.request_id` | A duplicate submission is a 409, not a second fill. |
| Board plans | Q1–Q4 open on their indexes, no Seq Scan, no Sort. |

Plus the **frozen regression set**: the real `$KANG`, `$PUMP` and `GYATT` cases as seed
fixtures, each asserting zero rows reach a buyable state. They must **fail to become
buyable**, so a threshold change cannot land silently.

### 9.3 The first ten tests

Write these before anything else. In order.

**1. `invariants.sql` — a confirmed match with one strong channel is rejected.**
The single most important assertion in the system. Insert a `coin_match` with
`verdict = 'confirmed'`, `score = 0.91`, `s_img = 0.80`, everything else NULL. It must
raise `coin_match_confirmed_requires_evidence`. Then repeat with two strong channels and
assert it is accepted, and that `story.confirmed_coin_count` became 1 — which also
proves the recount trigger fired.

**2. `invariants.sql` — an LLM-sourced ticker cannot carry a mint.**
`INSERT INTO story_ticker (…, source, resolved_mint) VALUES (…, 'llm', 'So111…')` must
raise `story_ticker_llm_never_resolves`. Then assert an insert with **no `source`
column at all** raises a not-null violation. That second half is the point: provenance
is not optional.

**3. `action.test.ts` — the resolver's twelve cases, as a table.**
Zero matches → create. One confirmed + safe → `Buy $HORN`. **One confirmed with a NULL
mcap → still buy** (the deleted bug). One confirmed with unknown safety → view (fails
closed). Three unsure, zero confirmed → create. One confirmed + two unsure → buy, and
`n` counts 1 not 3. Two confirmed and safe → `See the 2 coins`. `no_create` with zero
confirmed → none. `no_create` with one confirmed → buy, because existing coins trade.
Adopted + safe → buy with `relation: 'adopted'`. Plus one property test: for all
inputs, `kind === 'buy'` implies at least one confirmed match with `pass === true`.

**4. `invariants.sql` — `promoted_at` cannot be moved.**
`UPDATE story SET promoted_at = now()` on a promoted story raises. Updating any other
column on the same row succeeds. Two statements; they encode the entire earliness
claim.

**5. `invariants.sql` — the lead-time clock, including the trigger.**
Insert a `story_clock` passing `promoted_at` as **99 years ago** and assert the
resulting `lead_time_min` is 31 — proving the trigger takes the value from the story,
not the caller, and that the column is generated. Then assert a clock whose mint
watermark predates promote is rejected, that a clock with no watermark at all is
rejected by NOT NULL, and that `UPDATE story_clock SET t_ct = …` raises.

**6. `pending.test.ts` — absent never becomes zero.**
`formatAge(unobtainable('no_mint_time'))` renders `—`, not `0m`.
`windowChange(known(0.4), 1440, known(41))` returns `not_yet`, not `0.0%`. And a
compile assertion: `formatAge(numberOrNull)` must not typecheck.

**7. `invariants.sql` — safety fails closed.**
An all-default `coin_safety` row has `intrinsic_gate_pass = false`. A row with
`mint_authority = 'revoked'`, `freeze_authority = 'revoked'`, `sell_route = 'ok'` but
`top10_pct = NULL` is still false. And `top10_pct` set with
`curve_pda_excluded = false` is rejected outright.

**8. `invariants.sql` — coinability, all four halves.**
A tier-`never` story is not `display_eligible`, returns no `story_cta_v` row, cannot be
reached through `eligible_story`, and rejects a comment. A `no_create` story reports
`can_create = false` and rejects a `launch` row. And a `launch` lying about the tier is
rejected by the composite foreign key.

**9. `plans.sql` — Q1 and Q2 have no Sort node.**
Seed 200 board rows, `EXPLAIN` both board queries, fail on
`Seq Scan on board_state` or `Sort`. This is the test that stops the board silently
getting slower as it gets popular.

**10. `server-entries.test.ts` + the boundary gate.**
Every `features/*/server.ts` contains a top-level `import 'server-only'`, and
`depcruise` reports `totalCruised > 60` with zero violations. The count assertion is
half the test: dependency-cruiser exits 0 having cruised nothing when it dislikes the
TypeScript version, and a gate that goes green on an empty graph is worse than no gate.

### 9.4 The seed

Captured from staging, redacted through a **column allowlist**, then frozen and
committed — plus nine hand-written scenario files that are never captured and never
deleted.

Generated data does not contain the shapes that break this product: negative lead time,
NULL `mint_time`, an unsure match with three candidates, a coin with no snapshots, a
tier-`never` story that must never surface. The allowlist is the control that matters:
if a table gains a column absent from `manifest.json`, **capture fails** rather than
including it, which is what keeps a new wallet or PII column out of git.
`privy_did` and `wallet_address` are never captured; five synthetic users are
generated. Comment bodies are replaced; the `snap_*` columns are kept verbatim, because
their edge cases are the point.

Monthly, a scheduled job recaptures and opens a PR with the diff, so the seed tracks
the schema instead of rotting behind it.

---

## 10. OPEN ITEMS

Everything below is unverified. Each carries the one test that settles it. Nothing
here blocks starting; all of them block the surface they name.

| # | Item | The test that settles it |
|---|---|---|
| 1 | **No migration has ever been executed.** No Postgres was reachable while this schema was written; expect one or two syntax corrections on first apply. | `DATABASE_URL=… node scripts/migrate.mjs up` against the CI container. Two-minute loop. |
| 2 | **`realtime.send(payload, event, topic, private)` signature.** `0013`'s comment and match broadcast triggers depend on it. plpgsql late-binds, so the migration applies either way and the triggers fail at *runtime*. | `select realtime.send('{}'::jsonb, 'test', 'test', true);` on the live project. Before the comment composer ships. |
| 3 | **`supabase gen types` against a database whose tables are RLS-protected and column-granted.** Whether the generated row type reflects the *grant* or the *table*. | Run step 9 of `db.yml` and read `coin_match` in the output. If `score` is present, `rows.ts` must strip it explicitly. |
| 4 | **Supabase Branching pricing, cold-start time and CLI surface.** Supabase publishes no provisioning SLA; the ~2-minute figure in circulation is a client health-check timeout. | Create one branch, time it, read the invoice after a week. Set CI timeouts from the measurement, never from the rumour. |
| 5 | **Privy preview domains.** Wildcards are supported only as `*.domain.com`; `*.vercel.app` and `*-hash.domain.com` are not. | Configure a Vercel Preview Deployment Suffix, allowlist `*.preview.insidor.app`, and connect a wallet on one preview. |
| 6 | **Phase-2 authenticated principal.** The unlock is **not** Privy claim injection — that cannot work, because `sub` is a DID and `app_user.id` is a uuid. It is a server-minted Supabase JWT via an imported signing key. | Mint one in the route handler with `{sub: <app_user.id>, role: 'authenticated'}` and confirm `select * from holding` returns the owner's rows. Also confirm whether a self-minted JWT counts against the third-party MAU meter. |
| 7 | **Jupiter's referral fee floor.** Documented at 50 bps; 10 bps was measured live on fresh mints. Deliberately not a CHECK — `fee_bps_quoted` is 0–255 and read from the order response. | Place one 0.01 SOL order and read `feeBps` off the response. On the day the swap route is written. |
| 8 | **RugCheck field names, and whether `topHoldersPercentage` excludes the curve PDA.** The schema refuses to store a top-10 figure without `curve_pda_excluded = true`, which will surface the answer immediately. | Fetch one pre-graduation pump.fun token and compare the reported figure against the on-chain holder list minus the curve PDA. |
| 9 | **pgvector `halfvec` + HNSW at 768 and 512 dims** on the deployed Postgres. | `create index … using hnsw (embedding halfvec_cosine_ops)` in the CI container. Step 1 covers it. |
| 10 | **`pg_cron` and `pg_net` availability**, and the Vault-stored Slack webhook the DDL-audit pager reads. `0001` makes both optional with a NOTICE. | `select extname from pg_extension;` on the live project, then `select ops.page_on_out_of_band_ddl();` and watch Slack. |
| 11 | **eslint-config-next v16 flat-config export shape** under ESLint 10, and whether `no-restricted-imports` group negation (`'!@server/*'`) is honoured. If negation is not honoured, every server import fails lint on day one — loud, but an afternoon. | `npx eslint --print-config apps/web/src/app/layout.tsx` and read the output before trusting any rule. |
| 12 | **Next 16 re-exported route handlers** — `export { POST } from '@server/trading'`. Works on 14/15. | `curl -X POST` one route on a preview deployment. Fallback is a three-line wrapper, still inside the 40-line cap. |
| 13 | **`next.config.ts` `turbopack.root` must equal `outputFileTracingRoot`** or Turbopack refuses to start once Vercel injects its own. | `npm run build -w apps/web` locally, then one Vercel preview build. |
| 14 | **The current repository is a single Next.js app with `api/` and `worker/` excluded from typechecking and written in JavaScript.** Every type-level guarantee in §7 is worth nothing there. | `npx tsc --noEmit` after removing `api` and `worker` from `exclude`. Read the error count; that number is the size of the port. |
| 15 | **`insidor.freeze_columns()` uses dynamic `EXECUTE` per column per row.** Fine on the low-rate tables it is attached to; it will show up as CPU if it ever reaches `post` or `coin_snapshot`. | `explain (analyze, buffers)` a 10 000-row upsert into `post` after deliberately attaching it. Do not ship the attachment. |
| 16 | **The `launch` composite-FK `ON UPDATE RESTRICT`** makes reclassifying a launched story to tier `never` fail with a foreign-key error. Intentional, and it will land as a confusing production error without a runbook entry. | `update story set coinability_tier='never' where id = <a launched story>;` on staging. Write down the error text, put it in the runbook. |
| 17 | **`post_embedding.model` is load-bearing** — `gemini-embedding-001` and `-2` spaces are documented as incompatible, and no constraint enforces a single model because a re-embed has both present transiently. | A pipeline-side assertion at the start of every retrieval run: `select count(distinct model) from post_embedding` must be 1, or the run aborts. |
| 18 | **Key rotation is unaddressed.** Every secret in §8.2 is set once and lives forever, including the `migrator` password and the service-role key. | Write the quarterly rotation runbook, then rotate the Helius key as a rehearsal and time the outage. |
