"""Walk-forward evaluation. Never a random split.

INPUT   <in>/dataset.parquet, <in>/manifest.json
OUTPUT  <out>/walkforward.csv   one row per test DAY
        <out>/report.md         the artefact a human reads on the fixed weekly day

★ WHY WALK-FORWARD AND NOT A RANDOM SPLIT — the single most important thing in
this directory.

A random split puts examples from Tuesday in the training set and examples from
Monday in the test set. The model then knows the future, and every metric
improves. That flattery is not small here and it is not academic: this market
changes regime constantly — in eighteen months a launchpad field went from 100%
populated to 0%, graduation moved venues, a platform's state container vanished,
another closed its JSON. A model that holds on a random split has been shown
nothing except that the market was internally consistent on the days it saw. A
model that holds on a window it was not trained on has been shown the only thing
worth knowing.

The split, per test day D:

    train:  decided_at in [D-90, D)  AND  resolves_at < D     <- ★ the purge
    test:   decided_at in [D, D+1)   AND  status = 'resolved'

The purge is the part that is usually missing even when the split is by time.
An example decided on D-3 whose six-day label window covers D shares outcome
information with the test set; without the purge a walk-forward split still
leaks, quietly, and the leak grows with the label window.

★ REPORT THE DISTRIBUTION ACROSS DAYS, NOT THE MEAN. A mean over 60 test days
hides exactly the regime episodes this product exists to catch. The p10 day is
the number that tells you whether the model survives a bad week.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from train import fit  # the SAME fit. An evaluation that trains differently measures nothing.


@dataclass(frozen=True)
class Split:
    train_from: pd.Timestamp
    train_to: pd.Timestamp
    test_from: pd.Timestamp
    test_to: pd.Timestamp


def splits(df: pd.DataFrame, train_days: int, test_days: int) -> list[Split]:
    """One split per test day, stepping forward one day at a time."""
    first = df["decided_at"].min().normalize()
    last = df["decided_at"].max().normalize()
    out: list[Split] = []
    day = first + timedelta(days=train_days)
    while day + timedelta(days=test_days) <= last:
        out.append(
            Split(
                train_from=day - timedelta(days=train_days),
                train_to=day,
                test_from=day,
                test_to=day + timedelta(days=test_days),
            )
        )
        day += timedelta(days=test_days)
    return out


def pr_auc(y: np.ndarray, s: np.ndarray) -> float:
    """Average precision. PR, not ROC: the positive rate here is low single-digit
    percent, and ROC-AUC looks respectable on a model that is useless at the top
    of the ranking, which is the only part anyone sees."""
    order = np.argsort(-s)
    y = y[order]
    tp = np.cumsum(y)
    precision = tp / np.arange(1, len(y) + 1)
    positives = y.sum()
    return float((precision * y).sum() / positives) if positives else float("nan")


def precision_at_budget(y: np.ndarray, s: np.ndarray, budget: int) -> float:
    """Precision over the rows that would actually have been surfaced. The board
    has a fixed number of slots, so this is the metric with a product meaning."""
    if len(y) == 0:
        return float("nan")
    k = min(budget, len(y))
    top = np.argsort(-s)[:k]
    return float(y[top].mean())


def recall_far_bucket(
    train: pd.DataFrame, test: pd.DataFrame, names: list[str], scores: np.ndarray, quantile: float
) -> float:
    """Recall on test positives that are FAR from every training positive.

    ★ Nothing else on the dashboard is worth anything without this one. A system
    that only finds things resembling past winners is structurally incapable of
    finding the next unlike-anything meme, which is the entire product — and the
    headline metric cannot tell the two apart.

    Distance is measured in standardised feature space, deliberately: a semantic
    distance to a winner corpus is exactly the feature class this system forbids,
    because "similar to past winners" is a derivative-finder dressed as a model.
    """
    pos_train = train.loc[train["y"].astype(bool), names].astype(float)
    pos_test_mask = test["y"].astype(bool).to_numpy()
    if pos_train.empty or not pos_test_mask.any():
        return float("nan")

    mu = pos_train.mean()
    sd = pos_train.std().replace(0, 1.0)
    a = ((pos_train - mu) / sd).fillna(0.0).to_numpy()
    b = ((test.loc[:, names].astype(float) - mu) / sd).fillna(0.0).to_numpy()

    # nearest training positive for every test row
    d = np.sqrt(((b[:, None, :] - a[None, :, :]) ** 2).sum(axis=2)).min(axis=1)
    cut = np.quantile(d[pos_test_mask], quantile)
    far = pos_test_mask & (d >= cut)
    if not far.any():
        return float("nan")

    # "caught" = scored above the same budget cut the board would have applied
    bar = np.quantile(scores, 1 - min(1.0, 20 / max(len(scores), 1)))
    return float((scores[far] >= bar).mean())


def evaluate(df: pd.DataFrame, names: list[str], rounds: int, budget: int, train_days: int) -> pd.DataFrame:
    rows = []
    for sp in splits(df, train_days=train_days, test_days=1):
        train = df[(df["decided_at"] >= sp.train_from) & (df["decided_at"] < sp.train_to)]
        # ★ the purge: drop training rows whose label window reaches into the test day
        train = train[train["label_resolves_at"] < sp.test_from]
        test = df[(df["decided_at"] >= sp.test_from) & (df["decided_at"] < sp.test_to)]

        if len(test) == 0 or train["y"].astype(bool).sum() < 10:
            continue

        booster = fit(train, names, {}, rounds)
        scores = booster.predict(test[names].astype(float))
        y = test["y"].astype(bool).to_numpy()

        rows.append(
            {
                "test_day": sp.test_from.date().isoformat(),
                "n_train": len(train),
                "n_test": len(test),
                "positives": int(y.sum()),
                "pr_auc": pr_auc(y.astype(float), scores),
                "precision_at_budget": precision_at_budget(y.astype(float), scores, budget),
                "base_rate": float(y.mean()),
                "recall_far_bucket": recall_far_bucket(train, test, names, scores, 0.5),
                "mean_score": float(scores.mean()),
            }
        )
    return pd.DataFrame(rows)


def report(wf: pd.DataFrame, manifest: dict, budget: int) -> str:
    """The weekly artefact. Population, label source and window at the top, next
    to the numbers — not in a README someone will not open."""

    def dist(col: str) -> str:
        s = wf[col].dropna()
        if s.empty:
            return "no data"
        return (
            f"p10 {s.quantile(0.10):.3f} · median {s.median():.3f} · "
            f"p90 {s.quantile(0.90):.3f} · worst {s.min():.3f} ({len(s)} days)"
        )

    return "\n".join(
        [
            f"# {manifest['stage']} — walk-forward evaluation",
            "",
            f"**Population.** {manifest['population']}",
            f"**Label.** {manifest['label']['name']} {manifest['label']['version']}, "
            f"{manifest['label']['windowDays']}-day window, sources: {', '.join(manifest['labelSources'])}",
            f"**Window.** {len(wf)} test days, one day per split, purge "
            f"{manifest['trainingWindow']['purgeDays']} days.",
            f"**Feature set.** {manifest['featureSet']} ({len(manifest['featureNames'])} features), "
            f"hash {manifest['featureHash'][:12]}",
            "",
            "Distributions across test days, not means. A mean hides the regime episodes",
            "this product exists to catch.",
            "",
            f"- PR-AUC — {dist('pr_auc')}",
            f"- precision@{budget} — {dist('precision_at_budget')}",
            f"- base rate — {dist('base_rate')}",
            f"- **recall, far bucket** — {dist('recall_far_bucket')}",
            "",
            "If the far bucket collapses while the headline holds, the model has become a",
            "derivative-finder. That is a rollback, not a tuning problem.",
            "",
            "Days where positives < 5 are reported but must not be read as evidence.",
        ]
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--in", dest="src", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--rounds", type=int, default=300)
    p.add_argument("--budget", type=int, default=20, help="board slots; precision is measured over these")
    p.add_argument("--train-days", type=int, default=90)
    p.add_argument("--min-test-days", type=int, default=60)
    args = p.parse_args()

    manifest = json.loads((args.src / "manifest.json").read_text(encoding="utf-8"))
    df = pd.read_parquet(args.src / "dataset.parquet")
    df["decided_at"] = pd.to_datetime(df["decided_at"], utc=True)
    df["label_resolves_at"] = pd.to_datetime(df["label_resolves_at"], utc=True)

    wf = evaluate(df, manifest["featureNames"], args.rounds, args.budget, args.train_days)
    if len(wf) < args.min_test_days:
        print(
            f"WARNING: {len(wf)} test days, fewer than the {args.min_test_days} this evaluation is "
            "meant to aggregate over. Read the distribution, not the median."
        )

    args.out.mkdir(parents=True, exist_ok=True)
    wf.to_csv(args.out / "walkforward.csv", index=False)
    (args.out / "report.md").write_text(report(wf, manifest, args.budget), encoding="utf-8")
    print(report(wf, manifest, args.budget))


if __name__ == "__main__":
    main()
