# KampusForce

Campus commerce, accounted for. KampusForce is a vendor-neutral attribution, commission, escrow and settlement layer connecting vendors, verified student representatives and customers.

This repository contains an executable **Phase 1 core MVP vertical slice**, not a claim of production certification or live financial integration.

## Product thesis

- **Goal:** make campus distribution accountable from introduction to payout.
- **Rep problem:** introductions are difficult to prove, commission terms are opaque and earnings arrive unpredictably.
- **Vendor problem:** campus acquisition is fragmented and hard to reconcile against verified activations.
- **Customer problem:** assisted access to useful products must not create markups or expose sensitive KYC data to another intermediary.
- **Opportunity:** one verified-event and settlement rail can serve fintech, airtime/data, devices, edtech and micro-insurance without inventory, terminals or customer float.

Vendor-funded commission is split **80% to the rep / 20% to KampusForce**. Commission is earned on the vendor-verified activation defined by the product rule—not a signup. Escrow is pre-funded; KampusForce never fronts vendor money.

## Implemented slice

- Sandbox OTP and 12-hour JWT sessions; role-gated rep, vendor and operations workspaces.
- Catalog across five product verticals with versioned flat/percentage rules and transparent terms.
- Signed links, QR kits, WhatsApp sharing and first-touch attribution using salted phone hashes.
- Six-step assisted onboarding that records consent and telemetry, never customer NIN/BVN/OTP fields.
- Raw-body HMAC-SHA256 webhooks, five-minute timestamp validation, replay deduplication and quarantine.
- Integer-kobo commission math, escrow reservation, state history and double-entry-style ledger postings.
- Refund voids, paid-deal clawbacks and negative-balance netting against later payouts.
- Payout pre-flight checks for active rep, verified KYC, bank-name match and ₦500 minimum; 10% sandbox withholding.
- Rep disputes, operations decisions and audit history.
- Installable PWA shell and last-viewed offline catalog; offline financial mutations are deliberately not queued.

## Run locally

Requirements: Node.js and a MySQL-compatible database.

```bash
npm install
cp .env.example .env # then provide local values
npm run db:push
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. The workspace selector provides seeded **Student rep**, **Vendor partner** and **Operations** identities. The OTP form is also a sandbox adapter and displays its code on screen.

Useful commands:

```bash
npm run check   # TypeScript project check
npm test        # money and security unit tests
npm run build   # frontend + bundled production server
npm start       # serve the production build
```

## End-to-end sandbox exercise

1. Enter the rep workspace and create a signed share kit with a customer phone.
2. Enter the vendor workspace and send a qualifying `funded` event for `savings-01` using that phone.
3. In Operations, advance sandbox confirmation windows, run the confirmation sweep, then run payout.
4. Inspect the rep ledger, payout, state history and operations audit log.
5. Send a vendor `refund` to exercise reversal and clawback behavior.

The seeded fintech example produces a ₦1,000 vendor commission, ₦800 rep gross, ₦200 platform fee, ₦80 sandbox withholding and ₦720 net payout.

## Sandbox and production boundaries

- SMS/OTP, NIN status, escrow top-up, event simulation, time advancement and bank transfer are **explicit sandbox adapters**.
- No real payment, KYC, tax remittance or regulatory approval is created by this software.
- Seeded verified KYC status is not a live NIN verification.
- Raw NIN/BVN must never be persisted. Customer KYC remains in the vendor’s regulated flow.
- Customer phone numbers are normalized and salted-hashed for attribution; stored webhook payloads redact phone values.
- Replace fallback sandbox secrets and disable demo login, event simulation and time advancement before production.
- Production requires provider callbacks/reconciliation, scheduled jobs, rate limiting, append-only database enforcement, secrets management, monitoring, legal review and compliance evidence.

## Runtime architecture

React 19 + TypeScript + Vite + Tailwind; Hono + tRPC 11 + SuperJSON; Drizzle ORM + MySQL; JWT via `jose`; QR via `qrcode`; Vitest.

The source specification’s NestJS/PostgreSQL and later polyglot/Kubernetes architecture is a target reference, not what this slice claims to run. See [ADR 001](docs/adr/001-phase-1-runtime.md).

Key paths:

- `db/schema.ts` — persistence model and inferred types
- `api/services/` — attribution, event, ledger, money, security and session logic
- `api/routes/webhooks.ts` — signed vendor webhook
- `api/routes/links.ts` — signed public product redirect
- `src/pages/` — rep, vendor, operations and scorecard interfaces
- `docs/review-and-research.md` — document, financial, market and regulatory review
- `docs/implementation-scorecard.md` — per-workstream scores and production gaps

## Verification status

- TypeScript check: passed.
- Production build: passed.
- Unit tests: 10 passed.
- Live end-to-end API exercise: attribution → activation → confirmation → payout → clawback → negative-balance netting → dispute resolution passed.
- Raw HMAC webhook accepted; identical replay returned duplicate; invalid signature returned 401.
- Desktop route and 375px mobile overflow/console checks: passed.

The narration MP3 could not be transcribed in the execution environment; no claim of audio-content review is made. All other supplied PDF, workbook and infographic artifacts were reviewed.
