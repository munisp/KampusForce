# KampusForce sandbox incident-response runbook

## Scope

This runbook covers record-derived incidents and ingestion-reliability operations in the local Phase 9 sandbox. It is not a production on-call, external-alerting, uptime, legal or regulatory-response certification. Incident detection never changes ledger, payout, event, job, support, DSAR, breach or fraud source records.

## Signals and priority

| Source | Detection condition | Severity | First response |
|---|---|---|---|
| `job` | Durable job run is failed | Critical | Inspect the job record and sanitized run metadata; rerun only through the relevant controlled workflow. |
| `payout` | Payout is failed or held | Critical | Inspect attempts, entitlement state and refund/hold cause. Use Finance recovery only after eligibility checks. |
| `reconciliation` | Reconciliation run is in variance | Critical | Compare ledger credits, sandbox attempts and the supplied bank figure; preserve every run and investigate before another settlement. |
| `event_quarantine` | Vendor event is quarantined | Warning | Inspect signature, timestamp, replay or mapping cause without exposing customer payloads. Do not force activation. |
| `support_sla` | Unresolved ticket has `slaBreachedAt` | Warning | Open the owned support queue, review the timeline and resolve or escalate through the existing support controls. |
| `dsar_sla` | Open DSAR is beyond its 30-day response deadline | Warning | Open **Operations → Privacy**, review identity/evidence status and complete the controlled request workflow. Do not treat incident resolution as DSAR fulfilment. |
| `breach_triage` | Reported/assessing breach is beyond its 72-hour triage deadline | Critical | Open the breach assessment, record risk, notification decision, rationale and Operations/Admin ownership. External notification remains a separate human action. |
| `fraud_review` | Open or appealed fraud case is beyond its 24-hour review objective | Critical | Open **Operations → Fraud**, inspect cap evidence and prior decisions, then release or uphold through the controlled workflow. Incident resolution does not release a payout hold. |

## Roles

- **Operations / Admin:** run a manual sweep, acknowledge open incidents, resolve open or acknowledged incidents and inspect response history. They may own breach-notification decisions and perform privacy and fraud/conduct workflows.
- **Finance:** may run monitoring sweeps and inspect incidents; financial recovery remains governed by the settlement workflow.
- **Other roles:** retain their existing scoped workspaces and do not receive Operations incident or privacy controls. A representative cannot be assigned as breach-notification owner.

## Response procedure

1. Open **Operations → Incidents** and select **Run monitoring sweep**. The scheduled worker otherwise claims one five-minute slot.
2. Sort attention by critical state and last-seen time. Review the incident’s source, entity reference and case facts. Treat the incident as an index into the source workflow, not proof that the underlying problem is fixed.
3. Select **Acknowledge** to record ownership of an open incident. This is an Operations response transition, not a resolution.
4. Investigate and correct the source through its controlled workflow. Never edit ledger, audit, incident, DSAR-history, breach-history or fraud-history records directly. For privacy procedures, follow the [privacy-operations runbook](privacy-response.md); for fraud holds and conduct decisions, follow the [fraud and conduct runbook](fraud-conduct-response.md).
5. Enter a 10–2000-character note describing the evidence and outcome, then select **Resolve incident**. A later sweep will not reopen the same resolved source record.
6. If the same source fails again through a new database record, monitoring creates a separate incident. If the underlying condition was not actually corrected, reopen the source workflow and create a new operational record rather than rewriting history.

## Ingestion reliability procedure

1. Open the affected vendor’s **Webhook reliability** panel. Scheduled retries are transient recovery work; **Needs review** counts permanent or exhausted dead letters and requires investigation.
2. Inspect sanitized error codes and event/retry references. Never paste customer payloads, credential values or secrets into tickets, incident notes or audit metadata.
3. Correct the vendor mapping, credential or transient dependency through its controlled workflow. Do not force a dead letter into an activation or bypass signature, timestamp, dedupe, activation-cap or quarantine checks.
4. For credential rotation, confirm the 15-minute overlap, rotate through the vendor control, copy the one-time secret directly into the approved signer and dismiss the disclosure. Update the signer before the previous credential expires. Overview and audit records will not recover the secret.
5. Payload purging after 30 days is intentional. Event IDs, dedupe keys, status and financial links remain; a later replay must still return duplicate rather than create another deal.
6. Local retry/dead-letter counts do not page Operations. Production still needs an owned external dead-letter alert and escalation policy.

## Data and audit rules

- Incident dedupe keys contain source names and internal record IDs, not customer phone numbers or secret values.
- Raw job error output, customer payloads, customer hashes and breach summaries are not copied into incident details.
- Detection, acknowledgement and resolution events are append-only. Lifecycle changes also append audit records.
- Operations notifications are in-app only. No SMS, email, chat, paging, NDPC or data-subject delivery is implied.

## Verification and escalation boundaries

Run `npx tsx scripts/verify-phase6.ts` only against a sandbox database to prove the original five sources, concurrent deduplication, notification, response, immutability and scheduling behavior. Run `npx tsx scripts/verify-phase7.ts` to add overdue DSAR/breach signals and prove their severity, deduplication and source-state suppression. Run `npx tsx scripts/verify-phase8.ts` to prove critical overdue fraud review, cap enforcement, payout holds, appeal behavior and financial preservation. Run `npx tsx scripts/verify-phase9.ts` to prove credential overlap/expiry, retry recovery/dead letters, concurrent resolution, replay-safe retention and financial preservation.

Production still needs external log/metric/trace collection, synthetic checks, alert delivery, on-call ownership, escalation policy, privileged-access review, live-provider evidence, offsite recovery, legal/privacy procedures and tested business-continuity procedures.
