import { asc, desc, eq, sql } from "drizzle-orm";
import { auditLogs, launchGateEvents, launchGates, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { integrationConfiguration, requireProviderModeLive } from "./integrationConfig";

const catalog = [
  ["legal.vendor_commission_agreement", "legal", "Vendor commission agreement", "The signed template covers when commission is earned, time limits, wallets and ending the deal.", "Executed agreement and legal review reference."],
  ["legal.rep_contractor_agreement", "legal", "Rep contractor agreement", "Commission-only, non-exclusive contractor terms and dispute rights are approved.", "Approved template and in-app version reference."],
  ["legal.campus_endorsements_five", "legal", "Five campus endorsements", "Five campuses' administrations have signed their support.", "Five signed letter references; no document contents in this console."],
  ["legal.ndpc_registration", "legal", "NDPC registration filed", "Registration has been filed by the responsible legal owner.", "The filing receipt, confirmed by the legal owner."],
  ["legal.processor_dpas", "legal", "Supplier data agreements signed", "Data processing agreements are signed with our payment, cloud and messaging suppliers.", "A reference for each signed agreement."],
  ["finance.escrow_accounts_live", "finance", "Vendor wallets funded with real money", "Vendor wallets hold real money, and KampusForce doesn't cover for any vendor.", "Provider/account evidence reviewed by Finance."],
  ["finance.payout_runbook", "finance", "Payout runbook approved", "Someone is assigned to run daily payouts, holds, retries and recovery.", "Approved runbook and on-call ownership reference."],
  ["finance.reconciliation_evidence", "finance", "Bank checks working", "Our records, Paystack and bank statements are being compared using real data.", "A real bank-check report, not test figures."],
  ["finance.clawback_reserve", "finance", "Refund reserve funded", "Four weeks of expected refunds are set aside from KampusForce's own money.", "Finance reserve calculation and funding evidence."],
  ["finance.withholding_process", "finance", "Tax process approved", "A tax professional owns withholding and reporting.", "Tax adviser-approved process and reporting calendar."],
  ["ops.campus_leads_five", "ops", "Five Campus Leads contracted", "Five launch campuses have contracted Campus Leads and assigned teams.", "Five contractor and assignment references."],
  ["ops.vendor_support_macros", "ops", "Vendor saved replies approved", "Every pilot product has approved saved replies and someone to escalate to.", "Vendor approvals and saved-reply references."],
  ["ops.fraud_thresholds_staging", "ops", "Fraud limits tested", "Sales limits and conduct rules were reviewed in a test environment.", "A record of that review."],
  ["ops.dispute_sla_rota", "ops", "Dispute rota staffed", "Enough Operations staff to answer disputes on time.", "Approved rota and escalation contact reference."],
  ["engineering.slo_dashboards_seven_days", "engineering", "Reliable for seven days", "The site has met its reliability targets for seven days in a row.", "Seven days of dashboard results, reviewed."],
  ["engineering.pentest_fixes", "engineering", "Security test passed", "An outside security test was done and its findings fixed.", "External test report and closure approval reference."],
  ["engineering.backup_restore_drill", "engineering", "Backups tested", "We've restored from backup and it meets our recovery targets.", "Results of a restore drill."],
  ["engineering.load_test_staging", "engineering", "Load test passed", "The site handled the expected traffic in a test environment.", "A load test report."],
  ["engineering.parallel_run_zero_variance", "engineering", "Trial week matches exactly", "One full week run by hand and by the system matched with ₦0 difference.", "Daily and weekly comparison reports."],
  ["product.three_vendors_live_cutover", "product", "Three vendors live", "Three pilot vendors have moved from test to live.", "Three sign-offs, one per vendor."],
  ["product.catalog_pricing_verified", "product", "Catalog pricing verified", "Prices and commission match what vendors approved.", "Vendor sign-off references."],
  ["product.kpi_instrumentation", "product", "Launch numbers tracked", "We can measure the launch numbers with real data.", "Dashboard details and a data-quality review."],
  ["product.pilot_campus_dry_run", "product", "Pilot campus trial accepted", "A pilot campus finished a supervised trial.", "Campus Operations and Product acceptance reference."],
  ["product.production_cutover_authorization", "product", "Go-live approved", "Named owners approved going live, after everything else was done.", "A signed approval kept outside KampusForce; this page only records that it exists."],
  ["engineering.local_load_evidence", "engineering", "Optional load test", "Extra load test results for engineers. This doesn't count towards launch.", "Local report identifier and measurement boundary."],
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
      }))).onConflictDoUpdate({ target: launchGates.gateKey, set: { title: sql`excluded.title`, requirement: sql`excluded.requirement`, evidenceHint: sql`excluded.evidence_hint` } });
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
      boundary: "This page only records what's been checked. It doesn't switch on real money or prove legal or security compliance.",
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
