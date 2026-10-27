# ADR 009: Phase 8 fraud controls and conduct review

- Status: Accepted
- Date: 2026-10-28
- Builds on: ADR 003, ADR 005, ADR 006, ADR 007 and ADR 008

## Context

Verified activation events create commission obligations, so repeated submissions from one representative need a deterministic control before deal creation. Operations also needs a review path that can stop payout progress without rewriting financial history, and representatives need a visible appeal path. The control must preserve first-touch attribution, historical commission rules, escrow, settlement, privacy and append-only evidence invariants.

This phase deliberately implements a narrow activation-velocity rule and human conduct workflow. It does not claim machine-learning fraud scoring, production anti-money-laundering capability, live identity verification, regulatory reporting or automatic financial reversal.

## Decision

### Atomic Africa/Lagos activation buckets

Each product rule carries `activationCapPerRepDay`, defaulting to 10 and configurable from 1 to 1000. A bucket is keyed by representative and the UTC instant corresponding to 00:00 in Africa/Lagos. The implementation uses the fixed WAT UTC+1 offset and stores the exact window start/end.

Unique non-refund activation submissions increment the bucket through an atomic PostgreSQL insert/on-conflict update inside the existing ingestion transaction. The bucket row lock serializes same-representative/day decisions. Duplicate vendor events return before bucket increment. An attempt is blocked only when its resulting count is greater than the cap, so submissions 1–10 pass under the default and submission 11 is blocked.

A blocked submission is persisted as a quarantined vendor event, opens a fraud case and active hold, and creates no deal. Repeated over-cap submissions reuse an open, upheld or appeal-open case. Once that case is released, a new over-cap submission creates a new case rather than reopening or rewriting earlier history.

### Payout-blocking holds without financial reversal

A fraud hold belongs to exactly one case. `active` and `upheld` holds block payout batch assembly, due-payout dispatch, Finance recovery and the final successful-outcome settlement pre-flight. The settlement pre-flight is required because a hold may begin after reservation or dispatch.

Release affects only the reviewed case. Other active/upheld cases continue to block the representative. Conduct decisions do not void deals, alter commission, post ledger entries, execute clawbacks or call payment providers. Review responses explicitly report no financial reversal and identify when a separate clawback assessment is required.

### Row-locked conduct and appeal lifecycle

Fraud cases use `open`, `released`, `upheld` and `appeal_open`; holds use `active`, `released` and `upheld`. Operations may release an open/appealed case or uphold it with no conduct action, a strike or suspension. All transitions lock the case and representative, reject competing decisions and append case history plus audit records.

A strike leaves representative status unchanged but keeps the upheld hold blocking. Suspension records the prior representative status and changes it to suspended. Only the owning representative may appeal an upheld case. Appeal keeps the hold and suspension in force and starts a new 24-hour review objective.

Release after a suspension appeal restores the prior status only if no other upheld suspension remains. This prevents one release from accidentally clearing an independent suspension.

### Review monitoring and privacy-safe evidence

Open and appeal-open cases have a review objective exactly 24 hours after the current review started. Overdue cases generate critical incidents with stable `fraud_review:{id}` keys. Incidents contain operational references, not customer identifiers or evidence notes.

Automatic case evidence contains rule, product, event, cap, attempt-count and window metadata. It excludes raw customer phone values, customer hashes and vendor payloads. Manual evidence notes warn operators not to enter NIN, BVN, bank details or customer phone numbers. Case events are protected by an append-only database trigger.

## Verification

- Policy tests prove exact Africa/Lagos UTC boundaries, cap 9/10/11 and custom-cap behavior, exact 24-hour review timing and active/upheld blocking semantics.
- The Phase 8 database journey proves default-cap acceptance through 10, quarantine at 11, case reuse at 12, duplicate-event exclusion and a new case after release.
- Concurrent cap-1 submissions produce one accepted event, one quarantine and one case. Concurrent duplicate appeal decisions produce one success and one rejection.
- Acceptance proves assembly/dispatch/recovery/final-pre-flight blocking, independent multiple holds, strike/suspension behavior, safe prior-status restoration and exact opened/upheld/appeal-requested/released history.
- Deal and ledger snapshots are byte-equivalent before and after conduct decisions. Direct case-history update/delete is rejected. Overdue review produces a critical incident.
- Browser journeys cover manual intake, strike uphold, representative appeal and Operations release on desktop and 375px layouts. CI runs Phase 8 after Phase 2–7 and before isolated recovery verification.

## Consequences and remaining boundaries

- The daily cap is an abuse-control heuristic, not proof of fraud. Operations must review context and document the basis for release or uphold.
- The control is limited to unique activation submissions. It does not provide device intelligence, behavioral biometrics, transaction monitoring, sanctions/PEP screening, AML case management or regulatory reporting.
- A payout hold pauses settlement progress; it does not settle the underlying commercial dispute or reverse money. Any void/clawback requires the existing separately reviewed financial workflow.
- Local in-app incidents are not external paging or a guaranteed 24-hour human response. Production requires external alert delivery, on-call ownership and measured response evidence.
- Production fraud operations still require legal/policy review, privileged-access controls, provider and bank evidence, edge/distributed abuse controls and broader security testing.
