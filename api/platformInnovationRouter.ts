import { z } from "zod";
import { createRouter } from "./middleware";
import { authedQuery } from "./services/auth";
import { salesActorForUser } from "./services/salesAccess";
import {
  acknowledgeCoaching,
  addCapabilityEvidence,
  assessRiskTiming,
  createControlDefinition,
  createMetricDefinition,
  createPortabilityManifest,
  createPurposePolicy,
  decideRiskTiming,
  generateBenchmark,
  generateCoaching,
  linkActivationEvidence,
  listPlatformInnovationWorkspace,
  publishControlDefinition,
  publishMetricDefinition,
  publishPurposePolicy,
  reconcileIndependentOutcome,
  recordActivationEvidence,
  recordIndependentOutcome,
  recordUniversalConsent,
  registerProviderProfile,
  runControlSimulation,
  runPromotionSimulation,
  runResilienceDrill,
  snapshotMetric,
} from "./services/platformInnovations";

const id = z.number().int().positive();
const short = (max = 160) => z.string().trim().min(2).max(max);
const condition = z.object({ field: z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,80}$/), operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]), value: z.union([z.string().max(200), z.number(), z.boolean()]) });
const actor = async (ctx: { user: Parameters<typeof salesActorForUser>[0] }) => salesActorForUser(ctx.user);

export const platformInnovationRouter = createRouter({
  workspace: authedQuery.query(async ({ ctx }) => listPlatformInnovationWorkspace(await actor(ctx))),
  recordEvidence: authedQuery.input(z.object({ dealId: id, kind: short(60), source: short(100), evidence: z.string().min(1).max(4000), observedAt: z.coerce.date() })).mutation(async ({ ctx, input }) => recordActivationEvidence({ ...input, actor: await actor(ctx) })),
  linkEvidence: authedQuery.input(z.object({ fromNodeId: id, toNodeId: id, relationship: short(60), rationale: z.string().trim().min(5).max(500) })).mutation(async ({ ctx, input }) => linkActivationEvidence({ ...input, actor: await actor(ctx) })),
  simulatePromotion: authedQuery.input(z.object({ promotionId: id.optional(), name: short(), representatives: z.number().int().min(0).max(10000), activationsPerRepresentative: z.number().int().min(0).max(10000), vendorCommissionKobo: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), budgetCapKobo: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), escrowKobo: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), refundPct: z.number().min(0).max(100) })).mutation(async ({ ctx, input }) => runPromotionSimulation({ ...input, actor: await actor(ctx) })),
  createMetric: authedQuery.input(z.object({ metricKey: z.enum(["verified_activation_count", "verified_activation_rate", "case_resolution_rate", "crm_conversion_rate"]), name: short(), formula: z.string().trim().min(5).max(2000), sourceContract: z.string().trim().min(5).max(2000) })).mutation(async ({ ctx, input }) => createMetricDefinition({ ...input, actor: await actor(ctx) })),
  publishMetric: authedQuery.input(z.object({ definitionId: id })).mutation(async ({ ctx, input }) => publishMetricDefinition({ ...input, actor: await actor(ctx) })),
  snapshotMetric: authedQuery.input(z.object({ definitionId: id, scopeType: z.enum(["global", "vendor", "campus"]), scopeId: z.number().int().min(0), periodStart: z.coerce.date(), periodEnd: z.coerce.date() })).mutation(async ({ ctx, input }) => snapshotMetric({ ...input, actor: await actor(ctx) })),
  createPurposePolicy: authedQuery.input(z.object({ purpose: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,99}$/), notice: z.string().trim().min(20).max(4000), retentionDays: z.number().int().min(1).max(3650) })).mutation(async ({ ctx, input }) => createPurposePolicy({ ...input, actor: await actor(ctx) })),
  publishPurposePolicy: authedQuery.input(z.object({ policyId: id })).mutation(async ({ ctx, input }) => publishPurposePolicy({ ...input, actor: await actor(ctx) })),
  recordConsent: authedQuery.input(z.object({ subjectToken: z.string().min(8).max(200), purpose: z.string().trim().min(3).max(100), state: z.enum(["granted", "revoked"]), evidenceRef: short() })).mutation(async ({ ctx, input }) => recordUniversalConsent({ ...input, actor: await actor(ctx) })),
  createControl: authedQuery.input(z.object({ controlKey: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,79}$/), name: short(), triggerEvent: short(100), conditions: z.array(condition).max(10), action: z.enum(["open_review", "request_evidence", "suppress_outreach", "recommend_payout_delay"]) })).mutation(async ({ ctx, input }) => createControlDefinition({ ...input, actor: await actor(ctx) })),
  publishControl: authedQuery.input(z.object({ controlId: id })).mutation(async ({ ctx, input }) => publishControlDefinition({ ...input, actor: await actor(ctx) })),
  runControl: authedQuery.input(z.object({ controlId: id, inputJson: z.record(z.string(), z.unknown()) })).mutation(async ({ ctx, input }) => runControlSimulation({ ...input, actor: await actor(ctx) })),
  recordOutcome: authedQuery.input(z.object({ dealId: id, observer: short(100), outcome: short(60), evidence: z.string().min(1).max(4000), observedAt: z.coerce.date() })).mutation(async ({ ctx, input }) => recordIndependentOutcome({ ...input, actor: await actor(ctx) })),
  reconcileOutcome: authedQuery.input(z.object({ observationId: id, state: z.enum(["matched", "mismatch", "resolved"]), reason: z.string().trim().min(5).max(500) })).mutation(async ({ ctx, input }) => reconcileIndependentOutcome({ ...input, actor: await actor(ctx) })),
  addCapability: authedQuery.input(z.object({ repId: id, capability: z.enum(["ethical_sales", "evidence_quality", "customer_service", "privacy"]), level: z.number().int().min(0).max(100), evidenceType: short(60), evidenceRef: short(120) })).mutation(async ({ ctx, input }) => addCapabilityEvidence({ ...input, actor: await actor(ctx) })),
  generateCoaching: authedQuery.input(z.object({ repId: id })).mutation(async ({ ctx, input }) => generateCoaching({ ...input, actor: await actor(ctx) })),
  acknowledgeCoaching: authedQuery.input(z.object({ recommendationId: id })).mutation(async ({ ctx, input }) => acknowledgeCoaching({ ...input, actor: await actor(ctx) })),
  generateBenchmark: authedQuery.input(z.object({ scopeType: z.enum(["campus", "vendor"]), periodStart: z.coerce.date(), periodEnd: z.coerce.date(), minimumCohort: z.number().int().min(5).max(100).optional() })).mutation(async ({ ctx, input }) => generateBenchmark({ ...input, actor: await actor(ctx) })),
  assessRisk: authedQuery.input(z.object({ dealId: id })).mutation(async ({ ctx, input }) => assessRiskTiming({ ...input, actor: await actor(ctx) })),
  decideRisk: authedQuery.input(z.object({ assessmentId: id, state: z.enum(["accepted", "adjusted", "dismissed"]), reason: z.string().trim().min(5).max(500) })).mutation(async ({ ctx, input }) => decideRiskTiming({ ...input, actor: await actor(ctx) })),
  registerProvider: authedQuery.input(z.object({ providerKey: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,79}$/), capability: short(80), portabilityTier: z.enum(["portable", "adapter_required", "manual_export"]), configuration: z.record(z.string(), z.unknown()) })).mutation(async ({ ctx, input }) => registerProviderProfile({ ...input, actor: await actor(ctx) })),
  runDrill: authedQuery.input(z.object({ providerId: id, scenario: z.enum(["timeout", "credential_rotation", "provider_failover", "restore_export"]) })).mutation(async ({ ctx, input }) => runResilienceDrill({ ...input, actor: await actor(ctx) })),
  createManifest: authedQuery.input(z.object({ providerId: id })).mutation(async ({ ctx, input }) => createPortabilityManifest({ ...input, actor: await actor(ctx) })),
});
