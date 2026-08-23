"""Write the artefact that crosses into TypeScript, plus the oracle that proves it.

INPUT   <model>/model.txt, <model>/train_meta.json   (from train.py)
        <in>/dataset.parquet                          (for calibration + parity rows)
OUTPUT  <out>/artefact.json              model + metadata sidecar + calibration
        ml/serve/fixtures/parity.json    ★ the CI oracle

TWO ARTEFACTS CROSS THE LANGUAGE BOUNDARY AND NEITHER IS CODE: this JSON file,
and one registry row. Nothing under services/ imports Python, shells out to it,
or waits on it. If Python were deleted from the machine at 3am, the system would
keep making decisions with the artefact it already has.

★ THE PARITY FIXTURE IS THE ENTIRE JUSTIFICATION FOR ALLOWING A SECOND LANGUAGE.
The TypeScript tree walker reproduces LightGBM to 2.2e-16 on numeric features
with no missing values, and is wrong by up to 0.98 — silently, no exception — on
categorical splits, on linear trees, on a non-unit sigmoid and on missing values.
This script writes 1,000 real rows plus rows built on the model's own thresholds,
with LightGBM's and scikit-learn's own outputs for them; CI asserts max error
< 1e-9 on every push. Without that test, do not split.

This fixture answers "does the walker reproduce THIS MODEL?" and needs a model to
exist. `ml/train/make_parity_oracle.py` answers the prior question — "does the
walker implement LightGBM's arithmetic at all?" — needs no labels and no
database, and therefore runs today. Both feed the same test.

The rows are SAMPLED TO INCLUDE MISSING VALUES on purpose. A fixture of only
complete rows cannot exercise the branch where a naive walker is wrong by 0.92,
which is the branch most likely to be wrong. They are ALSO joined by rows built
from this model's own split thresholds — a sampled row never lands exactly on a
threshold, and `value <= threshold` is the whole decision.

★ THE PARITY FIELD IS WRITTEN BY WHOEVER MEASURED IT, WHICH IS NOT THIS FILE.

This script used to write `parity: {"rows": n, "maxAbsError": 0.0}` with a comment
saying CI would overwrite the zero. Nothing overwrote it. Promotion gate
M7_parity_error_too_large then evaluated `0.0 <= maxParityError`, which is true
for every policy — the one gate that exists to catch a cross-language divergence,
permanently satisfied by a placeholder that could only ever be zero, because the
number it stood for is Python compared against Python.

So the artefact now ships with `parity: null`, which fails M6_parity_missing
loudly, and the real figure arrives by a second, explicit step:

    python export.py  --model … --in … --out …     writes artefact + fixture
    pnpm --filter @insidor/ml-serve test           MEASURES it, writes
                                                   fixtures/parity-measured.json
    python export.py --stamp --out …               copies the measurement in,
                                                   but only if the fixture digest
                                                   still matches

Three commands where there was one, and the middle one is a different process in
a different language — which is the entire point. A number nobody measured must
not be able to satisfy the gate that asks for a measurement.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

# One implementation of "a row that lands exactly on a split threshold", shared
# with the walker-conformance oracle. Two implementations of the same adversarial
# construction is two chances for one of them to stop being adversarial.
from make_parity_oracle import encode_value, thresholds_of

PARITY_ROWS = 1000
TRAINER = "lightgbm"


def calibration_from(
    booster: lgb.Booster, recent: pd.DataFrame, names: list[str]
) -> tuple[dict, IsotonicRegression]:
    """Fit the isotonic calibrator on the last resolved days and export its knots.

    LightGBM's dump does NOT contain the calibrator — it is a separate artefact
    with its own interpolation and out-of-bounds semantics, and exporting it is a
    deliberate act rather than a side effect.

    The TypeScript implementation of pool-adjacent-violators is what runs the
    DAILY recalibration, with no Python anywhere near it, so its agreement with
    scikit-learn is load-bearing and was for a long time asserted in prose only.
    It is now measured: `ml/train/make_parity_oracle.py` writes eight weighted
    fit cases with sklearn's own answers on a dense query grid, and
    `parity.test.ts` compares the fitted FUNCTIONS — the last run put the worst
    disagreement at 1.1e-16, one unit in the last place. This function only seeds
    the first calibrator; the daily ones never come back here.
    """
    scores = booster.predict(recent[names].astype(float))
    y = recent["y"].astype(bool).astype(int).to_numpy()
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(scores, y)
    # The estimator is returned alongside its knots so the oracle can be built
    # from sklearn's OWN predict. This used to be np.interp, which made the
    # fixture prove that TypeScript agrees with numpy — a claim nobody needed,
    # about a library that does not ship the calibrator.
    return (
        {
            "x": [float(v) for v in iso.X_thresholds_],
            "y": [float(v) for v in iso.y_thresholds_],
            "outOfBounds": "clip",
            "n": int(len(recent)),
        },
        iso,
    )


def parity_rows(df: pd.DataFrame, names: list[str], rng: np.random.Generator) -> pd.DataFrame:
    """Sample rows for the oracle, oversampling rows that carry missing values."""
    has_missing = df[names].isna().any(axis=1)
    incomplete = df[has_missing]
    complete = df[~has_missing]

    want_incomplete = min(len(incomplete), PARITY_ROWS // 4)
    want_complete = min(len(complete), PARITY_ROWS - want_incomplete)
    picked = pd.concat(
        [
            incomplete.sample(want_incomplete, random_state=int(rng.integers(1 << 31))) if want_incomplete else incomplete.head(0),
            complete.sample(want_complete, random_state=int(rng.integers(1 << 31))) if want_complete else complete.head(0),
        ]
    )
    if len(picked) < PARITY_ROWS:
        raise SystemExit(
            f"only {len(picked)} rows available for the parity fixture; {PARITY_ROWS} required. "
            "A thin oracle is not an oracle."
        )
    return picked


def threshold_rows(dump: dict, x: pd.DataFrame, names: list[str]) -> list[list[float]]:
    """Rows sitting exactly on this model's own split thresholds, and one ULP either side.

    ★ SAMPLING CANNOT PRODUCE THESE. `parity_rows` above draws real rows and
    oversamples missing values, which is the right thing and is not sufficient:
    the comparison a tree makes is `value <= threshold`, and the row that
    separates a correct walker from one with the inequality the wrong way round
    is the one where the two are bit-identical. Float arithmetic will not hand
    that row to you by accident in a thousand draws or a million.
    """
    medians = x[names].median(numeric_only=True)
    base = [float(medians.get(n, 0.0)) for n in names]
    pairs = thresholds_of(dump)
    rows: list[list[float]] = []
    step = max(1, len(pairs) // 150)
    for feature_index, t in pairs[::step]:
        for value in (t, float(np.nextafter(t, -np.inf)), float(np.nextafter(t, np.inf))):
            row = list(base)
            row[feature_index] = value
            rows.append(row)
    # Every value missing: the default direction alone decides the leaf, which is
    # the branch a naive walker is wrong by 0.92 on.
    rows.append([float("nan")] * len(names))
    return rows


def feature_hash(names: list[str]) -> str:
    """Must match ml/serve/src/feature-hash.ts exactly."""
    payload = f"{len(names)}\n" + "\n".join(sorted(names))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def stamp(out: Path, fixtures: Path) -> None:
    """Copy the CROSS-LANGUAGE measurement into the artefact, or refuse.

    The only process that can measure `max |typescript − python|` is the one that
    runs both halves, and that is `ml/serve/src/parity.test.ts`. It writes the
    figure to `fixtures/parity-measured.json` along with the sha256 of the fixture
    it measured. This checks that digest against the fixture on disk before
    copying anything: a measurement of a fixture that has since been regenerated
    is a measurement of a different model, and stamping it would put a real number
    that was honestly obtained in front of an artefact it does not describe —
    which is worse than the placeholder it replaces, because it looks earned.
    """
    artefact_path = out / "artefact.json"
    measured_path = fixtures / "parity-measured.json"
    fixture_path = fixtures / "parity.json"

    for p in (artefact_path, measured_path, fixture_path):
        if not p.exists():
            raise SystemExit(f"{p} does not exist. Run export, then the TypeScript test, then --stamp.")

    measured = json.loads(measured_path.read_text(encoding="utf-8"))
    result = measured.get("artefact")
    if result is None:
        raise SystemExit(
            "parity-measured.json carries no `artefact` result — the TypeScript test skipped it, "
            "which means fixtures/parity.json did not exist when the test ran. Run the test again."
        )

    on_disk = hashlib.sha256(fixture_path.read_bytes()).hexdigest()
    if result.get("sha256") != on_disk:
        raise SystemExit(
            f"the measurement was taken against fixture {str(result.get('sha256'))[:12]} but "
            f"fixtures/parity.json is now {on_disk[:12]}. Re-run the test; a stale measurement "
            "describes a model that is no longer here."
        )

    artefact = json.loads(artefact_path.read_text(encoding="utf-8"))
    worst = max(float(result["modelMaxAbsError"]), float(result["calibrationMaxAbsError"]))
    artefact["metadata"]["parity"] = {"rows": int(result["rows"]), "maxAbsError": worst}
    artefact_path.write_text(json.dumps(artefact, sort_keys=True), encoding="utf-8")

    print(f"stamped parity: {result['rows']} rows, max |ts − py| = {worst:.3e}")
    print(f"  measured {measured.get('measuredAt')} on {measured.get('runtime')}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", type=Path)
    p.add_argument("--in", dest="src", type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--fixtures", type=Path, default=Path("../serve/fixtures"))
    p.add_argument("--calibration-days", type=int, default=7)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--stamp",
        action="store_true",
        help="copy the measured cross-language parity into an already-written artefact",
    )
    args = p.parse_args()

    if args.stamp:
        stamp(args.out, args.fixtures)
        return
    if args.model is None or args.src is None:
        raise SystemExit("--model and --in are required unless --stamp is given")

    meta = json.loads((args.model / "train_meta.json").read_text(encoding="utf-8"))
    manifest = meta["manifest"]
    names: list[str] = manifest["featureNames"]
    booster = lgb.Booster(model_file=str(args.model / "model.txt"))

    df = pd.read_parquet(args.src / "dataset.parquet")
    df["decided_at"] = pd.to_datetime(df["decided_at"], utc=True)

    if feature_hash(names) != manifest["featureHash"]:
        raise SystemExit("feature hash disagrees with the manifest; the dataset and the model are not the same shape")

    # ★ The calibrator is fitted on RESOLVED rows only, and only on the training
    # side of the wall. Fitting it on the holdout would calibrate against the
    # period the report is about, and a calibrator is a model — a small one, but
    # one that can memorise a test period just as well as a large one.
    if "split" in df.columns:
        df = df[df["split"] == "train"]
    cutoff = df["decided_at"].max() - pd.Timedelta(days=args.calibration_days)
    calibration, iso = calibration_from(booster, df[df["decided_at"] >= cutoff], names)

    dump = booster.dump_model()
    if dump.get("feature_names") != names:
        raise SystemExit("model feature order disagrees with the manifest; split_feature is an index into that order")

    # ---- the artefact -------------------------------------------------------
    metadata = {
        "artefactId": f"gbdt:{manifest['stage']}@{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')}",
        "stage": manifest["stage"],
        "featureSet": manifest["featureSet"],
        "featureNames": names,
        "featureHash": manifest["featureHash"],
        "trainedAt": int(datetime.now(timezone.utc).timestamp() * 1000),
        "trainingWindow": manifest["trainingWindow"],
        "population": manifest["population"],
        "label": manifest["label"],
        "datasetSql": manifest["datasetSql"],
        "rowCount": manifest["rowCount"],
        "positiveCount": manifest["positiveCount"],
        "objective": dump.get("objective", ""),
        "sigmoid": float(meta["params"]["sigmoid"]),
        "categoricalFeatures": 0,
        "linearTree": bool(meta["params"]["linear_tree"]),
        "parity": None,  # filled in below, once measured
        "trainer": f"{TRAINER}=={lgb.__version__}",
        "artefactSha256": "",  # filled in below, once the bytes exist
    }

    # ---- the oracle ---------------------------------------------------------
    rng = np.random.default_rng(args.seed)
    sampled = parity_rows(df, names, rng)
    matrix = np.vstack(
        [
            sampled[names].astype(float).to_numpy(),
            np.array(threshold_rows(dump, df, names), dtype=float),
        ]
    )
    predicted = booster.predict(matrix)
    calibrated = iso.predict(predicted)

    fixture = {
        "model": dump,
        "calibration": calibration,
        "featureNames": names,
        # Values are encoded, not raw: JSON has no NaN and no Infinity, and
        # Python's bare `NaN` token is rejected by JSON.parse. null is missing.
        "rows": [[encode_value(float(v)) for v in row] for row in matrix],
        # Two expectations, kept apart so a failure names the guilty layer. The
        # tree walk and the calibrator fail for different reasons and one of them
        # is invisible in the other's number.
        "expectedPredict": [float(v) for v in predicted],
        "expectedCalibrated": [float(v) for v in calibrated],
    }

    args.fixtures.mkdir(parents=True, exist_ok=True)
    (args.fixtures / "parity.json").write_text(
        json.dumps(fixture, separators=(",", ":"), allow_nan=False), encoding="utf-8"
    )

    # ★ NULL, NOT ZERO. Nothing in this process can measure the distance between
    # two languages, so nothing here writes a number for it. `null` fails gate
    # M6_parity_missing, which is the correct state for an artefact that has not
    # been compared yet; `python export.py --stamp` fills it in from the figure
    # ml/serve/src/parity.test.ts actually measured.
    metadata["parity"] = None

    # The sha covers the MODEL AND THE CALIBRATOR ONLY, never the metadata — the
    # metadata contains the sha, so hashing it would be self-referential. What
    # the promotion gate M5_artefact_sha_mismatch is asking is "are these the
    # bytes that were trained", and these are those bytes. The canonical form is
    # sort_keys=True with no whitespace, and ml/serve recomputes it the same way.
    body = json.dumps({"model": dump, "calibration": calibration}, sort_keys=True, separators=(",", ":"))
    metadata["artefactSha256"] = hashlib.sha256(body.encode("utf-8")).hexdigest()
    artefact = {"metadata": metadata, "model": dump, "calibration": calibration}

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "artefact.json").write_text(json.dumps(artefact, sort_keys=True), encoding="utf-8")

    print(f"artefact {metadata['artefactId']}")
    print(f"  sha256      {metadata['artefactSha256']}")
    print(f"  features    {len(names)}  hash {metadata['featureHash'][:12]}")
    print(f"  calibration {len(calibration['x'])} knots over {calibration['n']} rows")
    print(f"  parity      {len(matrix)} rows written to {args.fixtures / 'parity.json'}")
    print(f"              ({len(sampled)} sampled from the training set, "
          f"{len(matrix) - len(sampled)} built on this model's own thresholds)")
    print("  parity      metadata.parity is null — nothing here has measured it")
    print("")
    print("Next, in this order:")
    print("  pnpm --filter @insidor/ml-serve test     measures |ts − py| and writes")
    print("                                           fixtures/parity-measured.json")
    print(f"  python export.py --stamp --out {args.out}")
    print("")
    print("Then insert a registry row with role='challenger', let it shadow-score,")
    print("and run the promotion gates. Promotion is a database row, not a deploy.")


if __name__ == "__main__":
    main()
