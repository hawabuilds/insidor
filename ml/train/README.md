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
  build_dataset.py   internal.decisions ⋈ internal.labels      →  dataset.parquet
                     + census_<stage>.sql over the same           manifest.json
                     population with NO label filters, so         census.json
                     every exclusion has a count                  (exit 2 = not enough data)
        │
  train.py           LightGBM, three constraints locked,       →  model.txt
                     fitted on the `train` split only             train_meta.json
        │
  evaluate.py        walk-forward by time, purged, per day     →  report.md
        │
  export.py          artefact + sidecar + the parity oracle    →  artefact.json
                                                                  ../serve/fixtures/parity.json
        │
  pnpm --filter @insidor/ml-serve test    MEASURES |ts − py|  →  fixtures/parity-measured.json
        │
  export.py --stamp  copies the measurement into the artefact →  metadata.parity
        │
        └─ a registry row with role='challenger' → shadow-score for days → promote
```

One command per step, in that order. `run.sh` does not exist and should not:
a pipeline that can be run without reading the report is a pipeline whose report
does not get read.

`make_parity_oracle.py` sits outside that pipeline on purpose. It needs no labels
and no database, so it can prove the walker today — see
`../serve/fixtures/README.md`.

## The three things that must not be changed casually

**Evaluation is walk-forward by time, never a random split.** A random split
leaks the future into the past and flatters the model. This market changes regime
constantly, so a model must be shown to hold on a window it was not trained on.
`evaluate.py` also applies a **purge**: a training example decided on D−3 whose
six-day label window covers D shares outcome information with the test set, so
without the purge a walk-forward split still leaks.

**Report the distribution across test days, not the mean.** A mean over 60 days
hides exactly the regime episodes the product exists to catch.

**An insufficient dataset is a refusal, not a small one.** `build_dataset.py`
exits 2 — distinct from 1 — and writes no parquet when the train or test split is
below the floors declared at the top of that file, removing any stale
`dataset.parquet` on the way out so the next `train.py` cannot succeed on last
week's data. A model fitted on nine rows is worse than no model, because a model
gets served and no model does not.

**Censored labels are excluded and COUNTED.** The training query filters
`status = 'resolved'`, and a WHERE clause cannot report what it removed, so a
paired `census_<stage>_<version>.sql` runs over the same population with none of
the label filters. Its counts go in the manifest, in the run output and at the top
of `report.md`: label absent, pending, censored, unresolvable, and the two
exclusions applied to resolved rows. A dataset that quietly drops its hard cases
scores beautifully and generalises to nothing. Past a stated censoring ceiling the
build refuses — a labeller measuring only the windows it happened to observe is
measuring survivors.

★ **The evaluable present is always at least one label window behind now.** A
holdout needs `windowDays + purgeDays < holdoutDays`; with the 30-day
peak-multiple window and the 6-day purge, a 30-day holdout is empty before the
query runs, because every decision recent enough to be in it is too recent for its
outcome to have happened. `build_dataset.py` says so in those words rather than
reporting a zero.

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
python build_dataset.py --stage admit \
    --sql sql/train_admit_v1.sql --census sql/census_admit_v1.sql \
    --from 2026-05-01 --to 2026-11-01 --purge-days 6 --holdout-days 60 \
    --out ../../var/train/admit
#   ← exit 2 means NOT ENOUGH DATA. Read var/train/admit/census.json and stop.

python evaluate.py --in ../../var/train/admit --out ../../var/train/admit
#   ← read report.md before continuing. This is the step the weekly cadence exists for.
#     Fewer than --min-test-days test days is a refusal; --allow-thin overrides it
#     and stamps THIN on the report.

python train.py    --in ../../var/train/admit --out ../../var/train/admit/model
python export.py   --model ../../var/train/admit/model --in ../../var/train/admit \
                   --out ../../var/train/admit/model

pnpm --filter @insidor/ml-serve test          # measures |ts − py|. Not optional.
python export.py --stamp --out ../../var/train/admit/model
```

`var/` is gitignored. The committed artefacts are `ml/serve/fixtures/parity.json`,
`ml/serve/fixtures/walker-parity.json`, and the `sql/` queries whose shas the
registry row records.

## The environment, and one pin that moved

`requirements.txt` pins `lightgbm` and `scikit-learn` exactly and floors the rest,
because those two are the only libraries whose OUTPUT crosses into TypeScript: a
LightGBM dump is the artefact the walker reads, and sklearn's isotonic knots are
the calibrator that ships. On Python 3.14 the old pins for pandas, numpy, pyarrow
and scikit-learn have no wheels and build from source against a setuptools that no
longer ships `pkg_resources`, so the file could not be installed at all — which is
how it stayed unexecuted. `scikit-learn` moved 1.5.2 → 1.9.0 for that reason, and
that is only safe because the oracle now exists: a PAVA change would fail
`parity.test.ts`.

## What promotion looks like

Insert a registry row with `role='challenger'`. It shadow-scores the same frozen
feature vectors the champion sees, writes a second decision row pointing at the
champion's with `shadow_of`, and changes nothing the product does. After several
days, run `checkPromotion` (TypeScript, `ml/serve/src/registry/promote.ts`). If
every gate passes, promotion is one transactional UPDATE.

Promotion is a database row, not a deploy. So is rollback.
