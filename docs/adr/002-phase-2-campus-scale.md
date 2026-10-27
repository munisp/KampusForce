# ADR 002: Extend the modular runtime for Phase 2 campus scale

- Status: Accepted for this implementation slice
- Date: 2026-10-27

## Context

Phase 2 adds vendor-authored commercial rules, campus recruiting and team overrides, and a multi-party support operation. These capabilities must not weaken the Phase 1 evidence chain or create a second source of commission truth.

The central risks are historical-rule mutation, funding a lead override from the wrong party, cross-vendor/support data exposure, and presenting sandbox KPI fixtures as operating evidence.

## Decision

Retain the modular Hono/tRPC/Drizzle runtime, use PostgreSQL 16 as required by ADR 003, and add three explicit policy domains.

### 1. Versioned vendor rules

- A dry run persists the proposed terms, sample, exact kobo split, creator and 30-minute expiry.
- Publication requires the persisted draft and typed `PUBLISH` confirmation.
- One transaction locks the draft and product rules, supersedes currently active versions, inserts the next version and writes an audit record.
- Only unsuperseded rules appear in the rep catalog or trigger new deals.
- Every new deal stores `commissionRuleId`. Existing deal economics remain stored and are never recalculated by later publication.

### 2. Platform-funded Campus Lead overrides

- Campus Leads are contractors, not employees. Ops designation requires campus top-decile eligibility and a signed contractor agreement.
- Eligibility ranks active reps within each campus by confirmed commission, activation count and deterministic rep ID tie-breaking.
- An active team assignment causes confirmation to accrue an override equal to 5% of the team rep’s confirmed gross commission.
- The override posts `platform_revenue` debit and `lead_override_payable` credit. It does not debit the activating rep or increase vendor escrow liability.
- Direct and override entitlements share payout pre-flight checks and negative-balance netting while retaining separate ledger accounts.
- Refund reverses the override; a paid reversal can create a negative lead-override balance for future netting.

### 3. Scoped support state machine

- States are `rep_triage`, `campus_lead_queue`, `vendor_queue`, `ops_queue`, `resolved` and `closed`.
- Reps create cases only for their own deals or customers matched to their active first-touch attribution.
- Campus Leads triage active-team cases. Vendors resolve or escalate only their own queued cases. Ops handles platform escalation.
- Vendor SLA changes apply only to new tickets. Due breaches create timeline and audit records.
- Approved macros are vendor-scoped. Only the owning rep submits one-time CSAT after resolution; closed-ticket CSAT updates rep and vendor quality scores.
- Structured customer identifiers remain salted hashes. Free-text UI explicitly prohibits sensitive customer credentials and identifiers.

## Consequences

### Benefits

- One acceptance path proves rule publication, activation, confirmation, override payout and reversal against the same records.
- Historical deal evidence remains stable while vendors gain self-service commercial control.
- Lead incentives have explicit accounting rather than an off-ledger deduction from rep earnings.
- Support ownership and state transitions are enforceable server-side, not merely hidden in the UI.
- Pure rule, override and support-policy functions remain isolated for fast unit tests.

### Costs and limits

- PostgreSQL 16 persistence is implemented and acceptance-tested. The runtime still deviates from the specified NestJS reference and does not add Redis/BullMQ, Kubernetes or later distributed services.
- SLA synchronization is query-triggered in this slice; a durable worker and notification delivery remain necessary.
- Recruiting stops at invitation and assignment controls; invite acceptance, identity verification and revocation journeys remain incomplete.
- Campus-scoped records do not constitute a fifteen-campus rollout or proof of roadmap KPI attainment.
- Application-enforced ledger integrity still needs database append-only controls, concurrency/load evidence and formal reconciliation.

## Production migration requirements

1. Preserve the rule-version, override and support acceptance fixtures when changing infrastructure.
2. Move confirmation, payout, draft expiry, SLA and notification work to durable idempotent jobs.
3. Add live provider callbacks and reconciliation without weakening sandbox/production configuration boundaries.
4. Add database-level append-only ledger/audit enforcement and test concurrent publication, confirmation, refund and payout behavior.
5. Instrument campus cohort and KPI facts from real activity before claiming 55% activation, 14.4 monthly activations, 97% paid within 48 hours, <4% disputes or 136k activated customers.

## Non-negotiable invariants

- Never persist raw NIN/BVN; customer KYC remains in vendor-regulated flows.
- Never recalculate a historical deal because a vendor publishes a new rule.
- Never fund a lead override from the activating rep’s share or vendor escrow.
- Never allow cross-vendor support resolution or non-owner CSAT.
- Never represent sandbox payments, KYC, seeded rankings or planning KPIs as live outcomes.
