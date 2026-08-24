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
pnpm check                     # typecheck, six rule-checkers, boundaries, tests
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

**Out of the box every source reads *dormant*, and none reads *failing*.** That is worth
stating because it was not true until recently: `.env.example` used to ship
`REDDIT_USER_AGENT` pre-filled with a placeholder, which is one of Reddit's three
credentials set and two blank — a half-filled block by the rule above. A clone nobody had
touched showed a red Reddit pip. All three now ship blank; the shape the user-agent wants
is in the comment above the variable.

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
| 5 | `pnpm db:sources` | **Two programs, one command.** First a declarer, which reads your `.env.local` and writes what configuration says about every source it knows about — including the ones with no credential, which are *dormant* rather than absent. Then the projector, which reads that back and derives `public.source_view`: per source, a label, the three-way state, and when it was last heard from. Needs neither `seed` nor `market`. | step 2 |
| 6 | `pnpm db:pairs` | Derives `public.pair_view` / `public.pair_row` — the mints that reached a market. A **second entrypoint**, not a flag on `db:project`: the board suppresses a stale market reading because every row carries a Buy button, and the pairs screen publishes it with its age because it has no trade affordance. | step 3 |
| 7 | `pnpm db:market` | Asks DexScreener what a coin is worth and appends to `public.market_reading`, with the reason attached wherever there was no number. **Free, no key.** Until it runs, every market figure on the board is an absence — which is honest, and is also every figure. | network |
| 8 | `pnpm db:decide` | Runs each stage loop once over what is already in the database and writes every `Decision` to `internal.decisions`. **It cannot spend money**: it assembles its own environment and declares `SPEND=dry` and `DISCOVER=off`, so it decides over rows that are already there and contacts nobody. Safe to run on a laptop with a paid key sitting in `.env.local`. | step 3 |
| 9 | `pnpm db:label` | Grades the decisions whose horizon has closed and appends the answer to `internal.labels` — resolved, censored, unresolvable, or nothing at all while the window is still open. | step 8 |

Two more, off the happy path:

- `pnpm db:psql` — an interactive shell in the container. **It needs a real terminal.**
  `docker exec -it` allocates a TTY, so run from a pipe or a CI step it refuses and says
  what to run instead (`docker exec insidor-db psql -U insidor -d insidor -c '…'`).
- `pnpm db:reset` — **destructive, and it does not ask.** It prints a banner, then drops
  the database, recreates it and migrates, unattended. `public.observation` is append-only
  and is not backfillable; locally that is only seeded rows, anywhere else it is the thing
  you cannot buy back. There is no confirmation prompt, so read the command before you
  press enter rather than after.

A short version, from nothing to a board with data behind it:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm db:project && pnpm db:sources

echo 'VITE_READ_URL=http://localhost:8787' > app/.env.local   # once, see below

pnpm dev:read      # terminal 1 — the read service, port 8787, connects as the app role
pnpm dev:app       # terminal 2 — the web app, port 5173
```

**That `app/.env.local` line is not optional and is easy to miss.** It is gitignored, so a
fresh clone does not have it, and without it `pnpm dev:app` serves
`app/src/shared/api/fixtures.ts` behind the **sample data** banner — a perfectly good
screen that has nothing to do with the database you just filled. If you ran the whole
sequence and the app still says *sample data*, this is why.

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
| **Market readings** | **DexScreener. No key, no account, and NO CARD** — there is no signup to complete and no billing page to reach. Metered at `usd: 0`, so the ledger records that the call happened at a price of zero rather than not recording it |
| **The mint stream** | **PumpPortal's websocket, `wss://pumpportal.fun/api/data`. No key, no account, and NO CARD.** A public relay you connect to and read |
| Everything under `check` | 27 packages typecheck, six checkers, 1732 tests — 1731 pass, 1 skipped on purpose |

**Those two are the ones worth being unambiguous about, because they are the two that
sound like they should cost something.** Live Solana prices and a live mint firehose are
the sort of thing that is usually behind a paid plan, and a newcomer who assumes so will
go looking for a billing page that does not exist and conclude the system needs one. It
does not. `pnpm db:market` and `pnpm dev:chainwatch` are the two most useful commands in
this repository that can never, under any configuration, produce an invoice — nothing in
either path is billable, so neither `SPEND` nor `DAILY_BUDGET_USD` has anything to meter.

Free, but needs a free registration:

| | |
|---|---|
| **Reddit** | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`. No card, no plan, no per-post billing. This is **the only post source you can turn on for nothing**, and therefore the only way the pipeline discovers a story without a bill. The adapter refuses to construct with the placeholder user-agent still in it, because discovering Reddit's rule as a ban three weeks later is far worse. |

Needs a paid key, and is dormant until it has one:

| | |
|---|---|
| **X** | `X_API_KEY`. Billed per post returned, minimum one per request — a call that returns nothing still costs, which is why nothing in the adapter retries. |
| **TikTok** | `APIFY_TOKEN` plus **two** actor ids. Billed per run: a run that finds nothing costs the same as one that finds a thousand posts. Cannot be used for a blind historical run at all — the adapter refuses that query. |
| **The judge** | `ANTHROPIC_API_KEY`. **Not wired** — nothing in this repository constructs the judge, so this key is read by no code and the judge costs nothing because it cannot be called. Measured at ~$0.00127/call for when it is. |
| **Embeddings** | `EMBEDDING_API_KEY`. Grouping needs real sentence embeddings; the previous build used word counting under that name, which is why 91% of its stories held a single post by a single author. |
| **Mint times** | `SOLANA_RPC_URL`, `HELIUS_API_KEY`. **Optional, and read by no code today.** Leaving both blank degrades a mint time to the stream's own bound — recorded *as* a bound, with its confidence, rather than presented as exact. Nothing fails, retries, or waits for it, and nothing on the path of a first run touches it. |

And two switches that are neither:

**`DISCOVER=off` is the default and it has to be declared.** It is not the same question as
"which sources are live" — that is answered by the credential blocks and nothing else. This
switch decides whether we ask *any* of them. Merging the two would make turning discovery
off for an afternoon indistinguishable from losing every credential. With `DISCOVER=on` you
must also give `DISCOVER_TERMS`; an empty list is refused rather than treated as off,
because a discovery loop with nothing to look for runs, reports success, and ingests
nothing. Terms **rotate** — one per pass — so a longer list costs the same and covers
more slowly, rather than costing more.

**`SPEND=dry` is the default and it also has to be declared.** See the next section.

## ★ What this costs, and what stops it

Read this before pasting a key. Every figure below is arithmetic over the shipped
defaults, and each one is repeated in `.env.example` beside the knob that moves it.

### ★ The order to turn things on

**The safe path is free first, then one paid key, with a small cap, watched for a day.**
Not because the caps are untrustworthy — they are enforced and they survive a restart —
but because the thing that actually costs money is a mistake in the *configuration*, and a
configuration mistake is only obvious once you have seen what the correct one looks like.
Every step below is verifiable before the next one can bill you.

| | Step | What it proves | Cost |
|---|---|---|---|
| **1** | `pnpm check`, then the `db:` sequence, then `dev:read` + `dev:app` | The whole chain works on your machine: schema, seed, projection, the read path, the board. No vendor is involved at any point. | **$0.00** |
| **2** | `pnpm db:market` and `pnpm dev:chainwatch` | Real outside data arrives — live prices and live mints. **Neither needs a key and neither needs a card.** If these work, the ingest path is not the problem. | **$0.00** |
| **3** | Register a free **Reddit** app, fill the three values, restart | A real post source, discovering real stories. The pip in the corner goes from dormant to live. This is the whole pipeline on free data. | **$0.00** |
| **4** | `SPEND=dry DISCOVER=on DISCOVER_TERMS=... pnpm dev:runner` | What your *own* terms would cost, priced against the same book that would bill them — before anything can. | **$0.00** |
| **5** | One paid key. **One.** `DAILY_BUDGET_USD=0.10`, `SPEND=live` | That billing works, that the meter counts, and that the cap actually stops it — at a price you can lose. Ten cents binds within about two hours, so you see a `paused` row the same morning. | **≤ $0.10** |
| **6** | Raise the cap to `1.00`. **Leave it a day.** Read `internal.spend` the next morning. | That yesterday's real bill matches the arithmetic in `.env.example`. If it does not, the comment is wrong and something is being called more often than anyone thinks. | **≤ $1.00** |

Only then is a second paid source worth turning on — and turn it on **alone**, for the same
reason. Two new sources on the same day means a surprise on the invoice has two candidate
explanations and you will have to remove one to find out which.

Step 5 is the one people skip, and it is the one that matters. A cap you have never watched
bind is a cap you are *assuming*; `DAILY_BUDGET_USD=0.10` costs a dime to turn it into a cap
you have *seen* bind, with the `paused` row in the log to point at.

### As shipped: nothing

| | |
|---|---|
| `.env.example` copied, nothing edited | **$0.00 / day** |
| …plus one X key pasted in | **$0.00 / day** |

Two switches hold that, and both must be turned on by hand: `SPEND=dry` means no vendor
is contacted by anything, and `DISCOVER=off` means nothing goes looking. Neither has a
default — the boot fails naming them — because a default is wrong in both directions
here. Defaulted to `live` it spends money somebody did not know they could spend;
defaulted to `dry` it is a pipeline that runs, reports healthy and ingests nothing.

### The first thing to run: the dry run

```
SPEND=dry DISCOVER=on DISCOVER_TERMS=solana pnpm dev:runner
```

Everything happens except the request. Sources resolve, queries render, each call is
priced **against the same price book that would bill it**, and the budget is consulted so
you also see what *would* have been refused. Then nothing is sent. Once per cadence it
prints:

```
DRY RUN — no vendor was contacted  sourcesPriced=1
                                   wouldSpendUsdPerPass=0.015
                                   wouldSpendUsdPerDay=4.31
```

That is how "what will this cost me" gets answered before it costs anything. The number
is the pessimistic one — X picks its own page size and we reserve the ceiling — so the
real bill lands under it, never over.

### Live, with one X key

```
one discovery call per source, every 5 minutes   = 287 passes / day
$0.00015 per post returned, ~20 posts per page   = 287 × 20 × $0.00015  ≈ $0.86 / day
if every page came back full at 100              = 287 × 100 × $0.00015 ≈ $4.31 / day
```

$4.31 is a structural ceiling, not a budget: it is what one page every five minutes costs
when every page is full. There is no pagination (the cursor is hard-coded null), no
retry on the paid source (a retry is a second real charge), and no term fan-out.

### The hard stop

`DAILY_BUDGET_USD` (shipped at **1**) is enforced, not recorded:

- **The call is not issued.** The meter is asked before every billable call whether the
  projected total crosses the line. If it does, nothing is sent.
- **The pause is recorded as a pause.** The source is written down as `paused`, with what
  the call would have cost and what was left — a *different fact* from a source that was
  asked and found nothing. An empty board still says which of the two happened.
- **It survives a restart.** Every call is written to `internal.spend`, and a booting
  process reads today's total before it does anything. Without that, a crash loop under a
  supervisor gets a fresh daily budget every restart — each one individually enforced,
  the invoice a multiple of the cap.
- **It cannot exceed policy.** `contracts/src/policy.ts` holds `budget.dailyUsd = 3` as
  the most any deployment may spend. Setting `DAILY_BUDGET_USD` above it **fails the
  boot**, naming both figures, rather than quietly overruling a policy whose hash is
  stamped on every decision row.
- **No one source can drain the day.** `budget.perSourceUsdPerDay = 1.50` is a per-vendor
  line, so the source asked first cannot leave the others refused from mid-morning.

### Free sources go first, on purpose

`budget.freeSourcesFirst` sorts every pass cheapest-first, so a day that runs out of money
has already taken everything the free sources had. `budget.paidOnlyWhenFreeIsEmpty` goes
further: a term a free source actually answered is not then paid for elsewhere in the same
pass — recorded as `deferred`, naming who covered it, never as "the paid source had
nothing to say".

The second one has a real coverage cost, written on the field: two sources do not hold the
same posts. It ships on because the binding constraint here is money. The day that
inverts, it is one boolean in policy.

### What is not wired, and what it would cost

None of this runs today, and each is inert because nothing constructs it — not because a
switch is off:

| | |
|---|---|
| The **tracking** re-reads | The path that would dominate everything else. At the shipped grid a mature corpus is ~$18–32/day, and a fully promoted one has a ceiling near $108/day. Read `core/src/track/` and the ★ on `TRACK_LOOKBACK_MS` before wiring it. |
| The **judge** | ~$4.57/day at the qualify cadence — above the shipped cap, so it would pause partway through the day until the wallet was raised deliberately. |
| **Embeddings** | $0.15 per million input tokens, batched 100 to a call. |
| A paid **RPC** | Optional by design, degrades to an absent mint time rather than an error, and is never on the hot path of a first run. |

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
pnpm dev:runner       # the pipeline loops        — health on 8080
pnpm dev:chainwatch   # the mint websocket        — health on 8081
pnpm test             # colocated tests, node:test, no framework
```

All four run at once, one terminal each. The two long-lived processes used to collide:
`.env.example` declares one `HEALTH_PORT` and one `SINGLETON_LOCK_NAME`, both read by both,
so whichever started second exited 1 saying `another chainwatch already holds
insidor.chainwatch` — including when the thing starting was the runner. `pnpm dev:runner`
now supplies its own port and lock name in `package.json`, which the shell sets before node
reads the env file, and a value already in the environment wins over one from `--env-file`.
The values in `.env.example` are chainwatch's.

### ★ What the board shows today, and why

**Everything on the board after `pnpm db:seed` is invented, and the screen says so.** Six
hand-written stories, six labelled `origin = 'fixture'` in `public.story`, published under
a permanent amber notice reading *seeded demonstration data* — on the board, and again on
each story's own page, which is reachable by a shared link with no board in sight.

Neither notice is a constant in the app. The projector reads the origins off the rows it
is committing and writes the answer into the payload, so a notice appears because the rows
really are fictions and **disappears by itself the moment the first discovered story is
projected** — no code change, no flag, and nobody can switch one off early. A missing
answer renders as *provenance not stated* rather than as silence, because the value that
makes the app say nothing must never be reachable by an absence.

That is the honest state of the product. The system cannot discover a real story until a
post source is connected, and Reddit is the one that costs nothing (below). Until then the
board is a demonstration of the rendering rules over invented rows, and everything the
seeded rows say about coins, views and censored readings is a fiction chosen to exercise
one rule each.

Two things on that screen are NOT invented once you have run the pipeline: the market
figures, which come from DexScreener and are real or are an absence with a reason, and the
mints in the launches rail, which come off the live stream. Both are free.

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
