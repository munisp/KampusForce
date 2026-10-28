import { describe, expect, it } from "vitest";
import { accountFlagsFor, BACKFILL_OPENING_BALANCE_ERROR, buildLinkedTransferPlan, buildPendingSettlement, buildTwoPhaseReservation, deterministicId128, hasUnresolvedOpeningBalanceBackfill, isTerminalTigerBeetleError, postingPayloadHash, tigerBeetleReadiness, validatePostingPayload, type PostingPayload } from "./tigerBeetle";

const payload: PostingPayload = {
  version: 1,
  entries: [
    { account: "vendor_escrow", direction: "debit", amountKobo: 100_000 },
    { account: "rep_payable", direction: "credit", amountKobo: 80_000 },
    { account: "platform_revenue", direction: "credit", amountKobo: 20_000 },
    { account: "platform_revenue", direction: "debit", amountKobo: 4_000 },
    { account: "lead_override_payable", direction: "credit", amountKobo: 4_000 },
  ],
  accountRefs: { vendor_escrow: "vendor:1", rep_payable: "rep:2", platform_revenue: "platform", lead_override_payable: "rep:3" },
};

describe("TigerBeetle posting contract", () => {
  it("builds a balanced deterministic linked batch including the platform-funded override", () => {
    const first = buildLinkedTransferPlan("confirm_test", "activation_confirmation", payload);
    const second = buildLinkedTransferPlan("confirm_test", "activation_confirmation", payload);
    expect(first).toEqual(second);
    expect(first.reduce((sum, transfer) => sum + transfer.amount, 0n)).toBe(104_000n);
    expect(first.slice(0, -1).every((transfer) => transfer.flags === 1)).toBe(true);
    expect(first.at(-1)?.flags).toBe(0);
    expect(new Set(first.map((transfer) => transfer.id)).size).toBe(first.length);
  });

  it("rejects unbalanced, zero and unsafe entries", () => {
    expect(() => validatePostingPayload({ ...payload, entries: payload.entries.slice(0, 2) })).toThrow(/balanced/);
    expect(() => validatePostingPayload({ ...payload, entries: [{ account: "vendor_escrow", direction: "debit", amountKobo: 0 }, { account: "rep_payable", direction: "credit", amountKobo: 0 }] })).toThrow(/positive/);
  });

  it("supports two-phase reservation and post/void without treating preparation as settlement", () => {
    const pending = buildTwoPhaseReservation("payout_test", payload, 900);
    expect(pending.every((transfer) => transfer.flags & 2)).toBe(true);
    expect(pending.every((transfer) => transfer.timeout === 900)).toBe(true);
    const posted = buildPendingSettlement(pending[0], "post", "payout_test");
    const voided = buildPendingSettlement(pending[0], "void", "payout_test");
    expect(posted.pending_id).toBe(pending[0].id);
    expect(posted.flags).toBe(4);
    expect(voided.flags).toBe(8);
    expect(posted.id).not.toBe(voided.id);
    expect(posted.amount).toBe((1n << 64n) - 1n);
    expect(voided.amount).toBe(0n);
  });

  it("protects immutable payload identity and prepaid escrow without blocking clawback netting", () => {
    expect(postingPayloadHash(payload)).toMatch(/^[a-f0-9]{64}$/);
    expect(accountFlagsFor("vendor_escrow:vendor:1")).toBe(10);
    expect(accountFlagsFor("rep_payable:rep:2")).toBe(8);
    expect(() => validatePostingPayload({ ...payload, accountRefs: { ...payload.accountRefs, vendor_escrow: "" } })).toThrow(/entity-scoped/);
  });

  it("uses non-zero non-max deterministic u128 identifiers", () => {
    const id = deterministicId128("a", 1);
    expect(id).toBe(deterministicId128("a", 1));
    expect(id).toBeGreaterThan(0n);
    expect(id).toBeLessThan((1n << 128n) - 1n);
  });

  it("blocks conflicting financial evidence while allowing transient transport retries", () => {
    expect(isTerminalTigerBeetleError("payload_hash_mismatch")).toBe(true);
    expect(isTerminalTigerBeetleError("TigerBeetle contains only part of a linked outbox group; manual reconciliation required")).toBe(true);
    expect(isTerminalTigerBeetleError("Existing TigerBeetle transfer conflicts with deterministic outbox plan")).toBe(true);
    expect(isTerminalTigerBeetleError("connection timeout")).toBe(false);
  });

  it("fails closed without valid replica, cluster and live authorization evidence", () => {
    const readiness = tigerBeetleReadiness({});
    expect(readiness.configured).toBe(false);
    expect(readiness.liveEligible).toBe(false);
    expect(tigerBeetleReadiness({
      KF_TIGERBEETLE_ADDRESSES: " , ",
      KF_TIGERBEETLE_CLUSTER_ID: "not-a-number",
      KF_ALLOW_LIVE_FINANCIAL_EXECUTION: "true",
    }).configured).toBe(false);
    expect(tigerBeetleReadiness({
      KF_TIGERBEETLE_ADDRESSES: "127.0.0.1:3000",
      KF_TIGERBEETLE_CLUSTER_ID: ((1n << 128n) - 1n).toString(),
      KF_ALLOW_LIVE_FINANCIAL_EXECUTION: "true",
    }).configured).toBe(false);
    const configured = tigerBeetleReadiness({
      KF_TIGERBEETLE_ADDRESSES: "127.0.0.1:3000,127.0.0.1:3001",
      KF_TIGERBEETLE_CLUSTER_ID: "0",
      KF_ALLOW_LIVE_FINANCIAL_EXECUTION: "true",
    });
    expect(configured.configured).toBe(true);
    expect(configured.liveEligible).toBe(false);
  });

  it("blocks balance inference while historical opening-balance proof is unresolved", () => {
    expect(hasUnresolvedOpeningBalanceBackfill([
      { state: "blocked", lastErrorCode: BACKFILL_OPENING_BALANCE_ERROR },
    ])).toBe(true);
    expect(hasUnresolvedOpeningBalanceBackfill([
      { state: "submitted", lastErrorCode: BACKFILL_OPENING_BALANCE_ERROR },
      { state: "blocked", lastErrorCode: "connection timeout" },
      { state: "reconciled", lastErrorCode: null },
    ])).toBe(false);
  });
});
