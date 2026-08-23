# `ml/serve/fixtures/`

Generated, never hand-written. **This directory is the entire justification for
allowing Python in this repository.** The tree walker reproduces LightGBM to
2.2e-16 on the happy path and is wrong by up to 0.98 — silently, with no
exception — on four model variants. Without an oracle, the happy-path number is
what ships and the divergence surfaces as a bad month rather than a bug.

There are two oracles because there are two questions, and only one of them can
be answered before the first outcome label exists.

## `walker-parity.json` — committed, required, runs today

Written by `ml/train/make_parity_oracle.py`. Answers **"does this walker
implement LightGBM's arithmetic at all?"** — a property of the code, needing no
labels, no database and no outcome.

```jsonc
{
  "kind": "walker-conformance", "synthetic": true,
  "featureNames": ["ageMin", …],
  "rows":   [[1.0, 3, null, "+inf", …], …],   // null = missing; ±inf encoded
  "models": [
    { "name": "binary-nan-missing",          "model": {…}, "expectedPredict": […] },
    { "name": "binary-zero-as-missing",      "model": {…}, "expectedPredict": […] },
    { "name": "binary-clamped-inf-threshold", "model": {…}, "expectedPredict": […] }
  ],
  "calibration": { "x": […], "y": […] },
  "expectedCalibrated": […],                  // scikit-learn's OWN predict
  "featureHashCases":  [ { "names": […], "sha256": "…" }, … ],
  "isotonicFitCases":  [ { "points": […], "queries": […], "expected": […] }, … ]
}
```

**It is not a model and must never become one.** It is fitted on synthetic noise
so LightGBM emits a tree structure with real thresholds to walk. It grades no
subject and carries no population.

Its rows are **adversarial, not sampled**: exactly on each split threshold and one
ULP either side, on both edges of LightGBM's ±`float32(1e-35)` zero band, ±inf,
and all-missing. Sampling real rows — which the other fixture does, correctly —
cannot land on any of those, and they are where the walker's three branch clauses
interact.

Its **models** are adversarial too, and that half was added later. `missing_type`
NaN and Zero are the two the walker implements; the third model exists because
neither of them can put a **clamped infinite threshold** in front of it. LightGBM
answers a feature whose whole signal is its absence with `threshold=inf`, which
`dump_model()` clamps to `1e300`; the walker reads the dump and has to undo the
clamp. A target with real structure never produces such a split, so
`make_parity_oracle.py` fits one deliberately degenerate model — the target is
literally "feature 0 is missing" — and asserts before writing that the dump really
does carry a threshold at or above 1e300. Without it, deleting `unclampThreshold`
from `lgbm.ts` leaves every assertion here green.

A missing `walker-parity.json` is a **failure**, not a skip.

## `parity.json` — committed once a model exists

Written by `ml/train/export.py` on every training run. Answers **"does the walker
reproduce THIS model, on the rows it will actually meet?"** 1,000 rows drawn from
the real training set with missing values oversampled, plus rows built on this
model's own thresholds, and both LightGBM's and scikit-learn's outputs for them.

There is no `parity.json` today: `internal.labels` is empty, so no model exists.
`src/parity.test.ts` skips that one test with a reason. That is not a hole — the
walker is still verified by `walker-parity.json`, and `checkPromotion` refuses any
artefact whose metadata carries no parity result (`M6_parity_missing`).

## `parity-measured.json` — generated, gitignored

Written by `src/parity.test.ts` on every run: the worst error it actually
measured, per fixture, with the runtime and the fixture digests.

**This file exists because nothing else measured that number.** `export.py` used
to write `parity: {"rows": n, "maxAbsError": 0.0}` into the artefact with a
comment saying CI would overwrite the zero. Nothing did — so gate
`M7_parity_error_too_large` graded a literal `0.0` that was Python compared
against Python and could not have been anything else. The artefact now ships with
`parity: null`, and `python export.py --stamp` copies the real figure in only if
the fixture digest still matches.

It is not committed: it is a fact about one runtime on one machine at one moment,
and a committed copy would go stale while looking authoritative.

## The tolerances

| what | bar | why that number |
|---|---|---|
| tree walk, calibrated output | `1e-9` | Four orders looser than the float64 floor of 2.2e-16 a correct walker reaches, eight orders tighter than the smallest known silent divergence (0.15, a mis-read sigmoid). Nothing lands between by accident. |
| `fitIsotonic` vs scikit-learn | `1e-12` | Two PAVA implementations summing float64 in different orders over values in [0,1]. One pooling decision made differently moves a fitted value by O(0.01) — ten orders of clear air. |
| feature hash | exact | A digest has no tolerance. |

Last measured, on `walker-parity.json` over 3,219 rows: tree walk **1.1e-16** (NaN
missing), **2.2e-16** (Zero missing) and **8.7e-19** (clamped inf threshold),
calibrated output **0**, isotonic fit **1.1e-16**.

## What the oracle caught the first time it ran

Three real divergences, all silent, none reachable by inspection:

1. **The zero band was open at the bottom.** `isZero` was
   `v > -1e-35 && v <= 1e-35`; LightGBM's is inclusive at both ends. Worth up to
   0.168 in probability space.
2. **`kZeroThreshold` is not the double `1e-35`.** LightGBM declares it `1e-35f`,
   a float literal, so the real edge is `Math.fround(1e-35)` =
   1.0000000180025095e-35. Worth up to 0.029.
3. **`dump_model()` clamps infinite thresholds to `1e300`.** A "missing versus
   not" node stores `threshold=inf` in `model.txt` and `1e+300` in the JSON this
   walker reads, so every value above 1e300 — `+inf` included — took the wrong
   branch. Worth 0.0027 on the row that found it.

   ★ **But this one was NOT caught here, and that mattered.** It was found on a
   separate hand-built booster; the committed fixture's two models both had real
   structure, so neither ever emitted a clamped threshold, and the correction that
   came out of it sat in `lgbm.ts` unguarded. Measured, by deleting the unclamp
   and re-running: every assertion in `parity.test.ts` stayed green. The
   `binary-clamped-inf-threshold` model above closes it — the same deletion now
   fails by **0.97 in probability space**, the largest divergence any of these
   cases produces.

   The lesson is about the shape of the fixture, not this bug: the rows were
   adversarial from the start and the MODELS were not, so every branch that only a
   particular model can reach was untested no matter how extreme the inputs were.
