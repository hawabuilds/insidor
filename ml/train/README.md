# `ml/train/` — the only Python in the repository

Python is in the repository and never in production.

It lives here, is run by hand on a laptop, weekly, and produces exactly two
things: a JSON artefact and a markdown report. Nothing under `services/` imports
it, shells out to it, or waits on it. **If Python were deleted from the machine
at 3am, the system would keep making decisions with the artefact it already
has.**

## Why a two-language split is safe here, when it usually is not

The classic reason ML must be one language is train/serve skew: the trainer
recomputes a feature slightly differently from the server, and the model quietly
degrades.

Here the trainer **cannot** recompute a feature. It reads
`internal.decisions.features` — a frozen JSON blob that `core/features/` computed
at the moment of the decision and wrote down. Python never sees a raw post, never
touches a counter, never calls a platform. It sees a table of numbers and a
column of labels.

Logging features at decision time does not manage the online/offline consistency
problem, it dissolves it. That same property is what makes the language boundary
safe: **the boundary is data, not code.**

## The pipeline

```
  build_dataset.py   internal.decisions  ⋈  internal.labels   →  dataset.parquet
                     the join IS the training set                manifest.json
        │
  train.py           LightGBM, three constraints locked        →  model.txt
        │
  evaluate.py        walk-forward by time, purged, per day     →  report.md
        │
  export.py          artefact + sidecar + the parity oracle    →  artefact.json
                                                                  ../serve/fixtures/parity.json
        │
        └─ a registry row with role='challenger' → shadow-score for days → promote
```

One command per step, in that order. `run.sh` does not exist and should not:
a pipeline that can be run without reading the report is a pipeline whose report
does not get read.

## The three things that must not be changed casually

**Evaluation is walk-forward by time, never a random split.** A random split
leaks the future into the past and flatters the model. This market changes regime
constantly, so a model must be shown to hold on a window it was not trained on.
`evaluate.py` also applies a **purge**: a training example decided on D−3 whose
six-day label window covers D shares outcome information with the test set, so
without the purge a walk-forward split still leaks.

**Report the distribution across test days, not the mean.** A mean over 60 days
hides exactly the regime episodes the product exists to catch.

**The trainer is constrained to what the TypeScript walker implements.**
`categorical_feature=[]`, `linear_tree=False`, `sigmoid=1.0`, set explicitly and
locked against override. The serving walker is wrong by up to 0.98 in probability
space against a model that violates these — silently, no exception. `export.py`
writes a parity fixture of 1,000 real rows and LightGBM's own predictions for
them; CI asserts max error < 1e-9 on every push.

**That parity test is the entire justification for allowing a second language.
Without it, do not split.**

## Setup

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export TRAIN_DSN='postgresql://…'      # a read-only role. This is the only credential.
```

## A full run

```sh
python build_dataset.py --stage admit --sql sql/train_admit_v1.sql \
    --from 2026-05-01 --to 2026-11-01 --purge-days 6 --out ../../var/train/admit

python evaluate.py --in ../../var/train/admit --out ../../var/train/admit
#   ← read report.md before continuing. This is the step the weekly cadence exists for.

python train.py    --in ../../var/train/admit --out ../../var/train/admit/model
python export.py   --model ../../var/train/admit/model --in ../../var/train/admit \
                   --out ../../var/train/admit/model
```

`var/` is gitignored. The two artefacts that are committed are
`ml/serve/fixtures/parity.json` and the `sql/` query whose sha the registry row
records.

## What promotion looks like

Insert a registry row with `role='challenger'`. It shadow-scores the same frozen
feature vectors the champion sees, writes a second decision row pointing at the
champion's with `shadow_of`, and changes nothing the product does. After several
days, run `checkPromotion` (TypeScript, `ml/serve/src/registry/promote.ts`). If
every gate passes, promotion is one transactional UPDATE.

Promotion is a database row, not a deploy. So is rollback.
