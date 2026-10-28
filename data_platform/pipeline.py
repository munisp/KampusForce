#!/usr/bin/env python3
"""KampusForce local Delta Lake medallion reference pipeline.

Input must already be pseudonymized. Raw NIN, BVN, MSISDN, bank account, names and
email addresses are rejected rather than persisted. This is a local executable
reference, not evidence of an object-storage, Flink, Spark or Sedona deployment.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
from deltalake import DeltaTable, write_deltalake

HASH_RE = re.compile(r"^[a-f0-9]{64}$")
PROHIBITED_KEYS = {"phone", "phone_e164", "phone_number", "msisdn", "nin", "bvn", "bank_account", "bankaccount", "account_number", "accountnumber", "name", "customer_name", "email", "address"}
REQUIRED = {"event_id", "event_type", "occurred_at", "campus_id", "vendor_id", "rep_id", "product_id", "customer_ref_hash", "consent", "amount_kobo", "status"}
OPTIONAL = {"rep_commission_kobo", "platform_fee_kobo", "latitude", "longitude"}
ALLOWED_FIELDS = REQUIRED | OPTIONAL
ALLOWED_EVENT_TYPES = {"account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund", "activation"}
IDENTITY_REQUIRED = {"event_id", "event_type", "occurred_at", "subject_type", "subject_token", "case_type", "case_state", "provider_mode", "consent"}
IDENTITY_CASE_TYPES = {"representative_kyc", "campus_lead_kyc", "vendor_kyb", "operations_kyc", "customer_handoff"}
IDENTITY_STATES = {"draft", "submitted", "processing", "needs_more_info", "manual_review", "approved", "rejected", "expired", "revoked"}
MAX_SAFE_INTEGER = 9_007_199_254_740_991


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def event_fingerprint(event: dict[str, Any]) -> str:
    # Delivery metadata may change on replay; the immutable business event may not.
    return canonical_hash({key: value for key, value in event.items() if key not in {"ingested_at", "source_run_ref"}})


def token_key() -> bytes:
    value = os.environ.get("KF_ANALYTICS_TOKEN_KEY", "")
    if len(value) < 32:
        raise RuntimeError("KF_ANALYTICS_TOKEN_KEY must contain at least 32 characters; it is never written to manifests")
    return value.encode()


def tokenize(kind: str, value: Any, key: bytes) -> str:
    return hmac.new(key, f"kampusforce:{kind}:{value}".encode(), hashlib.sha256).hexdigest()


def validate_event(event: dict[str, Any]) -> tuple[bool, str]:
    keys = {key.lower() for key in event}
    prohibited = sorted(keys & PROHIBITED_KEYS)
    if prohibited:
        return False, f"prohibited_raw_fields:{','.join(prohibited)}"
    unknown = sorted(set(event) - ALLOWED_FIELDS)
    if unknown:
        return False, f"unexpected_fields:{','.join(unknown)}"
    missing = sorted(REQUIRED - set(event))
    if missing:
        return False, f"missing_fields:{','.join(missing)}"
    if not isinstance(event["event_id"], str) or not re.fullmatch(r"[A-Za-z0-9:_-]{8,80}", event["event_id"]):
        return False, "invalid_event_id"
    if re.fullmatch(r"\+?\d{7,16}", event["event_id"]):
        return False, "identifier_like_event_id"
    if event["event_type"] not in ALLOWED_EVENT_TYPES:
        return False, "invalid_event_type"
    if not isinstance(event["customer_ref_hash"], str) or not HASH_RE.match(event["customer_ref_hash"]):
        return False, "customer_reference_must_be_sha256"
    if not isinstance(event["consent"], bool):
        return False, "invalid_consent"
    for field in ("campus_id", "vendor_id", "rep_id", "product_id", "amount_kobo"):
        if not isinstance(event[field], int) or isinstance(event[field], bool) or not 0 <= event[field] <= MAX_SAFE_INTEGER:
            return False, f"invalid_{field}"
    for field in ("campus_id", "vendor_id", "rep_id", "product_id"):
        if event[field] == 0:
            return False, f"invalid_{field}"
    for field in ("rep_commission_kobo", "platform_fee_kobo"):
        if field in event and (not isinstance(event[field], int) or isinstance(event[field], bool) or not 0 <= event[field] <= MAX_SAFE_INTEGER):
            return False, f"invalid_{field}"
    try:
        occurred_at = datetime.fromisoformat(str(event["occurred_at"]).replace("Z", "+00:00"))
        if occurred_at.utcoffset() is None:
            return False, "timezone_required"
    except ValueError:
        return False, "invalid_occurred_at"
    if event["status"] not in {"pending", "confirmed", "payable", "paid", "disputed", "void", "clawed_back", "failed", "processed"}:
        return False, "invalid_status"
    for field in ("latitude", "longitude"):
        if field in event and event[field] is not None and (isinstance(event[field], bool) or not isinstance(event[field], (int, float))):
            return False, f"invalid_{field}"
    if event.get("latitude") is not None and not -90 <= event["latitude"] <= 90:
        return False, "invalid_latitude"
    if event.get("longitude") is not None and not -180 <= event["longitude"] <= 180:
        return False, "invalid_longitude"
    return True, "accepted"


def validate_identity_event(event: dict[str, Any]) -> tuple[bool, str]:
    keys = {key.lower() for key in event}
    prohibited = sorted(keys & PROHIBITED_KEYS)
    if prohibited:
        return False, f"prohibited_raw_fields:{','.join(prohibited)}"
    unknown = sorted(set(event) - IDENTITY_REQUIRED)
    if unknown:
        return False, f"unexpected_identity_fields:{','.join(unknown)}"
    missing = sorted(IDENTITY_REQUIRED - set(event))
    if missing:
        return False, f"missing_identity_fields:{','.join(missing)}"
    if not isinstance(event["event_id"], str) or not re.fullmatch(r"[A-Za-z0-9:_-]{8,80}", event["event_id"]):
        return False, "invalid_identity_event_id"
    if not isinstance(event["subject_token"], str) or not HASH_RE.match(event["subject_token"]):
        return False, "identity_subject_must_be_hmac_sha256"
    if event["subject_type"] not in {"user", "vendor", "customer_handoff"}:
        return False, "invalid_identity_subject_type"
    if event["case_type"] not in IDENTITY_CASE_TYPES or event["case_state"] not in IDENTITY_STATES:
        return False, "invalid_identity_case_contract"
    if event["provider_mode"] not in {"sandbox", "live"} or not isinstance(event["consent"], bool):
        return False, "invalid_identity_mode_or_consent"
    if not isinstance(event["event_type"], str) or not re.fullmatch(r"identity\.[a-z_]{2,80}", event["event_type"]):
        return False, "invalid_identity_event_type"
    try:
        occurred_at = datetime.fromisoformat(str(event["occurred_at"]).replace("Z", "+00:00"))
        if occurred_at.utcoffset() is None:
            return False, "identity_timezone_required"
    except ValueError:
        return False, "invalid_identity_occurred_at"
    return True, "accepted"


def identity_silver_schema() -> pa.Schema:
    return pa.schema([
        ("event_id", pa.string()), ("event_type", pa.string()), ("occurred_at", pa.string()), ("event_date", pa.string()),
        ("subject_type", pa.string()), ("subject_token", pa.string()), ("case_type", pa.string()),
        ("case_state", pa.string()), ("provider_mode", pa.string()), ("consent_policy", pa.string()),
    ])


def identity_gold_schema() -> pa.Schema:
    return pa.schema([
        ("event_date", pa.string()), ("case_type", pa.string()), ("case_state", pa.string()),
        ("provider_mode", pa.string()), ("events", pa.int64()), ("subjects", pa.int64()),
    ])


def table(rows: list[dict[str, Any]], schema: pa.Schema | None = None) -> pa.Table:
    if not rows and schema is None:
        raise ValueError("An empty table requires an explicit schema")
    return pa.Table.from_pylist(rows, schema=schema)


def write(table_path: Path, rows: list[dict[str, Any]], mode: str = "overwrite", partition_by: list[str] | None = None, schema: pa.Schema | None = None) -> None:
    table_path.parent.mkdir(parents=True, exist_ok=True)
    write_deltalake(str(table_path), table(rows, schema=schema), mode=mode, partition_by=partition_by, schema_mode="merge")


def silver_schema() -> pa.Schema:
    return pa.schema([
        ("event_id", pa.string()), ("event_type", pa.string()), ("occurred_at", pa.string()), ("event_date", pa.string()),
        ("campus_token", pa.string()), ("vendor_token", pa.string()), ("rep_token", pa.string()), ("product_token", pa.string()),
        ("customer_token", pa.string()), ("amount_kobo", pa.int64()), ("rep_commission_kobo", pa.int64()),
        ("platform_fee_kobo", pa.int64()), ("status", pa.string()), ("geo_cell", pa.string()), ("consent_policy", pa.string()),
    ])


def gold_schema(name: str) -> pa.Schema:
    if name == "geo_activations":
        return pa.schema([("event_date", pa.string()), ("geo_cell", pa.string()), ("activations", pa.int64()), ("confirmed", pa.int64())])
    dimension = {"campus_performance": "campus_token", "vendor_performance": "vendor_token", "rep_performance": "rep_token"}[name]
    return pa.schema([
        ("event_date", pa.string()), ("activations", pa.int64()), ("confirmed", pa.int64()), ("amount_kobo", pa.int64()),
        ("rep_commission_kobo", pa.int64()), ("platform_fee_kobo", pa.int64()), (dimension, pa.string()), ("confirmation_rate", pa.float64()),
    ])


def merge_bronze(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    source = table(rows)
    if not path.exists():
        write_deltalake(str(path), source, mode="append", partition_by=["event_date"])
        return
    (
        DeltaTable(str(path))
        .merge(source=source, predicate="target.event_id = source.event_id", source_alias="source", target_alias="target")
        .when_not_matched_insert_all()
        .execute()
    )


def delete_where(path: Path, predicate: str) -> dict[str, int]:
    if not path.exists():
        return {"before": 0, "after": 0, "deleted": 0}
    delta = DeltaTable(str(path))
    before = delta.to_pyarrow_table().num_rows
    delta.delete(predicate)
    after = DeltaTable(str(path)).to_pyarrow_table().num_rows
    return {"before": before, "after": after, "deleted": before - after}


def silver_rows(bronze: list[dict[str, Any]], key: bytes) -> list[dict[str, Any]]:
    output = []
    for event in bronze:
        if not event["consent"]:
            continue
        occurred = datetime.fromisoformat(event["occurred_at"].replace("Z", "+00:00")).astimezone(timezone.utc)
        output.append({
            "event_id": event["event_id"],
            "event_type": event["event_type"],
            "occurred_at": occurred.isoformat(),
            "event_date": occurred.date().isoformat(),
            "campus_token": tokenize("campus", event["campus_id"], key),
            "vendor_token": tokenize("vendor", event["vendor_id"], key),
            "rep_token": tokenize("rep", event["rep_id"], key),
            "product_token": tokenize("product", event["product_id"], key),
            "customer_token": tokenize("customer", event["customer_ref_hash"], key),
            "amount_kobo": event["amount_kobo"],
            "rep_commission_kobo": event.get("rep_commission_kobo", 0),
            "platform_fee_kobo": event.get("platform_fee_kobo", 0),
            "status": event["status"],
            "geo_cell": None if event.get("latitude") is None or event.get("longitude") is None else f"{event['latitude']:.1f}:{event['longitude']:.1f}",
            "consent_policy": "consented_pseudonymized_v1",
        })
    return output


def gold_marts(silver: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    confirmed_states = {"confirmed", "payable", "paid"}
    campus: dict[tuple[str, str], dict[str, Any]] = {}
    vendor: dict[tuple[str, str], dict[str, Any]] = {}
    representative: dict[tuple[str, str], dict[str, Any]] = {}
    geo: dict[tuple[str, str], dict[str, Any]] = {}
    for row in silver:
        for target, key_value in ((campus, row["campus_token"]), (vendor, row["vendor_token"]), (representative, row["rep_token"])):
            key = (row["event_date"], key_value)
            item = target.setdefault(key, {"event_date": row["event_date"], "activations": 0, "confirmed": 0, "amount_kobo": 0, "rep_commission_kobo": 0, "platform_fee_kobo": 0})
            item["activations"] += 1
            item["confirmed"] += int(row["status"] in confirmed_states)
            if row["status"] in confirmed_states:
                item["amount_kobo"] += row["amount_kobo"]
                item["rep_commission_kobo"] += row["rep_commission_kobo"]
                item["platform_fee_kobo"] += row["platform_fee_kobo"]
        if row["geo_cell"]:
            key = (row["event_date"], row["geo_cell"])
            item = geo.setdefault(key, {"event_date": row["event_date"], "geo_cell": row["geo_cell"], "activations": 0, "confirmed": 0})
            item["activations"] += 1
            item["confirmed"] += int(row["status"] in confirmed_states)
    def finish(target: dict[tuple[str, str], dict[str, Any]], dimension: str) -> list[dict[str, Any]]:
        rows = []
        for (_, key_value), item in target.items():
            item[dimension] = key_value
            item["confirmation_rate"] = round(item["confirmed"] / item["activations"], 6) if item["activations"] else 0
            rows.append(item)
        return sorted(rows, key=lambda value: (value["event_date"], value[dimension]))
    return {
        "campus_performance": finish(campus, "campus_token"),
        "vendor_performance": finish(vendor, "vendor_token"),
        "rep_performance": finish(representative, "rep_token"),
        "geo_activations": sorted(geo.values(), key=lambda value: (value["event_date"], value["geo_cell"])),
    }


def run_identity_events(payload: dict[str, Any], output_path: Path, key: bytes) -> dict[str, Any]:
    events = payload.get("identity_events", [])
    tombstones = payload.get("identity_tombstones", [])
    if not isinstance(events, list) or not isinstance(tombstones, list) or any(not isinstance(value, str) or not HASH_RE.match(value) for value in tombstones):
        raise ValueError("Identity events and subject-token tombstones have invalid contracts")
    accepted = []
    quarantined = []
    seen = set()
    for event in events:
        if not isinstance(event, dict):
            quarantined.append({"event_hash": canonical_hash(event), "reason": "identity_event_not_object"})
            continue
        valid, reason = validate_identity_event(event)
        if valid and event["consent"] is not True:
            valid, reason = False, "identity_consent_required"
        if valid and event["event_id"] in seen:
            valid, reason = False, "duplicate_identity_event_id"
        if not valid:
            quarantined.append({"event_hash": canonical_hash(event), "reason": reason})
            continue
        seen.add(event["event_id"])
        occurred = datetime.fromisoformat(event["occurred_at"].replace("Z", "+00:00")).astimezone(timezone.utc)
        accepted.append({**event, "occurred_at": occurred.isoformat(), "event_date": occurred.date().isoformat(), "source_run_ref": payload.get("run_ref", "unlabelled")})
    bronze_path = output_path / "bronze" / "identity_lifecycle_events"
    existing = {row["event_id"]: event_fingerprint(row) for row in DeltaTable(str(bronze_path)).to_pyarrow_table().to_pylist()} if bronze_path.exists() else {}
    new_events = []
    duplicates = 0
    for event in accepted:
        if event["event_id"] not in existing:
            new_events.append(event)
        elif existing[event["event_id"]] == event_fingerprint(event):
            duplicates += 1
        else:
            quarantined.append({"event_hash": canonical_hash(event), "reason": "conflicting_identity_event_id"})
    if new_events:
        merge_bronze(bronze_path, new_events)
    quarantine_path = output_path / "quarantine" / "identity_event_rejections"
    existing_rejections = {(row["event_hash"], row["reason"]) for row in DeltaTable(str(quarantine_path)).to_pyarrow_table().to_pylist()} if quarantine_path.exists() else set()
    new_quarantined = []
    for item in quarantined:
        rejection_key = (item["event_hash"], item["reason"])
        if rejection_key not in existing_rejections:
            new_quarantined.append(item)
            existing_rejections.add(rejection_key)
    if new_quarantined:
        write(quarantine_path, new_quarantined, mode="append")
    deletion = {"requested": len(tombstones), "physical_vacuum": "scheduled_separately"}
    if tombstones and bronze_path.exists():
        quoted = ",".join(f"'{value}'" for value in tombstones)
        deletion["bronze"] = delete_where(bronze_path, f"subject_token IN ({quoted})")
    bronze = DeltaTable(str(bronze_path)).to_pyarrow_table().to_pylist() if bronze_path.exists() else []
    silver = [{
        "event_id": row["event_id"], "event_type": row["event_type"], "occurred_at": row["occurred_at"],
        "event_date": row["event_date"], "subject_type": row["subject_type"], "subject_token": row["subject_token"],
        "case_type": row["case_type"], "case_state": row["case_state"], "provider_mode": row["provider_mode"],
        "consent_policy": "consented_identity_lifecycle_v1",
    } for row in bronze if row["event_id"] not in {event["event_id"] for event in new_quarantined}]
    silver_path = output_path / "silver" / "identity_lifecycle_events"
    write(silver_path, silver, schema=identity_silver_schema())
    if tombstones:
        quoted = ",".join(f"'{value}'" for value in tombstones)
        deletion["silver"] = delete_where(silver_path, f"subject_token IN ({quoted})")
        silver = DeltaTable(str(silver_path)).to_pyarrow_table().to_pylist()
    aggregates: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    subjects: dict[tuple[str, str, str, str], set[str]] = {}
    for row in silver:
        group = (row["event_date"], row["case_type"], row["case_state"], row["provider_mode"])
        item = aggregates.setdefault(group, {"event_date": group[0], "case_type": group[1], "case_state": group[2], "provider_mode": group[3], "events": 0, "subjects": 0})
        item["events"] += 1
        subjects.setdefault(group, set()).add(row["subject_token"])
    gold = []
    for group, item in aggregates.items():
        item["subjects"] = len(subjects[group])
        gold.append(item)
    gold.sort(key=lambda row: (row["event_date"], row["case_type"], row["case_state"], row["provider_mode"]))
    gold_path = output_path / "gold" / "identity_case_daily"
    write(gold_path, gold, schema=identity_gold_schema())
    versions = {}
    counts = {}
    for layer, path in (("bronze", bronze_path), ("silver", silver_path), ("gold", gold_path)):
        if path.exists():
            delta = DeltaTable(str(path))
            versions[layer] = delta.version()
            counts[layer] = delta.to_pyarrow_table().num_rows
    manifest = {
        "engine": "delta_lake", "mode": "local_sandbox_reference", "rows_processed": len(new_events),
        "duplicate_rows": duplicates, "quarantined_rows": len(quarantined), "quarantine_rows_written": len(new_quarantined),
        "table_versions": versions, "row_counts": counts, "deletion_evidence": deletion,
        "controls": ["identity_strict_allowlist", "no_documents_or_biometrics", "consent_required", "hmac_subject_tokens", "immutable_replay", "identity_dsar_rebuild"],
        "production_boundary": "No raw identity document, NIN/BVN, biometric, template or evidence-finding field is accepted by this contract.",
    }
    output_path.mkdir(parents=True, exist_ok=True)
    (output_path / "identity_run_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


def run_pipeline(input_path: Path, output_path: Path) -> dict[str, Any]:
    payload = json.loads(input_path.read_text())
    events = payload.get("events")
    tombstones = payload.get("tombstones", [])
    if not isinstance(events, list) or not events:
        raise ValueError("Input must contain a non-empty events list")
    if not isinstance(tombstones, list) or any(not isinstance(value, str) or not HASH_RE.match(value) for value in tombstones):
        raise ValueError("Tombstones must be SHA-256 customer reference hashes")
    key = token_key()
    accepted = []
    quarantined = []
    seen = set()
    for event in events:
        if not isinstance(event, dict):
            quarantined.append({"event_hash": canonical_hash(event), "reason": "event_not_object"})
            continue
        valid, reason = validate_event(event)
        event_id = event.get("event_id", canonical_hash(event))
        if valid and event_id in seen:
            valid, reason = False, "duplicate_event_id"
        if not valid:
            quarantined.append({"event_hash": canonical_hash(event), "reason": reason})
            continue
        seen.add(event_id)
        occurred = datetime.fromisoformat(event["occurred_at"].replace("Z", "+00:00")).astimezone(timezone.utc)
        accepted.append({**event, "occurred_at": occurred.isoformat(), "event_date": occurred.date().isoformat(), "ingested_at": datetime.now(timezone.utc).isoformat(), "source_run_ref": payload.get("run_ref", "unlabelled")})

    bronze_path = output_path / "bronze" / "activation_events"
    existing = {}
    if bronze_path.exists():
        existing = {
            row["event_id"]: event_fingerprint(row)
            for row in DeltaTable(str(bronze_path)).to_pyarrow_table().to_pylist()
        }
    new_events = []
    duplicate_rows = 0
    for event in accepted:
        if event["event_id"] not in existing:
            new_events.append(event)
        elif existing[event["event_id"]] == event_fingerprint(event):
            duplicate_rows += 1
        else:
            quarantined.append({"event_hash": canonical_hash(event), "reason": "conflicting_existing_event_id"})
    if new_events:
        merge_bronze(bronze_path, new_events)
    if not bronze_path.exists():
        raise RuntimeError("No valid bronze events are available")
    quarantine_path = output_path / "quarantine" / "event_rejections"
    existing_rejections = set()
    if quarantine_path.exists():
        existing_rejections = {(row["event_hash"], row["reason"]) for row in DeltaTable(str(quarantine_path)).to_pyarrow_table().to_pylist()}
    new_quarantined = []
    rejection_keys = set()
    for item in quarantined:
        key = (item["event_hash"], item["reason"])
        if key not in existing_rejections and key not in rejection_keys:
            new_quarantined.append(item)
            rejection_keys.add(key)
    if new_quarantined:
        write(quarantine_path, new_quarantined, mode="append")

    deletion_evidence = {"requested": len(tombstones), "tables": {}, "physical_vacuum": "scheduled_separately; logical Delta deletes verified"}
    if tombstones:
        quoted = ",".join(f"'{value}'" for value in tombstones)
        deletion_evidence["tables"]["bronze"] = delete_where(bronze_path, f"customer_ref_hash IN ({quoted})")

    bronze = DeltaTable(str(bronze_path)).to_pyarrow_table().to_pylist()
    silver = silver_rows(bronze, key)
    silver_path = output_path / "silver" / "activation_events"
    write(silver_path, silver, schema=silver_schema())

    if tombstones:
        customer_tokens = [tokenize("customer", value, key) for value in tombstones]
        quoted = ",".join(f"'{value}'" for value in customer_tokens)
        deletion_evidence["tables"]["silver"] = delete_where(silver_path, f"customer_token IN ({quoted})")
        silver = DeltaTable(str(silver_path)).to_pyarrow_table().to_pylist()

    marts = gold_marts(silver)
    for name, rows in marts.items():
        write(output_path / "gold" / name, rows, schema=gold_schema(name))
    versions = {}
    counts = {}
    for layer, name in [("bronze", "activation_events"), ("silver", "activation_events"), *[("gold", name) for name in marts if (output_path / "gold" / name).exists()]]:
        delta = DeltaTable(str(output_path / layer / name))
        versions[f"{layer}.{name}"] = delta.version()
        counts[f"{layer}.{name}"] = delta.to_pyarrow_table().num_rows
    identity_manifest = run_identity_events(payload, output_path, key)
    manifest = {
        "run_ref": payload.get("run_ref", "unlabelled"),
        "engine": "delta_lake",
        "mode": "local_sandbox_reference",
        "input_hash": canonical_hash({"events": events, "tombstones": tombstones, "identity_events": payload.get("identity_events", []), "identity_tombstones": payload.get("identity_tombstones", [])}),
        "output_hash": canonical_hash({"versions": versions, "counts": counts}),
        "rows_processed": len(new_events),
        "duplicate_rows": duplicate_rows,
        "quarantined_rows": len(quarantined),
        "quarantine_rows_written": len(new_quarantined),
        "table_versions": versions,
        "row_counts": counts,
        "deletion_evidence": deletion_evidence,
        "identity_lifecycle": {"rows_processed": identity_manifest["rows_processed"], "quarantined_rows": identity_manifest["quarantined_rows"], "row_counts": identity_manifest["row_counts"]},
        "controls": ["strict_field_allowlist", "raw_identifier_rejection", "timezone_aware_event_times", "immutable_bronze_insert_only", "replay_deduplication", "conflicting_event_id_quarantine", "consent_filter", "hmac_tokenization", "atomic_delta_writes", "confirmed_only_gold_economics", "gold_rebuild_after_tombstone", "coarse_geospatial_grid"],
        "production_boundary": "No S3/object-store lock client, Flink, Spark, Sedona or production multi-writer deployment is claimed.",
    }
    output_path.mkdir(parents=True, exist_ok=True)
    (output_path / "run_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(run_pipeline(args.input, args.output), sort_keys=True))


if __name__ == "__main__":
    main()
