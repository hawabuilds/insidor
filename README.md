# insidor

Watches social platforms for posts being **copied** rather than merely viewed, groups the
related posts into a **story**, and works out which of the coins minted from that story is the
real one. One meme can spawn 306 tokens. A coin appears about two minutes after the source post
and peaks about six days later — so the product is not being first to mint, it is naming the
real one while it is still climbing.

**State of it, honestly:** it runs on free data, it cannot discover a story without a post
source, and every algorithm in it is proven on seeded data rather than live traffic. About a
third of the logic is written — the parts that are easy to get wrong and expensive to fix
later. `SETUP.md` says exactly what runs today and what needs a key.

**And what the board shows today:** six hand-written stories from `pnpm db:seed`, under a
permanent notice on the board saying so. The notice is derived from the origin of the rows
on each frame rather than hardcoded, so it disappears by itself once a discovered story is
projected. The market figures and the mints in the launches rail are real and free; the
stories are not real yet, and the screen says which is which.

This file is a lookup, not an explanation. The directory name answers the question.

## The vocabulary and the rules

| Question | Where |
|---|---|
| What is an Item, an Observation, a Decision? | `contracts/src/vocabulary.ts` |
| What is every threshold in the system? | `contracts/src/policy.ts` |
| Why did a stage say no? | `contracts/src/reasons.ts` |
| What may an adapter ever be asked to do? | `contracts/src/ports/` |
| What shape is a Decision, and how does it learn? | `core/src/decide.ts` |

## The logic — pure, no clock, no network

| Question | Where |
|---|---|
| Is this post worth spending money to track? | `core/src/admit/stage.ts` |
| When do we look at it again? | `core/src/track/stage.ts` |
| Is it accelerating against its own baseline? | `core/src/detect/stage.ts` |
| Which story does it belong to? | `core/src/group/stage.ts` |
| **Where is a post judged coinable?** | `core/src/qualify/stage.ts` |
| Which coin, if any, is the real one? | `core/src/resolve/stage.ts` |
| What order does the board go in? | `core/src/rank/stage.ts` |
| Why does a flat counter emit no rate at all? | `core/src/kinetics/rate.ts` |

## The outside world

| Question | Where |
|---|---|
| What does one platform actually return? | `adapters/platform/<name>/src/` |
| What does a chain or a market vendor return? | `adapters/venue/`, `adapters/market/` |
| How does a vendor payload get parsed without trusting it? | `adapters/kit/vendor/` |
| What does a call cost, and who is counting? | `adapters/meter/spend/` |
| What must every adapter prove before it ships? | `adapters/test/contract/` |
| How do I run a stage against a recording? | `adapters/platform/replay/` |
| How does a browser talk to a wallet, and what can it not do? | `wallet/` — top level, because the app may import it and may not import `adapters/` |

## Storage and the wire

| Question | Where |
|---|---|
| Where is the SQL? | `store/src/` — and nowhere else |
| What is the schema, in order? | `store/migrations/` — contiguous from `0001` |
| What may a browser ever see? | `services/project/src/wire.ts`, `app/src/shared/api/wire/` |
| What does the screen do with it? | `app/src/features/` |

## The processes

| Question | Where |
|---|---|
| What runs, always on? | `services/runner/`, `services/chainwatch/` |
| What builds the board the app reads? | `services/project/` |
| What serves it, and with which database role? | `services/read/` |
| What asks a venue for a price? | `services/market/` |
| What finds out whether we were right? | `services/label/` |
| What notices when it stops? | `services/watchdog/`, `.github/workflows/watchdog.yml` |

## Models and evidence

| Question | Where |
|---|---|
| Where does a model come from? | `ml/train/` (Python, by hand) → `ml/serve/` |
| Which artefact is live, and how does one become live? | `ml/serve/src/registry/` |
| What writes the outcome labels every night? | `ml/label/run_labels.mjs` |
| How would a past decision be re-run? | `eval/src/replay/` |
| How is a rule measured against a labelled truth set? | `eval/src/gold/` |
| How is a judgement made without seeing the answer? | `eval/src/blind/` |
| Where do trained datasets and models land? | `var/` — gitignored scratch, rebuilt and never reviewed |

## The rules that are enforced

| Question | Where |
|---|---|
| What stops a vendor word reaching the logic? | `tools/check-vocabulary.mjs` |
| What stops core reading the clock? | `tools/check-purity.mjs` |
| What stops a threshold being typed into a stage? | `tools/check-policy.mjs` |
| What stops a score reaching a screen? | `tools/check-app-vocabulary.mjs` |
| What stops Python leaving `ml/train/`? | `tools/check-python.mjs` |
| Who is allowed to import whom? | `.dependency-cruiser.cjs`, drawn in `docs/graph.svg` |
| How do I get a database with rows in it? | `tools/db.mjs`, `tools/seed.mjs` — and `SETUP.md` |
| Why is it built this way? | `docs/analysis/09-system-architecture.md`, `10-stack-and-structure.md` |

Node 24 runs the TypeScript directly and there is no build step; `tsc` is a checker only.
`pnpm install`, then `pnpm check`. Regenerate the picture with `node tools/graph.mjs`.
Setting up a database, and what each `db:` command does, is `SETUP.md`.
