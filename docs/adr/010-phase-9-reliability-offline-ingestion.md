# ADR 010: Phase 9 reliability, offline and ingestion hardening

## Status

Accepted for the local sandbox vertical slice on 2026-10-28. This is not production, provider-capacity, device-lab, regulatory or campus-rollout certification.

## Context

Phase 8 preserved attribution, escrow, settlement, privacy and fraud controls, but ingestion still depended on a single vendor secret, transient failures had no durable recovery path, webhook payloads had no scheduled retention boundary, offline coverage was limited to the last-viewed catalog and no signed HTTP performance gate had been executed.

The specification calls for 50 vendor events/second and assisted onboarding within ten minutes on a 3G profile. These must be measured without presenting local results as staging, production, provider-capacity or real-device evidence.

## Decision

### Versioned credentials and retry recovery

- Store vendor webhook credentials by key version with `active`, `retiring` and `revoked` states.
- Return a newly generated secret only in the successful rotation response. Overview responses and audit metadata contain versions and lifecycle metadata, never the old or new secret.
- Keep the previous credential valid for exactly 15 minutes during rotation. Expired retiring and revoked credentials fail verification.
- Schedule retries only for classified transient database/network failures. Use three processing attempts with one-minute and five-minute backoff; permanent errors and exhausted retries become dead letters.
- Lock retry rows during processing and link recovery to the resulting vendor event. Preserve duplicate-event short-circuiting, HMAC/timestamp checks, activation caps, quarantine and historical rule economics.
- Persist only redacted payloads and salted customer/reference hashes on retry rows.

### Retention and replay preservation

- Give vendor-event payload content a 30-day retention deadline.
- Replace expired content with a purge marker while retaining the event ID, dedupe key, processing status, credential link and financial relationships.
- Run ingestion retry and payload retention through the existing deduplicated PostgreSQL minute worker. This remains PostgreSQL job infrastructure, not Redis/BullMQ.

### Read-only offline behavior and loading performance

- Cache the application shell and same-origin static resources, including resources loaded before first service-worker control.
- Cache route chunks at runtime and load route-level pages through `React.lazy`/`Suspense` to reduce initial browser JavaScript.
- Save earnings snapshots with the signed-in user ID and timestamp. Render them read-only after query failure; clear private snapshots on logout or user change.
- Keep catalog terms available offline, but disable sharing. Hide dispute actions in offline earnings. Do not queue support, sharing, disputes or financial mutations.
- Measure signed HTTP ingestion and a complete six-step browser handoff with repeatable scripts. Keep the measurement boundary in every report.

## Verification

- `scripts/verify-phase9.ts` proves rotation overlap/expiry, secret-free audit metadata, transient recovery, permanent dead letters, concurrent retry resolution, payload purging, replay dedupe and financial preservation.
- `scripts/load-phase9.ts` accepted 100/100 signed HTTP events at 60.63 events/second with p50/p95/p99 latency of 344/775/841 ms at concurrency 25.
- `scripts/verify-phase9-browser.py` completed the six-step journey in 16.7 seconds under 400 ms RTT, 500 Kbps down/up and 4× CPU throttling.
- Offline reload restored earnings and 11 catalog products, exposed no dispute action, disabled all 11 sharing actions and cleared the private snapshot on logout. Vendor rotation disclosed and dismissed a one-time secret without reporting its value. The 375px earnings layout had no page overflow or runtime errors.
- All 41 unit tests, typecheck, lint, repeated seed, Phase 2–9 database journeys, isolated restore, production dependency audit and standalone bundled-server smoke passed.

## Consequences and remaining gates

- Initial JavaScript is approximately 326 kB before gzip instead of the Phase 8 single-page bundle of approximately 573 kB. Route chunks still load on demand and are cached after visiting.
- Offline support is deliberately read-only. It does not create eventual-consistency financial behavior or support background mutation queues.
- The local 50-events/second result does not prove production capacity, provider limits, horizontal scaling or real-campus performance.
- Live credentials, external secret management, distributed queueing/backpressure, device-lab testing, external monitoring/paging, legal/security approval and real campus KPI validation remain Phase 10/11 gates.
