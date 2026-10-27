import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  attributionRecords,
  auditLogs,
  campusLeadAssignments,
  deals,
  products,
  reps,
  supportResolutionMacros,
  supportTicketEvents,
  supportTickets,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { hashPhone, randomReference } from "./security";
import { qualityScoreFromCsat, supportSlaDue } from "./supportPolicy";

export { isSlaBreached, qualityScoreFromCsat, supportSlaDue } from "./supportPolicy";

export async function syncSlaBreaches(vendorId?: number) {
  const db = getDb();
  const conditions = [inArray(supportTickets.state, ["vendor_queue", "ops_queue"]), isNull(supportTickets.slaBreachedAt), lte(supportTickets.slaDueAt, new Date())];
  if (vendorId) conditions.push(eq(supportTickets.vendorId, vendorId));
  const due = await db.select({ id: supportTickets.id }).from(supportTickets).where(and(...conditions));
  let breached = 0;
  for (const candidate of due) {
    const changed = await db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, candidate.id)).limit(1).for("update");
      if (!ticket || ticket.slaBreachedAt || !["vendor_queue", "ops_queue"].includes(ticket.state) || ticket.slaDueAt > new Date()) return false;
      const now = new Date();
      await tx.update(supportTickets).set({ slaBreachedAt: now, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
      await tx.insert(supportTicketEvents).values({ ticketId: ticket.id, actorRole: "system", action: "sla_breached", fromState: ticket.state, toState: ticket.state, note: `Vendor SLA of ${ticket.slaDueAt.toISOString()} elapsed without resolution` });
      await tx.insert(auditLogs).values({ action: "support.sla_breached", entityType: "support_ticket", entityId: String(ticket.id), metadataJson: { vendorId: ticket.vendorId, slaDueAt: ticket.slaDueAt } });
      return true;
    });
    if (changed) breached += 1;
  }
  return breached;
}

async function activeLeadForRep(repId: number) {
  const [row] = await getDb().select({ assignment: campusLeadAssignments, lead: reps }).from(campusLeadAssignments)
    .innerJoin(reps, eq(campusLeadAssignments.leadRepId, reps.id))
    .where(and(eq(campusLeadAssignments.repId, repId), isNull(campusLeadAssignments.revokedAt), eq(reps.tier, "campus_lead"), eq(reps.status, "active")))
    .limit(1);
  return row || null;
}

export async function createSupportTicket(input: {
  actorUserId: number;
  repId: number;
  productId?: number;
  dealId?: number;
  customerPhone?: string;
  category: string;
  subject: string;
  description: string;
  priority: "normal" | "urgent";
}) {
  const db = getDb();
  let vendorId: number;
  let customerPhoneHash: string;
  let productId = input.productId;
  if (input.dealId) {
    const [deal] = await db.select().from(deals).where(and(eq(deals.id, input.dealId), eq(deals.repId, input.repId))).limit(1);
    if (!deal) throw new TRPCError({ code: "NOT_FOUND", message: "Referred deal not found" });
    vendorId = deal.vendorId;
    customerPhoneHash = deal.customerPhoneHash;
    productId = deal.productId;
  } else {
    if (!productId || !input.customerPhone) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a product and enter the referred customer phone, or link a deal" });
    const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
    customerPhoneHash = hashPhone(input.customerPhone);
    const [attribution] = await db.select().from(attributionRecords).where(and(eq(attributionRecords.repId, input.repId), eq(attributionRecords.productId, productId), eq(attributionRecords.customerPhoneHash, customerPhoneHash), eq(attributionRecords.status, "active"))).limit(1);
    if (!attribution) throw new TRPCError({ code: "FORBIDDEN", message: "Support cases are limited to your own referred customers" });
    vendorId = product.vendorId;
  }
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
  const ticketRef = randomReference("KF-S").toUpperCase();
  const slaDueAt = supportSlaDue(vendor.supportSlaHours);
  const [{ id }] = await db.insert(supportTickets).values({
    ticketRef,
    repId: input.repId,
    vendorId,
    customerPhoneHash,
    dealId: input.dealId || null,
    category: input.category,
    subject: input.subject,
    description: input.description,
    priority: input.priority,
    state: "rep_triage",
    slaDueAt,
  }).returning({ id: supportTickets.id });
  await db.insert(supportTicketEvents).values({ ticketId: id, actorUserId: input.actorUserId, actorRole: "rep", action: "ticket_created", toState: "rep_triage", note: input.description, evidenceJson: { productId, dealId: input.dealId || null, customer: "[salted-hash]" } });
  await db.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "support.ticket_created", entityType: "support_ticket", entityId: String(id), metadataJson: { ticketRef, vendorId, productId, dealId: input.dealId || null } });
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1);
  return ticket;
}

export async function escalateSupportTicket(input: {
  ticketId: number;
  actorUserId: number;
  actor: "rep" | "lead" | "vendor" | "ops";
  repId?: number;
  vendorId?: number;
  target?: "campus_lead" | "vendor" | "ops";
  note?: string;
}) {
  const db = getDb();
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).limit(1);
  if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found" });
  let toState: "campus_lead_queue" | "vendor_queue" | "ops_queue";
  if (input.actor === "rep") {
    if (ticket.repId !== input.repId || ticket.state !== "rep_triage") throw new TRPCError({ code: "FORBIDDEN", message: "Only the owning rep can escalate a ticket in rep triage" });
    const lead = await activeLeadForRep(ticket.repId);
    toState = input.target === "campus_lead" && lead ? "campus_lead_queue" : "vendor_queue";
  } else if (input.actor === "lead") {
    const lead = await activeLeadForRep(ticket.repId);
    if (!lead || lead.lead.id !== input.repId || !["rep_triage", "campus_lead_queue"].includes(ticket.state)) throw new TRPCError({ code: "FORBIDDEN", message: "This ticket is not in your campus team queue" });
    toState = "vendor_queue";
  } else if (input.actor === "vendor") {
    if (ticket.vendorId !== input.vendorId || ticket.state !== "vendor_queue") throw new TRPCError({ code: "FORBIDDEN", message: "Only the assigned vendor can escalate its queued ticket" });
    toState = "ops_queue";
  } else {
    if (["resolved", "closed", "ops_queue"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket cannot be escalated from its current state" });
    toState = "ops_queue";
  }
  await db.update(supportTickets).set({ state: toState, updatedAt: new Date() }).where(eq(supportTickets.id, ticket.id));
  await db.insert(supportTicketEvents).values({ ticketId: ticket.id, actorUserId: input.actorUserId, actorRole: input.actor, action: "ticket_escalated", fromState: ticket.state, toState, note: input.note || `Escalated to ${toState.replaceAll("_", " ")}` });
  await db.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "support.ticket_escalated", entityType: "support_ticket", entityId: String(ticket.id), metadataJson: { fromState: ticket.state, toState, actor: input.actor } });
  return { ticketId: ticket.id, fromState: ticket.state, toState };
}

export async function resolveSupportTicket(input: {
  ticketId: number;
  actorUserId: number;
  actor: "vendor" | "ops";
  vendorId?: number;
  resolution: string;
  macroId?: number;
}) {
  const db = getDb();
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).limit(1);
  if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Support ticket not found" });
  if (input.actor === "vendor" && (ticket.vendorId !== input.vendorId || ticket.state !== "vendor_queue")) throw new TRPCError({ code: "FORBIDDEN", message: "Only the assigned vendor can resolve a ticket in its queue" });
  if (input.actor === "ops" && !["ops_queue", "vendor_queue", "campus_lead_queue"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Ticket is not ready for operations resolution" });
  if (input.macroId) {
    const [macro] = await db.select().from(supportResolutionMacros).where(and(eq(supportResolutionMacros.id, input.macroId), eq(supportResolutionMacros.vendorId, ticket.vendorId), eq(supportResolutionMacros.active, true))).limit(1);
    if (!macro) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolution macro is not approved for this vendor" });
  }
  const now = new Date();
  await db.update(supportTickets).set({ state: "resolved", resolution: input.resolution, resolutionMacroId: input.macroId || null, resolvedAt: now, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
  await db.insert(supportTicketEvents).values({ ticketId: ticket.id, actorUserId: input.actorUserId, actorRole: input.actor, action: "ticket_resolved", fromState: ticket.state, toState: "resolved", note: input.resolution, evidenceJson: { macroId: input.macroId || null } });
  await db.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "support.ticket_resolved", entityType: "support_ticket", entityId: String(ticket.id), metadataJson: { actor: input.actor, macroId: input.macroId || null } });
  return { ticketId: ticket.id, state: "resolved" as const, resolvedAt: now };
}

export async function rateSupportTicket(input: { ticketId: number; actorUserId: number; repId: number; csat: number; comment?: string }) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, input.ticketId)).limit(1).for("update");
    if (!ticket || ticket.repId !== input.repId) throw new TRPCError({ code: "NOT_FOUND", message: "Resolved ticket not found" });
    if (ticket.state !== "resolved") throw new TRPCError({ code: "BAD_REQUEST", message: "CSAT can be submitted once after resolution" });
    const now = new Date();
    await tx.update(supportTickets).set({ state: "closed", csat: input.csat, csatComment: input.comment || null, closedAt: now, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
    await tx.insert(supportTicketEvents).values({ ticketId: ticket.id, actorUserId: input.actorUserId, actorRole: "rep", action: "csat_submitted", fromState: "resolved", toState: "closed", note: input.comment || `CSAT ${input.csat}/5`, evidenceJson: { csat: input.csat } });
    const repRatings = await tx.select({ csat: supportTickets.csat }).from(supportTickets).where(and(eq(supportTickets.repId, ticket.repId), eq(supportTickets.state, "closed")));
    const vendorRatings = await tx.select({ csat: supportTickets.csat }).from(supportTickets).where(and(eq(supportTickets.vendorId, ticket.vendorId), eq(supportTickets.state, "closed")));
    const repQuality = qualityScoreFromCsat(repRatings.flatMap((row) => row.csat ? [row.csat] : []));
    const vendorQuality = qualityScoreFromCsat(vendorRatings.flatMap((row) => row.csat ? [row.csat] : []));
    await tx.update(reps).set({ qualityScore: repQuality }).where(eq(reps.id, ticket.repId));
    await tx.update(vendors).set({ qualityScore: vendorQuality }).where(eq(vendors.id, ticket.vendorId));
    await tx.insert(auditLogs).values({ actorUserId: input.actorUserId, action: "support.csat_submitted", entityType: "support_ticket", entityId: String(ticket.id), metadataJson: { csat: input.csat, repQuality, vendorQuality } });
    return { ticketId: ticket.id, state: "closed" as const, csat: input.csat, repQuality, vendorQuality };
  });
}

export async function ticketEvents(ticketId: number) {
  return getDb().select().from(supportTicketEvents).where(eq(supportTicketEvents.ticketId, ticketId)).orderBy(desc(supportTicketEvents.createdAt));
}
