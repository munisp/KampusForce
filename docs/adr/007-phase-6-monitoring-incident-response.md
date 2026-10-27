# ADR 007: Phase 6 record-derived monitoring and incident response

- Status: Accepted
- Date: 2026-10-28
- Builds on: ADR 004, ADR 005 and ADR 006

## Context

Phase 5 exposed health signals and recovery evidence, but operators still had to inspect jobs, payouts, reconciliation, event quarantine and support queues independently. Repeated checks also needed a durable incident record rather than another copy of the same notification.

The available evidence is local PostgreSQL state. No external metrics platform, paging provider, uptime service or production incident commander is connected. Phase 6 therefore implements an honest record-derived incident desk rather than presenting synthetic alerts as production observability.

## Decision

### Source-linked signals and severity

Collect signals from five existing sources: failed durable job runs, failed or held payouts, reconciliation runs in variance, quarantined vendor events and unresolved support tickets with breached SLAs. Financial, worker and reconciliation signals are critical; quarantine and support SLA signals are warning.

Use stable source-record keys such as `job_failed:{id}` and `payout_attention:{id}`. Do not copy raw job errors or customer payloads into incident details. New source records receive new keys and therefore new incidents.

### Atomic detection and durable scheduling

Insert an incident with its unique dedupe key before appending detection history or notifying Operations. Concurrent sweeps that lose the unique-key race refresh the existing incident without adding another detection event or notification.

Open and acknowledged incidents are refreshed on later sweeps. Resolved incidents remain resolved and retain their original response history. Scheduled monitoring uses the existing durable job table and a unique five-minute slot claim; manual Operations sweeps use the same detection service.

### Controlled response lifecycle

Operations and Admin can acknowledge an open incident. They can resolve an open or acknowledged incident only with a trimmed resolution note. Both mutations lock the incident row, reject invalid repeated transitions, append an incident event and append an audit record. A database trigger prevents updates and deletes on incident-event history.

The Operations desk exposes source, severity, state, last-seen time, source-linked case facts and response history. Notifications are recipient-scoped in-app records only.

## Verification

- Incident-policy unit tests cover severity mapping and five-minute slot boundaries.
- The Phase 6 database journey creates deliberate sandbox records for all five signal sources and runs five concurrent sweeps. Exactly five incidents and five detection events result, with five Operations notifications.
- A repeated sweep creates no duplicates. Acknowledgement and resolution append the expected history and audit records; duplicate transitions are rejected. Direct history mutation is rejected by the database trigger.
- A later sweep leaves resolved incidents resolved. Two claims for the same scheduled slot produce one succeeded run and one duplicate skip.
- CI runs the Phase 6 journey after the Phase 2–5 regressions and before the isolated recovery drill.

## Consequences and remaining boundaries

- Detection is only as current as the five-minute worker or a manual sweep; it is not real-time telemetry.
- Incident state reflects local records, not infrastructure metrics, logs, traces, synthetic checks or uptime evidence.
- In-app notifications are not SMS, email, chat or paging delivery. Production escalation, on-call rotation and external status communication remain operational work.
- Resolving an incident does not mutate or repair its source financial, job, event or support record. Operators must perform the appropriate source workflow separately.
- Live providers, authenticated bank evidence, offsite recovery, external observability and NestJS/Redis parity remain open gates.
