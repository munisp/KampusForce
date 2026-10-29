# Phase 19 institutional programmes, document intelligence, connectors and recurrence

Assessment date: 2026-10-30

## Purpose and product boundary

Phase 19 answers four architectural questions without weakening KampusForce's financial model:

1. Government and international organizations need programme types, multi-institution governance and independently verified outcomes—not another customer-promotion label.
2. ATS documents need explicit consent, bounded document intelligence and human review—not upload-time scraping or automated selection.
3. A vendor such as CompanyA needs representative handoffs and durable progress evidence for a target such as 10,000 users—not a registration count presented as commissionable activation.
4. Commercial terms need versioned renewal cycles and intervals, but recurrence requires due qualifying vendor evidence—not elapsed time alone.

The goal remains accountable campus distribution from introduction to verified outcome and settlement. The representative's problem is proving introductions and understanding earnings; the vendor's problem is reconciling campus execution against genuine outcomes; the customer's problem is receiving assisted access without exposing regulated KYC to another intermediary. The opportunity is to reuse one verified-event rail across commerce and campus programmes while keeping non-financial outcomes distinct.

Preserved invariants:

- Vendor-funded commission remains 80% to the activating representative and 20% to the platform.
- The Campus Lead override remains 5% of assigned team-representative confirmed gross commission, funded from platform revenue.
- Only qualifying vendor-verified activation events create commission entitlement.
- First-touch attribution, prepaid escrow, clawbacks, the ₦500 payout minimum, KYC/bank-name-match checks and 10% sandbox withholding remain authoritative.
- Recruitment, applications, assessments, interviews, offers, institutional outcomes, document analysis, connector registrations and recurrence sweeps create no financial entitlement.
- Raw NIN/BVN is never persisted. Customer KYC remains in the vendor's regulated flow.
- `productionReady` remains false. Synthetic attestations are control fixtures, not real institutional or national outcomes.

## Schema and migrations

Phase 19 uses additive PostgreSQL migrations:

- `0020_phase19_institutional_connectors_recurrence.sql`: institutional governance/partners, document analyses, connectors, representative handoffs, pseudonymous customer mappings, progress events, recurrence schedules/receipts, indexes and append-only protections.
- `0021_phase19_institutional_campaign_types.sql`: replaces the campaign-type check constraint with the complete seventeen-type catalogue. This correction is non-destructive and was required because the application catalogue had advanced beyond the older database constraint.

Application queries use Drizzle's type-safe PostgreSQL API. Do not drop tables, force a schema push or bypass reviewed migrations. New commission rules affect future deals; existing deals retain their `commissionRuleId`.

## 1. Institutional campaign operations

### Catalogue

The original eight journeys remain recruitment, internship, scholarship, fellowship, campus event, research, training and waitlist. Phase 19 adds:

| Campaign type | Independently verified outcome |
|---|---|
| Grant | `grant_awarded` |
| Bursary | `bursary_awarded` |
| Public service | `service_placement` |
| Volunteer | `volunteer_completion` |
| Development programme | `development_completion` |
| Public health | `outreach_completion` |
| Innovation challenge | `challenge_completion` |
| Emergency response | `response_completion` |
| Civic programme | `civic_completion` |

### Operating sequence

1. Vendor or Operations drafts the campaign with campus targets, schedule, courses and overall capacity.
2. The manager records sponsor type/name/reference, funding model/reference/amount, procurement reference where applicable, eligibility policy, study levels, graduation-year bounds, safeguarding, accessibility and audit requirements.
3. At least one institution or delivery partner is attached with country, programme role and governance reference.
4. Operations independently reviews every partner. Creators cannot review their own partner evidence, and only `pending` partners are reviewable.
5. The manager submits governance only after all partners are approved.
6. A different Operations reviewer approves governance. Campaign creators, governance creators and submitters cannot self-approve.
7. The campaign follows the existing independent campaign review and activation path. Institutional campaign submission is blocked until governance is approved.
8. Applicant eligibility checks the approved course, study-level and graduation-year controls.
9. Completion uses the existing independent outcome observer/reviewer and campaign-capacity lock. The outcome does not create a deal, attribution row, ledger entry, escrow movement, payout or commission.

Finance receives aggregate read-only oversight. Campus Leads and representatives do not receive vendor-wide governance approval authority.

## 2. Consented ATS document intelligence

### Processing boundary

Upload and analysis are separate operations. Upload stores the reviewed object and SHA-256 content hash; it does not start OCR or a VLM. Analysis supports PDF, PNG, JPEG and WebP up to 10 MiB and requires consent version/time plus an analysis retention deadline no later than the applicant's retention deadline.

Server modes:

- `KF_TALENT_PROCESSOR_MODE=external`: invokes the real restrictive worker contract for PaddleOCR, Docling and bounded VLM extraction.
- `KF_TALENT_PROCESSOR_MODE=fixture`: explicit metadata-only sandbox behavior. It never claims OCR or extraction.
- Unconfigured/other mode: fails closed with `PROCESSOR_NOT_CONFIGURED` and a failed analysis record containing no extracted source text.

The external worker uses restrictive temporary files, timeout/output bounds and cleanup. PaddleOCR/Docling source text is transient. Persisted output is restricted to bounded educational evidence and quality/confidence metadata. Raw document text, automated candidate scores, rankings, recommendations and selection decisions are not persisted.

### Review and privacy lifecycle

1. Representative, vendor or Operations uploads the document through the ATS.
2. An authorized user explicitly records analysis consent and starts processing.
3. Successful processing enters `needs_review`; fixture records are labelled `sandbox_fixture`.
4. Vendor or Operations independently reviews bounded evidence against the source document. Review does not change application stage or score.
5. Withdrawal purges the analysis. Document deletion, applicant consent withdrawal and retention enforcement follow their existing purge paths.
6. Finance cannot access applicant contacts, documents or analysis mutation forms.

Local acceptance used a structurally valid synthetic PDF and real platform object storage. Real PaddleOCR, Docling and VLM execution for this ATS workflow did not occur. Earlier identity-platform OCR results must not be relabelled as Phase 19 ATS execution evidence.

## 3. CompanyA-style vendor connectors

### Setup and representative handoff

1. A vendor starts from an independently approved active promotion and configures a connector name, confirmed-user target, success event and handoff mode.
2. Operations independently reviews and activates the sandbox connector.
3. The vendor selects an active representative and records handoff consent. An eligible accepted/completed ATS application may be linked, but direct representative selection is also supported.
4. The representative accepts the handoff. The service creates the signed first-touch promotion link through the existing promotion service.
5. Optional provisioning evidence is explicitly sandbox-only. `execution_mode` remains `sandbox` and `external_account_creation` remains false.

Signed URLs contain no customer data. Setup, ATS selection and representative selection alone create no customer, attribution, deal or commission.

### Progress ingestion and privacy

The signed endpoint is:

`POST /v1/webhooks/:vendorKey/connector-progress`

Controls include raw-body HMAC-SHA256, a five-minute timestamp window, active credential validation, vendor/connector ownership, payload validation and replay idempotency. Production vendors should sign server-to-server requests rather than typing customer data into the sandbox UI.

- `clicked`, `registered` and `provisioned` are observed funnel evidence only.
- `account_created`, `kyc_complete`, `funded`, `first_transaction`, `renewal` and `refund` enter the canonical verified ingestion controls, subject to product/event rules, attribution, capacity, velocity, escrow and dedupe requirements.
- Customer mappings retain keyed hashes, not raw external customer references or phone values.
- Confirmed target progress counts confirmed deals linked to the connector and its configured success event. Registrations and clicks do not count as confirmed activations.

A connector configured for 10,000 funded users therefore reports registrations separately from signed verified submissions, accepted deals and confirmed funded outcomes. This prevents CompanyA's top-of-funnel progress from being mistaken for earned commission.

## 4. Adjustable commercial terms and recurrence

Vendor Rule Studio preserves flat/percentage commercial terms, activation caps and immutable versions. Renewal-capable rules additionally define:

- `recurrenceIntervalMonths`: 1–12 months between eligible cycles.
- `recurrenceMonths`: maximum eligible renewal cycles.

The initial accepted vendor-verified renewal creates a schedule tied to the original deal, first-touch representative, customer hash and commission rule. A due sweep only changes an eligible schedule to `awaiting_evidence` and appends a receipt. It creates zero deals and zero ledger entries.

A subsequent renewal must arrive through qualifying vendor-verified evidence and pass existing product, attribution, capacity, velocity and ledger controls. Early renewals and renewals beyond the cycle cap are ignored. Accepted cycles preserve the original representative and rule, advance the schedule and append an immutable receipt. Month-end and leap-year behavior is covered by policy tests.

Operations can run the sandbox sweep manually. Finance has read-only schedule/receipt oversight and cannot execute it. Forecasts remain planning estimates rather than entitlement.

## Verification

Use only an isolated sandbox database and configured reviewed object storage. Never print rotated webhook secrets or generated environment values.

```bash
npm run check
npm run lint
npm test
npm run build
npx tsx scripts/verify-phase19.ts
npx tsx scripts/verify-phase18.ts
```

For the production-browser gate, start the built server with the explicit metadata-only fixture, then run:

```bash
KF_TALENT_PROCESSOR_MODE=fixture npm start
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python3 scripts/verify-phase19-browser.py
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python3 scripts/verify-phase18-browser.py
```

Latest local evidence:

- Phase 19 service/storage acceptance passed all nine institutional types, independent review/eligibility, document privacy, connector security/economics, recurrence and append-only controls.
- Financial snapshots remained unchanged for institutional workflows, document analysis, observed connector events, sweeps and early/exhausted renewals.
- Fourteen Phase 19 browser mutations and eighteen desktop/mobile checks passed with zero runtime errors, HTTP errors, external requests or page overflow.
- Phase 18 service and browser regressions passed, including eleven ATS inspectors and 32 browser checks.
- TypeScript, ESLint, 25 test files/128 tests, production build, bundled entry and health/PWA smoke passed.
- Browser verification found and corrected a partner-state control mismatch and an asynchronous document-form reference defect before the final green run.

## Remaining production gates

1. Execute and evaluate the real ATS PaddleOCR/Docling/VLM worker with reviewed documents, malicious-input tests, model/version evidence, accuracy evaluation and production retention/monitoring.
2. Obtain real institutional governance and outcome evidence; synthetic approvals never certify a government, university, NGO or international programme.
3. Integrate live vendor connector APIs with production credential management, signed callback reconciliation, capacity/failure testing and explicit account-provisioning authorization.
4. Complete staging, cross-browser, accessibility, failure/HA, scheduler and production-scale verification.
5. Preserve live-payment, identity, legal, regulatory, security and real-campus gates. Local sandbox acceptance is not production, provider, institutional, identity, scale or real-recruitment certification.
