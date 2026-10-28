import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { consentLogs, deals, identityConsents, identityLifecycleEvents, reps } from "@db/schema";
import { getDb } from "../api/queries/connection";

const output = process.argv[2];
if (!output) throw new Error("Usage: tsx scripts/export-lakehouse-input.ts /secure/output/input.json");

const rows = await getDb().select({ deal: deals, campusId: reps.campusId }).from(deals)
  .innerJoin(reps, eq(deals.repId, reps.id))
  .innerJoin(consentLogs, and(eq(consentLogs.phoneHash, deals.customerPhoneHash), eq(consentLogs.purpose, "Attribution and vendor-assisted onboarding")))
  .orderBy(desc(deals.createdAt)).limit(100_000);

const events = rows.map(({ deal, campusId }) => ({
  event_id: deal.eventId,
  event_type: deal.triggerEvent,
  occurred_at: deal.createdAt.toISOString(),
  campus_id: campusId,
  vendor_id: deal.vendorId,
  rep_id: deal.repId,
  product_id: deal.productId,
  customer_ref_hash: deal.customerPhoneHash,
  consent: true,
  amount_kobo: deal.vendorCommissionKobo,
  rep_commission_kobo: deal.repCommissionKobo,
  platform_fee_kobo: deal.platformFeeKobo,
  status: deal.state,
}));

const identityRows = await getDb().select().from(identityLifecycleEvents).orderBy(identityLifecycleEvents.id).limit(100_000);
const identityConsentRows = await getDb().select().from(identityConsents);
const consentedCases = new Set(identityConsentRows.filter((consent) => !consent.withdrawnAt && consent.purpose === "identity_verification").map((consent) => consent.caseId));
const identityEvents = identityRows.filter((event) => event.caseId && consentedCases.has(event.caseId)).map((event) => ({
  event_id: event.eventId,
  event_type: event.eventType,
  occurred_at: event.occurredAt.toISOString(),
  subject_type: event.subjectType,
  subject_token: event.subjectToken,
  case_type: event.caseType,
  case_state: event.caseState,
  provider_mode: event.providerMode,
  consent: true,
}));
const tokenByCase = new Map(identityRows.filter((event) => event.caseId).map((event) => [event.caseId, event.subjectToken]));
const identityTombstones = [...new Set(identityConsentRows.filter((consent) => consent.withdrawnAt).map((consent) => tokenByCase.get(consent.caseId)).filter((token): token is string => !!token))];

await writeFile(resolve(output), JSON.stringify({ run_ref: `pg_export_${randomUUID()}`, events, tombstones: [], identity_events: identityEvents, identity_tombstones: identityTombstones }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ exported: events.length, identityEventsExported: identityEvents.length, identityTombstones: identityTombstones.length, output: resolve(output), boundary: "Pseudonymized, consent-joined records only; secure the exported file and delete it after the job." }));
process.exit(0);
