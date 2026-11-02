import { randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { auditLogs, escrowTopups, escrowWallets, vendors } from "@db/schema";
import { getDb } from "../queries/connection";

// Vendors fund commission escrow through Paystack checkout. A top-up is credited only after Paystack itself confirms
// it (GET /transaction/verify), for the exact amount in naira. That needs no webhook, so a Paystack account shared
// with another application keeps its webhook address.
const PAYSTACK = "https://api.paystack.co";

export function paystackFundingConfigured() {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
}

function secretKey() {
  const key = (process.env.PAYSTACK_SECRET_KEY || "").trim();
  if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Paystack is not configured." });
  if (key.startsWith("sk_live") && process.env.KF_LIVE_CUTOVER_AUTHORIZED !== "true") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A live Paystack key needs an authorized cutover." });
  }
  return key;
}

async function paystack(path: string, init?: RequestInit) {
  const res = await fetch(`${PAYSTACK}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: Record<string, unknown> };
  return { ok: res.ok && body.status === true, status: res.status, message: body.message || "", data: body.data || {} };
}

export async function startEscrowFunding(input: { vendorId: number; email: string; amountKobo: number; actorUserId: number }) {
  const reference = `KF-ESCROW-${randomBytes(12).toString("hex")}`;
  const appUrl = (process.env.KF_APP_URL || "").replace(/\/$/, "");
  await getDb().insert(escrowTopups).values({ vendorId: input.vendorId, reference, amountKobo: input.amountKobo, state: "pending" });
  const started = await paystack("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email, amount: input.amountKobo, currency: "NGN", reference,
      callback_url: `${appUrl}/vendor?funding=${reference}`,
      metadata: { app: "kampusforce", purpose: "vendor_escrow", vendor_id: input.vendorId },
    }),
  });
  if (!started.ok || typeof started.data.authorization_url !== "string") {
    await getDb().update(escrowTopups).set({ state: "failed", failureReason: `initialize ${started.status}: ${started.message}`.slice(0, 200) }).where(eq(escrowTopups.reference, reference));
    throw new TRPCError({ code: "BAD_GATEWAY", message: `Paystack could not start this payment: ${started.message || "try again"}` });
  }
  await getDb().insert(auditLogs).values({ actorUserId: input.actorUserId, action: "escrow.funding_started", entityType: "escrow_wallet", entityId: String(input.vendorId), metadataJson: { reference, amountKobo: input.amountKobo } });
  return { reference, checkoutUrl: started.data.authorization_url };
}

export async function confirmEscrowFunding(reference: string, actorUserId?: number) {
  const [topup] = await getDb().select().from(escrowTopups).where(eq(escrowTopups.reference, reference)).limit(1);
  if (!topup) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
  if (topup.state !== "pending") return { state: topup.state, amountKobo: topup.amountKobo, vendorId: topup.vendorId };
  const verified = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  const status = String(verified.data.status || "");
  if (!verified.ok || status !== "success") {
    if (status === "failed" || status === "reversed") {
      await getDb().update(escrowTopups).set({ state: "failed", failureReason: status }).where(and(eq(escrowTopups.id, topup.id), eq(escrowTopups.state, "pending")));
      return { state: "failed", amountKobo: topup.amountKobo, vendorId: topup.vendorId };
    }
    return { state: "pending", amountKobo: topup.amountKobo, vendorId: topup.vendorId };
  }
  if (Number(verified.data.amount) !== topup.amountKobo || verified.data.currency !== "NGN") {
    await getDb().update(escrowTopups).set({ state: "failed", failureReason: "amount or currency differs from the request" }).where(and(eq(escrowTopups.id, topup.id), eq(escrowTopups.state, "pending")));
    return { state: "failed", amountKobo: topup.amountKobo, vendorId: topup.vendorId };
  }
  return getDb().transaction(async (tx) => {
    const paid = await tx.update(escrowTopups).set({ state: "paid", paidAt: new Date() }).where(and(eq(escrowTopups.id, topup.id), eq(escrowTopups.state, "pending"))).returning({ id: escrowTopups.id });
    if (!paid.length) return { state: "paid", amountKobo: topup.amountKobo, vendorId: topup.vendorId };
    const [wallet] = await tx.update(escrowWallets).set({ balanceKobo: sql`${escrowWallets.balanceKobo} + ${topup.amountKobo}`, updatedAt: new Date() }).where(eq(escrowWallets.vendorId, topup.vendorId)).returning();
    if (!wallet) throw new Error("Escrow wallet not found");
    await tx.insert(auditLogs).values({ actorUserId: actorUserId ?? null, action: "escrow.funded", entityType: "escrow_wallet", entityId: String(topup.vendorId), metadataJson: { reference, amountKobo: topup.amountKobo, balanceKobo: wallet.balanceKobo, provider: "paystack" } });
    return { state: "paid", amountKobo: topup.amountKobo, vendorId: topup.vendorId, balanceKobo: wallet.balanceKobo };
  });
}

// A vendor who pays and closes the tab is still credited; a day-old unpaid checkout is closed.
export async function sweepEscrowFunding() {
  const db = getDb();
  const open = await db.select({ reference: escrowTopups.reference }).from(escrowTopups)
    .where(and(eq(escrowTopups.state, "pending"), gt(escrowTopups.createdAt, new Date(Date.now() - 24 * 3_600_000)))).limit(50);
  let credited = 0;
  for (const { reference } of open) {
    if ((await confirmEscrowFunding(reference).catch(() => null))?.state === "paid") credited++;
  }
  const closed = await db.update(escrowTopups).set({ state: "failed", failureReason: "checkout not completed within a day" })
    .where(and(eq(escrowTopups.state, "pending"), lte(escrowTopups.createdAt, new Date(Date.now() - 24 * 3_600_000)))).returning({ id: escrowTopups.id });
  return { checked: open.length, credited, closed: closed.length };
}

export async function vendorFundingEmail(vendorId: number) {
  const [vendor] = await getDb().select({ email: vendors.contactEmail }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  return vendor?.email || `vendor-${vendorId}@kampusforce.newfire.app`;
}
