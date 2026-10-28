import "dotenv/config";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  campuses,
  deals,
  identityCases,
  identityConsents,
  identityEvidenceMetadata,
  identityLifecycleEvents,
  identityReviews,
  ledgerEntries,
  reps,
  users,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import {
  currentIdentityApproval,
  ensureIdentityCase,
  expireIdentityApprovals,
  getIdentityWorkspace,
  listIdentityLifecycleEvents,
  payoutIdentityPreflight,
  recordIdentityConsent,
  requestIdentityReverification,
  reviewIdentityCase,
  routeIdentityCaseToReview,
  submitIdentityCase,
  withdrawIdentityConsent,
} from "../api/services/identity";
import { completeSyntheticIdentityWorkflow, processSyntheticIdentityCase } from "../api/services/identityFixtures";
import { identityReadiness, identityTriggerCatalog } from "../api/services/identityPolicy";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
const phone = () => `+23496${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`;

async function main() {
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
  assert.ok(ops && campus);
  const [financialBefore, ledgerBefore] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);

  const [applicant] = await db.insert(users).values({ phoneE164: phone(), name: `Phase Fourteen Rep ${suffix.slice(0, 6)}`, role: "rep" }).returning();
  await db.insert(reps).values({ userId: applicant.id, campusId: campus.id, code: `P14-${suffix.slice(0, 9)}`.toUpperCase(), status: "pending", contractorAgreementSignedAt: new Date() });
  const caseInput = { caseType: "representative_kyc" as const, subjectType: "user" as const, subjectId: applicant.id, requestedByUserId: applicant.id, campusId: campus.id, triggerEvent: "recruitment.invitation_accepted" };
  const concurrentOpens = await Promise.all([ensureIdentityCase(caseInput), ensureIdentityCase(caseInput)]);
  assert.equal(concurrentOpens[0].identityCase.id, concurrentOpens[1].identityCase.id);
  assert.equal(concurrentOpens.filter((result) => result.created).length, 1);
  const opened = concurrentOpens[0];
  assert.equal(opened.identityCase.state, "draft");
  await recordIdentityConsent({ caseId: opened.identityCase.id, actorUserId: applicant.id, purpose: "identity_verification" });
  await recordIdentityConsent({ caseId: opened.identityCase.id, actorUserId: applicant.id, purpose: "biometric_liveness" });
  await submitIdentityCase(opened.identityCase.id, applicant.id);
  await assert.rejects(() => routeIdentityCaseToReview(opened.identityCase.id, ops.id), /Required passing evidence/);
  await assert.rejects(() => reviewIdentityCase({ caseId: opened.identityCase.id, actorUserId: ops.id, decision: "approve", reason: "Attempted approval before evidence completion" }), /manual-review/);
  const processed = await processSyntheticIdentityCase(opened.identityCase.id, ops.id);
  assert.equal(processed.synthetic, true);
  assert.equal(processed.providerEvaluationImplied, false);
  const approved = await reviewIdentityCase({ caseId: opened.identityCase.id, actorUserId: ops.id, decision: "approve", reason: "Synthetic evidence complete; independently reviewed for sandbox workflow acceptance." });
  assert.equal(approved.identityCase.state, "approved");
  assert.ok(approved.identityCase.validUntil);
  const [verifiedApplicant] = await db.select().from(users).where(eq(users.id, applicant.id)).limit(1);
  assert.equal(verifiedApplicant.kycState, "verified");
  assert.equal(verifiedApplicant.bankNameMatch, true);
  assert.equal((await payoutIdentityPreflight(applicant.id)).eligible, true);
  assert.ok(await currentIdentityApproval({ subjectType: "user", subjectId: applicant.id, caseTypes: ["representative_kyc"] }));
  await assert.rejects(() => requestIdentityReverification(opened.identityCase.id, applicant.id), /not due/);

  const evidence = await db.select().from(identityEvidenceMetadata).where(eq(identityEvidenceMetadata.caseId, opened.identityCase.id));
  assert.equal(evidence.length, 8);
  assert.ok(evidence.every((item) => item.provider.endsWith("-synthetic") && item.qualityFlags.includes("synthetic_only")));
  assert.ok(evidence.every((item) => !("rawText" in item) && !("biometric" in item) && item.findings.template_stored === false));
  const reviews = await db.select().from(identityReviews).where(eq(identityReviews.caseId, opened.identityCase.id));
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].actorUserId, ops.id);
  await assert.rejects(() => db.update(identityEvidenceMetadata).set({ state: "failed" }).where(eq(identityEvidenceMetadata.id, evidence[0].id)));
  await assert.rejects(() => db.delete(identityReviews).where(eq(identityReviews.id, reviews[0].id)));

  await db.update(identityCases).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(identityCases.id, opened.identityCase.id));
  const expiry = await expireIdentityApprovals();
  assert.ok(expiry.expired >= 1);
  assert.equal((await payoutIdentityPreflight(applicant.id)).eligible, false);
  const [expiredApplicant] = await db.select().from(users).where(eq(users.id, applicant.id)).limit(1);
  assert.equal(expiredApplicant.kycState, "unverified");
  assert.equal(expiredApplicant.bankNameMatch, false);

  const reverification = await requestIdentityReverification(opened.identityCase.id, applicant.id);
  const reverificationReplay = await requestIdentityReverification(opened.identityCase.id, applicant.id);
  assert.equal(reverificationReplay.identityCase.id, reverification.identityCase.id);
  assert.equal(reverificationReplay.created, false);
  const reapproved = await completeSyntheticIdentityWorkflow({ caseType: "representative_kyc", subjectType: "user", subjectId: applicant.id, requestUserId: applicant.id, reviewerUserId: ops.id, campusId: campus.id, triggerEvent: "identity.reverification_requested" });
  assert.equal(reapproved.identityCase.id, reverification.identityCase.id);
  assert.equal((await payoutIdentityPreflight(applicant.id)).eligible, true);
  const withdrawn = await withdrawIdentityConsent(reapproved.identityCase.id, applicant.id);
  assert.equal(withdrawn.lakehouseTombstoneRequired, true);
  assert.equal((await payoutIdentityPreflight(applicant.id)).eligible, false);
  const withdrawnConsents = await db.select().from(identityConsents).where(eq(identityConsents.caseId, reapproved.identityCase.id));
  assert.ok(withdrawnConsents.every((consent) => consent.withdrawnAt));

  const [vendorUser] = await db.insert(users).values({ phoneE164: phone(), name: `Phase Fourteen Vendor ${suffix.slice(0, 6)}`, role: "vendor" }).returning();
  const [vendor] = await db.insert(vendors).values({ userId: vendorUser.id, companyName: `Phase Fourteen Vendor ${suffix.slice(0, 6)}`, webhookKey: `p14_${suffix.slice(0, 12)}`, webhookSecret: "not-a-live-credential", status: "pending" }).returning();
  const vendorApproved = await completeSyntheticIdentityWorkflow({ caseType: "vendor_kyb", subjectType: "vendor", subjectId: vendor.id, requestUserId: vendorUser.id, reviewerUserId: ops.id, vendorId: vendor.id, triggerEvent: "vendor.activation_requested" });
  assert.equal(vendorApproved.identityCase.state, "approved");
  const [activeVendor] = await db.select().from(vendors).where(eq(vendors.id, vendor.id)).limit(1);
  assert.equal(activeVendor.status, "active");
  await withdrawIdentityConsent(vendorApproved.identityCase.id, vendorUser.id);
  const [pausedVendor] = await db.select().from(vendors).where(eq(vendors.id, vendor.id)).limit(1);
  assert.equal(pausedVendor.status, "paused");

  const [reviewerApplicant] = await db.insert(users).values({ phoneE164: phone(), name: `Phase Fourteen Reviewer ${suffix.slice(0, 6)}`, role: "ops" }).returning();
  const operationsCase = await ensureIdentityCase({ caseType: "operations_kyc", subjectType: "user", subjectId: reviewerApplicant.id, requestedByUserId: reviewerApplicant.id, triggerEvent: "operations.access_requested" });
  await recordIdentityConsent({ caseId: operationsCase.identityCase.id, actorUserId: reviewerApplicant.id, purpose: "identity_verification" });
  await recordIdentityConsent({ caseId: operationsCase.identityCase.id, actorUserId: reviewerApplicant.id, purpose: "biometric_liveness" });
  await submitIdentityCase(operationsCase.identityCase.id, reviewerApplicant.id);
  await processSyntheticIdentityCase(operationsCase.identityCase.id, ops.id);
  await assert.rejects(() => reviewIdentityCase({ caseId: operationsCase.identityCase.id, actorUserId: reviewerApplicant.id, decision: "approve", reason: "Attempted self approval must be rejected" }), /Independent review/);
  await reviewIdentityCase({ caseId: operationsCase.identityCase.id, actorUserId: ops.id, decision: "approve", reason: "Independent Operations reviewer completed synthetic access-onboarding acceptance." });

  const [multiCaseApplicant] = await db.insert(users).values({ phoneE164: phone(), name: `Phase Fourteen Multi Approval ${suffix.slice(0, 6)}`, role: "rep" }).returning();
  await db.insert(reps).values({ userId: multiCaseApplicant.id, campusId: campus.id, code: `P14M-${suffix.slice(0, 8)}`.toUpperCase(), status: "pending", contractorAgreementSignedAt: new Date() });
  const representativeApproval = await completeSyntheticIdentityWorkflow({ caseType: "representative_kyc", subjectType: "user", subjectId: multiCaseApplicant.id, requestUserId: multiCaseApplicant.id, reviewerUserId: ops.id, campusId: campus.id });
  const leadApproval = await completeSyntheticIdentityWorkflow({ caseType: "campus_lead_kyc", subjectType: "user", subjectId: multiCaseApplicant.id, requestUserId: multiCaseApplicant.id, reviewerUserId: ops.id, campusId: campus.id });
  await db.update(identityCases).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(identityCases.id, leadApproval.identityCase.id));
  await expireIdentityApprovals();
  assert.equal((await payoutIdentityPreflight(multiCaseApplicant.id)).eligible, true, "A separate current representative approval must survive Campus Lead expiry");
  const [multiCaseUser] = await db.select().from(users).where(eq(users.id, multiCaseApplicant.id)).limit(1);
  assert.equal(multiCaseUser.kycState, "verified");
  assert.equal(multiCaseUser.bankNameMatch, true);
  await db.update(identityCases).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(identityCases.id, representativeApproval.identityCase.id));
  await expireIdentityApprovals();
  assert.equal((await payoutIdentityPreflight(multiCaseApplicant.id)).eligible, false);

  const [browserApplicant] = await db.insert(users).values({ phoneE164: phone(), name: `Phase Fourteen Browser Review ${suffix.slice(0, 6)}`, role: "rep" }).returning();
  await db.insert(reps).values({ userId: browserApplicant.id, campusId: campus.id, code: `P14B-${suffix.slice(0, 8)}`.toUpperCase(), status: "pending", contractorAgreementSignedAt: new Date() });
  const browserReviewCase = await ensureIdentityCase({ caseType: "representative_kyc", subjectType: "user", subjectId: browserApplicant.id, requestedByUserId: browserApplicant.id, campusId: campus.id, triggerEvent: "representative.onboarding_submitted" });
  await recordIdentityConsent({ caseId: browserReviewCase.identityCase.id, actorUserId: browserApplicant.id, purpose: "identity_verification" });
  await recordIdentityConsent({ caseId: browserReviewCase.identityCase.id, actorUserId: browserApplicant.id, purpose: "biometric_liveness" });
  await submitIdentityCase(browserReviewCase.identityCase.id, browserApplicant.id);
  const browserReviewReady = await processSyntheticIdentityCase(browserReviewCase.identityCase.id, ops.id);
  assert.equal(browserReviewReady.state, "manual_review");

  await assert.rejects(() => ensureIdentityCase({ caseType: "customer_handoff", subjectType: "customer_handoff", subjectId: 1, triggerEvent: "customer.vendor_handoff_requested" }), /vendor-regulated/);
  const workspace = await getIdentityWorkspace(ops);
  assert.ok(workspace.cases.length >= 4);
  assert.equal(workspace.boundaries.rawDataStored, false);
  assert.equal(workspace.boundaries.automaticApproval, false);
  assert.equal(workspace.readiness.liveEligible, false);
  assert.ok(identityTriggerCatalog.length >= 14);
  assert.equal(identityReadiness({}).liveEligible, false);
  const events = await listIdentityLifecycleEvents(500);
  const eventText = JSON.stringify(events);
  assert.ok(!eventText.includes(applicant.phoneE164) && !eventText.includes(applicant.name) && !eventText.includes(vendorUser.phoneE164));
  assert.ok(events.every((event) => /^[a-f0-9]{64}$/.test(event.subjectToken)));
  assert.ok(!eventText.includes("nin") && !eventText.includes("bvn") && !eventText.includes("biometric_template"));
  const storedEvents = await db.select().from(identityLifecycleEvents);
  assert.ok(storedEvents.every((event) => Object.keys(event.payload).length <= 24));
  await assert.rejects(() => db.update(identityLifecycleEvents).set({ eventType: "identity.tampered" }).where(eq(identityLifecycleEvents.id, storedEvents[0].id)));
  await assert.rejects(() => db.delete(identityLifecycleEvents).where(eq(identityLifecycleEvents.id, storedEvents[0].id)));

  const [financialAfter, ledgerAfter] = await Promise.all([db.select().from(deals), db.select().from(ledgerEntries)]);
  assert.deepEqual(financialAfter, financialBefore);
  assert.deepEqual(ledgerAfter, ledgerBefore);
  console.log(JSON.stringify({
    status: "passed",
    mode: "local_sandbox_database_acceptance",
    representative: { consentRequired: true, incompleteApprovalBlocked: true, independentReview: true, payoutPreflight: true, expiryBlocksPayout: true, reverification: true, withdrawalRevokes: true },
    vendor: { kybApprovalActivates: true, withdrawalPauses: true },
    operations: { selfApprovalBlocked: true, independentApproval: true },
    customer: { vendorRegulatedHandoffOnly: true, platformKycDecision: false },
    lakehouse: { pseudonymizedEvents: true, rawIdentifiersExcluded: true, consentTombstoneRequired: true },
    financialRecordsUnchanged: true,
    externalProviderRequestMade: false,
    liveProviderVerified: false,
    productionReady: false,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
