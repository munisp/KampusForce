# ADR 003: Require PostgreSQL 16 persistence

- Status: Accepted
- Date: 2026-10-27
- Supersedes: the MySQL persistence portion of ADR 001

## Context

The source specification requires PostgreSQL 16. The initial Phase 1 implementation deviated by using MySQL, and Phase 2 initially inherited that choice. The user explicitly corrected the architecture: **PostgreSQL, not MySQL**. Changing only the driver would leave incompatible schemas, insert-returning behavior, timestamp semantics and migrations.

The earlier MySQL sandbox may contain financial acceptance records. It must not be dropped, truncated or destructively converted.

## Decision

Use PostgreSQL 16 throughout the delivered Phase 2 runtime and verification path.

- Drizzle uses `pg-core` and the `node-postgres` adapter with `pg`.
- `POSTGRES_URL` is the sole application database connection setting.
- Table and field names remain stable; primary and foreign keys use matching PostgreSQL `serial`/`integer` types.
- Money remains integer kobo in `bigint` columns. Domain states use native PostgreSQL enums and timestamps use time zones.
- MySQL `$returningId()` calls become explicit PostgreSQL `RETURNING` clauses.
- Former automatic-update timestamp behavior is explicit in application updates.
- A reviewed PostgreSQL migration creates the full 26-table baseline, including constraints and indexes.
- Migration, seed and acceptance verification run against a separate PostgreSQL 16 sandbox database. No MySQL table is mutated.
- Historical data movement is outside this schema conversion and requires a separate backup, mapping, reconciliation and cutover plan.

## Consequences

### Benefits

- Persistence now matches the specified PostgreSQL 16 requirement.
- Native constraints, transactional row locks and `RETURNING` behavior are exercised by the actual acceptance journey.
- Rule publication, historical economics, override accounting, payout reversal and support workflows run on one verified database engine.
- The migration and seed are repeatable delivery artifacts rather than undocumented setup steps.

### Remaining limits

- Hono/tRPC remains instead of NestJS; this decision does not claim NestJS parity.
- Redis/BullMQ, Kubernetes and later distributed services remain unimplemented.
- PostgreSQL adoption alone does not prove production concurrency, backup/restore, high availability or load capacity.
- Ledger and audit append-only guarantees still require database-level enforcement.

## Verification

- TypeScript check and all 19 unit tests pass.
- The reviewed migration applies successfully to PostgreSQL 16, and the seed is idempotent across repeated runs.
- The complete Phase 2 acceptance journey passes on PostgreSQL, including historical-rule preservation, platform-funded override accounting, paid-refund reversal, support authorization, CSAT, SLA breach and privacy redaction.
- The production bundle contains the PostgreSQL driver, starts without external `node_modules`, and serves the app shell and API.
- The production dependency audit reports zero known vulnerabilities at assessment time.

## Invariants preserved

- Never persist raw NIN/BVN; customer KYC remains in vendor-regulated flows.
- Never recalculate historical deal economics after rule publication.
- Never fund lead overrides from the activating rep or vendor escrow.
- Never front vendor commission or bypass payout eligibility and negative-balance netting.
- Never represent sandbox payments, KYC, tax records or regulatory status as live outcomes.
