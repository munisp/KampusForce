# ADR 011: Phase 10 integration and launch readiness

## Status

Accepted for the local sandbox vertical slice on 2026-10-28. This is not live-provider connectivity, production approval, legal/security certification, a real campus launch or regulatory compliance evidence.

## Context

Phase 9 left live provider execution, independently reviewed launch evidence and verified provider outcomes as external gates. A local sandbox success control must never become an implicit production settlement path, and configuration presence must not be mistaken for connectivity, account funding or approval.

## Decision

### Evidence-controlled launch readiness

- Maintain a 25-item catalog across Legal, Finance, Operations, Engineering and Product. Twenty-four items are required; local load evidence is optional and earns no launch credit.
- Separate evidence submission from independent approval or rejection. The submitter cannot review their own gate. Transitions, history and audit records commit transactionally under row locks.
- Store evidence references and notes, not evidence files, credentials, raw identity values or bank-account numbers.
- Treat approval as an attestation that an external approver reviewed evidence. It does not verify the external system or set `productionReady`; local responses keep that value `false`.

### Guarded provider adapters

- Implement Paystack recipient/single-transfer and Flutterwave v3 single-transfer adapters with transient account inputs, integer-kobo validation and merchant-generated unique references.
- Return adapter acceptance with `settlementEligible: false`. Provider acceptance is not a paid payout or a ledger posting.
- Fail closed unless provider mode is live, explicit cutover authorization is enabled, the application URL is HTTPS and every required launch gate has independent approval.
- Expose only secret-free configuration booleans and missing-configuration metadata. Never return credential values.

### Verified provider outcomes

- Verify Paystack HMAC-SHA512 over the exact raw body and Flutterwave’s configured verification hash before processing.
- Persist sanitized transfer metadata only. Deduplicate valid provider deliveries without allowing an invalid signature to poison a later valid delivery of the same payload.
- Settle only a terminal verified outcome matching the initiated attempt’s provider, merchant-generated reference and exact net-kobo amount. Provider object IDs are not settlement references.
- Quarantine reversals, unknown references, invalid amounts and mismatches. Never infer paid status or post external-bank entries from ambiguous callbacks.

## Verification

- `scripts/verify-phase10.ts` covers the 25/24 gate catalog, four-eyes review, credential-text rejection, fail-closed execution, signed test callbacks, exact-match settlement, duplicate prevention, amount-mismatch and reversal quarantine, and absence of persisted raw bank values.
- `scripts/verify-phase10-browser.py` covers launch evidence submission, self-approval rejection, secret-free configuration, `productionReady: false`, HTTP 403 in sandbox mode, 375px layout and zero browser runtime errors.
- All 49 unit tests, ordered Phase 2–10 database journeys, isolated restore and the standalone bundled-server smoke passed. No live provider request was made.

## Consequences and remaining gates

- The code can integrate with real providers only after credentials, connectivity, account funding, legal/security approval and the complete launch review exist outside this sandbox.
- Real callbacks, authenticated bank statements, production monitoring, external secrets management, offsite/PITR recovery and production incident response remain unproven.
- Campus outcomes and roadmap KPIs still require independently reviewed real-world evidence; seeded fixtures cannot establish a launch.
