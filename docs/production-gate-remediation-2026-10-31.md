# Production execution-gate remediation — 2026-10-31

## Scope and evidence boundary

This change implements the remaining repository-actionable controls identified after the comprehensive audit. It does not manufacture live credentials, legal or regulatory approval, independent penetration-test evidence, provider certification, campus outcomes, production PITR evidence, or operational history. `productionReady` remains `false`.

All acceptance described here uses the isolated PostgreSQL sandbox, synthetic identity/review fixtures, injected provider responses, and signed test delivery requests. No live provider request or real bank transfer occurred. Synthetic approvals are control fixtures, not external evidence.

## Implemented controls

### Encrypted payout destinations

- Representatives can configure a destination only after current approved identity evidence, verified KYC, bank-name match, and an exact normalized match to the independently verified account name.
- Account numbers use AES-256-GCM with a random 96-bit IV, authentication tag, user-specific additional authenticated data, keyed integrity hash, and key version.
- Browser status and audit metadata expose only bank code, verified account name, last four digits, and destination version. Full account numbers are decrypted only inside the server dispatch path.
- Wrong keys, wrong key versions, modified ciphertext, and integrity mismatches fail closed. Controlled key rotation remains an operational procedure rather than an automatic online rewrite.

### Live payout execution and recovery

- Payouts and attempts carry an explicit `executionMode`; sandbox and live outcomes cannot settle each other.
- Live dispatch requires complete live configuration, sandbox authentication disabled, HTTPS application URL, explicit cutover authorization, a 32-byte destination key, and independent approval of every required launch gate.
- Dispatch rechecks fraud, representative, identity, and student-assurance eligibility before reserving an attempt.
- The attempt and `processing` state are committed before any provider network call. No provider request runs while holding the payout row lock.
- Paystack recipient/transfer and Flutterwave transfer adapters use bounded streamed responses. Ordinary explicit 4xx rejection is retryable; timeout, conflict, rate limit, 5xx, network, malformed success, oversized response, and receipt mismatch are ambiguous.
- Provider acceptance records `providerAcceptedAt` but remains `processing` and `settlementEligible: false`. Only a verified terminal provider outcome can post settlement entries.
- Explicit rejection follows the existing bounded retry policy. Ambiguous outcomes become `held`, clear automatic retry eligibility, and require reconciliation.
- Interrupted unacknowledged live attempts become `held` rather than being emitted again. Accepted attempts waiting for webhooks are not misclassified as interrupted.
- A verified late outcome can reconcile an unknown-outcome hold after exact provider, reference, amount, entitlement, identity, assurance, and fraud checks.
- Reconciliation and incident text distinguish live records from sandbox records. Supplied bank figures remain explicitly not independently verified.

### Durable signed notification delivery

- In-app notification creation and optional delivery-outbox insertion share one transaction.
- Signed webhooks use HMAC-SHA256 over `timestamp.payload`, a stable delivery ID, bounded attempts, backoff, retry scheduling, and dead letters.
- Claims use row locks and recheck due/stale state to prevent concurrent duplicate delivery. A delivered record is excluded from later sends.
- Sandbox permits HTTPS or loopback HTTP. Live delivery additionally requires HTTPS, an allowlisted host, production mode, cutover authorization, and launch-gate approval.
- Only a receipt hash and bounded receipt identifier material are retained; response bodies are discarded. A webhook acceptance receipt does not claim SMS, email, WhatsApp, or user-read delivery.

### Security, health, worker, and deployment

- Production live mode requires destination encryption configuration and at least one complete payout-provider credential path; existing production-secret requirements remain enforced.
- Hono secure headers and route-specific rate limits protect connector-progress and provider-payout webhook entry points.
- Health derives requested/effective mode from configuration. Readiness checks database access, recent successful worker activity, provider configuration, notification misconfiguration, and dead-letter presence.
- The durable worker performs an immediate startup pass, skips overlapping timer passes, cleans expired sessions/OTP challenges, and processes notification deliveries.
- The container runs as the non-root `node` user and uses the readiness endpoint for its health check. The build script and `dist/boot.js` entry remain unchanged.

## Database changes

- `0023_production_execution_controls.sql`: adds encrypted destinations, notification deliveries, and payout/attempt execution modes.
- `0024_provider_acceptance_tracking.sql`: adds the provider-acceptance timestamp used to distinguish accepted transfers from uncertain reservations.
- Both migrations are additive. No table or column is dropped, and no destructive schema shortcut is used.

## Acceptance evidence

Passed locally:

- TypeScript project check and ESLint.
- 28 Vitest files / 136 tests, including new encryption, notification-configuration, explicit-rejection, malformed-response, and bounded-response cases.
- `scripts/verify-production-gates.ts`: tamper/wrong-key rejection; plaintext exclusion; launch block; accepted-but-unsettled dispatch; explicit-rejection retry; ambiguous hold; no automatic unknown retry; late verified reconciliation; mode-confusion rejection; interrupted recovery; signed-delivery HMAC/idempotency/concurrency/retry/dead-letter checks; duplicate job suppression; truthful health.
- Ordered Phase 2–19 PostgreSQL journeys on the migrated sandbox, including genuine Delta Lake/Ray evidence generation and recording.
- Phase 10 launch and signed provider-outcome acceptance with `productionReady: false` and no live provider request.

- Thirteen document-worker tests, all 25 additive migrations, and isolated backup/restore with 24 user triggers.
- Production build/runtime checks, browser Phases 9–19, and the final adversarial browser audit. The Phase 12 rerun exposed and fixed a long-event-name audit-grid overflow at 375px; real touch hit-testing then passed all five mobile Sales views with no horizontal overflow or runtime errors.
- Phase 19 used only its explicit metadata-only document fixture in the browser and made no external provider request. This does not replace the separately recorded real OCR/Docling/VLM synthetic-worker evidence.

Delivery evidence is recorded in the README release checkpoint. No result above closes an external production gate.

## External gates that remain open

The following cannot be completed by repository code or synthetic acceptance:

1. Executed legal agreements, campus endorsements, regulatory filings, processor DPAs, and professional tax review.
2. Live provider credentials, funded accounts, provider onboarding/certification, verified bank-name services, and production webhook endpoints.
3. Independent penetration testing and acceptance of remediations.
4. Production-like staging SLO history, staging load evidence, and a zero-variance parallel run.
5. Production PITR/snapshot infrastructure, immutable retention, and independently evidenced recovery objectives.
6. Real campus operating outcomes, vendor cutovers, staffed operational rotas, and signed production-cutover authorization.
7. Controlled key management/rotation, external secrets management, production WAF/edge controls, and external alert delivery evidence.

Launch-gate records remain attestations with independent review and self-approval prevention; they do not verify these external systems. No local result should be represented as production readiness.
