# KampusForce sandbox incident-response runbook

## Scope

This runbook covers record-derived incidents in the local Phase 7 sandbox. It is not a production on-call, external-alerting, uptime, legal or regulatory-response certification. Incident detection never changes ledger, payout, event, job, support, DSAR or breach source records.

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

## Roles

- **Operations / Admin:** run a manual sweep, acknowledge open incidents, resolve open or acknowledged incidents and inspect response history. They may own breach-notification decisions and perform privacy workflows.
- **Finance:** may run monitoring sweeps and inspect incidents; financial recovery remains governed by the settlement workflow.
- **Other roles:** retain their existing scoped workspaces and do not receive Operations incident or privacy controls. A representative cannot be assigned as breach-notification owner.

## Response procedure

1. Open **Operations → Incidents** and select **Run monitoring sweep**. The scheduled worker otherwise claims one five-minute slot.
2. Sort attention by critical state and last-seen time. Review the incident’s source, entity reference and case facts. Treat the incident as an index into the source workflow, not proof that the underlying problem is fixed.
3. Select **Acknowledge** to record ownership of an open incident. This is an Operations response transition, not a resolution.
4. Investigate and correct the source through its controlled workflow. Never edit ledger, audit, incident, DSAR-history or breach-history records directly. For privacy procedures, follow the [privacy-operations runbook](privacy-response.md).
5. Enter a 10–2000-character note describing the evidence and outcome, then select **Resolve incident**. A later sweep will not reopen the same resolved source record.
6. If the same source fails again through a new database record, monitoring creates a separate incident. If the underlying condition was not actually corrected, reopen the source workflow and create a new operational record rather than rewriting history.

## Data and audit rules

- Incident dedupe keys contain source names and internal record IDs, not customer phone numbers or secret values.
- Raw job error output, customer payloads, customer hashes and breach summaries are not copied into incident details.
- Detection, acknowledgement and resolution events are append-only. Lifecycle changes also append audit records.
- Operations notifications are in-app only. No SMS, email, chat, paging, NDPC or data-subject delivery is implied.

## Verification and escalation boundaries

Run `npx tsx scripts/verify-phase6.ts` only against a sandbox database to prove the original five sources, concurrent deduplication, notification, response, immutability and scheduling behavior. Run `npx tsx scripts/verify-phase7.ts` to add overdue DSAR/breach signals and prove their severity, deduplication and source-state suppression.

Production still needs external log/metric/trace collection, synthetic checks, alert delivery, on-call ownership, escalation policy, privileged-access review, live-provider evidence, offsite recovery, legal/privacy procedures and tested business-continuity procedures.
