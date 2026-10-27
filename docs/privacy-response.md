# KampusForce sandbox privacy-operations runbook

## Scope and boundaries

This runbook covers the local Phase 7 DSAR and breach-assessment workflows. It is operational software guidance, not legal advice, regulatory certification, live identity proofing or evidence that any regulator or data subject has been contacted.

Customer KYC remains in vendor flows. Never enter raw NIN/BVN, bank details, credentials, identity documents or customer payloads into request notes, breach summaries or decision notes. Raw NIN/BVN must never be persisted.

## DSAR response procedure

1. In **Operations → Privacy**, register the request type and customer phone. The service normalizes and salted-hashes the phone, stores only the hash on the request and derives a response deadline exactly 30 days after receipt.
2. Review the hashed customer reference and request state. A newly received request has no evidence-export control.
3. Perform the authorized requester-verification procedure outside the sandbox. Record a concise verification note without identity values, then select **Verify requester identity**.
4. Select **Start record review** to enter `in_review`. Export remains available after verification and after fulfilment, but exporting alone does not change the request state.
5. Select **Export privacy-safe JSON** only when authorized. The browser downloads an on-demand evidence package containing only matching salted-hash record metadata:
   - attribution metadata;
   - activation/deal status metadata;
   - support-ticket status metadata;
   - consent metadata.
6. Handle the downloaded file under the organization's access and retention controls. It is not stored in the repository or database by the application, and export history retains counts rather than another copy of the evidence.
7. Record the operational outcome and mark the request fulfilled, or record a rejection rationale where appropriate. Fulfilment does not automatically rectify/erase source records or delete financial, audit or settlement history. Any actual correction or erasure requires a separately reviewed source workflow and applicable retention analysis.

### Export exclusions

The evidence package intentionally excludes raw phone values, NIN/BVN and identity-like values, bank details, access tokens, support subject/description/resolution/CSAT free text, vendor event payloads, token signatures, commissions, payouts and unrelated representative or financial records. It is not a statutory completeness certification.

## Breach-assessment procedure

1. Open an assessment with a short operational title and containment-focused summary. Do not paste customer payloads or secrets. The service derives a triage deadline exactly 72 hours after detection and records that no external notification was sent.
2. Select **Start 72-hour assessment** to accept Operations triage. Overdue reported or assessing records generate critical record-derived incidents.
3. Review the operational evidence and record risk, the notification decision and a decision rationale. Select an Operations/Admin accountable owner; representative and other roles are rejected by the backend.
4. If notification is marked required, the accountable owner must determine and perform any necessary NDPC and data-subject communication outside this system. The application neither sends nor verifies that delivery. `External notification sent: No` remains explicit.
5. Record containment, handoff and remaining external actions in the closure note, then close the assessment. Closing records workflow completion only; it is not legal review, regulator acknowledgement or proof of remediation.

## Overdue signals and incident response

- Open DSARs beyond their response deadline create warning `dsar_sla:{id}` incidents until fulfilled or rejected.
- Reported/assessing breaches beyond their triage deadline create critical `breach_triage:{id}` incidents until a decision is recorded.
- Incident details include references and deadlines, not customer hashes or breach summaries.
- Use **Operations → Incidents** for acknowledgement and resolution. Resolving an incident does not fulfil a DSAR, record a breach decision or repair a source record.

## Audit and verification

Lifecycle transitions use row locks and append audit records. DSAR and breach event histories are append-only at the database layer. Run `npx tsx scripts/verify-phase7.ts` only against a sandbox database to verify deadlines, concurrent-transition rejection, identity-gated exports, sensitive-value exclusion, owner roles, monitoring deduplication, append-only history and preservation of financial records.

Production launch still requires legal/privacy/security review, DPIA and DPO ownership, source-specific retention and erasure procedures, live identity-proofing policy, privileged-access controls, external notification procedures and tested escalation evidence.
