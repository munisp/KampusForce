import { createHash, randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, min, sql, sum } from "drizzle-orm";
import {
  analyticsSnapshots,
  campuses,
  dataPlatformRuns,
  deals,
  dealStateHistory,
  financialPostingOutbox,
  payouts,
  reconciliationRuns,
  reps,
  supportTickets,
  vendorEvents,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";

const numberSum = (value: string | null) => Number(value || 0);
const percent = (part: number, whole: number) => whole ? Math.round((part / whole) * 10_000) / 100 : 0;

export type AnalyticsWindow = 7 | 30 | 90 | 365;

export function analyticsAnomalies(input: {
  quarantineRate: number;
  pendingPostings: number;
  failedPostings: number;
  reconciliationVariances: number;
  confirmedActivations: number;
  processedEvents: number;
}) {
  const findings: { code: string; severity: "info" | "warning" | "critical"; detail: string }[] = [];
  if (input.quarantineRate > 5) findings.push({ code: "event_quality", severity: "warning", detail: "More than 5% of vendor events are quarantined; investigate source schema and signature quality." });
  if (input.failedPostings) findings.push({ code: "financial_outbox_failed", severity: "critical", detail: `${input.failedPostings} financial posting groups require reconciliation before any TigerBeetle cutover.` });
  if (input.pendingPostings) findings.push({ code: "financial_outbox_backlog", severity: "info", detail: `${input.pendingPostings} posting groups await an external core; PostgreSQL remains the accountable sandbox ledger.` });
  if (input.reconciliationVariances) findings.push({ code: "reconciliation_variance", severity: "critical", detail: `${input.reconciliationVariances} recent reconciliation runs contain unresolved variance.` });
  if (input.processedEvents >= 10 && input.confirmedActivations === 0) findings.push({ code: "activation_conversion", severity: "warning", detail: "Processed events have not produced confirmed activations in this window." });
  return findings;
}

export function buildConversionCohorts(rows: { dealId: number; createdAt: Date | string; firstConfirmedAt: Date | string | null }[], now = new Date()) {
  const cohorts = new Map<string, { week: string; activations: number; matureActivations: number; confirmedWithin7Days: number }>();
  for (const row of rows) {
    const created = new Date(row.createdAt);
    const weekDate = new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate()));
    weekDate.setUTCDate(weekDate.getUTCDate() - ((weekDate.getUTCDay() + 6) % 7));
    const week = weekDate.toISOString().slice(0, 10);
    const cohort = cohorts.get(week) || { week, activations: 0, matureActivations: 0, confirmedWithin7Days: 0 };
    cohort.activations += 1;
    if (now.getTime() - created.getTime() >= 7 * 86_400_000) cohort.matureActivations += 1;
    if (row.firstConfirmedAt) {
      const confirmationDelay = new Date(row.firstConfirmedAt).getTime() - created.getTime();
      if (confirmationDelay >= 0 && confirmationDelay <= 7 * 86_400_000) cohort.confirmedWithin7Days += 1;
    }
    cohorts.set(week, cohort);
  }
  return [...cohorts.values()]
    .map((cohort) => ({ ...cohort, conversionWithin7Days: percent(cohort.confirmedWithin7Days, cohort.matureActivations) }))
    .sort((a, b) => b.week.localeCompare(a.week))
    .slice(0, 12);
}

export async function buildAdvancedAnalytics(windowDays: AnalyticsWindow) {
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const dealCreationDay = sql<string>`date_trunc('day', ${deals.createdAt})::date`;
  const firstConfirmations = db.select({
    dealId: dealStateHistory.dealId,
    firstConfirmedAt: min(dealStateHistory.createdAt).as("first_confirmed_at"),
  }).from(dealStateHistory).where(eq(dealStateHistory.toState, "confirmed")).groupBy(dealStateHistory.dealId).as("first_confirmations");
  const confirmationDay = sql<string>`date_trunc('day', ${firstConfirmations.firstConfirmedAt})::date`;
  const [dealStates, campusRows, vendorRows, eventRows, payoutRows, caseRows, outboxRows, reconciliations, latestRuns, snapshots, activationDays, confirmationDays, cohortDeals] = await Promise.all([
    db.select({ state: deals.state, count: count(), vendorKobo: sum(deals.vendorCommissionKobo), repKobo: sum(deals.repCommissionKobo), platformKobo: sum(deals.platformFeeKobo) }).from(deals).where(gte(deals.createdAt, since)).groupBy(deals.state),
    db.select({ campusId: campuses.id, campus: campuses.name, state: deals.state, count: count(), repKobo: sum(deals.repCommissionKobo) }).from(deals).innerJoin(reps, eq(deals.repId, reps.id)).innerJoin(campuses, eq(reps.campusId, campuses.id)).where(gte(deals.createdAt, since)).groupBy(campuses.id, campuses.name, deals.state),
    db.select({ vendorId: vendors.id, vendor: vendors.companyName, state: deals.state, count: count(), vendorKobo: sum(deals.vendorCommissionKobo) }).from(deals).innerJoin(vendors, eq(deals.vendorId, vendors.id)).where(gte(deals.createdAt, since)).groupBy(vendors.id, vendors.companyName, deals.state),
    db.select({ status: vendorEvents.status, count: count() }).from(vendorEvents).where(gte(vendorEvents.receivedAt, since)).groupBy(vendorEvents.status),
    db.select({ state: payouts.state, count: count(), netKobo: sum(payouts.amountNetKobo), withholdingKobo: sum(payouts.withholdingKobo) }).from(payouts).where(gte(payouts.createdAt, since)).groupBy(payouts.state),
    db.select({ state: supportTickets.state, count: count() }).from(supportTickets).where(gte(supportTickets.createdAt, since)).groupBy(supportTickets.state),
    db.select({ state: financialPostingOutbox.state, count: count() }).from(financialPostingOutbox).groupBy(financialPostingOutbox.state),
    db.select().from(reconciliationRuns).where(gte(reconciliationRuns.createdAt, since)).orderBy(desc(reconciliationRuns.createdAt)).limit(30),
    db.select().from(dataPlatformRuns).orderBy(desc(dataPlatformRuns.startedAt)).limit(12),
    db.select({ snapshotRef: analyticsSnapshots.snapshotRef, windowDays: analyticsSnapshots.windowDays, payloadHash: analyticsSnapshots.payloadHash, createdAt: analyticsSnapshots.createdAt }).from(analyticsSnapshots).orderBy(desc(analyticsSnapshots.createdAt)).limit(8),
    db.select({ day: dealCreationDay, activations: count() }).from(deals).where(gte(deals.createdAt, since)).groupBy(dealCreationDay).orderBy(dealCreationDay),
    db.select({ day: confirmationDay, confirmed: count() }).from(firstConfirmations).where(gte(firstConfirmations.firstConfirmedAt, since)).groupBy(confirmationDay).orderBy(confirmationDay),
    db.select({ dealId: deals.id, createdAt: deals.createdAt, firstConfirmedAt: firstConfirmations.firstConfirmedAt }).from(deals).leftJoin(firstConfirmations, eq(firstConfirmations.dealId, deals.id)).where(gte(deals.createdAt, since)),
  ]);

  const totalDeals = dealStates.reduce((sum, row) => sum + row.count, 0);
  const payableStates = new Set(["confirmed", "payable", "paid"]);
  const confirmedActivations = dealStates.filter((row) => payableStates.has(row.state)).reduce((sum, row) => sum + row.count, 0);
  const processedEvents = eventRows.find((row) => row.status === "processed")?.count || 0;
  const quarantinedEvents = eventRows.find((row) => row.status === "quarantined")?.count || 0;
  const totalEvents = eventRows.reduce((sum, row) => sum + row.count, 0);
  const pendingPostings = outboxRows.filter((row) => ["pending", "submitting", "submitted", "blocked"].includes(row.state)).reduce((sum, row) => sum + row.count, 0);
  const failedPostings = outboxRows.find((row) => row.state === "failed")?.count || 0;
  const reconciliationVariances = reconciliations.filter((row) => row.state === "variance").length;
  const quarantineRate = percent(quarantinedEvents, totalEvents);

  const campusMap = new Map<number, { campusId: number; campus: string; activations: number; confirmed: number; repKobo: number }>();
  for (const row of campusRows) {
    const current = campusMap.get(row.campusId) || { campusId: row.campusId, campus: row.campus, activations: 0, confirmed: 0, repKobo: 0 };
    current.activations += row.count;
    if (payableStates.has(row.state)) current.confirmed += row.count;
    if (payableStates.has(row.state)) current.repKobo += numberSum(row.repKobo);
    campusMap.set(row.campusId, current);
  }
  const campusPerformance = [...campusMap.values()].map((row) => ({ ...row, confirmationRate: percent(row.confirmed, row.activations) })).sort((a, b) => b.confirmed - a.confirmed || b.repKobo - a.repKobo).slice(0, 20);

  const vendorMap = new Map<number, { vendorId: number; vendor: string; activations: number; confirmed: number; commissionKobo: number }>();
  for (const row of vendorRows) {
    const current = vendorMap.get(row.vendorId) || { vendorId: row.vendorId, vendor: row.vendor, activations: 0, confirmed: 0, commissionKobo: 0 };
    current.activations += row.count;
    if (payableStates.has(row.state)) current.confirmed += row.count;
    if (payableStates.has(row.state)) current.commissionKobo += numberSum(row.vendorKobo);
    vendorMap.set(row.vendorId, current);
  }
  const vendorPerformance = [...vendorMap.values()].map((row) => ({ ...row, confirmationRate: percent(row.confirmed, row.activations) })).sort((a, b) => b.commissionKobo - a.commissionKobo).slice(0, 20);

  const dailyMap = new Map<string, { day: string; activations: number; confirmed: number }>();
  for (const row of activationDays) dailyMap.set(row.day, { day: row.day, activations: row.activations, confirmed: 0 });
  for (const row of confirmationDays) {
    const current = dailyMap.get(row.day) || { day: row.day, activations: 0, confirmed: 0 };
    current.confirmed = row.confirmed;
    dailyMap.set(row.day, current);
  }
  const dailyTrend = [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day));
  const conversionCohorts = buildConversionCohorts(cohortDeals);

  const metrics = {
    windowDays,
    generatedAt: new Date().toISOString(),
    activations: totalDeals,
    confirmedActivations,
    confirmationRate: percent(confirmedActivations, totalDeals),
    vendorCommissionKobo: dealStates.filter((row) => payableStates.has(row.state)).reduce((sum, row) => sum + numberSum(row.vendorKobo), 0),
    repCommissionKobo: dealStates.filter((row) => payableStates.has(row.state)).reduce((sum, row) => sum + numberSum(row.repKobo), 0),
    platformRevenueKobo: dealStates.filter((row) => payableStates.has(row.state)).reduce((sum, row) => sum + numberSum(row.platformKobo), 0),
    payoutNetKobo: payoutRows.filter((row) => row.state === "paid").reduce((sum, row) => sum + numberSum(row.netKobo), 0),
    withholdingKobo: payoutRows.filter((row) => row.state === "paid").reduce((sum, row) => sum + numberSum(row.withholdingKobo), 0),
    openCases: caseRows.filter((row) => !["resolved", "closed"].includes(row.state)).reduce((sum, row) => sum + row.count, 0),
    processedEvents,
    quarantinedEvents,
    quarantineRate,
    pendingPostings,
    failedPostings,
    reconciliationVariances,
  };

  return {
    metrics,
    funnel: dealStates.map((row) => ({ state: row.state, count: row.count, share: percent(row.count, totalDeals) })).sort((a, b) => b.count - a.count),
    payoutStates: payoutRows.map((row) => ({ state: row.state, count: row.count, netKobo: numberSum(row.netKobo) })),
    campusPerformance,
    vendorPerformance,
    dailyTrend,
    conversionCohorts,
    findings: analyticsAnomalies({ quarantineRate, pendingPostings, failedPostings, reconciliationVariances, confirmedActivations, processedEvents }),
    dataQuality: {
      score: Math.max(0, 100 - Math.round(quarantineRate * 2) - Math.min(30, reconciliationVariances * 10) - Math.min(30, failedPostings * 10)),
      controls: ["Event idempotency and quarantine", "Scoped operational aggregates", "Immutable snapshot hash", "Financial outbox backlog visibility", "Three-way reconciliation variance"],
    },
    recentDataPlatformRuns: latestRuns,
    recentSnapshots: snapshots,
    sourceCounts: { deals: totalDeals, vendorEvents: totalEvents, payouts: payoutRows.reduce((sum, row) => sum + row.count, 0), supportCases: caseRows.reduce((sum, row) => sum + row.count, 0) },
    definitions: {
      confirmationRate: "Currently confirmed, payable and paid activations divided by all activation records created in the selected window.",
      commissionEconomics: "Vendor, representative and platform commission totals include only currently confirmed, payable or paid records created in the selected window; pending, void and clawed-back records are excluded.",
      platformRevenue: "Confirmed vendor-funded platform share before any separately recorded Campus Lead override; not profit or cash on hand.",
      withholding: "Sandbox withholding on payouts currently marked paid and created in the selected window; it is not evidence of tax remittance.",
      dataQuality: "Operational control score, not a statistical model-quality score. Quarantine, reconciliation variance and failed postings reduce it.",
      dailyTrend: "Activations use deal creation time; confirmations use each deal's first confirmed state-history event. They are separate event-time series, not a same-day conversion rate.",
      conversionCohorts: "Monday-start UTC creation cohorts. Seven-day conversion uses each deal's first confirmed state-history event and divides by cohort records with a complete seven-day observation window.",
    },
  };
}

export async function captureAnalyticsSnapshot(windowDays: AnalyticsWindow, actorUserId: number) {
  const payload = await buildAdvancedAnalytics(windowDays);
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const snapshotRef = `analytics_${randomUUID()}`;
  await getDb().insert(analyticsSnapshots).values({
    snapshotRef,
    windowDays,
    payloadHash,
    payloadJson: payload as unknown as Record<string, unknown>,
    sourceCountsJson: payload.sourceCounts,
    createdByUserId: actorUserId,
  });
  return { snapshotRef, payloadHash, sourceCounts: payload.sourceCounts, createdAt: new Date() };
}

export async function latestReconciliationVariance() {
  const rows = await getDb().select({ state: reconciliationRuns.state }).from(reconciliationRuns).where(and(inArray(reconciliationRuns.state, ["variance"]), gte(reconciliationRuns.createdAt, new Date(Date.now() - 30 * 86_400_000))));
  return rows.length;
}
