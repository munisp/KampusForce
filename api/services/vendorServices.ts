import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  auditLogs,
  deals,
  opportunities,
  products,
  supportTickets,
  vendorServiceConnections,
  vendorServiceEvents,
  vendors,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { assertLiveProviderExecutionAuthorized } from "./launchReadiness";
import { assertSalesRole, type SalesActor } from "./salesAccess";

async function connectionForActor(actor: SalesActor, connectionId: number) {
  const [connection] = await getDb().select().from(vendorServiceConnections).where(eq(vendorServiceConnections.id, connectionId)).limit(1);
  if (!connection) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor service connection not found" });
  if (["ops", "admin"].includes(actor.role) || (actor.role === "vendor" && actor.vendorId === connection.vendorId)) return connection;
  throw new TRPCError({ code: "NOT_FOUND", message: "Vendor service connection not found" });
}

export async function listVendorServices(actor: SalesActor) {
  assertSalesRole(actor, ["vendor", "ops", "admin"]);
  const db = getDb();
  const connections = await db.select({ connection: vendorServiceConnections, vendorName: vendors.companyName }).from(vendorServiceConnections)
    .innerJoin(vendors, eq(vendorServiceConnections.vendorId, vendors.id)).orderBy(desc(vendorServiceConnections.updatedAt));
  const visible = actor.role === "vendor" ? connections.filter((row) => row.connection.vendorId === actor.vendorId) : connections;
  const ids = visible.map((row) => row.connection.id);
  const events = ids.length ? await db.select().from(vendorServiceEvents).where(inArray(vendorServiceEvents.connectionId, ids)).orderBy(desc(vendorServiceEvents.createdAt)).limit(150) : [];
  return {
    connections: visible,
    events,
    vendorOptions: actor.role === "vendor" ? [] : await db.select({ id: vendors.id, companyName: vendors.companyName }).from(vendors).orderBy(vendors.companyName),
    metrics: {
      configured: visible.length,
      verified: visible.filter((row) => row.connection.state === "verified").length,
      degraded: visible.filter((row) => row.connection.state === "degraded").length,
      sandbox: visible.filter((row) => row.connection.mode === "sandbox").length,
    },
    boundary: "Local tests validate KampusForce records and adapter configuration only. No external vendor request, credential validation or production-service availability is claimed.",
  };
}

export async function createVendorService(input: {
  actor: SalesActor;
  vendorId: number;
  service: typeof vendorServiceConnections.$inferSelect["service"];
  displayName: string;
  mode: "sandbox" | "live";
}) {
  assertSalesRole(input.actor, ["vendor", "ops", "admin"]);
  if (input.actor.role === "vendor" && input.actor.vendorId !== input.vendorId) throw new TRPCError({ code: "FORBIDDEN", message: "Configure services only for your own vendor" });
  if (input.mode === "live") await assertLiveProviderExecutionAuthorized();
  const [vendor] = await getDb().select().from(vendors).where(eq(vendors.id, input.vendorId)).limit(1);
  if (!vendor) throw new TRPCError({ code: "NOT_FOUND", message: "Vendor not found" });
  const [configured] = await getDb().insert(vendorServiceConnections).values({
    vendorId: vendor.id,
    service: input.service,
    displayName: input.displayName,
    mode: input.mode,
    state: "configured",
    configJson: { syncFrequency: "manual", credentialStorage: "external_secret_manager_required" },
    externalCredentialRequired: true,
    createdByUserId: input.actor.userId,
  }).onConflictDoNothing().returning({ id: vendorServiceConnections.id });
  if (!configured) throw new TRPCError({ code: "CONFLICT", message: "This vendor service is already configured" });
  const id = configured.id;
  await getDb().insert(vendorServiceEvents).values({ connectionId: id, eventType: "connection_configured", status: "recorded", detail: `${input.service} ${input.mode} configuration recorded; no credentials were collected`, metadataJson: { externalCredentialRequired: true } });
  await getDb().insert(auditLogs).values({ actorUserId: input.actor.userId, action: "vendor_service.configured", entityType: "vendor_service_connection", entityId: String(id), metadataJson: { vendorId: vendor.id, service: input.service, mode: input.mode, credentialsCollected: false } });
  return { connectionId: id, state: "configured" as const, externalCredentialRequired: true };
}

export async function testVendorService(input: { actor: SalesActor; connectionId: number }) {
  const connection = await connectionForActor(input.actor, input.connectionId);
  if (connection.mode === "live") {
    await getDb().insert(vendorServiceEvents).values({ connectionId: connection.id, eventType: "live_test_blocked", status: "blocked", detail: "External credentials and an approved production adapter are required; no request was made" });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Live service testing requires external credentials and a separately verified production adapter" });
  }
  const [vendor] = await getDb().select().from(vendors).where(eq(vendors.id, connection.vendorId)).limit(1);
  if (!vendor || vendor.status !== "active") {
    await getDb().update(vendorServiceConnections).set({ state: "degraded", updatedAt: new Date() }).where(eq(vendorServiceConnections.id, connection.id));
    await getDb().insert(vendorServiceEvents).values({ connectionId: connection.id, eventType: "sandbox_test", status: "degraded", detail: "Vendor is not active in KampusForce records" });
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The vendor must be active before its sandbox service can be tested" });
  }
  const now = new Date();
  await getDb().update(vendorServiceConnections).set({ state: "verified", lastTestedAt: now, updatedAt: now }).where(eq(vendorServiceConnections.id, connection.id));
  await getDb().insert(vendorServiceEvents).values({ connectionId: connection.id, eventType: "sandbox_test", status: "verified", detail: "Local adapter configuration and active vendor record validated; no external request was made", metadataJson: { externalRequestMade: false } });
  return { connectionId: connection.id, state: "verified" as const, externalRequestMade: false, testedAt: now };
}

export async function syncVendorService(input: { actor: SalesActor; connectionId: number }) {
  const connection = await connectionForActor(input.actor, input.connectionId);
  if (connection.state !== "verified") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Test the sandbox connection before synchronization" });
  if (connection.mode !== "sandbox") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only the local sandbox adapter can synchronize in this environment" });
  const db = getDb();
  let recordCount = 0;
  if (connection.service === "catalog") {
    recordCount = (await db.select({ id: products.id }).from(products).where(eq(products.vendorId, connection.vendorId))).length;
  } else if (connection.service === "crm") {
    recordCount = (await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.vendorId, connection.vendorId))).length;
  } else if (connection.service === "support") {
    recordCount = (await db.select({ id: supportTickets.id }).from(supportTickets).where(and(eq(supportTickets.vendorId, connection.vendorId), inArray(supportTickets.state, ["rep_triage", "campus_lead_queue", "vendor_queue", "ops_queue"])))).length;
  } else {
    recordCount = (await db.select({ id: deals.id }).from(deals).where(eq(deals.vendorId, connection.vendorId))).length;
  }
  const now = new Date();
  await db.update(vendorServiceConnections).set({ lastSyncedAt: now, updatedAt: now }).where(eq(vendorServiceConnections.id, connection.id));
  await db.insert(vendorServiceEvents).values({ connectionId: connection.id, eventType: "sandbox_sync", status: "succeeded", detail: `${recordCount} local ${connection.service} record${recordCount === 1 ? "" : "s"} reconciled into the integration health view`, metadataJson: { recordCount, externalRequestMade: false, financialStateChanged: false } });
  return { connectionId: connection.id, service: connection.service, recordCount, syncedAt: now, externalRequestMade: false, financialStateChanged: false };
}
