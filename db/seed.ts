import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { campusLeadAssignments, campuses, commissionRules, escrowWallets, products, reps, supportResolutionMacros, users, vendors } from "./schema";
import { getDb } from "../api/queries/connection";

async function main() {
  const db = getDb();
  let [campus] = await db.select().from(campuses).where(eq(campuses.name, "University of Lagos")).limit(1);
  if (!campus) {
    const [{ id }] = await db.insert(campuses).values({ name: "University of Lagos", state: "Lagos", status: "live", launchDate: new Date() }).returning({ id: campuses.id });
    [campus] = await db.select().from(campuses).where(eq(campuses.id, id)).limit(1);
  }
  const userSeeds = [
    { phoneE164: "+2348000000001", name: "Ada Okafor", role: "rep" as const, kycState: "verified" as const, ninToken: "sandbox_nin_token_ada", ninLast4: "0001", bankName: "Sandbox Bank", bankCode: "999", bankAccountLast4: "0001", bankAccountName: "Ada Okafor", bankNameMatch: true },
    { phoneE164: "+2348000000002", name: "CampusSave Partnerships", role: "vendor" as const, kycState: "verified" as const },
    { phoneE164: "+2348000000003", name: "KampusForce Operations", role: "ops" as const, kycState: "verified" as const },
    { phoneE164: "+2348000000004", name: "Tobi Bello", role: "rep" as const, kycState: "verified" as const, ninToken: "sandbox_nin_token_tobi", ninLast4: "0004", bankName: "Sandbox Bank", bankCode: "999", bankAccountLast4: "0004", bankAccountName: "Tobi Bello", bankNameMatch: true },
  ];
  const createdUsers = [];
  for (const seed of userSeeds) {
    let [user] = await db.select().from(users).where(eq(users.phoneE164, seed.phoneE164)).limit(1);
    if (!user) {
      const [{ id }] = await db.insert(users).values(seed).returning({ id: users.id });
      [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    }
    createdUsers.push(user);
  }
  const [repUser, , , teamUser] = createdUsers;
  let [leadRep] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  if (!leadRep) {
    const [{ id }] = await db.insert(reps).values({ userId: repUser.id, campusId: campus.id, code: "KF-UNILAG-0001", tier: "campus_lead", status: "active", contractorAgreementSignedAt: new Date() }).returning({ id: reps.id });
    [leadRep] = await db.select().from(reps).where(eq(reps.id, id)).limit(1);
  } else if (leadRep.tier !== "campus_lead") {
    await db.update(reps).set({ tier: "campus_lead" }).where(eq(reps.id, leadRep.id));
    [leadRep] = await db.select().from(reps).where(eq(reps.id, leadRep.id)).limit(1);
  }
  let [teamRep] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0002")).limit(1);
  if (!teamRep) {
    const [{ id }] = await db.insert(reps).values({ userId: teamUser.id, campusId: campus.id, code: "KF-UNILAG-0002", tier: "silver", status: "active", contractorAgreementSignedAt: new Date() }).returning({ id: reps.id });
    [teamRep] = await db.select().from(reps).where(eq(reps.id, id)).limit(1);
  }
  const [assignment] = await db.select().from(campusLeadAssignments).where(and(eq(campusLeadAssignments.leadRepId, leadRep.id), eq(campusLeadAssignments.repId, teamRep.id))).limit(1);
  if (!assignment) await db.insert(campusLeadAssignments).values({ leadRepId: leadRep.id, repId: teamRep.id, campusId: campus.id });

  const vendorSeeds = [
    { companyName: "CampusSave", webhookKey: "campussave_sandbox", webhookSecret: "sandbox_campussave_hmac_secret", userId: createdUsers[1].id },
    { companyName: "CampusConnect", webhookKey: "campusconnect_sandbox", webhookSecret: "sandbox_campusconnect_hmac_secret" },
    { companyName: "DeviceHub", webhookKey: "devicehub_sandbox", webhookSecret: "sandbox_devicehub_hmac_secret" },
    { companyName: "LearnLoop", webhookKey: "learnloop_sandbox", webhookSecret: "sandbox_learnloop_hmac_secret" },
    { companyName: "CoverCampus", webhookKey: "covercampus_sandbox", webhookSecret: "sandbox_covercampus_hmac_secret" },
  ];
  const vendorIds: number[] = [];
  for (const seed of vendorSeeds) {
    let [vendor] = await db.select().from(vendors).where(eq(vendors.webhookKey, seed.webhookKey)).limit(1);
    if (!vendor) {
      const [{ id }] = await db.insert(vendors).values({ ...seed, status: "active", cacNumber: "SANDBOX", supportSlaHours: 24 }).returning({ id: vendors.id });
      [vendor] = await db.select().from(vendors).where(eq(vendors.id, id)).limit(1);
      await db.insert(escrowWallets).values({ vendorId: id, balanceKobo: 50_000_000, lowBalanceThresholdKobo: 10_000_000 });
    }
    vendorIds.push(vendor.id);
  }

  const productSeeds = [
    { vendorRef: "savings-01", name: "CampusSave funded account", category: "fintech" as const, description: "A regulated partner savings account activated with an initial deposit.", priceKobo: 500000, pitchScript: "Open and fund your account inside CampusSave’s regulated flow. KampusForce never takes your BVN, NIN, or cash.", rule: { basis: "flat" as const, flatAmountKobo: 100000, triggerEvent: "funded" as const } },
    { vendorRef: "data-01", name: "CampusConnect monthly data", category: "airtime_data" as const, description: "Monthly campus data bundle with commission on verified renewals.", priceKobo: 400000, pitchScript: "Choose the same listed price in the vendor flow. Your rep earns on confirmed renewals.", rule: { basis: "pct" as const, pctBps: 500, triggerEvent: "renewal" as const } },
    { vendorRef: "device-01", name: "DeviceHub student accessories", category: "devices" as const, description: "Verified device and accessory purchases with no KampusForce markup.", priceKobo: 6800000, pitchScript: "Compare the listed device, pay the vendor directly, and keep your receipt for support.", rule: { basis: "pct" as const, pctBps: 500, triggerEvent: "first_transaction" as const } },
    { vendorRef: "edtech-01", name: "LearnLoop subscription", category: "edtech" as const, description: "A learning subscription with renewal-based commission.", priceKobo: 200000, pitchScript: "Use the trial first. Subscribe only if the course fits your study goals.", rule: { basis: "pct" as const, pctBps: 1000, triggerEvent: "renewal" as const } },
    { vendorRef: "insurance-01", name: "CoverCampus micro-insurance", category: "micro_insurance" as const, description: "Partner-issued micro-insurance with commission on verified premiums.", priceKobo: 40000, pitchScript: "Read the insurer’s coverage and exclusions. Your rep does not collect premiums.", rule: { basis: "pct" as const, pctBps: 1500, triggerEvent: "renewal" as const } },
  ];
  for (let i = 0; i < productSeeds.length; i += 1) {
    const seed = productSeeds[i];
    let [product] = await db.select().from(products).where(eq(products.vendorRef, seed.vendorRef)).limit(1);
    if (!product) {
      const [{ id }] = await db.insert(products).values({ vendorId: vendorIds[i], vendorRef: seed.vendorRef, name: seed.name, category: seed.category, description: seed.description, priceKobo: seed.priceKobo, landingUrl: `https://example.com/kampusforce/${seed.vendorRef}`, pitchScript: seed.pitchScript, status: "active" }).returning({ id: products.id });
      [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
      await db.insert(commissionRules).values({ productId: id, version: 1, ...seed.rule, recurrenceMonths: seed.rule.triggerEvent === "renewal" ? 12 : 1, confirmDays: 30, clawbackDays: 60 });
    }
  }
  const [campusSave] = await db.select().from(vendors).where(eq(vendors.webhookKey, "campussave_sandbox")).limit(1);
  const [macro] = await db.select().from(supportResolutionMacros).where(and(eq(supportResolutionMacros.vendorId, campusSave.id), eq(supportResolutionMacros.title, "Activation evidence rechecked"))).limit(1);
  if (!macro) await db.insert(supportResolutionMacros).values({ vendorId: campusSave.id, title: "Activation evidence rechecked", body: "We rechecked the signed activation evidence and confirmed the outcome shown in this case. The rep can review the resolution and submit CSAT.", approvedByUserId: createdUsers[1].id });
  console.log("KampusForce sandbox seed complete, including Phase 2 campus team and support fixtures");
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
