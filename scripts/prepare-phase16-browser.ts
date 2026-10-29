import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { products, reps, users, vendorServiceConnections, vendors } from "../db/schema";
import { getDb } from "../api/queries/connection";
import { completeSyntheticEnrollment } from "../api/services/assuranceFixtures";
import { completeSyntheticIdentityWorkflow } from "../api/services/identityFixtures";
import { salesActorForUser } from "../api/services/salesAccess";
import { createVendorService, testVendorService } from "../api/services/vendorServices";

const db = getDb();
const [lead] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
const [vendor] = await db.select().from(vendors).where(eq(vendors.companyName, "CampusSave")).limit(1);
if (!lead || !ops || !vendor?.userId) throw new Error("Phase 16 browser seed fixtures are incomplete");

// Earlier acceptance deliberately proves inactive-vendor propagation. Restore only
// the synthetic browser fixture so this independent journey starts commercially active.
await db.update(vendors).set({ status: "active" }).where(eq(vendors.id, vendor.id));
await db.update(products).set({ status: "active" }).where(eq(products.vendorId, vendor.id));
await db.update(reps).set({ tier: "campus_lead", status: "active" }).where(eq(reps.id, lead.id));
for (const caseType of ["campus_lead_kyc", "representative_kyc"] as const) {
  await completeSyntheticIdentityWorkflow({
    caseType,
    subjectType: "user",
    subjectId: lead.userId,
    requestUserId: lead.userId,
    reviewerUserId: ops.id,
    campusId: lead.campusId,
    triggerEvent: "phase16.browser_fixture",
  });
}
await completeSyntheticEnrollment({ userId: lead.userId, reviewerUserId: ops.id });
const [vendorUser] = await db.select().from(users).where(eq(users.id, vendor.userId)).limit(1);
const actor = await salesActorForUser(vendorUser);
const [existing] = await db.select().from(vendorServiceConnections).where(and(
  eq(vendorServiceConnections.vendorId, vendor.id),
  eq(vendorServiceConnections.service, "messaging"),
  eq(vendorServiceConnections.mode, "sandbox"),
)).limit(1);
const connectionId = existing?.id || (await createVendorService({
  actor,
  vendorId: vendor.id,
  service: "messaging",
  displayName: "Phase 16 browser sandbox messaging",
  mode: "sandbox",
})).connectionId;
if (!existing || existing.state !== "verified") await testVendorService({ actor, connectionId });

console.log(JSON.stringify({
  status: "passed",
  campusLeadEnrollment: "current_synthetic_control_fixture",
  sandboxMessaging: "verified",
  externalProviderRequestMade: false,
  institutionOutcomeVerified: false,
}));
process.exit(0);
