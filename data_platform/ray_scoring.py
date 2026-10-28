#!/usr/bin/env python3
"""Train a leakage-safe temporal baseline and score batches with real Ray tasks.

Features come only from representative-day history before the outcome date. The
result is decision-support evidence, never an automated eligibility decision.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import ray
from deltalake import DeltaTable, write_deltalake
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = [
    "previous_activations",
    "previous_amount_kobo",
    "previous_confirmed",
    "previous_confirmation_rate",
    "rolling_activations",
    "active_history_days",
    "days_since_previous",
]


def history_features(history: list[dict[str, Any]], days_since_previous: int) -> dict[str, float]:
    previous = history[-1]
    recent = history[-3:]
    return {
        "previous_activations": float(previous["activations"]),
        "previous_amount_kobo": float(previous["amount_kobo"]),
        "previous_confirmed": float(previous["confirmed"]),
        "previous_confirmation_rate": float(previous["confirmation_rate"]),
        "rolling_activations": round(sum(float(row["activations"]) for row in recent) / len(recent), 6),
        "active_history_days": float(len(history)),
        "days_since_previous": float(days_since_previous),
    }


def build_supervised(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["rep_token"]].append(row)
    samples = []
    for history in grouped.values():
        history.sort(key=lambda row: row["event_date"])
        for index in range(1, len(history)):
            current = history[index]
            previous = history[index - 1]
            gap = (date.fromisoformat(current["event_date"]) - date.fromisoformat(previous["event_date"])).days
            samples.append({
                "event_date": current["event_date"],
                "rep_token": current["rep_token"],
                "features": history_features(history[:index], gap),
                "label": int(current["confirmed"] > 0 and current["confirmation_rate"] >= 0.5),
            })
    return sorted(samples, key=lambda row: (row["event_date"], row["rep_token"]))


def temporal_split(samples: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    dates = sorted({row["event_date"] for row in samples})
    if len(dates) < 2:
        raise RuntimeError("Temporal evaluation requires outcomes on at least two dates")
    cut = max(1, int(len(dates) * 0.75))
    cut = min(cut, len(dates) - 1)
    boundary = dates[cut]
    train = [row for row in samples if row["event_date"] < boundary]
    test = [row for row in samples if row["event_date"] >= boundary]
    if not train or not test:
        raise RuntimeError("Temporal train and test partitions must both be non-empty")
    return train, test


@ray.remote
def score_batch(model: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    coefficients = np.asarray(model["coefficients"], dtype=float)
    means = np.asarray(model["means"], dtype=float)
    scales = np.asarray(model["scales"], dtype=float)
    matrix = np.asarray([[row["features"][name] for name in model["features"]] for row in rows], dtype=float)
    normalized = (matrix - means) / scales
    logits = normalized @ coefficients + float(model["intercept"])
    probabilities = 1.0 / (1.0 + np.exp(-np.clip(logits, -30, 30)))
    output = []
    for row, probability in zip(rows, probabilities):
        output.append({
            "event_date": row["event_date"],
            "rep_token": row["rep_token"],
            "opportunity_score": round(float(probability), 6),
            "model_version": model["model_version"],
            "explanation": f"History-only next-period baseline through {row['event_date']}; no current-outcome features",
        })
    return output


def model_metadata(model: Any, input_hash: str) -> dict[str, Any]:
    classifier = model.named_steps["logisticregression"]
    scaler = model.named_steps["standardscaler"]
    body = {
        "coefficients": classifier.coef_[0].tolist(),
        "intercept": float(classifier.intercept_[0]),
        "input_hash": input_hash,
        "training_mode": "temporal_history_only_logistic_regression",
        "features": FEATURES,
    }
    model_version = "ray_temporal_" + hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]
    return {
        **body,
        "means": scaler.mean_.tolist(),
        "scales": np.where(scaler.scale_ == 0, 1, scaler.scale_).tolist(),
        "model_version": model_version,
        "model_approved": False,
    }


def run_scoring(lakehouse_path: Path) -> dict[str, Any]:
    source_path = lakehouse_path / "gold" / "rep_performance"
    rows = DeltaTable(str(source_path)).to_pyarrow_table().to_pylist()
    samples = build_supervised(rows)
    if len(samples) < 8:
        raise RuntimeError("At least eight temporal representative-day samples are required")
    train, test = temporal_split(samples)
    x_train = np.asarray([[row["features"][name] for name in FEATURES] for row in train])
    y_train = np.asarray([row["label"] for row in train])
    x_test = np.asarray([[row["features"][name] for name in FEATURES] for row in test])
    y_test = np.asarray([row["label"] for row in test])
    if len(np.unique(y_train)) < 2:
        raise RuntimeError("Temporal training requires both positive and negative historical labels")
    estimator = make_pipeline(StandardScaler(), LogisticRegression(random_state=42, max_iter=1000))
    estimator.fit(x_train, y_train)
    test_probabilities = estimator.predict_proba(x_test)[:, 1]
    auc = round(float(roc_auc_score(y_test, test_probabilities)), 6) if len(np.unique(y_test)) == 2 else None
    average_precision = round(float(average_precision_score(y_test, test_probabilities)), 6) if int(y_test.sum()) > 0 else None
    brier = round(float(brier_score_loss(y_test, test_probabilities)), 6)
    prevalence = round(float(np.mean(y_test)), 6)
    baseline_brier = round(float(brier_score_loss(y_test, np.full_like(y_test, prevalence, dtype=float))), 6)
    input_hash = hashlib.sha256(json.dumps(samples, sort_keys=True, default=str).encode()).hexdigest()
    metadata = model_metadata(estimator, input_hash)

    latest: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        latest[row["rep_token"]].append(row)
    scoring_rows = []
    for history in latest.values():
        history.sort(key=lambda row: row["event_date"])
        scoring_rows.append({
            "event_date": history[-1]["event_date"],
            "rep_token": history[-1]["rep_token"],
            "features": history_features(history, 1),
        })
    scoring_rows.sort(key=lambda row: (row["event_date"], row["rep_token"]))

    external_address = os.environ.get("RAY_ADDRESS")
    ray.init(address=external_address or None, include_dashboard=False, ignore_reinit_error=True, namespace="kampusforce-reference")
    try:
        batches = [scoring_rows[index:index + 8] for index in range(0, len(scoring_rows), 8)]
        futures = [score_batch.remote(metadata, batch) for batch in batches]
        scored = [item for batch in ray.get(futures) for item in batch]
    finally:
        if not external_address:
            ray.shutdown()
    output_path = lakehouse_path / "gold" / "rep_opportunity_scores"
    schema = pa.schema([("event_date", pa.string()), ("rep_token", pa.string()), ("opportunity_score", pa.float64()), ("model_version", pa.string()), ("explanation", pa.string())])
    write_deltalake(str(output_path), pa.Table.from_pylist(scored, schema=schema), mode="overwrite")
    manifest = {
        "run_ref": metadata["model_version"],
        "engine": "ray",
        "mode": "ray_cluster" if external_address else "local_ray_reference",
        "input_hash": input_hash,
        "output_hash": hashlib.sha256(json.dumps(scored, sort_keys=True).encode()).hexdigest(),
        "rows_processed": len(scored),
        "quarantined_rows": 0,
        "training_rows": len(train),
        "test_rows": len(test),
        "test_auc": auc,
        "baseline_auc": 0.5,
        "test_average_precision": average_precision,
        "baseline_average_precision": prevalence,
        "test_brier_score": brier,
        "baseline_brier_score": baseline_brier,
        "train_positive_rows": int(y_train.sum()),
        "test_positive_rows": int(y_test.sum()),
        "evaluation_warning": "Small synthetic holdout; metrics are diagnostic only and are not model-quality or fairness approval" if len(test) < 100 else "Temporal holdout remains subject to independent model-quality and fairness review",
        "temporal_test_start": test[0]["event_date"],
        "ray_task_batches": len(batches),
        "model_version": metadata["model_version"],
        "model_approved": False,
        "leakage_controls": ["history_only_features", "outcome_date_excluded_from_features", "time_ordered_holdout", "no_random_row_split"],
        "table_version": DeltaTable(str(output_path)).version(),
        "production_boundary": "Temporal execution is verified locally. AUC is diagnostic only; model approval, managed-cluster load, failover, drift, fairness and autoscaling acceptance remain open.",
    }
    (lakehouse_path / "ray_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    (lakehouse_path / "model.json").write_text(json.dumps(metadata, indent=2, sort_keys=True))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lakehouse", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(run_scoring(args.lakehouse), sort_keys=True))


if __name__ == "__main__":
    main()
