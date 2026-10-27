# ADR 001: Use a modular single-runtime Phase 1 slice

- Status: Accepted for this implementation slice
- Date: 2026-10-27

## Context

The business/technical specification names Node 20, NestJS, PostgreSQL 16, Redis/BullMQ and object storage for the MVP, then describes later Go/Rust/Python services, Kubernetes, TigerBeetle, Kafka, Temporal, Dapr and lakehouse infrastructure.

The empty repository needed a runnable, testable product spine first. The highest-risk requirements are commercial correctness and evidence: first-touch attribution, verified-event ingestion, commission math, escrow sufficiency, state transitions, reversals, payout eligibility and operator audit. Introducing several infrastructure stacks before proving those workflows would increase operational surface without improving the core answer.

## Decision

Implement the Phase 1 vertical slice as a modular TypeScript application:

- React + Vite for role workspaces and the installable shell.
- Hono + tRPC for typed application APIs and signed REST webhooks.
- Drizzle ORM + MySQL for persistent records and transactions.
- Database-backed JWT session hashes for revocable sandbox sessions.
- Pure money/security functions with unit tests and one shared event-to-settlement path.

This is a deliberate reference-runtime deviation, not a claim of exact NestJS/PostgreSQL compliance.

## Consequences

### Benefits

- One reproducible runtime and schema for rep, vendor and operations views.
- End-to-end type inference across procedures and database records.
- Fewer moving parts for workflow validation and handoff.
- Clear service boundaries that can later be extracted.

### Costs and limits

- NestJS guards, modules, decorators and PostgreSQL-specific behavior are not implemented.
- Redis queues, BullMQ retries, object storage and live provider workers are absent.
- MySQL transaction isolation and concurrency behavior need production load testing.
- The current ledger is application-enforced; database-level append-only controls remain required.
- The scale-service and analytics architecture is outside this slice.

## Migration path

1. Preserve the current event, deal, ledger and payout contracts as acceptance fixtures.
2. Introduce PostgreSQL migrations and equivalent repository/query tests behind the service interfaces.
3. Move webhook ingestion and scheduled confirmation/payout work to durable queues with idempotency keys.
4. Add live KYC/payment adapters with callback reconciliation and explicit sandbox/production configuration.
5. Add database privileges or triggers preventing ledger updates/deletes and immutable audit storage.
6. Reassess NestJS extraction only where module boundaries and team ownership benefit from it.
7. Defer Kafka, Kubernetes, TigerBeetle, Temporal, Dapr and lakehouse decisions until measured scale or consistency requirements justify them.

## Non-negotiable invariants during migration

- No raw NIN/BVN persistence.
- No customer KYC inside KampusForce.
- No commission on unqualified signups.
- No payout without pre-flight eligibility and sufficient funded economics.
- 80/20 allocation remains reconciled in integer kobo.
- First touch is preserved; duplicate vendor events do not create duplicate deals.
- Paid-deal reversals can create negative rep balances that net future payouts.
- Sandbox behavior must never be represented as live provider success.
