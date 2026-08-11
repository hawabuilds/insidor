"""Fit the model. Run by hand, weekly, on a laptop.

INPUT   <in>/dataset.parquet, <in>/manifest.json   (from build_dataset.py)
OUTPUT  <out>/model.txt         LightGBM's native booster text
        <out>/train_meta.json   the params actually used, plus row counts

WEEKLY, NOT NIGHTLY, AND THAT IS A DOWNGRADE MADE ON PURPOSE. A nightly retrain
implies nightly monitoring, and two people will not read a nightly report — so it
runs unwatched until it lands a bad model through a regime break. Weekly, on a
fixed day, with a human reading a generated report, is the version that survives
contact. The fast layer (isotonic calibration, `export.py`) stays daily because
it cannot produce a surprising model.

THE THREE CONSTRAINTS BELOW ARE NOT TUNING. The TypeScript serving walker
implements numeric `<=` splits with LightGBM's missing-value semantics and
nothing else. Against a categorical model it is wrong by 0.98 in probability
space, against a linear-tree model by 0.34, against a mis-read sigmoid by 0.15 —
silently, in every case. So:

    categorical_feature = []      no categorical splits
    linear_tree         = False   no linear leaves
    sigmoid             = 1.0     stated, never defaulted

They are set here, recorded in the artefact sidecar, checked again by the
promotion gate M13_trainer_unconstrained, and refused a third time by the walker
at load. Three refusals for one constraint is the right number when the failure
mode is a plausible wrong probability.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd


# The constraints the serving walker depends on. Not parameters. Do not expose
# these on the command line — a flag is an invitation.
LOCKED = {
    "objective": "binary",
    "sigmoid": 1.0,
    "linear_tree": False,
    "boosting": "gbdt",
}

# Ordinary hyper-parameters. Small, because the dataset is tens of thousands of
# rows with a low positive rate and a deep forest here memorises the last regime.
DEFAULTS = {
    "learning_rate": 0.05,
    "num_leaves": 31,
    "min_data_in_leaf": 100,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbosity": -1,
}


def weights_for(df: pd.DataFrame) -> np.ndarray:
    """ips × recency × log, multiplied once, here.

    Kept as three columns in SQL and combined at exactly one place, so a report
    can attribute a change to one of them. IPS is 1.0 outside the explore lane by
    construction, which is the honest statement that a deterministic policy
    supports no counterfactual estimate at all.
    """
    return (df["ips_weight"] * df["recency_weight"] * df["log_weight"]).to_numpy(dtype=float)


def fit(df: pd.DataFrame, feature_names: list[str], params: dict, rounds: int) -> lgb.Booster:
    dataset = lgb.Dataset(
        df[feature_names].astype(float),
        label=df["y"].astype(bool).astype(int),
        weight=weights_for(df),
        feature_name=feature_names,
        categorical_feature=[],  # ★ explicit, and empty
        free_raw_data=False,
    )
    return lgb.train({**DEFAULTS, **params, **LOCKED}, dataset, num_boost_round=rounds)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--in", dest="src", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--rounds", type=int, default=300)
    p.add_argument("--params", type=Path, help="optional JSON of hyper-parameters")
    args = p.parse_args()

    manifest = json.loads((args.src / "manifest.json").read_text(encoding="utf-8"))
    df = pd.read_parquet(args.src / "dataset.parquet")
    names: list[str] = manifest["featureNames"]

    overrides = json.loads(args.params.read_text(encoding="utf-8")) if args.params else {}
    for locked in LOCKED:
        if locked in overrides:
            raise SystemExit(f"'{locked}' is locked by the serving walker and cannot be overridden")

    booster = fit(df, names, overrides, args.rounds)

    args.out.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(args.out / "model.txt"))
    (args.out / "train_meta.json").write_text(
        json.dumps(
            {
                "params": {**DEFAULTS, **overrides, **LOCKED},
                "rounds": args.rounds,
                "rowCount": int(len(df)),
                "positiveCount": int(df["y"].astype(bool).sum()),
                "featureNames": names,
                "manifest": manifest,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"trained on {len(df)} rows, {int(df['y'].astype(bool).sum())} positive, {len(names)} features")


if __name__ == "__main__":
    main()
