#!/usr/bin/env python3
"""Executable synthetic acceptance for the local Delta Lake and Ray references.

This proves code behavior only. It is not production-cluster, model-quality,
object-storage, streaming, geospatial or regulatory certification.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

from deltalake import DeltaTable

from pipeline import run_pipeline
from ray_scoring import FEATURES, build_supervised, run_scoring, temporal_split
from ray_serve import OpportunityScoringService


def customer_hash(rep: int) -> str:
    return hashlib.sha256(f"synthetic-customer-{rep}".encode()).hexdigest()


def synthetic_event(rep: int, day: int) -> dict[str, Any]:
    confirmed = (rep + day) % 3 != 0
    amount = 100_000 + rep * 1_000 + day * 100
    return {
        "event_id": f"synthetic-rep-{rep:02d}-day-{day:02d}",
        "event_type": "activation",
        "occurred_at": f"2026-01-{day:02d}T12:00:00Z",
        "campus_id": 1 + rep % 2,
        "vendor_id": 1,
        "rep_id": rep,
        "product_id": 1,
        "customer_ref_hash": customer_hash(rep),
        "consent": True,
        "amount_kobo": amount,
        "rep_commission_kobo": int(amount * 0.8),
        "platform_fee_kobo": amount - int(amount * 0.8),
        "status": "confirmed" if confirmed else "pending",
    }


def rows(path: Path) -> list[dict[str, Any]]:
    return DeltaTable(str(path)).to_pyarrow_table().to_pylist()


def write_input(path: Path, events: list[dict[str, Any]], run_ref: str, tombstones: list[str] | None = None, identity_events: list[dict[str, Any]] | None = None, identity_tombstones: list[str] | None = None) -> None:
    path.write_text(json.dumps({"run_ref": run_ref, "events": events, "tombstones": tombstones or [], "identity_events": identity_events or [], "identity_tombstones": identity_tombstones or []}, indent=2))


def identity_event(event_id: str, token: str) -> dict[str, Any]:
    return {
        "event_id": event_id, "event_type": "identity.approved", "occurred_at": "2026-01-10T12:00:00Z",
        "subject_type": "user", "subject_token": token, "case_type": "representative_kyc",
        "case_state": "approved", "provider_mode": "sandbox", "consent": True,
    }


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def run_acceptance(output: Path) -> dict[str, Any]:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    os.environ["KF_ANALYTICS_TOKEN_KEY"] = "synthetic-local-acceptance-key-not-for-production"

    bronze = output / "bronze" / "activation_events"
    silver = output / "silver" / "activation_events"
    rep_gold = output / "gold" / "rep_performance"
    events = [synthetic_event(rep, day) for rep in range(1, 7) for day in range(1, 11)]
    no_consent = {**synthetic_event(99, 1), "event_id": "synthetic-no-consent", "consent": False}
    raw_identifier = {**synthetic_event(98, 1), "event_id": "synthetic-raw-rejected", "nin": "must-not-be-persisted"}
    nested_identifier = {**synthetic_event(97, 1), "event_id": "synthetic-nested-rejected", "metadata": {"bvn": "nested-must-not-be-persisted"}}
    naive_time = {**synthetic_event(96, 1), "event_id": "synthetic-naive-time", "occurred_at": "2026-01-01T12:00:00"}
    initial_input = output / "initial.json"
    identity_events = [identity_event("identity-synthetic-1", "a" * 64), identity_event("identity-synthetic-2", "b" * 64)]
    invalid_identity = {**identity_event("identity-raw-rejected", "c" * 64), "nin": "raw-identity-must-not-be-persisted"}
    write_input(initial_input, [*events, no_consent, raw_identifier, nested_identifier, naive_time], "synthetic_initial", identity_events=[*identity_events, invalid_identity])
    initial = run_pipeline(initial_input, output)
    require(initial["rows_processed"] == 61, "Only valid events, including non-consented Bronze history, may enter Bronze")
    require(initial["quarantined_rows"] == 3, "Raw, nested and timezone-invalid events must be quarantined")
    require(len(rows(bronze)) == 61, "Unexpected initial Bronze row count")
    require(len(rows(silver)) == 60, "Consent filter must exclude the non-consented event from Silver")
    require(len(rows(rep_gold)) == 60, "Gold must contain only consented representative-day rows")
    quarantine_text = "\n".join(path.read_text() for path in (output / "quarantine").rglob("*.json"))
    require("must-not-be-persisted" not in quarantine_text and "nested-must-not-be-persisted" not in quarantine_text and "raw-identity-must-not-be-persisted" not in quarantine_text, "Raw identifier values must not be copied into quarantine")
    identity_initial = json.loads((output / "identity_run_manifest.json").read_text())
    require(identity_initial["rows_processed"] == 2 and identity_initial["quarantined_rows"] == 1, "Identity lifecycle allowlist or raw-field rejection failed")
    require(len(rows(output / "silver" / "identity_lifecycle_events")) == 2, "Consented identity Silver history is missing")
    pending_gold = next(row for row in rows(rep_gold) if row["rep_token"] and row["event_date"] == "2026-01-02" and row["activations"] == 1 and row["confirmed"] == 0)
    require(pending_gold["amount_kobo"] == 0 and pending_gold["rep_commission_kobo"] == 0, "Pending activation economics leaked into confirmed Gold totals")

    replay_input = output / "replay.json"
    write_input(replay_input, [*events, no_consent, raw_identifier], "synthetic_replay_with_new_delivery_metadata", identity_events=[*identity_events, invalid_identity])
    replay = run_pipeline(replay_input, output)
    require(replay["rows_processed"] == 0, "Identical replay must not insert new Bronze events")
    require(replay["duplicate_rows"] == 61, "Identical replay must be recognized as duplicates")
    require(replay["quarantine_rows_written"] == 0, "Identical invalid replay must not duplicate quarantine evidence")
    require(len(rows(bronze)) == 61, "Immutable replay must not change Bronze cardinality")
    identity_replay = json.loads((output / "identity_run_manifest.json").read_text())
    require(identity_replay["rows_processed"] == 0 and identity_replay["duplicate_rows"] == 2, "Identity lifecycle replay is not immutable")

    conflict = {**events[0], "amount_kobo": events[0]["amount_kobo"] + 1}
    conflict_input = output / "conflict_and_dsar.json"
    write_input(conflict_input, [conflict], "synthetic_conflict_and_dsar", [customer_hash(6)], identity_events=identity_events, identity_tombstones=["a" * 64])
    final = run_pipeline(conflict_input, output)
    require(final["rows_processed"] == 0, "Changed payload with an existing event ID must not update Bronze")
    require(final["quarantined_rows"] == 1, "Conflicting immutable event ID must be quarantined")
    require(final["deletion_evidence"]["tables"]["bronze"]["deleted"] == 10, "DSAR must delete the requested pseudonymous Bronze history")
    require(len(rows(bronze)) == 51, "Conflict must not mutate Bronze and DSAR must remove exactly ten events")
    require(len(rows(silver)) == 50, "Silver must be rebuilt after DSAR")
    require(len(rows(rep_gold)) == 50, "Gold representative mart must be rebuilt after DSAR")
    require(all(row["amount_kobo"] == events[0]["amount_kobo"] for row in rows(bronze) if row["event_id"] == events[0]["event_id"]), "Conflicting amount mutated immutable Bronze")
    require(all(row["rep_id"] != 6 for row in rows(bronze)), "DSAR representative history remains in Bronze")
    identity_final = json.loads((output / "identity_run_manifest.json").read_text())
    identity_silver = rows(output / "silver" / "identity_lifecycle_events")
    require(identity_final["deletion_evidence"]["bronze"]["deleted"] == 1, "Identity subject tombstone did not delete Bronze history")
    require(len(identity_silver) == 1 and identity_silver[0]["subject_token"] == "b" * 64, "Identity Silver was not rebuilt after tombstone")
    require(len(rows(output / "gold" / "identity_case_daily")) == 1, "Identity Gold was not rebuilt after tombstone")

    gold_rows = rows(rep_gold)
    samples = build_supervised(gold_rows)
    require(len(samples) == 45, "Unexpected temporal sample count")
    require(all(set(sample["features"]) == set(FEATURES) for sample in samples), "Model feature contract drifted")
    prohibited_features = {"activations", "amount_kobo", "confirmed", "confirmation_rate", "rep_commission_kobo", "platform_fee_kobo"}
    require(not prohibited_features & set(FEATURES), "Current-outcome fields leaked into model features")
    train, test = temporal_split(samples)
    require(max(row["event_date"] for row in train) < min(row["event_date"] for row in test), "Temporal holdout is not time ordered")
    ray = run_scoring(output)
    require(ray["model_approved"] is False, "Local AUC must never auto-approve a model")
    require(ray["rows_processed"] == 5, "Each remaining representative should receive one next-period score")
    require(ray["ray_task_batches"] >= 1, "No Ray task batch evidence was produced")
    require(0 <= ray["test_brier_score"] <= 1 and 0 <= ray["baseline_brier_score"] <= 1, "Probability calibration diagnostics are invalid")
    require(ray["train_positive_rows"] > 0 and ray["test_positive_rows"] >= 0, "Temporal class evidence is missing")
    scores = rows(output / "gold" / "rep_opportunity_scores")
    require(len(scores) == 5 and all(0 <= row["opportunity_score"] <= 1 for row in scores), "Invalid Ray score output")

    model_path = output / "model.json"
    try:
        OpportunityScoringService(str(model_path))
        raise AssertionError("Ray Serve accepted an unapproved model")
    except RuntimeError as error:
        require("approval" in str(error), "Unexpected unapproved-model failure")
    approved_fixture = json.loads(model_path.read_text())
    approved_fixture["model_approved"] = True
    approved_path = output / "approved_contract_fixture.json"
    approved_path.write_text(json.dumps(approved_fixture))
    service = OpportunityScoringService(str(approved_path))
    corrupt_model = {**approved_fixture, "scales": [0, *approved_fixture["scales"][1:]]}
    corrupt_path = output / "corrupt_model_contract.json"
    corrupt_path.write_text(json.dumps(corrupt_model))
    try:
        OpportunityScoringService(str(corrupt_path))
        raise AssertionError("Ray Serve accepted a zero-scale model")
    except RuntimeError as error:
        require("scales" in str(error), "Unexpected corrupt-model failure")
    numeric_row = {name: 0.5 if name == "previous_confirmation_rate" else 1 for name in FEATURES}
    require(len(service._score([numeric_row])) == 1, "Approved model contract fixture could not score numeric history")
    for invalid in ({**numeric_row, "rep_token": "identifier-not-allowed"}, {**numeric_row, "unexpected": 1}, {**numeric_row, "previous_activations": "1"}):
        try:
            service._score([invalid])
            raise AssertionError("Ray Serve accepted an identifier or non-numeric feature")
        except ValueError:
            pass

    evidence = {
        "status": "passed",
        "mode": "local_synthetic_acceptance",
        "checks": [
            "strict_allowlist_and_nested_raw_identifier_rejection_without_value_persistence",
            "timezone_aware_event_contract",
            "confirmed_only_gold_economics",
            "consent_filter",
            "immutable_bronze_identical_replay",
            "conflicting_event_id_quarantine",
            "dsar_bronze_delete_silver_and_gold_rebuild",
            "history_only_feature_contract",
            "time_ordered_holdout",
            "real_ray_batch_scoring",
            "model_approval_remains_closed",
            "ray_serve_approval_model_array_and_input_contracts",
            "probability_and_prevalence_diagnostics",
            "identity_lifecycle_allowlist_without_documents_or_biometrics",
            "identity_consent_replay_and_subject_tombstone_rebuild",
        ],
        "initial": initial,
        "replay": replay,
        "final": final,
        "ray": ray,
        "production_boundary": "Synthetic local execution does not certify production data quality, managed infrastructure, streaming, Sedona, model fairness, drift, load, failover or autoscaling.",
    }
    (output / "acceptance.json").write_text(json.dumps(evidence, indent=2, sort_keys=True))
    (output / "delta_initial_manifest.json").write_text(json.dumps(initial, indent=2, sort_keys=True))
    (output / "delta_replay_manifest.json").write_text(json.dumps(replay, indent=2, sort_keys=True))
    return evidence


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("/tmp/kampusforce-data-platform-acceptance"))
    args = parser.parse_args()
    evidence = run_acceptance(args.output)
    print(json.dumps({"status": evidence["status"], "checks": evidence["checks"], "output": str(args.output)}, sort_keys=True))


if __name__ == "__main__":
    main()
