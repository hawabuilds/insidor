# insidor

Watches social platforms for posts being **copied** rather than merely viewed, groups the
related posts into a **story**, and works out which of the coins minted from that story is the
real one. One meme can spawn 306 tokens. A coin appears about two minutes after the source post
and peaks about six days later — so the product is not being first to mint, it is naming the
real one while it is still climbing.

This file is a lookup, not an explanation. The directory name answers the question.

| Question | Where |
|---|---|
| What is an Item, an Observation, a Decision? | `contracts/src/vocabulary.ts` |
| What is every threshold in the system? | `contracts/src/policy.ts` |
| Why did a stage say no? | `contracts/src/reasons.ts` |
| Is this post worth spending money to track? | `core/src/admit/stage.ts` |
| When do we look at it again? | `core/src/track/stage.ts` |
| Is it accelerating against its own baseline? | `core/src/detect/stage.ts` |
| Which story does it belong to? | `core/src/group/stage.ts` |
| **Where is a post judged coinable?** | `core/src/qualify/stage.ts` |
| Which coin, if any, is the real one? | `core/src/resolve/stage.ts` |
| What order does the board go in? | `core/src/rank/stage.ts` |
| Why does a flat counter emit no rate at all? | `core/src/kinetics/rate.ts` |
| What does one platform actually return? | `adapters/platform/<name>/src/` |
| What does a chain or a market vendor return? | `adapters/venue/`, `adapters/market/` |
| Where is the SQL? | `store/src/` — and nowhere else |
| What may a browser ever see? | `store/src/projections/`, `app/src/shared/api/wire/` |
| What runs, always on? | `services/runner/`, `services/chainwatch/` |
| What notices when it stops? | `services/watchdog/`, `.github/workflows/watchdog.yml` |
| Where does a model come from? | `ml/train/` (Python, by hand) → `ml/serve/` |
| How would a past decision be re-run? | `eval/src/replay/` |
| What stops a vendor word reaching the logic? | `tools/check-vocabulary.mjs` |
| What stops core reading the clock? | `tools/check-purity.mjs` |
| What stops a threshold being typed into a stage? | `tools/check-policy.mjs` |
| What stops a score reaching a screen? | `tools/check-app-vocabulary.mjs` |
| Who is allowed to import whom? | `.dependency-cruiser.cjs`, drawn in `docs/graph.svg` |
| Why is it built this way? | `docs/analysis/09-system-architecture.md`, `10-stack-and-structure.md` |

Node 24 runs the TypeScript directly and there is no build step; `tsc` is a checker only.
`pnpm install`, then `pnpm check`. Regenerate the picture with `node tools/graph.mjs`.
