import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  applicants,
  talentApplications,
  talentCampaigns,
  talentCampaignTargets,
  talentApplicationEvents,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { actorRepIds, type SalesActor } from "./salesAccess";

export const talentCampaignTypes = [
  "recruitment", "internship", "scholarship", "fellowship", "campus_event", "research", "training", "waitlist",
  "grant", "bursary", "public_service", "volunteer", "development_program", "public_health", "innovation_challenge", "emergency_response", "civic_program",
] as const;
export type TalentCampaignType = typeof talentCampaignTypes[number];
export type TalentStage = "submitted" | "screening" | "assessment" | "interview" | "offer" | "accepted" | "completed" | "rejected" | "withdrawn";

export const talentCampaignCatalog: { type: TalentCampaignType; label: string; outcome: string; journey: string }[] = [
  { type: "recruitment", label: "Graduate recruitment", outcome: "hire", journey: "Application → assessment → interview → offer → verified hire" },
  { type: "internship", label: "Internship placement", outcome: "placement", journey: "Application → assessment → interview → offer → verified placement" },
  { type: "scholarship", label: "Scholarship", outcome: "award", journey: "Application → screening → award offer → independently verified award" },
  { type: "fellowship", label: "Fellowship", outcome: "fellowship", journey: "Application → assessment → selection offer → verified fellowship" },
  { type: "campus_event", label: "Campus event or workshop", outcome: "attendance", journey: "Consented registration → selection → independently verified attendance" },
  { type: "research", label: "Research participation", outcome: "research_completion", journey: "Consented response → screening → verified research completion" },
  { type: "training", label: "External student training cohort", outcome: "learning_completion", journey: "Registration → cohort selection → verified learning completion" },
  { type: "waitlist", label: "Product waitlist or early access", outcome: "early_access", journey: "Consented interest → invitation → independently verified access" },
  { type: "grant", label: "Institutional grant", outcome: "grant_awarded", journey: "Eligibility → institutional review → independently verified grant award" },
  { type: "bursary", label: "Bursary or financial aid", outcome: "bursary_awarded", journey: "Eligibility → funding review → independently verified bursary award" },
  { type: "public_service", label: "Public-service placement", outcome: "service_placement", journey: "Application → selection → independently verified public-service placement" },
  { type: "volunteer", label: "Volunteer programme", outcome: "volunteer_completion", journey: "Consented registration → safeguarding review → verified volunteer completion" },
  { type: "development_program", label: "International development programme", outcome: "development_completion", journey: "Eligibility → cohort selection → verified development completion" },
  { type: "public_health", label: "Public-health outreach", outcome: "outreach_completion", journey: "Registration → approved training → independently verified outreach" },
  { type: "innovation_challenge", label: "Innovation challenge", outcome: "challenge_completion", journey: "Application → assessment → selection → verified challenge completion" },
  { type: "emergency_response", label: "Emergency-response programme", outcome: "response_completion", journey: "Consented registration → safeguarding clearance → verified response participation" },
  { type: "civic_program", label: "Civic or community programme", outcome: "civic_completion", journey: "Consented registration → cohort clearance → verified civic participation" },
];

export function isInstitutionalCampaign(campaignType: string) {
  return ["grant", "bursary", "public_service", "volunteer", "development_program", "public_health", "innovation_challenge", "emergency_response", "civic_program"].includes(campaignType);
}

export const talentRef = (prefix: string) => `${prefix}-${randomUUID()}`;
export const talentHash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const normalizeApplicantEmail = (email: string) => email.trim().toLowerCase();

export function assertTalentWritable(actor: SalesActor) {
  if (actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance has aggregate, read-only campaign oversight and cannot access applicant documents" });
}

export function assertTalentOperations(actor: SalesActor) {
  if (!["ops", "admin"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations must perform this independent control" });
}

export async function accessibleTalentCampaign(actor: SalesActor, campaignId: number) {
  const db = getDb();
  const [campaign] = await db.select().from(talentCampaigns).where(eq(talentCampaigns.id, campaignId)).limit(1);
  if (!campaign) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity campaign not found" });
  if (["ops", "finance", "admin"].includes(actor.role)) return campaign;
  if (actor.role === "vendor" && campaign.vendorId === actor.vendorId) return campaign;
  if (actor.role === "rep" && actor.campusId && ["active", "paused", "closed"].includes(campaign.state)) {
    const [target] = await db.select().from(talentCampaignTargets).where(and(eq(talentCampaignTargets.campaignId, campaign.id), eq(talentCampaignTargets.campusId, actor.campusId))).limit(1);
    if (target) return campaign;
  }
  throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity campaign not found" });
}

export async function accessibleTalentApplication(actor: SalesActor, applicationId: number) {
  const db = getDb();
  const [row] = await db.select({ application: talentApplications, campaign: talentCampaigns, applicant: applicants }).from(talentApplications)
    .innerJoin(talentCampaigns, eq(talentApplications.campaignId, talentCampaigns.id))
    .innerJoin(applicants, eq(talentApplications.applicantId, applicants.id))
    .where(eq(talentApplications.id, applicationId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
  await accessibleTalentCampaign(actor, row.campaign.id);
  if (actor.role === "rep") {
    const allowed = await actorRepIds(actor);
    if ((!row.application.sourceRepId || !allowed.includes(row.application.sourceRepId)) && row.application.ownerUserId !== actor.userId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Application not found" });
    }
  }
  return row;
}

export async function appendTalentEvent(applicationId: number, actorUserId: number | null, eventType: string, note: string, fromStage?: string | null, toStage?: string | null, metadataJson: Record<string, unknown> = {}, tx?: Pick<ReturnType<typeof getDb>, "insert">) {
  const executor = tx || getDb();
  await executor.insert(talentApplicationEvents).values({ applicationId, actorUserId, eventType, note, fromStage: fromStage || null, toStage: toStage || null, metadataJson });
}

export function campaignSupportsSelection(campaignType: string) {
  return ["recruitment", "internship", "scholarship", "fellowship", "grant", "bursary", "public_service", "development_program", "innovation_challenge"].includes(campaignType);
}

export function campaignOutcomeType(campaignType: string) {
  return talentCampaignCatalog.find((item) => item.type === campaignType)?.outcome || "completion";
}
