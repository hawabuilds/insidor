# Setting up

## What you need

**Node 24.** This is not optional — the whole repo runs TypeScript directly with no build
step, which Node 24 does natively. On 22 you would need a build pipeline and the scripts
would not work as written.

```bash
node -v            # must print v24.x
nvm install 24     # if it does not
nvm use 24
```

**pnpm 11.** npm workspaces were measured *not* to enforce the package boundaries this
project depends on, so pnpm is load-bearing rather than a preference.

```bash
corepack enable
corepack use pnpm@11
```

**Docker**, but only for the database. Everything else in this repository runs without it —
`pnpm check` is green on a clone with no Docker installed at all, because nothing under
`contracts/`, `core/`, `adapters/` or `app/` touches Postgres. You need Docker at the point
you want rows.

## First run

```bash
pnpm install
cp .env.example .env.local     # see below — this works unedited
pnpm check                     # typecheck, five rule-checkers, boundaries, tests
```

`pnpm check` should end green on a fresh clone, with no database, no Docker and no keys.
If it does not, that is a real failure — nothing here is expected to be broken.

**`.env.example` is copyable as-is.** The database block is filled in with the
local-dev-only credentials from `docker-compose.yml`, so `db:up && db:migrate && db:seed`
works with nothing typed in. Every credential below that is blank, and blank is a supported
permanent state — not a TODO. A source with no key is *dormant*: the process boots, the
loops run, the board renders, and the indicator in the corner of the nav says which sources
are off.

The one state that is a fault is a **half-filled** block, because that is somebody believing
a source is running when it is not. It reads as *failing*, naming the variable that is
missing, rather than as "you have not turned this on".

## What the checks are

They are not linting. Each one enforces a decision that is expensive to reverse later, and
each fails CI:

| Command | What it stops |
|---|---|
| `pnpm check:vocabulary` | A platform, chain or vendor word appearing in `contracts/` or `core/`. This is what keeps adding a platform a one-folder change instead of a rewrite. |
| `pnpm check:purity` | `Date.now`, `Math.random`, `fetch` or `await` inside `core/`. Purity is what makes it possible to replay a past decision under a new rule and see what would have changed. |
| `pnpm check:policy` | A bare number in `core/` outside `policy.ts`. Every threshold lives in one file, so tuning is a diff rather than an archaeology exercise. |
| `pnpm check:app-vocabulary` | Our internal words — `narrative`, `cluster`, `candidate` — reaching the app. The app cannot *name* a score, which is the first half of "the system's reasoning never goes on screen". |
| `pnpm check:python` | Python drifting outside `ml/train/`. Python trains and never serves; a `.py` on the request path is a runtime we would then have to deploy. |
| `pnpm check:boundaries` | `core` importing an adapter, or the app importing `core` — plus a probe that writes a real violation and fails if the checker did not catch it. |

`pnpm check` runs all six, then `pnpm test`.

If a check blocks something you need to do, the check is probably right. Come and argue
about it rather than adding an exception — an exception added quietly is how the last build
ended up with a product decision living in a folder named after an API client.

## The database, in the order you actually run it

Every `db:` command, in the order a newcomer runs them. All of them are `node tools/db.mjs
<cmd>`; the header of that file is the long version.

| # | Command | What it does | Needs |
|---|---|---|---|
| 1 | `pnpm db:up` | Starts the Postgres container and waits for it to report **healthy** — it does not return the moment Docker accepts the command, because a migration against a still-starting server fails in a way that reads like a broken migration. | Docker running |
| 2 | `pnpm db:migrate` | Applies `store/migrations/*.sql` in order, one transaction each, recorded in `internal.schema_migration`. Ends by creating the **login user** `insidor_app_user` and granting it `insidor_app` and nothing else. | step 1 |
| 3 | `pnpm db:seed` | Six stories written as domain facts only — `author`, `item`, `observation`, `story`, `story_member`, `asset`. It writes **no** projection row and **no** internal row, on purpose. | step 2 |
| 4 | `pnpm db:project` | Derives the board: reads the domain rows, censors once, upserts finished JSON into `public.board_row` / `public.story_view`. Runs as the *service* role, because it is the one process that must read `public.observation` in order to censor it. | step 3 |
| 5 | `pnpm db:sources` | Derives `public.source_view` — per source, a label, the three-way state, and when it was last heard from. Needs neither `seed` nor `market`; it reads the table the ingest side owns. | step 2 |
| 6 | `pnpm db:pairs` | Derives `public.pair_view` / `public.pair_row` — the mints that reached a market. A **second entrypoint**, not a flag on `db:project`: the board suppresses a stale market reading because every row carries a Buy button, and the pairs screen publishes it with its age because it has no trade affordance. | step 3 |
| 7 | `pnpm db:market` | Asks DexScreener what a coin is worth and appends to `public.market_reading`, with the reason attached wherever there was no number. **Free, no key.** Until it runs, every market figure on the board is an absence — which is honest, and is also every figure. | network |
| 8 | `pnpm db:decide` | Runs each stage loop once over what is already in the database and writes every `Decision` to `internal.decisions`. | step 3 |
| 9 | `pnpm db:label` | Grades the decisions whose horizon has closed and appends the answer to `internal.labels` — resolved, censored, unresolvable, or nothing at all while the window is still open. | step 8 |

Two more, off the happy path:

- `pnpm db:psql` — an interactive shell in the container.
- `pnpm db:reset` — **destructive.** Drops the database, recreates it, migrates. It shouts
  before it does it, because `public.observation` is append-only and is not backfillable.
  Locally that is only seeded rows; anywhere else it is the thing you cannot buy back.

A short version, from nothing to a board with data behind it:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm db:project && pnpm db:sources
pnpm dev:read      # the read service, port 8787, connects as the app role
pnpm dev:app       # with VITE_READ_URL=http://localhost:8787
```

### Why the read service gets its own database user

`pnpm db:migrate` creates `insidor_app_user` and grants it `insidor_app` — SELECT on the
public tables and the projection, **no** USAGE on `internal`, **no** USAGE on `raw`, **no**
grant on `public.observation`.

Run the read service as that user even locally. This is the second half of the product's
central claim: the first half is the wire types, which mean the app cannot *name* a score;
this half is that the connection the read service holds cannot *reach* one. If it ever grows
a query that would leak, it gets `permission denied` from Postgres rather than a rendered
number. Running it as the owner locally would leave that guarantee untested everywhere
except production, which is the one place nobody wants to find out.

## What runs today, and what needs a key

**Be clear about the state of this: the system runs on free data, it cannot discover stories
without a post source, and every algorithm in it is proven on seeded data rather than on
live traffic.** All three of those are worth reading twice before you plan a day around it.

Free, no key, no account, works right now:

| | |
|---|---|
| The web app | `pnpm dev:app` with no backend at all — fixtures behind a permanent banner |
| The wallet | A browser extension if you have one; no key, no account |
| Postgres | The container, with the credentials already in `.env.example` |
| Market readings | DexScreener. No key. Metered at `usd: 0` — the call happened and the ledger says so at a price of zero |
| The mint stream | PumpPortal's websocket, `wss://pumpportal.fun/api/data`. No key |
| Everything under `check` | 27 packages typecheck, six checkers, 1658 tests |

Free, but needs a free registration:

| | |
|---|---|
| **Reddit** | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`. No card, no plan, no per-post billing. This is **the only post source you can turn on for nothing**, and therefore the only way the pipeline discovers a story without a bill. The adapter refuses to construct with the placeholder user-agent still in it, because discovering Reddit's rule as a ban three weeks later is far worse. |

Needs a paid key, and is dormant until it has one:

| | |
|---|---|
| **X** | `X_API_KEY`. Billed per post returned, minimum one per request — a call that returns nothing still costs, which is why nothing in the adapter retries. |
| **TikTok** | `APIFY_TOKEN` plus **two** actor ids. Billed per run: a run that finds nothing costs the same as one that finds a thousand posts. Cannot be used for a blind historical run at all — the adapter refuses that query. |
| **The judge** | `ANTHROPIC_API_KEY`, bounded by `DAILY_BUDGET_USD` (default 5). When the cap is hit the stage *pauses* rather than quietly running up a bill. |
| **Embeddings** | `EMBEDDING_API_KEY`. Grouping needs real sentence embeddings; the previous build used word counting under that name, which is why 91% of its stories held a single post by a single author. |
| **Mint times** | `SOLANA_RPC_URL`, `HELIUS_API_KEY`. Every outcome label hangs on this being right. |

And one switch that is neither:

**`DISCOVER=off` is the default and it has to be declared.** It is not the same question as
"which sources are live" — that is answered by the credential blocks and nothing else. This
switch decides whether we ask *any* of them. Merging the two would make turning discovery
off for an afternoon indistinguishable from losing every credential. With `DISCOVER=on` you
must also give `DISCOVER_TERMS`; an empty list is refused rather than treated as off,
because a discovery loop with nothing to look for runs, reports success, and ingests
nothing.

### What "proven on seeded data" means concretely

After `db:seed`, the database holds **6 stories, 21 items, 786 observations and 13 invented
coins** — and `public.market_reading` is **empty**, so every market figure the projector
publishes is an absence with a reason. That is not a gap in the seed; it is the seed
refusing to state a price no venue ever said.

The seed deliberately writes no projection row and no internal row. A seed that wrote the
board would prove nothing — the claim being tested is the whole chain:

```
seed writes facts → services/project derives the wire JSON → services/read selects it
as the app role and returns it verbatim
```

If the seed wrote the board, the middle arrow would be untested and the leak guarantee
would be a comment.

The pipeline does not run end to end yet. About a third of the logic is written — the parts
that are easy to get wrong and expensive to fix later. The rest is signatures with a
`notImplemented` body and a comment naming what goes there. One test is skipped on purpose,
in `ml/serve`: there is no trained model to check parity against, because `internal.labels`
has not held enough rows to train one. It gates promotion (`M6_parity_missing`) rather than
passing quietly.

## Running things

```bash
pnpm dev:app          # the web app, port 5173
pnpm dev:read         # the read service, port 8787 — connects as the app role
pnpm dev:runner       # the pipeline loops
pnpm dev:chainwatch   # the mint websocket
pnpm test             # colocated tests, node:test, no framework
```

### The app, with nothing behind it

`pnpm dev:app` works right now, with no database and no keys. With `VITE_READ_URL` unset it
serves `app/src/shared/api/fixtures.ts` — six sample stories — behind a permanent **sample
data** banner. Set `VITE_READ_URL` and it talks to the real endpoint instead.

The rows are not filler. Each one is a case that was rendered wrongly in the previous build,
so the screen doubles as the argument for the vocabulary:

| Row | What it is there to show |
|---|---|
| Chef throws the soup | Six tokens claim it, none confident → **no button at all**, not a disabled one |
| Grandmother learns the dance | A source that publishes no view count → a dash, not `0` |
| Man builds a slide | A censored reading → the graph **breaks**; and an age we never learned → a dash, not "brand new" |
| Pigeon on the bus | Nothing minted → Create |
| Ferry captain | One confident match → Buy |
| Cartoon dog | Three tokens, one meme → Compare |

The fixtures go through `decode.ts` exactly like a network response, so they cannot hold a
shape the server could not send. They compile out of a production build — `import.meta.env.DEV`
is a literal the bundler folds, so the module and its data are dropped, and there is no flag
that can turn sample data on in front of a user.

### The wallet

`Connect` in the top corner talks to a wallet extension if this browser has one. It needs no
key, no account and no configuration to run, and **connecting one changes nothing about what
you can do** — there is no venue that will price a coin here and no service that could submit
what a wallet signed, so the buy panel still says trading is not connected. What changes is
what the app knows.

Seven states, and the three people confuse are deliberately three different sentences:

| What you see | What it means |
|---|---|
| **no wallet found** | No extension is answering. The ordinary case, not a fault — press Connect again if you have just installed one, since extensions inject themselves after we look. |
| **you cancelled** | You dismissed your wallet's prompt. Nothing went wrong and nothing was shared. |
| **different network** | Connected, but to a network this build cannot trade on. Both names are in the tooltip. |

`VITE_WALLET_NETWORK` names the network this deployment's venues trade on. **Leave it unset
unless you mean it.** Unset, the app makes no claim about the network at all: it reports what
the wallet said and never tells anybody they are on the wrong one, because a guessed network
name would tell somebody with a correctly-configured wallet that they are wrong. Set it and
`different network` becomes reachable.

Nothing in the browser holds a key. Signing happens inside the wallet; the adapter's whole
surface is `connect`, `disconnect`, the account reference, and `sign(bytes) => bytes` — which
nothing in the app calls, and `wallet/src/dependency-graph.test.ts` fails if a chain library
or wallet SDK ever appears in the app's dependency graph.

## Where to start

`README.md` is a lookup table: question on the left, directory on the right. It is meant to
answer "where do I change X" without anyone explaining the repo to you.

Two files are worth reading before you write anything, because everything else assumes them:

- **`contracts/src/vocabulary.ts`** — what an Item, an Observation and a Rate are. Note that
  a counter reading carries its *fidelity*, not just a value, and that a rate is either
  measured or censored. When two readings differ by less than the platform's rounding step
  the answer is `censored`, never `0`, and `.perMin` does not typecheck until you handle
  that branch. That single type is what stops "this source has no such concept" turning into
  "this post scored zero".

- **`core/src/decide.ts`** — every stage returns a `Decision`, which records what was seen,
  what was chosen, and why. Those rows join to outcome rows later, and that join is the
  entire plan for making the system learn. It works before any model exists, because a row
  does not care whether a threshold or a model decided.

## The thing that is actually urgent

The decision log and the outcome labels are the two tables that cannot be backfilled. Every
day the live system runs without writing them is training data that never existed and cannot
be bought.

That work does **not** need this repo finished — it is two tables and a `finally` block, and
it can go into the build that is already running. It is roughly three days and it is the
highest-value thing available right now.
