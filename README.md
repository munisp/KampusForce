# KampusForce

Campus commerce, accounted for. KampusForce is a vendor-neutral attribution, commission, escrow and settlement layer connecting vendors, verified student representatives and customers.

This repository contains an executable **Phase 19 institutional, document-intelligence, vendor-connector and recurrence workspace**. Seventeen opportunity journeys now include government and international-organization programmes with independent partner/governance review, funding/procurement, eligibility, safeguarding, accessibility and audit controls. Consented ATS document analysis has fail-closed PaddleOCR/Docling/bounded-VLM contracts, transient source text, restricted persisted evidence and independent human review. CompanyA-style connectors provide consented representative handoffs, signed first-touch links, pseudonymous customer mappings, signed progress ingestion and observed-versus-verified funnel reporting. Adjustable renewal cycles and intervals execute only against due, qualifying vendor-verified evidence while preserving original attribution and commission rules. The Phase 18 ATS, Phase 17 control plane and all earlier promotion, assurance, identity, analytics and financial workflows remain preserved. Recruitment, participation, document analysis, connector registrations and elapsed renewal dates never create commission entitlement; CRM forecasts remain planning estimates. A complete local ATS worker run executed real PaddleOCR, Docling and pinned Qwen2-VL inference against one synthetic transcript; external account creation remains false, and `productionReady` remains false.

## Product thesis

- **Goal:** make campus distribution accountable from introduction to payout and support resolution.
- **Rep problem:** introductions are difficult to prove, commission terms are opaque and earnings arrive unpredictably.
- **Vendor problem:** campus acquisition is fragmented and hard to reconcile against verified activations and support quality.
- **Customer problem:** assisted access to useful products must not create markups or expose sensitive KYC data to another intermediary.
- **Opportunity:** one verified-event and settlement rail can serve fintech, airtime/data, devices, edtech and micro-insurance without inventory, terminals or customer float.

Vendor-funded commission is split **80% to the activating rep / 20% to KampusForce**. Commission is earned on the vendor-verified activation defined by the product rule—not a signup. Escrow is pre-funded; KampusForce never fronts vendor money.

Phase 2 adds a Campus Lead override of **5% of the assigned team rep’s confirmed gross commission**, funded entirely from platform margin. It never reduces the activating rep’s 80% share and never creates additional vendor escrow liability.

## Implemented slice

### Core attribution and settlement

- Sandbox OTP and 12-hour JWT sessions; role-gated representative, vendor, Operations and Finance workspaces.
- Catalog across five product verticals with versioned flat/percentage rules and transparent terms.
- Signed links, QR kits, WhatsApp sharing and first-touch attribution using salted phone hashes.
- Six-step assisted onboarding that records consent and telemetry, never customer NIN/BVN/OTP fields.
- Raw-body HMAC-SHA256 webhooks, five-minute timestamp validation, replay deduplication and quarantine.
- Integer-kobo commission math, escrow reservation, state history and ledger postings.
- Refund voids, paid-deal clawbacks and negative-balance netting against later payouts.
- Payout pre-flight checks for active rep, verified KYC, bank-name match and ₦500 minimum; 10% sandbox withholding.
- Rep deal disputes, operations decisions and audit history.

### Vendor, campus and support workflows

- Vendor Rule Studio with persisted 30-minute dry runs, exact split previews, typed publication confirmation and immutable rule versions.
- New deals persist their `commissionRuleId`; publishing a new version never recalculates historical deal amounts.
- Vendor attribution → activation → confirmation → paid funnel.
- Campus Lead recruiting invitations, existing-rep team assignment and team-performance records.
- Campus-specific top-decile eligibility and signed-contractor designation gates in Operations.
- Platform-funded override accrual, combined direct/override payouts, paid reversals and future netting.
- Scoped support inbox for owned deals or active first-touch referrals, with rep → campus lead → vendor → Ops escalation paths.
- Vendor-specific 1–168-hour SLA targets, persisted breach events, approved resolution macros and full ticket timelines.
- One-time post-resolution CSAT feeding rep and vendor quality scores.
- Installable PWA shell with read-only offline catalog and user-scoped earnings snapshots; sharing, disputes, support and financial mutations are deliberately online-only.

### Phase 3 operational controls

- Secure one-time recruiting links: only SHA-256 token hashes persist, acceptance requires the exact invited phone and contractor consent, and invitations expire after seven days.
- Separate Campus Lead/Operations revocation and approval-gated representative activation, with audited campus-team assignment and no raw NIN/BVN storage.
- Fifteen campus fixtures with record-derived health, active/pending reps, confirmed activations/commission, support load and SLA breaches. Fixture status is not a rollout claim.
- Durable PostgreSQL job runs for confirmation, draft expiry, SLA breaches and invitation expiry. Unique job/slot claims suppress duplicate scheduled passes across app instances.
- Recipient-scoped in-app notifications with read tracking; no SMS or email delivery is implied.
- Database triggers make ledger entries, audit logs, deal state history, support ticket events and consent logs append-only.
- Row-locked confirmation, refund, publication and per-recipient payout transactions. Acceptance tests cover competing sweeps, publishers and payout batches.
- PostgreSQL 16 CI workflow covering type checks, unit tests, build, migration, repeated seed and database acceptance journeys.

### Phase 4 settlement and reconciliation

- Batch assembly reserves payable deals and accrued overrides through payout links while leaving their financial states unchanged. External-bank postings and paid states occur only after an idempotent success outcome.
- Durable payout attempts use row locks, three automatic tries, backoff and a sandbox fallback provider. Exhaustion flags Finance without rewriting or deleting failure history.
- Finance recovery creates a replacement reservation only after rep, entitlement and outstanding-balance checks pass. The failed payout remains available for audit.
- A refund or entitlement change before settlement produces a held payout with no external-bank ledger entries.
- The PostgreSQL worker dispatches due retries and claims one daily 09:00 WAT assembly slot; this remains a minute-based worker rather than Redis/BullMQ.
- Three-way reconciliation compares external-bank ledger credits, successful sandbox attempts and an explicitly supplied sandbox bank figure. Exact matches, ₦1,000 tolerance and variance reports are append-only.

### Phase 5 operational safeguards

- Atomic PostgreSQL fixed-window throttling protects OTP request/verification, demo login, recruitment inspection and vendor-event routes. Over-limit requests return HTTP 429 with `Retry-After`; only SHA-256 policy/subject/window hashes persist.
- Lightweight liveness and database-backed readiness routes are available at `/api/health/live` and `/api/health/ready`. Responses explicitly identify sandbox mode.
- Campus Lead eligibility recalculation runs in a deduplicated hourly durable slot and through an Operations control. Ineligible leads are demoted under row locks to their prior tier; active assignments and open invitations are revoked, with audit and notification records.
- Demotion preserves historical override and ledger rows while disabling future team management and override accrual. It never rewrites settlement history or automatically promotes a replacement.
- Expired rate-limit buckets are removed by a durable cleanup job without deleting active buckets.
- PostgreSQL custom-format backup and isolated restore scripts validate the backup manifest, restore only into a newly created sandbox database, compare schema/data counts and leave source records unchanged.

### Phase 6 monitoring and incident response

- Record-derived monitoring detects failed durable jobs, failed or held payouts, reconciliation variances, quarantined vendor events and unresolved support SLA breaches. No synthetic uptime or external-alerting claim is made.
- Stable source-record deduplication creates one incident per affected record. Concurrent sweeps cannot create duplicate detection history; later sweeps refresh unresolved incidents without reopening resolved ones.
- Financial, worker and reconciliation signals are critical; event quarantine and support SLA signals are warning. Initial detection creates Operations in-app notifications, not SMS, email or paging.
- Operations can acknowledge open incidents and resolve open or acknowledged incidents with a required note. Row-locked mutations append incident events and audit records; incident history is append-only at the database layer.
- A durable five-minute monitoring slot and an Operations sweep control share the same detection service. See the [incident-response runbook](docs/incident-response.md).

### Phase 7 privacy operations and breach assessment

- Access, rectification, erasure and objection requests use salted customer-phone hashes, unique references and an exact 30-day response clock. Raw customer phone values are not persisted on DSAR records.
- Identity verification gates privacy-safe JSON evidence export. Row-locked review, fulfilment and rejection transitions append audit and append-only request history; exporting alone does not fulfil a request.
- Exports select only matching-hash attribution, activation/deal status, support status and consent metadata. They exclude raw identity values, bank details, tokens, support free text, event payloads, commissions and unrelated representative or financial records.
- DSAR fulfilment records an operational outcome; it does not automatically rectify/erase source records, delete financial history or certify statutory compliance.
- Breach assessments use an exact 72-hour triage clock, row-locked `reported → assessing → decision_recorded → closed` transitions and append-only history. Decisions require risk, notification decision, rationale and an Operations/Admin owner.
- The system records notification ownership only. It never sends NDPC or data-subject notices and explicitly reports `externalNotificationSent: false`.
- Overdue open DSARs create warning incidents; overdue reported/assessing breaches create critical incidents. See the [privacy-operations runbook](docs/privacy-response.md).

### Phase 8 fraud controls and conduct review

- Product rules configure a 1–1000 unique activation-submission cap per representative per Africa/Lagos calendar day; the default is 10. Duplicate vendor events return before incrementing the atomic PostgreSQL bucket.
- Submissions 1–10 are eligible under the default cap. Submission 11 is quarantined, creates no deal and opens a payout-blocking fraud case. Repeated over-cap submissions reuse the open/upheld/appeal case; a later breach after release creates a new case.
- Active and upheld holds block payout assembly, dispatch, Finance recovery and final settlement pre-flight. Releasing one case releases only that hold; other blocking cases remain effective.
- Operations can release a case or uphold it with no conduct action, a strike or suspension. Representatives can appeal upheld cases; the hold and any suspension remain in force during appeal.
- Appeal release restores the representative’s prior status only when no other upheld suspension remains. Every transition appends immutable case history and audit records.
- Open and appealed reviews have an exact 24-hour objective; overdue cases generate critical `fraud_review:{id}` incidents. See the [fraud and conduct runbook](docs/fraud-conduct-response.md).
- These are deterministic rule controls—not ML fraud scoring, production AML, regulatory reporting or automatic clawback. Decisions never void deals, post ledger entries or reverse money.

### Phase 9 reliability, offline and ingestion hardening

- Versioned webhook credentials support active, retiring and revoked states. Rotation returns a new secret once, keeps the previous credential valid for a 15-minute overlap and excludes both secrets from overview and audit metadata.
- Classified transient ingestion failures use durable retries with one-minute/five-minute backoff and three attempts. Permanent or exhausted failures become dead letters; concurrent workers resolve a retry once without weakening HMAC, timestamp, dedupe or activation-cap controls.
- Vendor-event payload content is purged after 30 days. Event IDs, dedupe keys, status and financial links remain so replay protection and commission history survive retention.
- Retry rows use redacted payloads and salted customer/reference hashes rather than raw customer phone values.
- Read-only offline catalog and user-scoped earnings snapshots survive an offline reload. Sharing and disputes are unavailable offline, and private snapshots clear on logout or user change.
- Route-level lazy loading reduced the initial browser JavaScript from approximately 573 kB to 326 kB before gzip. The service worker caches the shell, first-visit shared resources and visited route chunks.
- Repeatable local acceptance covers signed HTTP throughput and a throttled six-step browser handoff. Results are sandbox measurements, not production-capacity or device-lab certification.

### Phase 10 integration and launch readiness

- A 25-item launch catalog covers Legal, Finance, Operations, Engineering and Product. Twenty-four gates are required; optional local load evidence earns no launch credit.
- Evidence submission and independent approval/rejection are separate row-locked actions. Submitters cannot review their own evidence, and history is append-only. Approval records an external attestation—not verification of the external system or production readiness.
- Secret-free Paystack/Flutterwave configuration reports presence and missing settings only. Guarded adapters validate transient bank inputs, use merchant-generated references and always return `settlementEligible: false` on acceptance.
- Live execution fails closed without live mode, explicit cutover authorization, HTTPS and every required independent launch approval. Local readiness responses always report `productionReady: false`.
- Paystack HMAC-SHA512 and Flutterwave verification-hash callbacks persist sanitized transfer metadata. Only an exact initiated provider/reference/net-kobo terminal outcome can settle; duplicates, reversals and ambiguities cannot create paid postings.

### Phase 11 rollout evidence and national gates

- Calendar-month campus cohorts cover endorsement, 3–5 lead candidates, ≥60 verified reps, ≥30% cohort first activation, ≥100 month-one activations, rep NPS ≥40 and real payout proof.
- Full-calendar-quarter phase registers enforce the Phase 1, Phase 2 and Phase 3/national KPI thresholds, including five/fifteen/35 campuses, cumulative activations, payback, 50+ active vendors and real EBITDA evidence where applicable.
- System snapshots remain permanently ineligible for real-world attainment. External submission and independent review require real-world attestations; the submitter cannot review their own evidence.
- The latest external submission controls each metric, so newer pending or rejected evidence supersedes an earlier approval. Incomplete month/quarter coverage fails even when values meet thresholds.
- Evidence history is append-only and financial records remain unchanged. Evidence completion never marks a campus live, certifies a national launch or verifies the underlying external outcome by itself.

### Phase 12 case management, CRM and sales growth

- Ten case innovations add optimistic named ownership, first-response/resolution clocks, public replies/internal notes, snooze/wake, reopen history, case links, watchers, workload analytics, saved views and deterministic next-action guidance.
- Ten CRM innovations add rep-owned opportunities, activities, tasks, stall reasons, contextual drafts, human approval/share attestation, explainable fit scores, segments, weighted forecasts and privacy-safe verified-outcome loops.
- Five internal sales-training modules persist attempts, best scores, completion and readiness. They are not accredited certification or permission to perform regulated KYC.
- Campaigns require independent four-eyes review and use in-app notifications only. Conversion evidence is record-derived and atomically claimed; no SMS, email, WhatsApp or advertising delivery is claimed.
- Secret-free catalog/CRM/support/messaging connections provide sandbox tests and local-count synchronization only. No credentials persist, no live test runs and synchronization never changes financial state.
- The leaderboard combines verified deals, quality and training. Deterministic product targeting explains its factors; recommendations and ranks never create commission entitlements.
- Consent-confirmed student referrals become ordinary recruiting invitations with durable follow-up and event history. The invitation transaction locks the referral row; no external message is sent automatically.
- See the [robustness and innovation assessment](docs/sales-case-crm-robustness.md) for the complete mapping and remaining gaps.

### Phase 13 analytics, data platform and financial-core robustness

- Operations analytics use database-grouped current-state metrics, each deal's first confirmation for event-time trends and mature seven-day cohorts, confirmed-only economics, window-scoped reconciliation findings and immutable SHA-256 snapshots.
- The local Delta Lake Bronze/Silver/Gold reference enforces strict field allowlisting, raw-identifier rejection, timezone-aware events, immutable replay, conflict quarantine, consent/HMAC tokenization, confirmed-only Gold economics, coarse geo cells and DSAR rebuild evidence.
- Real Ray batch scoring uses history-only features and temporal holdouts with AUC, average-precision/prevalence and Brier calibration diagnostics. Approval-gated Ray Serve validates complete model and numeric-input contracts; local models remain unapproved.
- A PostgreSQL financial outbox creates deterministic TigerBeetle u128 IDs and balanced linked transfers, supports two-phase builders, retries transient failures and blocks conflicting, partial or unproven-backfill evidence. PostgreSQL remains the sandbox ledger.
- Mojaloop remains post-MVP. Party → quote → transfer preparation enforces live gates at transport execution, keyed party-reference hashing support, economics/expiry checks and independent settlement evidence. Preparation never marks a payout settled.
- The Operations → Analytics & architecture workspace exposes metric definitions, lineage, model diagnostics, outbox state and every external production blocker. See the [architecture robustness assessment](docs/architecture-robustness.md) and [data-platform runbook](data_platform/README.md).

### Phase 14 stakeholder onboarding and identity controls

- Representative, Campus Lead, vendor KYB and Operations/Finance onboarding share consent-gated cases, bounded evidence metadata, independent manual review, expiry, reverification and consent-withdrawal controls. Reviewers cannot approve their own case. Subject locks and a partial unique index prevent duplicate open cases; append-only triggers protect evidence, reviews and lifecycle content.
- Recruitment acceptance opens representative KYC; recruitment activation requires current approval and bank-name match. Vendor approval activates the vendor, while withdrawal pauses it. Payout assembly and settlement recheck current identity eligibility. Eligibility is derived from all current applicable approvals rather than the latest case transition alone.
- Transient PaddleOCR/Docling/VLM processing returns only bounded metadata. Separate hosted liveness, capture-integrity, face-match and deepfake contracts fail closed; attack signals override nominal provider success, and missing OCR confidence, VLM booleans or required anti-attack signals cannot pass. PaddleOCR 3.7.0/PaddlePaddle 3.3.1, Docling 2.144.0 and pinned `Qwen2-VL-2B-Instruct-Q4_K_M` passed a complete local synthetic-transcript worker run; no hosted biometric provider has been called.
- Fourteen trigger definitions connect onboarding, document/evidence processing, review, payout, risk, expiry, consent and vendor-regulated customer handoff workflows. Customer KYC decisions and customer identifiers remain outside the platform.
- Pseudonymized identity lifecycle events integrate with consent-filtered lakehouse Bronze/Silver/Gold tables and subject-token tombstones. Documents, OCR text, NIN/BVN, biometrics, templates, evidence findings and review reasons are excluded.
- See the [identity and onboarding runbook](docs/identity-onboarding-runbook.md) for trigger semantics, provider controls, live gates, verification and external production requirements.

### Phase 15 student and platform assurance

- Representative enrollment is separate from identity approval. Opaque institution/provider references are HMAC-SHA256 tokenized before storage; independent Operations review, a future validity date capped at 240 days, expiry, revocation and term revalidation govern current eligibility. Recruitment activation and payout preflight require current enrollment and no open duplicate-identity review.
- Provider-generated stable subject tokens support privacy-preserving duplicate review without persisting raw references or exposing the matched representative. A collision opens linked review/hold history for affected representatives; it is not proof of fraud. Independent clearing releases only the linked holds, while confirmation upholds them.
- Activation-quality reviews cover early refunds, repeated customers, dormant accounts, chargebacks and coordinated/manual signals. Warnings create review records without automatically blocking payout; high/critical signals reuse the existing fraud-case and payout-hold path. Confirmed/payable/paid deals alone count toward repeated-customer warnings, and processed refunds use a relational `deal_id` rather than an unreliable cross-domain hash join.
- Vendor assurance records sampled independent outcome reconciliation. A failed audit pauses only that vendor and revokes only its active/retiring webhook credentials; legacy-key ingestion is also blocked. A later passing sample never automatically reactivates the vendor.
- Live identity approval additionally requires current, exact provider/model evaluation evidence for applicable PAD, injection, deepfake and demographic controls. Evidence registration and expiry are durable and audited, but a sandbox record is not independent biometric certification.
- Operations receives Enrollment, Uniqueness, Activation quality, Vendor assurance and Biometric evaluation desks; Finance has read-only oversight. Representatives can submit/revalidate enrollment and inspect their own assurance state. Append-only assurance events preserve decisions without voiding deals, altering commission splits or posting financial reversals.
- See the [identity/onboarding runbook](docs/identity-onboarding-runbook.md) and [fraud/conduct runbook](docs/fraud-conduct-response.md) for operating procedures and external gates.

### Phase 16 vendor promotions and recruitment orchestration

- Vendor self-service briefs define product, campus, schedule, budget cap, recruitment target, staffing threshold and vendor landing URL. Independent Operations review is required before approval or activation; Finance has read-only oversight.
- Approved external promotions own a parent/child link to the existing internal campaign engine. Only an active, correctly tiered Campus Lead with current identity, enrollment and fraud clearance can issue consented recruitment invitations for the child campaign.
- Eight configurable, durable orchestration events cover approval, start, staffing risk, target met, pause, budget exhaustion, end and verified activation. Deduplicated processing retains receipts and retry history; the durable minute worker applies schedule transitions and propagates inactive vendor/product states.
- Signed promotion links contain only promotion/rep/product/vendor identifiers and expiry, never customer data. Only token hashes persist. Existing first-touch attribution wins over competing promotions, and invalid, paused, expired or inactive links fail closed.
- Recruitment target met stops further invitations while preserving existing onboarding. Pause/end closes new acquisition without erasing earned payouts or history. Budget exhaustion stops new activation submissions and notifies Operations.
- Promotion commitments include pending, confirmed, payable, paid and disputed deals. Vendor-level ingestion serialization and promotion row locks protect the final budget slot; uncommitted escrow checks avoid double-subtracting confirmed commitments.
- Customer outcomes come only from vendor-verified activations. Normal confirmation still determines the 80/20 split, platform-funded Campus Lead override, escrow, payout and clawback behavior; clicks, invitations, recruitment and promotion approval create no commission entitlement.
- Consent/suppression records use keyed hashes. External delivery is explicitly simulated and makes no external request. See the [promotion orchestration runbook](docs/promotion-orchestration-runbook.md).

### Phase 17 platform, CRM and case innovation control plane

- Platform controls add hash-only activation evidence lineage, bounded promotion simulations, independently published metric/control versions, purpose-checked consent events, independent outcome reconciliation, team-scoped capability coaching, small-cohort suppression, recommendation-only risk timing and hash-only provider-portability evidence.
- CRM adds a Relationship 360 timeline, explainable next actions, stable versioned scorecards, commit/best/pipeline planning forecasts, independently approved consent-led sequences with sandbox receipts, mentions, non-destructive duplicate review, non-financial influence, capacity routing and consent-led customer feedback. Ownership routing never changes first-touch attribution.
- Case management adds idempotent sandbox channel intake, skill/capacity routing, Africa/Lagos business-hours and waiting-time policies, reviewed platform object storage, independently approved knowledge, problem/known-error records, internal major-incident command, independent quality reviews, CSAT/effort analytics and a redacting copilot whose output requires human acceptance.
- Attachment records persist object keys only. Request-time URLs are never persisted; representatives cannot read staff attachments, staff messages or derived staff-only copilot content. External sequence channels produce receipts only, and copilots never send autonomous replies.
- See the [Phase 17 innovation runbook](docs/phase17-innovation-runbook.md) and [case/CRM robustness assessment](docs/sales-case-crm-robustness.md).

### Phase 18 opportunity ATS and new external campaign journeys

- Vendor or Operations campaign drafting includes eligibility, overall/campus targets and schedules. Campus targets must be unique and reconcile exactly to the overall target. Independent Operations review and activation are required; creators cannot approve their own campaigns.
- Dedicated vendor-deduplicated applicant profiles carry normalized contact data, course, study level, graduation year, source/ownership, consent version/time and retention expiry. Representatives can register applicants only at their own campus, and their workspace query scopes source/team records before pagination.
- The selection pipeline supports submitted, screening, assessment, interview, offer, accepted, completed, rejected and withdrawn states with optimistic versions, human reasons and append-only database-triggered history. Assessment submission and independent scoring are separate actions; interviewer schedules reject overlaps and structured scorecards gate recruitment/internship hiring offers.
- CVs, transcripts, course documents, certificates and other evidence use reviewed platform object storage. Records retain object keys and SHA-256 hashes rather than expiring URLs. Request-time document URLs are role-scoped; Finance and unrelated representatives cannot mint them.
- Draft offers can be issued through one-time signed response tokens. Only token hashes persist; expired, answered and replayed responses are rejected. Direct-participant campaigns use a separate selection/acceptance path rather than selection-offer semantics.
- Eight distinct journeys produce independently reviewed `hire`, `placement`, `award`, `fellowship`, `attendance`, `research_completion`, `learning_completion` and `early_access` outcomes. Observers cannot independently review their own observations, and campaign target capacity is checked under a row lock.
- Idempotent bulk import accepts 1–1,000 consented rows with row-level errors, duplicate reporting and replay protection. Formula-injection-safe CSV exports include a SHA-256 receipt and explicitly report `externalExecution: false`; no ATS/HR connector is claimed.
- Portfolio metrics use separate aggregate queries rather than the bounded display window. Consent withdrawal closes open applications. Retention enforcement purges stored documents before anonymizing contact data while retaining non-identifying history.
- Finance receives aggregate, read-only campaign/outcome oversight without applicant contacts, documents or mutation forms. Campus Leads and representatives receive scoped workflows without vendor-wide selection authority.
- See the [Phase 18 opportunity ATS runbook](docs/phase18-opportunity-ats-runbook.md) and [implementation scorecard](docs/implementation-scorecard.md).

### Phase 19 institutional programmes, connectors and verified recurrence

- Nine additive campaign types cover grants, bursaries, public service, volunteering, development programmes, public health, innovation challenges, emergency response and civic programmes. Each maps to a distinct independently reviewed outcome; none maps to customer activation or commission.
- Institutional drafts require sponsor/funding/procurement evidence, at least one independently approved partner, enforceable study-level/graduation eligibility, safeguarding, accessibility and audit controls. Campaign creators and governance submitters cannot approve their own evidence.
- Document analysis is a separate consented action after object-storage upload. PDF, PNG, JPEG and WebP up to 10 MiB use a restrictive worker contract for PaddleOCR, Docling and a bounded VLM. Source text is transient; persisted output excludes raw text, candidate scores, rankings, recommendations and selection decisions. Completed evidence requires independent human review and supports withdrawal, deletion, consent withdrawal and retention purge.
- `KF_TALENT_PROCESSOR_MODE=external` selects the real worker; `fixture` is explicitly metadata-only. An unconfigured processor fails closed with `PROCESSOR_NOT_CONFIGURED`. Local platform acceptance exercised real object storage and the metadata-only fixture. A separate direct worker acceptance run subsequently executed real PaddleOCR, Docling and pinned Qwen2-VL extraction against one synthetic transcript; this is not production extraction-quality certification.
- Vendor connectors start from independently approved active promotions. Representatives accept consented handoffs to receive signed first-touch links. Customer mappings retain keyed hashes rather than raw external identifiers. `clicked`, `registered` and `provisioned` are observed funnel events only; verified stages use the canonical signed ingestion, attribution, deal and ledger controls.
- Connector progress webhooks require raw-body HMAC-SHA256, a five-minute timestamp window, vendor/connector ownership and replay idempotency. Confirmed target progress counts only confirmed deals linked to the connector and configured success event. Execution remains `sandbox`; live external account creation remains false.
- Commission rules support 1–12-month renewal intervals and maximum eligible cycles. Initial verified renewals create schedules; due sweeps only move schedules to `awaiting_evidence`. Early, excess, unattributed or otherwise unqualified renewals create no deal. Accepted subsequent renewals preserve the original first-touch representative and `commissionRuleId` and append immutable receipts.
- Finance has aggregate read-only ATS and recurrence oversight and cannot execute recurrence sweeps. The vendor-funded 80/20 split and platform-funded 5% Campus Lead override are unchanged. See the [Phase 19 runbook](docs/phase19-institutional-connectors-recurrence-runbook.md).

## Run locally

Requirements: Node.js 20+ and PostgreSQL 16+.

```bash
npm install
cp .env.example .env # then provide local values, including POSTGRES_URL
npm run db:migrate       # apply the reviewed PostgreSQL schema migration
npm run db:seed
npm run dev
```

Use a separate empty PostgreSQL sandbox database for the supplied verification journey. The migration creates the PostgreSQL baseline; it does not copy or destructively convert the earlier MySQL data. Any historical data migration requires a separate backed-up, reconciled runbook. Never force a schema push over existing financial records.

Open `http://localhost:3000`. The workspace selector provides five seeded identities:

- **Campus Lead:** Ada, with team, recruiting, override and support-triage views.
- **Team rep:** Tobi, with attribution, earnings and owned-support workflows.
- **Vendor partner:** CampusSave, with Rule Studio, escrow, event simulation and support resolution.
- **Operations:** settlement, support escalation, campus rollout/activation, durable jobs, top-decile designation/recalculation, demotion, override monitoring, incident response, privacy workflows and fraud/conduct review.
- **Finance:** financial-core readiness and controls plus the user's own Operations/Finance identity-onboarding journey, without identity-review permission.

The OTP form is also a sandbox adapter and displays its code on screen. Seeded verified status is not live NIN verification.

Useful commands:

```bash
npm run check                  # TypeScript project check
npm test                       # all 128 policy, ATS, Phase 19, innovation, identity, assurance, analytics and security unit tests
npm run build                  # frontend + bundled production server
npm start                      # serve the production build
npx tsx scripts/verify-phase2.ts # financial/support regression
npx tsx scripts/verify-phase3.ts # operational, immutability and concurrency acceptance
npx tsx scripts/verify-phase4.ts # payout retry, recovery and reconciliation acceptance
npx tsx scripts/verify-phase5.ts # throttling, health, cleanup and lead-demote acceptance
npx tsx scripts/verify-phase6.ts # incident detection, dedupe and response acceptance
npx tsx scripts/verify-phase7.ts # DSAR, export, breach and privacy-monitoring acceptance
npx tsx scripts/verify-phase8.ts # velocity, fraud holds, appeals and conduct acceptance
npx tsx scripts/verify-phase9.ts # credential, retry, retention and replay acceptance
npx tsx scripts/verify-phase10.ts # launch review and signed provider-outcome acceptance
npx tsx scripts/verify-phase11.ts # cohort, full-quarter KPI and national evidence acceptance
npx tsx scripts/verify-phase12.ts # case, CRM, training, campaign, integration and growth acceptance
UV_HTTP_TIMEOUT=180 uv pip install --target /tmp/kampusforce-python-deps --no-cache -r data_platform/requirements.txt
PYTHONPATH=/tmp/kampusforce-python-deps python3 data_platform/acceptance.py --output /tmp/kampusforce-data-platform-acceptance
UV_HTTP_TIMEOUT=180 uv pip install --target /tmp/kampusforce-identity-deps --no-cache -r identity_platform/requirements.txt
python3 -m unittest discover -s identity_platform -p "test_*.py" -v # document-worker privacy and bounded-contract tests
npx tsx scripts/record-data-platform-evidence.ts /tmp/kampusforce-data-platform-acceptance/run_manifest.json /tmp/kampusforce-data-platform-acceptance/ray_manifest.json
npx tsx scripts/verify-phase13.ts # analytics, evidence, outbox and partner-rail acceptance
npx tsx scripts/verify-phase14.ts # stakeholder identity, expiry, consent and financial-preservation acceptance
npx tsx scripts/verify-phase15.ts # enrollment, uniqueness, quality, vendor and biometric-assurance acceptance
npx tsx scripts/verify-phase16.ts # promotion orchestration, budget race, attribution and financial-preservation acceptance
npx tsx scripts/verify-phase17.ts # thirty innovation workflows, real object storage and financial-preservation acceptance
npx tsx scripts/verify-phase18.ts # ATS, eight campaign journeys, 1,000-row import, storage and financial-preservation acceptance
npx tsx scripts/verify-phase19.ts # nine institutional journeys, document controls, connectors, recurrence and financial preservation
npx tsx scripts/load-phase9.ts   # signed HTTP load gate; production server required
python scripts/verify-phase9-browser.py # throttled/offline/mobile gate; server required
python scripts/verify-phase10-browser.py # launch/mobile/provider-guard gate; server required
python scripts/verify-phase11-browser.py # rollout-evidence/mobile gate; server required
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase12-browser.py # sales/mobile gate; production server required
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase13-browser.py # architecture/mobile gate; local Delta/Ray evidence required
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase14-browser.py # identity/mobile gate; run the Phase 14 database journey first
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase15-browser.py # assurance/mobile gate; production server required
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase16-browser.py # promotion role/mobile gate; production server required
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase17-browser.py # thirty inspectors, role/mobile and mutation gate; production server required
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase18-browser.py # eleven ATS inspectors, campaign/application mutations, role/mobile and Finance gate
KF_TALENT_PROCESSOR_MODE=fixture npm start # separate terminal: explicit metadata-only document fixture
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python scripts/verify-phase19-browser.py # institutional, document, connector, recurrence, role/mobile gate
npm run db:backup -- backups/sandbox.dump
KF_RECOVERY_DRILL=sandbox npm run db:verify-restore -- backups/sandbox.dump
```

The acceptance scripts create unique sandbox records and are designed to remain repeatable. Use them only against a sandbox database. Phase 17 attachment, Phase 18 applicant-document and Phase 19 document-intelligence acceptance require the platform-injected `KIMI_AGENTGW_BASE_URL`, `KIMI_AGENTGW_API_KEY` and `KIMI_STORAGE_RESOURCE_ID`; they use real reviewed object storage and never substitute a local mock. Phase 19 explicitly tests both fail-closed unconfigured processing and the metadata-only fixture; the separate direct worker run supplies the real OCR/Docling/VLM execution evidence. The browser gate requires Python Playwright with Chromium installed; run `npm run build` and `npm start` first. Backup files and `*.dump` are ignored by Git. The restore drill requires the explicit `KF_RECOVERY_DRILL=sandbox` guard, creates and retains a separate `kf_restore_*` database for inspection, and never drops or restores over the source database. Set `PG_BIN` if PostgreSQL 16 client tools are outside `PATH`.

For non-root/non-Docker sandboxes, PostgreSQL 16.15 was provisioned by downloading PGDG packages through an isolated apt configuration, extracting them with `dpkg-deb -x`, and initializing a separate data directory and loopback port. This is a development/acceptance workaround, not a production database deployment. When ordinary package downloads stall, `uv pip install --target ... --no-cache` with an explicit HTTP timeout provides a faster isolated route; keep the data and identity dependency targets separate to avoid binary-package conflicts.

### Phase 19 verification checkpoint

The final local gates passed TypeScript, ESLint, 25 unit-test files with 128 tests, production build and entry checks, app-shell/manifest/service-worker/liveness/readiness smoke, the complete Phase 19 database/storage journey and both Phase 19 and Phase 18 production-browser journeys. All nine new institutional campaign/outcome types passed independent governance, partner and outcome review with enforced study-level/graduation eligibility. Real object storage, source-hash validation, fail-closed unconfigured processing, metadata-only fixture analysis, bounded persistence, independent human review, withdrawal, deletion, consent withdrawal and retention purges passed. A later complete direct-worker run executed real PaddleOCR 3.7.0, Docling 2.144.0 and pinned Qwen2-VL 2B inference successfully against one synthetic transcript, with exact schema validation, semantic review and independent-human-review flags. This single synthetic run is not accuracy, fairness, malicious-input, scale or production-provider certification. Connector HMAC/timestamp/ownership/replay controls, pseudonymous mappings, signed handoffs, observed-versus-verified economics and confirmed target accounting passed. Recurrence preserved original representatives/rules, rejected early/exhausted renewals, capped cycles and created zero deals or ledger entries from sweeps. Financial snapshots remained deep-equal wherever no qualifying verified activation existed. Browser acceptance completed fourteen Phase 19 mutations and eighteen desktop/mobile feature checks with zero runtime errors, HTTP errors, external requests or page overflow; the Phase 18 regression passed eleven inspectors and 32 checks. Browser testing caught and corrected the partner-state control mismatch and asynchronous document-form reference defect before delivery. `productionReady` remains false.

## End-to-end sandbox exercise

1. As the **Vendor partner**, open Rule Studio, calculate a dry run and type `PUBLISH` to create a new future-deal rule version.
2. As **Team rep** Tobi, create a signed share kit with a customer phone.
3. As the vendor, send a qualifying `funded` event for `savings-01` using that phone.
4. In **Operations**, advance sandbox confirmation windows and run the confirmation sweep. Tobi’s direct commission and Ada’s platform-funded team override accrue separately.
5. Assemble the payout batch, dispatch due attempts and record explicit sandbox outcomes. Inspect the rep, lead, escrow, state and audit records; only successful outcomes mark entitlements paid.
6. Enter a sandbox bank total to record three-way reconciliation, then send a vendor `refund` to exercise direct clawback and lead-override reversal.
7. As Tobi, open a support case for the owned deal. Escalate directly to the vendor or through Ada; resolve as vendor/Ops and submit one-time CSAT as Tobi.
8. In Operations → Campus leads, recalculate eligibility and inspect the resulting tier, revocation, notification and audit records. Check `/api/health/live` and `/api/health/ready` for sandbox health signals.
9. In Operations → Incidents, run a monitoring sweep, review source-linked case facts, acknowledge an open incident and resolve it with a note. Inspect the append-only response history; resolved records stay resolved on later sweeps.
10. In Operations → Privacy, register a hashed DSAR, record sandbox identity verification, start review, download the scoped JSON and record fulfilment. Open a breach assessment, assign an Operations owner and record its decision and closure. No external notification is sent; use the privacy runbook for handling boundaries.
11. Configure a product’s daily activation cap in Rule Studio. Above-cap unique submissions are quarantined and open an Operations fraud case. Release or uphold the case, exercise strike/suspension and representative appeal, and inspect the 24-hour review and immutable history. Conduct decisions do not reverse financial records.
12. In the vendor Webhook reliability panel, inspect retry/dead-letter counts and rotate the credential after confirming the overlap warning. Copy the one-time secret into the sandbox signer before dismissing it. Visit catalog and earnings online, then verify their read-only offline snapshots; no financial or support mutation is queued.

The original seeded fintech rule produces a ₦1,000 vendor commission, ₦800 rep gross and ₦200 platform fee. If that deal belongs to Ada’s team, Ada also accrues a ₦40 override and KampusForce retains ₦160 platform margin. Later published rules change only future deals.

## Sandbox and production boundaries

- SMS/OTP, NIN status, escrow top-up, event simulation, time advancement and bank transfer are **explicit sandbox adapters**.
- No real payment, KYC, tax remittance or regulatory approval is created by this software.
- Raw NIN/BVN must never be persisted. Customer KYC remains in the vendor’s regulated flow.
- PaddleOCR, Docling and VLM controls do not prove liveness or deepfake resistance. Hosted biometric execution is disabled until provider, independent-evaluation, privacy-tokenization, legal/security and explicit-live-authorization gates all pass. Synthetic identity approvals are test fixtures only.
- Customer phone numbers are normalized and salted-hashed for attribution and structured support records; stored webhook payloads redact phone values.
- Durable minute-based jobs cover confirmation, draft expiry, SLA breaches, invite expiry, payout retries, rate-limit cleanup, hourly lead eligibility, five-minute incident monitoring, ingestion retries, 30-day event-payload retention, identity-approval expiry, promotion scheduling/orchestration and a deduplicated 09:00 WAT assembly slot. This is not Redis/BullMQ or external alert delivery.
- Rate limiting uses atomic PostgreSQL fixed windows and hashed local subjects. It is not a distributed edge/WAF control, and production proxy/IP trust still requires review.
- Backup/restore evidence is a local sandbox drill, not offsite storage, point-in-time recovery or high availability. Incident detection uses local records and in-app notifications, not external monitoring, paging or incident-response certification.
- Payout outcomes and reconciliation bank totals are explicit sandbox inputs. They are not signed live-provider callbacks or actual bank statements.
- DSAR identity verification is an Operations-attested sandbox transition, not live identity proofing. Exports are deliberately scoped record metadata, not statutory completeness evidence. Fulfilment does not automatically erase or rectify source records. Breach decisions do not send or verify NDPC/data-subject notification and are not legal review.
- Fraud controls are deterministic activation-velocity rules and human review. Phase 15 enrollment, provider-subject collisions and activation-quality signals likewise require review and are not automatic fraud findings. They are not ML scoring, production AML, identity certification, regulatory reporting or automatic financial reversal. Active/upheld holds stop payout progress; releasing or upholding a case never voids deals or posts ledger entries.
- Synthetic enrollment attestations, provider-subject tokens, vendor samples and biometric evaluations are control fixtures. They do not prove current student status, uniqueness, vendor performance, PAD/injection/deepfake resistance or demographic performance in the real world. Failed vendor audits pause only the audited vendor; later passes do not auto-reactivate it.
- Webhook rotation, durable retries and payload retention run against local PostgreSQL sandbox records. They are not external secrets management, distributed queueing, live-provider certification or proof of production capacity.
- Offline snapshots are read-only browser data on the current device. Private earnings snapshots clear on logout/user change; no offline financial/support mutation is synchronized. Local 3G/CPU and HTTP measurements are not real-device, staging, campus-network or production results.
- Recruiting acceptance opens an identity case but does not itself activate a recruit. Activation requires current approved representative KYC and bank-name match. Seeded/synthetic approvals are workflow evidence—not live identity assurance, real performance or rollout outcomes.
- Rollout system snapshots and synthetic acceptance attestations are control-test data, not real campus or national outcomes. External evidence completion is a register result only; it does not change campus status, certify KPI attainment in the real world or authorize national expansion.
- CRM drafts require human approval and external sharing is only an attestation. Campaigns, promotion recruitment and consented promotion delivery send no external messages; Phase 16 delivery is a recorded sandbox simulation. Vendor-service configuration, tests and synchronization are local sandbox controls, not connected production services. Training is internal and unaccredited; leaderboard rank, recommendations, promotion approval and recruitment are not commission entitlements.
- Phase 18 applicant, assessment, interview, offer, selection and verified-outcome records are synthetic sandbox controls. A verified hire, placement, award, attendance, completion or early-access record is not an institutional or employer outcome and creates no deal, attribution, ledger entry, payout or commission. ATS/HR export is a local CSV handoff with a hash receipt, not external connector execution. The 1,000-row import measurement is local sandbox evidence, not provider or production-capacity certification.
- Phase 19 institutional sponsors, partners, governance evidence and programme outcomes are synthetic control fixtures, not government, university, NGO or international-organization approval. Document fixture results contain metadata only and are not OCR/Docling/VLM extraction. Connector registrations are observed events, not activations; sandbox provisioning never creates a live external account. Recurrence elapsed time is not renewal evidence and cannot create entitlement. Customer KYC remains in the vendor's regulated flow.
- Replace fallback sandbox secrets and disable demo login, event simulation, time advancement and sandbox transfers before production.
- Provider adapters and signed test callbacks are implemented, but no live provider request or real bank outcome has occurred. Launch approvals are evidence attestations; they are not credentials, connectivity, legal/security certification or production authorization by themselves.
- Production requires real provider credentials/connectivity, authenticated provider/bank reconciliation evidence, live KYC, external notifications, edge/distributed abuse controls, secrets management, monitoring, scheduled offsite recovery policy, legal review and compliance evidence.

## Runtime architecture

React 19 + TypeScript + Vite + Tailwind; Hono + tRPC 11 + SuperJSON; Drizzle ORM + PostgreSQL 16 via `pg`; JWT via `jose`; QR via `qrcode`; Vitest.

The runtime now matches the specification’s PostgreSQL 16 persistence requirement, including native enums, timezone-aware timestamps, integer relationships and `bigint` kobo values. A PostgreSQL-backed durable minute scheduler, daily 09:00 WAT payout slot, atomic rate-limit counters and append-only triggers are now implemented. NestJS, Redis/BullMQ and the later polyglot/Kubernetes architecture remain target references, not what this slice claims to run. See [ADR 001](docs/adr/001-phase-1-runtime.md), [ADR 002](docs/adr/002-phase-2-campus-scale.md), [ADR 003](docs/adr/003-postgresql-persistence.md), [ADR 004](docs/adr/004-phase-3-operational-controls.md), [ADR 005](docs/adr/005-phase-4-settlement-reconciliation.md), [ADR 006](docs/adr/006-phase-5-operational-safeguards.md), [ADR 007](docs/adr/007-phase-6-monitoring-incident-response.md) , [ADR 008](docs/adr/008-phase-7-privacy-operations.md), [ADR 009](docs/adr/009-phase-8-fraud-conduct-controls.md) and [ADR 010](docs/adr/010-phase-9-reliability-offline-ingestion.md) and [ADR 011](docs/adr/011-phase-10-integration-launch-readiness.md) and [ADR 012](docs/adr/012-phase-11-rollout-evidence-national-gates.md) and [ADR 013](docs/adr/013-phase-12-case-crm-sales-growth.md).

Key paths:

- `db/schema.ts` and `db/migrations/` — persistence model and additive migrations
- `api/services/` — attribution, events, ingestion retries/credentials, rules, overrides, support, ledger, recruiting, telemetry, jobs, lead eligibility, rate limiting, incidents, privacy, fraud/conduct workflows, notifications, money and security
- `api/routes/webhooks.ts` — signed vendor webhook
- `api/routes/links.ts` — signed public product redirect
- `api/routes/health.ts` — sandbox liveness and database-backed readiness
- `api/routes/providerPayouts.ts` — guarded signed provider callbacks
- `api/services/launchReadiness.ts` — independent launch evidence review and fail-closed cutover guard
- `api/services/rolloutReadiness.ts` and `rolloutPolicy.ts` — campus/full-quarter evidence, independent review and roadmap gates
- `src/components/product/RolloutEvidenceDesk.tsx` — Operations cohort, KPI and national evidence register
- `src/pages/` — rep, Campus Lead, vendor, operations and scorecard interfaces
- `src/components/product/PrivacyDesk.tsx` — Operations DSAR and breach workflows
- `src/components/product/FraudDesk.tsx` and `RepFraudCases.tsx` — Operations review and representative appeal workflows
- `api/assuranceRouter.ts` and `api/services/*Assurance.ts` — enrollment, uniqueness, activation-quality, vendor and biometric-assurance controls
- `src/components/product/EnrollmentPanel.tsx` and `AssuranceDesk.tsx` — representative and Operations/Finance assurance workflows
- `api/services/caseManagement.ts`, `crm.ts`, `training.ts`, `campaigns.ts`, `vendorServices.ts` and `growth.ts` — Phase 12 sales workflows and boundaries
- `api/services/promotions.ts`, `promotionPolicy.ts` and `promotionSignals.ts` — Phase 16 lifecycle, durable triggers, staffing, budget and verified-outcome controls
- `api/services/platformInnovations.ts`, `crmInnovations.ts` and `caseInnovations.ts` — Phase 17 decision support, consent, CRM, case and storage controls
- `api/lib/storage.ts` — server-only platform object-storage SDK; the browser never receives its credential
- `src/pages/Sales.tsx` and `src/components/sales/` — role-scoped case, pipeline, training, campaign, promotion, growth, integration and innovation workspaces
- `api/services/institutionalCampaigns.ts`, `talentDocumentIntelligence.ts`, `vendorConnectors.ts` and `recurrence.ts` — Phase 19 governance, bounded document evidence, signed connector and verified-renewal controls
- `scripts/verify-phase2.ts` through `scripts/verify-phase19.ts` — repeatable database-backed acceptance journeys
- `scripts/load-phase9.ts` and `scripts/verify-phase9-browser.py` — signed HTTP, throttled-onboarding, offline, rotation and mobile acceptance
- `scripts/backup-postgres.ts` and `scripts/verify-postgres-restore.ts` — non-destructive backup and isolated restore drill
- `docs/review-and-research.md` — document, financial, market and regulatory review
- `docs/implementation-scorecard.md` — Phase 19 scores plus preserved Phase 18 through Phase 1 baselines
- `docs/phase19-institutional-connectors-recurrence-runbook.md` — institutional governance, document processing, connector security and recurrence operations
- `docs/phase17-innovation-runbook.md` — thirty innovation controls, storage lifecycle, approval boundaries and acceptance
- `docs/identity-onboarding-runbook.md` — identity triggers, stakeholder workflows, provider gates, privacy and operations
- `docs/promotion-orchestration-runbook.md` — promotion review, event semantics, staffing, budget, consent and operating boundaries
- `docs/sales-case-crm-robustness.md` — ten case innovations, ten CRM innovations, training/growth mapping and remaining gaps

## Verification status

Latest Phase 19 checkpoint: migrations `0000`–`0021` ran on the local PostgreSQL 16 sandbox. Phase 19 service acceptance passed all nine institutional journeys, real object storage and document privacy controls, signed connector/financial ingestion, recurrence evidence and append-only protections. The Phase 18 service regression also passed, including its 1,000-row import and storage lifecycle. Production-browser acceptance passed all four new workstreams, role scopes and Finance read-only oversight, followed by the eleven-inspector Phase 18 browser regression. TypeScript, ESLint, 128 unit tests across 25 files, production build and runtime smoke passed. Browser verification exposed and fixed two real UI defects before the final green run. These are local synthetic sandbox results—not staging, external-provider, live-institution, identity, scale, real-recruitment or production certification.

- PostgreSQL runtime: local user-space PostgreSQL 16.15 on `127.0.0.1:55432`; migrations and repeated seed passed without Docker or root. Local commands override both database URL variables so an external configured database is never selected accidentally.
- Package-download workaround: pinned Delta/Ray and document dependencies installed with `uv` into separate `/tmp` targets. Docling models required an alternate Hugging Face endpoint in this sandbox; production must use reviewed, pre-cached artifacts rather than depending on a public mirror.
- Combined Phase 13–14 production build and bundled-server smoke: passed; database-backed acceptance subsequently ran against the local PostgreSQL server.
- Unit tests: all 102 tests across 21 files passed in the final Phase 15 rerun.
- Live PostgreSQL 16 Phase 2 regression: historical rules, publication, overrides, combined payout, paid reversal, support, CSAT, SLA and redaction passed.
- Live PostgreSQL 16 Phase 3 journey: recruiting security/lifecycle, seeded-campus telemetry, job dedupe, append-only enforcement, concurrent confirmation/publication/payout and in-app notifications passed.
- Live PostgreSQL 16 Phase 4 journey: reservation without settlement, duplicate-assembly suppression, concurrent dispatch, three failed attempts, fallback, Finance recovery, idempotent success, reconciliation and refund-before-settlement hold passed.
- Live PostgreSQL 16 Phase 5 journey: exact concurrent counter sequencing, sensitive-route 429/`Retry-After`, hashed subjects, selective expiry cleanup, health/readiness, eligible-lead retention, row-locked demotion, prior-tier restoration, revocation, notification/audit and historical-override preservation passed.
- Live PostgreSQL 16 Phase 6 journey: all five original signal sources, concurrent detection deduplication, Operations notifications, acknowledgement/resolution, append-only events, resolved-state suppression and five-minute scheduled-slot deduplication passed.
- Live PostgreSQL 16 Phase 7 journey: hash-only DSAR persistence, exact deadlines, identity-gated export, concurrent-transition rejection, scoped evidence sections, sensitive-value exclusion, Operations/Admin owner enforcement, privacy incident severity/deduplication, append-only histories and byte-equivalent financial preservation passed.
- Live PostgreSQL 16 Phase 8 journey: default/custom cap boundaries, duplicate-event exclusion, concurrent cap serialization, case dedupe, post-release case creation, scoped payout blocking, suspension/appeal restoration, concurrent-decision rejection, immutable history, financial preservation and critical overdue monitoring passed.
- Live PostgreSQL 16 Phase 9 journey: credential overlap/expiry, secret-free audit metadata, transient retry recovery, permanent dead letters, concurrent retry resolution, 30-day payload purging, replay preservation and byte-equivalent financial snapshots passed.
- Signed HTTP load acceptance: 100/100 events accepted at 66.96 events/second with p50/p95/p99 latency of 303/615/636 ms at concurrency 25. Local sandbox measurement only; the earlier Phase 9 baseline remains preserved below.
- Phase 9 production-browser acceptance: six-step onboarding completed in 16.7 seconds under 400 ms RTT, 500 Kbps down/up and 4× CPU throttling; offline earnings/catalog reload, disabled mutations, private-snapshot cleanup, one-time credential rotation and 375px layout passed with zero runtime errors.
- Live PostgreSQL 16 Phase 10 journey: 25/24 launch catalog, independent review, self-approval/credential-text rejection, fail-closed provider guards, exact signed outcome settlement, duplicate prevention, mismatch/reversal quarantine and raw-bank-value exclusion passed. No live provider request occurred.
- Phase 10 production-browser acceptance: evidence submission, self-approval rejection, secret-free configuration, `productionReady: false`, sandbox HTTP 403 and 375px layout passed with zero runtime errors.
- Live PostgreSQL 16 Phase 11 journey: system-snapshot ineligibility, real-world attestation, independent and competing review, full month/quarter coverage, latest-evidence supersession, append-only history and byte-equivalent financial preservation passed. Synthetic control evaluations do not represent real campus or national outcomes.
- Phase 11 production-browser acceptance: cohort registration, ineligible snapshots, external submission, self-approval rejection, unchanged campus status, uncertified national launch and 375px layout passed with zero runtime errors.
- Live PostgreSQL 16 Phase 12 journey: case ownership collision, public/internal collaboration, snooze/wake, reopen history, links/watchers/views, CRM activity/tasks/drafts, verified-won gating, training, independent campaign review, integration boundaries, leaderboard/targeting and consent-led recruiting passed. Deals and ledger entries remained byte-equivalent.
- Phase 12 production-browser acceptance: Operations, representative, Campus Lead and vendor workflows passed with zero runtime errors. Cases, campaigns, CRM, training and growth each measured exactly 375px document width at a 375px viewport. No external message or live integration request occurred.
- Live PostgreSQL 16 Phase 13 journey: operational analytics, immutable evidence, TigerBeetle outbox controls and fail-closed Mojaloop contracts passed; real Delta/Ray manifests recorded four lineage runs in sandbox-reference mode.
- Phase 13 production-browser acceptance: Operations analytics and separately authorized Finance financial-core controls passed on desktop and mobile with zero browser runtime errors. Operations correctly received HTTP 403 for Finance-only mutations.
- Live PostgreSQL 16 Phase 14 journey: representative, Campus Lead, vendor KYB, Operations/Finance, independent review, expiry/reverification, consent withdrawal, tombstones, financial preservation and concurrency controls passed.
- Phase 14 production-browser acceptance: Operations, Finance, representative, vendor and Campus Lead workflows passed at desktop/375px with zero runtime errors and zero external requests. Finance could submit and withdraw its own case but was not offered synthetic processing or self-approval.
- Live PostgreSQL 16 Phase 15 journey: independent enrollment review, duplicate-pending/self-review rejection, activation gating, expiry/revalidation/revocation, duplicate-subject linked holds, warning/high-risk quality behavior, early-refund and confirmed-only repeated-customer detection, vendor-scoped pause/credential revocation, exact biometric-evaluation coverage/expiry, opaque-reference non-persistence, append-only events and byte-equivalent financial preservation passed.
- Phase 15 production-browser acceptance: representative submission/current-state refresh, Operations enrollment verification, collision clearing, warning-only quality review, passing vendor reconciliation and sandbox biometric-evidence registration passed. Finance oversight was read-only. Desktop and 375px layouts had no page-level overflow, runtime/HTTP errors or external requests; the desktop Operations tab overflow was fixed while retaining mobile internal scrolling.
- Phase 15 defect corrections: failed vendor audits no longer risk revoking another vendor's credentials, and early-refund analysis uses the relational `vendor_events.deal_id` rather than incompatible customer-hash domains. Pending deals are excluded from repeated-customer analysis. No external institution, identity provider or biometric evaluator was contacted.
- Live PostgreSQL 16 Phase 16 journey: independent review, linked Campus Lead-only recruitment, target-met invitation closure with existing onboarding preserved, first-touch preservation, a concurrent final-budget-slot race with one acceptance/one quarantine, escrow-depletion blocking, current-rule-derived 80/20 economics, refund clawback, staffing-risk signaling, inactive-vendor propagation, automatic schedule closure, lifecycle financial preservation, raw-token non-persistence, sandbox-only delivery and read-only Finance passed.
- Phase 16 production-browser acceptance: vendor draft/submission, independent Operations approval/start, all eight triggers, Campus Lead link/QR and consented recruitment, vendor hashed consent and simulated delivery, verified-outcome boundaries and Finance read-only oversight passed. Desktop and 375px layouts had no page-level overflow, browser/runtime errors, HTTP errors or external requests.
- Document-runtime acceptance: PaddleOCR 3.7.0/PaddlePaddle 3.3.1 detected all six synthetic image lines with mean confidence 0.992596; Docling 2.144.0 converted the one-page synthetic PDF and detected its marker. No real identity document, VLM or hosted biometric provider was used.
- Earlier backup/recovery drill: custom-format manifest validation and isolated PostgreSQL 16 restore passed with matching table, migration and trigger counts across the then-current 13 migrations; source records remained unchanged. The retained restore contained 55 users, 35 representatives, 10 products, 125 deals, 58 ledger entries, 540 audit logs and 19 user triggers. This is not relabelled as a Phase 15 restore result.
- Five simultaneous payout batches produced exactly one reservation for the new test rep; two concurrent publishers produced one winner. Duplicate success outcomes did not duplicate ledger postings.
- Cross-vendor support resolution and duplicate CSAT were rejected.
- Browser Rule Studio dry run/publication and role workspaces passed. The full recruiting journey also passed: private public inspection, phone-bound OTP, consent-gated acceptance, separate Operations activation, team assignment and activation notification.
- Recruiting acceptance, campus team, campus rollout, notifications and implementation score passed at 375px without page overflow. Mobile header overlap was fixed, and notification dismissal was verified.
- Phase 4 Operations passed desktop outcome/reconciliation interactions and a 375px check with zero document overflow, console errors or HTTP errors.
- Phase 5 Operations passed desktop and 375px recalculation interactions; Operations and the 84/100 scorecard both measured exactly 375px document width with zero console or HTTP errors.
- Phase 6 Operations passed desktop and 375px monitoring, review, acknowledgement, resolution and repeat-sweep interactions. Resolved records stayed resolved, append-only history and metrics refreshed, and both widths measured exactly their viewport width with zero console or HTTP errors. The 85/100 scorecard also passed at 375px with all 16 workstreams.
- Phase 7 Operations passed DSAR registration, verification, review, JSON download and fulfilment plus breach intake, triage, Operations-owner decision and closure. Desktop and 375px layouts had no document-level overflow, console, page or HTTP errors; wide mobile queues remained contained in horizontal scrollers.
- Phase 8 Operations and representative journeys passed manual case creation, strike uphold, appeal and release with complete history. Desktop and 375px layouts had no document-level overflow, console, page or HTTP errors. The 86/100 scorecard rendered all 16 workstreams.
- The Phase 16 scorecard assesses all 16 workstreams at 93/100 (exact mean 93.375); unfinished external delivery, live-institution/provider operations, real-campus outcomes and target-architecture work remain included in the score. The Phase 16 promotion-orchestration areas score 97/100 (exact mean 96.6667). The preserved Phase 15 baseline was 93/100 (exact mean 93.0625).
- The isolated production bundle passed root, manifest, service-worker, liveness and database-readiness smoke checks without an external `node_modules` directory.
- Production dependency audit: zero known vulnerabilities at assessment time.
- Roadmap metrics such as 55% active recruits, 14.4 activations per active rep/month, 97% confirmed-to-paid within 48 hours, <4% disputes and 136k activated customers remain evidence gates, not achieved real-world results.

The narration MP3 could not be transcribed in the execution environment; no claim of audio-content review is made. All other supplied PDF, workbook and infographic artifacts were reviewed.
