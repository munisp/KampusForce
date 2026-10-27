# KampusForce sandbox fraud and conduct runbook

## Scope

This runbook governs the local Phase 8 activation-velocity control, payout holds, Operations conduct decisions and representative appeals. It is an operating procedure for deterministic sandbox controls—not ML fraud scoring, production AML, legal advice, regulatory reporting, live identity verification or automatic financial reversal.

## Control behavior

- Each published product rule has a daily unique-activation cap from 1 to 1000. The default is 10 per representative per Africa/Lagos calendar day.
- The window runs from 00:00 WAT to the next 00:00 WAT. Duplicate vendor events do not consume another attempt.
- Under the default cap, unique submissions 1–10 may proceed. Submission 11 is quarantined, creates no deal and opens a fraud case with an active payout hold.
- Further over-cap submissions reuse the existing open, upheld or appeal-open case. A new breach after release creates a separate case.
- Automatic evidence contains product/rule/event references, cap, attempt count and day-window metadata. It does not contain raw customer phone values, customer hashes or vendor payloads.

## Roles and boundaries

- **Operations / Admin:** create a manual review case, inspect evidence and history, release a case, or uphold it with no conduct action, a strike or suspension.
- **Representative:** inspect own cases and appeal an upheld case. Appeal does not remove the hold or suspension.
- **Vendor / Finance:** retain existing scoped workflows. Finance recovery remains subject to the representative’s blocking fraud holds.

Never paste raw NIN, BVN, bank details, customer phone numbers, access tokens or unrelated customer evidence into case notes. Customer KYC remains in the vendor’s regulated flow.

## Operations review procedure

1. Open **Operations → Fraud**. Review open cases, overdue reviews and blocking holds. An open or appealed case has a 24-hour review objective; overdue cases also create critical `fraud_review:{id}` incidents.
2. Inspect the source event, cap/attempt evidence, representative status and append-only history. Treat a cap breach as a review signal, not proof of intentional fraud.
3. Add manual intake only when an operational record justifies review. Use the representative selector and a privacy-safe evidence note.
4. Choose one controlled outcome:
   - **Release:** set the case/hold to released. This removes only this case’s payout block.
   - **Uphold / no strike:** keep an upheld payout hold without changing representative status.
   - **Uphold / strike:** record a strike, leave representative status unchanged and keep the hold blocking.
   - **Uphold / suspension:** record the prior status, suspend the representative and keep the hold blocking.
5. Record a specific decision note. Do not use the fraud decision to void a deal, reverse a payment or alter commission. Review responses explicitly report `financialReversalApplied: false`; upheld outcomes identify that separate clawback assessment may be required.
6. Resolve an overdue monitoring incident only after the source review is complete. Resolving an incident does not release a fraud hold.

## Payout and multiple-case rules

Active and upheld holds block:

- new payout batch assembly;
- due-payout dispatch;
- Finance recovery; and
- the final settlement pre-flight before a successful sandbox outcome marks entitlements paid or posts external-bank entries.

Releasing case A does not release case B. Any other active/upheld hold continues to block payout progress. A released hold is non-blocking, but normal rep/KYC/bank/minimum/refund and entitlement checks still apply.

## Appeal and suspension restoration

1. The representative opens the Team workspace, reviews the upheld case and submits an appeal note.
2. The case becomes `appeal_open`; the hold remains `upheld`, any suspension remains active and a fresh 24-hour review objective begins.
3. Operations reviews the appeal and prior history. Upholding keeps the conduct outcome and block. Releasing releases that case’s hold.
4. If the released appeal involved suspension, restore the recorded prior status only when no other upheld suspension remains. Never clear an independent suspension through another case’s release.
5. Confirm the history sequence and audit evidence. The normal sequence is `opened → upheld → appeal_requested → released`.

## Evidence and audit rules

- Case, hold and representative transitions are row-locked. Invalid or competing transitions are rejected rather than overwriting a decision.
- Case events are append-only at the database layer. Every review and appeal also appends audit history.
- Fraud decisions never edit deal economics, ledger entries, payout attempts, escrow balances or reconciliation records.
- Over-cap events remain quarantined. Do not force them into activation or create commissionable deals manually.
- Monitoring and notifications are local records and in-app signals, not external paging or proof of a timely human response.

## Verification

Run `npx tsx scripts/verify-phase8.ts` only against a sandbox database. The journey covers cap boundaries, duplicate exclusion, concurrent serialization, case dedupe, post-release case creation, payout blocking, scoped release, suspension/appeal restoration, concurrent-decision rejection, immutable history, financial preservation and critical overdue monitoring. Run Phase 2–7 first for regression coverage, then the isolated backup/restore drill.

Production launch still requires fraud/conduct policy and legal review, external alert delivery and on-call ownership, live provider/bank evidence, edge and distributed abuse controls, privileged-access review, security testing and measured operating evidence.
