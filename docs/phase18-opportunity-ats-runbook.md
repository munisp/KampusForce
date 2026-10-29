# Phase 18 opportunity ATS and campaign runbook

Assessment date: 2026-10-30

## Purpose and boundary

Phase 18 adds the applicant-tracking layer needed for large campus opportunities, including a company seeking 1,000 geology or mathematics students. It also adds eight campaign journeys that were not already covered by customer promotions, internal representative recruitment, CRM sequences, in-app activation campaigns or internal sales academy training.

These workflows are non-financial by design. Applications, documents, assessments, interviews, offers, selection, hiring, placement, awards, attendance, research/learning completion, early access and exports do not create deals, attribution, ledger entries, payouts or commission entitlement. Any future commercial reward must enter through a separately vendor-verified activation and the existing financial controls. First-touch attribution, vendor-funded 80/20 economics, the platform-funded Campus Lead override, escrow, clawbacks and payout rules remain unchanged.

`productionReady` remains false. Synthetic applications and verified outcomes are control fixtures, not real students, institutional decisions, employment or campus outcomes. Local capacity measurements are not ATS-provider or production certification.

## Campaign catalogue

| Type | Journey | Independently verified outcome |
|---|---|---|
| `recruitment` | Application → assessment → interview → offer | `hire` |
| `internship` | Application → assessment → interview → offer | `placement` |
| `scholarship` | Application → screening → award offer | `award` |
| `fellowship` | Application → assessment → selection offer | `fellowship` |
| `campus_event` | Consented registration → selection | `attendance` |
| `research` | Consented response → screening | `research_completion` |
| `training` | Registration → external cohort selection | `learning_completion` |
| `waitlist` | Consented interest → invitation | `early_access` |

The external `training` type is a student-facing cohort, not the existing internal sales academy. `recruitment` is an external employer opportunity, not internal representative recruiting. `waitlist` records verified early access, not a customer activation.

## Roles and separation of duties

- **Vendor:** create and submit campaigns for its own organization, manage applications and selection, upload/review evidence within scope, and inspect its portfolio. A vendor creator cannot independently approve the campaign.
- **Operations/admin:** create campaigns for a specified vendor, independently review and activate campaigns, perform selection controls, score submitted assessments, schedule/score interviews, verify outcomes and enforce retention.
- **Representative/Campus Lead:** see active, paused or closed campaigns targeting their campus. Representatives register consented applicants only at their own campus and see only their own/team-sourced applications. They do not receive vendor-wide selection authority.
- **Finance:** aggregate read-only campaign/outcome oversight. Finance receives no applicant list, contact details, documents, assessment/interview forms, offer tokens or mutation controls.

Campaign and application access is enforced in backend services, not only hidden in the UI. Representative application filtering occurs in PostgreSQL before the display limit, preventing unrelated bulk imports from hiding the representative’s own records.

## Operating procedure

### 1. Draft, review and activate

1. Choose one of the eight campaign types and provide title, summary, eligible courses, schedule and overall target.
2. Add unique `campusId:target` allocations. Their sum must exactly equal the overall target.
3. Submit the draft for independent review. Operations approves or rejects with a note.
4. Operations activates an approved campaign only inside its scheduled window. Pause/close controls stop later participation without deleting history.

### 2. Register applicants

1. Select an active campaign and choose a new or existing applicant profile.
2. Record campus, name, normalized email, optional E.164 phone, course, study level, graduation year, consent version, consent timestamp and retention expiry.
3. Submit only with informed consent. Do not enter NIN, BVN, payment details or customer-KYC data.
4. Applicant profiles are deduplicated by normalized email within a vendor. Existing profiles with conflicting campus/course data require review rather than silent overwrite.

The application pipeline uses optimistic versions and explicit human reasons. Application events are append-only at the database trigger level.

### 3. Manage documents

1. Upload CVs, transcripts, course documents, certificates or other evidence through the application workflow.
2. Allowed content types are PNG, JPEG, WebP, PDF, plain text, Markdown and CSV. Maximum size is 100 MB. Content is reviewed synchronously during upload.
3. Persist only the object key, content hash and review/lifecycle metadata. Never persist an expiring object URL.
4. Open a document through the role-scoped request-time URL endpoint. Finance and unrelated representatives cannot mint URLs.
5. Deletion removes the stored object. Retention purges objects before anonymizing the applicant.

### 4. Assess and interview

1. Create a geology, mathematics, aptitude or custom assessment with bounded question scores.
2. A permitted applicant-side actor submits a response for every question. Submission and scoring are separate actions.
3. Operations or the vendor records an independent rubric score and note.
4. Schedule an interview only for an eligible screening/assessment application. Overlapping interviews for the same interviewer are rejected.
5. Complete technical, communication and teamwork scores plus a recommendation and notes. Recruitment/internship hiring offers require completed interview scorecards.

No external calendar invitation is sent.

### 5. Offers and participant acceptance

For selection campaigns:

1. Move an eligible application to offer and draft title, terms and expiry.
2. Issue the offer. The raw signed acceptance token is returned once and held only in the browser session; only its SHA-256 hash persists.
3. Accept or decline through the token-authenticated public response endpoint. Expired, already answered and replayed tokens are rejected.
4. An accepted signed response moves the application to `accepted`; it does not verify a hire or create commission.

For campus events, research, external training and waitlists, use the direct-participant selection/acceptance path. Do not manufacture an offer-led journey for those campaign types.

### 6. Verify outcomes

1. Record the observer user, observation time and evidence note.
2. A different Operations reviewer independently verifies the outcome.
3. The service locks the campaign row, checks verified target capacity and writes the outcome.
4. The accepted application becomes completed. The response explicitly reports no deal or commission creation.

### 7. Import, export and analytics

- Bulk import accepts 1–1,000 consented rows and a unique `KF-IMPORT-...` reference. Replaying the same reference is idempotent. Row errors and duplicates are reported without silently overwriting profiles.
- Export selects generic ATS, HRIS or report CSV. Cells beginning with spreadsheet formula characters are escaped, quotes are protected, and a SHA-256 receipt records row count and payload hash.
- `externalExecution` remains false. The export is a local handoff; no external ATS/HR connector or delivery is claimed.
- Portfolio totals, pipeline, accepted offers and completion rates use aggregate queries separate from bounded display records.

### 8. Withdrawal and retention

- Consent withdrawal closes open applications and preserves financial state.
- Expired-profile enforcement deletes stored applicant documents, anonymizes contact details and retains non-identifying application history.
- Retention and withdrawal do not rewrite financial, attribution or activation records.

## Verification

Run only against an isolated PostgreSQL sandbox with platform object storage provisioned:

```bash
npm run db:migrate
npm run db:seed
npx tsx scripts/verify-phase18.ts
npm run check
npm run lint
npm test
npm run build
npm start
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python3 scripts/verify-phase18-browser.py
```

The database acceptance covers all eight journeys, full recruitment, independent campaign/assessment/outcome review, interviewer conflicts, signed-token non-persistence and replay rejection, role isolation, Finance PII/document restrictions, immutable history, real storage upload/head/list/browser/delete checks, consent withdrawal, retention, 1,000-row idempotent import, 1,001-row export and deep-equal financial snapshots.

The production-browser acceptance covers ten ATS inspectors at desktop/mobile widths, vendor draft/submission, Operations approval/activation, representative application, Operations screening, Campus Lead scope and Finance aggregate-only oversight. It monitors runtime errors, HTTP errors, external requests and full-page horizontal overflow.

Local success does not certify staging, production storage/capacity, external ATS/HR systems, real recruitment, institutional outcomes, identity assurance, legal compliance or production readiness.
