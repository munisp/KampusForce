import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  applicants,
  auditLogs,
  campuses,
  institutionalCampaignGovernance,
  institutionalCampaignPartners,
  talentApplicationDocuments,
  talentDocumentAnalyses,
  talentApplicationEvents,
  talentApplications,
  talentAssessments,
  talentCampaigns,
  talentCampaignTargets,
  talentImportBatches,
  talentIntegrationReceipts,
  talentInterviews,
  talentOffers,
  talentOutcomes,
  users,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { storage } from "../lib/storage";
import { actorRepIds, type SalesActor } from "./salesAccess";
import {
  accessibleTalentApplication,
  accessibleTalentCampaign,
  appendTalentEvent,
  assertTalentOperations,
  assertTalentWritable,
  normalizeApplicantEmail,
  talentCampaignCatalog,
  talentHash,
  talentRef,
  type TalentCampaignType,
} from "./talentAccess";
import { talentCsvCell, talentTargetProblem } from "./talentPolicy";
import { assertInstitutionalApplicantEligibility, assertInstitutionalCampaignSubmittable } from "./institutionalCampaigns";

export type ApplicantProfileInput = {
  campusId: number;
  fullName: string;
  email: string;
  phoneE164?: string;
  course: string;
  studyLevel: string;
  graduationYear: number;
  consentVersion: string;
  consentedAt: Date;
  retentionUntil: Date;
};

function assertCampaignManager(actor: SalesActor) {
  assertTalentWritable(actor);
  if (!["vendor", "ops", "admin"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only the campaign vendor or Operations can manage this workflow" });
}

async function vendorForCampaign(actor: SalesActor, requestedVendorId?: number) {
  if (actor.role === "vendor") {
    if (!actor.vendorId || (requestedVendorId && requestedVendorId !== actor.vendorId)) throw new TRPCError({ code: "FORBIDDEN", message: "Vendor operators can create campaigns only for their own organization" });
    return actor.vendorId;
  }
  if (!["ops", "admin"].includes(actor.role) || !requestedVendorId) throw new TRPCError({ code: "FORBIDDEN", message: "Operations must specify the campaign vendor" });
  const [vendor] = await getDb().select({ id: vendors.id }).from(vendors).where(eq(vendors.id, requestedVendorId)).limit(1);
  if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Campaign vendor not found" });
  return vendor.id;
}

export async function listTalentWorkspace(actor: SalesActor) {
  const db = getDb();
  let campaignRows = await db.select({ campaign: talentCampaigns, vendorName: vendors.companyName, creatorName: users.name }).from(talentCampaigns)
    .innerJoin(vendors, eq(talentCampaigns.vendorId, vendors.id)).innerJoin(users, eq(talentCampaigns.createdByUserId, users.id))
    .orderBy(desc(talentCampaigns.updatedAt)).limit(200);
  if (actor.role === "vendor") campaignRows = campaignRows.filter((row) => row.campaign.vendorId === actor.vendorId);
  if (actor.role === "rep") {
    const targets = actor.campusId ? await db.select().from(talentCampaignTargets).where(eq(talentCampaignTargets.campusId, actor.campusId)) : [];
    const ids = new Set(targets.map((target) => target.campaignId));
    campaignRows = campaignRows.filter((row) => ids.has(row.campaign.id) && ["active", "paused", "closed"].includes(row.campaign.state));
  }
  const campaignIds = campaignRows.map((row) => row.campaign.id);
  const targets = campaignIds.length ? await db.select({ target: talentCampaignTargets, campusName: campuses.name }).from(talentCampaignTargets).innerJoin(campuses, eq(talentCampaignTargets.campusId, campuses.id)).where(inArray(talentCampaignTargets.campaignId, campaignIds)) : [];
  const scopedRepIds = actor.role === "rep" ? await actorRepIds(actor) : [];
  const applicationScope = actor.role === "rep"
    ? and(inArray(talentApplications.campaignId, campaignIds), or(inArray(talentApplications.sourceRepId, scopedRepIds), eq(talentApplications.ownerUserId, actor.userId)))
    : campaignIds.length ? inArray(talentApplications.campaignId, campaignIds) : eq(talentApplications.id, -1);
  const applicationRows = await db.select({ application: talentApplications, applicant: applicants, campaign: talentCampaigns }).from(talentApplications)
    .innerJoin(applicants, eq(talentApplications.applicantId, applicants.id)).innerJoin(talentCampaigns, eq(talentApplications.campaignId, talentCampaigns.id))
    .where(applicationScope).orderBy(desc(talentApplications.updatedAt)).limit(1000);
  const applicationIds = applicationRows.map((row) => row.application.id);
  let metricApplications = campaignIds.length ? await db.select({ id: talentApplications.id, campaignId: talentApplications.campaignId, currentStage: talentApplications.currentStage, sourceRepId: talentApplications.sourceRepId, ownerUserId: talentApplications.ownerUserId }).from(talentApplications).where(inArray(talentApplications.campaignId, campaignIds)) : [];
  if (actor.role === "rep") {
    const repIds = await actorRepIds(actor);
    metricApplications = metricApplications.filter((row) => (row.sourceRepId && repIds.includes(row.sourceRepId)) || row.ownerUserId === actor.userId);
  }
  const metricApplicationIds = metricApplications.map((row) => row.id);
  const metricOffers = campaignIds.length ? await db.select({ id: talentOffers.id, applicationId: talentOffers.applicationId, state: talentOffers.state }).from(talentOffers).innerJoin(talentApplications, eq(talentOffers.applicationId, talentApplications.id)).where(inArray(talentApplications.campaignId, campaignIds)) : [];
  const metricOutcomes = campaignIds.length ? await db.select({ id: talentOutcomes.id, applicationId: talentOutcomes.applicationId, state: talentOutcomes.state }).from(talentOutcomes).where(inArray(talentOutcomes.campaignId, campaignIds)) : [];
  const scopedMetricOffers = actor.role === "rep" ? metricOffers.filter((row) => metricApplicationIds.includes(row.applicationId)) : metricOffers;
  const scopedMetricOutcomes = actor.role === "rep" ? metricOutcomes.filter((row) => metricApplicationIds.includes(row.applicationId)) : metricOutcomes;
  const [events, documents, assessments, interviews, offers, outcomes, imports, receipts, campusRows, interviewerRows] = await Promise.all([
    applicationIds.length && actor.role !== "finance" ? db.select().from(talentApplicationEvents).where(inArray(talentApplicationEvents.applicationId, applicationIds)).orderBy(desc(talentApplicationEvents.createdAt)).limit(300) : [],
    applicationIds.length && actor.role !== "finance" ? db.select().from(talentApplicationDocuments).where(inArray(talentApplicationDocuments.applicationId, applicationIds)).orderBy(desc(talentApplicationDocuments.createdAt)).limit(300) : [],
    applicationIds.length && actor.role !== "finance" ? db.select().from(talentAssessments).where(inArray(talentAssessments.applicationId, applicationIds)).orderBy(desc(talentAssessments.createdAt)).limit(200) : [],
    applicationIds.length && actor.role !== "finance" ? db.select().from(talentInterviews).where(inArray(talentInterviews.applicationId, applicationIds)).orderBy(desc(talentInterviews.createdAt)).limit(200) : [],
    applicationIds.length ? db.select().from(talentOffers).where(inArray(talentOffers.applicationId, applicationIds)).orderBy(desc(talentOffers.createdAt)).limit(200) : [],
    campaignIds.length ? db.select().from(talentOutcomes).where(inArray(talentOutcomes.campaignId, campaignIds)).orderBy(desc(talentOutcomes.createdAt)).limit(500) : [],
    campaignIds.length ? db.select().from(talentImportBatches).where(inArray(talentImportBatches.campaignId, campaignIds)).orderBy(desc(talentImportBatches.createdAt)).limit(50) : [],
    campaignIds.length ? db.select().from(talentIntegrationReceipts).where(inArray(talentIntegrationReceipts.campaignId, campaignIds)).orderBy(desc(talentIntegrationReceipts.createdAt)).limit(50) : [],
    db.select({ id: campuses.id, name: campuses.name }).from(campuses).orderBy(campuses.name),
    actor.role !== "rep" ? db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.role, ["ops", "admin", "vendor"])).orderBy(users.name).limit(100) : [],
  ]);
  const [institutionalGovernance, institutionalPartners, documentAnalyses] = await Promise.all([
    campaignIds.length ? db.select().from(institutionalCampaignGovernance).where(inArray(institutionalCampaignGovernance.campaignId, campaignIds)) : [],
    campaignIds.length ? db.select().from(institutionalCampaignPartners).where(inArray(institutionalCampaignPartners.campaignId, campaignIds)) : [],
    applicationIds.length && actor.role !== "finance" ? db.select().from(talentDocumentAnalyses).where(inArray(talentDocumentAnalyses.applicationId, applicationIds)).orderBy(desc(talentDocumentAnalyses.createdAt)) : [],
  ]);
  const visibleOutcomes = actor.role === "finance" ? outcomes.filter((outcome) => applicationIds.includes(outcome.applicationId)) : outcomes;
  const metrics = {
    campaigns: campaignRows.length,
    activeCampaigns: campaignRows.filter((row) => row.campaign.state === "active").length,
    target: campaignRows.reduce((sum, row) => sum + row.campaign.targetCount, 0),
    applications: metricApplications.length,
    verifiedOutcomes: scopedMetricOutcomes.filter((outcome) => outcome.state === "verified").length,
    offersAccepted: scopedMetricOffers.filter((offer) => offer.state === "accepted").length,
    completionRate: metricApplications.length ? Math.round(scopedMetricOutcomes.filter((outcome) => outcome.state === "verified").length / metricApplications.length * 100) : 0,
    pipeline: Object.fromEntries(["submitted", "screening", "assessment", "interview", "offer", "accepted", "completed", "rejected", "withdrawn"].map((stage) => [stage, metricApplications.filter((row) => row.currentStage === stage).length])),
  };
  return {
    campaigns: campaignRows,
    targets,
    applications: actor.role === "finance" ? [] : applicationRows,
    events,
    documents,
    assessments,
    interviews,
    offers: actor.role === "finance" ? [] : offers,
    outcomes: visibleOutcomes,
    imports,
    receipts,
    campuses: actor.role === "rep" ? campusRows.filter((campus) => campus.id === actor.campusId) : campusRows,
    interviewers: interviewerRows,
    institutionalGovernance,
    institutionalPartners,
    documentAnalyses,
    catalog: talentCampaignCatalog,
    metrics,
    capabilities: { manage: ["vendor", "ops", "admin"].includes(actor.role), review: ["ops", "admin"].includes(actor.role), apply: actor.role !== "finance", documents: actor.role !== "finance", readOnly: actor.role === "finance" },
    boundary: "Campus opportunity and participation outcomes are not customer activations. No application, interview, offer, attendance, award, hire or export creates a deal, attribution, ledger entry, payout or commission entitlement. ATS/HR exports are local sandbox files; no external delivery occurs.",
  };
}

export async function createTalentCampaign(input: { actor: SalesActor; vendorId?: number; title: string; campaignType: TalentCampaignType; summary: string; targetCount: number; eligibleCourses: string[]; startsAt: Date; endsAt: Date; targets: { campusId: number; targetCount: number }[] }) {
  assertCampaignManager(input.actor);
  if (input.endsAt <= input.startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Campaign end must be after its start" });
  const targetProblem = talentTargetProblem(input.targets, input.targetCount);
  if (targetProblem) throw new TRPCError({ code: "BAD_REQUEST", message: targetProblem });
  const vendorId = await vendorForCampaign(input.actor, input.vendorId);
  const db = getDb();
  const campusRows = await db.select({ id: campuses.id }).from(campuses).where(inArray(campuses.id, input.targets.map((target) => target.campusId)));
  if (campusRows.length !== input.targets.length) throw new TRPCError({ code: "BAD_REQUEST", message: "One or more target campuses do not exist" });
  const campaignRef = talentRef("KF-OPP").toUpperCase();
  return db.transaction(async (tx) => {
    const [campaign] = await tx.insert(talentCampaigns).values({ campaignRef, vendorId, title: input.title, campaignType: input.campaignType, summary: input.summary, targetCount: input.targetCount, eligibleCourses: input.eligibleCourses.map((course) => course.trim()).filter(Boolean), startsAt: input.startsAt, endsAt: input.endsAt, createdByUserId: input.actor.userId }).returning();
    await tx.insert(talentCampaignTargets).values(input.targets.map((target) => ({ campaignId: campaign.id, ...target })));
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "talent_campaign.created", entityType: "talent_campaign", entityId: String(campaign.id), metadataJson: { campaignType: input.campaignType, targetCount: input.targetCount, financialEntitlement: false } });
    return { campaignId: campaign.id, campaignRef, state: campaign.state };
  });
}

export async function submitTalentCampaign(input: { actor: SalesActor; campaignId: number; expectedVersion: number }) {
  assertCampaignManager(input.actor);
  const campaign = await accessibleTalentCampaign(input.actor, input.campaignId);
  if (!["draft", "rejected"].includes(campaign.state)) throw new TRPCError({ code: "CONFLICT", message: "Only a draft or rejected campaign can be submitted" });
  await assertInstitutionalCampaignSubmittable(campaign.id);
  const [updated] = await getDb().update(talentCampaigns).set({ state: "pending_review", reviewedByUserId: null, reviewedAt: null, reviewNote: null, version: campaign.version + 1, updatedAt: new Date() }).where(and(eq(talentCampaigns.id, campaign.id), eq(talentCampaigns.version, input.expectedVersion))).returning();
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Campaign changed elsewhere; refresh before submitting" });
  return { campaignId: campaign.id, state: updated.state, version: updated.version };
}

export async function reviewTalentCampaign(input: { actor: SalesActor; campaignId: number; decision: "approved" | "rejected"; note: string }) {
  assertTalentOperations(input.actor);
  return getDb().transaction(async (tx) => {
    const [campaign] = await tx.select().from(talentCampaigns).where(eq(talentCampaigns.id, input.campaignId)).for("update").limit(1);
    if (!campaign || campaign.state !== "pending_review") throw new TRPCError({ code: "CONFLICT", message: "Campaign is not awaiting review" });
    if (campaign.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent review is required; the creator cannot review their own campaign" });
    const [updated] = await tx.update(talentCampaigns).set({ state: input.decision, reviewedByUserId: input.actor.userId, reviewedAt: new Date(), reviewNote: input.note, version: campaign.version + 1, updatedAt: new Date() }).where(eq(talentCampaigns.id, campaign.id)).returning();
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: `talent_campaign.${input.decision}`, entityType: "talent_campaign", entityId: String(campaign.id), metadataJson: { independentReview: true, financialEntitlement: false } });
    return { campaignId: campaign.id, state: updated.state, independentlyReviewed: true };
  });
}

export async function activateTalentCampaign(input: { actor: SalesActor; campaignId: number }) {
  assertTalentOperations(input.actor);
  const now = new Date();
  const [campaign] = await getDb().select().from(talentCampaigns).where(eq(talentCampaigns.id, input.campaignId)).limit(1);
  if (!campaign || campaign.state !== "approved") throw new TRPCError({ code: "CONFLICT", message: "Only an independently approved campaign can activate" });
  if (campaign.startsAt > now || campaign.endsAt <= now) throw new TRPCError({ code: "BAD_REQUEST", message: "Campaign can activate only inside its scheduled window" });
  const [updated] = await getDb().update(talentCampaigns).set({ state: "active", version: campaign.version + 1, updatedAt: now }).where(and(eq(talentCampaigns.id, campaign.id), eq(talentCampaigns.version, campaign.version))).returning();
  return { campaignId: campaign.id, state: updated.state, externalDelivery: false };
}

export async function setTalentCampaignState(input: { actor: SalesActor; campaignId: number; state: "paused" | "closed" }) {
  assertCampaignManager(input.actor);
  const campaign = await accessibleTalentCampaign(input.actor, input.campaignId);
  if (!["active", "paused"].includes(campaign.state)) throw new TRPCError({ code: "CONFLICT", message: "Only an active or paused campaign can change state" });
  const [updated] = await getDb().update(talentCampaigns).set({ state: input.state, version: campaign.version + 1, updatedAt: new Date() }).where(eq(talentCampaigns.id, campaign.id)).returning();
  return { campaignId: campaign.id, state: updated.state };
}


function validateApplicantProfile(profile: ApplicantProfileInput) {
  const now = new Date();
  if (profile.consentedAt > now) throw new TRPCError({ code: "BAD_REQUEST", message: "Consent time cannot be in the future" });
  if (profile.retentionUntil <= now || profile.retentionUntil.getTime() - profile.consentedAt.getTime() > 5 * 366 * 24 * 3_600_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Retention must be in the future and no more than five years after consent" });
  if (profile.graduationYear < now.getFullYear() - 1 || profile.graduationYear > now.getFullYear() + 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Graduation year is outside the supported applicant range" });
}

async function existingApplicantForActor(actor: SalesActor, applicantId: number) {
  const db = getDb();
  const [applicant] = await db.select().from(applicants).where(eq(applicants.id, applicantId)).limit(1);
  if (!applicant || applicant.anonymizedAt || applicant.consentWithdrawnAt) throw new TRPCError({ code: "NOT_FOUND", message: "Active consented applicant profile not found" });
  const [application] = await db.select({ id: talentApplications.id }).from(talentApplications).where(eq(talentApplications.applicantId, applicant.id)).limit(1);
  if (application) await accessibleTalentApplication(actor, application.id);
  if (actor.role === "vendor" && applicant.vendorId !== actor.vendorId) throw new TRPCError({ code: "NOT_FOUND", message: "Applicant profile not found" });
  return applicant;
}

export async function applyToTalentCampaign(input: { actor: SalesActor; campaignId: number; applicantId?: number; profile?: ApplicantProfileInput }) {
  assertTalentWritable(input.actor);
  const campaign = await accessibleTalentCampaign(input.actor, input.campaignId);
  const now = new Date();
  if (campaign.state !== "active" || campaign.startsAt > now || campaign.endsAt <= now) throw new TRPCError({ code: "CONFLICT", message: "Applications are accepted only while the campaign is active" });
  const db = getDb();
  let applicant = input.applicantId ? await existingApplicantForActor(input.actor, input.applicantId) : undefined;
  if (!applicant) {
    if (!input.profile) throw new TRPCError({ code: "BAD_REQUEST", message: "Applicant profile or an existing applicant ID is required" });
    validateApplicantProfile(input.profile);
    if (input.actor.role === "rep" && input.profile.campusId !== input.actor.campusId) throw new TRPCError({ code: "FORBIDDEN", message: "Representatives can register applicants only at their own campus" });
  }
  const campusId = applicant?.campusId || input.profile!.campusId;
  const course = applicant?.course || input.profile!.course;
  const [target] = await db.select().from(talentCampaignTargets).where(and(eq(talentCampaignTargets.campaignId, campaign.id), eq(talentCampaignTargets.campusId, campusId))).limit(1);
  if (!target) throw new TRPCError({ code: "BAD_REQUEST", message: "This campaign does not target the applicant's campus" });
  if (campaign.eligibleCourses.length && !campaign.eligibleCourses.some((eligible) => eligible.toLowerCase() === course.toLowerCase())) throw new TRPCError({ code: "BAD_REQUEST", message: `This campaign accepts only: ${campaign.eligibleCourses.join(", ")}` });
  await assertInstitutionalApplicantEligibility(campaign.id, {
    studyLevel: applicant?.studyLevel || input.profile!.studyLevel,
    graduationYear: applicant?.graduationYear || input.profile!.graduationYear,
  });
  const applicationRef = talentRef("KF-APP").toUpperCase();
  return db.transaction(async (tx) => {
    if (!applicant) {
      const profile = input.profile!;
      const applicantRef = talentRef("KF-CAND").toUpperCase();
      const [created] = await tx.insert(applicants).values({ applicantRef, vendorId: campaign.vendorId, campusId: profile.campusId, fullName: profile.fullName, email: profile.email.trim(), normalizedEmail: normalizeApplicantEmail(profile.email), phoneE164: profile.phoneE164 || null, course: profile.course, studyLevel: profile.studyLevel, graduationYear: profile.graduationYear, consentVersion: profile.consentVersion, consentedAt: profile.consentedAt, retentionUntil: profile.retentionUntil, sourceRepId: input.actor.repId || null, ownerUserId: input.actor.userId, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
      if (!created) throw new TRPCError({ code: "CONFLICT", message: "An applicant with this email already exists for the vendor; select the existing profile" });
      applicant = created;
    }
    if (applicant.vendorId !== campaign.vendorId) throw new TRPCError({ code: "BAD_REQUEST", message: "Applicant profile belongs to another vendor" });
    const [application] = await tx.insert(talentApplications).values({ applicationRef, campaignId: campaign.id, applicantId: applicant.id, ownerUserId: input.actor.userId, sourceRepId: input.actor.repId || applicant.sourceRepId }).onConflictDoNothing().returning();
    if (!application) throw new TRPCError({ code: "CONFLICT", message: "This applicant has already applied to the campaign" });
    await appendTalentEvent(application.id, input.actor.userId, "application_submitted", "Consented application recorded; no commercial activation was created", null, "submitted", { consentVersion: applicant.consentVersion, campaignType: campaign.campaignType, financialEntitlement: false }, tx);
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "talent_application.submitted", entityType: "talent_application", entityId: String(application.id), metadataJson: { campaignType: campaign.campaignType, financialEntitlement: false } });
    return { applicationId: application.id, applicationRef, applicantId: applicant.id, stage: application.currentStage, commissionCreated: false };
  });
}

export async function bulkApplyToTalentCampaign(input: { actor: SalesActor; campaignId: number; importRef: string; rows: ApplicantProfileInput[] }) {
  assertCampaignManager(input.actor);
  if (!input.rows.length || input.rows.length > 1000) throw new TRPCError({ code: "BAD_REQUEST", message: "A bulk batch must contain between 1 and 1,000 rows" });
  const campaign = await accessibleTalentCampaign(input.actor, input.campaignId);
  const db = getDb();
  const [existingBatch] = await db.select().from(talentImportBatches).where(eq(talentImportBatches.importRef, input.importRef)).limit(1);
  if (existingBatch) {
    if (existingBatch.campaignId !== campaign.id) throw new TRPCError({ code: "CONFLICT", message: "Import reference already belongs to another campaign" });
    return { ...existingBatch, idempotent: true };
  }
  const startedAt = Date.now();
  let rowsCreated = 0;
  let duplicatesRejected = 0;
  const errors: { row: number; reason: string }[] = [];
  for (let index = 0; index < input.rows.length; index += 1) {
    const profile = input.rows[index];
    try {
      const [existing] = await db.select({ id: applicants.id, campusId: applicants.campusId, course: applicants.course }).from(applicants).where(and(eq(applicants.vendorId, campaign.vendorId), eq(applicants.normalizedEmail, normalizeApplicantEmail(profile.email)))).limit(1);
      if (existing && (existing.campusId !== profile.campusId || existing.course.toLowerCase() !== profile.course.toLowerCase())) throw new TRPCError({ code: "CONFLICT", message: "Existing applicant profile has a different campus or course" });
      await applyToTalentCampaign({ actor: input.actor, campaignId: campaign.id, applicantId: existing?.id, profile: existing ? undefined : profile });
      rowsCreated += 1;
    } catch (error) {
      if (error instanceof TRPCError && error.code === "CONFLICT") duplicatesRejected += 1;
      errors.push({ row: index + 1, reason: error instanceof Error ? error.message.slice(0, 240) : "Unknown row error" });
    }
  }
  const [batch] = await db.insert(talentImportBatches).values({ importRef: input.importRef, campaignId: campaign.id, rowsReceived: input.rows.length, rowsCreated, duplicatesRejected, errorsJson: errors, elapsedMs: Date.now() - startedAt, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  if (!batch) {
    const [concurrent] = await db.select().from(talentImportBatches).where(eq(talentImportBatches.importRef, input.importRef)).limit(1);
    return { ...concurrent, idempotent: true };
  }
  return { ...batch, idempotent: false, measurementBoundary: "Local sandbox batch timing, not ATS-provider or production-scale certification" };
}

export async function exportTalentCampaign(input: { actor: SalesActor; campaignId: number; destination: "generic_ats" | "hris" | "report" }) {
  assertCampaignManager(input.actor);
  const campaign = await accessibleTalentCampaign(input.actor, input.campaignId);
  const db = getDb();
  const rows = await db.select({ application: talentApplications, applicant: applicants, outcome: talentOutcomes }).from(talentApplications)
    .innerJoin(applicants, eq(talentApplications.applicantId, applicants.id)).leftJoin(talentOutcomes, and(eq(talentOutcomes.applicationId, talentApplications.id), eq(talentOutcomes.campaignId, campaign.id)))
    .where(eq(talentApplications.campaignId, campaign.id)).orderBy(talentApplications.id).limit(10000);
  const header = ["applicationRef", "applicantRef", "fullName", "email", "course", "studyLevel", "graduationYear", "stage", "score", "verifiedOutcome"];
  const csv = [header.map(talentCsvCell).join(","), ...rows.map((row) => [row.application.applicationRef, row.applicant.applicantRef, row.applicant.fullName, row.applicant.email, row.applicant.course, row.applicant.studyLevel, row.applicant.graduationYear, row.application.currentStage, row.application.score, row.outcome?.state === "verified" ? row.outcome.outcomeType : ""].map(talentCsvCell).join(","))].join("\r\n");
  const payloadHash = talentHash(csv);
  const [receipt] = await db.insert(talentIntegrationReceipts).values({ receiptRef: talentRef("KF-EXP").toUpperCase(), campaignId: campaign.id, destination: input.destination, format: "csv", rowCount: rows.length, payloadHash, externalExecution: false, createdByUserId: input.actor.userId }).returning();
  return { receiptId: receipt.id, receiptRef: receipt.receiptRef, fileName: `${campaign.campaignRef}-${input.destination}.csv`, csv, rowCount: rows.length, payloadHash, externalExecution: false, boundary: "Generated locally for sandbox ATS/HR handoff; no external connector was called" };
}

export async function withdrawTalentConsent(input: { actor: SalesActor; applicantId: number }) {
  assertTalentWritable(input.actor);
  await existingApplicantForActor(input.actor, input.applicantId);
  const db = getDb();
  const now = new Date();
  return db.transaction(async (tx) => {
    const [applicant] = await tx.update(applicants).set({ consentWithdrawnAt: now, updatedAt: now }).where(and(eq(applicants.id, input.applicantId), isNull(applicants.consentWithdrawnAt))).returning();
    if (!applicant) throw new TRPCError({ code: "CONFLICT", message: "Consent was already withdrawn or the profile was anonymized" });
    const open = await tx.select().from(talentApplications).where(and(eq(talentApplications.applicantId, applicant.id), inArray(talentApplications.currentStage, ["submitted", "screening", "assessment", "interview", "offer", "accepted"]))).for("update");
    for (const application of open) {
      await tx.update(talentApplications).set({ currentStage: "withdrawn", version: application.version + 1, decisionReason: "Applicant consent withdrawn", updatedAt: now }).where(eq(talentApplications.id, application.id));
      await appendTalentEvent(application.id, input.actor.userId, "consent_withdrawn", "Open application withdrawn after consent withdrawal", application.currentStage, "withdrawn", { financialStateChanged: false }, tx);
    }
    const allApplications = await tx.select({ id: talentApplications.id }).from(talentApplications).where(eq(talentApplications.applicantId, applicant.id));
    const analyses = allApplications.length ? await tx.update(talentDocumentAnalyses).set({ state: "withdrawn", extractedFieldsJson: {}, providersJson: [], providerVersionsJson: {}, qualityFlagsJson: ["consent_withdrawn"], confidenceBps: null, withdrawnAt: now, purgedAt: now, updatedAt: now }).where(and(inArray(talentDocumentAnalyses.applicationId, allApplications.map((row) => row.id)), isNull(talentDocumentAnalyses.purgedAt))).returning({ id: talentDocumentAnalyses.id }) : [];
    return { applicantId: applicant.id, withdrawnApplications: open.length, purgedAnalyses: analyses.length, consentWithdrawnAt: now };
  });
}

export async function enforceTalentRetention(input: { actor: SalesActor; applicantId: number }) {
  assertTalentOperations(input.actor);
  const db = getDb();
  const [applicant] = await db.select().from(applicants).where(eq(applicants.id, input.applicantId)).limit(1);
  if (!applicant || applicant.anonymizedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Retained applicant profile not found" });
  if (applicant.retentionUntil > new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Applicant retention period has not expired" });
  const applicationRows = await db.select().from(talentApplications).where(eq(talentApplications.applicantId, applicant.id));
  const documents = applicationRows.length ? await db.select().from(talentApplicationDocuments).where(and(inArray(talentApplicationDocuments.applicationId, applicationRows.map((row) => row.id)), isNull(talentApplicationDocuments.purgedAt), isNull(talentApplicationDocuments.deletedAt))) : [];
  for (const document of documents) await storage.deleteFile({ fileKey: document.objectKey });
  const now = new Date();
  await db.transaction(async (tx) => {
    if (documents.length) await tx.update(talentApplicationDocuments).set({ purgedAt: now }).where(inArray(talentApplicationDocuments.id, documents.map((document) => document.id)));
    if (applicationRows.length) await tx.update(talentDocumentAnalyses).set({ state: "purged", extractedFieldsJson: {}, providersJson: [], providerVersionsJson: {}, qualityFlagsJson: ["retention_expired"], confidenceBps: null, purgedAt: now, updatedAt: now }).where(and(inArray(talentDocumentAnalyses.applicationId, applicationRows.map((row) => row.id)), isNull(talentDocumentAnalyses.purgedAt)));
    await tx.update(applicants).set({ fullName: `Redacted applicant ${applicant.id}`, email: `expired-${applicant.id}@redacted.invalid`, normalizedEmail: `expired-${applicant.id}@redacted.invalid`, phoneE164: null, anonymizedAt: now, updatedAt: now }).where(eq(applicants.id, applicant.id));
    for (const application of applicationRows) await appendTalentEvent(application.id, input.actor.userId, "retention_enforced", "Applicant contact details anonymized and stored documents purged after retention expiry", application.currentStage, application.currentStage, { purgedDocuments: documents.length, financialStateChanged: false }, tx);
  });
  return { applicantId: applicant.id, anonymized: true, purgedDocuments: documents.length, applicationHistoryRetained: true };
}

export async function listExpiredTalentApplicants(input: { actor: SalesActor }) {
  assertTalentOperations(input.actor);
  return getDb().select({ id: applicants.id, applicantRef: applicants.applicantRef, retentionUntil: applicants.retentionUntil }).from(applicants).where(and(lte(applicants.retentionUntil, new Date()), isNull(applicants.anonymizedAt))).limit(100);
}
