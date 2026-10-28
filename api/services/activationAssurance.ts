import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { activationRiskCases, deals, reps, vendorEvents } from "@db/schema";
import { getDb } from "../queries/connection";
import { randomReference } from "./security";
import { createAssuranceFraudCase } from "./fraud";
import { assuranceSignalBlocks, EARLY_REFUND_WINDOW_DAYS, REPEATED_CUSTOMER_THRESHOLD } from "./assurancePolicy";
import { assuranceReferenceHash, recordAssuranceEvent, resolveLinkedFraudCase, type AssuranceTransaction } from "./assuranceCommon";

const db = () => getDb();

type RiskKind = typeof activationRiskCases.$inferInsert.kind;
type RiskSeverity = typeof activationRiskCases.$inferInsert.severity;

async function openActivationRisk(tx: AssuranceTransaction, input: {
  dealId: number;
  kind: RiskKind;
  severity: RiskSeverity;
  evidenceHash: string;
  signalCount?: number;
  actorUserId: number | null;
}) {
  const [deal] = await tx.select().from(deals).where(eq(deals.id, input.dealId)).limit(1).for("update");
  if (!deal) throw new Error("Activation deal not found");
  const [existing] = await tx.select().from(activationRiskCases)
    .where(and(eq(activationRiskCases.dealId, deal.id), eq(activationRiskCases.kind, input.kind), eq(activationRiskCases.evidenceHash, input.evidenceHash))).limit(1);
  if (existing) return { riskCase: existing, created: false };
  const [riskCase] = await tx.insert(activationRiskCases).values({
    caseRef: randomReference("quality"), dealId: deal.id, repId: deal.repId, vendorId: deal.vendorId,
    kind: input.kind, severity: input.severity, evidenceHash: input.evidenceHash, signalCount: input.signalCount || 1,
  }).returning();
  let fraudCaseId: number | null = null;
  if (assuranceSignalBlocks(riskCase.state, riskCase.severity)) {
    const fraud = await createAssuranceFraudCase(tx, {
      repId: deal.repId,
      kind: "activation_quality_review",
      reason: `${input.kind.replaceAll("_", " ")} signal ${riskCase.caseRef}; payout delayed for human review, not an automatic fraud finding`,
      evidenceJson: { activationRiskCaseRef: riskCase.caseRef, dealId: deal.id, severity: input.severity, signalCount: riskCase.signalCount, financialReversalAutomatic: false },
      actorUserId: input.actorUserId,
    });
    fraudCaseId = fraud.fraudCase.id;
  }
  const [updated] = await tx.update(activationRiskCases).set({ fraudCaseId }).where(eq(activationRiskCases.id, riskCase.id)).returning();
  await recordAssuranceEvent(tx, {
    caseType: "activation_risk", caseId: riskCase.id, actorUserId: input.actorUserId, action: "activation_quality.signal_detected", toState: "open",
    payload: { kind: input.kind, severity: input.severity, signalCount: riskCase.signalCount, payoutDelay: !!fraudCaseId, signalProvesFraud: false },
  });
  return { riskCase: updated, created: true };
}

export async function recordActivationQualitySignal(input: {
  dealId: number;
  actorUserId: number;
  kind: RiskKind;
  severity: RiskSeverity;
  evidenceReference: string;
  signalCount?: number;
}) {
  const evidenceHash = assuranceReferenceHash("activation-quality", input.kind, input.evidenceReference);
  return db().transaction(async (tx) => openActivationRisk(tx, { ...input, evidenceHash }));
}

export async function sweepActivationQuality(actorUserId: number | null = null) {
  const refundRows = await db().select({ deal: deals, refund: vendorEvents }).from(deals)
    .innerJoin(vendorEvents, and(
      eq(vendorEvents.dealId, deals.id),
      eq(vendorEvents.type, "refund"),
      eq(vendorEvents.status, "processed"),
    ))
    .orderBy(desc(vendorEvents.receivedAt)).limit(2000);
  const earliestRefund = new Map<number, typeof refundRows[number]>();
  for (const row of refundRows) {
    const existing = earliestRefund.get(row.deal.id);
    if (!existing || row.refund.receivedAt < existing.refund.receivedAt) earliestRefund.set(row.deal.id, row);
  }
  let earlyRefunds = 0;
  for (const { deal, refund } of earliestRefund.values()) {
    if (!deal.createdAt) continue;
    const elapsed = refund.receivedAt.getTime() - deal.createdAt.getTime();
    if (elapsed < 0 || elapsed > EARLY_REFUND_WINDOW_DAYS * 86_400_000) continue;
    const evidenceHash = createHash("sha256").update(`early-refund:v1:${deal.id}:${refund.id}`).digest("hex");
    const result = await db().transaction(async (tx) => openActivationRisk(tx, { dealId: deal.id, kind: "early_refund", severity: "high", evidenceHash, actorUserId }));
    if (result.created) earlyRefunds += 1;
  }

  const confirmedDeals = await db().select().from(deals).where(inArray(deals.state, ["confirmed", "payable", "paid"])).orderBy(deals.id).limit(5000);
  const customerGroups = new Map<string, typeof confirmedDeals>();
  for (const deal of confirmedDeals) {
    const key = `${deal.vendorId}:${deal.customerPhoneHash}`;
    customerGroups.set(key, [...(customerGroups.get(key) || []), deal]);
  }
  let repeatedCustomers = 0;
  for (const [key, group] of customerGroups) {
    if (group.length < REPEATED_CUSTOMER_THRESHOLD) continue;
    for (const deal of group) {
      const evidenceHash = createHash("sha256").update(`repeated-customer:v1:${key}:${deal.id}`).digest("hex");
      const result = await db().transaction(async (tx) => openActivationRisk(tx, { dealId: deal.id, kind: "repeated_customer", severity: "warning", evidenceHash, signalCount: group.length, actorUserId }));
      if (result.created) repeatedCustomers += 1;
    }
  }
  return { earlyRefunds, repeatedCustomers, scannedDeals: confirmedDeals.length, automaticFraudConclusions: 0 };
}

export async function reviewActivationQualityCase(input: { caseId: number; actorUserId: number; decision: "clear" | "confirm"; reason: string }) {
  return db().transaction(async (tx) => {
    const [item] = await tx.select().from(activationRiskCases).where(eq(activationRiskCases.id, input.caseId)).limit(1).for("update");
    if (!item) throw new Error("Activation-quality case not found");
    if (item.state !== "open") throw new Error("Only an open activation-quality case can be reviewed");
    const [rep] = await tx.select().from(reps).where(eq(reps.id, item.repId)).limit(1);
    if (rep?.userId === input.actorUserId) throw new Error("Representatives cannot review their own activation-quality case");
    const state = input.decision === "clear" ? "cleared" : "confirmed";
    await resolveLinkedFraudCase(tx, item.fraudCaseId, input.actorUserId, input.decision === "clear" ? "release" : "uphold", input.reason);
    const [updated] = await tx.update(activationRiskCases).set({ state, reviewedByUserId: input.actorUserId, reviewedAt: new Date(), reviewReason: input.reason, updatedAt: new Date() }).where(eq(activationRiskCases.id, item.id)).returning();
    await recordAssuranceEvent(tx, { caseType: "activation_risk", caseId: item.id, actorUserId: input.actorUserId, action: `activation_quality.${state}`, fromState: "open", toState: state, payload: { financialReversalAutomatic: false, dealStateChanged: false } });
    return updated;
  });
}
