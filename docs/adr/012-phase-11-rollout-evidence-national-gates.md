# ADR 012: Phase 11 rollout evidence and national gates

## Status

Accepted for the local sandbox vertical slice on 2026-10-28. This is not real campus-outcome evidence, a national-launch decision, production certification, legal/security approval or live-provider evidence.

## Context

Phase 10 established independently reviewed launch attestations and guarded provider integration, but campus telemetry still came from fixtures and current sandbox records. Those records cannot establish real cohort performance, full-quarter roadmap attainment or national expansion readiness.

## Decision

### Separate evidence subjects and sources

- Register campus cohorts for one complete calendar month and phase gates for one complete calendar quarter. Cohort, quarter and evidence-event history is append-only.
- Record system snapshots separately from external evidence. Snapshots have `realWorldAttested: false`, remain permanently gate-ineligible and cannot be reviewed into eligibility.
- Require real-world attestations at external submission and independent review. Reject seeded, fixture, sandbox and system-generated evidence references.
- Keep submission and review separate. The submitter cannot review their own evidence; competing reviews have one winner under row locks.

### Latest-evidence and coverage policy

- Evaluate only the latest external submission for each metric. Pending or rejected newer evidence supersedes an earlier approval.
- Require independent approval, the expected unit, a finite value and the required calendar-period coverage. System snapshots never fill missing external evidence.
- Campus gates cover endorsement, 3–5 lead candidates, ≥60 verified reps, ≥30% cohort first activation, ≥100 month-one activations, rep NPS ≥40 and real payout proof.
- Phase gates preserve the roadmap thresholds for active recruits, activations per active rep, CAC, 48-hour payouts, disputes, campuses, cumulative activations and payback. Phase 3 additionally requires 50+ active vendors and real EBITDA evidence.
- Full-quarter evidence is mandatory for every phase-exit metric, including cumulative and point-in-time measures, so a partial-quarter observation cannot satisfy an exit gate.

### No automatic launch claims

- An evidence-complete evaluation is only a register result. It does not mark a campus live, certify a real-world outcome, approve national expansion or alter production/provider controls.
- Synthetic attestations in acceptance scripts test state transitions only and are explicitly excluded from outcome claims.

## Verification

- Eight policy tests and 57 total unit tests cover source ineligibility, exact thresholds, strict disputes, lead-candidate range, period coverage, attestation, supersession, units and later-phase requirements.
- `scripts/verify-phase11.ts` proves snapshot ineligibility, independent review, competing-decision concurrency, partial-period rejection, supersession, append-only enforcement and byte-equivalent financial preservation.
- `scripts/verify-phase11-browser.py` passes cohort registration, snapshot submission, external evidence submission, self-approval rejection and 375px layout with zero runtime errors.
- Ordered Phase 2–11 regressions, isolated ten-migration restore, production dependency audit and standalone bundle smoke pass.

## Consequences and remaining gates

- Operations can now distinguish record-derived telemetry from externally attested rollout evidence without deleting history or weakening financial controls.
- Authentic campus outcomes, external evidence ownership, national expansion approval, real provider/bank evidence, production operations and target-architecture parity remain external or unfinished work.
