import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  attributionRecords,
  auditLogs,
  breachAssessmentEvents,
  breachAssessments,
  consentLogs,
  deals,
  dsarRequestEvents,
  dsarRequests,
  products,
  supportTickets,
  users,
  vendors,
  type BreachAssessment,
  type DsarRequest,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { hashPhone } from "./security";
import { notifyOperations } from "./notifications";
import {
  breachTriageDueAt,
  canExportDsar,
  dsarDueAt,
  type DsarLifecycleState,
} from "./privacyPolicy";

function caseRef(prefix: "DSAR" | "BR") {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createDsarRequest(input: {
  actorUserId: number;
  customerPhone: string;
  requestType: DsarRequest["requestType"];
  receivedAt?: Date;
}) {
  let customerPhoneHash: string;
  try {
    customerPhoneHash = hashPhone(input.customerPhone);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid Nigerian phone number" });
  }
  const receivedAt = input.receivedAt || new Date();
  const dueAt = dsarDueAt(receivedAt);
  const requestRef = caseRef("DSAR");
  const created = await getDb().transaction(async (tx) => {
    const [request] = await tx.insert(dsarRequests).values({
      requestRef,
      customerPhoneHash,
      requestType: input.requestType,
      ownerUserId: input.actorUserId,
      receivedAt,
      dueAt,
    }).returning();
    await tx.insert(dsarRequestEvents).values({
      requestId: request.id,
      actorUserId: input.actorUserId,
      action: "received",
      toState: "received",
      note: "Operations registered the request using a salted customer-phone hash.",
      evidenceJson: { requestType: request.requestType, dueAt: dueAt.toISOString() },
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: "privacy.dsar.received",
      entityType: "dsar_request",
      entityId: String(request.id),
      metadataJson: { requestRef, requestType: request.requestType, dueAt: dueAt.toISOString() },
    });
    return request;
  });
  await notifyOperations({
    type: "privacy_dsar",
    title: `DSAR registered: ${requestRef}`,
    body: `A ${created.requestType} request is due ${dueAt.toISOString()}. Identity verification is required before evidence export.`,
    href: "/ops",
    entityType: "dsar_request",
    entityId: created.id,
  });
  return { requestId: created.id, requestRef, state: created.state, dueAt };
}

async function transitionDsar(input: {
  requestId: number;
  actorUserId: number;
  allowedFrom: DsarLifecycleState[];
  toState: DsarLifecycleState;
  action: string;
  note: string;
}) {
  return getDb().transaction(async (tx) => {
    const [request] = await tx.select().from(dsarRequests).where(eq(dsarRequests.id, input.requestId)).limit(1).for("update");
    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "DSAR request not found" });
    if (!input.allowedFrom.includes(request.state)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `DSAR cannot move from ${request.state} to ${input.toState}` });
    }
    const now = new Date();
    await tx.update(dsarRequests).set({
      state: input.toState,
      verifiedByUserId: input.toState === "identity_verified" ? input.actorUserId : request.verifiedByUserId,
      verifiedAt: input.toState === "identity_verified" ? now : request.verifiedAt,
      completedAt: ["fulfilled", "rejected"].includes(input.toState) ? now : request.completedAt,
      outcomeNote: ["fulfilled", "rejected"].includes(input.toState) ? input.note : request.outcomeNote,
      updatedAt: now,
    }).where(eq(dsarRequests.id, request.id));
    await tx.insert(dsarRequestEvents).values({
      requestId: request.id,
      actorUserId: input.actorUserId,
      action: input.action,
      fromState: request.state,
      toState: input.toState,
      note: input.note,
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: `privacy.dsar.${input.action}`,
      entityType: "dsar_request",
      entityId: String(request.id),
      metadataJson: { requestRef: request.requestRef, fromState: request.state, toState: input.toState },
    });
    return { requestId: request.id, requestRef: request.requestRef, state: input.toState, updatedAt: now };
  });
}

export function verifyDsarIdentity(requestId: number, actorUserId: number, verificationNote: string) {
  return transitionDsar({ requestId, actorUserId, allowedFrom: ["received"], toState: "identity_verified", action: "identity_verified", note: verificationNote });
}

export function startDsarReview(requestId: number, actorUserId: number) {
  return transitionDsar({
    requestId,
    actorUserId,
    allowedFrom: ["identity_verified"],
    toState: "in_review",
    action: "review_started",
    note: "Operations started review of the scoped customer records.",
  });
}

export function fulfilDsarRequest(requestId: number, actorUserId: number, outcomeNote: string) {
  return transitionDsar({ requestId, actorUserId, allowedFrom: ["in_review"], toState: "fulfilled", action: "fulfilled", note: outcomeNote });
}

export function rejectDsarRequest(requestId: number, actorUserId: number, outcomeNote: string) {
  return transitionDsar({
    requestId,
    actorUserId,
    allowedFrom: ["received", "identity_verified", "in_review"],
    toState: "rejected",
    action: "rejected",
    note: outcomeNote,
  });
}

export async function exportDsarEvidence(requestId: number, actorUserId: number) {
  return getDb().transaction(async (tx) => {
    const [request] = await tx.select().from(dsarRequests).where(eq(dsarRequests.id, requestId)).limit(1).for("update");
    if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "DSAR request not found" });
    if (!canExportDsar(request.state)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Verify the requester's identity before exporting evidence" });
    }
    const customerHash = request.customerPhoneHash;
    const [attributions, activations, support, consent] = await Promise.all([
      tx.select({
        attributionId: attributionRecords.id,
        vendorName: vendors.companyName,
        productName: products.name,
        source: attributionRecords.source,
        status: attributionRecords.status,
        firstTouchAt: attributionRecords.firstTouchAt,
      }).from(attributionRecords)
        .innerJoin(vendors, eq(attributionRecords.vendorId, vendors.id))
        .innerJoin(products, eq(attributionRecords.productId, products.id))
        .where(eq(attributionRecords.customerPhoneHash, customerHash))
        .orderBy(desc(attributionRecords.firstTouchAt)),
      tx.select({
        dealId: deals.id,
        vendorName: vendors.companyName,
        productName: products.name,
        triggerEvent: deals.triggerEvent,
        state: deals.state,
        createdAt: deals.createdAt,
      }).from(deals)
        .innerJoin(vendors, eq(deals.vendorId, vendors.id))
        .innerJoin(products, eq(deals.productId, products.id))
        .where(eq(deals.customerPhoneHash, customerHash))
        .orderBy(desc(deals.createdAt)),
      tx.select({
        ticketRef: supportTickets.ticketRef,
        vendorName: vendors.companyName,
        category: supportTickets.category,
        priority: supportTickets.priority,
        state: supportTickets.state,
        createdAt: supportTickets.createdAt,
        resolvedAt: supportTickets.resolvedAt,
        closedAt: supportTickets.closedAt,
      }).from(supportTickets)
        .innerJoin(vendors, eq(supportTickets.vendorId, vendors.id))
        .where(eq(supportTickets.customerPhoneHash, customerHash))
        .orderBy(desc(supportTickets.createdAt)),
      tx.select({
        purpose: consentLogs.purpose,
        policyVersion: consentLogs.policyVersion,
        grantedAt: consentLogs.grantedAt,
      }).from(consentLogs).where(eq(consentLogs.phoneHash, customerHash)).orderBy(desc(consentLogs.grantedAt)),
    ]);
    const generatedAt = new Date();
    const evidence = {
      format: "kampusforce_privacy_evidence_v1",
      mode: "sandbox_records" as const,
      requestRef: request.requestRef,
      requestType: request.requestType,
      requestState: request.state,
      customerReference: { type: "salted_sha256_phone_hash" as const, hash: customerHash },
      generatedAt,
      dueAt: request.dueAt,
      records: { attributions, activations, support, consent },
      exclusions: [
        "Raw phone numbers, NIN, BVN, bank details and access tokens",
        "Support free text, vendor event payloads and unrelated representative or financial records",
      ],
      handlingNote: "Record-derived metadata for authorized Operations review; not a statutory completeness or legal-compliance certification.",
    };
    const counts = {
      attributions: attributions.length,
      activations: activations.length,
      support: support.length,
      consent: consent.length,
    };
    await tx.insert(dsarRequestEvents).values({
      requestId,
      actorUserId,
      action: "evidence_exported",
      fromState: request.state,
      toState: request.state,
      note: "Privacy-safe metadata export generated for authorized Operations review.",
      evidenceJson: { generatedAt: generatedAt.toISOString(), counts },
    });
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "privacy.dsar.evidence_exported",
      entityType: "dsar_request",
      entityId: String(requestId),
      metadataJson: { requestRef: request.requestRef, counts },
    });
    return { fileName: `${request.requestRef.toLowerCase()}-evidence.json`, evidence };
  });
}

export async function createBreachAssessment(input: {
  actorUserId: number;
  title: string;
  summary: string;
  detectedAt?: Date;
}) {
  const detectedAt = input.detectedAt || new Date();
  const triageDueAt = breachTriageDueAt(detectedAt);
  const assessmentRef = caseRef("BR");
  const created = await getDb().transaction(async (tx) => {
    const [assessment] = await tx.insert(breachAssessments).values({
      assessmentRef,
      title: input.title,
      summary: input.summary,
      createdByUserId: input.actorUserId,
      detectedAt,
      triageDueAt,
    }).returning();
    await tx.insert(breachAssessmentEvents).values({
      assessmentId: assessment.id,
      actorUserId: input.actorUserId,
      action: "reported",
      toState: "reported",
      note: "Breach assessment opened; no external notification has been sent.",
      evidenceJson: { detectedAt: detectedAt.toISOString(), triageDueAt: triageDueAt.toISOString() },
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: "privacy.breach.reported",
      entityType: "breach_assessment",
      entityId: String(assessment.id),
      metadataJson: { assessmentRef, triageDueAt: triageDueAt.toISOString() },
    });
    return assessment;
  });
  await notifyOperations({
    type: "privacy_breach",
    title: `Breach triage opened: ${assessmentRef}`,
    body: `Record the risk and notification decision by ${triageDueAt.toISOString()}. No regulator notification is sent by this sandbox.`,
    href: "/ops",
    entityType: "breach_assessment",
    entityId: created.id,
  });
  return { assessmentId: created.id, assessmentRef, state: created.state, triageDueAt };
}

export async function startBreachAssessment(assessmentId: number, actorUserId: number) {
  return getDb().transaction(async (tx) => {
    const [assessment] = await tx.select().from(breachAssessments).where(eq(breachAssessments.id, assessmentId)).limit(1).for("update");
    if (!assessment) throw new TRPCError({ code: "NOT_FOUND", message: "Breach assessment not found" });
    if (assessment.state !== "reported") throw new TRPCError({ code: "BAD_REQUEST", message: "Only reported assessments can enter triage" });
    const now = new Date();
    await tx.update(breachAssessments).set({ state: "assessing", updatedAt: now }).where(eq(breachAssessments.id, assessmentId));
    await tx.insert(breachAssessmentEvents).values({
      assessmentId,
      actorUserId,
      action: "assessment_started",
      fromState: "reported",
      toState: "assessing",
      note: "Operations accepted the 72-hour assessment workflow.",
    });
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "privacy.breach.assessment_started",
      entityType: "breach_assessment",
      entityId: String(assessmentId),
      metadataJson: { assessmentRef: assessment.assessmentRef },
    });
    return { assessmentId, state: "assessing" as const, updatedAt: now };
  });
}

export async function recordBreachDecision(input: {
  assessmentId: number;
  actorUserId: number;
  risk: BreachAssessment["risk"];
  notificationDecision: Exclude<BreachAssessment["notificationDecision"], "pending">;
  notificationOwnerUserId: number;
  decisionNote: string;
}) {
  return getDb().transaction(async (tx) => {
    const [assessment] = await tx.select().from(breachAssessments).where(eq(breachAssessments.id, input.assessmentId)).limit(1).for("update");
    if (!assessment) throw new TRPCError({ code: "NOT_FOUND", message: "Breach assessment not found" });
    if (assessment.state !== "assessing") throw new TRPCError({ code: "BAD_REQUEST", message: "Start the assessment before recording a decision" });
    if (!input.risk) throw new TRPCError({ code: "BAD_REQUEST", message: "A breach risk rating is required" });
    const [owner] = await tx.select({ id: users.id, role: users.role }).from(users).where(and(
      eq(users.id, input.notificationOwnerUserId),
      inArray(users.role, ["ops", "admin"]),
    )).limit(1);
    if (!owner) throw new TRPCError({ code: "BAD_REQUEST", message: "Notification ownership must belong to Operations or Admin" });
    const now = new Date();
    await tx.update(breachAssessments).set({
      state: "decision_recorded",
      risk: input.risk,
      notificationDecision: input.notificationDecision,
      notificationOwnerUserId: owner.id,
      decisionNote: input.decisionNote,
      decisionAt: now,
      updatedAt: now,
    }).where(eq(breachAssessments.id, assessment.id));
    await tx.insert(breachAssessmentEvents).values({
      assessmentId: assessment.id,
      actorUserId: input.actorUserId,
      action: "decision_recorded",
      fromState: assessment.state,
      toState: "decision_recorded",
      note: input.decisionNote,
      evidenceJson: {
        risk: input.risk,
        notificationDecision: input.notificationDecision,
        notificationOwnerUserId: owner.id,
        externalNotificationSent: false,
      },
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: "privacy.breach.decision_recorded",
      entityType: "breach_assessment",
      entityId: String(assessment.id),
      metadataJson: {
        assessmentRef: assessment.assessmentRef,
        risk: input.risk,
        notificationDecision: input.notificationDecision,
        notificationOwnerUserId: owner.id,
        externalNotificationSent: false,
      },
    });
    return { assessmentId: assessment.id, state: "decision_recorded" as const, decisionAt: now, externalNotificationSent: false };
  });
}

export async function closeBreachAssessment(assessmentId: number, actorUserId: number, closureNote: string) {
  return getDb().transaction(async (tx) => {
    const [assessment] = await tx.select().from(breachAssessments).where(eq(breachAssessments.id, assessmentId)).limit(1).for("update");
    if (!assessment) throw new TRPCError({ code: "NOT_FOUND", message: "Breach assessment not found" });
    if (assessment.state !== "decision_recorded") throw new TRPCError({ code: "BAD_REQUEST", message: "Record the risk and notification decision before closure" });
    const now = new Date();
    await tx.update(breachAssessments).set({ state: "closed", closureNote, closedAt: now, updatedAt: now }).where(eq(breachAssessments.id, assessmentId));
    await tx.insert(breachAssessmentEvents).values({
      assessmentId,
      actorUserId,
      action: "closed",
      fromState: assessment.state,
      toState: "closed",
      note: closureNote,
      evidenceJson: { externalNotificationSent: false },
    });
    await tx.insert(auditLogs).values({
      actorUserId,
      action: "privacy.breach.closed",
      entityType: "breach_assessment",
      entityId: String(assessmentId),
      metadataJson: { assessmentRef: assessment.assessmentRef, externalNotificationSent: false },
    });
    return { assessmentId, state: "closed" as const, closedAt: now, externalNotificationSent: false };
  });
}

export async function listPrivacyDesk() {
  const db = getDb();
  const [requests, requestEvents, assessments, assessmentEvents, owners] = await Promise.all([
    db.select().from(dsarRequests).orderBy(desc(dsarRequests.createdAt)).limit(100),
    db.select().from(dsarRequestEvents).orderBy(desc(dsarRequestEvents.createdAt)).limit(200),
    db.select().from(breachAssessments).orderBy(desc(breachAssessments.createdAt)).limit(100),
    db.select().from(breachAssessmentEvents).orderBy(desc(breachAssessmentEvents.createdAt)).limit(200),
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.role, ["ops", "admin"])).orderBy(users.name),
  ]);
  return { requests, requestEvents, assessments, assessmentEvents, owners };
}
