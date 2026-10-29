import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  activationRiskCases,
  assuranceEvents,
  attributionRecords,
  biometricEvaluations,
  campusRecruitments,
  campuses,
  deals,
  duplicateIdentityCases,
  enrollmentAttestations,
  fraudHolds,
  identityLinkages,
  ledgerEntries,
  products,
  reps,
  users,
  vendorAssuranceAudits,
  vendorEvents,
  vendorWebhookCredentials,
  vendors,
} from "../db/schema";
import { getDb } from "../api/queries/connection";
import {
  ensureIdentityCase,
  recordIdentityConsent,
  reviewIdentityCase,
  submitIdentityCase,
} from "../api/services/identity";
import { processSyntheticIdentityCase } from "../api/services/identityFixtures";
import { completeSyntheticEnrollment } from "../api/services/assuranceFixtures";
import {
  expireEnrollmentAttestations,
  registerProviderIdentityLinkage,
  reviewDuplicateIdentityCase,
  reviewEnrollmentAttestation,
  studentAssurancePreflight,
  submitEnrollmentAttestation,
} from "../api/services/studentAssurance";
import { activateRecruitment, hashInvitationToken } from "../api/services/recruiting";
import {
  recordActivationQualitySignal,
  reviewActivationQualityCase,
  sweepActivationQuality,
} from "../api/services/activationAssurance";
import { recordVendorAssuranceAudit } from "../api/services/vendorAssurance";
import {
  assertLiveBiometricEvaluationCoverage,
  expireBiometricEvaluations,
  recordBiometricEvaluation,
} from "../api/services/biometricAssurance";
import { ingestVendorEvent } from "../api/services/events";

const db = getDb();
const suffix = crypto.randomUUID().replaceAll("-", "");
const uniquePhone = () => `+23494${String(randomInt(100_000_000)).padStart(8, "0")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const future = (days: number) => new Date(Date.now() + days * 86_400_000);
const rawReferences: string[] = [];
const opaqueReference = (label: string) => {
  const value = `opaque-${label}-${suffix}-${crypto.randomUUID()}`;
  rawReferences.push(value);
  return value;
};

async function makeRep(label: string, campusId: number) {
  const [user] = await db.insert(users).values({
    phoneE164: uniquePhone(),
    name: `Phase 15 ${label} ${suffix.slice(0, 5)}`,
    role: "rep",
  }).returning();
  const [rep] = await db.insert(reps).values({
    userId: user.id,
    campusId,
    code: `P15-${label.slice(0, 3)}-${suffix.slice(0, 4)}${crypto.randomUUID().replaceAll("-", "").slice(0, 4)}`.toUpperCase(),
    status: "pending",
    contractorAgreementSignedAt: new Date(),
  }).returning();
  return { user, rep };
}

async function approveIdentityWithoutEnrollment(userId: number, campusId: number, reviewerUserId: number) {
  const opened = await ensureIdentityCase({
    caseType: "representative_kyc",
    subjectType: "user",
    subjectId: userId,
    requestedByUserId: userId,
    campusId,
    triggerEvent: "phase15.activation_assurance_acceptance",
  });
  await recordIdentityConsent({ caseId: opened.identityCase.id, actorUserId: userId, purpose: "identity_verification" });
  await recordIdentityConsent({ caseId: opened.identityCase.id, actorUserId: userId, purpose: "biometric_liveness" });
  await submitIdentityCase(opened.identityCase.id, userId);
  await processSyntheticIdentityCase(opened.identityCase.id, reviewerUserId);
  return reviewIdentityCase({
    caseId: opened.identityCase.id,
    actorUserId: reviewerUserId,
    decision: "approve",
    reason: "Synthetic identity control fixture only; enrollment remains a separate assurance requirement.",
  });
}

async function makeDeal(input: {
  repId: number;
  productId: number;
  vendorId: number;
  customerKey: string;
  state?: "pending" | "confirmed" | "payable" | "paid";
}) {
  const customerPhoneHash = hash(`customer:${input.customerKey}`);
  let [attribution] = await db.select().from(attributionRecords).where(and(
    eq(attributionRecords.repId, input.repId),
    eq(attributionRecords.productId, input.productId),
    eq(attributionRecords.customerPhoneHash, customerPhoneHash),
  )).limit(1);
  if (!attribution) {
    [attribution] = await db.insert(attributionRecords).values({
      repId: input.repId,
      productId: input.productId,
      vendorId: input.vendorId,
      customerPhoneHash,
      source: "link",
      tokenSig: `phase15-${suffix}-${crypto.randomUUID()}`,
    }).returning();
  }
  const [deal] = await db.insert(deals).values({
    attributionId: attribution.id,
    productId: input.productId,
    vendorId: input.vendorId,
    repId: input.repId,
    customerPhoneHash,
    triggerEvent: "funded",
    eventId: crypto.randomUUID(),
    state: input.state || "confirmed",
    vendorCommissionKobo: 100_000,
    repCommissionKobo: 80_000,
    platformFeeKobo: 20_000,
    confirmAt: new Date(Date.now() - 1000),
  }).returning();
  return deal;
}

async function main() {
  const [ops] = await db.select().from(users).where(eq(users.phoneE164, "+2348000000003")).limit(1);
  const [campus] = await db.select().from(campuses).orderBy(campuses.id).limit(1);
  const [lead] = await db.select().from(reps).where(eq(reps.code, "KF-UNILAG-0001")).limit(1);
  const [product] = await db.select().from(products).where(eq(products.vendorRef, "savings-01")).limit(1);
  assert.ok(ops && campus && lead && product);
  const ledgerBefore = await db.select().from(ledgerEntries);

  // Enrollment is separate from identity approval and gates recruitment activation.
  const activationRep = await makeRep("activation", campus.id);
  await approveIdentityWithoutEnrollment(activationRep.user.id, campus.id, ops.id);
  const [recruitment] = await db.insert(campusRecruitments).values({
    leadRepId: lead.id,
    campusId: campus.id,
    name: activationRep.user.name,
    phoneE164: activationRep.user.phoneE164,
    status: "accepted",
    acceptedUserId: activationRep.user.id,
    acceptedAt: new Date(),
    tokenHash: hashInvitationToken(`phase15-${suffix}`),
    expiresAt: future(1),
  }).returning();
  await assert.rejects(() => activateRecruitment(recruitment.id, ops.id), /enrollment attestation/);
  const enrollmentReference = opaqueReference("enrollment");
  const submitted = await submitEnrollmentAttestation({
    userId: activationRep.user.id,
    providerName: "institution-synthetic",
    providerMode: "sandbox",
    attestationReference: enrollmentReference,
    academicTerm: "sandbox-current-term",
    verificationMethod: "institution_provider",
    requestedValidUntil: future(120),
  });
  await assert.rejects(() => submitEnrollmentAttestation({
    userId: activationRep.user.id,
    providerName: "institution-synthetic",
    providerMode: "sandbox",
    attestationReference: opaqueReference("second-pending"),
    academicTerm: "sandbox-current-term",
    verificationMethod: "institution_provider",
    requestedValidUntil: future(120),
  }), /awaiting independent review/);
  await assert.rejects(() => reviewEnrollmentAttestation({
    caseId: submitted.id,
    actorUserId: activationRep.user.id,
    decision: "verify",
    reason: "Self review must not be accepted",
  }), /Independent/);
  const verified = await reviewEnrollmentAttestation({
    caseId: submitted.id,
    actorUserId: ops.id,
    decision: "verify",
    reason: "Independently reviewed synthetic attestation metadata for sandbox control acceptance.",
  });
  assert.equal(verified.state, "verified");
  assert.equal((await studentAssurancePreflight(activationRep.user.id)).eligible, true);
  const activated = await activateRecruitment(recruitment.id, ops.id);
  assert.equal(activated.status, "activated");

  await db.update(enrollmentAttestations).set({ validUntil: new Date(Date.now() - 1000) }).where(eq(enrollmentAttestations.id, submitted.id));
  const enrollmentExpiry = await expireEnrollmentAttestations();
  assert.ok(enrollmentExpiry.expired >= 1);
  assert.equal((await studentAssurancePreflight(activationRep.user.id)).eligible, false);
  const revalidation = await submitEnrollmentAttestation({
    userId: activationRep.user.id,
    providerName: "institution-synthetic",
    providerMode: "sandbox",
    attestationReference: opaqueReference("revalidation"),
    academicTerm: "sandbox-next-term",
    verificationMethod: "student_record_provider",
    requestedValidUntil: future(90),
  });
  await reviewEnrollmentAttestation({
    caseId: revalidation.id,
    actorUserId: ops.id,
    decision: "verify",
    reason: "Independent synthetic revalidation review for the next academic term.",
  });
  const revoked = await reviewEnrollmentAttestation({
    caseId: revalidation.id,
    actorUserId: ops.id,
    decision: "revoke",
    reason: "Synthetic revocation verifies that current eligibility can be withdrawn.",
  });
  assert.equal(revoked.state, "revoked");
  assert.equal((await studentAssurancePreflight(activationRep.user.id)).eligible, false);

  // Provider-subject collisions hold both representatives, then release or uphold without reversals.
  const firstDuplicateRep = await makeRep("duplicate-a", campus.id);
  const secondDuplicateRep = await makeRep("duplicate-b", campus.id);
  await completeSyntheticEnrollment({ userId: firstDuplicateRep.user.id, reviewerUserId: ops.id });
  await completeSyntheticEnrollment({ userId: secondDuplicateRep.user.id, reviewerUserId: ops.id });
  const collisionToken = opaqueReference("shared-subject");
  const firstLinkage = await registerProviderIdentityLinkage({
    userId: firstDuplicateRep.user.id,
    actorUserId: ops.id,
    providerName: "identity-provider-synthetic",
    providerMode: "sandbox",
    providerSubjectToken: collisionToken,
  });
  assert.equal(firstLinkage.duplicateCase, null);
  const collision = await registerProviderIdentityLinkage({
    userId: secondDuplicateRep.user.id,
    actorUserId: ops.id,
    providerName: "identity-provider-synthetic",
    providerMode: "sandbox",
    providerSubjectToken: collisionToken,
  });
  assert.ok(collision.duplicateCase?.fraudCaseId && collision.duplicateCase.matchedFraudCaseId);
  const duplicateCaseId = collision.duplicateCase.id;
  const collisionHolds = await db.select().from(fraudHolds).where(inArray(fraudHolds.caseId, [collision.duplicateCase.fraudCaseId, collision.duplicateCase.matchedFraudCaseId]));
  assert.equal(collisionHolds.length, 2);
  assert.ok(collisionHolds.every((hold) => hold.state === "active"));
  assert.equal((await studentAssurancePreflight(firstDuplicateRep.user.id)).duplicateReviewOpen, true);
  assert.equal((await studentAssurancePreflight(secondDuplicateRep.user.id)).duplicateReviewOpen, true);
  await assert.rejects(() => reviewDuplicateIdentityCase({
    caseId: duplicateCaseId,
    actorUserId: firstDuplicateRep.user.id,
    decision: "clear",
    reason: "A collision subject cannot clear their own case",
  }), /Subjects cannot review/);
  const clearedCollision = await reviewDuplicateIdentityCase({
    caseId: duplicateCaseId,
    actorUserId: ops.id,
    decision: "clear",
    reason: "Independent synthetic review cleared the collision without a fraud conclusion.",
  });
  assert.equal(clearedCollision.state, "cleared");
  const releasedHolds = await db.select().from(fraudHolds).where(inArray(fraudHolds.caseId, [collision.duplicateCase.fraudCaseId, collision.duplicateCase.matchedFraudCaseId]));
  assert.ok(releasedHolds.every((hold) => hold.state === "released"));
  assert.equal((await studentAssurancePreflight(firstDuplicateRep.user.id)).eligible, true);
  assert.equal((await studentAssurancePreflight(secondDuplicateRep.user.id)).eligible, true);

  const confirmedToken = opaqueReference("confirmed-shared-subject");
  await registerProviderIdentityLinkage({
    userId: firstDuplicateRep.user.id,
    actorUserId: ops.id,
    providerName: "identity-provider-synthetic",
    providerMode: "sandbox",
    providerSubjectToken: confirmedToken,
  });
  const confirmedCollision = await registerProviderIdentityLinkage({
    userId: secondDuplicateRep.user.id,
    actorUserId: ops.id,
    providerName: "identity-provider-synthetic",
    providerMode: "sandbox",
    providerSubjectToken: confirmedToken,
  });
  assert.ok(confirmedCollision.duplicateCase);
  const upheldCollision = await reviewDuplicateIdentityCase({
    caseId: confirmedCollision.duplicateCase.id,
    actorUserId: ops.id,
    decision: "confirm",
    reason: "Independent synthetic review upheld the hold; no earnings were reversed.",
  });
  assert.equal(upheldCollision.state, "confirmed");
  const upheldHolds = await db.select().from(fraudHolds).where(inArray(fraudHolds.caseId, [confirmedCollision.duplicateCase.fraudCaseId!, confirmedCollision.duplicateCase.matchedFraudCaseId!]));
  assert.ok(upheldHolds.every((hold) => hold.state === "upheld"));
  assert.equal((await studentAssurancePreflight(firstDuplicateRep.user.id)).eligible, false);

  // Quality signals: warning-only first, high-risk payout hold second.
  const manualQualityRep = await makeRep("quality-manual", campus.id);
  const warningDeal = await makeDeal({ repId: manualQualityRep.rep.id, productId: product.id, vendorId: product.vendorId, customerKey: `warning-${suffix}` });
  const highDeal = await makeDeal({ repId: manualQualityRep.rep.id, productId: product.id, vendorId: product.vendorId, customerKey: `high-${suffix}` });
  const warning = await recordActivationQualitySignal({
    dealId: warningDeal.id,
    actorUserId: ops.id,
    kind: "dormant_account",
    severity: "warning",
    evidenceReference: opaqueReference("warning-signal"),
  });
  assert.equal(warning.riskCase.fraudCaseId, null);
  assert.equal((await db.select().from(fraudHolds).where(eq(fraudHolds.repId, manualQualityRep.rep.id))).length, 0);
  const high = await recordActivationQualitySignal({
    dealId: highDeal.id,
    actorUserId: ops.id,
    kind: "chargeback",
    severity: "high",
    evidenceReference: opaqueReference("high-signal"),
  });
  assert.ok(high.riskCase.fraudCaseId);
  const [highHold] = await db.select().from(fraudHolds).where(eq(fraudHolds.caseId, high.riskCase.fraudCaseId)).limit(1);
  assert.equal(highHold.state, "active");
  await reviewActivationQualityCase({
    caseId: warning.riskCase.id,
    actorUserId: ops.id,
    decision: "clear",
    reason: "Warning reviewed and cleared without any payout hold or financial reversal.",
  });
  await reviewActivationQualityCase({
    caseId: high.riskCase.id,
    actorUserId: ops.id,
    decision: "clear",
    reason: "High-risk signal independently cleared and its linked payout hold released.",
  });
  const [releasedHighHold] = await db.select().from(fraudHolds).where(eq(fraudHolds.caseId, high.riskCase.fraudCaseId)).limit(1);
  assert.equal(releasedHighHold.state, "released");

  // Deterministic early-refund and repeated-customer detection.
  const sweepRep = await makeRep("quality-sweep", campus.id);
  const repeatedCustomerKey = `repeat-${suffix}`;
  const repeatedDeals = [];
  for (let index = 0; index < 3; index += 1) {
    repeatedDeals.push(await makeDeal({ repId: sweepRep.rep.id, productId: product.id, vendorId: product.vendorId, customerKey: repeatedCustomerKey }));
  }
  const pendingRepeatDeal = await makeDeal({ repId: sweepRep.rep.id, productId: product.id, vendorId: product.vendorId, customerKey: `pending-repeat-${suffix}`, state: "pending" });
  await makeDeal({ repId: sweepRep.rep.id, productId: product.id, vendorId: product.vendorId, customerKey: `pending-repeat-${suffix}`, state: "pending" });
  await makeDeal({ repId: sweepRep.rep.id, productId: product.id, vendorId: product.vendorId, customerKey: `pending-repeat-${suffix}`, state: "pending" });
  const earlyDeal = repeatedDeals[0];
  await db.insert(vendorEvents).values({
    id: crypto.randomUUID(),
    vendorId: product.vendorId,
    type: "refund",
    customerRefHash: hash(`refund-ref-${suffix}`),
    productId: product.id,
    amountKobo: 100_000,
    payloadJson: { syntheticControlFixture: true },
    hmacOk: true,
    receivedAt: new Date(earlyDeal.createdAt.getTime() + 86_400_000),
    dedupeKey: `phase15-refund-${suffix}`,
    status: "processed",
    dealId: earlyDeal.id,
  });
  const sweep = await sweepActivationQuality(ops.id);
  assert.ok(sweep.earlyRefunds >= 1);
  assert.ok(sweep.repeatedCustomers >= 3);
  const earlyRisks = await db.select().from(activationRiskCases).where(and(eq(activationRiskCases.dealId, earlyDeal.id), eq(activationRiskCases.kind, "early_refund")));
  assert.equal(earlyRisks.length, 1);
  assert.equal(earlyRisks[0].severity, "high");
  assert.ok(earlyRisks[0].fraudCaseId);
  const repeatRisks = await db.select().from(activationRiskCases).where(and(inArray(activationRiskCases.dealId, repeatedDeals.map((deal) => deal.id)), eq(activationRiskCases.kind, "repeated_customer")));
  assert.equal(repeatRisks.length, 3);
  assert.ok(repeatRisks.every((risk) => risk.severity === "warning" && risk.signalCount === 3 && risk.fraudCaseId === null));
  assert.equal((await db.select().from(activationRiskCases).where(and(eq(activationRiskCases.dealId, pendingRepeatDeal.id), eq(activationRiskCases.kind, "repeated_customer")))).length, 0);

  const financialDealsBeforeReviews = await db.select().from(deals);

  // Vendor sampling is vendor-scoped; later passes never automatically reactivate.
  const [assuranceVendor] = await db.insert(vendors).values({
    companyName: `Phase 15 Assurance Vendor ${suffix.slice(0, 6)}`,
    webhookKey: `p15a_${suffix.slice(0, 16)}`,
    webhookSecret: "sandbox-only-not-a-live-secret",
    status: "active",
  }).returning();
  const [controlVendor] = await db.insert(vendors).values({
    companyName: `Phase 15 Control Vendor ${suffix.slice(0, 6)}`,
    webhookKey: `p15b_${suffix.slice(0, 16)}`,
    webhookSecret: "sandbox-only-not-a-live-secret",
    status: "active",
  }).returning();
  const vendorCredentials = await db.insert(vendorWebhookCredentials).values([
    { vendorId: assuranceVendor.id, keyVersion: 1, secret: "sandbox-credential-one", state: "active" as const },
    { vendorId: assuranceVendor.id, keyVersion: 2, secret: "sandbox-credential-two", state: "retiring" as const },
    { vendorId: controlVendor.id, keyVersion: 1, secret: "sandbox-control-credential", state: "active" as const },
  ]).returning();
  const passedAudit = await recordVendorAssuranceAudit({
    vendorId: assuranceVendor.id,
    actorUserId: ops.id,
    periodStart: new Date(Date.now() - 30 * 86_400_000),
    periodEnd: new Date(),
    sampleSize: 10,
    verifiedOutcomes: 10,
    mismatches: 0,
    evidenceReference: opaqueReference("vendor-pass"),
    reviewReason: "Synthetic sampled outcomes reconciled completely for control acceptance.",
  });
  assert.equal(passedAudit.audit.state, "passed");
  assert.equal(passedAudit.vendorStatus, "active");
  const failedAudit = await recordVendorAssuranceAudit({
    vendorId: assuranceVendor.id,
    actorUserId: ops.id,
    periodStart: new Date(Date.now() - 30 * 86_400_000),
    periodEnd: new Date(),
    sampleSize: 10,
    verifiedOutcomes: 8,
    mismatches: 1,
    evidenceReference: opaqueReference("vendor-fail"),
    reviewReason: "Synthetic mismatch and unresolved sample require vendor suspension and review.",
  });
  assert.equal(failedAudit.audit.state, "failed");
  assert.equal(failedAudit.vendorStatus, "paused");
  assert.equal(failedAudit.suspendedCredentialIds.length, 2);
  const scopedCredentials = await db.select().from(vendorWebhookCredentials).where(inArray(vendorWebhookCredentials.id, vendorCredentials.map((credential) => credential.id)));
  assert.ok(scopedCredentials.filter((credential) => credential.vendorId === assuranceVendor.id).every((credential) => credential.state === "revoked"));
  assert.equal(scopedCredentials.find((credential) => credential.vendorId === controlVendor.id)?.state, "active");
  assert.equal((await db.select().from(vendors).where(eq(vendors.id, controlVendor.id)).limit(1))[0].status, "active");
  await assert.rejects(() => ingestVendorEvent(assuranceVendor.webhookKey, {
    event_id: crypto.randomUUID(),
    type: "funded",
    occurred_at: new Date().toISOString(),
    customer: { phone: uniquePhone(), customer_ref: `phase15-${suffix}` },
    product_ref: "not-required-for-inactive-vendor-test",
    amount_kobo: 100_000,
  }), /inactive vendor/);
  const laterPass = await recordVendorAssuranceAudit({
    vendorId: assuranceVendor.id,
    actorUserId: ops.id,
    periodStart: new Date(Date.now() - 30 * 86_400_000),
    periodEnd: new Date(),
    sampleSize: 5,
    verifiedOutcomes: 5,
    mismatches: 0,
    evidenceReference: opaqueReference("vendor-later-pass"),
    reviewReason: "Later synthetic pass preserves the explicit reactivation boundary.",
  });
  assert.equal(laterPass.vendorStatus, "paused");
  assert.equal(laterPass.automaticReactivation, false);

  // Exact provider/model evaluation coverage and expiry for live identity approval.
  const biometricRep = await makeRep("biometric", campus.id);
  const biometricCase = await ensureIdentityCase({
    caseType: "representative_kyc",
    subjectType: "user",
    subjectId: biometricRep.user.id,
    requestedByUserId: biometricRep.user.id,
    campusId: campus.id,
    triggerEvent: "phase15.biometric_coverage_acceptance",
  });
  await recordIdentityConsent({ caseId: biometricCase.identityCase.id, actorUserId: biometricRep.user.id, purpose: "identity_verification" });
  await recordIdentityConsent({ caseId: biometricCase.identityCase.id, actorUserId: biometricRep.user.id, purpose: "biometric_liveness" });
  await submitIdentityCase(biometricCase.identityCase.id, biometricRep.user.id);
  await processSyntheticIdentityCase(biometricCase.identityCase.id, ops.id);
  await assert.rejects(() => assertLiveBiometricEvaluationCoverage(biometricCase.identityCase.id), /missing/);
  const evaluationIds: number[] = [];
  for (const item of [
    { providerName: "liveness-synthetic", kind: "pad" as const },
    { providerName: "liveness-synthetic", kind: "injection" as const },
    { providerName: "liveness-synthetic", kind: "demographic" as const },
    { providerName: "deepfake-synthetic", kind: "deepfake" as const },
    { providerName: "deepfake-synthetic", kind: "demographic" as const },
  ]) {
    const evaluation = await recordBiometricEvaluation({
      actorUserId: ops.id,
      providerName: item.providerName,
      providerMode: "live",
      kind: item.kind,
      modelVersion: "synthetic-control-fixture-v1",
      evidenceReference: opaqueReference(`biometric-${item.providerName}-${item.kind}`),
      decision: "approved",
      validUntil: future(90),
      reviewReason: "Synthetic evaluation record exercises exact coverage only; no certification is implied.",
    });
    assert.equal(evaluation.certificationImplied, false);
    evaluationIds.push(evaluation.id);
  }
  assert.deepEqual(await assertLiveBiometricEvaluationCoverage(biometricCase.identityCase.id), { covered: true, evidenceProviders: 2 });
  await db.update(biometricEvaluations).set({ validUntil: new Date(Date.now() - 1000) }).where(inArray(biometricEvaluations.id, evaluationIds));
  const biometricExpiry = await expireBiometricEvaluations();
  assert.ok(biometricExpiry.expired >= evaluationIds.length);
  await assert.rejects(() => assertLiveBiometricEvaluationCoverage(biometricCase.identityCase.id), /missing/);

  // Assurance decisions never rewrite deals or financial history; assurance events are append-only.
  const [financialDealsAfterReviews, ledgerAfter] = await Promise.all([
    db.select().from(deals),
    db.select().from(ledgerEntries),
  ]);
  assert.deepEqual(financialDealsAfterReviews, financialDealsBeforeReviews);
  assert.deepEqual(ledgerAfter, ledgerBefore);
  const [event] = await db.select().from(assuranceEvents).where(and(eq(assuranceEvents.caseType, "enrollment"), eq(assuranceEvents.caseId, submitted.id))).limit(1);
  assert.ok(event);
  await assert.rejects(() => db.update(assuranceEvents).set({ action: "assurance.tampered" }).where(eq(assuranceEvents.id, event.id)));
  await assert.rejects(() => db.delete(assuranceEvents).where(eq(assuranceEvents.id, event.id)));

  const [storedEnrollments, storedLinkages, storedDuplicates, storedRisks, storedAudits, storedBiometrics, storedEvents] = await Promise.all([
    db.select().from(enrollmentAttestations).where(inArray(enrollmentAttestations.id, [submitted.id, revalidation.id])),
    db.select().from(identityLinkages).where(inArray(identityLinkages.userId, [firstDuplicateRep.user.id, secondDuplicateRep.user.id])),
    db.select().from(duplicateIdentityCases).where(inArray(duplicateIdentityCases.id, [duplicateCaseId, confirmedCollision.duplicateCase.id])),
    db.select().from(activationRiskCases).where(inArray(activationRiskCases.id, [warning.riskCase.id, high.riskCase.id, earlyRisks[0].id, ...repeatRisks.map((risk) => risk.id)])),
    db.select().from(vendorAssuranceAudits).where(eq(vendorAssuranceAudits.vendorId, assuranceVendor.id)),
    db.select().from(biometricEvaluations).where(inArray(biometricEvaluations.id, evaluationIds)),
    db.select().from(assuranceEvents),
  ]);
  const persistedAssurance = JSON.stringify({ storedEnrollments, storedLinkages, storedDuplicates, storedRisks, storedAudits, storedBiometrics, storedEvents });
  for (const reference of rawReferences) assert.ok(!persistedAssurance.includes(reference), "Raw provider/evidence references must never be persisted");
  assert.ok(storedEnrollments.every((item) => /^[a-f0-9]{64}$/.test(item.attestationHash)));
  assert.ok(storedLinkages.every((item) => /^[a-f0-9]{64}$/.test(item.tokenHash)));
  assert.ok(storedDuplicates.every((item) => /^[a-f0-9]{64}$/.test(item.linkageTokenHash)));
  assert.ok(storedRisks.every((item) => /^[a-f0-9]{64}$/.test(item.evidenceHash)));
  assert.ok(storedAudits.every((item) => /^[a-f0-9]{64}$/.test(item.evidenceHash)));
  assert.ok(storedBiometrics.every((item) => /^[a-f0-9]{64}$/.test(item.evidenceHash)));

  console.log(JSON.stringify({
    status: "passed",
    mode: "local_sandbox_database_acceptance",
    enrollment: { independentReview: true, duplicateSubmissionBlocked: true, activationBlockedWithoutEnrollment: true, activationAfterReview: true, expiryAndRevalidation: true, revocationBlocksEligibility: true },
    duplicateIdentity: { twoRepresentativeHolds: true, selfReviewBlocked: true, clearReleasesBoth: true, confirmUpholdsBoth: true, collisionProvesFraud: false },
    activationQuality: { warningOnly: true, highRiskPayoutHold: true, reviewReleasesHold: true, earlyRefundDetected: true, repeatedCustomerWarningCount: repeatRisks.length, pendingDealsExcluded: true },
    vendorAssurance: { passPreservesActive: true, failurePausesVendor: true, revokedCredentials: failedAudit.suspendedCredentialIds.length, otherVendorCredentialsUnchanged: true, legacyIngestionBlocked: true, laterPassAutoReactivates: false },
    biometricEvaluation: { exactProviderModelCoverage: true, requiredEvaluationRecords: evaluationIds.length, expiryBlocksCoverage: true, certificationImplied: false },
    privacy: { rawReferencesPersisted: false, keyedHashesOnly: true },
    appendOnlyAssuranceEvents: true,
    financialRecordsUnchangedByAssurance: true,
    externalInstitutionOrProviderRequestMade: false,
    liveBiometricEvaluationPerformed: false,
    productionReady: false,
  }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
