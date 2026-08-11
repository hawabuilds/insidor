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
This script writes 1,000 real rows and LightGBM's own predictions for them; CI
asserts max error < 1e-9 on every push. Without that test, do not split.

The rows are SAMPLED TO INCLUDE MISSING VALUES on purpose. A fixture of only
complete rows cannot exercise the branch where a naive walker is wrong by 0.92,
which is the branch most likely to be wrong.
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

PARITY_ROWS = 1000
TRAINER = "lightgbm"


def calibration_from(booster: lgb.Booster, recent: pd.DataFrame, names: list[str]) -> dict:
    """Fit the isotonic calibrator on the last resolved days and export its knots.

    LightGBM's dump does NOT contain the calibrator — it is a separate artefact
    with its own interpolation and out-of-bounds semantics, and exporting it is a
    deliberate act rather than a side effect. The TypeScript implementation of
    pool-adjacent-violators matched sklearn exactly (0.000e+0 over 500 points),
    which is why the DAILY recalibration loop needs no Python at all; this
    function only seeds the first one.
    """
    scores = booster.predict(recent[names].astype(float))
    y = recent["y"].astype(bool).astype(int).to_numpy()
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(scores, y)
    return {
        "x": [float(v) for v in iso.X_thresholds_],
        "y": [float(v) for v in iso.y_thresholds_],
        "outOfBounds": "clip",
        "n": int(len(recent)),
    }


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


def feature_hash(names: list[str]) -> str:
    """Must match ml/serve/src/feature-hash.ts exactly."""
    payload = f"{len(names)}\n" + "\n".join(sorted(names))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", required=True, type=Path)
    p.add_argument("--in", dest="src", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--fixtures", type=Path, default=Path("../serve/fixtures"))
    p.add_argument("--calibration-days", type=int, default=7)
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args()

    meta = json.loads((args.model / "train_meta.json").read_text(encoding="utf-8"))
    manifest = meta["manifest"]
    names: list[str] = manifest["featureNames"]
    booster = lgb.Booster(model_file=str(args.model / "model.txt"))

    df = pd.read_parquet(args.src / "dataset.parquet")
    df["decided_at"] = pd.to_datetime(df["decided_at"], utc=True)

    if feature_hash(names) != manifest["featureHash"]:
        raise SystemExit("feature hash disagrees with the manifest; the dataset and the model are not the same shape")

    cutoff = df["decided_at"].max() - pd.Timedelta(days=args.calibration_days)
    calibration = calibration_from(booster, df[df["decided_at"] >= cutoff], names)

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
    rows = parity_rows(df, names, rng)
    x = rows[names].astype(float)
    raw = booster.predict(x)
    iso = np.interp(raw, calibration["x"], calibration["y"], left=calibration["y"][0], right=calibration["y"][-1])

    fixture = {
        "model": dump,
        "calibration": calibration,
        "featureNames": names,
        "rows": [[None if pd.isna(v) else float(v) for v in row] for row in x.to_numpy()],
        "expected": [float(v) for v in iso],
    }

    args.fixtures.mkdir(parents=True, exist_ok=True)
    (args.fixtures / "parity.json").write_text(json.dumps(fixture), encoding="utf-8")

    # The error measured HERE is Python against Python and is therefore zero; the
    # number that matters is measured by ml/serve/src/parity.test.ts in CI. We
    # record the fixture size and a zero placeholder so the promotion gate can
    # see that a fixture exists; CI overwrites maxAbsError with the real figure.
    metadata["parity"] = {"rows": len(rows), "maxAbsError": 0.0}

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
    print(f"  parity      {len(rows)} rows written to {args.fixtures / 'parity.json'}")
    print("")
    print("Next: insert a registry row with role='challenger', let it shadow-score,")
    print("then run the promotion gates. Promotion is a database row, not a deploy.")


if __name__ == "__main__":
    main()
