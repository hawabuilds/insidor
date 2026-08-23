"""Join the decision log to the outcome labels. That join IS the training set.

INPUT   internal.decisions  — one row per stage decision, carrying the feature
                              vector exactly as the decider saw it
        internal.labels     — one row per (subject, label, window), resolved on a
                              clock measured in days
        sql/train_<stage>_<version>.sql  — the committed query, whose sha256 goes
                              into the model registry row
        sql/census_<stage>_<version>.sql — the same population with none of the
                              label filters, so every exclusion has a count

OUTPUT  <out>/dataset.parquet  — one row per (decision, label), features
                                 flattened into columns, weights attached, and a
                                 `split` column that is already decided
        <out>/manifest.json    — the population, the window, the label spec, the
                                 census, the split ranges, the sha of the query.
                                 Everything a later reader needs to know what the
                                 numbers are ABOUT.
        <out>/census.json      — written even when the build REFUSES, because the
                                 reason for a refusal is the most useful number
                                 in the first six months of this system's life.

WHY THIS SCRIPT IS SHORT AND BORING, ON PURPOSE: it does not compute a feature.
Not one. `core/features/` computed the vector at the moment of the decision and
froze it into `internal.decisions.features`, so the trainer reads numbers rather
than recomputing them. That is what makes a two-language split safe here — the
boundary is data, not code — and the moment this file derives a feature from a
raw post, train/serve skew is back and nobody decided to reintroduce it.

★ THE THREE DECISIONS IN THIS FILE, AND WHAT BREAKS IF THEY ARE CHANGED

1. THE SPLIT IS ASSIGNED HERE, IN TIME ORDER, AND WRITTEN INTO THE PARQUET.
   It is not left to whoever loads the frame. A `split` column that already
   exists cannot be replaced by a random one in a notebook, and `train.py`
   refuses a dataset that lacks it. The boundary is a wall in time: everything
   decided before `test_from` is a candidate for training, everything after is
   test, and any training row whose LABEL WINDOW reaches across that instant is
   marked `purged` and belongs to neither. Without the purge the split is still
   temporal and still leaks — an example decided three days before the boundary,
   graded over a thirty-day window, shares its outcome with the test period.

2. CENSORED LABELS ARE EXCLUDED AND COUNTED, NEVER DROPPED SILENTLY.
   The training query cannot count what it filtered out, so the census query runs
   beside it over the same population and the counts go in the manifest. A
   censored label is a window we could not watch; it is not a failure and it is
   not a zero. If the censoring rate climbs, the build says so and, past a stated
   ceiling, refuses — because a dataset made of the windows that happened to be
   observable scores beautifully and generalises to nothing.

3. AN INSUFFICIENT DATASET IS A REFUSAL, NOT A SMALL ONE.
   A model fitted on nine rows is worse than no model, because a model gets
   served and no model does not. The floors are declared below, printed on every
   run, and recorded in the manifest so a later reader knows what "sufficient"
   meant on the day. Exit code 2 means "not enough data", distinct from 1.

Run:
    python build_dataset.py --stage admit \\
        --sql sql/train_admit_v1.sql --census sql/census_admit_v1.sql \\
        --from 2026-05-01 --to 2026-11-01 --purge-days 6 --holdout-days 30 \\
        --out ../../var/train/admit
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import psycopg

# --------------------------------------------------------------------------- #
# what "enough data" means
# --------------------------------------------------------------------------- #

# ★ WHERE THESE NUMBERS LIVE, AND WHY NOT IN contracts/src/policy.ts.
#
# The repository's rule is that a bare number belongs in policy.ts. That rule is
# enforced over `core/` only (tools/check-policy.mjs scans one directory), and it
# is aimed at a specific hazard: a threshold that changes what the PRODUCT does,
# buried where nobody diffs it. These are not that. They do not change a verdict,
# a score or a board; they decide whether this script is allowed to hand a model
# to anybody, and they are consumed by Python, which cannot import policy.ts.
#
# So they live here, in one named block, printed on every run and copied into the
# manifest — and they are overridable from the command line so that a deliberate
# exception is typed out in the shell history rather than edited into a constant.
# If a future reader wants them in policy.ts, the thing to move is the whole
# sufficiency question, not these five numbers.
#
# The values themselves are floors of plausibility, not of quality:
#   rows        — LightGBM's own min_data_in_leaf is 100 in train.py. A dataset
#                 that cannot fill several leaves is not being modelled, it is
#                 being memorised.
#   positives   — with a positive rate of a few percent, fewer than 50 positives
#                 means the model has seen fewer distinct winners than a person
#                 could hold in their head, and the far-bucket recall metric —
#                 the only one that matters — is undefined below about ten.
#   negatives   — a one-class dataset trains a constant and reports perfect
#                 metrics on it.
#   test days   — a holdout of a single day measures one day's regime.
#   censored    — a fifth of the population unobservable means the labeller is
#                 measuring survivors, and the correct response is to fix the
#                 coverage log, not to train on what is left.
MIN_TRAIN_ROWS = 1000
MIN_TRAIN_POSITIVES = 50
MIN_TRAIN_NEGATIVES = 50
MIN_TEST_ROWS = 100
MIN_TEST_POSITIVES = 5
MAX_CENSORED_RATE = 0.20

EXIT_NOT_ENOUGH_DATA = 2


# --------------------------------------------------------------------------- #
# the window
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Window:
    """The training window, with its purge and its holdout stated rather than implied."""

    start: datetime
    end: datetime
    purge_days: int
    holdout_days: int

    @property
    def purge_cutoff(self) -> datetime:
        """Labels must have resolved before this instant.

        A label window that is still open at the end of the training window
        overlaps whatever we will test on next, and an example whose outcome is
        partly in the test period shares information with it.
        """
        return self.end - timedelta(days=self.purge_days)

    @property
    def test_from(self) -> datetime:
        """The wall. Decisions at or after this instant are the holdout."""
        return self.end - timedelta(days=self.holdout_days)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_query(conn: psycopg.Connection, sql_path: Path, window: Window) -> pd.DataFrame:
    """Run a committed query. No SQL is written in Python; it lives in sql/.

    Built from the cursor rather than through pandas' SQL helper on purpose: that
    helper wants SQLAlchemy, warns without it, and hides the column names the
    result set is supposed to be a contract about.
    """
    sql = sql_path.read_text(encoding="utf-8")
    params = {
        "window_start": window.start,
        "window_end": window.end,
        "purge_cutoff": window.purge_cutoff,
    }
    with conn.cursor() as cur:
        cur.execute(sql, params)  # type: ignore[arg-type]
        description = cur.description or []
        columns = [c.name for c in description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=columns)


# --------------------------------------------------------------------------- #
# the census: what the training query removed
# --------------------------------------------------------------------------- #


def census_from(raw: pd.DataFrame) -> dict:
    """Fold the census result set into the block that goes in the manifest.

    Shape is (bucket, detail, n). Everything here is a count of something the
    training query cannot report, and the two assertions below are what stop the
    census and the dataset from silently describing different populations.
    """
    counts: dict[str, int] = {}
    censor_reasons: dict[str, int] = {}
    window_days: dict[str, int] = {}

    for _, r in raw.iterrows():
        bucket = str(r["bucket"])
        detail = str(r["detail"])
        n = int(r["n"])
        if bucket == "censor_reason":
            censor_reasons[detail] = n
        elif bucket == "label_window_days":
            window_days[detail] = n
        else:
            counts[bucket] = n

    joined = counts.get("joined_rows", 0)
    by_status = {
        "absent": counts.get("label_absent", 0),
        "pending": counts.get("label_pending", 0),
        "resolved": counts.get("label_resolved", 0),
        "censored": counts.get("label_censored", 0),
        "unresolvable": counts.get("label_unresolvable", 0),
    }

    # The census must partition, or it is describing a different population from
    # the dataset printed beside it. Failing here beats printing a wrong rate.
    if sum(by_status.values()) != joined:
        raise SystemExit(
            f"census does not partition: statuses sum to {sum(by_status.values())} "
            f"but joined_rows is {joined}. census_*.sql has drifted from train_*.sql."
        )
    resolved_parts = (
        counts.get("excluded_window_still_open", 0)
        + counts.get("excluded_anticircular", 0)
        + counts.get("admitted_to_training", 0)
    )
    if resolved_parts != by_status["resolved"]:
        raise SystemExit(
            f"census does not partition: resolved exclusions sum to {resolved_parts} "
            f"but label_resolved is {by_status['resolved']}."
        )

    # ★ The denominator of the censoring rate is every label that EXISTS, not every
    # decision. A decision the labeller has not reached yet is not evidence about
    # whether we were watching; folding `absent` in here would make the rate fall
    # every time the log grew faster than the labeller.
    labelled = joined - by_status["absent"]
    censored_rate = (by_status["censored"] / labelled) if labelled else None

    return {
        "decisionsInWindow": counts.get("decisions_in_window", 0),
        "joinedRows": joined,
        "byStatus": by_status,
        "labelWindowDays": window_days,
        "censorReasons": censor_reasons,
        # Absent is stated as absent. It is not a status the labels table can hold
        # — there is no row at all — and calling it one would invent a fourth
        # state next to the four the schema defines.
        "censoredRate": censored_rate,
        # ★ How many of the labels above are CORRECTIONS — a window we could not
        # measure once and could later. Not an exclusion and not part of either
        # partition; it is the only number that distinguishes a supersession
        # mechanism that is working from one that is not running at all.
        "supersededLabels": counts.get("label_superseded", 0),
        "excludedFromTraining": {
            "labelAbsent": by_status["absent"],
            "pendingWindowStillRunning": by_status["pending"],
            "censoredNotObserved": by_status["censored"],
            "unresolvable": by_status["unresolvable"],
            "resolvedButWindowOpenAtPurge": counts.get("excluded_window_still_open", 0),
            "resolvedButSubjectPostdatedTheCoin": counts.get("excluded_anticircular", 0),
        },
        "admittedToTraining": counts.get("admitted_to_training", 0),
    }


def render_census(c: dict) -> list[str]:
    """The census as a human reads it. Printed on every run, refusal or not."""
    rate = c["censoredRate"]
    rate_txt = "—  (no labels exist yet)" if rate is None else f"{rate:.1%}"
    lines = [
        f"  decisions in window            {c['decisionsInWindow']}",
        f"  rows after the label join      {c['joinedRows']}",
        f"  ├─ no label row at all         {c['byStatus']['absent']}",
        f"  ├─ pending (window running)    {c['byStatus']['pending']}",
        f"  ├─ censored (not observed)     {c['byStatus']['censored']}",
        f"  ├─ unresolvable                {c['byStatus']['unresolvable']}",
        f"  └─ resolved                    {c['byStatus']['resolved']}",
        f"       ├─ window open at purge   {c['excludedFromTraining']['resolvedButWindowOpenAtPurge']}",
        f"       ├─ subject postdates coin {c['excludedFromTraining']['resolvedButSubjectPostdatedTheCoin']}",
        f"       └─ ADMITTED               {c['admittedToTraining']}",
        f"  censoring rate (of labelled)   {rate_txt}",
        f"  of which a later revision      {c['supersededLabels']}   (corrections; the earlier row stays on disk)",
    ]
    if c["censorReasons"]:
        lines.append("  censor reasons:")
        for reason, n in sorted(c["censorReasons"].items(), key=lambda kv: -kv[1]):
            lines.append(f"    {n:>6}  {reason}")
    return lines


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

      3. ★ And the same for `feature_hash`, which the previous version of this
         file selected and never looked at. `feature_set` is a NAME; two vectors
         can wear it while carrying different keys, and that is precisely the
         drift the hash exists to catch. Checking the name and ignoring the hash
         is checking the label on the jar.
    """
    sets = sorted(df["feature_set"].unique())
    if len(sets) != 1:
        raise SystemExit(
            f"window spans {len(sets)} feature sets ({', '.join(map(str, sets))}). "
            "Narrow the window, or train one set at a time — a model cannot span a schema change."
        )

    hashes = sorted(df["feature_hash"].unique())
    if len(hashes) != 1:
        raise SystemExit(
            f"window spans {len(hashes)} feature HASHES under one feature-set name "
            f"({', '.join(h[:12] for h in map(str, hashes))}). The key list changed mid-window: "
            "the older rows would be read as uniformly missing. Narrow the window."
        )

    expanded = pd.json_normalize(df["features"])
    names = sorted(expanded.columns)
    raw_expanded = expanded[names]
    expanded = raw_expanded.apply(pd.to_numeric, errors="coerce")

    # ★ `errors="coerce"` TURNS ANYTHING IT CANNOT READ INTO NaN, AND NaN IS OUR
    # WORD FOR "no reading". So a feature that arrives as a string, a list or a
    # dict does not fail here — it becomes uniformly MISSING, the model takes the
    # missing branch on every row, and the only symptom is a feature that quietly
    # stopped mattering. That is the same class of error as a censored counter
    # published as a zero, one layer up, and nothing counted it.
    #
    # The coercion still happens, because a genuinely null feature must survive as
    # NaN. What must not happen is a coercion nobody was told about, so the two
    # cases are separated: null in, NaN out is the vocabulary; anything ELSE in,
    # NaN out is a value we failed to read, and it is fatal rather than counted.
    # Fatal and not counted because there is no honest number to train beside it —
    # the feature is broken for the whole window, not for some rows.
    unreadable = (expanded.isna() & raw_expanded.notna()).sum()
    broken = {str(k): int(v) for k, v in unreadable.items() if v}
    if broken:
        raise SystemExit(
            "these features carry values that are not numbers, and coercing them would "
            f"make each one uniformly MISSING without saying so: {broken}. "
            "A FeatureVector is Record<string, number | null>; fix the writer, do not "
            "let the trainer silently read the feature as absent."
        )

    flat = pd.concat([df.drop(columns=["features"]), expanded], axis=1)

    # ★ WHY THIS CHECKS THAT THE RECORDED HASHES AGREE WITH EACH OTHER AND NOT
    # THAT THEY AGREE WITH OURS. There are two different functions called "the
    # feature hash" in this repository and they are not the same function:
    #
    #   internal.decisions.feature_hash   sha256(sorted names joined by a NUL byte)
    #                                     — store/src/repo/decisions.ts:76
    #   ArtefactMetadata.featureHash      sha256(count + "\n" + sorted names)
    #                                     — ml/serve/src/feature-hash.ts, and the
    #                                       `feature_hash` defined below
    #
    # Both were verified against a live `item.admit.v1` row; they produce different
    # digests for the same key list, so comparing one to the other proves nothing
    # and would fail on perfectly correct data. Neither is wrong — they answer the
    # same question in two places that never meet — but nothing anywhere says so,
    # and the names invite exactly the comparison that cannot hold.
    #
    # What IS checkable, and is the thing the column exists for, is that every row
    # in the window recorded the SAME hash, whatever algorithm produced it. A
    # feature set that gained or lost a key mid-window keeps its name and changes
    # its hash, and the older half would be read as uniformly missing. That check
    # is above; this is the note that stops someone "fixing" it into an equality.
    return flat, names


#: Columns the trainer does arithmetic on. Everything else is carried as-is.
NUMERIC_COLUMNS = (
    "horizon_s",
    "score",
    "propensity",
    "log_sample_rate",
    "label_value",
    "label_window_days",
    "ips_weight",
    "recency_weight",
    "log_weight",
)


def normalise_numeric(df: pd.DataFrame) -> pd.DataFrame:
    """Cast the arithmetic columns to float64, here, once.

    ★ POSTGRES `numeric` ARRIVES AS `decimal.Decimal`. `1.0 / d.log_sample_rate`
    is numeric, `power(0.5, …)` is double precision, and the three weights are
    therefore a mix of Decimal and float in one frame. `train.py` multiplies them
    together and pandas raises `unsupported operand type(s) for *: 'float' and
    'decimal.Decimal'` — three steps downstream of the cause, in a file that looks
    innocent. This is the layer that decides the frame's schema, so it is the
    layer that owes every consumer a float.

    Decimal is not wrong, it is exact — which is why psycopg hands it over rather
    than lossily converting. The loss is deliberate and belongs in one place with
    a name on it, not scattered through whoever hits the TypeError first.
    """
    out = df.copy()
    for column in NUMERIC_COLUMNS:
        if column in out.columns:
            out[column] = pd.to_numeric(out[column], errors="coerce").astype("float64")
    return out


def feature_hash(names: list[str]) -> str:
    """Must match ml/serve/src/feature-hash.ts exactly: count, newline, sorted keys.

    `sorted()` here is by Unicode code point and JavaScript's `.sort()` is by
    UTF-16 code unit; they agree on everything in the Basic Multilingual Plane and
    disagree above it. Feature names are stage-scoped camelCase identifiers, so
    the two orders are identical in practice — and the parity oracle asserts it on
    a name list built to include the characters where they would not be, so the
    agreement is measured rather than assumed.
    """
    payload = f"{len(names)}\n" + "\n".join(sorted(names))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# the split: temporal, purged, decided here
# --------------------------------------------------------------------------- #


def assign_split(df: pd.DataFrame, window: Window) -> pd.DataFrame:
    """Label every row `train`, `purged` or `test`, in time order.

    ★ NEVER RANDOM. A random split puts Tuesday in the training set and Monday in
    the test set; the model then knows the future and every metric improves. That
    flattery is not academic here — this market changes regime constantly, and a
    model that holds on a random split has only been shown that the market was
    internally consistent on the days it saw.

    The wall is `window.test_from`. `purged` is the band on the training side
    whose LABEL WINDOWS cross it: those rows share outcome information with the
    test period, and dropping them is the part of a walk-forward split that is
    usually missing even when the split is by time.
    """
    decided = pd.to_datetime(df["decided_at"], utc=True)
    resolves = pd.to_datetime(df["label_resolves_at"], utc=True)
    wall = pd.Timestamp(window.test_from)

    split = pd.Series("train", index=df.index, dtype=object)
    split[decided >= wall] = "test"
    split[(decided < wall) & (resolves >= wall)] = "purged"

    out = df.copy()
    out["split"] = split

    # The invariant, checked rather than trusted. If a training label resolves at
    # or after the first test decision, the purge did not happen and every number
    # downstream is flattered by an amount nobody can estimate.
    train = out[out["split"] == "train"]
    test = out[out["split"] == "test"]
    if not train.empty and not test.empty:
        latest_train_label = pd.to_datetime(train["label_resolves_at"], utc=True).max()
        earliest_test_decision = pd.to_datetime(test["decided_at"], utc=True).min()
        if latest_train_label >= earliest_test_decision:
            raise SystemExit(
                f"purge failed: a training label resolves at {latest_train_label} but the first "
                f"test decision is {earliest_test_decision}. The split leaks."
            )
    return out


#: A stored `label_version` split into its definition and its revision. Must stay
#: identical to `parseLabelVersion` in contracts/src/label.ts — a version string
#: that file did not write is a definition we do not recognise, NOT a revision, so
#: only a `.r` followed by a positive integer is stripped. Widening this would fold
#: a foreign definition into this measurement and pool two different questions.
_REVISION = re.compile(r"^(?P<definition>.+)\.r(?P<revision>[1-9][0-9]*)$")


def label_definition(version: str) -> str:
    """What was measured, with any revision marker removed."""
    m = _REVISION.match(version)
    return m.group("definition") if m else version


def verdicts(df: pd.DataFrame) -> pd.Series:
    """The `y` column as booleans, refusing rather than filling a missing one.

    ★ THIS FUNCTION EXISTS TO DELETE `y.fillna(False)`, WHICH WAS WRITTEN TWICE.

    `fillna(False)` reads "we do not know the outcome" as "the outcome was bad" —
    the single coercion this whole system is arranged to prevent, spelled in the
    idiom that looks like housekeeping. It is unreachable today: the training
    query filters `status = 'resolved'` and the labels table's own
    `resolved_has_a_verdict` constraint makes `y` non-null on exactly those rows.
    That is precisely why it was dangerous — it never fires, so it never fails, so
    it survives every review, and the day someone admits pending rows as
    delayed-feedback negatives (which the schema's `first_signal_at` comment plans
    for) it is already there, converting them all silently.

    A refusal costs nothing while the invariant holds and is the only thing that
    speaks up when it stops.
    """
    if df["y"].isna().any():
        raise SystemExit(
            f"{int(df['y'].isna().sum())} rows carry a null `y`. A missing outcome is NOT a "
            "negative one — it is a row that must not be in this dataset. The training "
            "query is supposed to admit `status = 'resolved'` only; something widened it."
        )
    return df["y"].astype(bool)


def describe_split(df: pd.DataFrame, name: str) -> dict:
    """Row counts, class balance and date range for one side of the wall.

    An empty split reports its emptiness with dashes and nulls. It does NOT report
    a base rate of 0.0 — there is no rate over no rows, and a zero here would read
    as "nothing succeeded" rather than "nothing was measured".
    """
    part = df[df["split"] == name]
    n = int(len(part))
    if n == 0:
        return {
            "rows": 0,
            "positives": 0,
            "negatives": 0,
            "baseRate": None,
            "decidedFrom": None,
            "decidedTo": None,
            "lastLabelResolvesAt": None,
        }
    y = verdicts(part)
    decided = pd.to_datetime(part["decided_at"], utc=True)
    resolves = pd.to_datetime(part["label_resolves_at"], utc=True)
    return {
        "rows": n,
        "positives": int(y.sum()),
        "negatives": int((~y).sum()),
        "baseRate": float(y.mean()),
        "decidedFrom": decided.min().isoformat(),
        "decidedTo": decided.max().isoformat(),
        "lastLabelResolvesAt": resolves.max().isoformat(),
    }


def render_splits(splits: dict) -> list[str]:
    lines = []
    for name in ("train", "purged", "test"):
        s = splits[name]
        if s["rows"] == 0:
            lines.append(f"  {name:<7} 0 rows  —  (empty)")
            continue
        lines.append(
            f"  {name:<7} {s['rows']:>7} rows  "
            f"{s['positives']:>6} pos / {s['negatives']:>6} neg  "
            f"base {s['baseRate']:.3%}  "
            f"{s['decidedFrom'][:10]} .. {s['decidedTo'][:10]}"
        )
    return lines


# --------------------------------------------------------------------------- #
# sufficiency
# --------------------------------------------------------------------------- #


def holdout_is_unreachable(census: dict, window: Window) -> str | None:
    """★ The arithmetic that makes a holdout empty before a single row is read.

    A test row must satisfy three things at once, and they can contradict:

        decided_at  >= test_from                    it is in the holdout
        resolves_at <  purge_cutoff                 the training query's purge
        resolves_at =  origin_ts + windowDays       the label's own clock
        origin_ts   >= decided_at                   the anti-circularity clause

    Substituting: the earliest a holdout row's label can resolve is
    `test_from + windowDays`, and the purge demands that be before
    `end - purgeDays`. So a non-empty holdout requires

        windowDays + purgeDays  <  holdoutDays

    and nothing else will do. With the 30-day peak-multiple window and the 6-day
    purge, a 30-day holdout is empty before the query runs — every decision recent
    enough to be in it is too recent for its outcome to have happened.

    This is not a bug to route around. It is the shape of the problem: THE
    EVALUABLE PRESENT IS ALWAYS AT LEAST ONE LABEL WINDOW BEHIND NOW. The two
    honest fixes are a longer holdout or an earlier `--to`, and both cost the same
    thing — the recent past is not yet evidence. Reporting "test rows 0" without
    this paragraph would send a reader looking for a bug in the split.
    """
    days = [int(k) for k in census["labelWindowDays"] if k.isdigit()]
    if not days:
        return None
    widest = max(days)
    if widest + window.purge_days < window.holdout_days:
        return None
    needed = widest + window.purge_days + 1
    return (
        f"the holdout is empty by construction: label window {widest}d + purge "
        f"{window.purge_days}d >= holdout {window.holdout_days}d. No decision recent enough "
        f"to be in the holdout can have a label that resolved before the purge cutoff. "
        f"Use --holdout-days {needed} or more, or move --to back by "
        f"{needed - window.holdout_days} days"
    )


def sufficiency_failures(splits: dict, census: dict, floors: dict, window: Window) -> list[str]:
    """Every reason this dataset must not become a model. All of them, not the first.

    Returning the whole list rather than raising on the first is deliberate: the
    person reading this is deciding whether to wait a week or a quarter, and one
    failure at a time turns that into six runs.
    """
    out: list[str] = []
    tr, te = splits["train"], splits["test"]

    # First, because it explains the two failures below rather than adding to them.
    unreachable = holdout_is_unreachable(census, window)
    if unreachable is not None:
        out.append(unreachable)

    if tr["rows"] < floors["minTrainRows"]:
        out.append(f"train rows {tr['rows']} < {floors['minTrainRows']}")
    if tr["positives"] < floors["minTrainPositives"]:
        out.append(f"train positives {tr['positives']} < {floors['minTrainPositives']}")
    if tr["negatives"] < floors["minTrainNegatives"]:
        out.append(f"train negatives {tr['negatives']} < {floors['minTrainNegatives']}")
    if te["rows"] < floors["minTestRows"]:
        out.append(f"test rows {te['rows']} < {floors['minTestRows']}")
    if te["positives"] < floors["minTestPositives"]:
        out.append(f"test positives {te['positives']} < {floors['minTestPositives']}")

    rate = census["censoredRate"]
    if rate is not None and rate > floors["maxCensoredRate"]:
        out.append(
            f"censoring rate {rate:.1%} > {floors['maxCensoredRate']:.1%} — the labeller is "
            "measuring the windows it happened to observe, not the population"
        )
    return out


# --------------------------------------------------------------------------- #
# the manifest
# --------------------------------------------------------------------------- #


def build_manifest(
    df: pd.DataFrame,
    names: list[str],
    window: Window,
    stage: str,
    sql_path: Path,
    census_path: Path,
    census: dict,
    splits: dict,
    floors: dict,
) -> dict:
    """Every number a later reader needs in order to know what the numbers mean.

    `population` is required and has no default, here for the same reason it is
    NOT NULL with no default on the labels table: the last backtest failed
    because its population was graduated coins — about 107 a day against roughly
    30,000 mints — while its claim was about coinability in general. A population
    that can be omitted is one that will be.

    ★ It now carries the census inside it. A population string that says "admit
    decisions in this window" while 40% of that window was censored is true and
    misleading; the counts next to it are what make it checkable.
    """
    lanes = df["lane"].value_counts().to_dict()

    # ★ ONE DEFINITION, NOT ONE VERSION STRING, AND THE DISTINCTION IS THE WHOLE
    # POINT OF `label_version`.
    #
    # That column does two jobs, because it is the only part of the labels primary
    # key free to carry a correction. `v1` and `v1.r2` are the SAME measurement
    # taken twice — the second because our own evidence improved — and they pool.
    # `v1` and `v2` are two different measurements and must never be compared.
    # Comparing the raw strings, which this did, conflates the two: it refused a
    # perfectly valid dataset the moment the labeller superseded anything, and it
    # would have accepted nothing that mixed real definitions either, so it caught
    # the wrong error and blocked the right case.
    #
    # Measured: with the latest-revision join in place, a 9,000-row synthetic
    # population with 300 corrections in it hit this assertion and stopped the
    # build. The corrections are the point of the labeller.
    definitions = sorted({label_definition(v) for v in df["label_version"].astype(str)})
    if len(definitions) != 1:
        raise SystemExit(
            f"window spans {len(definitions)} label DEFINITIONS ({', '.join(definitions)}); "
            "train against one. Two definitions are two different measurements — a different "
            "window, a different bar for y — and pooling them averages two questions."
        )
    shapes = df[["label_name", "label_window_days"]].drop_duplicates()
    if len(shapes) != 1:
        raise SystemExit(f"window spans {len(shapes)} label shapes (name × window_days); train against one")
    label = shapes.iloc[0]
    revisions = df["label_version"].astype(str).value_counts().to_dict()

    return {
        "stage": stage,
        "featureSet": str(df["feature_set"].iloc[0]),
        "featureNames": names,
        "featureHash": feature_hash(names),
        "trainingWindow": {
            "fromMs": int(window.start.timestamp() * 1000),
            "toMs": int(window.end.timestamp() * 1000),
            "purgeDays": window.purge_days,
            "holdoutDays": window.holdout_days,
            "testFromMs": int(window.test_from.timestamp() * 1000),
        },
        "population": (
            f"{stage} decisions, lanes {sorted(lanes)}, "
            f"decided_at in [{window.start.date()}, {window.end.date()}), "
            f"labels resolved before {window.purge_cutoff.date()}, "
            f"subject kinds {sorted(map(str, df['subject_kind'].unique()))}; "
            f"{census['admittedToTraining']} of {census['joinedRows']} joined rows admitted, "
            f"{census['byStatus']['censored']} censored and excluded"
        ),
        "laneCounts": {str(k): int(v) for k, v in lanes.items()},
        "label": {
            "name": str(label["label_name"]),
            # ★ `version` IS THE DEFINITION, AND IT HAS TO BE.
            #
            # `ml/serve/src/artefact.ts` requires this field — `LabelSpec.version`
            # — and export.py copies this whole block into the artefact sidecar, so
            # the serving side refuses to load a model without it. What the sidecar
            # is being asked is "which measurement was this model trained against",
            # and the answer to that is the DEFINITION: `v1` and `v1.r2` are the
            # same measurement taken twice, so a dataset spanning both has exactly
            # one answer. Writing the raw column value would mean picking one of
            # several strings and calling it the version, which is not a fact.
            #
            # `definition` says the same thing under the name that cannot be
            # misread, and `revisions` carries the spread beside it — how much of
            # this dataset is a correction is a real question, and it is a
            # different one from what was measured.
            "version": definitions[0],
            "definition": definitions[0],
            "revisions": {str(k): int(v) for k, v in sorted(revisions.items())},
            "windowDays": int(label["label_window_days"]),
        },
        "labelSources": sorted(map(str, df["label_source"].unique())),
        "labelCensus": census,
        "splits": splits,
        "sufficiencyFloors": floors,
        "datasetSql": {"path": str(sql_path), "sha256": sha256_of(sql_path)},
        "censusSql": {"path": str(census_path), "sha256": sha256_of(census_path)},
        "rowCount": int(len(df)),
        "positiveCount": int(verdicts(df).sum()),
        "builtAt": datetime.now(timezone.utc).isoformat(),
    }


# --------------------------------------------------------------------------- #


def refuse(out_dir: Path, payload: dict, reasons: list[str]) -> None:
    """Write the diagnosis, remove any stale dataset, and exit 2.

    ★ THE REMOVAL IS THE LOAD-BEARING PART. A refused build that leaves last
    week's dataset.parquet in place is worse than one that leaves nothing: the
    next `train.py` succeeds, silently, on data whose provenance no longer
    matches the manifest beside it.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "census.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    for stale in ("dataset.parquet", "manifest.json"):
        path = out_dir / stale
        if path.exists():
            path.unlink()
            print(f"removed stale {path}")
    model_dir = out_dir / "model"
    if model_dir.exists():
        shutil.rmtree(model_dir)
        print(f"removed stale {model_dir}")

    print("")
    print("NOT ENOUGH DATA — no dataset written, no model may be trained.")
    for r in reasons:
        print(f"  ✗ {r}")
    print("")
    print(f"The diagnosis is in {out_dir / 'census.json'}.")
    sys.exit(EXIT_NOT_ENOUGH_DATA)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--stage", required=True)
    p.add_argument("--sql", required=True, type=Path)
    p.add_argument("--census", required=True, type=Path, help="the paired census_<stage>_<v>.sql")
    p.add_argument("--from", dest="start", required=True)
    p.add_argument("--to", dest="end", required=True)
    p.add_argument("--purge-days", type=int, required=True)
    p.add_argument("--holdout-days", type=int, required=True, help="the temporal test tail, in days")
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--dsn", default=os.environ.get("TRAIN_DSN", ""))
    p.add_argument("--min-train-rows", type=int, default=MIN_TRAIN_ROWS)
    p.add_argument("--min-train-positives", type=int, default=MIN_TRAIN_POSITIVES)
    p.add_argument("--min-train-negatives", type=int, default=MIN_TRAIN_NEGATIVES)
    p.add_argument("--min-test-rows", type=int, default=MIN_TEST_ROWS)
    p.add_argument("--min-test-positives", type=int, default=MIN_TEST_POSITIVES)
    p.add_argument("--max-censored-rate", type=float, default=MAX_CENSORED_RATE)
    args = p.parse_args()

    if not args.dsn:
        raise SystemExit("set TRAIN_DSN or pass --dsn. This is the only credential this directory uses.")

    window = Window(
        start=datetime.fromisoformat(args.start).replace(tzinfo=timezone.utc),
        end=datetime.fromisoformat(args.end).replace(tzinfo=timezone.utc),
        purge_days=args.purge_days,
        holdout_days=args.holdout_days,
    )
    if window.holdout_days <= 0 or window.test_from <= window.start:
        raise SystemExit(
            f"--holdout-days {window.holdout_days} leaves no training period before "
            f"{window.test_from.date()}. A holdout that swallows the window is not a split."
        )

    floors = {
        "minTrainRows": args.min_train_rows,
        "minTrainPositives": args.min_train_positives,
        "minTrainNegatives": args.min_train_negatives,
        "minTestRows": args.min_test_rows,
        "minTestPositives": args.min_test_positives,
        "maxCensoredRate": args.max_censored_rate,
    }

    print(f"# {args.stage} — dataset build")
    print(f"window [{window.start.date()}, {window.end.date()}), purge {window.purge_days}d, "
          f"holdout {window.holdout_days}d (test from {window.test_from.date()})")
    print("")

    with psycopg.connect(args.dsn) as conn:
        census = census_from(run_query(conn, args.census, window))

        # Printed BEFORE the training query runs. If that query fails, the census
        # is the most useful thing on the screen and it should not be lost behind
        # a traceback.
        print("Label census — the population, and everything the training query removed:")
        for line in render_census(census):
            print(line)
        print("")

        raw = run_query(conn, args.sql, window)

    diagnosis = {
        "stage": args.stage,
        "window": {
            "from": window.start.isoformat(),
            "to": window.end.isoformat(),
            "purgeDays": window.purge_days,
            "holdoutDays": window.holdout_days,
            "testFrom": window.test_from.isoformat(),
        },
        "labelCensus": census,
        "sufficiencyFloors": floors,
        "datasetSql": {"path": str(args.sql), "sha256": sha256_of(args.sql)},
        "censusSql": {"path": str(args.census), "sha256": sha256_of(args.census)},
        "builtAt": datetime.now(timezone.utc).isoformat(),
    }

    if raw.empty:
        # Not a crash and not an empty file: a stated reason. The census above has
        # already said which of the four exclusions consumed the population.
        diagnosis["splits"] = None
        # The reasons are derived from the census rather than listed, so the run
        # names the exclusion that actually consumed the population instead of
        # reciting all four with zeroes beside three of them.
        by = census["byStatus"]
        reasons = ["the decision ⋈ label join returned zero rows"]
        if census["joinedRows"] == 0:
            reasons.append("no decision in this window matches the stage and the filters at all")
        if by["absent"]:
            reasons.append(
                f"{by['absent']} of {census['joinedRows']} decisions have no label row at all — "
                "the labeller has not opened one for them"
            )
        if by["pending"]:
            reasons.append(
                f"{by['pending']} labels are pending: their windows have not closed. "
                "A pending window is an outcome that has not happened yet, NOT a negative"
            )
        if by["censored"]:
            reasons.append(f"{by['censored']} labels are censored — the window was not observed")
        if by["unresolvable"]:
            reasons.append(f"{by['unresolvable']} labels can never be graded")
        if counts_excluded := census["excludedFromTraining"]["resolvedButWindowOpenAtPurge"]:
            reasons.append(f"{counts_excluded} resolved labels close after the purge cutoff")
        if counts_circular := census["excludedFromTraining"]["resolvedButSubjectPostdatedTheCoin"]:
            reasons.append(f"{counts_circular} resolved labels have an origin before their decision")
        refuse(args.out, diagnosis, reasons)

    df, names = flatten_features(raw)
    df = normalise_numeric(df)
    df = assign_split(df, window)
    splits = {name: describe_split(df, name) for name in ("train", "purged", "test")}
    diagnosis["splits"] = splits

    print("Splits — temporal, purged, never random:")
    for line in render_splits(splits):
        print(line)
    print("")

    failures = sufficiency_failures(splits, census, floors, window)
    if failures:
        refuse(args.out, diagnosis, failures)

    manifest = build_manifest(
        df, names, window, args.stage, args.sql, args.census, census, splits, floors
    )

    args.out.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.out / "dataset.parquet", index=False)
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (args.out / "census.json").write_text(json.dumps(diagnosis, indent=2), encoding="utf-8")

    print(f"{manifest['rowCount']} rows, {manifest['positiveCount']} positive, {len(names)} features")
    print(f"lanes: {manifest['laneCounts']}")
    print(f"population: {manifest['population']}")


if __name__ == "__main__":
    main()
