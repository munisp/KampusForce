import { desc } from "drizzle-orm";
import { campuses, deals, reps, supportTickets } from "@db/schema";
import { getDb } from "../queries/connection";

export async function campusTelemetry() {
  const db = getDb();
  const [campusRows, repRows, dealRows, ticketRows] = await Promise.all([
    db.select().from(campuses).orderBy(campuses.name),
    db.select().from(reps),
    db.select().from(deals).orderBy(desc(deals.createdAt)),
    db.select().from(supportTickets),
  ]);
  const now = new Date();
  return campusRows.map((campus) => {
    const campusReps = repRows.filter((rep) => rep.campusId === campus.id);
    const repIds = new Set(campusReps.map((rep) => rep.id));
    const campusDeals = dealRows.filter((deal) => repIds.has(deal.repId));
    const confirmed = campusDeals.filter((deal) => ["confirmed", "payable", "paid"].includes(deal.state));
    const openSupport = ticketRows.filter((ticket) => repIds.has(ticket.repId) && !["resolved", "closed"].includes(ticket.state));
    const slaBreaches = openSupport.filter((ticket) => ["vendor_queue", "ops_queue"].includes(ticket.state) && ticket.slaDueAt <= now);
    const activeReps = campusReps.filter((rep) => rep.status === "active").length;
    return {
      campus,
      activeReps,
      pendingReps: campusReps.filter((rep) => rep.status === "pending").length,
      activations: confirmed.length,
      confirmedCommissionKobo: confirmed.reduce((sum, deal) => sum + deal.repCommissionKobo, 0),
      openSupport: openSupport.length,
      slaBreaches: slaBreaches.length,
      latestActivationAt: confirmed[0]?.createdAt || null,
      health: !activeReps ? "no_active_reps" as const : slaBreaches.length ? "attention" as const : "healthy" as const,
      evidence: "derived_from_current_records" as const,
    };
  });
}
