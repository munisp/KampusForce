# ADR 005: Phase 4 settlement lifecycle and reconciliation

- Status: Accepted
- Date: 2026-10-28
- Builds on: ADR 003 and ADR 004

## Context

Through Phase 3, `runPayoutBatch` created an already-paid payout, posted external-bank entries and marked every linked deal/override paid in one transaction. That proved the accounting arithmetic and concurrency control, but it collapsed batch assembly, provider initiation, callback completion and reconciliation into a single sandbox action.

The specification instead requires a daily 09:00 WAT batch, provider attempts with three retries and fallback, provider-webhook completion, failure visibility and three-way reconciliation. Live providers and bank evidence are not available in this environment and must not be simulated as production outcomes.

## Decision

Separate reservation, dispatch, outcome and reconciliation while preserving the existing Hono/tRPC and PostgreSQL runtime.

- Batch assembly locks each recipient and reserves only currently unlinked payable deals and accrued overrides. Links prevent duplicate assembly, but deals remain `payable` and overrides remain `accrued` until success.
- Dispatch locks the payout and creates a durable attempt. Automatic recovery permits three attempts with backoff; the third uses the explicitly labelled Flutterwave sandbox fallback after two Paystack sandbox attempts.
- Sandbox success and failure are explicit Operations inputs, not live callbacks. Success is idempotent and is the only path that posts external-bank/withholding entries or marks entitlements paid.
- Settlement re-locks linked rows and re-checks rep status, KYC/name match, entitlement states and outstanding balances. Changed or refunded entitlements produce a held payout without external-bank postings.
- Exhausted failures remain unchanged for audit. Finance recovery creates a replacement payout and moves only still-valid reservations after another pre-flight check.
- The durable worker dispatches due retries every minute and claims a unique daily `YYYY-MM-DD-09:00-WAT` assembly slot during the 09:00 WAT hour. Africa/Lagos is treated as UTC+01:00 without daylight-saving time.
- Reconciliation compares external-bank ledger credits, successful sandbox attempts and a supplied sandbox bank total. The maximum pairwise difference is the batch variance: zero is matched, non-zero up to ₦1,000 is within tolerance, and anything larger is variance. Reports are append-only.

## Verification

The PostgreSQL 16 Phase 4 acceptance journey verifies:

- assembly writes no settlement entries and a second assembly cannot reserve the same entitlement;
- three concurrent dispatchers create one attempt;
- attempts one and two use Paystack sandbox, attempt three uses Flutterwave sandbox, and all failures leave the deal payable with no payout ledger entries;
- retry exhaustion flags Finance, preserves all three failed attempts and permits replacement recovery;
- successful recovery settles once, and a duplicate success returns an idempotent result without new ledger entries;
- exact reconciliation matches, a ₦1,000.01 difference is flagged, and reconciliation updates are rejected by the database;
- a refund before settlement produces a held payout and no external-bank entries.

Phase 2 paid-refund and Phase 3 concurrency regressions still pass. All 23 unit tests, TypeScript, ESLint, production build and production dependency audit pass. CI includes all three database journeys. Desktop sandbox outcome/reconciliation interactions and a 375px Operations check pass with no document overflow, console errors or HTTP errors.

## Consequences and remaining boundaries

- The payout state machine is more representative of the specification, but its outcomes are still sandbox inputs. No real Paystack/Flutterwave request, signed live callback or bank statement exists.
- Reconciliation evidence is operational test evidence only. Production needs authenticated provider reports and bank statements, access review and investigation workflow ownership.
- The 09:00 WAT slot and retry worker remain PostgreSQL minute-based jobs, not Temporal or Redis/BullMQ parity.
- Live KYC/payment providers, external notifications, monitoring, backup/restore, incident response, legal review and real rollout evidence remain production gates.
