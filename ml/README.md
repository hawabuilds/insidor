# `ml/`

**Python trains. TypeScript serves. Python never runs in production.**

| Question | Directory |
|---|---|
| What turns the decision log into a training set, and fits a model? | `train/` — the only Python in the repository |
| What does the runner load and call at decision time? | `serve/` — the tree walk, the calibrator, the Scorer |
| Which artefact is live, and how does one become live? | `serve/src/registry/` |
| What writes the outcome labels every night? | `label/run_labels.mjs` — JavaScript, unattended |

Two artefacts cross the language boundary and **neither is code**: a JSON model
file and one registry row. Neither is on the critical path of a user request.

A gradient-boosted tree is a few hundred KB of JSON and a tree walk, which is
arithmetic in any language — so serving needs no Python runtime, no ONNX, and no
native binary. The walker is ~200 lines including every refusal.

## The one thing to know before touching anything here

The naive version of that tree walk — `x <= threshold ? left : right` —
reproduces LightGBM's own predictions to 2.2 × 10⁻¹⁶ on numeric features with no
missing values, and is **wrong by up to 0.98 in probability space, silently, with
no exception**, on four other model variants:

| Model variant | Max absolute error |
|---|---|
| numeric features, no missing values | 2.2e-16 |
| numeric features **with missing values** | 0.92 |
| **categorical** features | 0.98 |
| `sigmoid = 2.0` instead of the default | 0.15 |
| `linear_tree = True` | 0.34 |

A model wrong by 0.9 looks like a bad week, not like a bug. So there are three
defences and all three are load-bearing: the trainer is constrained
(`train.py`), the walker refuses anything it does not implement (`lgbm.ts`,
at load, never at predict), and a parity fixture of 1,000 real rows plus
LightGBM's own answers runs in CI (`serve/fixtures/parity.json`).

**That parity test is the entire justification for allowing a second language.
Without it, do not split.**

## Where directory placement deviates from the design document

`docs/analysis/10-stack-and-structure.md` §4 draws `ml/registry/` as a sibling of
`ml/serve/`. `pnpm-workspace.yaml` declares exactly one TypeScript package under
`ml/`, which is `ml/serve`, so the registry lives at `ml/serve/src/registry/`.
It keeps its own directory and imports nothing from the walker: nothing in the
registry walks a tree, and nothing in the walker knows a row exists.
