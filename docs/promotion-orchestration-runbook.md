# Vendor promotion and recruitment orchestration runbook

Assessment date: 2026-10-29

## Scope and commercial boundary

Phase 16 connects a vendor's customer-facing promotion brief to controlled internal representative recruitment. It coordinates readiness and acquisition; it does not create a second commission engine. A promotion approval, click, invitation, accepted recruit or staffing milestone never creates a commission entitlement. Only the existing vendor-verified activation and confirmation path can create economics under the product's published rule.

The normal 80% activating-representative / 20% platform split, platform-funded 5% Campus Lead override, first-touch attribution, prepaid escrow, fraud/enrollment/identity checks, payout controls and refund clawbacks remain authoritative. External-channel delivery is sandbox-simulated only. No live messaging, real customer outcome, payment, KYC/KYB decision or production readiness is inferred.

## Roles

- **Vendor:** create and submit a promotion brief for its own active product; inspect staffing, budget and verified-outcome reporting; create hashed consent records and request simulated delivery.
- **Operations / Admin:** independently review briefs, approve/reject, start/pause/end promotions, configure triggers, inspect durable receipts and respond to budget or staffing risk. A vendor cannot approve its own brief.
- **Campus Lead:** for an assigned campus, create signed acquisition links and consented recruitment invitations only while the parent promotion, child campaign and commercial/assurance controls permit them.
- **Representative:** use signed links within the normal attribution and activation workflow. Recruitment or promotion participation alone creates no earnings.
- **Finance:** read-only promotion, budget and verified-outcome oversight. Finance cannot mutate the promotion lifecycle, triggers, links, invitations, consent or delivery.

## Brief and independent review

1. The vendor selects an active product and campus, supplies a customer-facing landing URL, schedule, budget cap, recruitment target and staffing-risk threshold.
2. Submission moves the brief to independent Operations review. The reviewer must not be the submitting vendor actor.
3. Approval creates or links the controlled child recruitment campaign and notifies accountable Campus Leads. It does not start acquisition before the approved schedule.
4. Starting activates only pre-approved recruitment and acquisition controls. Current vendor and product status are rechecked; either being inactive prevents acquisition.
5. Pause, end, target-met and budget-exhaustion states close only their intended acquisition paths. Historical onboarding, earned payouts, ledger entries and orchestration receipts remain intact.

## Durable event semantics

| Event | Required control action | Financial boundary |
|---|---|---|
| `promotion.approved` | Create/link the controlled recruitment campaign and notify accountable Campus Leads | No commission |
| `promotion.started` | Activate pre-approved representative recruitment | No commission |
| `recruitment.target_at_risk` | Request additional recruiting or assignment attention | No commission |
| `recruitment.target_met` | Stop further invitations while preserving existing onboarding | No commission |
| `promotion.paused` | Pause recruitment and new acquisition | Preserve earned history |
| `promotion.budget_exhausted` | Stop new activation submissions and notify Operations | Preserve existing deal/payout states |
| `promotion.ended` | Close acquisition | Preserve earned payouts and history |
| `activation.confirmed` | Refresh vendor-verified promotion reporting | Use normal commission economics unchanged |

Each trigger rule can be enabled or disabled independently. Durable orchestration records deduplicate event delivery and retain processing/retry receipts. Disabling a trigger disables that automation, not the underlying financial, identity or authorization control. The `promotion_orchestration` durable job runs the schedule sweep once per minute through the existing PostgreSQL worker; this is not Redis/BullMQ or an external scheduler.

## Recruitment and assurance gates

Before issuing an invitation, the service rechecks the parent/child windows, target state, active vendor/product, campus scope and the Campus Lead's current tier, identity approval, enrollment validity and fraud clearance. Invitations use the lead's assigned campus and require consent. `recruitment.target_met` blocks new invitations but does not cancel an already accepted recruit's ordinary onboarding.

Recruitment activation still requires the existing representative KYC, bank-name match, current enrollment, duplicate-identity clearance and fraud controls. A Campus Lead's promotion access does not bypass Operations activation or payout preflight. Synthetic identity or enrollment approvals remain test fixtures.

## Signed acquisition links and attribution

Signed links contain promotion, representative, product and vendor identifiers plus expiry. They contain no customer data. Only token hashes persist; raw tokens must not appear in ordinary records, retries, analytics or logs. Invalid, expired, paused, ended or commercially inactive links fail closed with a generic response.

A promotion link cannot reassign an existing first-touch attribution record. A competing promotion never steals the original representative's entitlement. Retry records retain a promotion-link identifier rather than the raw signed token and re-resolve current eligibility before ingestion.

## Budget and escrow operations

The promotion budget commitment includes open promotion deals in `pending`, `confirmed`, `payable`, `paid` and `disputed` states. New submissions must fit both the remaining promotion budget and uncommitted vendor escrow. Confirmed commitments are not subtracted twice: escrow was already debited by the normal confirmation path.

Vendor-level ingestion serialization and a locked promotion row protect the final budget slot. Under a race for one remaining slot, one submission may proceed and the other is quarantined; operators must not force the quarantined submission into a deal. Budget exhaustion blocks new activation submissions and notifies Operations without rewriting existing deals or payouts.

Promotion reporting counts vendor-verified outcomes only. Clicks, invitations, recruited representatives and pending submissions are not verified customer outcomes. Current published commission rules determine expected economics; do not use seed-time rule assumptions when validating a later regression journey.

## Consent, suppression and simulated delivery

Consent and suppression records persist keyed hashes and bounded metadata, not raw contact details. Evidence references must be opaque and must not resemble identity numbers. Suppression prevents further consent-dependent delivery requests. Delivery requests are explicitly marked simulated and make no external request.

Production external-channel delivery remains separate work requiring approved providers, credentials, consent-purpose enforcement, template review, delivery callbacks, suppression propagation, retention policy, rate controls, monitoring and legal/security approval.

## Incident and fraud response

- Treat staffing risk and budget exhaustion as operational signals, not fraud findings.
- Existing activation-cap, duplicate-identity and activation-quality holds continue to block representative activation or payout as applicable. Promotion workflows neither clear those holds nor create a separate appeal path.
- Pause acquisition when the vendor or product becomes inactive. The schedule sweep also propagates this state; a later active status does not implicitly rewrite promotion history.
- Assurance and promotion-lifecycle decisions never void deals, alter the 80/20 split or post financial reversals. Refunds and clawbacks continue through signed vendor events and the normal ledger path.
- Never place customer phone numbers, NIN/BVN, bank details, raw signed tokens, credentials or identity evidence in promotion notes, consent evidence or support cases.

## Verification and operating evidence

Run the ordered database journey and production-browser gate only against a sandbox database:

```bash
npx tsx scripts/verify-phase16.ts
npm run build
npm start
KF_BROWSER_BASE_URL=http://127.0.0.1:3000 python3 scripts/verify-phase16-browser.py
```

The executed Phase 16 database acceptance passed independent review, linked Campus Lead-only recruitment, staffing risk, target-met behavior, first-touch preservation, final-slot concurrency, escrow depletion, current-rule 80/20 economics, clawbacks, inactive-vendor propagation, automatic closure, financial-history preservation, raw-token non-persistence, simulated delivery and Finance read-only controls. The production-browser journey passed the vendor, Operations, Campus Lead and Finance workflows at desktop and 375px with no browser/runtime errors, HTTP errors, external requests or page-level overflow.

These are local sandbox results. Staging, live provider/channel integration, production capacity, real campus/customer outcomes and legal/security approval remain open.
