import { and, asc, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { trainingAttempts, trainingModules, trainingProgress } from "@db/schema";
import { getDb } from "../queries/connection";
import type { SalesActor } from "./salesAccess";

const moduleSeeds: Array<typeof trainingModules.$inferInsert> = [
  {
    moduleKey: "ethical-sales-foundations",
    title: "Ethical sales foundations",
    summary: "Consent, truthful product comparisons and the limits of a student representative’s role.",
    content: "Sell the vendor’s actual terms, never an invented bonus or guaranteed return. Explain that the representative may earn vendor-funded commission. Obtain consent before attribution or a referral. Do not add a customer markup, pressure a student, or present a planning forecast as earned commission. A suitable recommendation accounts for the student’s need, price, activation requirement and vendor quality. Record the next step accurately so another team member does not repeat or contradict the conversation.",
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
    content: "Start with the student’s goal and constraints. Record useful activity promptly: what was requested, what was explained and what happens next. A quiet opportunity needs a reason and a realistic follow-up, not arbitrary stage advancement. Drafts are prepared from recorded context and require human approval. Mark shared only after you actually share through your own channel. Won requires a vendor-verified deal; Lost requires a reason so targeting can improve.",
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
    content: "Listen and classify the concern before responding. For price, compare the vendor’s listed total and exclusions. For trust, explain the vendor boundary and verifiable activation evidence. For timing, agree a specific follow-up and snooze rather than repeatedly contacting the student. If the product is unsuitable, close Lost with the reason. Never use a leaderboard position to pressure a customer or another rep.",
    category: "sales_skills",
    durationMinutes: 20,
    passingScore: 80,
    required: false,
    sortOrder: 4,
    quizJson: [
      { question: "A student asks for time. What is best?", options: ["Send daily messages", "Agree a contextual follow-up date", "Mark the deal Won"], answerIndex: 1 },
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

export async function ensureTrainingCatalog() {
  const db = getDb();
  for (const seed of moduleSeeds) {
    await db.insert(trainingModules).values(seed).onConflictDoNothing();
  }
}

export async function getTrainingWorkspace(actor: SalesActor) {
  await ensureTrainingCatalog();
  const db = getDb();
  const modules = await db.select().from(trainingModules).where(eq(trainingModules.active, true)).orderBy(asc(trainingModules.sortOrder));
  for (const module of modules) {
    await db.insert(trainingProgress).values({ userId: actor.userId, moduleId: module.id }).onConflictDoNothing();
  }
  const [progress, attempts] = await Promise.all([
    db.select().from(trainingProgress).where(eq(trainingProgress.userId, actor.userId)),
    db.select().from(trainingAttempts).where(eq(trainingAttempts.userId, actor.userId)).orderBy(desc(trainingAttempts.createdAt)).limit(30),
  ]);
  const safeModules = modules.map((module) => ({
    ...module,
    quizJson: module.quizJson.map(({ question, options }) => ({ question, options })),
  }));
  const completedRequired = modules.filter((module) => module.required && progress.some((row) => row.moduleId === module.id && row.state === "completed")).length;
  const requiredCount = modules.filter((module) => module.required).length;
  return {
    modules: safeModules,
    progress,
    attempts,
    metrics: {
      completed: progress.filter((row) => row.state === "completed").length,
      requiredCount,
      completedRequired,
      readinessPercent: requiredCount ? Math.round(completedRequired / requiredCount * 100) : 100,
      averageBestScore: progress.length ? Math.round(progress.reduce((sum, row) => sum + row.bestScore, 0) / progress.length) : 0,
    },
    boundary: "Completion is an internal learning record and readiness signal, not an accredited external certification or permission to perform regulated KYC.",
  };
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
