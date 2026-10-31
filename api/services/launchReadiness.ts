import { asc, desc, eq } from "drizzle-orm";
import { auditLogs, launchGateEvents, launchGates, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { integrationConfiguration, requireProviderModeLive } from "./integrationConfig";

const catalog = [
  ["legal.vendor_commission_agreement", "legal", "Vendor commission agreement", "Executed template covers trigger rules, windows, caps, escrow and wind-down.", "Executed agreement and legal review reference."],
  ["legal.rep_contractor_agreement", "legal", "Rep contractor agreement", "Commission-only, non-exclusive contractor terms and dispute rights are approved.", "Approved template and in-app version reference."],
  ["legal.campus_endorsements_five", "legal", "Five campus endorsements", "Five non-exclusive, revocable Student Affairs endorsements are executed.", "Five signed letter references; no document contents in this console."],
  ["legal.ndpc_registration", "legal", "NDPC registration filed", "Registration has been filed by the responsible legal owner.", "External filing receipt and owner attestation."],
  ["legal.processor_dpas", "legal", "Processor DPAs executed", "Payment, KYC, cloud and messaging processor DPAs are executed.", "Executed DPA references for every processor."],
  ["finance.escrow_accounts_live", "finance", "Live escrow accounts funded", "Vendor escrow accounts are live and funded; the platform fronts no vendor money.", "Provider/account evidence reviewed by Finance."],
  ["finance.payout_runbook", "finance", "Payout runbook approved", "Daily payout operations, holds, retries and Finance recovery are assigned.", "Approved runbook and on-call ownership reference."],
  ["finance.reconciliation_evidence", "finance", "Reconciliation evidence ready", "Ledger, provider and bank-statement reconciliation is operating with real evidence.", "Real reconciliation report reference, not a supplied sandbox total."],
  ["finance.clawback_reserve", "finance", "Clawback reserve funded", "Four weeks of expected clawbacks are reserved from platform funds.", "Finance reserve calculation and funding evidence."],
  ["finance.withholding_process", "finance", "Withholding process approved", "Applicable withholding and reporting have professional ownership.", "Tax adviser-approved process and reporting calendar."],
  ["ops.campus_leads_five", "ops", "Five Campus Leads contracted", "Five launch campuses have contracted Campus Leads and assigned teams.", "Five contractor and assignment references."],
  ["ops.vendor_support_macros", "ops", "Vendor support macros approved", "Every pilot SKU has approved support macros and escalation ownership.", "Vendor approvals and macro version references."],
  ["ops.fraud_thresholds_staging", "ops", "Fraud thresholds tuned in staging", "Velocity and conduct thresholds were reviewed with staging evidence.", "Staging review record; local heuristics alone do not qualify."],
  ["ops.dispute_sla_rota", "ops", "Dispute SLA rota staffed", "Operations coverage and escalation ownership meet the dispute SLA.", "Approved rota and escalation contact reference."],
  ["engineering.slo_dashboards_seven_days", "engineering", "SLOs green for seven days", "Production-like SLO dashboards have been green for seven consecutive days.", "Seven-day external dashboard evidence and review."],
  ["engineering.pentest_fixes", "engineering", "Security review and pen-test fixes", "Independent security findings are remediated and accepted.", "External test report and closure approval reference."],
  ["engineering.backup_restore_drill", "engineering", "Production recovery evidence", "PITR, snapshots, immutable audit retention and RTO/RPO meet production policy.", "Production-environment restore drill evidence."],
  ["engineering.load_test_staging", "engineering", "Staging load gate passed", "Signed ingestion and representative journeys meet targets in staging.", "Staging load report; local sandbox results do not qualify."],
  ["engineering.parallel_run_zero_variance", "engineering", "Parallel run reconciles to zero", "One full manual-to-automated week reconciles to the ledger with ₦0 variance.", "Daily and weekly zero-variance reconciliation evidence."],
  ["product.three_vendors_live_cutover", "product", "Three pilot vendors cut over", "Three pilot vendors completed sandbox-to-production cutover.", "Three production integration acceptance references."],
  ["product.catalog_pricing_verified", "product", "Catalog pricing verified", "Catalog pricing and commission economics match approved vendor records.", "Deal Economics and vendor verification references."],
  ["product.kpi_instrumentation", "product", "Launch KPIs instrumented", "Required launch metrics are measured with traceable production data.", "Dashboard definitions and production data-quality review."],
  ["product.pilot_campus_dry_run", "product", "Pilot-campus dry run accepted", "The pilot campus completed an observed operational dry run.", "Campus Operations and Product acceptance reference."],
  ["product.production_cutover_authorization", "product", "Production cutover authorized", "Named accountable owners approved the production cutover after all other gates.", "External signed authorization; this console only records the attestation."],
  ["engineering.local_load_evidence", "engineering", "Optional local load evidence", "Local signed-load evidence is retained for engineering review, not launch credit.", "Local report identifier and measurement boundary."],
] as const;

let catalogReady: Promise<void> | undefined;

export async function ensureLaunchGateCatalog() {
  if (!catalogReady) {
    catalogReady = (async () => {
      await getDb().insert(launchGates).values(catalog.map(([gateKey, track, title, requirement, evidenceHint], index) => ({
        gateKey,
        track,
        title,
        requirement,
        evidenceHint,
        required: gateKey !== "engineering.local_load_evidence",
        sortOrder: (index + 1) * 10,
      }))).onConflictDoNothing();
    })().catch((error) => {
      catalogReady = undefined;
      throw error;
    });
  }
  return catalogReady;
}

function safeEvidenceText(value: string, label: string, min = 3, max = 2000) {
  const text = value.trim();
  if (text.length < min || text.length > max) throw new Error(`${label} must be ${min}–${max} characters`);
  if (/(?:bearer\s+\S+|sk_live_|github_pat_|ghp_|(?:secret|password|api[_-]?key|access[_-]?token)\s*[:=])/i.test(text)) {
    throw new Error(`${label} must not contain credentials or secret values`);
  }
  if (/(?:raw\s+(?:nin|bvn)|account[_ ]number\s*[:=])/i.test(text)) {
    throw new Error(`${label} must reference evidence without raw identity or bank-account values`);
  }
  return text;
}

export async function submitLaunchGateEvidence(input: {
  gateId: number;
  actorUserId: number;
  evidenceReference: string;
  note: string;
}) {
  const evidenceReference = safeEvidenceText(input.evidenceReference, "Evidence reference", 3, 500);
  const note = safeEvidenceText(input.note, "Evidence note", 10, 2000);
  return getDb().transaction(async (tx) => {
    const [gate] = await tx.select().from(launchGates).where(eq(launchGates.id, input.gateId)).limit(1).for("update");
    if (!gate) throw new Error("Launch gate not found");
    if (!["not_started", "rejected"].includes(gate.state)) {
      throw new Error("Only a not-started or rejected gate can receive new evidence");
    }
    const now = new Date();
    await tx.update(launchGates).set({
      state: "evidence_submitted",
      evidenceReference,
      evidenceNote: note,
      submittedByUserId: input.actorUserId,
      submittedAt: now,
      approvedByUserId: null,
      approvedAt: null,
      approvalReference: null,
      rejectionNote: null,
      updatedAt: now,
    }).where(eq(launchGates.id, gate.id));
    await tx.insert(launchGateEvents).values({
      gateId: gate.id,
      actorUserId: input.actorUserId,
      action: "evidence_submitted",
      fromState: gate.state,
      toState: "evidence_submitted",
      note,
      evidenceJson: { evidenceReference, boundary: "reference_only_no_files_or_secrets" },
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: "launch_gate.evidence_submitted",
      entityType: "launch_gate",
      entityId: gate.gateKey,
      metadataJson: { evidenceReference, required: gate.required },
    });
    return { gateId: gate.id, gateKey: gate.gateKey, state: "evidence_submitted" as const, independentApprovalRequired: true };
  });
}

async function decideLaunchGate(input: {
  gateId: number;
  actorUserId: number;
  decision: "approved" | "rejected";
  decisionReference: string;
  note: string;
}) {
  const decisionReference = safeEvidenceText(input.decisionReference, "Decision reference", 3, 500);
  const note = safeEvidenceText(input.note, "Decision note", 10, 2000);
  return getDb().transaction(async (tx) => {
    const [gate] = await tx.select().from(launchGates).where(eq(launchGates.id, input.gateId)).limit(1).for("update");
    if (!gate) throw new Error("Launch gate not found");
    if (gate.state !== "evidence_submitted") throw new Error("Only submitted evidence can be reviewed");
    if (gate.submittedByUserId === input.actorUserId) {
      throw new Error("Independent review is required; the evidence submitter cannot decide their own launch gate");
    }
    const now = new Date();
    await tx.update(launchGates).set({
      state: input.decision,
      approvedByUserId: input.decision === "approved" ? input.actorUserId : null,
      approvedAt: input.decision === "approved" ? now : null,
      approvalReference: input.decision === "approved" ? decisionReference : null,
      rejectionNote: input.decision === "rejected" ? note : null,
      updatedAt: now,
    }).where(eq(launchGates.id, gate.id));
    await tx.insert(launchGateEvents).values({
      gateId: gate.id,
      actorUserId: input.actorUserId,
      action: input.decision === "approved" ? "external_approval_attested" : "evidence_rejected",
      fromState: gate.state,
      toState: input.decision,
      note,
      evidenceJson: { decisionReference, externalDecisionAttested: true, externalSystemVerified: false },
    });
    await tx.insert(auditLogs).values({
      actorUserId: input.actorUserId,
      action: `launch_gate.${input.decision}`,
      entityType: "launch_gate",
      entityId: gate.gateKey,
      metadataJson: { decisionReference, independentReview: true, externalSystemVerified: false },
    });
    return { gateId: gate.id, gateKey: gate.gateKey, state: input.decision, externalSystemVerified: false };
  });
}

export async function approveLaunchGate(input: { gateId: number; actorUserId: number; approvalReference: string; note: string }) {
  return decideLaunchGate({ ...input, decision: "approved", decisionReference: input.approvalReference });
}

export async function rejectLaunchGate(input: { gateId: number; actorUserId: number; rejectionReference: string; note: string }) {
  return decideLaunchGate({ ...input, decision: "rejected", decisionReference: input.rejectionReference });
}

export async function getLaunchReadiness() {
  await ensureLaunchGateCatalog();
  const [gates, events, configuration] = await Promise.all([
    getDb().select().from(launchGates).orderBy(asc(launchGates.sortOrder), asc(launchGates.id)),
    getDb().select({ event: launchGateEvents, actorName: users.name }).from(launchGateEvents)
      .innerJoin(users, eq(launchGateEvents.actorUserId, users.id)).orderBy(desc(launchGateEvents.createdAt)).limit(150),
    Promise.resolve(integrationConfiguration()),
  ]);
  const required = gates.filter((gate) => gate.required);
  const approved = required.filter((gate) => gate.state === "approved");
  const submitted = required.filter((gate) => gate.state === "evidence_submitted");
  const rejected = required.filter((gate) => gate.state === "rejected");
  const allRequiredEvidenceApproved = required.length > 0 && approved.length === required.length;
  return {
    mode: "launch_readiness_control" as const,
    summary: {
      required: required.length,
      approved: approved.length,
      awaitingReview: submitted.length,
      rejected: rejected.length,
      notStarted: required.length - approved.length - submitted.length - rejected.length,
      allRequiredEvidenceApproved,
      canRequestExternalCutover: allRequiredEvidenceApproved,
      productionReady: false,
      boundary: "Readiness records are not live credentials, legal/security certification, provider activation or a production launch.",
    },
    gates,
    events: events.map(({ event, actorName }) => ({ ...event, actorName })),
    configuration,
  };
}

/** Guard for every live provider execution path. It deliberately fails closed. */
export async function assertLiveProviderExecutionAuthorized() {
  requireProviderModeLive();
  await ensureLaunchGateCatalog();
  const required = await getDb().select({ state: launchGates.state }).from(launchGates).where(eq(launchGates.required, true));
  if (!required.length || required.some((gate) => gate.state !== "approved")) {
    throw new Error("Live provider execution is blocked until every required launch gate has independent approval");
  }
  return true;
}
