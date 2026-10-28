# Identity, onboarding and privacy operations runbook

Assessment date: 2026-10-29

## Scope and assurance boundary

Phase 14 adds event-driven onboarding for representatives, Campus Leads, vendors, Operations/Finance reviewers and vendor-regulated customer handoffs. It integrates identity eligibility with recruitment, vendor activation, payout assembly/settlement, consent, durable expiry, audit and privacy-safe lakehouse events.

This is an executable control implementation, not proof of live identity verification or full production readiness. Synthetic providers are control fixtures. PaddleOCR and Docling ran locally against synthetic, non-sensitive documents; no VLM, liveness or deepfake provider has been called. No PAD, injection-attack, deepfake, demographic-performance, legal, security or managed-deployment certification is claimed.

## Non-negotiable data boundaries

- Never persist raw NIN/BVN.
- Keep customer KYC and its decision in the vendor-regulated flow. The platform handoff accepts no customer identifier, document or biometric payload.
- Raw documents and extracted text are transient processor data only. The document adapter removes its temporary workspace in a `finally` path.
- Ordinary platform records contain only bounded evidence metadata, hashes, provider/model references, quality flags and allowlisted scalar findings.
- Do not store biometric media or templates. `template_stored: true` is rejected.
- PostgreSQL analytics and lakehouse exports must not contain documents, OCR text, extracted identity fields, NIN/BVN, biometrics, biometric templates, evidence findings or review reasons.
- Lifecycle exports use domain-separated HMAC-SHA256 subject tokens. Consent withdrawal produces a subject-token tombstone requirement.
- Synthetic evidence never authorizes a live case, and live evidence/approval fails closed until every external readiness gate passes.

## Stakeholder workflows

### Representative and Campus Lead

1. Recruitment acceptance opens a `representative_kyc` case; a representative can also start onboarding from **Identity & onboarding**. Campus Lead promotion/reverification uses `campus_lead_kyc`.
2. The applicant acknowledges both the identity-verification and biometric-liveness notices, then submits the case.
3. Document, capture-integrity, liveness, deepfake, face-match and bank-name-match controls produce independent evidence metadata. OCR or a VLM cannot substitute for liveness or deepfake controls.
4. Complete passing evidence routes the case to manual review. Approval is never automatic.
5. Recruitment activation and payout preflight require a current approved case, verified user state and bank-name match. Settlement rechecks approval before any provider outcome can mark money paid.
6. Approval expires after 365 days. Reverification is due within 30 days of expiry and creates a new case rather than rewriting the prior decision.

### Vendor

1. **Start vendor KYB** opens a `vendor_kyb` case for the signed-in vendor owner.
2. The workflow requires the person/document control set plus registry KYB evidence. A production deployment must define the reviewed registry and authorized-signatory sources for each operating jurisdiction.
3. Independent approval activates the vendor. Rejection, expiry or consent withdrawal prevents or pauses activation according to the case state.
4. **Customer KYC handoff** records only a vendor-level audit event. It does not create a platform customer identity case or accept customer identity data.

### Operations, Admin and Finance

1. Privileged users start `operations_kyc` from their own Identity workspace. Applicant consent and submission controls remain available for their own case even when they also have review permission.
2. Operations/Admin can process and review other users' sandbox cases. Finance can complete its own onboarding but cannot approve identity cases.
3. A reviewer cannot approve their own case. The UI does not offer self-review actions and the service independently rejects them.
4. Privileged access still requires the separate administrative authorization and production access-review process; identity approval alone does not grant a role.

### Case states and review

Cases use `draft`, `submitted`, `processing`, `needs_more_info`, `manual_review`, `approved`, `rejected`, `expired` and `revoked`. Approval requires the latest record for every policy-required evidence kind to be `passed`, a manual-review state, an Operations/Admin reviewer, independence from the subject and— for live mode—every live readiness gate.

Review reasons are bounded and reject long identifier-like numbers. Do not place names, NIN/BVN, document numbers, bank details or other identity content in reasons or support tickets.

Case creation locks the user or vendor subject inside a real transaction and a partial unique index permits only one open case per subject/type. Concurrent requests reuse the same case; reverification rejects premature requests and replays reuse the existing open case. Eligibility is recalculated from every current applicable approval, so expiring, rejecting or revoking one case cannot erase eligibility supported by another valid approval. Database triggers make evidence and review history append-only and permit only export bookkeeping fields to change on lifecycle events.

## Trigger catalog

| Event | Control action | Downstream boundary |
|---|---|---|
| `recruitment.invitation_accepted` | Open representative KYC | Recruitment activation remains blocked until current approval |
| `representative.onboarding_submitted` | Process document and biometric controls | Route to manual review only after required evidence |
| `campus_lead.promotion_requested` | Reverify identity and liveness | Lead role remains unchanged until approval |
| `vendor.activation_requested` | Open KYB and signatory checks | Vendor activation remains blocked until approval |
| `operations.access_requested` | Open reviewer identity checks | Separate administrative access approval remains necessary |
| `identity.document_accepted` | Run transient PaddleOCR, Docling and VLM controls | Persist bounded evidence only |
| `identity.document_extraction_completed` | Start hosted liveness capture | Run separate deepfake and capture-integrity controls |
| `identity.evidence_completed` | Route manual review | Approve, request information or reject with a reason |
| `payout.batch_requested` | Recheck approval, expiry and bank-name match | Hold or queue reverification |
| `payout.settlement_requested` | Recheck current approval | Fail closed before settlement |
| `identity.risk_signal_received` | Revoke or require step-up verification | Recheck activation and payout eligibility |
| `identity.approval_expiring` | Request reverification | Expire without grace |
| `consent.withdrawn` | Stop consent-dependent processing and revoke eligibility | Export privacy-safe subject-token tombstone |
| `customer.vendor_handoff_requested` | Redirect to the vendor-regulated flow | No platform KYC decision or biometric storage |

The durable `identity_expiry` job expires due approvals and revokes associated user/vendor eligibility. `identity.risk_signal_received` is a defined integration contract; a production risk provider and its authenticated callback remain external implementation/approval work.

## Provider integration

### Transient document worker

`api/services/identityDocumentProcessor.ts` accepts only PDF, PNG and JPEG inputs up to 10 MiB. It spawns `identity_platform/document_worker.py` without a shell, applies a 60-second timeout and bounded output, and requires exactly three versioned results:

- PaddleOCR: OCR quality and confidence metadata.
- Docling: structured-document conversion metadata.
- VLM: bounded cross-check outcomes only.

The VLM prompt forbids returning names, identity numbers, dates, addresses, document text or explanations. OCR/structured text may be processed only under the approved transient processor contract. The output contract rejects raw fields, nested findings and unbounded values. OCR cannot pass without an explicit confidence of at least 0.75. VLM cross-check and tamper outcomes must be explicit booleans; missing or unknown values fail closed rather than becoming successful evidence.

Install the exact local runtime with `UV_HTTP_TIMEOUT=180 uv pip install --target /tmp/kampusforce-identity-deps --no-cache -r identity_platform/requirements.txt`, then invoke the worker with that target on `PYTHONPATH`. Keep it separate from the Delta/Ray target because native numerical packages can differ. PaddleOCR defaults to portable native CPU execution (`enable_mkldnn=False`) after Paddle 3.3.1 oneDNN rejected valid PP-OCR runtime attributes; acceleration is opt-in only after deployment-specific verification. `PADDLEOCR_DEVICE` and `PADDLEOCR_ENABLE_MKLDNN` control that runtime path.

Local synthetic acceptance passed: PaddleOCR 3.7.0/PaddlePaddle 3.3.1 detected all six image lines with mean confidence 0.992596, and Docling 2.144.0 converted a one-page text PDF with the expected synthetic marker. The default Hugging Face route timed out for Docling artifacts; `HF_ENDPOINT=https://hf-mirror.com` with XET disabled was a sandbox download workaround, not an approved production model supply chain. No real identity document or extracted identity text was used or persisted.

Production deployment must pre-cache and pin models and artifact hashes in an approved registry, scan/disarm malicious documents, isolate the worker with no persistent volume, restrict egress, test resource limits and verify temporary-file cleanup under failure and concurrency. Package pins alone do not pin mutable external model artifacts or certify provider accuracy.

### Hosted liveness and deepfake providers

`api/services/identityBiometricProvider.ts` verifies a hosted-provider session reference rather than accepting biometric media through ordinary case APIs. HTTPS, explicit host allowlisting, bounded requests/responses, timeout and no redirects are mandatory. Liveness returns separate capture-integrity, liveness and face-match controls; deepfake is a separate provider contract.

Injection, presentation-attack, tamper or failed capture-attestation signals override nominal provider success. Applicable capture-attestation, injection, presentation-attack and tamper signals are mandatory: missing or unknown signals reject the result even when the provider reports `passed`. Response bodies are streamed with a 64 KiB limit and strict UTF-8 decoding; oversized or malformed responses fail closed. A provider score alone is not sufficient assurance.

Before live use, obtain independent evaluation covering applicable ISO/IEC 30107-3 PAD reporting, injection attacks, capture/sensor integrity, synthetic-media/deepfake attacks, false accept/reject outcomes, demographic and accessibility effects, device/browser coverage and ongoing regression thresholds. Do not describe a provider as “world-class” without that evidence.

## Live configuration and fail-closed gates

Keep `.env.example` identity values blank or false in sandbox. Live execution requires all of the following:

1. `KF_IDENTITY_PROCESSOR_MODE=external` with a working isolated worker and pinned HTTPS VLM configuration.
2. External liveness and deepfake providers with HTTPS endpoints and explicit `KF_IDENTITY_PROVIDER_ALLOWED_HOSTS`.
3. `KF_IDENTITY_PROVIDER_EVALUATION_EVIDENCE=approved` after independent security evaluation.
4. A production `KF_IDENTITY_TOKENIZATION_SECRET` of at least 32 characters from approved secrets management.
5. `KF_IDENTITY_LEGAL_SECURITY_APPROVED=true` only after notices, retention, redress, DPIA, processor contracts and security review are approved.
6. `KF_ALLOW_LIVE_IDENTITY_EXECUTION=true` as the final explicit authorization.

Never commit real provider keys or tokenization secrets. Configuration presence is not provider validation, legal approval or production evidence.

## Lakehouse and privacy operations

`scripts/export-lakehouse-input.ts` exports only consented identity lifecycle events with event/time, pseudonymous subject, case type/state, provider mode and consent. Withdrawn cases produce subject-token tombstones. The pipeline maintains separate identity Bronze/Silver/Gold tables and quarantine without mixing identity events into activation economics.

Logical Delta deletion is not physical erasure. Schedule and evidence Delta `VACUUM`, object-lifecycle deletion, backup retention and downstream replica cleanup separately. Confirm that no raw identity value appears in input, Bronze, Silver, Gold, quarantine, logs, manifests or error reports.

## Verification

Latest local runtime checkpoint:

- A user-space PostgreSQL 16.15 server ran all 13 migrations and repeated seed; ordered Phase 2–14 database journeys passed. The Phase 10 legacy payout fixture now completes independent synthetic representative KYC rather than bypassing the settlement identity gate.
- Real Delta/Ray acceptance passed and its manifests were recorded in PostgreSQL. Phase 9–14 production-browser journeys passed; the identity browser report had zero runtime errors and zero external requests.
- Finance now has a seeded sandbox login and workspace route. Its own-case journey supports consent, submission and withdrawal but offers neither processing nor approval controls. Operations/Admin review permissions remain separate.
- Router-level browser execution found inherited session-token fields were incompatible with `.strict()` on secondary identity inputs; field-level Zod validation remains, while those secondary objects now compose correctly with the tRPC token middleware. The privileged own-case action boundary was also corrected.
- Signed HTTP load accepted 100/100 events at concurrency 25. Backup manifest validation and isolated restore passed across 13 migrations with unchanged source records.
- PaddleOCR and Docling synthetic runtime checks passed as described above. VLM, hosted liveness/deepfake, malicious-document, concurrency and managed staging execution remain open.
- The final consolidated TypeScript, ESLint, Python syntax, patch, 96-unit-test, production-build and production dependency-audit checks passed. The earlier isolated bundled-server smoke also passed.

The following commands remain the repeatable sandbox journey:

```bash
npm run db:migrate
npm run db:seed
npm run db:seed
npx tsx scripts/verify-phase2.ts
npx tsx scripts/verify-phase3.ts
npx tsx scripts/verify-phase4.ts
npx tsx scripts/verify-phase5.ts
npx tsx scripts/verify-phase6.ts
npx tsx scripts/verify-phase7.ts
npx tsx scripts/verify-phase8.ts
npx tsx scripts/verify-phase9.ts
npx tsx scripts/verify-phase10.ts
npx tsx scripts/verify-phase11.ts
npx tsx scripts/verify-phase12.ts
npx tsx scripts/verify-phase13.ts
npx tsx scripts/verify-phase14.ts
npm run build
npm start
# In another shell, after the Phase 14 journey leaves its synthetic review fixture:
python3 scripts/verify-phase14-browser.py
```

The database journey checks incomplete-evidence rejection, independent review, payout eligibility, expiry, reverification, consent withdrawal/tombstones, vendor activation/pause, Operations self-approval rejection, customer-handoff boundaries, pseudonymized events and unchanged deals/ledger entries. It also covers concurrent open-case replay, premature/repeated reverification, append-only database rejection, and preservation of representative eligibility when a separate Campus Lead approval expires. The browser journey additionally checks role workflows, external-request absence, runtime errors and document overflow. Neither result would certify a live provider or production deployment.

## External production gates

1. Execute the complete document pipeline with an approved VLM plus hosted liveness/deepfake providers in isolated staging, and independently evaluate security, PAD/injection/deepfake resistance, accessibility and demographic performance. Local PaddleOCR/Docling synthetic checks do not satisfy this gate.
2. Complete DPIA/privacy notices, consent and withdrawal policy, retention/erasure schedules, processor contracts, redress and legal/security approvals.
3. Integrate approved secrets management, malware scanning, container/egress isolation, authenticated risk callbacks, monitoring, incident response and evidence retention without sensitive-data logging.
4. Prove migration, repeated seed, ordered Phase 2–14 regressions, lakehouse replay/tombstones, browser journeys, standalone bundle, backup/isolated restore and load/failure behavior in staging.
5. Complete privileged-access review, independent Operations procedures, vendor registry/source approval, customer-handoff review and production service-level evidence before enabling live execution.
