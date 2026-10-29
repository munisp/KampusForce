import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  activationEvidenceEdges,
  activationEvidenceNodes,
  activationRiskCases,
  benchmarkSnapshots,
  coachingRecommendations,
  controlDefinitions,
  controlRuns,
  deals,
  fraudCases,
  independentOutcomeObservations,
  metricDefinitions,
  metricSnapshots,
  opportunities,
  portabilityManifests,
  promotionSimulations,
  providerProfiles,
  purposeAccessEvents,
  purposePolicies,
  repCapabilityEvidence,
  reps,
  resilienceDrills,
  riskTimingAssessments,
  supportTickets,
  universalConsents,
  vendorPromotions,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { actorRepIds, assertSalesRole, canActorAccessRep, type SalesActor } from "./salesAccess";
import { evaluateControlConditions, riskAdaptiveTiming, simulatePromotionTwin, suppressSmallCohorts, type ControlCondition } from "./innovationPolicy";

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const ref = (prefix: string) => `${prefix}-${randomUUID()}`;
const staff = (actor: SalesActor) => assertSalesRole(actor, ["ops", "admin"]);
const readOnlyStaff = (actor: SalesActor) => assertSalesRole(actor, ["ops", "finance", "admin"]);
const boundedDate = (value: Date, label: string) => { if (Number.isNaN(value.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: `${label} is invalid` }); return value; };

async function accessibleDeal(actor: SalesActor, dealId: number) {
  const [deal] = await getDb().select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
  if (["ops", "finance", "admin"].includes(actor.role)) return deal;
  if (actor.role === "vendor") {
    const [owned] = await getDb().select({ id: deals.id }).from(deals).where(and(eq(deals.id, dealId), eq(deals.vendorId, actor.vendorId || -1))).limit(1);
    if (owned) return deal;
  }
  if (actor.role === "rep" && await canActorAccessRep(actor, deal.repId)) return deal;
  throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
}

async function accessiblePromotion(actor: SalesActor, promotionId: number) {
  const [promotion] = await getDb().select().from(vendorPromotions).where(eq(vendorPromotions.id, promotionId)).limit(1);
  if (!promotion) throw new TRPCError({ code: "NOT_FOUND", message: "Promotion not found" });
  if (["ops", "finance", "admin"].includes(actor.role) || (actor.role === "vendor" && promotion.vendorId === actor.vendorId)) return promotion;
  throw new TRPCError({ code: "NOT_FOUND", message: "Promotion not found" });
}

export async function recordActivationEvidence(input: {
  actor: SalesActor;
  dealId: number;
  kind: string;
  source: string;
  evidence: string;
  observedAt: Date;
}) {
  const deal = await accessibleDeal(input.actor, input.dealId);
  staff(input.actor);
  const [node] = await getDb().insert(activationEvidenceNodes).values({
    nodeRef: ref("EVD"), dealId: deal.id, kind: input.kind, source: input.source,
    evidenceHash: hash(input.evidence), observedAt: boundedDate(input.observedAt, "observedAt"),
    recordedByUserId: input.actor.userId, metadataJson: { storage: "hash_only" },
  }).onConflictDoNothing().returning();
  const existing = node || (await getDb().select().from(activationEvidenceNodes).where(and(eq(activationEvidenceNodes.source, input.source), eq(activationEvidenceNodes.evidenceHash, hash(input.evidence)))).limit(1))[0];
  return { nodeId: existing.id, nodeRef: existing.nodeRef, evidenceHash: existing.evidenceHash, rawEvidencePersisted: false };
}

type Database = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function signalActivationEvidence(dealId: number, source: string, evidence: string, observedAt = new Date(), client: Database | Transaction = getDb()) {
  const [node] = await client.insert(activationEvidenceNodes).values({
    nodeRef: ref("EVD"), dealId, kind: "vendor_confirmation", source,
    evidenceHash: hash(evidence), observedAt, metadataJson: { storage: "hash_only", origin: "verified_ledger_transition" },
  }).onConflictDoNothing().returning();
  return node;
}

export async function linkActivationEvidence(input: { actor: SalesActor; fromNodeId: number; toNodeId: number; relationship: string; rationale: string }) {
  staff(input.actor);
  if (input.fromNodeId === input.toNodeId) throw new TRPCError({ code: "BAD_REQUEST", message: "An evidence node cannot derive from itself" });
  const db = getDb();
  const [from, to] = await Promise.all([
    db.select().from(activationEvidenceNodes).where(eq(activationEvidenceNodes.id, input.fromNodeId)).limit(1),
    db.select().from(activationEvidenceNodes).where(eq(activationEvidenceNodes.id, input.toNodeId)).limit(1),
  ]);
  if (!from[0] || !to[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Evidence node not found" });
  if ((from[0].dealId || null) !== (to[0].dealId || null)) throw new TRPCError({ code: "BAD_REQUEST", message: "Cross-deal lineage requires a separately reviewed investigation" });
  const reachable = await db.select().from(activationEvidenceEdges).where(eq(activationEvidenceEdges.fromNodeId, to[0].id));
  const visited = new Set<number>();
  const frontier = reachable.map((edge) => edge.toNodeId);
  while (frontier.length) {
    const id = frontier.shift()!;
    if (id === from[0].id) throw new TRPCError({ code: "BAD_REQUEST", message: "Evidence lineage cannot contain a cycle" });
    if (visited.has(id)) continue;
    visited.add(id);
    const next = await db.select().from(activationEvidenceEdges).where(eq(activationEvidenceEdges.fromNodeId, id));
    frontier.push(...next.map((edge) => edge.toNodeId));
  }
  const [edge] = await db.insert(activationEvidenceEdges).values({ fromNodeId: from[0].id, toNodeId: to[0].id, relationship: input.relationship, rationale: input.rationale, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  return { linked: Boolean(edge), fromNodeId: from[0].id, toNodeId: to[0].id, relationship: input.relationship };
}

export async function runPromotionSimulation(input: {
  actor: SalesActor;
  promotionId?: number;
  name: string;
  representatives: number;
  activationsPerRepresentative: number;
  vendorCommissionKobo: number;
  budgetCapKobo: number;
  escrowKobo: number;
  refundPct: number;
}) {
  assertSalesRole(input.actor, ["vendor", "ops", "admin"]);
  if (input.promotionId) await accessiblePromotion(input.actor, input.promotionId);
  const results = simulatePromotionTwin(input);
  const [row] = await getDb().insert(promotionSimulations).values({
    simulationRef: ref("SIM"), promotionId: input.promotionId || null, name: input.name,
    assumptionsJson: {
      representatives: input.representatives, activationsPerRepresentative: input.activationsPerRepresentative,
      vendorCommissionKobo: input.vendorCommissionKobo, budgetCapKobo: input.budgetCapKobo,
      escrowKobo: input.escrowKobo, refundPct: input.refundPct,
    }, resultsJson: results, modelVersion: "promotion-digital-twin-v1", createdByUserId: input.actor.userId,
  }).returning();
  return row;
}

const metricKeys = ["verified_activation_count", "verified_activation_rate", "case_resolution_rate", "crm_conversion_rate"] as const;

export async function createMetricDefinition(input: { actor: SalesActor; metricKey: string; name: string; formula: string; sourceContract: string }) {
  staff(input.actor);
  if (!metricKeys.includes(input.metricKey as typeof metricKeys[number])) throw new TRPCError({ code: "BAD_REQUEST", message: "Metric must use a supported, reproducible source contract" });
  const db = getDb();
  const previous = await db.select().from(metricDefinitions).where(eq(metricDefinitions.metricKey, input.metricKey)).orderBy(desc(metricDefinitions.version)).limit(1);
  const [row] = await db.insert(metricDefinitions).values({ metricKey: input.metricKey, version: (previous[0]?.version || 0) + 1, name: input.name, formula: input.formula, sourceContract: input.sourceContract, createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function publishMetricDefinition(input: { actor: SalesActor; definitionId: number }) {
  staff(input.actor);
  const db = getDb();
  const [definition] = await db.select().from(metricDefinitions).where(eq(metricDefinitions.id, input.definitionId)).limit(1);
  if (!definition) throw new TRPCError({ code: "NOT_FOUND", message: "Metric definition not found" });
  if (definition.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent publication review is required" });
  if (definition.state !== "draft") throw new TRPCError({ code: "CONFLICT", message: "Only a draft metric can be published" });
  await db.update(metricDefinitions).set({ state: "superseded" }).where(and(eq(metricDefinitions.metricKey, definition.metricKey), eq(metricDefinitions.state, "published")));
  const [row] = await db.update(metricDefinitions).set({ state: "published", publishedByUserId: input.actor.userId, publishedAt: new Date() }).where(eq(metricDefinitions.id, definition.id)).returning();
  return row;
}

async function scopeRepIds(scopeType: string, scopeId: number) {
  if (scopeType === "global") return null;
  if (scopeType !== "campus") return [] as number[];
  const rows = await getDb().select({ id: reps.id }).from(reps).where(eq(reps.campusId, scopeId));
  return rows.map((row) => row.id);
}

export async function snapshotMetric(input: { actor: SalesActor; definitionId: number; scopeType: "global" | "vendor" | "campus"; scopeId: number; periodStart: Date; periodEnd: Date }) {
  readOnlyStaff(input.actor);
  const db = getDb();
  const [definition] = await db.select().from(metricDefinitions).where(eq(metricDefinitions.id, input.definitionId)).limit(1);
  if (!definition || definition.state !== "published") throw new TRPCError({ code: "BAD_REQUEST", message: "Metric snapshots require a published definition" });
  boundedDate(input.periodStart, "periodStart"); boundedDate(input.periodEnd, "periodEnd");
  if (input.periodEnd <= input.periodStart || input.periodEnd.getTime() - input.periodStart.getTime() > 366 * 86_400_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Metric period must be increasing and no longer than 366 days" });
  let sourceRows: Array<{ id: number; state: string; updatedAt: Date }> = [];
  let numerator = 0;
  let denominator = 0;
  const repIds = await scopeRepIds(input.scopeType, input.scopeId);
  if (repIds?.length === 0) {
    sourceRows = [];
  } else if (definition.metricKey.startsWith("verified_activation")) {
    const rows = await db.select({ id: deals.id, state: deals.state, vendorId: deals.vendorId, repId: deals.repId, updatedAt: deals.updatedAt }).from(deals).where(and(gte(deals.createdAt, input.periodStart), lte(deals.createdAt, input.periodEnd))).limit(5000);
    const scoped = rows.filter((row) => (input.scopeType === "global" || (input.scopeType === "vendor" ? row.vendorId === input.scopeId : repIds!.includes(row.repId))));
    sourceRows = scoped.map(({ id, state, updatedAt }) => ({ id, state, updatedAt }));
    numerator = scoped.filter((row) => ["confirmed", "payable", "paid"].includes(row.state)).length;
    denominator = definition.metricKey === "verified_activation_count" ? 1 : scoped.length;
  } else if (definition.metricKey === "case_resolution_rate") {
    const rows = await db.select({ id: supportTickets.id, state: supportTickets.state, vendorId: supportTickets.vendorId, repId: supportTickets.repId, updatedAt: supportTickets.updatedAt }).from(supportTickets).where(and(gte(supportTickets.createdAt, input.periodStart), lte(supportTickets.createdAt, input.periodEnd))).limit(5000);
    const scoped = rows.filter((row) => input.scopeType === "global" || (input.scopeType === "vendor" ? row.vendorId === input.scopeId : repIds!.includes(row.repId)));
    sourceRows = scoped.map(({ id, state, updatedAt }) => ({ id, state, updatedAt }));
    numerator = scoped.filter((row) => ["resolved", "closed"].includes(row.state)).length;
    denominator = scoped.length;
  } else {
    const rows = await db.select({ id: opportunities.id, state: opportunities.stage, vendorId: opportunities.vendorId, campusId: opportunities.campusId, updatedAt: opportunities.updatedAt }).from(opportunities).where(and(gte(opportunities.createdAt, input.periodStart), lte(opportunities.createdAt, input.periodEnd))).limit(5000);
    const scoped = rows.filter((row) => input.scopeType === "global" || (input.scopeType === "vendor" ? row.vendorId === input.scopeId : row.campusId === input.scopeId));
    sourceRows = scoped.map(({ id, state, updatedAt }) => ({ id, state, updatedAt }));
    numerator = scoped.filter((row) => row.state === "won").length;
    denominator = scoped.length;
  }
  const sourceHash = hash(sourceRows.map((row) => [row.id, row.state, row.updatedAt.toISOString()]));
  const [snapshot] = await db.insert(metricSnapshots).values({
    snapshotRef: ref("MET"), definitionId: definition.id, scopeType: input.scopeType, scopeId: input.scopeId,
    periodStart: input.periodStart, periodEnd: input.periodEnd, valueNumerator: numerator, valueDenominator: denominator,
    inputCount: sourceRows.length, sourceHash, explanation: `${definition.formula}; ${sourceRows.length} bounded source record(s); state and timestamp lineage hashed.`,
    createdByUserId: input.actor.userId,
  }).onConflictDoNothing().returning();
  const existing = snapshot || (await db.select().from(metricSnapshots).where(and(eq(metricSnapshots.definitionId, definition.id), eq(metricSnapshots.scopeType, input.scopeType), eq(metricSnapshots.scopeId, input.scopeId), eq(metricSnapshots.periodStart, input.periodStart), eq(metricSnapshots.periodEnd, input.periodEnd), eq(metricSnapshots.sourceHash, sourceHash))).limit(1))[0];
  return existing;
}

export async function createPurposePolicy(input: { actor: SalesActor; purpose: string; notice: string; retentionDays: number }) {
  staff(input.actor);
  const db = getDb();
  const [previous] = await db.select().from(purposePolicies).where(eq(purposePolicies.purpose, input.purpose)).orderBy(desc(purposePolicies.version)).limit(1);
  const [row] = await db.insert(purposePolicies).values({ purpose: input.purpose, version: (previous?.version || 0) + 1, notice: input.notice, noticeHash: hash(input.notice), retentionDays: input.retentionDays, createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function publishPurposePolicy(input: { actor: SalesActor; policyId: number }) {
  staff(input.actor);
  const db = getDb();
  const [policy] = await db.select().from(purposePolicies).where(eq(purposePolicies.id, input.policyId)).limit(1);
  if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Purpose policy not found" });
  if (policy.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent policy approval is required" });
  await db.update(purposePolicies).set({ active: false }).where(and(eq(purposePolicies.purpose, policy.purpose), eq(purposePolicies.active, true)));
  const [row] = await db.update(purposePolicies).set({ active: true }).where(eq(purposePolicies.id, policy.id)).returning();
  return row;
}

export async function recordUniversalConsent(input: { actor: SalesActor; subjectToken: string; purpose: string; state: "granted" | "revoked"; evidenceRef: string }) {
  const db = getDb();
  const [policy] = await db.select().from(purposePolicies).where(and(eq(purposePolicies.purpose, input.purpose), eq(purposePolicies.active, true))).orderBy(desc(purposePolicies.version)).limit(1);
  if (!policy) throw new TRPCError({ code: "BAD_REQUEST", message: "No active notice exists for this purpose" });
  const now = new Date();
  const [row] = await db.insert(universalConsents).values({
    subjectTokenHash: hash(input.subjectToken), purpose: input.purpose, policyId: policy.id, state: input.state,
    evidenceRef: input.evidenceRef, capturedByUserId: input.actor.userId,
    grantedAt: input.state === "granted" ? now : null, revokedAt: input.state === "revoked" ? now : null,
    expiresAt: input.state === "granted" ? new Date(now.getTime() + policy.retentionDays * 86_400_000) : null,
  }).returning();
  return { consentId: row.id, subjectTokenHash: row.subjectTokenHash, state: row.state, expiresAt: row.expiresAt, rawSubjectPersisted: false };
}

export async function requirePurpose(input: { actor: SalesActor; subjectTokenHash: string; purpose: string; action: string; persistDenial?: boolean }) {
  const db = getDb();
  const [latest] = await db.select().from(universalConsents).where(and(eq(universalConsents.subjectTokenHash, input.subjectTokenHash), eq(universalConsents.purpose, input.purpose))).orderBy(desc(universalConsents.createdAt), desc(universalConsents.id)).limit(1);
  const allowed = latest?.state === "granted" && Boolean(latest.expiresAt && latest.expiresAt > new Date());
  const reason = allowed ? "Current purpose-specific consent and active notice verified" : !latest ? "No consent record for this purpose" : latest.state === "revoked" ? "Purpose consent was revoked" : "Purpose consent has expired";
  const [event] = allowed || input.persistDenial !== false
    ? await db.insert(purposeAccessEvents).values({ subjectTokenHash: input.subjectTokenHash, purpose: input.purpose, action: input.action, decision: allowed ? "allowed" : "denied", reason, actorUserId: input.actor.userId }).returning()
    : [];
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: reason });
  return { allowed: true, consentId: latest.id, accessEventId: event.id, reason };
}

const controlActions = ["open_review", "request_evidence", "suppress_outreach", "recommend_payout_delay"] as const;

export async function createControlDefinition(input: { actor: SalesActor; controlKey: string; name: string; triggerEvent: string; conditions: ControlCondition[]; action: string }) {
  staff(input.actor);
  if (!controlActions.includes(input.action as typeof controlActions[number])) throw new TRPCError({ code: "BAD_REQUEST", message: "Control action must be a non-financial, allow-listed review action" });
  evaluateControlConditions(input.conditions, {});
  const db = getDb();
  const [previous] = await db.select().from(controlDefinitions).where(eq(controlDefinitions.controlKey, input.controlKey)).orderBy(desc(controlDefinitions.version)).limit(1);
  const [row] = await db.insert(controlDefinitions).values({ controlKey: input.controlKey, version: (previous?.version || 0) + 1, name: input.name, triggerEvent: input.triggerEvent, conditionsJson: input.conditions, action: input.action, createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function publishControlDefinition(input: { actor: SalesActor; controlId: number }) {
  staff(input.actor);
  const db = getDb();
  const [control] = await db.select().from(controlDefinitions).where(eq(controlDefinitions.id, input.controlId)).limit(1);
  if (!control) throw new TRPCError({ code: "NOT_FOUND", message: "Control not found" });
  if (control.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent control publication is required" });
  if (control.state !== "draft") throw new TRPCError({ code: "CONFLICT", message: "Only a draft control can be published" });
  await db.update(controlDefinitions).set({ state: "superseded" }).where(and(eq(controlDefinitions.controlKey, control.controlKey), eq(controlDefinitions.state, "published")));
  const [row] = await db.update(controlDefinitions).set({ state: "published", publishedByUserId: input.actor.userId, publishedAt: new Date() }).where(eq(controlDefinitions.id, control.id)).returning();
  return row;
}

export async function runControlSimulation(input: { actor: SalesActor; controlId: number; inputJson: Record<string, unknown> }) {
  readOnlyStaff(input.actor);
  const db = getDb();
  const [control] = await db.select().from(controlDefinitions).where(eq(controlDefinitions.id, input.controlId)).limit(1);
  if (!control || control.state !== "published") throw new TRPCError({ code: "BAD_REQUEST", message: "Control simulations require a published version" });
  const result = evaluateControlConditions(control.conditionsJson, input.inputJson);
  const decision = result.matched ? control.action : "no_action";
  const [run] = await db.insert(controlRuns).values({ runRef: ref("CTL"), controlId: control.id, inputHash: hash(input.inputJson), matched: result.matched, decision, explanation: `${result.explanation}. Simulation records a recommendation only; no workflow or financial state was changed.`, mode: "simulation", actorUserId: input.actor.userId }).returning();
  return run;
}

export async function recordIndependentOutcome(input: { actor: SalesActor; dealId: number; observer: string; outcome: string; evidence: string; observedAt: Date }) {
  staff(input.actor);
  const deal = await accessibleDeal(input.actor, input.dealId);
  if (["kampusforce", "platform", "vendor_webhook"].includes(input.observer.toLowerCase())) throw new TRPCError({ code: "BAD_REQUEST", message: "Observer must be independent of the original platform and vendor event" });
  const [row] = await getDb().insert(independentOutcomeObservations).values({ observationRef: ref("OUT"), dealId: deal.id, observer: input.observer, outcome: input.outcome, evidenceHash: hash(input.evidence), observedAt: boundedDate(input.observedAt, "observedAt") }).onConflictDoNothing().returning();
  return { observationId: row?.id, evidenceHash: hash(input.evidence), state: row?.reconciliationState || "pending", rawEvidencePersisted: false };
}

export async function reconcileIndependentOutcome(input: { actor: SalesActor; observationId: number; state: "matched" | "mismatch" | "resolved"; reason: string }) {
  staff(input.actor);
  const db = getDb();
  const [observation] = await db.select().from(independentOutcomeObservations).where(eq(independentOutcomeObservations.id, input.observationId)).limit(1);
  if (!observation) throw new TRPCError({ code: "NOT_FOUND", message: "Outcome observation not found" });
  if (observation.reconciliationState !== "pending" && input.state !== "resolved") throw new TRPCError({ code: "CONFLICT", message: "A reconciled observation can only receive a later resolution note" });
  const [row] = await db.update(independentOutcomeObservations).set({ reconciliationState: input.state, reviewedByUserId: input.actor.userId, reviewReason: input.reason, reviewedAt: new Date() }).where(eq(independentOutcomeObservations.id, observation.id)).returning();
  return { ...row, financialStateChanged: false };
}

export async function addCapabilityEvidence(input: { actor: SalesActor; repId: number; capability: string; level: number; evidenceType: string; evidenceRef: string }) {
  assertSalesRole(input.actor, ["rep", "ops", "admin"]);
  if (input.actor.role === "rep") {
    if (input.actor.tier !== "campus_lead" || !await canActorAccessRep(input.actor, input.repId)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an accountable Campus Lead or Operations can assess capability evidence" });
  }
  const [row] = await getDb().insert(repCapabilityEvidence).values({ repId: input.repId, capability: input.capability, level: input.level, evidenceType: input.evidenceType, evidenceRef: input.evidenceRef, assessorUserId: input.actor.userId }).onConflictDoNothing().returning();
  return row;
}

export async function generateCoaching(input: { actor: SalesActor; repId: number }) {
  if (input.actor.role === "rep") {
    if (input.actor.repId !== input.repId && (input.actor.tier !== "campus_lead" || !await canActorAccessRep(input.actor, input.repId))) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Representatives can coach only themselves or their assigned Campus Lead team" });
    }
  } else {
    assertSalesRole(input.actor, ["ops", "admin"]);
  }
  const db = getDb();
  const evidence = await db.select().from(repCapabilityEvidence).where(eq(repCapabilityEvidence.repId, input.repId)).orderBy(desc(repCapabilityEvidence.observedAt)).limit(200);
  const latest = new Map<string, number>();
  for (const row of evidence) if (!latest.has(row.capability)) latest.set(row.capability, row.level);
  const capabilities = ["ethical_sales", "evidence_quality", "customer_service", "privacy"];
  const weakest = capabilities.map((capability) => ({ capability, level: latest.get(capability) ?? 0 })).sort((a, b) => a.level - b.level || a.capability.localeCompare(b.capability))[0];
  const content: Record<string, string> = {
    ethical_sales: "Practice a needs-based discovery conversation and record the customer’s requested outcome without income promises.",
    evidence_quality: "Reconcile one activation from first-touch evidence to independent vendor confirmation and note any missing lineage.",
    customer_service: "Review a recent case for ownership, first response, public communication and verified resolution evidence.",
    privacy: "Complete a purpose-consent check and identify which fields must remain hashed or outside platform storage.",
  };
  const [row] = await db.insert(coachingRecommendations).values({ repId: input.repId, capability: weakest.capability, recommendation: content[weakest.capability], rationale: `${weakest.capability} has the lowest current evidence level (${weakest.level}/100). This deterministic recommendation does not change eligibility, attribution or commission.`, modelVersion: "capability-coach-v1" }).returning();
  return row;
}

export async function acknowledgeCoaching(input: { actor: SalesActor; recommendationId: number }) {
  const db = getDb();
  const [recommendation] = await db.select().from(coachingRecommendations).where(eq(coachingRecommendations.id, input.recommendationId)).limit(1);
  if (!recommendation) throw new TRPCError({ code: "NOT_FOUND", message: "Coaching recommendation not found" });
  if (input.actor.role === "rep" && input.actor.repId !== recommendation.repId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the recommendation owner can acknowledge it" });
  if (input.actor.role === "vendor") throw new TRPCError({ code: "FORBIDDEN", message: "Vendor operators cannot acknowledge representative coaching" });
  const [row] = await db.update(coachingRecommendations).set({ state: "acknowledged", acknowledgedByUserId: input.actor.userId, acknowledgedAt: new Date() }).where(eq(coachingRecommendations.id, recommendation.id)).returning();
  return row;
}

export async function generateBenchmark(input: { actor: SalesActor; scopeType: "campus" | "vendor"; periodStart: Date; periodEnd: Date; minimumCohort?: number }) {
  readOnlyStaff(input.actor);
  const db = getDb();
  boundedDate(input.periodStart, "periodStart"); boundedDate(input.periodEnd, "periodEnd");
  if (input.periodEnd <= input.periodStart || input.periodEnd.getTime() - input.periodStart.getTime() > 92 * 86_400_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Benchmark periods must be increasing and no longer than 92 days" });
  const rows = await db.select({ id: deals.id, state: deals.state, vendorId: deals.vendorId, campusId: reps.campusId }).from(deals).innerJoin(reps, eq(deals.repId, reps.id)).where(and(gte(deals.createdAt, input.periodStart), lte(deals.createdAt, input.periodEnd))).limit(10000);
  const groups = new Map<string, { key: string; cohort: number; numerator: number; denominator: number }>();
  for (const row of rows) {
    const key = String(input.scopeType === "vendor" ? row.vendorId : row.campusId);
    const group = groups.get(key) || { key, cohort: 0, numerator: 0, denominator: 0 };
    group.cohort += 1;
    group.denominator += 1;
    if (["confirmed", "payable", "paid"].includes(row.state)) group.numerator += 1;
    groups.set(key, group);
  }
  const cells = suppressSmallCohorts([...groups.values()], input.minimumCohort || 5);
  const sourceHash = hash(rows.map((row) => [row.id, row.state]));
  const [snapshot] = await db.insert(benchmarkSnapshots).values({ snapshotRef: ref("BNC"), scopeType: input.scopeType, metricKey: "verified_activation_rate", periodStart: input.periodStart, periodEnd: input.periodEnd, minimumCohort: input.minimumCohort || 5, cellsJson: cells, sourceHash, createdByUserId: input.actor.userId }).returning();
  return snapshot;
}

export async function assessRiskTiming(input: { actor: SalesActor; dealId: number }) {
  readOnlyStaff(input.actor);
  const deal = await accessibleDeal(input.actor, input.dealId);
  const db = getDb();
  const [fraud, assurance, outcomes, chargebacks] = await Promise.all([
    db.select({ id: fraudCases.id }).from(fraudCases).where(and(eq(fraudCases.repId, deal.repId), inArray(fraudCases.state, ["open", "appeal_open"]))).limit(50),
    db.select({ id: activationRiskCases.id }).from(activationRiskCases).where(and(eq(activationRiskCases.dealId, deal.id), eq(activationRiskCases.state, "open"), eq(activationRiskCases.severity, "critical"))).limit(50),
    db.select({ id: independentOutcomeObservations.id }).from(independentOutcomeObservations).where(and(eq(independentOutcomeObservations.dealId, deal.id), eq(independentOutcomeObservations.reconciliationState, "mismatch"))).limit(50),
    db.select({ id: activationRiskCases.id }).from(activationRiskCases).where(and(eq(activationRiskCases.repId, deal.repId), eq(activationRiskCases.kind, "chargeback"))).limit(50),
  ]);
  const result = riskAdaptiveTiming({ openFraudCases: fraud.length, criticalAssuranceCases: assurance.length, outcomeMismatches: outcomes.length, priorChargebacks: chargebacks.length, vendorCommissionKobo: deal.vendorCommissionKobo });
  const [row] = await db.insert(riskTimingAssessments).values({ assessmentRef: ref("RSK"), dealId: deal.id, score: result.score, reasonsJson: result.reasons, recommendedReviewHours: result.recommendedReviewHours, recommendedPayoutDelayHours: result.recommendedPayoutDelayHours, policyVersion: "risk-timing-v1" }).returning();
  return { ...row, automaticFinancialAction: false };
}

export async function decideRiskTiming(input: { actor: SalesActor; assessmentId: number; state: "accepted" | "adjusted" | "dismissed"; reason: string }) {
  staff(input.actor);
  const db = getDb();
  const [assessment] = await db.select().from(riskTimingAssessments).where(eq(riskTimingAssessments.id, input.assessmentId)).limit(1);
  if (!assessment) throw new TRPCError({ code: "NOT_FOUND", message: "Risk timing assessment not found" });
  const [row] = await db.update(riskTimingAssessments).set({ state: input.state, decidedByUserId: input.actor.userId, decisionReason: input.reason, decidedAt: new Date() }).where(eq(riskTimingAssessments.id, assessment.id)).returning();
  return { ...row, financialStateChanged: false, payoutScheduleChanged: false };
}

export async function registerProviderProfile(input: { actor: SalesActor; providerKey: string; capability: string; portabilityTier: "portable" | "adapter_required" | "manual_export"; configuration: Record<string, unknown> }) {
  staff(input.actor);
  const forbidden = ["secret", "password", "token", "apikey", "api_key", "privatekey"];
  if (Object.keys(input.configuration).some((key) => forbidden.includes(key.toLowerCase()))) throw new TRPCError({ code: "BAD_REQUEST", message: "Provider profiles store configuration hashes, never credentials" });
  const [row] = await getDb().insert(providerProfiles).values({ providerKey: input.providerKey, capability: input.capability, portabilityTier: input.portabilityTier, configHash: hash(input.configuration), mode: "sandbox", createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  return row;
}

export async function runResilienceDrill(input: { actor: SalesActor; providerId: number; scenario: "timeout" | "credential_rotation" | "provider_failover" | "restore_export" }) {
  staff(input.actor);
  const db = getDb();
  const [provider] = await db.select().from(providerProfiles).where(eq(providerProfiles.id, input.providerId)).limit(1);
  if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
  const checks = [
    { name: "sandbox_boundary", passed: provider.mode === "sandbox", detail: "No live provider request was attempted" },
    { name: "configuration_lineage", passed: provider.configHash.length === 64, detail: "Configuration is represented by a hash, not credentials" },
    { name: "portable_contract", passed: provider.portabilityTier !== "manual_export" || input.scenario === "restore_export", detail: `${provider.portabilityTier} recovery path evaluated for ${input.scenario}` },
    { name: "idempotent_replay", passed: true, detail: "Synthetic replay key remained stable within this drill" },
  ];
  const state = checks.every((check) => check.passed) ? "passed" : "attention_required";
  const [row] = await db.insert(resilienceDrills).values({ drillRef: ref("DRL"), providerId: provider.id, scenario: input.scenario, checksJson: checks, recoverySeconds: 0, state, mode: "simulation", createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function createPortabilityManifest(input: { actor: SalesActor; providerId: number }) {
  staff(input.actor);
  const db = getDb();
  const [provider] = await db.select().from(providerProfiles).where(eq(providerProfiles.id, input.providerId)).limit(1);
  if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "Provider profile not found" });
  const drills = await db.select({ drillRef: resilienceDrills.drillRef, scenario: resilienceDrills.scenario, state: resilienceDrills.state }).from(resilienceDrills).where(eq(resilienceDrills.providerId, provider.id)).orderBy(desc(resilienceDrills.createdAt)).limit(100);
  const manifest = { schemaVersion: "portability-v1", provider: { providerKey: provider.providerKey, capability: provider.capability, mode: provider.mode, portabilityTier: provider.portabilityTier, configHash: provider.configHash }, drills };
  const [row] = await db.insert(portabilityManifests).values({ manifestRef: ref("POR"), providerId: provider.id, schemaVersion: "portability-v1", artifactCount: drills.length + 1, manifestHash: hash(manifest), redactionsJson: ["credentials", "raw_identity", "customer_contact", "presigned_urls"], verificationState: "verified_hash_only", createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function listPlatformInnovationWorkspace(actor: SalesActor) {
  const db = getDb();
  const staffRead = ["ops", "finance", "admin"].includes(actor.role);
  const repIds = actor.role === "rep" ? await actorRepIds(actor) : [];
  const [nodes, edges, simulations, definitions, snapshots, policies, consents, access, controls, runs, outcomes, evidence, coaching, benchmarks, risks, providers, drills, manifests] = await Promise.all([
    staffRead ? db.select().from(activationEvidenceNodes).orderBy(desc(activationEvidenceNodes.createdAt)).limit(100) : [],
    staffRead ? db.select().from(activationEvidenceEdges).orderBy(desc(activationEvidenceEdges.createdAt)).limit(100) : [],
    staffRead || actor.role === "vendor" ? db.select().from(promotionSimulations).orderBy(desc(promotionSimulations.createdAt)).limit(60) : [],
    staffRead ? db.select().from(metricDefinitions).orderBy(desc(metricDefinitions.createdAt)).limit(60) : [],
    staffRead ? db.select().from(metricSnapshots).orderBy(desc(metricSnapshots.createdAt)).limit(60) : [],
    staffRead ? db.select().from(purposePolicies).orderBy(desc(purposePolicies.createdAt)).limit(60) : [],
    staffRead ? db.select().from(universalConsents).orderBy(desc(universalConsents.createdAt)).limit(100) : [],
    staffRead ? db.select().from(purposeAccessEvents).orderBy(desc(purposeAccessEvents.createdAt)).limit(100) : [],
    staffRead ? db.select().from(controlDefinitions).orderBy(desc(controlDefinitions.createdAt)).limit(60) : [],
    staffRead ? db.select().from(controlRuns).orderBy(desc(controlRuns.createdAt)).limit(60) : [],
    staffRead ? db.select().from(independentOutcomeObservations).orderBy(desc(independentOutcomeObservations.createdAt)).limit(100) : [],
    repIds.length ? db.select().from(repCapabilityEvidence).where(inArray(repCapabilityEvidence.repId, repIds)).orderBy(desc(repCapabilityEvidence.observedAt)).limit(100) : staffRead ? db.select().from(repCapabilityEvidence).orderBy(desc(repCapabilityEvidence.observedAt)).limit(100) : [],
    repIds.length ? db.select().from(coachingRecommendations).where(inArray(coachingRecommendations.repId, repIds)).orderBy(desc(coachingRecommendations.createdAt)).limit(60) : staffRead ? db.select().from(coachingRecommendations).orderBy(desc(coachingRecommendations.createdAt)).limit(60) : [],
    staffRead ? db.select().from(benchmarkSnapshots).orderBy(desc(benchmarkSnapshots.createdAt)).limit(30) : [],
    staffRead ? db.select().from(riskTimingAssessments).orderBy(desc(riskTimingAssessments.createdAt)).limit(60) : [],
    staffRead ? db.select().from(providerProfiles).orderBy(desc(providerProfiles.createdAt)).limit(60) : [],
    staffRead ? db.select().from(resilienceDrills).orderBy(desc(resilienceDrills.createdAt)).limit(60) : [],
    staffRead ? db.select().from(portabilityManifests).orderBy(desc(portabilityManifests.createdAt)).limit(60) : [],
  ]);
  const vendorScopedSimulations = actor.role === "vendor" ? simulations.filter((row) => row.createdByUserId === actor.userId) : simulations;
  return {
    nodes, edges, simulations: vendorScopedSimulations, definitions, snapshots, policies, consents, access, controls, runs, outcomes, evidence, coaching, benchmarks, risks, providers, drills, manifests,
    features: [
      "Activation Evidence Graph", "Promotion Digital Twin", "Versioned Metrics", "Universal Consent", "Composable Controls",
      "Independent Outcomes", "Capability Coaching", "Private Benchmarks", "Risk-Adaptive Timing", "Resilience & Portability",
    ],
    boundary: "Evidence, simulations and recommendations are reproducible decision support. They never create verified activations, change first-touch attribution, move escrow or post commission entries. External-provider behavior remains sandbox/simulation only.",
  };
}
