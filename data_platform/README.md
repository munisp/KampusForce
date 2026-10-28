# Delta Lake and Ray local reference

This directory contains an executable local reference for the KampusForce target data architecture. It is deliberately separated from production-readiness claims.

## Scope

- **Delta Lake / Parquet:** immutable Bronze event history, conflict quarantine, consent-filtered and HMAC-tokenized Silver records, rebuilt Gold campus/vendor/representative/coarse-geo marts, replay deduplication, and DSAR tombstone evidence.
- **Ray:** history-only temporal logistic regression, time-ordered holdout diagnostics, real Ray batch tasks, and Delta-written representative opportunity scores.
- **Ray Serve:** an approval-gated application with bounded numeric feature contracts, request and queue limits, authentication, health checks, and autoscaling configuration.
- **Identity lifecycle:** a separate consent-filtered Bronze/Silver/Gold flow for pseudonymized onboarding events and subject-token tombstones. It never accepts documents, OCR text, NIN/BVN, biometrics, templates, evidence findings or review reasons.

Local execution does not certify production object storage, Flink, Spark, Sedona, managed Ray, model quality, fairness, drift handling, load, failover, or autoscaling. Models remain unapproved and scores are decision support, not automated eligibility or commission decisions.

## Install and run

Use an isolated Python environment or target directory. Keep the versions in `requirements.txt` pinned.

```bash
python3 -m pip install --target /tmp/kampusforce-python-deps -r data_platform/requirements.txt
PYTHONPATH=/tmp/kampusforce-python-deps python3 data_platform/acceptance.py \
  --output /tmp/kampusforce-data-platform-acceptance
```

The acceptance suite writes synthetic Delta tables, manifests, a model contract, and `acceptance.json` under the selected output directory. It proves local behavior only. The synthetic tokenization key is confined to the test process and is not written to manifests.

To export the application's pseudonymized activation candidates and run the same pipeline against a PostgreSQL sandbox:

```bash
npx tsx scripts/export-lakehouse-input.ts /tmp/kampusforce-lakehouse-input.json
KF_ANALYTICS_TOKEN_KEY='provide-a-local-secret-of-at-least-32-characters' \
  PYTHONPATH=/tmp/kampusforce-python-deps \
  python3 data_platform/pipeline.py \
  --input /tmp/kampusforce-lakehouse-input.json \
  --output /tmp/kampusforce-lakehouse
PYTHONPATH=/tmp/kampusforce-python-deps \
  python3 data_platform/ray_scoring.py --lakehouse /tmp/kampusforce-lakehouse
```

Record only manifests that satisfy the complete local evidence contract:

```bash
npx tsx scripts/record-data-platform-evidence.ts \
  /tmp/kampusforce-data-platform-acceptance/run_manifest.json \
  /tmp/kampusforce-data-platform-acceptance/ray_manifest.json
```

Each run reference is immutable. A repeated run reference is rejected rather than overwriting evidence.

## Privacy and financial semantics

- Input uses a strict field allowlist. Unknown nested fields, raw NIN/BVN, phone/MSISDN, bank account, names, email, and addresses are rejected; their values are not copied into quarantine.
- Event IDs and kobo amounts are bounded. Event timestamps must include a timezone and are normalized to UTC.
- Silver excludes non-consented rows. Serving marts contain pseudonymous tokens, not raw customer identifiers.
- Gold commission and amount totals include only currently `confirmed`, `payable`, or `paid` activation records. Pending, void, disputed, failed, and clawed-back records do not contribute confirmed economics.
- A DSAR tombstone logically deletes matching Bronze history and rebuilds Silver and Gold. Delta `VACUUM` and object-storage lifecycle deletion are separate scheduled operations; logical deletion is not physical erasure evidence.
- Ray features come only from prior representative-day history. Current-outcome fields are prohibited. Small synthetic AUC, average-precision, and Brier diagnostics never approve a model.
- Identity events use domain-separated HMAC subject tokens and a strict flat allowlist. Consent withdrawal exports a subject-token tombstone, logically deletes matching identity Bronze history, and rebuilds identity Silver/Gold without touching activation economics. Physical Delta/object-lifecycle erasure remains a separate scheduled control.

## Production gates

A production deployment still requires reviewed object-storage credentials and locking, streaming and batch-cluster deployment, geospatial validation, row-level serving policy, backup/restore and retention evidence, a managed Ray network and model registry, production training data, independent model/fairness review, drift monitoring, and measured serving load/failover/autoscaling acceptance.
