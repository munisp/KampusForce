# ADR 008: Phase 7 privacy operations and breach assessment

- Status: Accepted
- Date: 2026-10-28
- Builds on: ADR 003, ADR 005, ADR 006 and ADR 007

## Context

The platform already stores salted customer-phone hashes for attribution and structured support records. Operations needed a controlled way to receive privacy requests, verify requester identity before releasing evidence, and preserve an accountable breach-assessment trail. These workflows must not weaken financial retention, expose customer or representative secrets, or imply that sandbox software performs legal review or regulatory notification.

The implementation uses the existing PostgreSQL, row-lock, audit and incident infrastructure. It does not add an external identity-proofing service, data-governance platform, NDPC integration or notification provider.

## Decision

### Hash-scoped DSAR records and a 30-day clock

Persist access, rectification, erasure and objection requests against a unique request reference and the existing salted SHA-256 customer-phone hash. Normalize and hash the supplied phone during creation; do not persist the raw phone on the request or its history. Derive the response deadline as exactly 30 days after receipt.

Use the lifecycle `received → identity_verified → in_review → fulfilled`, with rejection available from open states. Lock the request for every lifecycle transition, reject invalid or competing transitions, and append both request history and audit records. Evidence export is allowed only after identity verification and remains available for fulfilled requests. Exporting records an audit event but does not itself fulfil the request.

Fulfilment records an operational outcome. It does not automatically correct or erase source records, delete financial history or certify statutory compliance.

### Explicitly scoped evidence exports

Select export columns individually for attribution metadata, activation/deal status metadata, support-ticket status metadata and consent metadata. Match only the request's salted customer hash.

Exclude raw phone values, NIN/BVN and identity-like values, bank details, access tokens, support free text, vendor event payloads, token signatures, commissions, payouts and unrelated representative or financial records. Export history stores section counts and timestamps rather than duplicating the evidence package. The browser generates the JSON download on demand; no evidence file is persisted in the repository or database.

### Breach assessment with accountable ownership

Persist a unique assessment reference, title, operational summary, detection time and a triage deadline exactly 72 hours later. Use `reported → assessing → decision_recorded → closed` with append-only history and audit records.

A decision requires low/medium/high risk, `required` or `not_required` notification decision, rationale and an Operations/Admin owner. Validate the owner's role from durable user records. Decision and closure responses explicitly report `externalNotificationSent: false`; the system records ownership but never contacts the NDPC or data subjects.

### Shared overdue monitoring

Add unresolved overdue DSARs as warning incidents and overdue reported/assessing breaches as critical incidents. Use stable `dsar_sla:{id}` and `breach_triage:{id}` dedupe keys. Incident details contain references and deadlines, not customer hashes or breach summaries. Fulfilled/rejected DSARs and decision-recorded/closed breaches stop generating triage-overdue signals.

## Verification

- Policy unit tests prove exact 30-day and 72-hour windows, export gating and unresolved-overdue behavior.
- The Phase 7 database journey proves hash-only persistence, identity-gated export, concurrent duplicate-transition rejection, owner-role enforcement, complete lifecycle histories, append-only database triggers and incident deduplication.
- Export assertions cover all four intended sections and reject sensitive values and forbidden keys. Byte-equivalent snapshots prove deals, ledger entries, payouts, attempts, reconciliations, escrow wallets and Campus Lead overrides remain unchanged by privacy operations.
- Browser journeys cover DSAR registration, verification, review, JSON download and fulfilment, plus breach intake, triage, Operations-owner decision and closure. Desktop and 375px checks show no document-level overflow or browser errors.
- CI runs Phase 7 after Phase 2–6 and before the isolated recovery drill.

## Consequences and remaining boundaries

- The DSAR desk coordinates records and evidence; it is not a complete legal compliance or automated data-deletion system. Actual rectification/erasure decisions require reviewed source-specific procedures and applicable retention exceptions.
- Identity verification is an Operations-attested sandbox transition, not live identity proofing.
- A breach decision is not legal advice, NDPC notification, data-subject communication or evidence of external delivery. Those actions remain with the accountable human owner.
- The export is record-derived and deliberately limited. It is not a statutory completeness certification or a universal data inventory.
- Production still requires privacy/security/legal review, DPIA/DPO ownership, retention policy, privileged-access review, external response communications and tested incident escalation.
