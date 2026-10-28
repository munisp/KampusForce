import { and, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  caseLinks,
  caseMessages,
  caseSavedViews,
  caseWatchers,
  reps,
  supportTicketEvents,
  supportTickets,
  users,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { notifyUser } from "./notifications";
import { caseNextAction, caseRisk } from "./salesPolicy";
import { actorRepIds, assigneeOptions, canActorAccessRep, type SalesActor } from "./salesAccess";

function publicTicket<T extends typeof supportTickets.$inferSelect>(ticket: T) {
  const { customerPhoneHash, ...safe } = ticket;
  void customerPhoneHash;
  return safe;
}

async function accessibleTicket(actor: SalesActor, ticketId: number) {
  const [ticket] = await getDb().select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
  if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  if (["ops", "finance", "admin"].includes(actor.role)) return ticket;
  if (actor.role === "vendor" && ticket.vendorId === actor.vendorId) return ticket;
  if (actor.role === "rep" && await canActorAccessRep(actor, ticket.repId)) return ticket;
  throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
}

async function appendCaseEvent(input: {
  ticketId: number;
  actorUserId: number;
  actorRole: string;
  action: string;
  fromState?: string | null;
  toState?: string | null;
  note?: string;
  evidenceJson?: Record<string, unknown>;
}) {
  await getDb().insert(supportTicketEvents).values({
    ticketId: input.ticketId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    fromState: input.fromState || null,
    toState: input.toState || null,
    note: input.note || null,
    evidenceJson: input.evidenceJson || null,
  });
}

async function notifyWatchers(input: { ticketId: number; actorUserId: number; title: string; body: string }) {
  const watchers = await getDb().select().from(caseWatchers).where(eq(caseWatchers.ticketId, input.ticketId));
  await Promise.all(watchers.filter((watcher) => watcher.userId !== input.actorUserId).map((watcher) => notifyUser({
    userId: watcher.userId,
    type: "case_update",
    title: input.title,
    body: input.body,
    href: "/sales?view=cases",
    entityType: "support_ticket",
    entityId: input.ticketId,
  })));
}

export async function wakeSnoozedCases() {
  const db = getDb();
  const due = await db.select({ id: supportTickets.id }).from(supportTickets)
    .where(and(isNotNull(supportTickets.snoozedUntil), lte(supportTickets.snoozedUntil, new Date()), inArray(supportTickets.state, ["rep_triage", "campus_lead_queue", "vendor_queue", "ops_queue"])));
  let woken = 0;
  for (const row of due) {
    const changed = await db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, row.id)).limit(1).for("update");
      if (!ticket?.snoozedUntil || ticket.snoozedUntil > new Date() || ["resolved", "closed"].includes(ticket.state)) return false;
      await tx.update(supportTickets).set({ snoozedUntil: null, version: ticket.version + 1, updatedAt: new Date() }).where(eq(supportTickets.id, ticket.id));
      await tx.insert(supportTicketEvents).values({ ticketId: ticket.id, actorRole: "system", action: "snooze_elapsed", fromState: ticket.state, toState: ticket.state, note: "Snooze elapsed; the case returned to its active queue" });
      return true;
    });
    if (changed) woken += 1;
  }
  return { woken };
}

export async function listCaseWorkspace(actor: SalesActor) {
  await wakeSnoozedCases();
  const db = getDb();
  let rows = await db.select({ ticket: supportTickets, repCode: reps.code, vendorName: vendors.companyName, assigneeName: users.name })
    .from(supportTickets)
    .innerJoin(reps, eq(supportTickets.repId, reps.id))
    .innerJoin(vendors, eq(supportTickets.vendorId, vendors.id))
    .leftJoin(users, eq(supportTickets.assigneeUserId, users.id))
    .orderBy(desc(supportTickets.updatedAt)).limit(150);
  if (actor.role === "vendor") rows = rows.filter((row) => row.ticket.vendorId === actor.vendorId);
  if (actor.role === "rep") {
    const ids = await actorRepIds(actor);
    rows = rows.filter((row) => ids.includes(row.ticket.repId));
  }
  const ticketIds = rows.map((row) => row.ticket.id);
  const [messages, events, watchers, links, savedViews, assignees] = await Promise.all([
    ticketIds.length ? db.select().from(caseMessages).where(inArray(caseMessages.ticketId, ticketIds)).orderBy(desc(caseMessages.createdAt)) : [],
    ticketIds.length ? db.select().from(supportTicketEvents).where(inArray(supportTicketEvents.ticketId, ticketIds)).orderBy(desc(supportTicketEvents.createdAt)) : [],
    ticketIds.length ? db.select().from(caseWatchers).where(inArray(caseWatchers.ticketId, ticketIds)) : [],
    ticketIds.length ? db.select().from(caseLinks).where(or(inArray(caseLinks.ticketId, ticketIds), inArray(caseLinks.relatedTicketId, ticketIds))) : [],
    db.select().from(caseSavedViews).where(eq(caseSavedViews.userId, actor.userId)).orderBy(caseSavedViews.name),
    assigneeOptions(actor),
  ]);
  const now = new Date();
  const cases = rows.map((row) => ({
    ...row,
    ticket: publicTicket(row.ticket),
    risk: caseRisk(row.ticket, now),
    guidance: caseNextAction(row.ticket, now),
    watching: watchers.some((watcher) => watcher.ticketId === row.ticket.id && watcher.userId === actor.userId),
  }));
  const visibleMessages = actor.role === "rep" ? messages.filter((message) => message.visibility === "public") : messages;
  return {
    cases,
    messages: visibleMessages,
    events,
    links,
    savedViews,
    assignees,
    metrics: {
      open: cases.filter((row) => !["resolved", "closed"].includes(row.ticket.state)).length,
      unassigned: cases.filter((row) => !["resolved", "closed"].includes(row.ticket.state) && !row.ticket.assigneeUserId).length,
      firstResponseOverdue: cases.filter((row) => !row.ticket.firstRespondedAt && row.ticket.firstResponseDueAt && row.ticket.firstResponseDueAt <= now && !["resolved", "closed"].includes(row.ticket.state)).length,
      breached: cases.filter((row) => row.ticket.slaDueAt <= now && !["resolved", "closed"].includes(row.ticket.state)).length,
      snoozed: cases.filter((row) => row.ticket.snoozedUntil && row.ticket.snoozedUntil > now).length,
      reopened: cases.reduce((sum, row) => sum + row.ticket.reopenedCount, 0),
    },
    boundary: "Case collaboration changes support workflow only; it never changes deals, commissions, escrow or payouts.",
  };
}

export async function assignCase(input: { actor: SalesActor; ticketId: number; assigneeUserId: number | null; expectedVersion: number }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (["resolved", "closed"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Reopen the case before changing its owner" });
  if (input.actor.role === "rep" && input.assigneeUserId !== input.actor.userId && input.assigneeUserId !== null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Reps can only claim or release a case themselves" });
  }
  if (input.actor.role === "vendor" && input.assigneeUserId !== input.actor.userId && input.assigneeUserId !== null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Vendor cases can only be assigned to the current vendor operator" });
  }
  if (input.assigneeUserId) {
    const [assignee] = await getDb().select().from(users).where(eq(users.id, input.assigneeUserId)).limit(1);
    if (!assignee) throw new TRPCError({ code: "NOT_FOUND", message: "Case assignee not found" });
    if (["ops", "finance", "admin"].includes(input.actor.role) && !["ops", "admin"].includes(assignee.role)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Operations cases require an Operations or Admin assignee" });
    }
  }
  const result = await getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)).limit(1).for("update");
    if (!locked || locked.version !== input.expectedVersion) throw new TRPCError({ code: "CONFLICT", message: "This case changed in another session; refresh before assigning it" });
    const now = new Date();
    await tx.update(supportTickets).set({ assigneeUserId: input.assigneeUserId, version: locked.version + 1, updatedAt: now }).where(eq(supportTickets.id, locked.id));
    await tx.insert(supportTicketEvents).values({ ticketId: locked.id, actorUserId: input.actor.userId, actorRole: input.actor.role, action: input.assigneeUserId ? "case_assigned" : "case_unassigned", fromState: locked.state, toState: locked.state, note: input.assigneeUserId ? `Assigned to user #${input.assigneeUserId}` : "Case owner released", evidenceJson: { previousAssigneeUserId: locked.assigneeUserId, assigneeUserId: input.assigneeUserId } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "case.assigned", entityType: "support_ticket", entityId: String(locked.id), metadataJson: { previousAssigneeUserId: locked.assigneeUserId, assigneeUserId: input.assigneeUserId, version: locked.version + 1 } });
    return { ticketId: locked.id, assigneeUserId: input.assigneeUserId, version: locked.version + 1 };
  });
  await notifyWatchers({ ticketId: ticket.id, actorUserId: input.actor.userId, title: `Case ${ticket.ticketRef} ownership changed`, body: input.assigneeUserId ? "A named owner was assigned." : "The case owner was released." });
  return result;
}

export async function addCaseMessage(input: { actor: SalesActor; ticketId: number; visibility: "internal" | "public"; body: string }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (["resolved", "closed"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Reopen the case before adding a reply" });
  if (input.visibility === "internal" && input.actor.role === "rep") throw new TRPCError({ code: "FORBIDDEN", message: "Internal staff notes are limited to vendor and Operations workspaces" });
  const now = new Date();
  const result = await getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)).limit(1).for("update");
    if (!locked) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    const [{ id }] = await tx.insert(caseMessages).values({ ticketId: locked.id, authorUserId: input.actor.userId, visibility: input.visibility, body: input.body }).returning({ id: caseMessages.id });
    const staffPublicReply = input.visibility === "public" && ["vendor", "ops", "finance", "admin"].includes(input.actor.role);
    await tx.update(supportTickets).set({
      firstRespondedAt: locked.firstRespondedAt || (staffPublicReply ? now : null),
      lastPublicReplyAt: input.visibility === "public" ? now : locked.lastPublicReplyAt,
      snoozedUntil: input.visibility === "public" ? null : locked.snoozedUntil,
      version: locked.version + 1,
      updatedAt: now,
    }).where(eq(supportTickets.id, locked.id));
    await tx.insert(supportTicketEvents).values({ ticketId: locked.id, actorUserId: input.actor.userId, actorRole: input.actor.role, action: input.visibility === "public" ? "public_reply" : "internal_note", fromState: locked.state, toState: locked.state, note: input.visibility === "public" ? "Public reply recorded; see the collaboration message" : "Internal staff note recorded", evidenceJson: { messageId: id, visibility: input.visibility } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: `case.${input.visibility}_message`, entityType: "support_ticket", entityId: String(locked.id), metadataJson: { messageId: id, visibility: input.visibility } });
    return { messageId: id, ticketId: locked.id, visibility: input.visibility, firstRespondedAt: staffPublicReply ? locked.firstRespondedAt || now : locked.firstRespondedAt };
  });
  await notifyWatchers({ ticketId: ticket.id, actorUserId: input.actor.userId, title: `Case ${ticket.ticketRef} updated`, body: input.visibility === "public" ? "A public reply was added." : "An internal collaboration note was added." });
  return result;
}

export async function snoozeCase(input: { actor: SalesActor; ticketId: number; until: Date; note: string }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (["resolved", "closed"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolved cases do not need snoozing" });
  if (input.until <= new Date() || input.until.getTime() - Date.now() > 30 * 86_400_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Snooze must be in the future and no more than 30 days ahead" });
  return getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)).limit(1).for("update");
    if (!locked) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    await tx.update(supportTickets).set({ snoozedUntil: input.until, version: locked.version + 1, updatedAt: new Date() }).where(eq(supportTickets.id, locked.id));
    await tx.insert(supportTicketEvents).values({ ticketId: locked.id, actorUserId: input.actor.userId, actorRole: input.actor.role, action: "case_snoozed", fromState: locked.state, toState: locked.state, note: input.note, evidenceJson: { snoozedUntil: input.until } });
    return { ticketId: locked.id, snoozedUntil: input.until, version: locked.version + 1 };
  });
}

export async function reopenCase(input: { actor: SalesActor; ticketId: number; reason: string }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (!["resolved", "closed"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only a resolved or closed case can be reopened" });
  const toState = input.actor.role === "rep" ? "vendor_queue" : input.actor.role === "vendor" ? "vendor_queue" : "ops_queue";
  const now = new Date();
  const responseDue = new Date(now.getTime() + (ticket.priority === "urgent" ? 4 : 8) * 3_600_000);
  const result = await getDb().transaction(async (tx) => {
    const [locked] = await tx.select().from(supportTickets).where(eq(supportTickets.id, ticket.id)).limit(1).for("update");
    if (!locked || !["resolved", "closed"].includes(locked.state)) throw new TRPCError({ code: "CONFLICT", message: "The case is already active" });
    await tx.update(supportTickets).set({ state: toState, snoozedUntil: null, firstResponseDueAt: responseDue, firstRespondedAt: null, slaDueAt: new Date(now.getTime() + 24 * 3_600_000), slaBreachedAt: null, reopenedCount: locked.reopenedCount + 1, version: locked.version + 1, updatedAt: now }).where(eq(supportTickets.id, locked.id));
    await tx.insert(supportTicketEvents).values({ ticketId: locked.id, actorUserId: input.actor.userId, actorRole: input.actor.role, action: "ticket_reopened", fromState: locked.state, toState, note: input.reason, evidenceJson: { previousResolutionPreserved: Boolean(locked.resolution), csatPreserved: locked.csat !== null } });
    await tx.insert(auditLogs).values({ actorUserId: input.actor.userId, action: "case.reopened", entityType: "support_ticket", entityId: String(locked.id), metadataJson: { fromState: locked.state, toState, csatPreserved: locked.csat !== null } });
    return { ticketId: locked.id, state: toState, reopenedCount: locked.reopenedCount + 1 };
  });
  await notifyWatchers({ ticketId: ticket.id, actorUserId: input.actor.userId, title: `Case ${ticket.ticketRef} reopened`, body: "The case returned to an active queue with fresh response targets." });
  return result;
}

export async function linkCases(input: { actor: SalesActor; ticketId: number; relatedTicketId: number; linkType: "related" | "duplicate" | "blocks" }) {
  if (input.ticketId === input.relatedTicketId) throw new TRPCError({ code: "BAD_REQUEST", message: "A case cannot link to itself" });
  const [ticket, related] = await Promise.all([accessibleTicket(input.actor, input.ticketId), accessibleTicket(input.actor, input.relatedTicketId)]);
  await getDb().insert(caseLinks).values({ ticketId: ticket.id, relatedTicketId: related.id, linkType: input.linkType, createdByUserId: input.actor.userId }).onConflictDoNothing();
  await appendCaseEvent({ ticketId: ticket.id, actorUserId: input.actor.userId, actorRole: input.actor.role, action: "case_linked", fromState: ticket.state, toState: ticket.state, note: `${input.linkType} link to ${related.ticketRef}; neither case was merged or deleted`, evidenceJson: { relatedTicketId: related.id, linkType: input.linkType } });
  return { ticketId: ticket.id, relatedTicketId: related.id, linkType: input.linkType, destructiveMerge: false };
}

export async function setCaseWatch(input: { actor: SalesActor; ticketId: number; watching: boolean }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (input.watching) await getDb().insert(caseWatchers).values({ ticketId: ticket.id, userId: input.actor.userId }).onConflictDoNothing();
  else await getDb().delete(caseWatchers).where(and(eq(caseWatchers.ticketId, ticket.id), eq(caseWatchers.userId, input.actor.userId)));
  return { ticketId: ticket.id, watching: input.watching };
}

export async function saveCaseView(input: { actor: SalesActor; name: string; filters: Record<string, unknown> }) {
  const [existing] = await getDb().select().from(caseSavedViews).where(and(eq(caseSavedViews.userId, input.actor.userId), eq(caseSavedViews.name, input.name))).limit(1);
  if (existing) {
    await getDb().update(caseSavedViews).set({ filtersJson: input.filters }).where(eq(caseSavedViews.id, existing.id));
    return { viewId: existing.id, name: input.name, updated: true };
  }
  const [{ id }] = await getDb().insert(caseSavedViews).values({ userId: input.actor.userId, name: input.name, filtersJson: input.filters }).returning({ id: caseSavedViews.id });
  return { viewId: id, name: input.name, updated: false };
}
