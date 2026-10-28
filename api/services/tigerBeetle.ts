import { createHash, randomUUID } from "node:crypto";
import { createRequire as createNodeRequire } from "node:module";
import { and, asc, count, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { Account, Client, CreateTransferResult, Transfer } from "tigerbeetle-node";
import { dataPlatformRuns, financialPostingOutbox, ledgerEntries } from "@db/schema";
import { getDb } from "../queries/connection";

export const TIGERBEETLE_LEDGER = 1;
export const TRANSFER_CODES = { activation_confirmation: 101, activation_reversal: 102, payout_settlement: 201, payout_reservation: 202 } as const;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const CREATE_ACCOUNT_EXISTS = 21;
const CREATE_TRANSFER_EXISTS = 46;
export const BACKFILL_OPENING_BALANCE_ERROR = "backfill_requires_entity_scoped_opening_balance_proof";

export type PostingEntry = {
  account: string;
  direction: "debit" | "credit";
  amountKobo: number;
};

export type PostingPayload = {
  version: 1;
  entries: PostingEntry[];
  accountRefs: Record<string, string>;
};

export type TigerTransferPlan = Transfer & { sourceIndex: number };

export function deterministicId128(...parts: (string | number)[]) {
  const digest = createHash("sha256").update(parts.join(":")).digest();
  const value = BigInt(`0x${digest.subarray(0, 16).toString("hex")}`);
  if (value === 0n) return 1n;
  if (value === UINT128_MAX) return UINT128_MAX - 1n;
  return value;
}

export function tigerAccountId(reference: string) {
  return deterministicId128("kampusforce", "account", reference);
}

function resolvedAccount(reference: string, accountRefs: Record<string, string>) {
  const suffix = accountRefs[reference] || "unscoped";
  return `${reference}:${suffix}`;
}

export function validatePostingPayload(payload: PostingPayload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.entries) || payload.entries.length < 2 || payload.entries.length > 64) throw new Error("Posting payload must contain between two and 64 versioned entries");
  if (!payload.accountRefs || typeof payload.accountRefs !== "object" || Array.isArray(payload.accountRefs)) throw new Error("Posting account references are required");
  let debits = 0;
  let credits = 0;
  for (const entry of payload.entries) {
    if (!Number.isSafeInteger(entry.amountKobo) || entry.amountKobo <= 0 || BigInt(entry.amountKobo) > UINT64_MAX) throw new Error("Posting amounts must be positive safe u64 kobo integers");
    if (entry.direction === "debit") debits += entry.amountKobo;
    else if (entry.direction === "credit") credits += entry.amountKobo;
    else throw new Error("Posting direction must be debit or credit");
    if (!entry.account || !/^[a-z_]+$/.test(entry.account)) throw new Error("Posting account is invalid");
    const accountRef = payload.accountRefs[entry.account];
    if (typeof accountRef !== "string" || !/^[a-zA-Z0-9:_-]{1,96}$/.test(accountRef)) throw new Error(`A bounded entity-scoped reference is required for ${entry.account}`);
  }
  if (!Number.isSafeInteger(debits) || debits !== credits || debits === 0) throw new Error("Posting group is not balanced");
  return { debitsKobo: debits, creditsKobo: credits };
}

export function postingPayloadHash(payload: PostingPayload) {
  validatePostingPayload(payload);
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildLinkedTransferPlan(entryGroup: string, operation: keyof typeof TRANSFER_CODES, payload: PostingPayload): TigerTransferPlan[] {
  validatePostingPayload(payload);
  if (!/^[a-zA-Z0-9:_-]{1,64}$/.test(entryGroup)) throw new Error("A bounded entry group is required");
  const debits = payload.entries.filter((entry) => entry.direction === "debit").map((entry, index) => ({ ...entry, sourceIndex: index, remaining: entry.amountKobo }));
  const credits = payload.entries.filter((entry) => entry.direction === "credit").map((entry, index) => ({ ...entry, sourceIndex: index, remaining: entry.amountKobo }));
  const transfers: Omit<TigerTransferPlan, "flags">[] = [];
  let debitIndex = 0;
  let creditIndex = 0;
  while (debitIndex < debits.length && creditIndex < credits.length) {
    const debit = debits[debitIndex];
    const credit = credits[creditIndex];
    const amount = Math.min(debit.remaining, credit.remaining);
    const sourceIndex = transfers.length;
    transfers.push({
      id: deterministicId128("kampusforce", "transfer", entryGroup, sourceIndex),
      debit_account_id: tigerAccountId(resolvedAccount(debit.account, payload.accountRefs)),
      credit_account_id: tigerAccountId(resolvedAccount(credit.account, payload.accountRefs)),
      amount: BigInt(amount),
      pending_id: 0n,
      user_data_128: deterministicId128("kampusforce", "group", entryGroup),
      user_data_64: 0n,
      user_data_32: 1,
      timeout: 0,
      ledger: TIGERBEETLE_LEDGER,
      code: TRANSFER_CODES[operation],
      timestamp: 0n,
      sourceIndex,
    });
    debit.remaining -= amount;
    credit.remaining -= amount;
    if (debit.remaining === 0) debitIndex += 1;
    if (credit.remaining === 0) creditIndex += 1;
  }
  if (debitIndex !== debits.length || creditIndex !== credits.length || !transfers.length) throw new Error("Unable to pair balanced posting entries");
  return transfers.map((transfer, index) => ({ ...transfer, flags: index === transfers.length - 1 ? 0 : 1 }));
}

export function buildTwoPhaseReservation(entryGroup: string, payload: PostingPayload, timeoutSeconds = 900) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 3600) throw new Error("Pending transfer timeout must be between 30 and 3600 seconds");
  const plan = buildLinkedTransferPlan(entryGroup, "payout_reservation", payload);
  return plan.map((transfer, index) => ({ ...transfer, timeout: timeoutSeconds, flags: (index === plan.length - 1 ? 0 : 1) | 2 }));
}

export function buildPendingSettlement(pending: TigerTransferPlan, outcome: "post" | "void", entryGroup: string) {
  if (!(pending.flags & 2)) throw new Error("A pending transfer is required");
  return {
    ...pending,
    id: deterministicId128("kampusforce", outcome, entryGroup, pending.sourceIndex),
    pending_id: pending.id,
    amount: outcome === "post" ? UINT64_MAX : 0n,
    timeout: 0,
    flags: outcome === "post" ? 4 : 8,
    sourceIndex: pending.sourceIndex,
  };
}

export function accountFlagsFor(reference: string) {
  // Escrow cannot be overdrawn. Representative payable accounts deliberately
  // permit negative balances so confirmed clawbacks can net future payouts.
  return reference.startsWith("vendor_escrow:") ? 10 : 8; // history + optional debits_must_not_exceed_credits
}

function accountFor(reference: string): Account {
  return {
    id: tigerAccountId(reference),
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: deterministicId128("kampusforce", "account-metadata", reference),
    user_data_64: 0n,
    user_data_32: 1,
    reserved: 0,
    ledger: TIGERBEETLE_LEDGER,
    code: 1,
    flags: accountFlagsFor(reference),
    timestamp: 0n,
  };
}

export function tigerBeetleReadiness(env: NodeJS.ProcessEnv = process.env) {
  const replicaAddresses = (env.KF_TIGERBEETLE_ADDRESSES || "").split(",").map((value) => value.trim()).filter(Boolean);
  const clusterIdText = env.KF_TIGERBEETLE_CLUSTER_ID?.trim() || "";
  let validClusterId = false;
  if (/^\d{1,39}$/.test(clusterIdText)) {
    try {
      const clusterId = BigInt(clusterIdText);
      validClusterId = clusterId < UINT128_MAX;
    } catch {
      validClusterId = false;
    }
  }
  const checks = [
    { key: "replica_addresses", ready: replicaAddresses.length > 0, detail: "Explicit nonempty replica address list" },
    { key: "cluster_id", ready: validClusterId, detail: "Configured decimal u128 cluster identifier below the reserved maximum" },
    { key: "live_execution_authorized", ready: env.KF_ALLOW_LIVE_FINANCIAL_EXECUTION === "true", detail: "Separate live financial execution authorization" },
    { key: "shadow_reconciled", ready: false, detail: "Requires zero failed/out-of-balance groups and a verified replica balance comparison" },
  ];
  return {
    configured: checks[0].ready && checks[1].ready,
    liveEligible: checks.every((check) => check.ready),
    checks,
    boundary: "The official client and outbox are implemented. No replica connection, balance reconciliation, ledger-of-record cutover or production money movement is claimed from sandbox tests.",
  };
}

async function loadTigerClient(): Promise<Client> {
  const readiness = tigerBeetleReadiness();
  if (!readiness.configured || process.env.KF_ALLOW_LIVE_FINANCIAL_EXECUTION !== "true") throw new Error("TigerBeetle execution is disabled until replica, cluster and live-authorization gates pass");
  const require = createNodeRequire(import.meta.url);
  const { createClient } = require("tigerbeetle-node") as typeof import("tigerbeetle-node");
  const cluster = BigInt(process.env.KF_TIGERBEETLE_CLUSTER_ID || "0");
  return createClient({ cluster_id: cluster, replica_addresses: (process.env.KF_TIGERBEETLE_ADDRESSES || "").split(",").map((value) => value.trim()).filter(Boolean) });
}

function transferErrors(results: CreateTransferResult[]) {
  return results.filter((result) => result.status !== CREATE_TRANSFER_EXISTS);
}

export function isTerminalTigerBeetleError(code: string) {
  return code === "payload_hash_mismatch" || /conflict|only part|rejected|invalid|balanced|required|Unable to pair/i.test(code);
}

export async function submitPlanToTigerBeetle(entryGroup: string, operation: keyof typeof TRANSFER_CODES, payload: PostingPayload) {
  const plan = buildLinkedTransferPlan(entryGroup, operation, payload);
  const client = await loadTigerClient();
  try {
    const references = new Map<bigint, string>();
    for (const entry of payload.entries) {
      const reference = resolvedAccount(entry.account, payload.accountRefs);
      references.set(tigerAccountId(reference), reference);
    }
    const accounts = [...references.values()].map(accountFor);
    const accountResults = await client.createAccounts(accounts);
    const unexpectedAccountErrors = accountResults.filter((result) => result.status !== CREATE_ACCOUNT_EXISTS);
    if (unexpectedAccountErrors.length) throw new Error(`TigerBeetle account creation rejected ${unexpectedAccountErrors.length} records`);

    const existing = await client.lookupTransfers(plan.map((transfer) => transfer.id));
    if (existing.length === plan.length) {
      const byId = new Map(existing.map((transfer) => [transfer.id, transfer]));
      for (const expected of plan) {
        const actual = byId.get(expected.id);
        if (!actual || actual.amount !== expected.amount || actual.debit_account_id !== expected.debit_account_id || actual.credit_account_id !== expected.credit_account_id || actual.ledger !== expected.ledger || actual.code !== expected.code || actual.pending_id !== expected.pending_id || actual.timeout !== expected.timeout || actual.flags !== expected.flags || actual.user_data_128 !== expected.user_data_128 || actual.user_data_64 !== expected.user_data_64 || actual.user_data_32 !== expected.user_data_32) throw new Error("Existing TigerBeetle transfer conflicts with deterministic outbox plan");
      }
      return { transferCount: plan.length, idempotent: true, batchRef: createHash("sha256").update(plan.map((item) => item.id.toString(16)).join(":")).digest("hex") };
    }
    if (existing.length) throw new Error("TigerBeetle contains only part of a linked outbox group; manual reconciliation required");
    const results = await client.createTransfers(plan.map((item) => {
      const transfer = { ...item } as Partial<TigerTransferPlan>;
      delete transfer.sourceIndex;
      return transfer as Transfer;
    }));
    const errors = transferErrors(results);
    if (errors.length) throw new Error(`TigerBeetle linked transfer batch rejected with ${errors.length} errors`);
    return { transferCount: plan.length, idempotent: false, batchRef: createHash("sha256").update(plan.map((item) => item.id.toString(16)).join(":")).digest("hex") };
  } finally {
    client.destroy();
  }
}

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function enqueueFinancialPosting(tx: Tx, input: {
  entryGroup: string;
  operation: keyof typeof TRANSFER_CODES;
  accountRefs: Record<string, string>;
}) {
  const entries = await tx.select({ account: ledgerEntries.account, direction: ledgerEntries.direction, amountKobo: ledgerEntries.amountKobo }).from(ledgerEntries).where(eq(ledgerEntries.entryGroup, input.entryGroup)).orderBy(asc(ledgerEntries.id));
  const payload: PostingPayload = { version: 1, entries, accountRefs: input.accountRefs };
  const payloadHash = postingPayloadHash(payload);
  const assertMatchingOutbox = (row: { operation: string; payloadHash: string } | undefined) => {
    if (row && (row.operation !== input.operation || row.payloadHash !== payloadHash)) {
      throw new Error("Financial outbox entry-group conflict: the existing operation or payload differs");
    }
  };
  const [existing] = await tx.select({ operation: financialPostingOutbox.operation, payloadHash: financialPostingOutbox.payloadHash }).from(financialPostingOutbox).where(eq(financialPostingOutbox.entryGroup, input.entryGroup)).limit(1).for("update");
  assertMatchingOutbox(existing);
  if (!existing) {
    const inserted = await tx.insert(financialPostingOutbox).values({ entryGroup: input.entryGroup, operation: input.operation, payloadJson: payload as unknown as Record<string, unknown>, payloadHash }).onConflictDoNothing().returning({ id: financialPostingOutbox.id });
    if (!inserted.length) {
      const [concurrent] = await tx.select({ operation: financialPostingOutbox.operation, payloadHash: financialPostingOutbox.payloadHash }).from(financialPostingOutbox).where(eq(financialPostingOutbox.entryGroup, input.entryGroup)).limit(1);
      assertMatchingOutbox(concurrent);
    }
  }
  return { entryGroup: input.entryGroup, payloadHash, entries: entries.length };
}

export async function dispatchFinancialOutbox(limit = 10) {
  const readiness = tigerBeetleReadiness();
  if (!readiness.configured || process.env.KF_ALLOW_LIVE_FINANCIAL_EXECUTION !== "true") {
    return { dispatched: 0, blocked: true, reason: "TigerBeetle replica and live-execution gates are incomplete; durable outbox remains pending" };
  }
  const now = new Date();
  const staleSubmittingBefore = new Date(now.getTime() - 15 * 60_000);
  const candidates = await getDb().select().from(financialPostingOutbox).where(and(
    or(
      inArray(financialPostingOutbox.state, ["pending", "failed"]),
      and(eq(financialPostingOutbox.state, "submitting"), lte(financialPostingOutbox.updatedAt, staleSubmittingBefore)),
    ),
    or(isNull(financialPostingOutbox.nextRetryAt), lte(financialPostingOutbox.nextRetryAt, now)),
  )).orderBy(asc(financialPostingOutbox.createdAt)).limit(Math.min(Math.max(limit, 1), 100));
  const results = [];
  for (const candidate of candidates) {
    const claimed = await getDb().update(financialPostingOutbox).set({ state: "submitting", attemptCount: candidate.attemptCount + 1, updatedAt: now, lastErrorCode: null }).where(and(eq(financialPostingOutbox.id, candidate.id), eq(financialPostingOutbox.state, candidate.state), eq(financialPostingOutbox.updatedAt, candidate.updatedAt))).returning();
    if (!claimed.length) continue;
    try {
      const payload = candidate.payloadJson as unknown as PostingPayload;
      if (postingPayloadHash(payload) !== candidate.payloadHash) throw new Error("payload_hash_mismatch");
      const result = await submitPlanToTigerBeetle(candidate.entryGroup, candidate.operation as keyof typeof TRANSFER_CODES, payload);
      await getDb().update(financialPostingOutbox).set({ state: "submitted", externalBatchRef: result.batchRef, submittedAt: new Date(), nextRetryAt: null, updatedAt: new Date() }).where(eq(financialPostingOutbox.id, candidate.id));
      results.push({ entryGroup: candidate.entryGroup, state: "submitted", transferCount: result.transferCount });
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 160) : "unknown_tigerbeetle_error";
      const terminal = isTerminalTigerBeetleError(code) || claimed[0].attemptCount >= 8;
      const persistedCode = claimed[0].attemptCount >= 8 && !isTerminalTigerBeetleError(code) ? `retry_budget_exhausted: ${code}`.slice(0, 160) : code;
      await getDb().update(financialPostingOutbox).set({ state: terminal ? "blocked" : "failed", lastErrorCode: persistedCode, nextRetryAt: terminal ? null : new Date(Date.now() + Math.min(60, 2 ** Math.min(candidate.attemptCount, 6)) * 60_000), updatedAt: new Date() }).where(eq(financialPostingOutbox.id, candidate.id));
      results.push({ entryGroup: candidate.entryGroup, state: terminal ? "blocked" : "failed", error: code });
    }
  }
  return { dispatched: results.length, blocked: false, recoveredStaleClaims: candidates.filter((row) => row.state === "submitting").length, results };
}

export function hasUnresolvedOpeningBalanceBackfill(
  rows: { state: string; lastErrorCode: string | null }[],
) {
  return rows.some(
    (row) => row.state === "blocked" &&
      row.lastErrorCode === BACKFILL_OPENING_BALANCE_ERROR,
  );
}

export async function reconcileTigerBeetleShadow() {
  const readiness = tigerBeetleReadiness();
  if (!readiness.configured || process.env.KF_ALLOW_LIVE_FINANCIAL_EXECUTION !== "true") return { reconciled: 0, blocked: true, reason: "Replica and live-execution gates are incomplete; no reconciliation result was inferred" };
  const backfills = await getDb().select({
    state: financialPostingOutbox.state,
    lastErrorCode: financialPostingOutbox.lastErrorCode,
  }).from(financialPostingOutbox).where(and(
    eq(financialPostingOutbox.state, "blocked"),
    eq(financialPostingOutbox.lastErrorCode, BACKFILL_OPENING_BALANCE_ERROR),
  )).limit(1);
  if (hasUnresolvedOpeningBalanceBackfill(backfills)) {
    return {
      reconciled: 0,
      blocked: true,
      backfillProofRequired: true,
      reason: "Unresolved ledger backfill requires entity-scoped opening-balance proof; no balance reconciliation result was inferred",
    };
  }
  const rows = await getDb().select().from(financialPostingOutbox).where(inArray(financialPostingOutbox.state, ["submitted", "reconciled"]));
  if (!rows.length) return { reconciled: 0, blocked: false, reason: "No submitted posting groups await balance reconciliation" };
  const expected = new Map<string, { debits: bigint; credits: bigint }>();
  for (const row of rows) {
    const payload = row.payloadJson as unknown as PostingPayload;
    validatePostingPayload(payload);
    for (const entry of payload.entries) {
      const reference = resolvedAccount(entry.account, payload.accountRefs);
      const current = expected.get(reference) || { debits: 0n, credits: 0n };
      current[entry.direction === "debit" ? "debits" : "credits"] += BigInt(entry.amountKobo);
      expected.set(reference, current);
    }
  }
  const client = await loadTigerClient();
  const variances: { accountRef: string; expectedDebits: string; expectedCredits: string; actualDebits: string; actualCredits: string }[] = [];
  try {
    const references = [...expected.keys()];
    const accounts = await client.lookupAccounts(references.map(tigerAccountId));
    const byId = new Map(accounts.map((account) => [account.id, account]));
    for (const [reference, totals] of expected) {
      const account = byId.get(tigerAccountId(reference));
      const actualDebits = account?.debits_posted || 0n;
      const actualCredits = account?.credits_posted || 0n;
      if (actualDebits !== totals.debits || actualCredits !== totals.credits) variances.push({ accountRef: reference, expectedDebits: totals.debits.toString(), expectedCredits: totals.credits.toString(), actualDebits: actualDebits.toString(), actualCredits: actualCredits.toString() });
    }
  } finally {
    client.destroy();
  }
  const runRef = `tb_reconcile_${randomUUID()}`;
  await getDb().insert(dataPlatformRuns).values({ runRef, layer: "tigerbeetle_shadow_reconciliation", engine: "tigerbeetle", mode: "live", state: variances.length ? "failed" : "succeeded", rowsProcessed: rows.length, detailsJson: { accountsCompared: expected.size, varianceCount: variances.length, variances: variances.slice(0, 50), comparison: "posted_debits_and_credits_by_deterministic_account" }, completedAt: new Date() });
  if (variances.length) return { reconciled: 0, blocked: false, variances, runRef };
  await getDb().update(financialPostingOutbox).set({ state: "reconciled", reconciledAt: new Date(), updatedAt: new Date(), lastErrorCode: null }).where(inArray(financialPostingOutbox.id, rows.map((row) => row.id)));
  return { reconciled: rows.length, accountsCompared: expected.size, variances: [], runRef, blocked: false };
}

export async function financialOutboxStatus() {
  const rows = await getDb().select({ state: financialPostingOutbox.state, count: count() }).from(financialPostingOutbox).groupBy(financialPostingOutbox.state);
  const recent = await getDb().select({ entryGroup: financialPostingOutbox.entryGroup, operation: financialPostingOutbox.operation, state: financialPostingOutbox.state, attemptCount: financialPostingOutbox.attemptCount, lastErrorCode: financialPostingOutbox.lastErrorCode, createdAt: financialPostingOutbox.createdAt, updatedAt: financialPostingOutbox.updatedAt }).from(financialPostingOutbox).orderBy(desc(financialPostingOutbox.createdAt)).limit(30);
  return { states: rows, recent, readiness: tigerBeetleReadiness() };
}
