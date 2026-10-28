# ADR 013: Phase 12 case management, CRM and sales growth

## Status

Accepted for the local sandbox vertical slice on 2026-10-28. This is not external-channel delivery, live vendor-service connectivity, accredited training, production certification or a financial-outcome claim.

## Context

Phase 11 had strong support and settlement controls but cases still behaved primarily as tickets, and sales work lacked a durable CRM, training, campaigns, opportunity targeting and consent-led student recommendation. Directly extending financial workflows would have mixed commercial collaboration with commission authority and exposed unnecessary customer identifiers.

## Decision

### Separate collaboration from financial authority

- Add case collaboration, opportunities, training, campaigns, vendor services and growth records through additive migration `0010` and Drizzle services under `api/services/`.
- Keep commission creation exclusively in vendor-verified activation workflows. Case, CRM, campaign, training, recommendation and integration services cannot create or edit deals or ledger entries.
- Require privacy-preserving attribution and a confirmed/payable/paid deal before an opportunity can become won. Return no customer phone hash in case or CRM query payloads.

### Make work durable and explainable

- Use optimistic case versions, first-response/resolution timestamps, public/internal messages, snooze/wake, reopen history, links, watchers, saved views and deterministic next-action guidance.
- Use representative-owned opportunities, activities, tasks, stall reasons, contextual drafts, approval/share attestations, fit explanations, segments and weighted open-only forecasts.
- Persist internal training attempts and completion without returning correct-answer indexes or presenting completion as accreditation.
- Derive leaderboard and targeting explanations from verified outcomes, quality and training. Scores and ranks never become commission entitlements.

### Fail closed at external boundaries

- Campaign creators cannot review their own campaigns. Delivery is in-app only and conversion evidence is claimed atomically from eligible records.
- Vendor-service configuration accepts no credentials. Sandbox tests and local-count synchronization do not issue live requests; live configuration continues through existing fail-closed authorization.
- Student referrals require confirmed consent and become ordinary recruitment invitations under a transaction-scoped row lock. No external message is sent.

## Verification

- Nine Phase 12 policy tests bring the unit suite to 66 tests. `scripts/verify-phase12.ts` exercises case ownership collisions, collaboration visibility, clocks/reopen, CRM tasks/drafts, verified-won gating, training, campaign four-eyes review, integration boundaries, growth and recruiting.
- The database journey deep-compares deals and ledger entries before/after and reports no financial change, no live provider request and `productionReady: false`.
- Phase 2–11 ordered regressions and Phase 9–12 production-browser suites pass. Five Phase 12 mobile views have no document overflow at 375px.
- Standalone bundled-server startup and isolated PostgreSQL restore with all eleven migrations pass.

## Consequences and remaining gates

- Case management and CRM now support repeatable daily operations rather than isolated records, while preserving financial, privacy and evidence boundaries.
- Real external messaging, live vendor adapters, attachment storage, broader concurrency/property tests, production analytics and real-world commercial outcomes remain unfinished or external.
- Hono/tRPC and PostgreSQL workers remain the runtime; NestJS and Redis/BullMQ target-architecture parity is not claimed.
