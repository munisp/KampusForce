import { z } from "zod";
import { createRouter } from "./middleware";
import { authedQuery } from "./services/auth";
import { salesActorForUser } from "./services/salesAccess";
import {
  addInstitutionalPartner,
  reviewInstitutionalGovernance,
  reviewInstitutionalPartner,
  submitInstitutionalGovernance,
  upsertInstitutionalGovernance,
} from "./services/institutionalCampaigns";
import { analyzeTalentDocument, reviewTalentDocumentAnalysis, withdrawTalentDocumentAnalysis } from "./services/talentDocumentIntelligence";
import {
  acceptRepresentativeHandoff,
  activateVendorConnector,
  createRepresentativeHandoff,
  createVendorConnector,
  listVendorConnectorWorkspace,
  markRepresentativeHandoffProvisioned,
  recordConnectorProgress,
  reviewVendorConnector,
} from "./services/vendorConnectors";
import { listRecurrenceWorkspace, runRecurrenceSweep } from "./services/recurrence";

const id = z.number().int().positive();
const text = (max = 200) => z.string().trim().min(2).max(max);
const actor = async (ctx: { user: Parameters<typeof salesActorForUser>[0] }) => salesActorForUser(ctx.user);
const governance = z.object({
  sponsorType: z.enum(["government", "international_organization", "ngo", "foundation", "university", "private"]),
  sponsorName: text(200),
  sponsorReference: text(160),
  fundingModel: z.enum(["grant", "donor", "procurement", "mixed", "self_funded"]),
  fundingReference: text(200),
  fundingCurrency: z.string().trim().length(3),
  fundingAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  procurementReference: text(200).nullable().optional(),
  eligibilityPolicy: z.string().trim().min(20).max(4000),
  eligibleStudyLevels: z.array(text(80)).max(20),
  minimumGraduationYear: z.number().int().min(2000).max(2100).nullable().optional(),
  maximumGraduationYear: z.number().int().min(2000).max(2100).nullable().optional(),
  safeguardingPolicy: z.string().trim().min(20).max(4000),
  accessibilityPolicy: z.string().trim().min(20).max(4000),
  auditRequirements: z.string().trim().min(20).max(4000),
});

export const phase19Router = createRouter({
  saveGovernance: authedQuery.input(z.object({ campaignId: id, governance })).mutation(async ({ ctx, input }) => upsertInstitutionalGovernance({ ...input, actor: await actor(ctx) })),
  addPartner: authedQuery.input(z.object({ campaignId: id, institutionName: text(200), institutionType: z.enum(["government", "international_organization", "university", "ngo", "implementation_partner"]), countryCode: z.string().trim().length(2), partnerRole: z.enum(["lead", "partner", "funder", "safeguarding"]), governanceReference: text(200) })).mutation(async ({ ctx, input }) => addInstitutionalPartner({ ...input, actor: await actor(ctx) })),
  reviewPartner: authedQuery.input(z.object({ partnerId: id, decision: z.enum(["approved", "rejected"]), note: text(2000) })).mutation(async ({ ctx, input }) => reviewInstitutionalPartner({ ...input, actor: await actor(ctx) })),
  submitGovernance: authedQuery.input(z.object({ campaignId: id, expectedVersion: id })).mutation(async ({ ctx, input }) => submitInstitutionalGovernance({ ...input, actor: await actor(ctx) })),
  reviewGovernance: authedQuery.input(z.object({ campaignId: id, decision: z.enum(["approved", "rejected"]), note: text(2000) })).mutation(async ({ ctx, input }) => reviewInstitutionalGovernance({ ...input, actor: await actor(ctx) })),
  analyzeDocument: authedQuery.input(z.object({ documentId: id, consentVersion: text(100), consentedAt: z.coerce.date(), retentionUntil: z.coerce.date() })).mutation(async ({ ctx, input }) => analyzeTalentDocument({ ...input, actor: await actor(ctx) })),
  reviewDocumentAnalysis: authedQuery.input(z.object({ analysisId: id, decision: z.enum(["approved", "rejected"]), note: text(2000) })).mutation(async ({ ctx, input }) => reviewTalentDocumentAnalysis({ ...input, actor: await actor(ctx) })),
  withdrawDocumentAnalysis: authedQuery.input(z.object({ analysisId: id })).mutation(async ({ ctx, input }) => withdrawTalentDocumentAnalysis(await actor(ctx), input.analysisId)),
  connectorWorkspace: authedQuery.query(async ({ ctx }) => listVendorConnectorWorkspace(await actor(ctx))),
  createConnector: authedQuery.input(z.object({ promotionId: id, name: text(180), targetCount: z.number().int().min(1).max(1000000), successEvent: z.enum(["kyc_complete", "funded", "first_transaction", "renewal"]), handoffMode: z.enum(["signed_link", "signed_link_and_sandbox_provisioning"]) })).mutation(async ({ ctx, input }) => createVendorConnector({ ...input, actor: await actor(ctx) })),
  reviewConnector: authedQuery.input(z.object({ connectorId: id, decision: z.enum(["approved", "rejected"]), note: text(2000) })).mutation(async ({ ctx, input }) => reviewVendorConnector({ ...input, actor: await actor(ctx) })),
  activateConnector: authedQuery.input(z.object({ connectorId: id })).mutation(async ({ ctx, input }) => activateVendorConnector({ ...input, actor: await actor(ctx) })),
  createHandoff: authedQuery.input(z.object({ connectorId: id, repId: id, applicationId: id.optional(), consentVersion: text(100), consentedAt: z.coerce.date() })).mutation(async ({ ctx, input }) => createRepresentativeHandoff({ ...input, actor: await actor(ctx) })),
  acceptHandoff: authedQuery.input(z.object({ handoffId: id, origin: z.string().url().max(500) })).mutation(async ({ ctx, input }) => acceptRepresentativeHandoff({ ...input, actor: await actor(ctx) })),
  provisionHandoff: authedQuery.input(z.object({ handoffId: id, evidenceNote: text(2000) })).mutation(async ({ ctx, input }) => markRepresentativeHandoffProvisioned({ ...input, actor: await actor(ctx) })),
  recordProgress: authedQuery.input(z.object({ connectorId: id, handoffId: id, externalEventKey: z.string().trim().min(8).max(160), stage: z.enum(["clicked", "registered", "provisioned", "account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"]), externalCustomerRef: z.string().trim().min(3).max(160), customerPhone: z.string().trim().min(7).max(20), amountKobo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), occurredAt: z.coerce.date() })).mutation(async ({ ctx, input }) => recordConnectorProgress({ ...input, actor: await actor(ctx) })),
  recurrenceWorkspace: authedQuery.query(async ({ ctx }) => listRecurrenceWorkspace(await actor(ctx))),
  runRecurrence: authedQuery.mutation(async ({ ctx }) => runRecurrenceSweep(await actor(ctx))),
});
