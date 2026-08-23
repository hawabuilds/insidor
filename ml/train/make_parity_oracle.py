"""Build the walker-conformance oracle: the proof that TypeScript reproduces Python.

OUTPUT  ml/serve/fixtures/walker-parity.json

★ WHY THIS FILE EXISTS SEPARATELY FROM export.py, WHICH ALSO WRITES A PARITY
  FIXTURE. They answer two different questions and only one of them can be
  answered today.

    export.py's fixtures/parity.json    "does the walker reproduce THIS MODEL, on
                                        rows drawn from the real training set?"
                                        Needs labels. There are none, so it does
                                        not exist and the test skips.

    this file's walker-parity.json      "does the walker implement LightGBM's
                                        arithmetic at all?" Needs no labels, no
                                        database, and no outcome. It is a
                                        property of the CODE.

  The second question was unanswered for the entire life of this repository, and
  it is the one the whole two-language split rests on. `lgbm.test.ts` builds model
  dumps by hand, so until this file ran the walker had never once been compared to
  the library it imitates. A test that skips is not a guarantee, and the promotion
  gate that was supposed to cover for it (M6) only fires when someone tries to
  promote — which is months after the divergence would have been introduced.

★ THIS IS NOT A MODEL AND MUST NEVER BECOME ONE. It is fitted on synthetic noise
  with a synthetic target, purely so that LightGBM emits a tree structure with
  real thresholds to walk. Its metadata says so in the file. It carries no
  population, grades no subject, and predicts nothing about the world. The
  fixture the PRODUCT eventually trusts is export.py's, drawn from real rows.

★ WHAT IT COVERS, AND WHY THESE THREE. Three things cross the language boundary
  and each has its own failure mode:

    1. the tree walk        wrong by up to 0.98 in probability space, silently,
                            on a categorical split / linear tree / mis-read
                            sigmoid / mishandled missing value
    2. the calibrator       LightGBM's dump does NOT contain it. If the two
                            implementations of pool-adjacent-violators disagree,
                            the tree walk still matches, the model parity test
                            still passes, and every served probability is wrong —
                            and because policy bars are compared against a
                            CALIBRATED number, the whole board shifts with no
                            failing test. This is the more dangerous of the two
                            and it had no oracle at all.
    3. the feature hash     if Python and TypeScript hash the same key list
                            differently, every artefact Python produces is
                            rejected at load — or worse, champion-versus-
                            challenger comparisons compare two alphabets.

★ THE ROWS ARE ADVERSARIAL ON PURPOSE. Sampling real rows and oversampling
  missing values — which export.py does, and which is the best decision in that
  file — still cannot produce a value sitting EXACTLY on a split threshold, a
  value inside LightGBM's ±1e-35 zero band, an all-missing row, or ±inf. Those
  are precisely where the walker's three branch clauses interact. So the row set
  here is built FROM THE MODEL'S OWN THRESHOLDS after training.

WHAT BREAKS IF THIS IS CHANGED CARELESSLY: nothing visible, immediately, which is
the danger. Weakening the row set leaves a green test that no longer exercises
the branch it was written for. If a case is removed, say which failure mode is
now unguarded.

Run:
    python make_parity_oracle.py            # writes ../serve/fixtures/walker-parity.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
from sklearn.isotonic import IsotonicRegression

from train import LOCKED  # ★ the SAME constraints. An oracle trained differently proves nothing.

# Small on purpose: the fixture is committed, and a parity oracle that has to be
# regenerated to run is a parity oracle that does not run. Twelve features and a
# seventy shallow trees is more than enough tree structure to walk: the measured
# error is the float64 rounding floor either way, and a fixture nobody wants to
# pull is a fixture that gets deleted.
# LightGBM's `Common::AvoidInf` clamp — the value `dump_model()` emits where the
# native model.txt carries `inf`. Spelled here so the assertion below names the
# same number lgbm.ts does rather than a coincidentally equal literal.
AVOID_INF = 1e300

N_ROWS = 6000
N_FEATURES = 12
N_ROUNDS = 70
SAMPLED_ROWS = 600
MISSING_RATE = 0.18

FEATURE_NAMES = [
    "ageMin",
    "carrierCount",
    "distinctAuthors",
    "engagementBait",
    "formatCount",
    "horizonS",
    "isRebroadcast",
    "langKnown",
    "namedSpanPresent",
    "reproductionLevel",
    "storyMembers",
    "textLen",
]


def missingness_target(x: np.ndarray) -> np.ndarray:
    """A target that is EXACTLY "feature 0 has no reading".

    ★ WHY A THIRD, DELIBERATELY DEGENERATE TARGET EXISTS IN THIS FILE.

    LightGBM answers a feature whose whole signal is its absence with a "missing
    versus everything" split, and it spells that split as a threshold of `inf`.
    `model.txt` stores `inf`; `dump_model()` does not — it passes every threshold
    through `Common::AvoidInf`, which clamps it to exactly 1e300. The serving
    walker reads the DUMP, so it reads 1e300 and must undo the clamp
    (`unclampThreshold` in lgbm.ts) or it answers `+inf <= 1e300` = false and
    sends every infinite feature value down the branch LightGBM never sends it
    down.

    The two models above cannot exercise that branch: their targets have real
    structure, so every threshold they emit is an ordinary finite midpoint, and
    `thresholds_of` never sees 1e300. Measured, not assumed — disabling the
    unclamp in lgbm.ts left every parity assertion green. The walker's subtlest
    correction, the one its own comment says was verified against a real booster,
    was the one thing in this file's remit that nothing here checked.

    So: a target learnable ONLY through missingness, which forces the clamped
    threshold into the dump, over the same twelve features and the same row set —
    where `+inf`, `1e308` and one ULP above 1e300 already sit on index 0.

    It is not a claim about the world and it is not a model. Neither are the
    other two.
    """
    return np.isnan(x[:, 0]).astype(int)


def synthesise(rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """A feature matrix with missing values and a target with real structure.

    The target has to be learnable or LightGBM emits a single-leaf stump with no
    thresholds to stand on, and a walker that agrees with a constant agrees with
    nothing. It does not have to be REALISTIC — no claim about the world is made
    anywhere in this file.
    """
    x = rng.normal(size=(N_ROWS, N_FEATURES))
    x[:, 1] = rng.poisson(3.0, size=N_ROWS).astype(float)
    x[:, 6] = (rng.random(N_ROWS) < 0.3).astype(float)
    x[:, 7] = (rng.random(N_ROWS) < 0.8).astype(float)
    x[:, 11] = rng.integers(0, 400, size=N_ROWS).astype(float)

    logit = 1.2 * x[:, 0] - 0.8 * x[:, 2] + 0.6 * x[:, 1] * x[:, 6] - 0.004 * x[:, 11] - 1.0
    y = (rng.random(N_ROWS) < 1.0 / (1.0 + np.exp(-logit))).astype(int)

    # Missing AFTER the target is drawn, so "missing" carries no signal of its own
    # and the model must actually take the missing branch rather than learn a
    # shortcut through it.
    mask = rng.random((N_ROWS, N_FEATURES)) < MISSING_RATE
    x[mask] = np.nan
    return x, y


def thresholds_of(dump: dict) -> list[tuple[int, float]]:
    """Every (feature index, threshold) pair in the forest, in walk order."""
    found: list[tuple[int, float]] = []

    def walk(node: dict) -> None:
        if "split_feature" in node:
            t = node.get("threshold")
            if isinstance(t, (int, float)) and np.isfinite(t):
                found.append((int(node["split_feature"]), float(t)))
            walk(node["left_child"])
            walk(node["right_child"])

    for tree in dump.get("tree_info", []):
        walk(tree["tree_structure"])
    return found


def adversarial_rows(dump: dict, base: np.ndarray, rng: np.random.Generator) -> list[list[float]]:
    """Rows built to land exactly where the three branch clauses interact.

    A sampled row almost never sits on a threshold. LightGBM's decision is
    `value <= threshold`, so the row that distinguishes a correct walker from an
    off-by-one-comparison walker is the one where those two are bit-identical —
    and it has to be constructed, because float arithmetic will not hand it to
    you by accident.

    The ±1e-35 band is LightGBM's `kZeroThreshold`: values inside it are treated
    as zero when deciding the default direction for a `missing_type=Zero` model,
    and the walker transcribes that constant. Nothing samples into it either.
    """
    medians = np.nanmedian(base, axis=0)
    rows: list[list[float]] = []

    def row_with(index: int, value: float) -> list[float]:
        r = list(medians)
        r[index] = value
        return [float(v) for v in r]

    # 1. Exactly on the threshold, and one ULP either side of it. The <= is the
    #    whole decision; these three rows are what make it observable.
    pairs = thresholds_of(dump)
    if not pairs:
        raise SystemExit("the synthetic model has no numeric splits; there is nothing to walk")
    step = max(1, len(pairs) // 120)
    for feature_index, t in pairs[::step]:
        rows.append(row_with(feature_index, t))
        rows.append(row_with(feature_index, np.nextafter(t, -np.inf)))
        rows.append(row_with(feature_index, np.nextafter(t, np.inf)))

    # 2. The zero band, both signs, plus both zeros. -0.0 <= 0.0 is true and
    #    -0.0 === 0.0 is true, so a walker that special-cases sign is wrong here.
    #
    #    ★ kZeroThreshold IS NOT THE DOUBLE 1e-35. LightGBM declares it
    #    `const double kZeroThreshold = 1e-35f;` — a float literal widened — so
    #    the real edge is float32(1e-35) = 1.0000000180025095e-35, a hair ABOVE
    #    the double. Both edges are included exactly, and one ULP either side of
    #    each, because that shell is the only place the two constants disagree
    #    and nothing samples into it.
    edge = float(np.float64(np.float32(1e-35)))
    band = [
        0.0,
        -0.0,
        1e-35,
        -1e-35,
        1e-36,
        -1e-36,
        1e-34,
        -1e-34,
        edge,
        -edge,
        float(np.nextafter(edge, np.inf)),
        float(np.nextafter(edge, 0.0)),
        float(np.nextafter(-edge, -np.inf)),
        float(np.nextafter(-edge, 0.0)),
    ]
    for value in band:
        for feature_index in (0, 1, 11):
            rows.append(row_with(feature_index, value))

    # 3. Infinities and the extremes of the float range. A threshold is finite, so
    #    these must fall on a definite side rather than into NaN comparison.
    for value in (np.inf, -np.inf, 1e308, -1e308, 1e-308):
        for feature_index in (0, 2, 5):
            rows.append(row_with(feature_index, value))

    # 4. Every value missing. The default direction alone decides the leaf, which
    #    is the branch a naive walker gets wrong by 0.92.
    rows.append([float("nan")] * N_FEATURES)

    # 5. One missing at a time, everything else at the median.
    for feature_index in range(N_FEATURES):
        rows.append(row_with(feature_index, float("nan")))

    # 6. Ordinary sampled rows, carrying the missing values the real data has.
    picks = rng.choice(len(base), size=min(SAMPLED_ROWS, len(base)), replace=False)
    for i in picks:
        rows.append([float(v) for v in base[i]])

    return rows


def encode_value(v: float) -> float | str | None:
    """One feature value, in a form JSON can actually carry.

    ★ JSON HAS NO INFINITY AND NO NaN. Python's json.dumps emits the bare tokens
    `Infinity` and `NaN` by default; `JSON.parse` rejects both, so a fixture
    written the obvious way is a fixture the test cannot open — and the natural
    "fix" is to drop the infinite rows, which silently deletes the coverage they
    were added for. So they are encoded, explicitly, and the TypeScript side
    decodes them back. Missing stays `null`, matching FeatureVector's own
    vocabulary where null means "no reading".
    """
    if np.isnan(v):
        return None
    if np.isposinf(v):
        return "+inf"
    if np.isneginf(v):
        return "-inf"
    return float(v)


def feature_hash(names: list[str]) -> str:
    """The serving-side hash: count, newline, names sorted by CODE POINT.

    `sorted()` in Python orders by code point. JavaScript's default `.sort()`
    orders by UTF-16 code unit, and the two disagree for any name containing a
    character above the Basic Multilingual Plane — an astral character sorts
    BELOW U+E000..U+FFFF in UTF-16 and above it by code point. Every feature name
    in this system today is ASCII, so the two agree and always have; the case
    below is here so that the day one does not, a test fails instead of an
    artefact being silently rejected at load.
    """
    payload = f"{len(names)}\n" + "\n".join(sorted(names))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def feature_hash_cases() -> list[dict]:
    """Name lists chosen to break a hash that is nearly right."""
    lists = [
        ("the synthetic set", FEATURE_NAMES),
        ("empty", []),
        ("one name", ["ageMin"]),
        # Prefix collision: ["ab","c"] and ["a","bc"] join to the same string
        # without the count prefix and the newline separator.
        ("prefix collision A", ["ab", "c"]),
        ("prefix collision B", ["a", "bc"]),
        # Order must not matter — the hash is of a SET presented in sorted order.
        ("unsorted input", ["zeta", "Alpha", "_leading", "a1", "A1"]),
        ("ascii boundaries", ["Z", "a", "_", "0", "~"]),
        ("bmp non-ascii", ["é", "ü", "日本語", "zz"]),
        # ★ THE ONE THAT MATTERS. U+FFFD sorts before U+1D51E by code point and
        # after it by UTF-16 code unit. A JavaScript `.sort()` with no comparator
        # produces a different order here, and therefore a different digest.
        ("astral vs bmp", ["a", "�", "\U0001d51e"]),
        ("astral only", ["\U0001f34e", "\U0001d51e", "\U000e0041"]),
    ]
    return [{"name": name, "names": names, "sha256": feature_hash(names)} for name, names in lists]


def isotonic_cases(rng: np.random.Generator) -> list[dict]:
    """sklearn's calibrator, its knots, and its answers on a dense query grid.

    ★ COMPARED AS A FUNCTION, NOT AS A KNOT ARRAY. Both implementations drop
    redundant interior points, and they are entitled to drop different ones: two
    knot lists can differ while describing the same piecewise-linear function.
    The claim that matters at serving time is "the same score maps to the same
    probability", so that is what is asserted. The knots are carried anyway, for
    a diagnosis when the function disagrees.

    Queries include every knot exactly, the midpoints between them, and points
    outside both ends — the clip semantics are where a calibrator starts emitting
    1.03 and nobody notices until a bar is crossed.
    """

    def case(name: str, x: np.ndarray, y: np.ndarray, w: np.ndarray | None) -> dict:
        iso = IsotonicRegression(out_of_bounds="clip").fit(x, y, sample_weight=w)
        knots_x = [float(v) for v in iso.X_thresholds_]
        knots_y = [float(v) for v in iso.y_thresholds_]

        queries: list[float] = list(knots_x)
        for a, b in zip(knots_x, knots_x[1:]):
            queries.append((a + b) / 2.0)
        queries += [float(x.min()) - 1.0, float(x.max()) + 1.0, float(x.min()), float(x.max())]
        queries += [float(v) for v in np.linspace(float(x.min()) - 0.5, float(x.max()) + 0.5, 60)]
        queries = sorted(set(queries))

        return {
            "name": name,
            "points": [
                {"x": float(xi), "y": float(yi), "w": float(wi)}
                for xi, yi, wi in zip(x, y, np.ones_like(x) if w is None else w)
            ],
            "sklearnKnots": {"x": knots_x, "y": knots_y},
            "queries": queries,
            "expected": [float(v) for v in iso.predict(np.array(queries))],
        }

    cases = []

    # Already monotone: PAVA must change nothing, and the collinear-point dropper
    # must not change the function while shrinking the artefact.
    x = np.linspace(0.0, 1.0, 40)
    cases.append(case("already monotone, collinear", x, x.copy(), None))

    # Violations everywhere: this is what pooling is for.
    x = np.linspace(0.0, 1.0, 200)
    y = np.clip(x + rng.normal(0, 0.35, size=x.size), 0.0, 1.0)
    cases.append(case("noisy, heavy pooling", x, y, None))

    # Ties on x with disagreeing y. Two rows with the same score and different
    # outcomes are ONE weighted point, not a monotonicity violation.
    x = np.repeat(np.linspace(0.0, 1.0, 25), 4)
    y = (rng.random(x.size) < x).astype(float)
    cases.append(case("ties on x", x, y, None))

    # Weights that are not 1. IPS × recency × log means the real calibrator is
    # always weighted, and an unweighted implementation passes every other test.
    x = np.sort(rng.random(150))
    y = (rng.random(150) < x).astype(float)
    w = rng.gamma(2.0, 1.5, size=150) + 0.05
    cases.append(case("weighted", x, y, w))

    # Degenerate shapes, where an implementation with an off-by-one in the block
    # merge produces a plausible wrong answer rather than an error.
    cases.append(case("two points", np.array([0.1, 0.9]), np.array([1.0, 0.0]), None))
    cases.append(case("constant y", np.linspace(0, 1, 12), np.full(12, 0.42), None))
    cases.append(case("strictly decreasing", np.linspace(0, 1, 12), np.linspace(1, 0, 12), None))

    # The realistic shape: scores clustered low, a low positive rate, one long
    # flat run at zero. This is what the served calibrator actually looks like.
    x = np.sort(rng.beta(1.4, 9.0, size=400))
    y = (rng.random(400) < np.clip(x * 2.0, 0, 1)).astype(float)
    cases.append(case("low base rate, clustered scores", x, y, None))

    return cases


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out", type=Path, default=Path("../serve/fixtures"))
    p.add_argument("--seed", type=int, default=20260823)
    args = p.parse_args()

    rng = np.random.default_rng(args.seed)
    x, y = synthesise(rng)

    def train(extra: dict, label: np.ndarray | None = None) -> lgb.Booster:
        dataset = lgb.Dataset(
            x,
            label=y if label is None else label,
            feature_name=FEATURE_NAMES,
            categorical_feature=[],  # ★ explicit, and empty, exactly as train.py does
            free_raw_data=False,
        )
        params = {
            "learning_rate": 0.05,
            "num_leaves": 12,
            "min_data_in_leaf": 40,
            "verbosity": -1,
            **extra,
            **LOCKED,
        }
        return lgb.train(params, dataset, num_boost_round=N_ROUNDS)

    # Three models, because the walker implements three things that only a real
    # booster can put in front of it, and only one of them occurs in production.
    #   NaN      what train.py produces.
    #   Zero     reachable through the dump format, so the walker accepts it, so
    #            it is walked here. An accepted branch that is never exercised is
    #            a branch that is wrong.
    #   clamped  a dump carrying AvoidInf's 1e300 in place of an `inf` threshold.
    #            See `missingness_target`: nothing else in this file can produce
    #            one, and without it `unclampThreshold` is unguarded.
    nan_model = train({})
    zero_model = train({"zero_as_missing": True})
    clamped_model = train({}, label=missingness_target(x))

    nan_dump = nan_model.dump_model()
    zero_dump = zero_model.dump_model()
    clamped_dump = clamped_model.dump_model()

    # ★ REFUSE TO WRITE A FIXTURE THAT DOES NOT CARRY THE CASE IT WAS ADDED FOR.
    # A future LightGBM that spells this split some other way would otherwise
    # produce a green oracle silently missing the branch again, which is exactly
    # how it went unguarded the first time.
    if not any(t >= AVOID_INF for _, t in thresholds_of(clamped_dump)):
        raise SystemExit(
            "the clamped-threshold model emitted no threshold at or above 1e300. "
            f"lightgbm {lgb.__version__} no longer spells a missing-versus-rest split as an "
            "infinite threshold, or the synthetic target stopped forcing one. Fix the target "
            "or delete the model AND say in lgbm.ts that unclampThreshold is unguarded."
        )

    rows = (
        adversarial_rows(nan_dump, x, rng)
        + adversarial_rows(zero_dump, x, rng)
        + adversarial_rows(clamped_dump, x, rng)
    )
    matrix = np.array(rows, dtype=float)

    raw_nan = nan_model.predict(matrix)
    raw_zero = zero_model.predict(matrix)
    # ★ `predict` walks the NATIVE booster, where the threshold is still `inf`.
    # That is the whole point: the fixture's model is the lossy dump, its answers
    # are the lossless ones, and the walker has to bridge the two.
    raw_clamped = clamped_model.predict(matrix)

    # The calibrator, fitted the way export.py fits it, on the model's own scores.
    in_sample = nan_model.predict(x)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(in_sample, y)
    calibration = {
        "x": [float(v) for v in iso.X_thresholds_],
        "y": [float(v) for v in iso.y_thresholds_],
        "outOfBounds": "clip",
        "n": int(len(in_sample)),
    }
    # ★ sklearn's OWN predict, not np.interp. export.py used np.interp, which made
    # its oracle prove that TypeScript agrees with numpy — a claim nobody needed.
    # The calibrator that ships is sklearn's, so sklearn is what must be matched.
    calibrated_nan = iso.predict(raw_nan)

    fixture = {
        "kind": "walker-conformance",
        "synthetic": True,
        "note": (
            "NOT A MODEL. Fitted on synthetic noise so that LightGBM emits a tree structure "
            "with real thresholds to walk. It grades no subject, carries no population, and "
            "must never be loaded as an artefact. The product's oracle is fixtures/parity.json, "
            "written by export.py from real rows."
        ),
        "generatedBy": "ml/train/make_parity_oracle.py",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trainer": f"lightgbm=={lgb.__version__}",
        "locked": LOCKED,
        "featureNames": FEATURE_NAMES,
        "rows": [[encode_value(float(v)) for v in row] for row in matrix],
        "models": [
            {
                "name": "binary-nan-missing",
                "missingType": "NaN",
                "model": nan_dump,
                "expectedPredict": [float(v) for v in raw_nan],
            },
            {
                "name": "binary-zero-as-missing",
                "missingType": "Zero",
                "model": zero_dump,
                "expectedPredict": [float(v) for v in raw_zero],
            },
            {
                "name": "binary-clamped-inf-threshold",
                "missingType": "NaN",
                "model": clamped_dump,
                "expectedPredict": [float(v) for v in raw_clamped],
            },
        ],
        "calibration": calibration,
        "calibratedModel": "binary-nan-missing",
        "expectedCalibrated": [float(v) for v in calibrated_nan],
        "featureHashCases": feature_hash_cases(),
        "isotonicFitCases": isotonic_cases(rng),
    }

    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / "walker-parity.json"
    # allow_nan=False so a stray NaN or Infinity anywhere in this structure is a
    # crash here rather than an unparseable fixture discovered in CI.
    path.write_text(json.dumps(fixture, separators=(",", ":"), allow_nan=False), encoding="utf-8")

    size_kb = path.stat().st_size / 1024
    print(f"wrote {path}  ({size_kb:.0f} KB)")
    print(f"  rows            {len(rows)}  (adversarial + sampled, every model's thresholds)")
    print(f"  models          {len(fixture['models'])}  missing_type NaN, Zero, and a clamped inf threshold")
    print(f"  calibration     {len(calibration['x'])} knots over {calibration['n']} rows")
    print(f"  hash cases      {len(fixture['featureHashCases'])}")
    print(f"  isotonic cases  {len(fixture['isotonicFitCases'])}")
    print("")
    print("Now run:  pnpm --filter @insidor/ml-serve test")


if __name__ == "__main__":
    main()
