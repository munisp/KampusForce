import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, campaignEnrollments, campaigns, products, trainingAssignments, trainingAttempts, trainingModules, trainingProgress, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { assertSalesRole, type SalesActor } from "./salesAccess";

const moduleSeeds: Array<typeof trainingModules.$inferInsert> = [
  {
    moduleKey: "ethical-sales-foundations",
    title: "Ethical sales foundations",
    summary: "Consent, truthful product comparisons and the limits of a campus representative’s role.",
    content: "Sell the vendor’s actual terms, never an invented bonus or guaranteed return. Explain that the representative may earn vendor-funded commission. Obtain consent before attribution or a referral. Do not add a customer markup, pressure a customer, or present a planning forecast as earned commission. A suitable recommendation accounts for the customer’s need, price, activation requirement and vendor quality. Record the next step accurately so another team member does not repeat or contradict the conversation.",
    category: "conduct",
    durationMinutes: 18,
    passingScore: 80,
    required: true,
    sortOrder: 1,
    quizJson: [
      { question: "What creates earned commission?", options: ["A CRM stage change", "A vendor-verified qualifying activation", "A shared draft"], answerIndex: 1 },
      { question: "Which statement is permitted?", options: ["Guaranteed profit", "Vendor-funded commission may apply after verified activation", "KampusForce sets the vendor price"], answerIndex: 1 },
    ],
  },
  {
    moduleKey: "privacy-vendor-kyc-boundary",
    title: "Privacy and the vendor KYC boundary",
    summary: "Keep NIN, BVN, OTPs, passwords and regulated onboarding inside the vendor’s flow.",
    content: "KampusForce uses salted customer-phone hashes for attribution where a phone is supplied. Never collect or record raw NIN, BVN, card PIN, OTP or vendor passwords in notes, campaigns, support cases or training examples. Customer KYC belongs to the vendor. Use an alias in the CRM and record only the minimum context needed for the next action. Internal notes are still operational records, not a place for secrets.",
    category: "privacy",
    durationMinutes: 16,
    passingScore: 80,
    required: true,
    sortOrder: 2,
    quizJson: [
      { question: "Where does customer KYC happen?", options: ["In a rep support note", "In the vendor’s regulated flow", "In a campaign form"], answerIndex: 1 },
      { question: "What belongs in a CRM alias?", options: ["A non-sensitive relationship label", "The customer’s NIN", "An OTP"], answerIndex: 0 },
    ],
  },
  {
    moduleKey: "consultative-opportunity-management",
    title: "Consultative opportunity management",
    summary: "Use discovery, complete timelines and explainable next actions instead of pipeline vanity.",
    content: "Start with the customer’s goal and constraints. Record useful activity promptly: what was requested, what was explained and what happens next. A quiet opportunity needs a reason and a realistic follow-up, not arbitrary stage advancement. Drafts are prepared from recorded context and require human approval. Mark shared only after you actually share through your own channel. Won requires a vendor-verified deal; Lost requires a reason so targeting can improve.",
    category: "sales_skills",
    durationMinutes: 24,
    passingScore: 80,
    required: true,
    sortOrder: 3,
    quizJson: [
      { question: "What should a next action contain?", options: ["A specific step and timing", "A vague hope", "A guaranteed deal value"], answerIndex: 0 },
      { question: "When can an opportunity be marked Won?", options: ["After any call", "When a verified qualifying deal exists", "When a draft is approved"], answerIndex: 1 },
    ],
  },
  {
    moduleKey: "objection-handling-and-follow-up",
    title: "Objection handling and contextual follow-up",
    summary: "Resolve price, trust and timing concerns without pressure or unsupported claims.",
    content: "Listen and classify the concern before responding. For price, compare the vendor’s listed total and exclusions. For trust, explain the vendor boundary and verifiable activation evidence. For timing, agree a specific follow-up and snooze rather than repeatedly contacting the customer. If the product is unsuitable, close Lost with the reason. Never use a leaderboard position to pressure a customer or another rep.",
    category: "sales_skills",
    durationMinutes: 20,
    passingScore: 80,
    required: false,
    sortOrder: 4,
    quizJson: [
      { question: "A customer asks for time. What is best?", options: ["Send daily messages", "Agree a contextual follow-up date", "Mark the deal Won"], answerIndex: 1 },
      { question: "How should price objections be handled?", options: ["Invent a discount", "Review actual vendor terms", "Hide fees"], answerIndex: 1 },
    ],
  },
  {
    moduleKey: "case-resolution-and-escalation",
    title: "Case resolution and escalation",
    summary: "Use public replies, internal notes, ownership and evidence to resolve cases safely.",
    content: "Claim ownership before investigation. Send a timely public first response without promising an unverified financial outcome. Use internal notes for staff-only analysis and never place secrets in either message type. Link duplicates rather than deleting history. Snooze only with a wake-up time and reason. Resolve with evidence, invite CSAT, and reopen when new evidence changes the situation. Support activity never directly edits a deal or ledger entry.",
    category: "service",
    durationMinutes: 19,
    passingScore: 80,
    required: false,
    sortOrder: 5,
    quizJson: [
      { question: "How should duplicate cases be handled?", options: ["Delete one", "Link them non-destructively", "Hide the audit trail"], answerIndex: 1 },
      { question: "What does a support resolution do to commission?", options: ["Automatically increases it", "Nothing directly", "Creates a payout"], answerIndex: 1 },
    ],
  },
];

let catalogSeeded = false;

/** Adds the starter lessons once per process. Edits Operations make to them are kept. */
export async function ensureTrainingCatalog() {
  if (catalogSeeded) return;
  const db = getDb();
  for (const seed of moduleSeeds) {
    await db.insert(trainingModules).values(seed).onConflictDoNothing();
  }
  catalogSeeded = true;
}

export const TRAINING_CATEGORIES = ["conduct", "privacy", "sales_skills", "service", "product"] as const;

export type QuizQuestion = { question: string; options: string[]; answerIndex: number };

export type TrainingModuleInput = {
  title: string;
  summary: string;
  content: string;
  category: (typeof TRAINING_CATEGORIES)[number];
  durationMinutes: number;
  passingScore: number;
  required: boolean;
  forEveryone: boolean;
  quiz: QuizQuestion[];
  products: Array<{ productId: number; required: boolean }>;
  campaignIds: number[];
};

/** Rules a quiz must meet before it's saved. Exported for tests. */
export function validateQuiz(quiz: QuizQuestion[]) {
  if (!quiz.length) return "Add at least one quiz question.";
  for (const [index, item] of quiz.entries()) {
    const n = index + 1;
    if (item.question.trim().length < 5) return `Question ${n} is too short.`;
    const options = item.options.map((option) => option.trim());
    if (options.length < 2) return `Question ${n} needs at least two answers.`;
    if (options.some((option) => !option)) return `Question ${n} has an empty answer.`;
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return `Question ${n} has the same answer twice.`;
    if (!Number.isInteger(item.answerIndex) || item.answerIndex < 0 || item.answerIndex >= options.length) return `Choose the correct answer for question ${n}.`;
  }
  return null;
}

export function moduleKeyFromTitle(title: string) {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "lesson";
  return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanQuiz(quiz: QuizQuestion[]) {
  return quiz.map((item) => ({ question: item.question.trim(), options: item.options.map((option) => option.trim()), answerIndex: item.answerIndex }));
}

async function checkTargets(input: Pick<TrainingModuleInput, "products" | "campaignIds">) {
  const db = getDb();
  const productIds = [...new Set(input.products.map((row) => row.productId))];
  if (productIds.length !== input.products.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A product is listed twice." });
  if (productIds.length) {
    const found = await db.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
    if (found.length !== productIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "One of the products no longer exists." });
  }
  const campaignIds = [...new Set(input.campaignIds)];
  if (campaignIds.length) {
    const found = await db.select({ id: campaigns.id, state: campaigns.state }).from(campaigns).where(inArray(campaigns.id, campaignIds));
    if (found.length !== campaignIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "One of the campaigns no longer exists." });
    if (found.some((row) => ["completed", "rejected"].includes(row.state))) throw new TRPCError({ code: "BAD_REQUEST", message: "A finished or rejected campaign can't be given new lessons." });
  }
  return { products: input.products, campaignIds };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function replaceAssignments(tx: Tx, moduleId: number, actorUserId: number, targets: { products: TrainingModuleInput["products"]; campaignIds: number[] }) {
  await tx.delete(trainingAssignments).where(eq(trainingAssignments.moduleId, moduleId));
  const rows = [
    ...targets.products.map((row) => ({ moduleId, productId: row.productId, campaignId: null, required: row.required, createdByUserId: actorUserId })),
    ...targets.campaignIds.map((campaignId) => ({ moduleId, productId: null, campaignId, required: false, createdByUserId: actorUserId })),
  ];
  if (rows.length) await tx.insert(trainingAssignments).values(rows);
}

function checkModuleInput(input: TrainingModuleInput) {
  const problem = validateQuiz(input.quiz);
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
  if (!TRAINING_CATEGORIES.includes(input.category)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a category." });
}

export async function createTrainingModule(actor: SalesActor, input: TrainingModuleInput) {
  assertSalesRole(actor, ["ops", "admin"]);
  await ensureTrainingCatalog();
  checkModuleInput(input);
  const targets = await checkTargets(input);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${trainingModules.sortOrder}), 0) + 1` }).from(trainingModules);
    const [module] = await tx.insert(trainingModules).values({
      moduleKey: moduleKeyFromTitle(input.title),
      title: input.title.trim(), summary: input.summary.trim(), content: input.content.trim(), category: input.category,
      durationMinutes: input.durationMinutes, passingScore: input.passingScore, required: input.forEveryone && input.required, forEveryone: input.forEveryone, sortOrder: Number(next),
      quizJson: cleanQuiz(input.quiz),
    }).returning();
    await replaceAssignments(tx, module.id, actor.userId, targets);
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: "training.module_created", entityType: "training_module", entityId: String(module.id), metadataJson: { products: targets.products.length, campaigns: targets.campaignIds.length } });
    return { moduleId: module.id, moduleKey: module.moduleKey };
  });
}

export async function updateTrainingModule(actor: SalesActor, moduleId: number, input: TrainingModuleInput) {
  assertSalesRole(actor, ["ops", "admin"]);
  checkModuleInput(input);
  const targets = await checkTargets(input);
  return getDb().transaction(async (tx) => {
    const [module] = await tx.select().from(trainingModules).where(eq(trainingModules.id, moduleId)).limit(1).for("update");
    if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found." });
    await tx.update(trainingModules).set({
      title: input.title.trim(), summary: input.summary.trim(), content: input.content.trim(), category: input.category,
      durationMinutes: input.durationMinutes, passingScore: input.passingScore, required: input.forEveryone && input.required, forEveryone: input.forEveryone,
      quizJson: cleanQuiz(input.quiz), updatedAt: new Date(),
    }).where(eq(trainingModules.id, moduleId));
    await replaceAssignments(tx, moduleId, actor.userId, targets);
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: "training.module_updated", entityType: "training_module", entityId: String(moduleId), metadataJson: { products: targets.products.length, campaigns: targets.campaignIds.length } });
    return { moduleId };
  });
}

export async function setTrainingModuleActive(actor: SalesActor, moduleId: number, active: boolean) {
  assertSalesRole(actor, ["ops", "admin"]);
  const updated = await getDb().update(trainingModules).set({ active, updatedAt: new Date() }).where(eq(trainingModules.id, moduleId)).returning({ id: trainingModules.id });
  if (!updated.length) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found." });
  await getDb().insert(auditLogs).values({ actorUserId: actor.userId, action: active ? "training.module_restored" : "training.module_archived", entityType: "training_module", entityId: String(moduleId), metadataJson: {} });
  return { moduleId, active };
}

async function assignmentRows(moduleIds?: number[]) {
  return getDb().select({ assignment: trainingAssignments, productName: products.name, productStatus: products.status, vendorId: products.vendorId, campaignName: campaigns.name, campaignState: campaigns.state })
    .from(trainingAssignments)
    .leftJoin(products, eq(trainingAssignments.productId, products.id))
    .leftJoin(campaigns, eq(trainingAssignments.campaignId, campaigns.id))
    .where(moduleIds ? (moduleIds.length ? inArray(trainingAssignments.moduleId, moduleIds) : sql`false`) : undefined);
}

/** Everything Operations needs to manage lessons, with the correct answers. */
export async function getTrainingAdmin(actor: SalesActor) {
  assertSalesRole(actor, ["ops", "admin"]);
  await ensureTrainingCatalog();
  const db = getDb();
  const [modules, assignments, completions, productList, campaignList] = await Promise.all([
    db.select().from(trainingModules).orderBy(asc(trainingModules.sortOrder)),
    assignmentRows(),
    db.select({ moduleId: trainingProgress.moduleId, count: sql<number>`count(*)::int` }).from(trainingProgress).where(eq(trainingProgress.state, "completed")).groupBy(trainingProgress.moduleId),
    db.select({ id: products.id, name: products.name, status: products.status, vendorName: vendors.companyName }).from(products).innerJoin(vendors, eq(products.vendorId, vendors.id)).orderBy(asc(products.name)),
    db.select({ id: campaigns.id, name: campaigns.name, state: campaigns.state, goal: campaigns.goal }).from(campaigns).where(inArray(campaigns.state, ["draft", "pending_review", "approved", "scheduled", "active", "paused"])).orderBy(desc(campaigns.createdAt)).limit(100),
  ]);
  return {
    modules: modules.map((module) => ({
      ...module,
      completions: completions.find((row) => row.moduleId === module.id)?.count ?? 0,
      assignments: assignments.filter((row) => row.assignment.moduleId === module.id).map((row) => ({
        id: row.assignment.id, productId: row.assignment.productId, campaignId: row.assignment.campaignId, required: row.assignment.required,
        name: row.productName || row.campaignName || "", state: row.productStatus || row.campaignState || "",
      })),
    })),
    products: productList,
    campaigns: campaignList,
    categories: TRAINING_CATEGORIES,
  };
}

type Reason = { kind: "product"; id: number; name: string; required: boolean } | { kind: "campaign"; id: number; name: string };

export async function getTrainingWorkspace(actor: SalesActor) {
  await ensureTrainingCatalog();
  const db = getDb();
  const staff = ["ops", "admin", "finance"].includes(actor.role);
  const allModules = await db.select().from(trainingModules).where(eq(trainingModules.active, true)).orderBy(asc(trainingModules.sortOrder));
  const assignments = await assignmentRows(allModules.map((module) => module.id));
  const enrolledCampaignIds = actor.repId
    ? (await db.select({ campaignId: campaignEnrollments.campaignId }).from(campaignEnrollments).where(and(eq(campaignEnrollments.repId, actor.repId), ne(campaignEnrollments.state, "suppressed")))).map((row) => row.campaignId)
    : [];
  const modules = allModules.flatMap((module) => {
    const rows = assignments.filter((row) => row.assignment.moduleId === module.id);
    const reasons: Reason[] = [];
    for (const row of rows) {
      const a = row.assignment;
      if (a.productId && row.productStatus === "active" && (staff || actor.role === "rep" || row.vendorId === actor.vendorId)) reasons.push({ kind: "product", id: a.productId, name: row.productName || "", required: a.required });
      if (a.campaignId && (staff || enrolledCampaignIds.includes(a.campaignId))) reasons.push({ kind: "campaign", id: a.campaignId, name: row.campaignName || "" });
    }
    // A lesson for everyone is always shown. Any other lesson only where a product or campaign gives it to this person;
    // staff see every lesson so they can preview them.
    if (!module.forEveryone && !reasons.length && !staff) return [];
    const blocksSelling = reasons.some((reason) => reason.kind === "product" && reason.required);
    return [{
      ...module,
      quizJson: module.quizJson.map(({ question, options }) => ({ question, options })),
      general: module.forEveryone,
      reasons,
      blocksSelling,
      mustPass: module.required || blocksSelling,
    }];
  });
  const moduleIds = modules.map((module) => module.id);
  const [progress, attempts] = await Promise.all([
    moduleIds.length ? db.select().from(trainingProgress).where(and(eq(trainingProgress.userId, actor.userId), inArray(trainingProgress.moduleId, moduleIds))) : [],
    db.select().from(trainingAttempts).where(eq(trainingAttempts.userId, actor.userId)).orderBy(desc(trainingAttempts.createdAt)).limit(30),
  ]);
  const passed = (moduleId: number) => progress.some((row) => row.moduleId === moduleId && row.state === "completed");
  const mustPass = modules.filter((module) => module.mustPass);
  const completedRequired = mustPass.filter((module) => passed(module.id)).length;
  return {
    modules,
    progress,
    attempts: attempts.filter((attempt) => moduleIds.includes(attempt.moduleId)),
    metrics: {
      lessons: modules.length,
      minutes: modules.reduce((sum, module) => sum + module.durationMinutes, 0),
      completed: modules.filter((module) => passed(module.id)).length,
      requiredCount: mustPass.length,
      completedRequired,
      readinessPercent: mustPass.length ? Math.round(completedRequired / mustPass.length * 100) : 100,
      averageBestScore: progress.length ? Math.round(progress.reduce((sum, row) => sum + row.bestScore, 0) / progress.length) : 0,
    },
    boundary: "Finishing a lesson is a record for KampusForce. It isn't a certificate, and it doesn't let you do ID checks.",
  };
}

/** Required lessons for a product that this user hasn't passed yet. */
export async function missingProductTraining(userId: number, productId?: number) {
  const db = getDb();
  const rows = await db.select({ productId: trainingAssignments.productId, moduleId: trainingModules.id, title: trainingModules.title })
    .from(trainingAssignments).innerJoin(trainingModules, eq(trainingAssignments.moduleId, trainingModules.id))
    .where(and(eq(trainingAssignments.required, true), eq(trainingModules.active, true), isNotNull(trainingAssignments.productId), productId ? eq(trainingAssignments.productId, productId) : undefined));
  if (!rows.length) return [] as Array<{ productId: number; moduleId: number; title: string }>;
  const done = await db.select({ moduleId: trainingProgress.moduleId }).from(trainingProgress)
    .where(and(eq(trainingProgress.userId, userId), eq(trainingProgress.state, "completed"), inArray(trainingProgress.moduleId, [...new Set(rows.map((row) => row.moduleId))])));
  const passedIds = new Set(done.map((row) => row.moduleId));
  return rows.filter((row) => !passedIds.has(row.moduleId)).map((row) => ({ productId: row.productId!, moduleId: row.moduleId, title: row.title }));
}

/** Server-side gate: a rep can't share or record a sale for a product until they pass its required lessons. */
export async function assertProductTrainingPassed(userId: number, productId: number) {
  const missing = await missingProductTraining(userId, productId);
  if (!missing.length) return;
  const names = missing.map((row) => `“${row.title}”`).join(", ");
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Pass ${names} in Training before you sell this product.` });
}

export async function startTraining(actor: SalesActor, moduleId: number) {
  const [module] = await getDb().select().from(trainingModules).where(and(eq(trainingModules.id, moduleId), eq(trainingModules.active, true))).limit(1);
  if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Training module not found" });
  await getDb().insert(trainingProgress).values({ userId: actor.userId, moduleId, state: "in_progress", startedAt: new Date() }).onConflictDoNothing();
  await getDb().update(trainingProgress).set({ state: "in_progress", startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(trainingProgress.userId, actor.userId), eq(trainingProgress.moduleId, moduleId), eq(trainingProgress.state, "assigned")));
  return { moduleId, state: "in_progress" as const };
}

export async function submitTrainingAttempt(input: { actor: SalesActor; moduleId: number; answers: number[] }) {
  const [module] = await getDb().select().from(trainingModules).where(and(eq(trainingModules.id, input.moduleId), eq(trainingModules.active, true))).limit(1);
  if (!module) throw new TRPCError({ code: "NOT_FOUND", message: "Training module not found" });
  if (input.answers.length !== module.quizJson.length || input.answers.some((answer, index) => !Number.isInteger(answer) || answer < 0 || answer >= module.quizJson[index].options.length)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Answer every quiz question before submitting" });
  }
  const correct = module.quizJson.reduce((sum, question, index) => sum + (question.answerIndex === input.answers[index] ? 1 : 0), 0);
  const score = Math.round(correct / module.quizJson.length * 100);
  const passed = score >= module.passingScore;
  return getDb().transaction(async (tx) => {
    await tx.insert(trainingProgress).values({ userId: input.actor.userId, moduleId: module.id, state: "in_progress", startedAt: new Date() }).onConflictDoNothing();
    const [progress] = await tx.select().from(trainingProgress).where(and(eq(trainingProgress.userId, input.actor.userId), eq(trainingProgress.moduleId, module.id))).limit(1).for("update");
    if (!progress) throw new TRPCError({ code: "NOT_FOUND", message: "Training progress could not be started" });
    const now = new Date();
    const [{ id }] = await tx.insert(trainingAttempts).values({ userId: input.actor.userId, moduleId: module.id, score, passed, answersJson: input.answers }).returning({ id: trainingAttempts.id });
    await tx.update(trainingProgress).set({
      state: passed ? "completed" : "in_progress",
      bestScore: Math.max(progress.bestScore, score),
      attempts: progress.attempts + 1,
      startedAt: progress.startedAt || now,
      completedAt: passed ? progress.completedAt || now : null,
      updatedAt: now,
    }).where(eq(trainingProgress.id, progress.id));
    return {
      attemptId: id,
      moduleId: module.id,
      score,
      passed,
      passingScore: module.passingScore,
      correct,
      total: module.quizJson.length,
      externalCertification: false,
    };
  });
}
