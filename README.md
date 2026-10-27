# KampusForce

Campus commerce, accounted for. KampusForce is a vendor-neutral attribution, commission, escrow and settlement layer connecting vendors, verified student representatives and customers.

This repository contains an executable **Phase 3 operational vertical slice**. It is not production certification, a live financial integration, evidence of a real fifteen-campus rollout, or completion of the NestJS/Redis target architecture.

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
- Installable PWA shell and last-viewed offline catalog; offline financial/support mutations are deliberately not queued.

### Phase 3 operational controls

- Secure one-time recruiting links: only SHA-256 token hashes persist, acceptance requires the exact invited phone and contractor consent, and invitations expire after seven days.
- Separate Campus Lead/Operations revocation and Operations sandbox identity activation, with audited campus-team assignment and no raw NIN/BVN storage.
- Fifteen campus fixtures with record-derived health, active/pending reps, confirmed activations/commission, support load and SLA breaches. Fixture status is not a rollout claim.
- Durable PostgreSQL job runs for confirmation, draft expiry, SLA breaches and invitation expiry. Unique job/slot claims suppress duplicate scheduled passes across app instances.
- Recipient-scoped in-app notifications with read tracking; no SMS or email delivery is implied.
- Database triggers make ledger entries, audit logs, deal state history, support ticket events and consent logs append-only.
- Row-locked confirmation, refund, publication and per-recipient payout transactions. Acceptance tests cover competing sweeps, publishers and payout batches.
- PostgreSQL 16 CI workflow covering type checks, unit tests, build, migration, repeated seed and both database acceptance journeys.

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
- **Operations:** settlement, support escalation, campus rollout/activation, durable jobs, top-decile designation and override monitoring.

The OTP form is also a sandbox adapter and displays its code on screen. Seeded verified status is not live NIN verification.

Useful commands:

```bash
npm run check                  # TypeScript project check
npm test                       # money, security, rule, override and support unit tests
npm run build                  # frontend + bundled production server
npm start                      # serve the production build
npx tsx scripts/verify-phase2.ts # financial/support regression
npx tsx scripts/verify-phase3.ts # operational, immutability and concurrency acceptance
```

The acceptance scripts create unique sandbox records and are designed to remain repeatable. Use them only against a sandbox database.

## End-to-end sandbox exercise

1. As the **Vendor partner**, open Rule Studio, calculate a dry run and type `PUBLISH` to create a new future-deal rule version.
2. As **Team rep** Tobi, create a signed share kit with a customer phone.
3. As the vendor, send a qualifying `funded` event for `savings-01` using that phone.
4. In **Operations**, advance sandbox confirmation windows and run the confirmation sweep. Tobi’s direct commission and Ada’s platform-funded team override accrue separately.
5. Run payout and inspect the rep, lead, escrow, state and audit records.
6. Send a vendor `refund` to exercise direct clawback and lead-override reversal.
7. As Tobi, open a support case for the owned deal. Escalate directly to the vendor or through Ada; resolve as vendor/Ops and submit one-time CSAT as Tobi.

The original seeded fintech rule produces a ₦1,000 vendor commission, ₦800 rep gross and ₦200 platform fee. If that deal belongs to Ada’s team, Ada also accrues a ₦40 override and KampusForce retains ₦160 platform margin. Later published rules change only future deals.

## Sandbox and production boundaries

- SMS/OTP, NIN status, escrow top-up, event simulation, time advancement and bank transfer are **explicit sandbox adapters**.
- No real payment, KYC, tax remittance or regulatory approval is created by this software.
- Raw NIN/BVN must never be persisted. Customer KYC remains in the vendor’s regulated flow.
- Customer phone numbers are normalized and salted-hashed for attribution and structured support records; stored webhook payloads redact phone values.
- Durable minute-based jobs now cover confirmation, draft expiry, SLA breaches and invite expiry. This is not Redis/BullMQ, a 09:00 WAT payout schedule, or external alert delivery.
- Recruiting acceptance does not itself activate a recruit; Operations activation uses a sandbox identity adapter. Seeded Campus Lead status and campus fixtures are workflow evidence—not real performance or rollout outcomes.
- Replace fallback sandbox secrets and disable demo login, event simulation, time advancement and sandbox transfers before production.
- Production requires provider callbacks/reconciliation, live KYC, external notifications, rate limiting, secrets management, monitoring, backup/restore, legal review and compliance evidence.

## Runtime architecture

React 19 + TypeScript + Vite + Tailwind; Hono + tRPC 11 + SuperJSON; Drizzle ORM + PostgreSQL 16 via `pg`; JWT via `jose`; QR via `qrcode`; Vitest.

The runtime now matches the specification’s PostgreSQL 16 persistence requirement, including native enums, timezone-aware timestamps, integer relationships and `bigint` kobo values. A PostgreSQL-backed durable minute scheduler and append-only triggers are now implemented. NestJS, Redis/BullMQ and the later polyglot/Kubernetes architecture remain target references, not what this slice claims to run. See [ADR 001](docs/adr/001-phase-1-runtime.md), [ADR 002](docs/adr/002-phase-2-campus-scale.md), [ADR 003](docs/adr/003-postgresql-persistence.md) and [ADR 004](docs/adr/004-phase-3-operational-controls.md).

Key paths:

- `db/schema.ts` and `db/migrations/` — persistence model and additive migrations
- `api/services/` — attribution, events, rules, overrides, support, ledger, recruiting, telemetry, jobs, notifications, money and security
- `api/routes/webhooks.ts` — signed vendor webhook
- `api/routes/links.ts` — signed public product redirect
- `src/pages/` — rep, Campus Lead, vendor, operations and scorecard interfaces
- `scripts/verify-phase2.ts` and `scripts/verify-phase3.ts` — repeatable database-backed acceptance journeys
- `docs/review-and-research.md` — document, financial, market and regulatory review
- `docs/implementation-scorecard.md` — Phase 3 scores plus preserved Phase 2 and Phase 1 baselines

## Verification status

- TypeScript check: passed.
- Production build and bundled-server smoke: passed.
- Unit tests: 19 passed.
- Live PostgreSQL 16 Phase 2 regression: historical rules, publication, overrides, combined payout, paid reversal, support, CSAT, SLA and redaction passed.
- Live PostgreSQL 16 Phase 3 journey: recruiting security/lifecycle, fifteen-campus telemetry, job dedupe, append-only enforcement, concurrent confirmation/publication/payout and in-app notifications passed.
- Five simultaneous payout batches produced exactly one payout for the new test rep; two concurrent publishers produced one winner.
- Cross-vendor support resolution and duplicate CSAT were rejected.
- Browser Rule Studio dry run/publication and role workspaces passed. The full recruiting journey also passed: private public inspection, phone-bound OTP, consent-gated acceptance, separate Operations activation, team assignment and activation notification.
- Recruiting acceptance, campus team, campus rollout, notifications and implementation score passed at 375px without page overflow. Mobile header overlap was fixed, and notification dismissal was verified.
- The isolated production bundle passed root, manifest, service-worker and API smoke checks without an external `node_modules` directory.
- Production dependency audit: zero known vulnerabilities at assessment time.
- Roadmap metrics such as 55% active recruits, 14.4 activations per active rep/month, 97% confirmed-to-paid within 48 hours, <4% disputes and 136k activated customers remain planning gates, not achieved evidence.

The narration MP3 could not be transcribed in the execution environment; no claim of audio-content review is made. All other supplied PDF, workbook and infographic artifacts were reviewed.
