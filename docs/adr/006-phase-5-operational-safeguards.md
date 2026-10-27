# ADR 006: Phase 5 operational safeguards and recovery evidence

- Status: Accepted
- Date: 2026-10-28
- Builds on: ADR 004 and ADR 005

## Context

Phase 4 proved the sandbox settlement lifecycle, but sensitive public procedures had no route-level throttling, Campus Lead designation had no periodic demotion path, health signals were absent, and backup/restore remained a documentation gate. The platform needs controls that fail safely without weakening commercial invariants or presenting sandbox evidence as production certification.

The current runtime remains Hono/tRPC with PostgreSQL 16. Redis/BullMQ, NestJS, live providers and real-campus evidence are unavailable and are not replaced by labels in this phase.

## Decision

### Atomic, privacy-conscious throttling

Use fixed windows and an atomic PostgreSQL insert/upsert counter for OTP request, OTP verification, demo login, recruitment inspection and vendor-event routes. The counter key is a SHA-256 hash of policy, subject and window; raw IPs, vendor keys and phone numbers are not stored in rate-limit keys. Requests above the configured limit receive HTTP 429 and `Retry-After`. Expired buckets are removed by a durable job, while live buckets remain.

This is application-level fixed-window control, not an edge/WAF or distributed rate-limit claim. Production deployment must review proxy/IP trust and add appropriate edge abuse controls.

### Health signals

Expose lightweight `/api/health/live` and database-backed `/api/health/ready`. Readiness performs real user/job queries and returns 503 without connection details if the database check fails. Both routes identify sandbox mode.

### Lead eligibility and demotion

Share one campus-ranking implementation between Operations and scheduled jobs. Review current Campus Leads every hour through a unique durable slot and on demand through an Ops/Admin mutation. Do not automatically promote replacements.

Demote only active leads that are no longer active, signed, top-decile contractors. Lock the rep row, restore `leadPreviousTier` where available (otherwise starter), revoke active team assignments and open invitations, and append audit and notification records. Preserve all historical overrides and ledger rows. Tier change plus assignment revocation prevents future management and override accrual without rewriting financial history.

### Non-destructive recovery drill

Use PostgreSQL 16 `pg_dump` custom format with manifest validation. Pass credentials through PostgreSQL environment variables rather than command-line connection strings or logs. Restore requires `KF_RECOVERY_DRILL=sandbox`, creates a new `kf_restore_*` database and never restores over or drops the source. Compare stable table, migration and trigger counts between source and restored databases, then re-read source counts to detect source mutation. Keep the isolated restore for inspection and ignore dump files in Git.

## Verification

- Twenty-eight unit tests pass, including fixed-window/hash and demotion-policy cases.
- Phase 5 acceptance proves exact concurrent counter sequencing, 429/`Retry-After`, hashed persistence, selective cleanup and health responses.
- Acceptance also proves eligible-lead retention, prior-tier restoration, assignment/invitation revocation, notification/audit creation, historical override/ledger preservation, disabled future accrual and hourly slot deduplication.
- Backup manifest validation and isolated restore pass with matching data/schema counts and unchanged source counts.
- TypeScript, ESLint, production build, repeated seed, Phase 2–5 regressions and production dependency audit pass. CI runs all four acceptance journeys and the recovery drill.
- Desktop and 375px Operations recalculation interactions pass with no document overflow, console errors or HTTP errors. The standalone production bundle serves the app shell, PWA files and health/readiness routes without external `node_modules`.

## Consequences and remaining boundaries

- The new throttling is local application infrastructure, not production edge protection or a penetration-test result.
- Health routes are signals, not a monitoring/alerting service or uptime evidence.
- Lead recalculation preserves accounting history, but real contractor review, appeals and privileged-access policy remain operational work.
- The recovery drill is local sandbox evidence, not offsite storage, point-in-time recovery, high availability or incident-response certification.
- Live KYC/payment, authenticated bank evidence, external notifications, real rollout outcomes and NestJS/Redis parity remain open gates.
