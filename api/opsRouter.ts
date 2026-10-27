import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, deals, disputes, products, reps, users, vendorEvents } from "@db/schema";
import { createRouter } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { getDb } from "./queries/connection";
import { confirmDueDeals, runPayoutBatch } from "./services/ledger";

export const opsRouter = createRouter({
  overview: authedQuery.query(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    const allDeals = await getDb().select({ deal: deals, productName: products.name, repCode: reps.code }).from(deals).innerJoin(products, eq(deals.productId, products.id)).innerJoin(reps, eq(deals.repId, reps.id)).orderBy(desc(deals.createdAt));
    const quarantine = await getDb().select().from(vendorEvents).where(eq(vendorEvents.status, "quarantined")).orderBy(desc(vendorEvents.receivedAt)).limit(30);
    const cases = await getDb().select({ dispute: disputes, openedBy: users.name }).from(disputes).innerJoin(users, eq(disputes.openedBy, users.id)).orderBy(desc(disputes.createdAt)).limit(30);
    const audit = await getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(30);
    return {
      metrics: {
        deals: allDeals.length,
        pending: allDeals.filter((d) => d.deal.state === "pending").length,
        payable: allDeals.filter((d) => d.deal.state === "payable").length,
        paid: allDeals.filter((d) => d.deal.state === "paid").length,
        quarantined: quarantine.length,
        openDisputes: cases.filter((c) => ["open", "reviewing"].includes(c.dispute.state)).length,
      },
      deals: allDeals.slice(0, 40),
      quarantine,
      disputes: cases,
      audit,
    };
  }),
  confirmSweep: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return confirmDueDeals(ctx.user.id);
  }),
  advanceWindows: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    await getDb().update(deals).set({ confirmAt: new Date() }).where(eq(deals.state, "pending"));
    await getDb().insert(auditLogs).values({ actorUserId: ctx.user.id, action: "sandbox.confirmation_windows_advanced", entityType: "deal_batch", entityId: crypto.randomUUID() });
    return { advanced: true, mode: "sandbox_only" };
  }),
  payoutBatch: authedQuery.mutation(async ({ ctx }) => {
    requireRole(ctx.user, ["ops", "finance", "admin"]);
    return runPayoutBatch(ctx.user.id);
  }),
  resolveDispute: authedQuery.input(z.object({ disputeId: z.number().int().positive(), decision: z.string().min(5).max(1000), upholdRep: z.boolean() })).mutation(async ({ ctx, input }) => {
    requireRole(ctx.user, ["ops", "admin"]);
    const [dispute] = await getDb().select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1);
    if (!dispute) throw new Error("Dispute not found");
    await getDb().update(disputes).set({ state: input.upholdRep ? "resolved" : "rejected", decision: input.decision, decidedAt: new Date() }).where(eq(disputes.id, dispute.id));
    const [deal] = await getDb().select().from(deals).where(eq(deals.id, dispute.dealId)).limit(1);
    if (deal) await getDb().update(deals).set({ state: input.upholdRep ? "payable" : "void" }).where(eq(deals.id, deal.id));
    await getDb().insert(auditLogs).values({ actorUserId: ctx.user.id, action: "dispute.decided", entityType: "dispute", entityId: String(dispute.id), metadataJson: { upholdRep: input.upholdRep, decision: input.decision } });
    return { disputeId: dispute.id, state: input.upholdRep ? "resolved" : "rejected" };
  }),
});
