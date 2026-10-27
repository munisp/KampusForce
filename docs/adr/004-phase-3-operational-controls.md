# ADR 004: Phase 3 operational controls on PostgreSQL

- Status: Accepted
- Date: 2026-10-28
- Builds on: ADR 003

## Context

Phase 2 established campus recruiting, team overrides and support workflows, but invitations could not be accepted or revoked securely, fifteen-campus health was not visible, scheduled work was query-triggered, financial history lacked database-level immutability, and payout batches could race.

The target documents also describe NestJS and Redis/BullMQ. Those remain separate architecture requirements; a PostgreSQL-backed operational improvement must not be presented as parity with that target.

## Decision

Implement the operational controls without changing the existing Hono/tRPC application boundary.

- Recruiting invitations carry a 32-byte random one-time token. Only its SHA-256 hash is persisted. Public inspection reveals no invited phone; acceptance requires an authenticated session for the exact invited phone and explicit contractor acceptance.
- Acceptance and Operations activation are different audited states. Activation uses an explicitly labelled sandbox identity adapter, creates the campus-team assignment, and never stores raw NIN/BVN.
- Lead-owned or Operations revocation prevents subsequent acceptance. Expiry is a durable worker transition.
- Fifteen campus records are seed fixtures, not rollout evidence. Telemetry derives active/pending reps, confirmed activations, confirmed rep commission, support load and SLA breaches from current records.
- Durable `job_runs` claim a unique `(job_key, slot_key)` before work starts. Minute-slot uniqueness suppresses duplicate scheduled work across app instances. Jobs cover confirmation, rule-draft expiry, SLA breach synchronization and recruiting expiry.
- In-app notifications are recipient-scoped and read-tracked. They do not claim SMS or email delivery.
- PostgreSQL triggers reject updates/deletes on ledger entries, audit logs, deal state history, support ticket events and consent logs. Corrections remain new records.
- Confirmation, refund and publication lock their target rows. Payout locks each recipient rep, re-reads eligible deals/overrides and outstanding balances inside the transaction, then posts state changes and ledger entries atomically.

## Verification

The PostgreSQL 16 acceptance journey verifies:

- wrong-phone acceptance rejection, hashed-token storage, accepted → activated lifecycle, team assignment, revocation and expiry;
- exactly fifteen campus fixtures with record-derived telemetry;
- duplicate job-slot suppression;
- ledger update and audit delete rejection;
- three competing confirmation sweeps producing one set of five deal/override postings;
- five competing payout batches producing exactly one payout for the new rep;
- two competing publications producing one winner and one active rule;
- activation and payout in-app notifications.

The Phase 2 financial/support regression, all 19 unit tests, TypeScript check and production build also pass. CI runs both journeys against an ephemeral PostgreSQL 16 service.

Production-browser verification covers invitation creation, phone-private public inspection, OTP sign-in, consent-gated acceptance, Operations activation, team assignment and activation notifications. Recruiting acceptance, campus team, campus rollout, notifications and the implementation score were checked at 375px with no page overflow; mobile header overlap was corrected and notification dismissal verified. The standalone production bundle also passed root, manifest, service-worker and API smoke checks without an external `node_modules` directory.

## Consequences and remaining boundaries

- Operational correctness is improved without claiming NestJS or Redis/BullMQ parity.
- The in-process minute scheduler is suitable for this slice, not a distributed worker platform. Production still needs a 09:00 WAT payout schedule, retries/backoff, alerting and live-provider reconciliation.
- Append-only triggers protect the named history tables, not every mutable operational table. Backup/restore, retention policy, privileged-role review and formal reconciliation remain production gates.
- Campus fixtures and sandbox identity/payout notifications provide no live campus, KYC, payment, SMS, email or regulatory outcome.
