import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  deals,
  products,
  reps,
  talentApplications,
  talentCampaigns,
  users,
  vendorConnectorProgressEvents,
  vendorExternalCustomerMappings,
  vendorOnboardingConnectors,
  vendorPromotions,
  vendorRepresentativeHandoffs,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { assertSalesRole, type SalesActor } from "./salesAccess";
import { talentHash, talentRef } from "./talentAccess";
import { createPromotionLink } from "./promotions";
import { hashCustomerRef, hashPhone, normalizePhone } from "./security";
import { ingestWithDurableRetry } from "./ingestionRetries";
import type { VendorEventInput } from "./events";

const verifiedStages = ["account_created", "kyc_complete", "funded", "first_transaction", "renewal", "refund"] as const;
type ConnectorStage = "clicked" | "registered" | "provisioned" | typeof verifiedStages[number];

function assertConnectorManager(actor: SalesActor) {
  assertSalesRole(actor, ["vendor", "ops", "admin"]);
}

async function accessibleConnector(actor: SalesActor, connectorId: number) {
  const db = getDb();
  const [row] = await db.select({ connector: vendorOnboardingConnectors, promotion: vendorPromotions, product: products, vendor: vendors }).from(vendorOnboardingConnectors)
    .innerJoin(vendorPromotions, eq(vendorOnboardingConnectors.promotionId, vendorPromotions.id))
    .innerJoin(products, eq(vendorPromotions.productId, products.id))
    .innerJoin(vendors, eq(vendorOnboardingConnectors.vendorId, vendors.id))
    .where(eq(vendorOnboardingConnectors.id, connectorId)).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor onboarding connector not found" });
  if (actor.role === "vendor" && actor.vendorId !== row.connector.vendorId) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor onboarding connector not found" });
  if (actor.role === "rep") {
    if (!actor.repId) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor onboarding connector not found" });
    const [handoff] = await db.select({ id: vendorRepresentativeHandoffs.id }).from(vendorRepresentativeHandoffs).where(and(eq(vendorRepresentativeHandoffs.connectorId, connectorId), eq(vendorRepresentativeHandoffs.repId, actor.repId))).limit(1);
    if (!handoff) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor onboarding connector not found" });
  }
  return row;
}

export async function createVendorConnector(input: { actor: SalesActor; promotionId: number; name: string; targetCount: number; successEvent: "kyc_complete" | "funded" | "first_transaction" | "renewal"; handoffMode: "signed_link" | "signed_link_and_sandbox_provisioning" }) {
  assertConnectorManager(input.actor);
  const db = getDb();
  const [promotion] = await db.select().from(vendorPromotions).where(eq(vendorPromotions.id, input.promotionId)).limit(1);
  if (!promotion || (input.actor.role === "vendor" && promotion.vendorId !== input.actor.vendorId)) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor promotion not found" });
  if (promotion.state !== "active") throw new TRPCError({ code: "CONFLICT", message: "Connector setup requires an independently approved active promotion" });
  const name = input.name.trim().slice(0, 180);
  if (name.length < 3 || !Number.isInteger(input.targetCount) || input.targetCount < 1 || input.targetCount > 1_000_000) throw new TRPCError({ code: "BAD_REQUEST", message: "A connector name and target between 1 and 1,000,000 are required" });
  const connectorRef = talentRef("KF-CON").toUpperCase();
  const [connector] = await db.insert(vendorOnboardingConnectors).values({ connectorRef, vendorId: promotion.vendorId, promotionId: promotion.id, name, targetCount: input.targetCount, successEvent: input.successEvent, handoffMode: input.handoffMode, executionMode: "sandbox", externalAccountCreation: false, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  if (!connector) throw new TRPCError({ code: "CONFLICT", message: "This promotion already has an onboarding connector" });
  await db.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "vendor_connector.created", entityType: "vendor_connector", entityId: String(connector.id), metadataJson: { promotionId: promotion.id, executionMode: "sandbox", externalAccountCreation: false, commissionCreated: false } });
  return { connectorId: connector.id, connectorRef, state: connector.state, executionMode: connector.executionMode, independentReviewRequired: true };
}

export async function reviewVendorConnector(input: { actor: SalesActor; connectorId: number; decision: "approved" | "rejected"; note: string }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  if (input.note.trim().length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "A connector review note is required" });
  return getDb().transaction(async (tx) => {
    const [connector] = await tx.select().from(vendorOnboardingConnectors).where(eq(vendorOnboardingConnectors.id, input.connectorId)).for("update").limit(1);
    if (!connector || connector.state !== "draft") throw new TRPCError({ code: "CONFLICT", message: "Connector is not awaiting review" });
    if (connector.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent connector review is required" });
    const [updated] = await tx.update(vendorOnboardingConnectors).set({ state: input.decision, reviewedByUserId: input.actor.userId, reviewedAt: new Date(), reviewNote: input.note.trim().slice(0, 2000), version: connector.version + 1, updatedAt: new Date() }).where(eq(vendorOnboardingConnectors.id, connector.id)).returning();
    return { connectorId: connector.id, state: updated.state, independentlyReviewed: true };
  });
}

export async function activateVendorConnector(input: { actor: SalesActor; connectorId: number }) {
  assertSalesRole(input.actor, ["ops", "admin"]);
  const { connector, promotion } = await accessibleConnector(input.actor, input.connectorId);
  if (connector.state !== "approved" || promotion.state !== "active") throw new TRPCError({ code: "CONFLICT", message: "An approved connector and active promotion are required" });
  const [updated] = await getDb().update(vendorOnboardingConnectors).set({ state: "active", version: connector.version + 1, updatedAt: new Date() }).where(and(eq(vendorOnboardingConnectors.id, connector.id), eq(vendorOnboardingConnectors.version, connector.version))).returning();
  return { connectorId: connector.id, state: updated.state, executionMode: "sandbox", externalAccountCreation: false };
}

export async function createRepresentativeHandoff(input: { actor: SalesActor; connectorId: number; repId: number; applicationId?: number; consentVersion: string; consentedAt: Date }) {
  assertConnectorManager(input.actor);
  const { connector } = await accessibleConnector(input.actor, input.connectorId);
  if (!["approved", "active"].includes(connector.state)) throw new TRPCError({ code: "CONFLICT", message: "Connector approval is required before representative selection" });
  if (input.consentVersion.trim().length < 3 || input.consentedAt > new Date()) throw new TRPCError({ code: "BAD_REQUEST", message: "Valid representative handoff consent is required" });
  const db = getDb();
  const [rep] = await db.select().from(reps).where(eq(reps.id, input.repId)).limit(1);
  if (!rep || rep.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "An active representative is required" });
  if (input.applicationId) {
    const [application] = await db.select({ application: talentApplications, campaign: talentCampaigns }).from(talentApplications).innerJoin(talentCampaigns, eq(talentApplications.campaignId, talentCampaigns.id)).where(eq(talentApplications.id, input.applicationId)).limit(1);
    if (!application || application.campaign.vendorId !== connector.vendorId || application.application.sourceRepId !== rep.id || !["accepted", "completed"].includes(application.application.currentStage)) throw new TRPCError({ code: "BAD_REQUEST", message: "The selected application must be an accepted or completed application sourced by this representative for the connector vendor" });
  }
  const externalReferenceHash = talentHash(`representative-handoff:${connector.id}:${rep.id}:${input.applicationId || "direct"}`);
  const [handoff] = await db.insert(vendorRepresentativeHandoffs).values({ connectorId: connector.id, repId: rep.id, applicationId: input.applicationId || null, externalReferenceHash, consentVersion: input.consentVersion.trim().slice(0, 100), consentedAt: input.consentedAt, createdByUserId: input.actor.userId, updatedByUserId: input.actor.userId }).onConflictDoNothing().returning();
  if (!handoff) throw new TRPCError({ code: "CONFLICT", message: "This representative already has a connector handoff" });
  return { handoffId: handoff.id, connectorId: connector.id, state: handoff.state, liveExternalAccountCreated: false, commissionCreated: false };
}

export async function acceptRepresentativeHandoff(input: { actor: SalesActor; handoffId: number; origin: string }) {
  assertSalesRole(input.actor, ["rep"]);
  if (!input.actor.repId) throw new TRPCError({ code: "FORBIDDEN", message: "A representative profile is required" });
  const db = getDb();
  const [handoff] = await db.select().from(vendorRepresentativeHandoffs).where(eq(vendorRepresentativeHandoffs.id, input.handoffId)).limit(1);
  if (!handoff || handoff.repId !== input.actor.repId) throw new TRPCError({ code: "NOT_FOUND", message: "Representative handoff not found" });
  if (handoff.state !== "selected") throw new TRPCError({ code: "CONFLICT", message: "Handoff has already been accepted or is no longer available" });
  const { connector, promotion } = await accessibleConnector(input.actor, handoff.connectorId);
  if (connector.state !== "active" || promotion.state !== "active") throw new TRPCError({ code: "CONFLICT", message: "Connector acquisition is not active" });
  const link = await createPromotionLink({ actor: input.actor, promotionId: promotion.id, origin: input.origin });
  const [updated] = await db.update(vendorRepresentativeHandoffs).set({ state: "handoff_ready", promotionLinkId: link.linkId, updatedByUserId: input.actor.userId, updatedAt: new Date() }).where(and(eq(vendorRepresentativeHandoffs.id, handoff.id), eq(vendorRepresentativeHandoffs.state, "selected"))).returning();
  return { handoffId: handoff.id, state: updated.state, link, externalAccountCreation: false, commissionCreated: false };
}

export async function markRepresentativeHandoffProvisioned(input: { actor: SalesActor; handoffId: number; evidenceNote: string }) {
  assertConnectorManager(input.actor);
  const db = getDb();
  const [handoff] = await db.select().from(vendorRepresentativeHandoffs).where(eq(vendorRepresentativeHandoffs.id, input.handoffId)).limit(1);
  if (!handoff) throw new TRPCError({ code: "NOT_FOUND", message: "Representative handoff not found" });
  await accessibleConnector(input.actor, handoff.connectorId);
  if (handoff.state !== "handoff_ready" || !handoff.promotionLinkId) throw new TRPCError({ code: "CONFLICT", message: "The representative must accept the signed-link handoff first" });
  if (input.evidenceNote.trim().length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Sandbox provisioning evidence is required" });
  const [updated] = await db.update(vendorRepresentativeHandoffs).set({ state: "sandbox_provisioned", provisionedAt: new Date(), evidenceNote: input.evidenceNote.trim().slice(0, 2000), updatedByUserId: input.actor.userId, updatedAt: new Date() }).where(eq(vendorRepresentativeHandoffs.id, handoff.id)).returning();
  return { handoffId: handoff.id, state: updated.state, executionMode: "sandbox", liveExternalAccountCreated: false, commissionCreated: false };
}

async function mappingForProgress(input: { connectorId: number; handoffId: number; externalCustomerRef: string; customerPhone: string; actorUserId: number }) {
  const db = getDb();
  const customerPhone = normalizePhone(input.customerPhone);
  const externalCustomerRef = input.externalCustomerRef.trim();
  if (externalCustomerRef.length < 3 || externalCustomerRef.length > 160) throw new TRPCError({ code: "BAD_REQUEST", message: "A bounded external customer reference is required" });
  const pseudonymHash = talentHash(`connector-customer:${input.connectorId}:${externalCustomerRef}`);
  const customerPhoneHash = hashPhone(customerPhone);
  const customerRefHash = hashCustomerRef(externalCustomerRef);
  const [existing] = await db.select().from(vendorExternalCustomerMappings).where(and(eq(vendorExternalCustomerMappings.connectorId, input.connectorId), eq(vendorExternalCustomerMappings.pseudonymHash, pseudonymHash))).limit(1);
  if (existing) {
    if (existing.handoffId !== input.handoffId || existing.customerPhoneHash !== customerPhoneHash || existing.customerRefHash !== customerRefHash) throw new TRPCError({ code: "CONFLICT", message: "External customer mapping does not match its original pseudonymous evidence" });
    return { mapping: existing, customerPhone, externalCustomerRef, customerPhoneHash, customerRefHash };
  }
  const [mapping] = await db.insert(vendorExternalCustomerMappings).values({ connectorId: input.connectorId, handoffId: input.handoffId, pseudonymHash, customerPhoneHash, customerRefHash, createdByUserId: input.actorUserId }).onConflictDoNothing().returning();
  if (!mapping) throw new TRPCError({ code: "CONFLICT", message: "Customer phone or pseudonym is already mapped to another connector identity" });
  return { mapping, customerPhone, externalCustomerRef, customerPhoneHash, customerRefHash };
}

export async function recordConnectorProgress(input: {
  actor: SalesActor;
  connectorId: number;
  handoffId: number;
  externalEventKey: string;
  stage: ConnectorStage;
  externalCustomerRef: string;
  customerPhone: string;
  amountKobo?: number;
  occurredAt: Date;
  webhookCredentialId?: number;
}) {
  assertConnectorManager(input.actor);
  const { connector, product, vendor } = await accessibleConnector(input.actor, input.connectorId);
  if (connector.state !== "active") throw new TRPCError({ code: "CONFLICT", message: "Connector is not active" });
  if (input.occurredAt > new Date(Date.now() + 5 * 60_000)) throw new TRPCError({ code: "BAD_REQUEST", message: "Progress event time cannot be in the future" });
  if (input.externalEventKey.trim().length < 8) throw new TRPCError({ code: "BAD_REQUEST", message: "A stable external event key is required for deduplication" });
  const db = getDb();
  const eventKeyHash = talentHash(`connector-event:${input.externalEventKey.trim()}`);
  const [duplicate] = await db.select().from(vendorConnectorProgressEvents).where(and(eq(vendorConnectorProgressEvents.connectorId, connector.id), eq(vendorConnectorProgressEvents.externalEventKeyHash, eventKeyHash))).limit(1);
  if (duplicate) return { progressEventId: duplicate.id, state: duplicate.verificationState, dealId: duplicate.dealId, idempotent: true, commissionCreated: false };
  const [handoff] = await db.select().from(vendorRepresentativeHandoffs).where(and(eq(vendorRepresentativeHandoffs.id, input.handoffId), eq(vendorRepresentativeHandoffs.connectorId, connector.id))).limit(1);
  if (!handoff || !handoff.promotionLinkId || !["handoff_ready", "sandbox_provisioned", "activated"].includes(handoff.state)) throw new TRPCError({ code: "CONFLICT", message: "Representative signed-link handoff is not ready" });
  const { mapping, customerPhone, externalCustomerRef, customerPhoneHash, customerRefHash } = await mappingForProgress({ connectorId: connector.id, handoffId: handoff.id, externalCustomerRef: input.externalCustomerRef, customerPhone: input.customerPhone, actorUserId: input.actor.userId });
  const payloadHash = talentHash({ eventKey: input.externalEventKey.trim(), stage: input.stage, customerPhoneHash, customerRefHash, amountKobo: input.amountKobo || null, occurredAt: input.occurredAt.toISOString() });
  let ingestion: Awaited<ReturnType<typeof ingestWithDurableRetry>> | null = null;
  if ((verifiedStages as readonly string[]).includes(input.stage)) {
    const payload: VendorEventInput = {
      event_id: `connector-${connector.id}-${input.externalEventKey.trim()}`.slice(0, 160),
      type: input.stage as typeof verifiedStages[number],
      occurred_at: input.occurredAt.toISOString(),
      customer: { phone: customerPhone, customer_ref: externalCustomerRef },
      product_ref: product.vendorRef,
      amount_kobo: input.amountKobo,
      meta: { connector_ref: connector.connectorRef, execution_mode: "sandbox" },
    };
    ingestion = await ingestWithDurableRetry(vendor.webhookKey, payload, {
      identifiers: { customerPhoneHash, customerRefHash },
      promotionLinkId: handoff.promotionLinkId,
      credentialId: input.webhookCredentialId || null,
    });
  }
  const dealId = ingestion && "deal_id" in ingestion ? ingestion.deal_id : null;
  const verificationState = !ingestion ? "observed" : ingestion.status === "accepted" ? "vendor_verified" : ingestion.status;
  const [event] = await db.insert(vendorConnectorProgressEvents).values({ connectorId: connector.id, mappingId: mapping.id, handoffId: handoff.id, externalEventKeyHash: eventKeyHash, stage: input.stage, verificationState, payloadHash, vendorEventId: ingestion && "kf_event_id" in ingestion ? ingestion.kf_event_id : null, dealId, occurredAt: input.occurredAt, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  if (!event) {
    const [concurrent] = await db.select().from(vendorConnectorProgressEvents).where(and(eq(vendorConnectorProgressEvents.connectorId, connector.id), eq(vendorConnectorProgressEvents.externalEventKeyHash, eventKeyHash))).limit(1);
    return { progressEventId: concurrent.id, state: concurrent.verificationState, dealId: concurrent.dealId, idempotent: true, commissionCreated: false };
  }
  if (dealId && !["activated"].includes(handoff.state)) await db.update(vendorRepresentativeHandoffs).set({ state: "activated", updatedByUserId: input.actor.userId, updatedAt: new Date() }).where(eq(vendorRepresentativeHandoffs.id, handoff.id));
  return { progressEventId: event.id, state: event.verificationState, dealId, idempotent: false, ingestionStatus: ingestion?.status || "not_commission_relevant", commissionCreated: !!dealId, liveExternalAccountCreated: false };
}

export async function listVendorConnectorWorkspace(actor: SalesActor) {
  const db = getDb();
  let connectorRows = await db.select({ connector: vendorOnboardingConnectors, promotion: vendorPromotions, product: products }).from(vendorOnboardingConnectors)
    .innerJoin(vendorPromotions, eq(vendorOnboardingConnectors.promotionId, vendorPromotions.id)).innerJoin(products, eq(vendorPromotions.productId, products.id)).orderBy(desc(vendorOnboardingConnectors.updatedAt)).limit(100);
  if (actor.role === "vendor") connectorRows = connectorRows.filter((row) => row.connector.vendorId === actor.vendorId);
  if (actor.role === "rep") {
    const own = actor.repId ? await db.select({ connectorId: vendorRepresentativeHandoffs.connectorId }).from(vendorRepresentativeHandoffs).where(eq(vendorRepresentativeHandoffs.repId, actor.repId)) : [];
    const ids = new Set(own.map((row) => row.connectorId));
    connectorRows = connectorRows.filter((row) => ids.has(row.connector.id));
  }
  const ids = connectorRows.map((row) => row.connector.id);
  const handoffs = ids.length ? await db.select({ handoff: vendorRepresentativeHandoffs, repCode: reps.code, representativeName: users.name }).from(vendorRepresentativeHandoffs).innerJoin(reps, eq(vendorRepresentativeHandoffs.repId, reps.id)).innerJoin(users, eq(reps.userId, users.id)).where(inArray(vendorRepresentativeHandoffs.connectorId, ids)).orderBy(desc(vendorRepresentativeHandoffs.updatedAt)) : [];
  const scopedHandoffs = actor.role === "rep" ? handoffs.filter((row) => row.handoff.repId === actor.repId) : handoffs;
  const events = ids.length && actor.role !== "rep" ? await db.select({ id: vendorConnectorProgressEvents.id, connectorId: vendorConnectorProgressEvents.connectorId, handoffId: vendorConnectorProgressEvents.handoffId, stage: vendorConnectorProgressEvents.stage, verificationState: vendorConnectorProgressEvents.verificationState, dealId: vendorConnectorProgressEvents.dealId, occurredAt: vendorConnectorProgressEvents.occurredAt }).from(vendorConnectorProgressEvents).where(inArray(vendorConnectorProgressEvents.connectorId, ids)).orderBy(desc(vendorConnectorProgressEvents.occurredAt)).limit(500) : [];
  const dealRows = ids.length ? await db.select({ id: deals.id, state: deals.state, triggerEvent: deals.triggerEvent, vendorId: deals.vendorId }).from(deals).innerJoin(vendorConnectorProgressEvents, eq(vendorConnectorProgressEvents.dealId, deals.id)).where(inArray(vendorConnectorProgressEvents.connectorId, ids)) : [];
  const representatives = ["vendor", "ops", "admin"].includes(actor.role) ? await db.select({ id: reps.id, code: reps.code, name: users.name }).from(reps).innerJoin(users, eq(reps.userId, users.id)).where(eq(reps.status, "active")).orderBy(users.name).limit(200) : [];
  const metrics = connectorRows.map((row) => {
    const ownEvents = events.filter((event) => event.connectorId === row.connector.id);
    const ownDealIds = new Set(ownEvents.filter((event) => event.dealId).map((event) => event.dealId));
    const ownDeals = dealRows.filter((deal) => ownDealIds.has(deal.id));
    const confirmed = ownDeals.filter((deal) => deal.triggerEvent === row.connector.successEvent && ["confirmed", "payable", "paid"].includes(deal.state)).length;
    return {
      connectorId: row.connector.id,
      target: row.connector.targetCount,
      clicked: ownEvents.filter((event) => event.stage === "clicked").length,
      registered: ownEvents.filter((event) => event.stage === "registered").length,
      vendorVerified: ownEvents.filter((event) => event.verificationState === "vendor_verified").length,
      acceptedDeals: ownDealIds.size,
      confirmedSuccessActivations: confirmed,
      progressPct: Math.min(100, Math.round(confirmed / row.connector.targetCount * 100)),
    };
  });
  const representativeMetrics = actor.role === "rep" ? ids.map((connectorId) => ({ connectorId, target: connectorRows.find((row) => row.connector.id === connectorId)?.connector.targetCount || 0, clicked: null, registered: null, vendorVerified: null, acceptedDeals: null, confirmedSuccessActivations: 0, progressPct: 0 })) : metrics;
  return {
    connectors: connectorRows,
    handoffs: scopedHandoffs,
    events,
    metrics: representativeMetrics,
    representatives,
    capabilities: { manage: ["vendor", "ops", "admin"].includes(actor.role), review: ["ops", "admin"].includes(actor.role), accept: actor.role === "rep", readOnly: actor.role === "finance" },
    boundary: "Clicks, registrations, ATS selection and sandbox provisioning are funnel evidence only. Only signed vendor events can enter the existing verified activation path. Customer KYC remains with the vendor. No live external account creation or production connector delivery is performed.",
  };
}
