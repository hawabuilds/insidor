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

## First run

```bash
pnpm install
cp .env.example .env.local     # fill in what you have; missing keys fail loudly at boot
pnpm check                     # typecheck, the three rule-checkers, boundaries, tests
```

`pnpm check` should end green. If it does not, that is a real failure — nothing here is
expected to be broken on a fresh clone.

## What the checks are

They are not linting. Each one enforces a decision that is expensive to reverse later, and
each fails CI:

| Command | What it stops |
|---|---|
| `pnpm check:vocabulary` | A platform, chain or vendor word appearing in `contracts/` or `core/`. This is what keeps adding a platform a one-folder change instead of a rewrite. |
| `pnpm check:purity` | `Date.now`, `Math.random`, `fetch` or `await` inside `core/`. Purity is what makes it possible to replay a past decision under a new rule and see what would have changed. |
| `pnpm check:policy` | A bare number in `core/` outside `policy.ts`. Every threshold lives in one file, so tuning is a diff rather than an archaeology exercise. |
| `pnpm check:boundaries` | `core` importing an adapter, or the app importing `core`. |

If a check blocks something you need to do, the check is probably right. Come and argue
about it rather than adding an exception — an exception added quietly is how the last build
ended up with a product decision living in a folder named after an API client.

## Running things

```bash
pnpm dev:app          # the web app
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

The pipeline does not run end to end yet. About a third of the logic is written — the parts that are
easy to get wrong and expensive to fix later. The rest is signatures with a
`notImplemented` body and a comment naming what goes there.

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
