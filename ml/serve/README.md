# `@insidor/ml-serve`

Loads a trained artefact and evaluates it. **This is the whole of machine
learning in production.** Zero runtime dependencies; imports only
`@insidor/contracts`.

| File | What it is |
|---|---|
| `src/lgbm.ts` | the tree walk, plus every refusal |
| `src/isotonic.ts` | pool-adjacent-violators, fit and apply |
| `src/artefact.ts` | the artefact envelope and its metadata sidecar |
| `src/scorer.ts` | the `Scorer` port a stage's Policy carries |
| `src/feature-hash.ts` | sha256 of the sorted key list — the shape of a vector |
| `src/registry/` | which artefact is live, and the promotion gates |

## The one thing that will bite

`predict()` is arithmetic and cannot fail. `loadModel()` is where everything
fails, on purpose, and it fails LOUDLY:

- a categorical split (`decision_type: "=="`, threshold `"0||1||2||7"`)
- a linear tree
- an unknown `missing_type`
- a binary objective with no sigmoid, or an objective we do not implement
- multiclass, or random-forest averaging

Each of those makes a naive walker wrong by between 0.15 and 0.98 in probability
space, **with no exception and no warning**. A model that is wrong by 0.9 looks
like a bad week, not like a bug. So none of them falls through to a default.

## Wiring it

```ts
const artefact = loadArtefact(JSON.parse(bytes));
const scorer = makeScorer(artefact, {
  expectFeatureSet: STORY_QUALIFY_V1,
  maxAbsentFeatureRatio: policy.ml.maxAbsentFeatureRatio,
});
// policy.scorers.qualify = scorer
```

The stage then writes `scorer.id` into the decision's `decider` field, and the
log joins to the same labels through the same subject id whether a rule or a
model decided. `'rule:qualify@3'` today, `'gbdt:qualify@2026-11-02'` in November.
The log does not care what decided.

## Promotion

A challenger scores the same frozen vector immediately after the champion, writes
a second decision row with `shadow_of` pointing at the champion's, and changes
nothing. After several days, `checkPromotion` runs fourteen gates and promotion is
one transactional UPDATE.

**Promotion is a database row, not a deploy. So is rollback.**
