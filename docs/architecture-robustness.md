# Analytics, lakehouse, Ray and financial-core robustness

Assessment date: 2026-10-29

## Direct answer

It would be incorrect to say that every item in the original specification is fully production-implemented. The commercial product workflows are substantially implemented and tested in the PostgreSQL sandbox. The target data and financial architecture has meaningful executable code, but external clusters, live ledger cutover, scheme participation, production providers, legal approval, real campus outcomes and production service-level evidence remain open.

The scores below assess implementation depth and verified local controls. They are not production-readiness percentages. `productionReady` remains `false` for Delta Lake, Ray, TigerBeetle and Mojaloop.

| Area | Implementation score | Assessment |
|---|---:|---|
| Advanced operational analytics | 92/100 | Robust PostgreSQL-backed operational analytics with explicit metric contracts, first-confirmation event-time series, mature seven-day cohorts, confirmed-only economics, scoped marts, control findings and immutable hashed snapshots. Warehouse-scale benchmarks and external BI governance remain open. |
| Delta Lake lakehouse reference | 86/100 | Executable Bronze/Silver/Gold pipeline with strict input allowlisting, raw-identifier rejection, timezone contracts, immutable replay, conflict quarantine, consent/HMAC tokenization, confirmed-only Gold economics, coarse geo cells, DSAR propagation and lineage. This is not a deployed object-storage/Flink/Spark/Sedona lakehouse. |
| Ray and Ray Serve reference | 84/100 | Real Ray batch tasks, history-only features, temporal holdout, AUC/average-precision/Brier baselines, class evidence, immutable model contracts and approval-gated bounded serving. Small synthetic metrics never approve a model; managed-cluster, drift, fairness, load and failover evidence remain open. |
| TigerBeetle adapter and outbox | 88/100 | Official client, deterministic non-zero/non-max u128 IDs, balanced linked batches, complete idempotency comparison, two-phase transfer builders, retry/terminal classification, stale-claim recovery and fail-closed opening-balance/backfill controls. No replica connection, balance reconciliation or ledger-of-record cutover is claimed. |
| Mojaloop partner-rail contract | 82/100 | Fail-closed party → quote → transfer-preparation sequence with keyed party-reference hashing support, economics/expiry checks, bounded idempotency, transport-level live gates and independent settlement-evidence requirements. No live hub, mTLS/JWS connection, liquidity, callback, clearing or settlement is claimed. |

## Original-requirements coverage

| Requirement area | Status | Evidence and remaining boundary |
|---|---|---|
| Vendors, NIN-verified student representatives and customers | Implemented as sandbox workflows | Role/ownership controls and vendor-KYC boundary exist. Seeded or sandbox identity status is not live NIN verification. Raw NIN/BVN is never persisted. |
| Vendor-verified activation economics | Implemented | Signed ingestion, dedupe/quarantine, versioned rules and confirmation workflows. Financial entitlement begins only at verified activation confirmation. |
| 80% representative / 20% platform split | Implemented | Integer-kobo postings and historical-rule preservation are covered by money and database regressions. |
| Campus Lead 5% platform-funded override | Implemented | Assigned-team confirmed gross commission basis, platform-revenue debit, combined payout, reversal and future netting are preserved. |
| First-touch attribution and assisted onboarding | Implemented | Signed links/QR, salted customer hashes, existing-first-touch preservation and consent-led six-step handoff. Vendor deep-link production telemetry remains external. |
| Prepaid escrow, clawbacks and ₦500 minimum | Implemented as sandbox finance | Escrow reservation, void/clawback, negative-balance netting, KYC/bank-name-match preflight and 10% sandbox withholding exist. No real payment or tax remittance is inferred. |
| Case management, CRM, training, campaigns and growth | Implemented in Phase 12 | Twenty case/CRM innovations, internal training, in-app campaigns, secret-free vendor-service controls, leaderboard, targeting, recruiting and recommendations. External delivery and accredited training are not claimed. |
| PostgreSQL persistence and financial audit | Implemented | PostgreSQL 16, Drizzle type-safe queries, additive migrations, row locks, transactional outbox and append-only history. |
| Advanced operational analytics | Implemented | Database-grouped metrics, first-confirmation trends, mature cohorts, confirmed-state economics, reconciliation/control findings and reproducible snapshots. |
| Delta Lake medallion architecture | Executable local reference | Real Delta/Parquet tables and manifests; production object storage, multi-writer credentials, retention and serving policies remain gates. |
| Flink, Spark and DataFusion | Not deployed | Their target production roles are documented, but this slice does not claim a streaming/batch/polyglot cluster. |
| Sedona and geospatial analytics | Partial local semantics only | Coarse geospatial grid marts exist. No Sedona deployment, precise-location serving or geospatial production validation is claimed. |
| Ray temporal ML and Ray Serve | Executable local reference | Real Ray tasks and an approval-gated Serve application exist. Production model approval, managed infrastructure and quality evidence do not. |
| TigerBeetle ledger of record | Adapter/outbox implemented; cutover open | PostgreSQL remains the sandbox ledger. Live replicas, opening-balance proof, hourly reconciliation and independent cutover approval are required. |
| Mojaloop | Post-MVP preflight/contract only | It is not a launch dependency. Approved partner FSP, scheme participation, secure connectivity, final callbacks and independent settlement reports remain required. |
| NestJS, Redis/BullMQ, Kubernetes and later polyglot services | Not target-architecture parity | The executable slice uses Hono/tRPC and PostgreSQL durable jobs. Renaming those controls would not satisfy strict target parity. |
| Student enrollment, uniqueness and activation-quality assurance | Executable sandbox controls; external outcomes open | Phase 15 adds independently reviewed enrollment/revalidation, keyed provider-subject collision cases, activation-quality payout holds and vendor-scoped reconciliation enforcement. Synthetic attestations and samples are not live institutional, identity-provider or vendor outcomes. |
| Live KYC, payments, notifications, tax and regulatory operations | External gates | Phase 14 adds fail-closed document/biometric adapters and identity lifecycle controls; Phase 15 requires exact provider/model biometric-evaluation coverage for live approval. Sandbox adapters, evaluation records and signed test payloads prove code behavior only. No live provider, independent PAD/injection/deepfake/demographic certification, external message, tax remittance or regulatory approval is claimed. |
| Rollout and national KPI attainment | Evidence controls implemented; outcomes open | Independent evidence workflows exist. Synthetic attestations and seeded fixtures are not real campus or national outcomes. |
| Production security, legal, SLO and device evidence | Open external/operational gates | Local controls and measurements do not replace penetration testing, DPIA/legal review, offsite/PITR recovery, staging, provider-capacity or Android/device-lab acceptance. |

## Robustness improvements in this phase

### Analytics correctness

- Daily confirmations use the first `confirmed` transition per deal, preventing repeated state transitions from inflating the trend.
- Seven-day cohorts use the same first-confirmation evidence and distinguish mature from immature creation cohorts.
- Campus/vendor commission and platform-revenue aggregates include only currently confirmed/payable/paid deals; pending, void and clawed-back records do not contribute confirmed economics.
- Sandbox withholding includes only payouts currently marked paid. Metric text explicitly distinguishes platform share from profit/cash and withholding from remittance evidence.
- Reconciliation findings honor the selected analytics window.

### Lakehouse privacy and integrity

- A strict field allowlist replaces a top-only blacklist. Unknown nested fields are rejected before persistence, and raw identifier values are not copied into quarantine.
- Event IDs and kobo amounts are bounded safe integers; entity IDs are non-zero. Event timestamps must carry a timezone and normalize to UTC.
- Pending activation economics are excluded from Gold. Repeated invalid deliveries do not duplicate quarantine evidence.
- DSAR documentation distinguishes logical Delta deletion from separately scheduled physical `VACUUM`/object-lifecycle erasure.

### Ray evaluation and serving

- Temporal evaluation adds ROC AUC where defined, average precision against prevalence, Brier score against a prevalence-only baseline, class counts and an explicit small-synthetic-holdout warning.
- Serving validates the complete model array contract, finite values, positive scales, bounded model version, exact feature set, numeric bounds and request-size/queue limits.
- Local evidence ingestion rejects incomplete manifests and always retains `model_approved: false`.

### TigerBeetle financial integrity

- Idempotent transfer comparison covers amount, accounts, ledger, code, pending ID, timeout, flags and user data.
- Official `exists` statuses use named constants. Linked-group partial evidence and conflicting deterministic transfers remain terminal/manual-reconciliation conditions.
- Replica addresses must be nonempty and cluster IDs must be valid decimal u128 values below the reserved maximum.
- Historical outbox backfills with unresolved entity-scoped opening-balance proof block reconciliation entirely; no zero baseline is inferred.

### Mojaloop execution boundary

- The transport sequence itself checks the complete live gate before calling party lookup, so a future caller cannot bypass readiness merely by supplying a transport.
- A domain-separated HMAC-SHA256 helper supports keyed hashing of low-entropy party references with a required secret of at least 32 characters.
- Transfer preparation still returns `settlementEligible: false`; settlement requires final committed evidence, separate scheme/report hashes and independent reconciliation.

### Fresh-database credential rotation

- Vendors created after the credential-table migration now bring their existing legacy secret into retiring version 1 before activating version 2. This preserves the 15-minute rotation overlap and fixes first-rotation behavior on a fresh database.

## Executed local runtime update

The pinned Delta/Ray acceptance has now run successfully against real local Delta tables and Ray tasks, and its manifests were recorded in PostgreSQL as sandbox-reference evidence. Execution fixed two pipeline defects: a quarantine loop had shadowed the byte-valued HMAC key with a tuple, and identity Silver rebuilding had incorrectly expected `event_id` inside quarantine records that intentionally contain only `event_hash` and `reason`. Silver now rebuilds from accepted Bronze history. Ordered Phase 2–15 database journeys and Phase 9–15 production-browser journeys also passed against a user-space PostgreSQL 16.15 installation; the latest evidence covers the 16-migration series (`0000`–`0015`) and 102 unit tests. Phase 15 adds relational refund-to-deal evidence and assurance controls without changing the lakehouse, model-approval, ledger-cutover or scheme-participation boundaries above. These results strengthen local-reference evidence only; they do not establish managed deployment or production readiness.

## Production cutover gates

1. Deploy and independently validate production object storage, streaming/batch/geospatial roles, scoped serving, scheduled retention and recovery.
2. Train on reviewed production data and complete model quality, calibration, fairness, privacy, drift, registry-approval, load, failover and autoscaling acceptance.
3. Configure TigerBeetle replicas and prove entity-scoped opening balances, submission idempotency, posted account reconciliation, zero unexplained outbox failures and an approved ledger-of-record cutover.
4. Obtain approved Mojaloop scheme/partner participation and prove mTLS, JWS, ILP protections, idempotent callbacks, liquidity, final outcomes and independent settlement-report reconciliation. Keep it outside the MVP launch critical path.
5. Complete live provider/KYC, external notification, security/legal, production operations, real-campus and device/network acceptance before making production or rollout claims.
