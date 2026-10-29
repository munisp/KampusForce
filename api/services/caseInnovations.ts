import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  caseAgentSkills,
  caseAttachments,
  caseChannelIntakes,
  caseCopilotRuns,
  caseExperienceSurveys,
  caseKnowledgeLinks,
  caseMessages,
  caseQualityReviews,
  caseRoutingDecisions,
  caseRoutingRules,
  caseSlaIntervals,
  caseSlaPolicies,
  incidentUpdates,
  knowledgeArticles,
  majorIncidents,
  problemCaseLinks,
  problemRecords,
  reps,
  supportResolutionMacros,
  supportTicketEvents,
  supportTickets,
  users,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { storage } from "../lib/storage";
import { actorRepIds, type SalesActor } from "./salesAccess";
import { listCaseWorkspace } from "./caseManagement";
import { addBusinessMinutes, buildCaseCopilot, qualityReviewTotal, redactSensitiveText } from "./innovationPolicy";
import { hashPhone, randomReference } from "./security";

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const ref = (prefix: string) => `${prefix}-${randomUUID()}`;
const operations = (actor: SalesActor) => { if (!["ops", "admin"].includes(actor.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Operations administers this case-management control" }); };

async function accessibleTicket(actor: SalesActor, ticketId: number) {
  const [ticket] = await getDb().select().from(supportTickets).where(eq(supportTickets.id, ticketId)).limit(1);
  if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
  if (["ops", "finance", "admin"].includes(actor.role)) return ticket;
  if (actor.role === "vendor" && ticket.vendorId === actor.vendorId) return ticket;
  if (actor.role === "rep" && (await actorRepIds(actor)).includes(ticket.repId)) return ticket;
  throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
}

async function appendEvent(ticketId: number, actor: SalesActor, action: string, note: string, evidenceJson: Record<string, unknown> = {}) {
  await getDb().insert(supportTicketEvents).values({ ticketId, actorUserId: actor.userId, actorRole: actor.role, action, note, evidenceJson });
}

export async function intakeCaseChannel(input: { actor: SalesActor; channel: "email" | "sms" | "whatsapp" | "web"; externalId: string; repId: number; vendorId: number; customerPhone: string; category: string; subject: string; description: string }) {
  if (input.actor.role === "rep" && input.actor.repId !== input.repId) throw new TRPCError({ code: "FORBIDDEN", message: "Representatives can intake only their own cases" });
  if (input.actor.role === "vendor" && input.actor.vendorId !== input.vendorId) throw new TRPCError({ code: "FORBIDDEN", message: "Vendor operators can intake only their own cases" });
  if (input.actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance has read-only case oversight" });
  const db = getDb();
  const externalIdHash = hash(`${input.channel}:${input.externalId}`);
  const [existing] = await db.select().from(caseChannelIntakes).where(and(eq(caseChannelIntakes.channel, input.channel), eq(caseChannelIntakes.externalIdHash, externalIdHash))).limit(1);
  if (existing) return { intakeId: existing.id, ticketId: existing.ticketId, state: "duplicate", externalRequestMade: false };
  const [rep] = await db.select().from(reps).where(eq(reps.id, input.repId)).limit(1);
  const [vendor] = await db.select().from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
  if (!rep || !vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Representative or vendor not found" });
  const now = new Date();
  return db.transaction(async (tx) => {
    const ticketRef = randomReference("KF-C").toUpperCase();
    const [ticket] = await tx.insert(supportTickets).values({ ticketRef, repId: rep.id, vendorId: vendor.id, customerPhoneHash: hashPhone(input.customerPhone), category: input.category, subject: input.subject, description: input.description, state: input.actor.role === "rep" ? "rep_triage" : input.actor.role === "vendor" ? "vendor_queue" : "ops_queue", slaDueAt: new Date(now.getTime() + 24 * 3_600_000), firstResponseDueAt: new Date(now.getTime() + 8 * 3_600_000) }).returning();
    const [intake] = await tx.insert(caseChannelIntakes).values({ intakeRef: ref("INT"), channel: input.channel, externalIdHash, ticketId: ticket.id, state: "linked", mode: input.channel === "web" ? "internal" : "sandbox_simulation", reason: "Synthetic channel payload normalized into an ordinary support case; no external channel connection was used", createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
    if (!intake) throw new TRPCError({ code: "CONFLICT", message: "This channel message was intake concurrently; retry to receive its existing case" });
    await tx.insert(supportTicketEvents).values({ ticketId: ticket.id, actorUserId: input.actor.userId, actorRole: input.actor.role, action: "channel_intake", fromState: null, toState: ticket.state, note: `${input.channel} intake linked in sandbox mode`, evidenceJson: { intakeRef: intake.intakeRef, rawExternalIdPersisted: false } });
    return { intakeId: intake.id, ticketId: ticket.id, ticketRef: ticket.ticketRef, state: intake.state, rawExternalIdPersisted: false, externalRequestMade: false };
  });
}

export async function setCaseAgentSkill(input: { actor: SalesActor; userId: number; skill: string; level: number; active: boolean }) {
  operations(input.actor);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user || !["ops", "admin"].includes(user.role)) throw new TRPCError({ code: "BAD_REQUEST", message: "Case routing skills belong to Operations agents" });
  const [existing] = await db.select().from(caseAgentSkills).where(and(eq(caseAgentSkills.userId, input.userId), eq(caseAgentSkills.skill, input.skill))).limit(1);
  const [row] = existing
    ? await db.update(caseAgentSkills).set({ level: input.level, active: input.active, assessedByUserId: input.actor.userId, updatedAt: new Date() }).where(eq(caseAgentSkills.id, existing.id)).returning()
    : await db.insert(caseAgentSkills).values({ userId: input.userId, skill: input.skill, level: input.level, active: input.active, assessedByUserId: input.actor.userId }).returning();
  return row;
}

export async function createCaseRoutingRule(input: { actor: SalesActor; name: string; category?: string; vendorId?: number; skill: string; maxOpenCases: number; priority: number }) {
  operations(input.actor);
  const [row] = await getDb().insert(caseRoutingRules).values({ ...input, category: input.category || null, vendorId: input.vendorId || null, createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function proposeCaseRouting(input: { actor: SalesActor; ticketId: number }) {
  operations(input.actor);
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (["resolved", "closed"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolved cases do not require routing" });
  const db = getDb();
  const rules = await db.select().from(caseRoutingRules).where(eq(caseRoutingRules.active, true)).orderBy(caseRoutingRules.priority).limit(100);
  const matching = rules.filter((rule) => (!rule.category || rule.category === ticket.category) && (!rule.vendorId || rule.vendorId === ticket.vendorId));
  const open = await db.select({ assigneeUserId: supportTickets.assigneeUserId }).from(supportTickets).where(inArray(supportTickets.state, ["rep_triage", "campus_lead_queue", "vendor_queue", "ops_queue"])).limit(5000);
  for (const rule of matching) {
    const skills = await db.select().from(caseAgentSkills).where(and(eq(caseAgentSkills.skill, rule.skill), eq(caseAgentSkills.active, true), gte(caseAgentSkills.level, 80))).limit(200);
    const candidates = skills.map((skill) => ({ skill, workload: open.filter((row) => row.assigneeUserId === skill.userId).length })).filter((row) => row.workload < rule.maxOpenCases).sort((a, b) => a.workload - b.workload || a.skill.userId - b.skill.userId);
    if (!candidates.length) continue;
    const chosen = candidates[0];
    const [decision] = await db.insert(caseRoutingDecisions).values({ ticketId: ticket.id, ruleId: rule.id, proposedUserId: chosen.skill.userId, workload: chosen.workload, reasonsJson: [`${rule.skill} skill assessed at required level`, `${chosen.workload} open cases is below capacity ${rule.maxOpenCases}`, "Lowest workload with stable user ID tie-break"] }).returning();
    return decision;
  }
  const [decision] = await db.insert(caseRoutingDecisions).values({ ticketId: ticket.id, workload: 0, reasonsJson: ["No matching rule had an assessed agent below capacity"], state: "unmatched" }).returning();
  return decision;
}

export async function applyCaseRouting(input: { actor: SalesActor; decisionId: number; expectedVersion: number }) {
  operations(input.actor);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [decision] = await tx.select().from(caseRoutingDecisions).where(eq(caseRoutingDecisions.id, input.decisionId)).for("update").limit(1);
    if (!decision || decision.state !== "proposed" || !decision.proposedUserId) throw new TRPCError({ code: "CONFLICT", message: "Only a proposed decision with an eligible agent can be applied" });
    const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, decision.ticketId)).for("update").limit(1);
    if (!ticket || ticket.version !== input.expectedVersion || ["resolved", "closed"].includes(ticket.state)) throw new TRPCError({ code: "CONFLICT", message: "Case changed before routing; refresh and retry" });
    await tx.update(supportTickets).set({ assigneeUserId: decision.proposedUserId, version: ticket.version + 1, updatedAt: new Date() }).where(eq(supportTickets.id, ticket.id));
    await tx.update(caseRoutingDecisions).set({ state: "applied", decidedByUserId: input.actor.userId, decidedAt: new Date() }).where(eq(caseRoutingDecisions.id, decision.id));
    await tx.insert(supportTicketEvents).values({ ticketId: ticket.id, actorUserId: input.actor.userId, actorRole: input.actor.role, action: "skill_routing_applied", fromState: ticket.state, toState: ticket.state, note: `Skill/capacity routing decision ${decision.id} applied`, evidenceJson: { previousAssigneeUserId: ticket.assigneeUserId, assigneeUserId: decision.proposedUserId } });
    return { ticketId: ticket.id, assigneeUserId: decision.proposedUserId, version: ticket.version + 1 };
  });
}

export async function createCaseSlaPolicy(input: { actor: SalesActor; name: string; priority: "normal" | "urgent"; firstResponseMinutes: number; resolutionMinutes: number; businessStartMinute: number; businessEndMinute: number; businessDays: number[] }) {
  operations(input.actor);
  if (input.resolutionMinutes < input.firstResponseMinutes) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolution time must be at least the first-response target" });
  if (new Set(input.businessDays).size !== input.businessDays.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Business days must not contain duplicates" });
  addBusinessMinutes(new Date(), 0, { startMinute: input.businessStartMinute, endMinute: input.businessEndMinute, businessDays: input.businessDays });
  const db = getDb();
  await db.update(caseSlaPolicies).set({ active: false }).where(eq(caseSlaPolicies.priority, input.priority));
  const [row] = await db.insert(caseSlaPolicies).values({ ...input, timezone: "Africa/Lagos", createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function applyCaseSlaPolicy(input: { actor: SalesActor; ticketId: number; policyId: number; expectedVersion: number }) {
  operations(input.actor);
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  const db = getDb();
  const [policy] = await db.select().from(caseSlaPolicies).where(eq(caseSlaPolicies.id, input.policyId)).limit(1);
  if (!policy?.active || policy.priority !== ticket.priority) throw new TRPCError({ code: "BAD_REQUEST", message: "An active policy matching case priority is required" });
  const firstResponseDueAt = addBusinessMinutes(ticket.createdAt, policy.firstResponseMinutes, { businessDays: policy.businessDays, startMinute: policy.businessStartMinute, endMinute: policy.businessEndMinute, timezoneOffsetMinutes: 60 });
  const slaDueAt = addBusinessMinutes(ticket.createdAt, policy.resolutionMinutes, { businessDays: policy.businessDays, startMinute: policy.businessStartMinute, endMinute: policy.businessEndMinute, timezoneOffsetMinutes: 60 });
  const [updated] = await db.update(supportTickets).set({ firstResponseDueAt, slaDueAt, slaBreachedAt: slaDueAt > new Date() ? null : ticket.slaBreachedAt, version: ticket.version + 1, updatedAt: new Date() }).where(and(eq(supportTickets.id, ticket.id), eq(supportTickets.version, input.expectedVersion))).returning();
  if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Case changed before SLA recalculation" });
  await appendEvent(ticket.id, input.actor, "business_sla_applied", `${policy.name}: response ${policy.firstResponseMinutes} and resolution ${policy.resolutionMinutes} business minutes`, { policyId: policy.id, firstResponseDueAt, slaDueAt, timezone: policy.timezone });
  return updated;
}

export async function setCaseWaiting(input: { actor: SalesActor; ticketId: number; waiting: boolean; reason: string }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (input.actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance has read-only case oversight" });
  const db = getDb();
  const [open] = await db.select().from(caseSlaIntervals).where(and(eq(caseSlaIntervals.ticketId, ticket.id), eq(caseSlaIntervals.kind, "waiting"), isNull(caseSlaIntervals.endedAt))).limit(1);
  if (input.waiting) {
    if (open) return { ticketId: ticket.id, waiting: true, intervalId: open.id };
    const [row] = await db.insert(caseSlaIntervals).values({ ticketId: ticket.id, kind: "waiting", reason: input.reason, startedAt: new Date(), actorUserId: input.actor.userId }).returning();
    await appendEvent(ticket.id, input.actor, "sla_waiting_started", input.reason, { intervalId: row.id });
    return { ticketId: ticket.id, waiting: true, intervalId: row.id };
  }
  if (!open) return { ticketId: ticket.id, waiting: false };
  const now = new Date();
  const pausedMs = Math.max(0, now.getTime() - open.startedAt.getTime());
  await db.update(caseSlaIntervals).set({ endedAt: now }).where(eq(caseSlaIntervals.id, open.id));
  await db.update(supportTickets).set({ slaDueAt: new Date(ticket.slaDueAt.getTime() + pausedMs), firstResponseDueAt: ticket.firstResponseDueAt ? new Date(ticket.firstResponseDueAt.getTime() + pausedMs) : null, version: ticket.version + 1, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
  await appendEvent(ticket.id, input.actor, "sla_waiting_ended", input.reason, { intervalId: open.id, pausedMs, financialStateChanged: false });
  return { ticketId: ticket.id, waiting: false, pausedMs };
}

const allowedAttachmentTypes = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv"]);
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function attachmentMatchesType(bytes: Buffer, contentType: string) {
  const hex = bytes.subarray(0, 12).toString("hex");
  if (contentType === "image/png") return hex.startsWith("89504e470d0a1a0a");
  if (contentType === "image/jpeg") return hex.startsWith("ffd8ff");
  if (contentType === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (contentType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !text.includes("\0");
  } catch {
    return false;
  }
}

export async function uploadCaseAttachment(input: { actor: SalesActor; ticketId: number; messageId?: number; fileName: string; contentBase64: string; contentType: string; visibility: "internal" | "public" }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (input.actor.role === "finance" || (input.actor.role === "rep" && input.visibility === "internal")) throw new TRPCError({ code: "FORBIDDEN", message: "Your role cannot upload this attachment visibility" });
  if (!allowedAttachmentTypes.has(input.contentType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment type is not allowed for reviewed case evidence" });
  const hasControlCharacter = [...input.fileName].some((character) => character.charCodeAt(0) <= 31);
  if (!input.fileName.trim() || /[/\\]/.test(input.fileName) || hasControlCharacter || input.fileName === "." || input.fileName === "..") throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment filename must be a plain filename without paths or control characters" });
  if (input.contentBase64.length % 4 !== 0 || !base64Pattern.test(input.contentBase64)) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment content must be canonical base64 without whitespace or invalid characters" });
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (!bytes.length || bytes.length > 100 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment must be non-empty and no larger than 100 MB" });
  if (!attachmentMatchesType(bytes, input.contentType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment bytes do not match the declared content type" });
  if (input.messageId) {
    const [message] = await getDb().select().from(caseMessages).where(and(eq(caseMessages.id, input.messageId), eq(caseMessages.ticketId, ticket.id))).limit(1);
    if (!message) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment message does not belong to this case" });
  }
  const saved = await storage.uploadFile({ fileContent: new Uint8Array(bytes), fileName: `cases/${ticket.id}/${input.fileName}`, contentType: input.contentType });
  try {
    const [row] = await getDb().insert(caseAttachments).values({ ticketId: ticket.id, messageId: input.messageId || null, objectKey: saved.key, fileName: input.fileName, contentType: saved.contentType, size: saved.size, sha256: createHash("sha256").update(bytes).digest("hex"), reviewStatus: saved.reviewStatus, visibility: input.visibility, uploadedByUserId: input.actor.userId }).returning();
    await appendEvent(ticket.id, input.actor, "reviewed_attachment_added", `${input.fileName} passed synchronous storage review`, { attachmentId: row.id, size: row.size, sha256: row.sha256, visibility: row.visibility });
    return { attachmentId: row.id, reviewStatus: row.reviewStatus, size: row.size, objectKeyPersisted: true, presignedUrlPersisted: false };
  } catch (error) {
    await storage.deleteFile({ fileKey: saved.key });
    throw error;
  }
}

export async function caseAttachmentUrl(input: { actor: SalesActor; attachmentId: number }) {
  const db = getDb();
  const [attachment] = await db.select().from(caseAttachments).where(eq(caseAttachments.id, input.attachmentId)).limit(1);
  if (!attachment || attachment.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
  await accessibleTicket(input.actor, attachment.ticketId);
  if (input.actor.role === "rep" && attachment.visibility === "internal") throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
  const result = await storage.getPresignedUrl({ key: attachment.objectKey, download: false });
  return { attachmentId: attachment.id, url: result.url, expireTime: result.expireTime, persisted: false };
}

export async function deleteCaseAttachment(input: { actor: SalesActor; attachmentId: number }) {
  const db = getDb();
  const [attachment] = await db.select().from(caseAttachments).where(eq(caseAttachments.id, input.attachmentId)).limit(1);
  if (!attachment || attachment.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "Attachment not found" });
  await accessibleTicket(input.actor, attachment.ticketId);
  if (!["ops", "admin"].includes(input.actor.role) && attachment.uploadedByUserId !== input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the uploader or Operations can delete this attachment" });
  const deleted = await storage.deleteFile({ fileKey: attachment.objectKey });
  await db.update(caseAttachments).set({ deletedAt: new Date(), deletedByUserId: input.actor.userId }).where(eq(caseAttachments.id, attachment.id));
  await appendEvent(attachment.ticketId, input.actor, "reviewed_attachment_deleted", `${attachment.fileName} deleted from object storage`, { attachmentId: attachment.id, deleted });
  return { attachmentId: attachment.id, deleted, objectExists: false };
}

export async function createKnowledgeArticle(input: { actor: SalesActor; articleKey: string; title: string; category: string; body: string; keywords: string[] }) {
  operations(input.actor);
  const redacted = redactSensitiveText(input.body);
  const db = getDb();
  const [previous] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.articleKey, input.articleKey)).orderBy(desc(knowledgeArticles.version)).limit(1);
  const [row] = await db.insert(knowledgeArticles).values({ articleKey: input.articleKey, version: (previous?.version || 0) + 1, title: input.title, category: input.category, body: redacted.text, keywords: input.keywords, createdByUserId: input.actor.userId }).returning();
  return { ...row, redactions: redacted.redactions };
}

export async function approveKnowledgeArticle(input: { actor: SalesActor; articleId: number }) {
  operations(input.actor);
  const db = getDb();
  const [article] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, input.articleId)).limit(1);
  if (!article) throw new TRPCError({ code: "NOT_FOUND", message: "Knowledge article not found" });
  if (article.createdByUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Independent knowledge approval is required" });
  if (article.state !== "draft") throw new TRPCError({ code: "CONFLICT", message: "Only a draft article can be approved" });
  await db.update(knowledgeArticles).set({ state: "superseded" }).where(and(eq(knowledgeArticles.articleKey, article.articleKey), eq(knowledgeArticles.state, "published")));
  const [row] = await db.update(knowledgeArticles).set({ state: "published", approvedByUserId: input.actor.userId, approvedAt: new Date() }).where(eq(knowledgeArticles.id, article.id)).returning();
  return row;
}

export async function linkCaseKnowledge(input: { actor: SalesActor; ticketId: number; articleId: number; helpful?: boolean }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (input.actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance has read-only case oversight" });
  const db = getDb();
  const [article] = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.id, input.articleId)).limit(1);
  if (!article || article.state !== "published") throw new TRPCError({ code: "BAD_REQUEST", message: "Only published knowledge can be linked" });
  const [link] = await db.insert(caseKnowledgeLinks).values({ ticketId: ticket.id, articleId: article.id, helpful: input.helpful ?? null, linkedByUserId: input.actor.userId }).onConflictDoNothing().returning();
  if (input.helpful !== undefined) await db.update(caseKnowledgeLinks).set({ helpful: input.helpful }).where(and(eq(caseKnowledgeLinks.ticketId, ticket.id), eq(caseKnowledgeLinks.articleId, article.id)));
  await appendEvent(ticket.id, input.actor, "knowledge_linked", `${article.title} v${article.version}`, { articleId: article.id, helpful: input.helpful ?? null });
  return { ticketId: ticket.id, articleId: article.id, linked: Boolean(link), helpful: input.helpful ?? null };
}

export async function suggestCaseKnowledge(input: { actor: SalesActor; ticketId: number }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  const db = getDb();
  const articles = await db.select().from(knowledgeArticles).where(eq(knowledgeArticles.state, "published")).orderBy(desc(knowledgeArticles.approvedAt)).limit(200);
  const terms = `${ticket.category} ${ticket.subject} ${ticket.description}`.toLowerCase();
  return articles.map((article) => {
    const matched = article.keywords.filter((keyword) => terms.includes(keyword.toLowerCase()));
    const score = (article.category === ticket.category ? 50 : 0) + Math.min(50, matched.length * 15);
    return { article, score, reasons: [...(article.category === ticket.category ? ["Category match"] : []), ...matched.map((keyword) => `Keyword: ${keyword}`)] };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.article.id - b.article.id).slice(0, 5);
}

export async function createProblemRecord(input: { actor: SalesActor; title: string; ownerUserId?: number }) {
  operations(input.actor);
  const [row] = await getDb().insert(problemRecords).values({ problemRef: ref("PRB"), title: input.title, ownerUserId: input.ownerUserId || input.actor.userId, createdByUserId: input.actor.userId }).returning();
  return row;
}

export async function linkProblemCase(input: { actor: SalesActor; problemId: number; ticketId: number }) {
  operations(input.actor);
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  const db = getDb();
  const [problem] = await db.select().from(problemRecords).where(eq(problemRecords.id, input.problemId)).limit(1);
  if (!problem) throw new TRPCError({ code: "NOT_FOUND", message: "Problem record not found" });
  await db.insert(problemCaseLinks).values({ problemId: problem.id, ticketId: ticket.id, createdByUserId: input.actor.userId }).onConflictDoNothing();
  await appendEvent(ticket.id, input.actor, "problem_linked", `${problem.problemRef} linked without merging or deleting the case`, { problemId: problem.id });
  return { problemId: problem.id, ticketId: ticket.id, destructiveMerge: false };
}

export async function updateProblemRecord(input: { actor: SalesActor; problemId: number; state: "investigating" | "known_error" | "resolved"; rootCause?: string; workaround?: string }) {
  operations(input.actor);
  const db = getDb();
  const [problem] = await db.select().from(problemRecords).where(eq(problemRecords.id, input.problemId)).limit(1);
  if (!problem) throw new TRPCError({ code: "NOT_FOUND", message: "Problem record not found" });
  if (input.state === "resolved" && !input.rootCause?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Resolved problems require a root-cause record" });
  const [row] = await db.update(problemRecords).set({ state: input.state, rootCause: input.rootCause ?? problem.rootCause, workaround: input.workaround ?? problem.workaround, updatedAt: new Date() }).where(eq(problemRecords.id, problem.id)).returning();
  return row;
}

export async function createMajorIncident(input: { actor: SalesActor; title: string; severity: "sev1" | "sev2"; commanderUserId: number; problemId?: number }) {
  operations(input.actor);
  const [commander] = await getDb().select().from(users).where(eq(users.id, input.commanderUserId)).limit(1);
  if (!commander || !["ops", "admin"].includes(commander.role)) throw new TRPCError({ code: "BAD_REQUEST", message: "Incident commander must be an Operations agent" });
  return getDb().transaction(async (tx) => {
    const [incident] = await tx.insert(majorIncidents).values({ incidentRef: ref("INC"), title: input.title, severity: input.severity, commanderUserId: commander.id, problemId: input.problemId || null, createdByUserId: input.actor.userId }).returning();
    await tx.insert(incidentUpdates).values({ incidentId: incident.id, updateType: "opened", body: `${incident.incidentRef} opened with an accountable commander; external communications require separate human review`, authorUserId: input.actor.userId });
    return incident;
  });
}

export async function updateMajorIncident(input: { actor: SalesActor; incidentId: number; state: "investigating" | "monitoring" | "resolved"; body: string; visibility: "internal" | "public" }) {
  operations(input.actor);
  const db = getDb();
  const [incident] = await db.select().from(majorIncidents).where(eq(majorIncidents.id, input.incidentId)).limit(1);
  if (!incident) throw new TRPCError({ code: "NOT_FOUND", message: "Incident not found" });
  if (input.visibility === "public") throw new TRPCError({ code: "BAD_REQUEST", message: "This workspace records internal incident updates only; use a separately approved communications channel" });
  const now = new Date();
  const [row] = await db.update(majorIncidents).set({ state: input.state, resolvedAt: input.state === "resolved" ? now : null, updatedAt: now }).where(eq(majorIncidents.id, incident.id)).returning();
  await db.insert(incidentUpdates).values({ incidentId: incident.id, updateType: input.state, body: redactSensitiveText(input.body).text, visibility: "internal", authorUserId: input.actor.userId });
  return { ...row, externalCommunicationSent: false };
}

export async function reviewCaseQuality(input: { actor: SalesActor; ticketId: number; scores: Record<string, number>; coachingNote: string }) {
  operations(input.actor);
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (ticket.assigneeUserId === input.actor.userId) throw new TRPCError({ code: "FORBIDDEN", message: "Agents cannot quality-review their own assigned case" });
  const totalScore = qualityReviewTotal(input.scores);
  const [row] = await getDb().insert(caseQualityReviews).values({ ticketId: ticket.id, reviewerUserId: input.actor.userId, rubricVersion: "case-quality-v1", scoresJson: input.scores, totalScore, coachingNote: input.coachingNote }).returning();
  await appendEvent(ticket.id, input.actor, "quality_reviewed", `Quality score ${totalScore}/100; coaching recorded`, { reviewId: row.id, rubricVersion: row.rubricVersion });
  return row;
}

export async function recordCaseExperience(input: { actor: SalesActor; ticketId: number; respondentToken: string; csat: number; effort: number; comment?: string }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  if (!["resolved", "closed"].includes(ticket.state)) throw new TRPCError({ code: "BAD_REQUEST", message: "Experience surveys open only after case resolution" });
  const redacted = input.comment ? redactSensitiveText(input.comment) : { text: null, redactions: [] };
  const [row] = await getDb().insert(caseExperienceSurveys).values({ ticketId: ticket.id, respondentTokenHash: hash(input.respondentToken), csat: input.csat, effort: input.effort, comment: redacted.text, createdByUserId: input.actor.userId }).onConflictDoNothing().returning();
  return { surveyId: row?.id, duplicate: !row, rawRespondentPersisted: false, redactions: redacted.redactions };
}

export async function runCaseCopilot(input: { actor: SalesActor; ticketId: number }) {
  const ticket = await accessibleTicket(input.actor, input.ticketId);
  const db = getDb();
  const messages = await db.select().from(caseMessages).where(eq(caseMessages.ticketId, ticket.id)).orderBy(desc(caseMessages.createdAt)).limit(20);
  const visible = input.actor.role === "rep" ? messages.filter((message) => message.visibility === "public") : messages;
  const result = buildCaseCopilot({ subject: ticket.subject, description: ticket.description, state: ticket.state, messages: visible.map((message) => message.body) });
  const inputHash = hash({ ticket: [ticket.id, ticket.version, ticket.subject, ticket.description], messages: visible.map((message) => [message.id, message.body]) });
  const [row] = await db.insert(caseCopilotRuns).values({ runRef: ref("COP"), ticketId: ticket.id, inputHash, summary: result.summary, redactionsJson: result.redactions, suggestedActionsJson: result.suggestedActions, modelVersion: result.modelVersion, createdByUserId: input.actor.userId }).returning();
  return { ...row, autonomousReplySent: false, financialStateChanged: false };
}

export async function acceptCaseCopilot(input: { actor: SalesActor; runId: number }) {
  const db = getDb();
  const [run] = await db.select().from(caseCopilotRuns).where(eq(caseCopilotRuns.id, input.runId)).limit(1);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Copilot run not found" });
  await accessibleTicket(input.actor, run.ticketId);
  if (input.actor.role === "finance") throw new TRPCError({ code: "FORBIDDEN", message: "Finance has read-only case oversight" });
  const [row] = await db.update(caseCopilotRuns).set({ state: "accepted", acceptedByUserId: input.actor.userId, acceptedAt: new Date() }).where(eq(caseCopilotRuns.id, run.id)).returning();
  await appendEvent(run.ticketId, input.actor, "copilot_recommendation_accepted", "A human accepted the decision-support run; no reply was sent automatically", { runId: run.id });
  return { ...row, autonomousReplySent: false };
}

export async function listCaseInnovationWorkspace(actor: SalesActor) {
  const base = await listCaseWorkspace(actor);
  const ids = base.cases.map((row) => row.ticket.id);
  const db = getDb();
  const staffRead = ["ops", "finance", "admin"].includes(actor.role);
  const [intakes, rules, routing, skills, slaPolicies, intervals, attachmentRows, articles, knowledgeLinks, problems, problemLinks, incidents, incidentUpdateRows, quality, surveys, copilot] = await Promise.all([
    ids.length ? db.select().from(caseChannelIntakes).where(inArray(caseChannelIntakes.ticketId, ids)).orderBy(desc(caseChannelIntakes.createdAt)).limit(200) : [],
    staffRead ? db.select().from(caseRoutingRules).orderBy(caseRoutingRules.priority).limit(100) : [],
    ids.length ? db.select().from(caseRoutingDecisions).where(inArray(caseRoutingDecisions.ticketId, ids)).orderBy(desc(caseRoutingDecisions.createdAt)).limit(100) : [],
    staffRead ? db.select().from(caseAgentSkills).orderBy(caseAgentSkills.skill).limit(200) : [],
    db.select().from(caseSlaPolicies).where(eq(caseSlaPolicies.active, true)).limit(20),
    ids.length ? db.select().from(caseSlaIntervals).where(inArray(caseSlaIntervals.ticketId, ids)).orderBy(desc(caseSlaIntervals.startedAt)).limit(300) : [],
    ids.length ? db.select().from(caseAttachments).where(and(inArray(caseAttachments.ticketId, ids), isNull(caseAttachments.deletedAt))).orderBy(desc(caseAttachments.createdAt)).limit(300) : [],
    staffRead ? db.select().from(knowledgeArticles).orderBy(desc(knowledgeArticles.createdAt)).limit(100) : db.select().from(knowledgeArticles).where(eq(knowledgeArticles.state, "published")).orderBy(desc(knowledgeArticles.approvedAt)).limit(100),
    ids.length ? db.select().from(caseKnowledgeLinks).where(inArray(caseKnowledgeLinks.ticketId, ids)).limit(300) : [],
    staffRead ? db.select().from(problemRecords).orderBy(desc(problemRecords.updatedAt)).limit(100) : [],
    ids.length ? db.select().from(problemCaseLinks).where(inArray(problemCaseLinks.ticketId, ids)).limit(300) : [],
    staffRead ? db.select().from(majorIncidents).orderBy(desc(majorIncidents.updatedAt)).limit(100) : [],
    staffRead ? db.select().from(incidentUpdates).orderBy(desc(incidentUpdates.createdAt)).limit(300) : [],
    ids.length ? db.select().from(caseQualityReviews).where(inArray(caseQualityReviews.ticketId, ids)).orderBy(desc(caseQualityReviews.createdAt)).limit(200) : [],
    ids.length ? db.select().from(caseExperienceSurveys).where(inArray(caseExperienceSurveys.ticketId, ids)).orderBy(desc(caseExperienceSurveys.createdAt)).limit(300) : [],
    ids.length ? db.select().from(caseCopilotRuns).where(inArray(caseCopilotRuns.ticketId, ids)).orderBy(desc(caseCopilotRuns.createdAt)).limit(200) : [],
  ]);
  const attachments = attachmentRows.filter((row) => actor.role !== "rep" || row.visibility === "public").map((row) => {
    const { objectKey, ...safe } = row;
    void objectKey;
    return safe;
  });
  const tickets = base.cases.map((row) => row.ticket);
  const duration = (start: Date | null, end: Date | null) => start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : null;
  const firstResponses = tickets.map((ticket) => duration(ticket.createdAt, ticket.firstRespondedAt)).filter((value): value is number => value !== null);
  const resolutions = tickets.map((ticket) => duration(ticket.createdAt, ticket.resolvedAt)).filter((value): value is number => value !== null);
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const visibleProblems = staffRead ? problems : problems.filter((problem) => problemLinks.some((link) => link.problemId === problem.id));
  const visibleCopilot = copilot.filter((row) => actor.role !== "rep" || row.createdByUserId === actor.userId);
  const macros = actor.role === "rep" ? [] : actor.role === "vendor"
    ? await db.select().from(supportResolutionMacros).where(eq(supportResolutionMacros.vendorId, actor.vendorId || -1)).limit(100)
    : await db.select().from(supportResolutionMacros).limit(100);
  return {
    cases: base.cases, intakes, rules, routing, skills, slaPolicies, intervals, attachments, articles, knowledgeLinks, problems: visibleProblems, problemLinks, incidents, incidentUpdates: incidentUpdateRows, quality, surveys, copilot: visibleCopilot,
    macros,
    metrics: {
      ...base.metrics,
      averageFirstResponseMinutes: average(firstResponses),
      averageResolutionMinutes: average(resolutions),
      averageCsat: surveys.length ? Math.round(surveys.reduce((sum, row) => sum + row.csat, 0) / surveys.length * 10) / 10 : null,
      averageEffort: surveys.length ? Math.round(surveys.reduce((sum, row) => sum + row.effort, 0) / surveys.length * 10) / 10 : null,
      averageQuality: quality.length ? Math.round(quality.reduce((sum, row) => sum + row.totalScore, 0) / quality.length) : null,
      knowledgeHelpfulRate: knowledgeLinks.filter((row) => row.helpful !== null).length ? Math.round(knowledgeLinks.filter((row) => row.helpful === true).length / knowledgeLinks.filter((row) => row.helpful !== null).length * 100) : null,
      activeProblems: visibleProblems.filter((row) => row.state !== "resolved").length,
      majorIncidents: incidents.filter((row) => row.state !== "resolved").length,
    },
    features: ["Sandbox Omnichannel Intake", "Skill & Capacity Routing", "Business-Hours SLA", "Reviewed Attachments", "Knowledge Center", "Problem Management", "Major Incident Command", "Quality Coaching", "CSAT & Effort Analytics", "Redacting Case Copilot"],
    boundary: "Case automation normalizes sandbox intake, proposes routing and summarizes redacted evidence. Humans approve replies and external communications. Cases, attachments, copilots and support analytics never alter deals, escrow, attribution, commissions or payouts.",
  };
}
