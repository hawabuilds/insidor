"""Join the decision log to the outcome labels. That join IS the training set.

INPUT   internal.decisions  — one row per stage decision, carrying the feature
                              vector exactly as the decider saw it
        internal.labels     — one row per (subject, label, window), resolved on a
                              clock measured in days
        sql/train_<stage>_<version>.sql — the committed query, whose sha256 goes
                              into the model registry row

OUTPUT  <out>/dataset.parquet  — one row per (decision, label), features
                                 flattened into columns, weights attached
        <out>/manifest.json    — the population, the window, the label spec, the
                                 sha of the query, the row and positive counts.
                                 Everything a later reader needs to know what the
                                 numbers are ABOUT.

WHY THIS SCRIPT IS SHORT AND BORING, ON PURPOSE: it does not compute a feature.
Not one. `core/features/` computed the vector at the moment of the decision and
froze it into `internal.decisions.features`, so the trainer reads numbers rather
than recomputing them. That is what makes a two-language split safe here — the
boundary is data, not code — and the moment this file derives a feature from a
raw post, train/serve skew is back and nobody decided to reintroduce it.

Run:
    python build_dataset.py --stage admit --sql sql/train_admit_v1.sql \\
        --from 2026-05-01 --to 2026-11-01 --purge-days 6 --out ../../var/train/admit
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import psycopg


# --------------------------------------------------------------------------- #
# the join
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Window:
    """The training window, with its purge stated rather than implied."""

    start: datetime
    end: datetime
    purge_days: int

    @property
    def purge_cutoff(self) -> datetime:
        """Labels must have resolved before this instant.

        A label window that is still open at the end of the training window
        overlaps whatever we will test on next, and an example whose outcome is
        partly in the test period shares information with it.
        """
        return self.end - timedelta(days=self.purge_days)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch(dsn: str, sql_path: Path, window: Window) -> pd.DataFrame:
    """Run the committed query. No SQL is written in Python; it lives in sql/."""
    sql = sql_path.read_text(encoding="utf-8")
    with psycopg.connect(dsn) as conn:
        return pd.read_sql_query(
            sql,
            conn,
            params=(window.start, window.end, window.purge_cutoff),
        )


# --------------------------------------------------------------------------- #
# features: flattened, never recomputed
# --------------------------------------------------------------------------- #


def flatten_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Expand the frozen `features` jsonb into one column per key.

    Two rules, both of which have already cost this project a study:

      1. A key missing from a row becomes NaN, NEVER 0. In our vocabulary null
         means "no reading" and zero means "a reading of zero"; LightGBM has a
         missing-value branch and the serving walker maps null to NaN to match.
         Collapsing them is the same class of error as publishing a zero rate
         for a censored counter.

      2. Rows are grouped by `feature_set` and only ONE feature set is trained
         at a time. A vector that gained a feature halfway through the window is
         two populations wearing one name, and the model would read the older
         half as uniformly missing.
    """
    sets = sorted(df["feature_set"].unique())
    if len(sets) != 1:
        raise SystemExit(
            f"window spans {len(sets)} feature sets ({', '.join(map(str, sets))}). "
            "Narrow the window, or train one set at a time — a model cannot span a schema change."
        )

    expanded = pd.json_normalize(df["features"])
    names = sorted(expanded.columns)
    expanded = expanded[names].apply(pd.to_numeric, errors="coerce")
    return pd.concat([df.drop(columns=["features"]), expanded], axis=1), names


def feature_hash(names: list[str]) -> str:
    """Must match ml/serve/src/feature-hash.ts exactly: count, newline, sorted keys."""
    payload = f"{len(names)}\n" + "\n".join(sorted(names))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# the manifest
# --------------------------------------------------------------------------- #


def build_manifest(
    df: pd.DataFrame,
    names: list[str],
    window: Window,
    stage: str,
    sql_path: Path,
) -> dict:
    """Every number a later reader needs in order to know what the numbers mean.

    `population` is required and has no default, here for the same reason it is
    NOT NULL with no default on the labels table: the last backtest failed
    because its population was graduated coins — about 107 a day against roughly
    30,000 mints — while its claim was about coinability in general. A population
    that can be omitted is one that will be.
    """
    lanes = df["lane"].value_counts().to_dict()
    labels = df[["label_name", "label_version", "label_window_days"]].drop_duplicates()
    if len(labels) != 1:
        raise SystemExit(f"window spans {len(labels)} label definitions; train against one")
    label = labels.iloc[0]

    return {
        "stage": stage,
        "featureSet": str(df["feature_set"].iloc[0]),
        "featureNames": names,
        "featureHash": feature_hash(names),
        "trainingWindow": {
            "fromMs": int(window.start.timestamp() * 1000),
            "toMs": int(window.end.timestamp() * 1000),
            "purgeDays": window.purge_days,
        },
        "population": (
            f"{stage} decisions, lanes {sorted(lanes)}, "
            f"decided_at in [{window.start.date()}, {window.end.date()}), "
            f"labels resolved before {window.purge_cutoff.date()}, "
            f"sources {sorted(map(str, df['subject_kind'].unique()))}"
        ),
        "laneCounts": {str(k): int(v) for k, v in lanes.items()},
        "label": {
            "name": str(label["label_name"]),
            "version": str(label["label_version"]),
            "windowDays": int(label["label_window_days"]),
        },
        "labelSources": sorted(map(str, df["label_source"].unique())),
        "datasetSql": {"path": str(sql_path), "sha256": sha256_of(sql_path)},
        "rowCount": int(len(df)),
        "positiveCount": int(df["y"].fillna(False).astype(bool).sum()),
        "builtAt": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--stage", required=True)
    p.add_argument("--sql", required=True, type=Path)
    p.add_argument("--from", dest="start", required=True)
    p.add_argument("--to", dest="end", required=True)
    p.add_argument("--purge-days", type=int, required=True)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--dsn", default=os.environ.get("TRAIN_DSN", ""))
    args = p.parse_args()

    if not args.dsn:
        raise SystemExit("set TRAIN_DSN or pass --dsn. This is the only credential this directory uses.")

    window = Window(
        start=datetime.fromisoformat(args.start).replace(tzinfo=timezone.utc),
        end=datetime.fromisoformat(args.end).replace(tzinfo=timezone.utc),
        purge_days=args.purge_days,
    )

    raw = fetch(args.dsn, args.sql, window)
    if raw.empty:
        raise SystemExit("the join returned zero rows. Check the label status distribution before touching the query.")

    df, names = flatten_features(raw)
    manifest = build_manifest(df, names, window, args.stage, args.sql)

    args.out.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.out / "dataset.parquet", index=False)
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"{manifest['rowCount']} rows, {manifest['positiveCount']} positive, {len(names)} features")
    print(f"lanes: {manifest['laneCounts']}")
    print(f"population: {manifest['population']}")


if __name__ == "__main__":
    main()
