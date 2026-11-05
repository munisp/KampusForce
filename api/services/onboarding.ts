import { and, count, desc, eq, inArray } from "drizzle-orm";
import { attributionRecords, enrollmentAttestations, escrowWallets, identityCases, payoutDestinations, products, reps, users, vendors } from "@db/schema";
import { getDb } from "../queries/connection";

// "Getting started" for a new vendor or campus rep: each step's state comes from the real records, so the list says
// exactly what to do next and what the person is waiting on.
export type StepState = "done" | "current" | "waiting" | "todo";
export type OnboardingStep = { key: string; title: string; detail: string; state: StepState; href?: string; action?: string };
export type Onboarding = { steps: OnboardingStep[]; complete: boolean };

const REVIEWING = ["submitted", "processing", "manual_review"];

function checkStep(key: string, title: string, href: string, caseState: string | undefined, approved: boolean, copy: { start: string; waiting: string }): OnboardingStep {
  if (approved) return { key, title, detail: "Approved.", state: "done" };
  if (caseState && REVIEWING.includes(caseState)) return { key, title, detail: copy.waiting, state: "waiting", href, action: "See your check" };
  if (caseState === "needs_more_info") return { key, title, detail: "Operations needs something else from you. Open Verification to see what, then send it again.", state: "current", href, action: "See what's needed" };
  if (caseState === "rejected") return { key, title, detail: "This wasn't approved. Open Verification to see the reason and start a new check.", state: "current", href, action: "See why" };
  return { key, title, detail: copy.start, state: "current", href, action: "Start" };
}

/** Marks the first actionable step as the one to do now; later actionable steps wait their turn. */
function finish(steps: OnboardingStep[]): Onboarding {
  let seenCurrent = false;
  for (const step of steps) {
    if (step.state !== "current") continue;
    if (seenCurrent) step.state = "todo";
    seenCurrent = true;
  }
  return { steps, complete: steps.every((s) => s.state === "done") };
}

export async function vendorOnboarding(userId: number): Promise<Onboarding> {
  const db = getDb();
  const [vendor] = await db.select().from(vendors).where(eq(vendors.userId, userId)).limit(1);
  if (!vendor) return { steps: [], complete: true };
  const [kyb] = await db.select({ state: identityCases.state }).from(identityCases)
    .where(and(eq(identityCases.caseType, "vendor_kyb"), eq(identityCases.subjectType, "vendor"), eq(identityCases.subjectId, vendor.id)))
    .orderBy(desc(identityCases.createdAt)).limit(1);
  const [{ value: productCount }] = await db.select({ value: count() }).from(products).where(eq(products.vendorId, vendor.id));
  const [wallet] = await db.select({ balance: escrowWallets.balanceKobo }).from(escrowWallets).where(eq(escrowWallets.vendorId, vendor.id)).limit(1);
  const approved = vendor.status === "active";
  const steps: OnboardingStep[] = [
    checkStep("business", "Get your business approved", "/identity", kyb?.state, approved, {
      start: "Upload your CAC certificate and the owner's ID under Verification. Operations checks them by eye.",
      waiting: "Operations is checking your documents. You'll get a notification when they decide.",
    }),
    productCount > 0
      ? { key: "product", title: "List your first product", detail: `${productCount} listed. Reps can share ${productCount === 1 ? "it" : "them"} now.`, state: "done" }
      : { key: "product", title: "List your first product", detail: approved ? "Say what it is, how much commission a rep earns, and when you pay it." : "You can list products once your business is approved.", state: approved ? "current" : "todo", href: "/vendor#product-name", action: "Add a product" },
    (wallet?.balance || 0) > 0
      ? { key: "wallet", title: "Add money to your commission wallet", detail: "Funded. Reps' commission is paid from it.", state: "done" }
      : { key: "wallet", title: "Add money to your commission wallet", detail: approved ? "Reps' commission is paid from this wallet, so a sale can only be confirmed when there's money in it. Pay with Paystack." : "You can add funds once your business is approved.", state: approved ? "current" : "todo", href: "/vendor#fund-amount", action: "Add funds" },
  ];
  return finish(steps);
}

export async function repOnboarding(userId: number): Promise<Onboarding> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [rep] = await db.select().from(reps).where(eq(reps.userId, userId)).limit(1);
  if (!user || !rep) return { steps: [], complete: true };
  const [kyc] = await db.select({ state: identityCases.state }).from(identityCases)
    .where(and(inArray(identityCases.caseType, ["representative_kyc", "campus_lead_kyc"]), eq(identityCases.subjectType, "user"), eq(identityCases.subjectId, userId)))
    .orderBy(desc(identityCases.createdAt)).limit(1);
  const [enrolment] = await db.select({ state: enrollmentAttestations.state, validUntil: enrollmentAttestations.validUntil }).from(enrollmentAttestations)
    .where(eq(enrollmentAttestations.userId, userId)).orderBy(desc(enrollmentAttestations.createdAt)).limit(1);
  const [destination] = await db.select({ nameCheck: payoutDestinations.nameCheck }).from(payoutDestinations).where(eq(payoutDestinations.userId, userId)).limit(1);
  const [{ value: customers }] = await db.select({ value: count() }).from(attributionRecords).where(eq(attributionRecords.repId, rep.id));

  const idApproved = user.kycState === "verified";
  const enrolled = enrolment?.state === "verified" && (!enrolment.validUntil || enrolment.validUntil > new Date());
  const active = rep.status === "active";

  const enrolmentStep: OnboardingStep = enrolled
    ? { key: "enrolment", title: "Show you're currently enrolled", detail: "Confirmed.", state: "done" }
    : enrolment?.state === "submitted"
      ? { key: "enrolment", title: "Show you're currently enrolled", detail: "Operations is checking your proof of enrolment.", state: "waiting", href: "/identity", action: "See your check" }
      : { key: "enrolment", title: "Show you're currently enrolled", detail: enrolment ? "Your last proof wasn't accepted or has run out. Send a current one (school ID card, fee receipt or course form for this term)." : "Upload something that shows you're enrolled this term: a school ID card, fee receipt or course form.", state: "current", href: "/identity", action: enrolment ? "Send a new one" : "Upload proof" };

  const activationStep: OnboardingStep = active
    ? { key: "activation", title: "Get activated by Operations", detail: "You're active and can earn.", state: "done" }
    : idApproved && enrolled
      ? { key: "activation", title: "Get activated by Operations", detail: rep.status === "pending" ? "Your checks are done. Operations activates you next, and you'll get a notification." : "Your account is on hold. Contact Support to find out why.", state: "waiting", href: rep.status === "pending" ? undefined : "/rep/support", action: rep.status === "pending" ? undefined : "Contact Support" }
      : { key: "activation", title: "Get activated by Operations", detail: "Operations activates you once your ID and enrolment are approved.", state: "todo" };

  const bankUsable = destination?.nameCheck === "matched" || destination?.nameCheck === "approved";
  const bankStep: OnboardingStep = bankUsable
    ? { key: "bank", title: "Add the bank account you'll be paid into", detail: "Confirmed with your bank.", state: "done" }
    : destination?.nameCheck === "review"
      ? { key: "bank", title: "Add the bank account you'll be paid into", detail: "Operations is confirming the account name.", state: "waiting", href: "/rep/earnings", action: "See your account" }
      : { key: "bank", title: "Add the bank account you'll be paid into", detail: idApproved ? "It must be in the name on your ID check. We check it with the bank." : "You can add it once your ID check is approved.", state: idApproved ? "current" : "todo", href: "/rep/earnings", action: "Add bank account" };

  const steps: OnboardingStep[] = [
    checkStep("id", "Check your ID", "/identity", kyc?.state, idApproved, {
      start: "Upload a government ID and a selfie under Verification. Operations checks them by eye.",
      waiting: "Operations is checking your ID. You'll get a notification when they decide.",
    }),
    enrolmentStep,
    activationStep,
    bankStep,
    customers > 0
      ? { key: "share", title: "Share a product with your first customer", detail: "Done. You earn when the vendor confirms the sale.", state: "done" }
      : { key: "share", title: "Share a product with your first customer", detail: active ? "Pick a product, add the customer's phone and send them your link." : "You can share products once you're activated.", state: active ? "current" : "todo", href: "/rep/share", action: "Get my link" },
  ];
  return finish(steps);
}
