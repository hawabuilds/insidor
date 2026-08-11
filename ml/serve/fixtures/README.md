# `ml/serve/fixtures/`

One file lives here and it is generated, never hand-written.

## `parity.json`

Written by `ml/train/export.py` on every training run. Shape:

```jsonc
{
  "model":        { /* booster.dump_model() verbatim */ },
  "calibration":  { "x": [...], "y": [...] } ,   // or null
  "featureNames": ["ageMin", "distinctAuthors", ...],
  "rows":         [[1.0, 3, null, ...], ...],    // >= 1000 rows, featureNames order
  "expected":     [0.7213..., ...]               // LightGBM's OWN predictions
}
```

`src/parity.test.ts` asserts `max |typescript − python| <= 1e-9` over every row.

**This file is the entire justification for allowing Python in this repository.**
The tree walker reproduces LightGBM to 2.2e-16 on the happy path and is wrong by
up to 0.98 — silently, with no exception — on four model variants. Without an
oracle, the happy-path number is what ships and the divergence surfaces as a bad
month rather than a bug.

Rows are drawn from the training set, not synthesised, and deliberately include
rows with missing values. A fixture of only-complete rows cannot exercise the
branch where a naive walker is wrong by 0.92.

The fixture is committed. It is a few hundred KB, and a parity oracle that has to
be regenerated to run is a parity oracle that does not run.

## Until the first training run

There is no `parity.json` and the parity test skips with a reason. That is not a
hole: `checkPromotion` refuses any artefact whose metadata carries no parity
result (`M6_parity_missing`), so no model can reach production while this
directory is empty.
