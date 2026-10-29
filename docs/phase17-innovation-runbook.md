# Phase 17 innovation control-plane runbook

Assessment date: 2026-10-29

## Scope and non-negotiable boundaries

Phase 17 adds ten platform, ten CRM and ten case-management innovations. These workflows provide decision support, collaboration and operational controls; they do not create a second commercial system.

- Only vendor-verified activation events can create commission entitlement. Recruitment, CRM forecasts, recommendations, simulations, scores, cases and copilot output never create a deal or posting.
- Existing first-touch attribution, the vendor-funded 80/20 split, platform-funded Campus Lead override, escrow, clawbacks and payout controls remain authoritative.
- External sequence channels produce sandbox receipts only. Provider drills and portability manifests are simulations and hash evidence, not failover or production-provider certification.
- Publication of metrics, purpose policies, controls and knowledge requires independent human review where implemented. Sequences require independent approval and current purpose consent before every step.
- Copilot output is redacted decision support. A person must accept it; no autonomous reply is sent.
- `productionReady` remains false. Live external delivery, autonomous AI decisions and production-provider behavior remain gated.

## Platform innovations

1. **Activation Evidence Graph:** stores SHA-256 evidence hashes, source/kind/time metadata and directed lineage. Cycles are rejected; raw evidence is excluded from workspace payloads.
2. **Promotion Digital Twin:** applies bounded representative, activation, commission, budget, escrow and refund assumptions. Output is a simulation with no live-state or entitlement mutation.
3. **Versioned Metrics and Decision Intelligence:** metric formulas and source contracts are versioned, independently published and snapshotted with reproducible payload hashes.
4. **Universal Consent and Purpose Control Plane:** persists subject-token hashes, purpose policy versions and allow/deny access events. Revocation blocks later sequence steps and service feedback.
5. **Composable Controls Studio:** versioned conditions produce explainable simulation runs. Publication requires independent review; runs do not execute live workflow or financial actions.
6. **Independent Vendor Outcome Network:** independent observations and mismatch reconciliation coexist with the original deal. Reconciliation does not rewrite deal state or ledger history.
7. **Representative Capability Graph and Coaching Copilot:** accountable Campus Leads or Operations assess scoped evidence. Deterministic coaching identifies the weakest capability and requires owner acknowledgement.
8. **Privacy-Preserving Benchmarks:** cohort outputs below the configured minimum of five are suppressed, including identifying numerators and denominators.
9. **Transparent Risk-Adaptive Review and Payout Timing:** assessments explain deterministic factors and record human decisions. They never reschedule a payout or post a hold automatically.
10. **Continuous Resilience and Provider Portability:** secret-bearing configuration is rejected, provider profiles retain configuration hashes, and drills/manifests record simulation-only evidence.

## CRM innovations

1. Relationship 360 combines opportunities, activities, tasks, cases and verified relationship outcomes.
2. Next-best-action recommendations expose reasons and require human review.
3. Versioned scorecards use stable closed-product evidence and explicit weights; applying the same version twice is stable.
4. Commit/best/pipeline scenarios are planning estimates and explicitly report no earned commission or financial deal creation.
5. Sequences require independent approval, current purpose consent at every step and produce sandbox receipts only.
6. Team notes preserve mentions and scoped collaboration history.
7. Duplicate review links candidate records without merging or deleting them.
8. Influence touchpoints record non-financial relationship evidence without changing first-touch attribution or entitlement.
9. Capacity routing proposes and applies relationship ownership with optimistic concurrency; it never changes financial attribution.
10. Voice-of-customer feedback requires current service-feedback consent and persists a subject hash rather than the raw token.

## Case-management innovations

1. Sandbox omnichannel intake deduplicates channel/external-message hashes and enforces case visibility.
2. Routing uses assessed agent skills, active capacity and deterministic priorities.
3. SLA policies validate response/resolution ordering, Africa/Lagos business hours and waiting intervals.
4. Attachments use reviewed platform object storage with plain filenames, canonical base64, MIME/size limits, object keys and request-time URLs.
5. Knowledge articles are redacted, versioned, independently approved and linked to cases with suggestions.
6. Problem and known-error records preserve non-destructive case links and lifecycle evidence.
7. Major-incident command keeps updates internal; no external public communication is sent.
8. Quality reviews prohibit reviewing one's own assigned case and retain independent scores and coaching notes.
9. Post-resolution CSAT/customer-effort surveys are one-time, redacted and aggregated for support analytics.
10. The case copilot redacts sensitive content, isolates staff-only evidence from representatives and requires human acceptance.

## Object-storage operating procedure

Attachments must be uploaded through the application backend. Never expose the platform storage credential to browser code, persist a presigned URL or accept a client-supplied object URL.

The Phase 17 acceptance journey performs the complete lifecycle:

1. Reject representative upload of staff-internal content and reject non-canonical base64.
2. Upload a harmless text attachment through `uploadCaseAttachment` and confirm synchronous review is active.
3. Confirm `fileExists`, `headFile` size and `listFiles` membership independently.
4. Confirm a representative cannot obtain the staff-internal attachment URL.
5. Mint a request-time URL, open it in Chromium and verify the uploaded bytes. If headless navigation yields an empty download, the same Chromium browser request context performs the byte check; empty or mismatched content still fails.
6. Delete through the application and recheck `fileExists === false`.
7. Remove temporary URL metadata and result files without logging the URL.

Allowed types are PNG, JPEG, WebP, PDF, plain text, Markdown and CSV, with a 100 MB maximum. Storage and the published runtime consume owner quota.

## Verification

Run only against a sandbox database with platform storage provisioned:

```bash
npm run db:migrate
npm run db:seed
npx tsx scripts/verify-phase17.ts
npm run build
npm start
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python3 scripts/verify-phase17-browser.py
```

The database journey covers all thirty services, approval and consent boundaries, representative/staff isolation, non-destructive routing, storage deletion, and deep-equal snapshots of deals, attribution, ledger, escrow and payouts. The production-browser journey covers all thirty inspectors at desktop/mobile widths, three browser mutations, role-scoped navigation, Finance read-only behavior, runtime/HTTP/external-request monitoring and page-level overflow.

Local success is sandbox evidence only. It does not certify staging, production storage capacity, external channels, autonomous AI safety, managed failover, real campus outcomes or live financial/identity providers.
