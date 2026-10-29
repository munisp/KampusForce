import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  institutionalCampaignGovernance,
  institutionalCampaignPartners,
  talentCampaigns,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { accessibleTalentCampaign, assertTalentOperations, isInstitutionalCampaign } from "./talentAccess";
import { assertSalesRole, type SalesActor } from "./salesAccess";

export type InstitutionalGovernanceInput = {
  sponsorType: "government" | "international_organization" | "ngo" | "foundation" | "university" | "private";
  sponsorName: string;
  sponsorReference: string;
  fundingModel: "grant" | "donor" | "procurement" | "mixed" | "self_funded";
  fundingReference: string;
  fundingCurrency: string;
  fundingAmountMinor?: number | null;
  procurementReference?: string | null;
  eligibilityPolicy: string;
  eligibleStudyLevels: string[];
  minimumGraduationYear?: number | null;
  maximumGraduationYear?: number | null;
  safeguardingPolicy: string;
  accessibilityPolicy: string;
  auditRequirements: string;
};

function assertManager(actor: SalesActor) {
  assertSalesRole(actor, ["vendor", "ops", "admin"]);
}

function clean(value: string, max = 4000) {
  return value.trim().slice(0, max);
}

function validateGovernance(input: InstitutionalGovernanceInput) {
  const normalized: InstitutionalGovernanceInput = {
    ...input,
    sponsorName: clean(input.sponsorName, 200),
    sponsorReference: clean(input.sponsorReference, 160),
    fundingReference: clean(input.fundingReference, 200),
    fundingCurrency: input.fundingCurrency.trim().toUpperCase(),
    procurementReference: input.procurementReference ? clean(input.procurementReference, 200) : null,
    eligibilityPolicy: clean(input.eligibilityPolicy),
    safeguardingPolicy: clean(input.safeguardingPolicy),
    accessibilityPolicy: clean(input.accessibilityPolicy),
    auditRequirements: clean(input.auditRequirements),
    eligibleStudyLevels: [...new Set(input.eligibleStudyLevels.map((value) => clean(value, 80)).filter(Boolean))].slice(0, 20),
    fundingAmountMinor: input.fundingAmountMinor ?? null,
    minimumGraduationYear: input.minimumGraduationYear ?? null,
    maximumGraduationYear: input.maximumGraduationYear ?? null,
  };
  if (normalized.sponsorName.length < 2 || normalized.sponsorReference.length < 3 || normalized.fundingReference.length < 3) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Sponsor and funding references are required" });
  }
  if (!/^[A-Z]{3}$/.test(normalized.fundingCurrency)) throw new TRPCError({ code: "BAD_REQUEST", message: "Funding currency must be a three-letter code" });
  if (normalized.fundingAmountMinor != null && (!Number.isSafeInteger(normalized.fundingAmountMinor) || normalized.fundingAmountMinor < 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Funding amount must be a non-negative integer in minor units" });
  }
  if (normalized.fundingModel === "procurement" && !normalized.procurementReference) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A procurement reference is required for procurement-funded programmes" });
  }
  for (const [label, value] of [["Eligibility", normalized.eligibilityPolicy], ["Safeguarding", normalized.safeguardingPolicy], ["Accessibility", normalized.accessibilityPolicy], ["Audit", normalized.auditRequirements]] as const) {
    if (value.length < 20) throw new TRPCError({ code: "BAD_REQUEST", message: `${label} controls must contain a reviewable policy of at least 20 characters` });
  }
  const currentYear = new Date().getFullYear();
  for (const year of [normalized.minimumGraduationYear, normalized.maximumGraduationYear]) {
    if (year != null && (!Number.isInteger(year) || year < currentYear - 10 || year > currentYear + 20)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Graduation-year eligibility is outside the supported range" });
    }
  }
  if (normalized.minimumGraduationYear && normalized.maximumGraduationYear && normalized.minimumGraduationYear > normalized.maximumGraduationYear) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Minimum graduation year cannot exceed the maximum" });
  }
  return normalized;
}

async function manageableCampaign(actor: SalesActor, campaignId: number) {
  assertManager(actor);
  const campaign = await accessibleTalentCampaign(actor, campaignId);
  if (!isInstitutionalCampaign(campaign.campaignType)) throw new TRPCError({ code: "BAD_REQUEST", message: "This campaign does not require institutional governance" });
  if (!["draft", "rejected"].includes(campaign.state)) throw new TRPCError({ code: "CONFLICT", message: "Governance can be edited only while the campaign is draft or rejected" });
  return campaign;
}

export async function upsertInstitutionalGovernance(input: { actor: SalesActor; campaignId: number; governance: InstitutionalGovernanceInput }) {
  const campaign = await manageableCampaign(input.actor, input.campaignId);
  const governance = validateGovernance(input.governance);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(institutionalCampaignGovernance).where(eq(institutionalCampaignGovernance.campaignId, campaign.id)).for("update").limit(1);
    const values = { campaignId: campaign.id, ...governance, state: "draft", reviewedByUserId: null, reviewedAt: null, reviewNote: null, submittedByUserId: null, submittedAt: null, updatedAt: new Date() };
    const [saved] = existing
      ? await tx.update(institutionalCampaignGovernance).set({ ...values, version: existing.version + 1 }).where(eq(institutionalCampaignGovernance.id, existing.id)).returning()
      : await tx.insert(institutionalCampaignGovernance).values({ ...values, createdByUserId: input.actor.userId }).returning();
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "institutional_governance.saved", entityType: "talent_campaign", entityId: String(campaign.id), metadataJson: { governanceId: saved.id, version: saved.version, independentApprovalRequired: true, financialEntitlement: false } });
    return { governanceId: saved.id, campaignId: campaign.id, state: saved.state, version: saved.version };
  });
}

export async function addInstitutionalPartner(input: { actor: SalesActor; campaignId: number; institutionName: string; institutionType: "government" | "international_organization" | "university" | "ngo" | "implementation_partner"; countryCode: string; partnerRole: "lead" | "partner" | "funder" | "safeguarding"; governanceReference: string }) {
  const campaign = await manageableCampaign(input.actor, input.campaignId);
  const institutionName = clean(input.institutionName, 200);
  const governanceReference = clean(input.governanceReference, 200);
  const countryCode = input.countryCode.trim().toUpperCase();
  if (institutionName.length < 2 || governanceReference.length < 3 || !/^[A-Z]{2}$/.test(countryCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "Institution name, country and governance reference are required" });
  const [partner] = await getDb().insert(institutionalCampaignPartners).values({ campaignId: campaign.id, institutionName, normalizedName: institutionName.toLowerCase(), institutionType: input.institutionType, countryCode, partnerRole: input.partnerRole, governanceReference, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  if (!partner) throw new TRPCError({ code: "CONFLICT", message: "This institution is already attached to the campaign" });
  return { partnerId: partner.id, campaignId: campaign.id, state: partner.state, independentReviewRequired: true };
}

export async function reviewInstitutionalPartner(input: { actor: SalesActor; partnerId: number; decision: "approved" | "rejected"; note: string }) {
  assertTalentOperations(input.actor);
  if (clean(input.note, 2000).length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "A review note is required" });
  return getDb().transaction(async (tx) => {
    const [partner] = await tx.select().from(institutionalCampaignPartners).where(eq(institutionalCampaignPartners.id, input.partnerId)).for("update").limit(1);
    if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "Institutional partner not found" });
    if (partner.state !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Institutional partner is not awaiting review" });
    if (partner.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent partner review is required" });
    const [updated] = await tx.update(institutionalCampaignPartners).set({ state: input.decision, reviewedByUserId: input.actor.userId, reviewedAt: new Date(), reviewNote: clean(input.note, 2000) }).where(eq(institutionalCampaignPartners.id, partner.id)).returning();
    return { partnerId: partner.id, state: updated.state, independentlyReviewed: true };
  });
}

export async function submitInstitutionalGovernance(input: { actor: SalesActor; campaignId: number; expectedVersion: number }) {
  const campaign = await manageableCampaign(input.actor, input.campaignId);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [governance] = await tx.select().from(institutionalCampaignGovernance).where(eq(institutionalCampaignGovernance.campaignId, campaign.id)).for("update").limit(1);
    if (!governance || governance.version !== input.expectedVersion || !["draft", "rejected"].includes(governance.state)) throw new TRPCError({ code: "CONFLICT", message: "Governance changed elsewhere or is not awaiting submission" });
    const partners = await tx.select().from(institutionalCampaignPartners).where(eq(institutionalCampaignPartners.campaignId, campaign.id));
    if (!partners.length || partners.some((partner) => partner.state !== "approved")) throw new TRPCError({ code: "BAD_REQUEST", message: "At least one partner and independent approval of every partner are required" });
    const [updated] = await tx.update(institutionalCampaignGovernance).set({ state: "pending_review", submittedByUserId: input.actor.userId, submittedAt: new Date(), reviewedByUserId: null, reviewedAt: null, reviewNote: null, version: governance.version + 1, updatedAt: new Date() }).where(eq(institutionalCampaignGovernance.id, governance.id)).returning();
    return { governanceId: governance.id, state: updated.state, version: updated.version, approvedPartners: partners.length };
  });
}

export async function reviewInstitutionalGovernance(input: { actor: SalesActor; campaignId: number; decision: "approved" | "rejected"; note: string }) {
  assertTalentOperations(input.actor);
  if (clean(input.note, 2000).length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "A review note is required" });
  return getDb().transaction(async (tx) => {
    const [governance] = await tx.select().from(institutionalCampaignGovernance).where(eq(institutionalCampaignGovernance.campaignId, input.campaignId)).for("update").limit(1);
    if (!governance || governance.state !== "pending_review") throw new TRPCError({ code: "CONFLICT", message: "Institutional governance is not awaiting review" });
    const [campaign] = await tx.select().from(talentCampaigns).where(eq(talentCampaigns.id, input.campaignId)).limit(1);
    if (!campaign || campaign.createdByUserId === input.actor.userId || governance.submittedByUserId === input.actor.userId || governance.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent institutional review is required" });
    const partners = await tx.select().from(institutionalCampaignPartners).where(eq(institutionalCampaignPartners.campaignId, input.campaignId));
    if (!partners.length || partners.some((partner) => partner.state !== "approved")) throw new TRPCError({ code: "BAD_REQUEST", message: "All institutional partners must remain approved" });
    const [updated] = await tx.update(institutionalCampaignGovernance).set({ state: input.decision, reviewedByUserId: input.actor.userId, reviewedAt: new Date(), reviewNote: clean(input.note, 2000), version: governance.version + 1, updatedAt: new Date() }).where(eq(institutionalCampaignGovernance.id, governance.id)).returning();
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: `institutional_governance.${input.decision}`, entityType: "talent_campaign", entityId: String(input.campaignId), metadataJson: { governanceId: governance.id, independentlyReviewed: true, partnerCount: partners.length, financialEntitlement: false } });
    return { governanceId: governance.id, state: updated.state, independentlyReviewed: true };
  });
}

export async function assertInstitutionalCampaignSubmittable(campaignId: number) {
  const [campaign] = await getDb().select().from(talentCampaigns).where(eq(talentCampaigns.id, campaignId)).limit(1);
  if (!campaign || !isInstitutionalCampaign(campaign.campaignType)) return;
  const [governance] = await getDb().select().from(institutionalCampaignGovernance).where(eq(institutionalCampaignGovernance.campaignId, campaignId)).limit(1);
  if (!governance || governance.state !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Independent institutional governance, funding, eligibility, safeguarding, accessibility and audit approval is required before campaign submission" });
}

export async function assertInstitutionalApplicantEligibility(campaignId: number, profile: { studyLevel: string; graduationYear: number }) {
  const [campaign] = await getDb().select().from(talentCampaigns).where(eq(talentCampaigns.id, campaignId)).limit(1);
  if (!campaign || !isInstitutionalCampaign(campaign.campaignType)) return;
  const [governance] = await getDb().select().from(institutionalCampaignGovernance).where(and(eq(institutionalCampaignGovernance.campaignId, campaignId), eq(institutionalCampaignGovernance.state, "approved"))).limit(1);
  if (!governance) throw new TRPCError({ code: "BAD_REQUEST", message: "Approved institutional eligibility controls are unavailable" });
  if (governance.eligibleStudyLevels.length && !governance.eligibleStudyLevels.some((level) => level.toLowerCase() === profile.studyLevel.toLowerCase())) throw new TRPCError({ code: "BAD_REQUEST", message: "The applicant's study level is outside the approved institutional eligibility policy" });
  if (governance.minimumGraduationYear && profile.graduationYear < governance.minimumGraduationYear) throw new TRPCError({ code: "BAD_REQUEST", message: "The applicant's graduation year is below the approved institutional eligibility range" });
  if (governance.maximumGraduationYear && profile.graduationYear > governance.maximumGraduationYear) throw new TRPCError({ code: "BAD_REQUEST", message: "The applicant's graduation year is above the approved institutional eligibility range" });
}
