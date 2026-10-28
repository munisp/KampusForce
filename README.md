# KampusForce

Campus commerce, accounted for. KampusForce is a vendor-neutral attribution, commission, escrow and settlement layer connecting vendors, verified student representatives and customers.

This repository contains an executable **Phase 11 campus-cohort, KPI-evidence and national rollout-validation vertical slice**. It is not a real campus result, national-launch certification, production or legal-compliance certification, a connected live financial integration, or completion of the NestJS/Redis target architecture.

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

- Sandbox OTP and 12-hour JWT sessions; role-gated rep, vendor and operations workspaces.
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
- Separate Campus Lead/Operations revocation and Operations sandbox identity activation, with audited campus-team assignment and no raw NIN/BVN storage.
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

Open `http://localhost:3000`. The workspace selector provides four seeded identities:

- **Campus Lead:** Ada, with team, recruiting, override and support-triage views.
- **Team rep:** Tobi, with attribution, earnings and owned-support workflows.
- **Vendor partner:** CampusSave, with Rule Studio, escrow, event simulation and support resolution.
- **Operations:** settlement, support escalation, campus rollout/activation, durable jobs, top-decile designation/recalculation, demotion, override monitoring, incident response, privacy workflows and fraud/conduct review.

The OTP form is also a sandbox adapter and displays its code on screen. Seeded verified status is not live NIN verification.

Useful commands:

```bash
npm run check                  # TypeScript project check
npm test                       # all 57 policy and security unit tests
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
npx tsx scripts/load-phase9.ts   # signed HTTP load gate; production server required
python scripts/verify-phase9-browser.py # throttled/offline/mobile gate; server required
python scripts/verify-phase10-browser.py # launch/mobile/provider-guard gate; server required
python scripts/verify-phase11-browser.py # rollout-evidence/mobile gate; server required
npm run db:backup -- backups/sandbox.dump
KF_RECOVERY_DRILL=sandbox npm run db:verify-restore -- backups/sandbox.dump
```

The acceptance scripts create unique sandbox records and are designed to remain repeatable. Use them only against a sandbox database. The browser gate requires Python Playwright with Chromium installed; run `npm run build` and `npm start` first. Backup files and `*.dump` are ignored by Git. The restore drill requires the explicit `KF_RECOVERY_DRILL=sandbox` guard, creates and retains a separate `kf_restore_*` database for inspection, and never drops or restores over the source database. Set `PG_BIN` if PostgreSQL 16 client tools are outside `PATH`.

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
- Customer phone numbers are normalized and salted-hashed for attribution and structured support records; stored webhook payloads redact phone values.
- Durable minute-based jobs cover confirmation, draft expiry, SLA breaches, invite expiry, payout retries, rate-limit cleanup, hourly lead eligibility, five-minute incident monitoring, ingestion retries, 30-day event-payload retention and a deduplicated 09:00 WAT assembly slot. This is not Redis/BullMQ or external alert delivery.
- Rate limiting uses atomic PostgreSQL fixed windows and hashed local subjects. It is not a distributed edge/WAF control, and production proxy/IP trust still requires review.
- Backup/restore evidence is a local sandbox drill, not offsite storage, point-in-time recovery or high availability. Incident detection uses local records and in-app notifications, not external monitoring, paging or incident-response certification.
- Payout outcomes and reconciliation bank totals are explicit sandbox inputs. They are not signed live-provider callbacks or actual bank statements.
- DSAR identity verification is an Operations-attested sandbox transition, not live identity proofing. Exports are deliberately scoped record metadata, not statutory completeness evidence. Fulfilment does not automatically erase or rectify source records. Breach decisions do not send or verify NDPC/data-subject notification and are not legal review.
- Fraud controls are deterministic activation-velocity rules and human review. They are not ML scoring, production AML, identity certification, regulatory reporting or automatic financial reversal. Active/upheld holds stop payout progress; releasing or upholding a case never voids deals or posts ledger entries.
- Webhook rotation, durable retries and payload retention run against local PostgreSQL sandbox records. They are not external secrets management, distributed queueing, live-provider certification or proof of production capacity.
- Offline snapshots are read-only browser data on the current device. Private earnings snapshots clear on logout/user change; no offline financial/support mutation is synchronized. Local 3G/CPU and HTTP measurements are not real-device, staging, campus-network or production results.
- Recruiting acceptance does not itself activate a recruit; Operations activation uses a sandbox identity adapter. Seeded Campus Lead status and campus fixtures are workflow evidence—not real performance or rollout outcomes.
- Rollout system snapshots and synthetic acceptance attestations are control-test data, not real campus or national outcomes. External evidence completion is a register result only; it does not change campus status, certify KPI attainment in the real world or authorize national expansion.
- Replace fallback sandbox secrets and disable demo login, event simulation, time advancement and sandbox transfers before production.
- Provider adapters and signed test callbacks are implemented, but no live provider request or real bank outcome has occurred. Launch approvals are evidence attestations; they are not credentials, connectivity, legal/security certification or production authorization by themselves.
- Production requires real provider credentials/connectivity, authenticated provider/bank reconciliation evidence, live KYC, external notifications, edge/distributed abuse controls, secrets management, monitoring, scheduled offsite recovery policy, legal review and compliance evidence.

## Runtime architecture

React 19 + TypeScript + Vite + Tailwind; Hono + tRPC 11 + SuperJSON; Drizzle ORM + PostgreSQL 16 via `pg`; JWT via `jose`; QR via `qrcode`; Vitest.

The runtime now matches the specification’s PostgreSQL 16 persistence requirement, including native enums, timezone-aware timestamps, integer relationships and `bigint` kobo values. A PostgreSQL-backed durable minute scheduler, daily 09:00 WAT payout slot, atomic rate-limit counters and append-only triggers are now implemented. NestJS, Redis/BullMQ and the later polyglot/Kubernetes architecture remain target references, not what this slice claims to run. See [ADR 001](docs/adr/001-phase-1-runtime.md), [ADR 002](docs/adr/002-phase-2-campus-scale.md), [ADR 003](docs/adr/003-postgresql-persistence.md), [ADR 004](docs/adr/004-phase-3-operational-controls.md), [ADR 005](docs/adr/005-phase-4-settlement-reconciliation.md), [ADR 006](docs/adr/006-phase-5-operational-safeguards.md), [ADR 007](docs/adr/007-phase-6-monitoring-incident-response.md) , [ADR 008](docs/adr/008-phase-7-privacy-operations.md), [ADR 009](docs/adr/009-phase-8-fraud-conduct-controls.md) and [ADR 010](docs/adr/010-phase-9-reliability-offline-ingestion.md) and [ADR 011](docs/adr/011-phase-10-integration-launch-readiness.md) and [ADR 012](docs/adr/012-phase-11-rollout-evidence-national-gates.md).

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
- `scripts/verify-phase2.ts` through `scripts/verify-phase11.ts` — repeatable database-backed acceptance journeys
- `scripts/load-phase9.ts` and `scripts/verify-phase9-browser.py` — signed HTTP, throttled-onboarding, offline, rotation and mobile acceptance
- `scripts/backup-postgres.ts` and `scripts/verify-postgres-restore.ts` — non-destructive backup and isolated restore drill
- `docs/review-and-research.md` — document, financial, market and regulatory review
- `docs/implementation-scorecard.md` — Phase 11 scores plus preserved Phase 10 through Phase 1 baselines

## Verification status

- TypeScript check: passed.
- Production build and bundled-server smoke: passed.
- Unit tests: 57 passed.
- Live PostgreSQL 16 Phase 2 regression: historical rules, publication, overrides, combined payout, paid reversal, support, CSAT, SLA and redaction passed.
- Live PostgreSQL 16 Phase 3 journey: recruiting security/lifecycle, seeded-campus telemetry, job dedupe, append-only enforcement, concurrent confirmation/publication/payout and in-app notifications passed.
- Live PostgreSQL 16 Phase 4 journey: reservation without settlement, duplicate-assembly suppression, concurrent dispatch, three failed attempts, fallback, Finance recovery, idempotent success, reconciliation and refund-before-settlement hold passed.
- Live PostgreSQL 16 Phase 5 journey: exact concurrent counter sequencing, sensitive-route 429/`Retry-After`, hashed subjects, selective expiry cleanup, health/readiness, eligible-lead retention, row-locked demotion, prior-tier restoration, revocation, notification/audit and historical-override preservation passed.
- Live PostgreSQL 16 Phase 6 journey: all five original signal sources, concurrent detection deduplication, Operations notifications, acknowledgement/resolution, append-only events, resolved-state suppression and five-minute scheduled-slot deduplication passed.
- Live PostgreSQL 16 Phase 7 journey: hash-only DSAR persistence, exact deadlines, identity-gated export, concurrent-transition rejection, scoped evidence sections, sensitive-value exclusion, Operations/Admin owner enforcement, privacy incident severity/deduplication, append-only histories and byte-equivalent financial preservation passed.
- Live PostgreSQL 16 Phase 8 journey: default/custom cap boundaries, duplicate-event exclusion, concurrent cap serialization, case dedupe, post-release case creation, scoped payout blocking, suspension/appeal restoration, concurrent-decision rejection, immutable history, financial preservation and critical overdue monitoring passed.
- Live PostgreSQL 16 Phase 9 journey: credential overlap/expiry, secret-free audit metadata, transient retry recovery, permanent dead letters, concurrent retry resolution, 30-day payload purging, replay preservation and byte-equivalent financial snapshots passed.
- Signed HTTP load acceptance: 100/100 events accepted at 60.63 events/second with p50/p95/p99 latency of 344/775/841 ms at concurrency 25. Local sandbox measurement only.
- Phase 9 production-browser acceptance: six-step onboarding completed in 16.7 seconds under 400 ms RTT, 500 Kbps down/up and 4× CPU throttling; offline earnings/catalog reload, disabled mutations, private-snapshot cleanup, one-time credential rotation and 375px layout passed with zero runtime errors.
- Live PostgreSQL 16 Phase 10 journey: 25/24 launch catalog, independent review, self-approval/credential-text rejection, fail-closed provider guards, exact signed outcome settlement, duplicate prevention, mismatch/reversal quarantine and raw-bank-value exclusion passed. No live provider request occurred.
- Phase 10 production-browser acceptance: evidence submission, self-approval rejection, secret-free configuration, `productionReady: false`, sandbox HTTP 403 and 375px layout passed with zero runtime errors.
- Live PostgreSQL 16 Phase 11 journey: system-snapshot ineligibility, real-world attestation, independent and competing review, full month/quarter coverage, latest-evidence supersession, append-only history and byte-equivalent financial preservation passed. Synthetic control evaluations do not represent real campus or national outcomes.
- Phase 11 production-browser acceptance: cohort registration, ineligible snapshots, external submission, self-approval rejection, unchanged campus status, uncertified national launch and 375px layout passed with zero runtime errors.
- Backup/recovery drill: custom-format manifest validation and isolated PostgreSQL 16 restore passed with matching table, migration and trigger counts; source counts remained unchanged.
- Five simultaneous payout batches produced exactly one reservation for the new test rep; two concurrent publishers produced one winner. Duplicate success outcomes did not duplicate ledger postings.
- Cross-vendor support resolution and duplicate CSAT were rejected.
- Browser Rule Studio dry run/publication and role workspaces passed. The full recruiting journey also passed: private public inspection, phone-bound OTP, consent-gated acceptance, separate Operations activation, team assignment and activation notification.
- Recruiting acceptance, campus team, campus rollout, notifications and implementation score passed at 375px without page overflow. Mobile header overlap was fixed, and notification dismissal was verified.
- Phase 4 Operations passed desktop outcome/reconciliation interactions and a 375px check with zero document overflow, console errors or HTTP errors.
- Phase 5 Operations passed desktop and 375px recalculation interactions; Operations and the 84/100 scorecard both measured exactly 375px document width with zero console or HTTP errors.
- Phase 6 Operations passed desktop and 375px monitoring, review, acknowledgement, resolution and repeat-sweep interactions. Resolved records stayed resolved, append-only history and metrics refreshed, and both widths measured exactly their viewport width with zero console or HTTP errors. The 85/100 scorecard also passed at 375px with all 16 workstreams.
- Phase 7 Operations passed DSAR registration, verification, review, JSON download and fulfilment plus breach intake, triage, Operations-owner decision and closure. Desktop and 375px layouts had no document-level overflow, console, page or HTTP errors; wide mobile queues remained contained in horizontal scrollers.
- Phase 8 Operations and representative journeys passed manual case creation, strike uphold, appeal and release with complete history. Desktop and 375px layouts had no document-level overflow, console, page or HTTP errors. The 86/100 scorecard rendered all 16 workstreams.
- The Phase 11 scorecard assesses all 16 workstreams at 90/100 (exact mean 90.4375); unfinished real-campus outcomes, live-provider operations and target-architecture work remain included in the score.
- The isolated production bundle passed root, manifest, service-worker, liveness and database-readiness smoke checks without an external `node_modules` directory.
- Production dependency audit: zero known vulnerabilities at assessment time.
- Roadmap metrics such as 55% active recruits, 14.4 activations per active rep/month, 97% confirmed-to-paid within 48 hours, <4% disputes and 136k activated customers remain evidence gates, not achieved real-world results.

The narration MP3 could not be transcribed in the execution environment; no claim of audio-content review is made. All other supplied PDF, workbook and infographic artifacts were reviewed.
