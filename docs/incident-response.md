# KampusForce sandbox incident-response runbook

## Scope

This runbook covers record-derived incidents in the local Phase 6 sandbox. It is not a production on-call, external-alerting, uptime or regulatory-response certification. Incident detection never changes ledger, payout, event, job or support source records.

## Signals and priority

| Source | Detection condition | Severity | First response |
|---|---|---|---|
| `job` | Durable job run is failed | Critical | Inspect the job record and sanitized run metadata; rerun only through the relevant controlled workflow. |
| `payout` | Payout is failed or held | Critical | Inspect attempts, entitlement state and refund/hold cause. Use Finance recovery only after eligibility checks. |
| `reconciliation` | Reconciliation run is in variance | Critical | Compare ledger credits, sandbox attempts and the supplied bank figure; preserve every run and investigate before another settlement. |
| `event_quarantine` | Vendor event is quarantined | Warning | Inspect signature, timestamp, replay or mapping cause without exposing customer payloads. Do not force activation. |
| `support_sla` | Unresolved ticket has `slaBreachedAt` | Warning | Open the owned support queue, review the timeline and resolve or escalate through the existing support controls. |

## Roles

- **Operations / Admin:** run a manual sweep, acknowledge open incidents, resolve open or acknowledged incidents and inspect response history.
- **Finance:** may run monitoring sweeps and inspect incidents; financial recovery remains governed by the settlement workflow.
- **Other roles:** retain their existing scoped workspaces and do not receive Operations incident controls.

## Response procedure

1. Open **Operations → Incidents** and select **Run monitoring sweep**. The scheduled worker otherwise claims one five-minute slot.
2. Sort attention by critical state and last-seen time. Review the incident’s source, entity reference and case facts. Treat the incident as an index into the source workflow, not proof that the underlying problem is fixed.
3. Select **Acknowledge** to record ownership of an open incident. This is an Operations response transition, not a resolution.
4. Investigate and correct the source through its controlled workflow. Never edit ledger, audit, incident history or financial records directly.
5. Enter a 10–2000-character note describing the evidence and outcome, then select **Resolve incident**. A later sweep will not reopen the same resolved source record.
6. If the same source fails again through a new database record, monitoring creates a separate incident. If the underlying condition was not actually corrected, reopen the source workflow and create a new operational record rather than rewriting history.

## Data and audit rules

- Incident dedupe keys contain source names and internal record IDs, not customer phone numbers or secret values.
- Raw job error output and customer payloads are not copied into incident details.
- Detection, acknowledgement and resolution events are append-only. Lifecycle changes also append audit records.
- Operations notifications are in-app only. No SMS, email, chat or paging delivery is implied.

## Verification and escalation boundaries

Run `npx tsx scripts/verify-phase6.ts` only against a sandbox database. It deliberately creates failed, held, variance, quarantine and SLA-breach fixtures and proves concurrent deduplication, notification, response, immutability and scheduling behavior.

Production still needs external log/metric/trace collection, synthetic checks, alert delivery, on-call ownership, escalation policy, privileged-access review, live-provider evidence, offsite recovery and tested business-continuity procedures.
