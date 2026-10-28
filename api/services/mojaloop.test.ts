import { describe, expect, it, vi } from "vitest";
import { assertMojaloopTransition, executeMojaloopP2PSequence, mojaloopPartyReferenceHash, mojaloopReadiness, validateMojaloopSettlementEvidence, type MojaloopTransport } from "./mojaloop";

const partyRefHash = "a".repeat(64);
const liveEnv = {
  KF_MOJALOOP_SCHEME_PARTICIPANT_ID: "scheme-participant",
  KF_MOJALOOP_FSP_ID: "partner-fsp",
  KF_MOJALOOP_HUB_ENDPOINT: "https://partner.example.test",
  KF_MOJALOOP_MTLS_CONFIGURED: "true",
  KF_MOJALOOP_JWS_CONFIGURED: "true",
  KF_MOJALOOP_SETTLEMENT_RECONCILIATION: "true",
  KF_ALLOW_LIVE_FINANCIAL_EXECUTION: "true",
};
const transport: MojaloopTransport = {
  lookupParty: vi.fn(async () => ({ payeeFspId: "partner-fsp", partyRefHash })),
  requestQuote: vi.fn(async () => ({ quoteId: "quote-1", payeeFspId: "partner-fsp", amountNetKobo: 45_000, currency: "NGN" as const, expiresAt: new Date("2027-01-01T00:00:00Z") })),
  prepareTransfer: vi.fn(async () => ({ transferId: "transfer-1", quoteId: "quote-1", state: "RESERVED" as const })),
};

describe("Mojaloop partner-rail contract", () => {
  it("fails closed before transport execution until every live gate passes", async () => {
    await expect(executeMojaloopP2PSequence({ partyRefHash, amountNetKobo: 45_000, payeeFspId: "partner-fsp", idempotencyKey: "payout:blocked" }, transport, new Date("2026-10-28T00:00:00Z"), {})).rejects.toThrow(/execution is disabled/);
    expect(transport.lookupParty).not.toHaveBeenCalled();
    expect(transport.requestQuote).not.toHaveBeenCalled();
    expect(transport.prepareTransfer).not.toHaveBeenCalled();
  });

  it("executes party, quote and transfer in order without claiming settlement", async () => {
    const result = await executeMojaloopP2PSequence({ partyRefHash, amountNetKobo: 45_000, payeeFspId: "partner-fsp", idempotencyKey: "payout:1" }, transport, new Date("2026-10-28T00:00:00Z"), liveEnv);
    expect(result.state).toBe("transfer_pending");
    expect(result.settlementEligible).toBe(false);
    expect(transport.lookupParty).toHaveBeenCalledBefore(transport.requestQuote as ReturnType<typeof vi.fn>);
    expect(transport.requestQuote).toHaveBeenCalledBefore(transport.prepareTransfer as ReturnType<typeof vi.fn>);
  });

  it("rejects changed quote economics and expired quotes", async () => {
    const wrong = { ...transport, requestQuote: vi.fn(async () => ({ quoteId: "quote-2", payeeFspId: "partner-fsp", amountNetKobo: 44_000, currency: "NGN" as const, expiresAt: new Date("2027-01-01T00:00:00Z") })) };
    await expect(executeMojaloopP2PSequence({ partyRefHash, amountNetKobo: 45_000, payeeFspId: "partner-fsp", idempotencyKey: "payout:2" }, wrong, new Date("2026-10-28T00:00:00Z"), liveEnv)).rejects.toThrow(/economics/);
    const expired = { ...transport, requestQuote: vi.fn(async () => ({ quoteId: "quote-3", payeeFspId: "partner-fsp", amountNetKobo: 45_000, currency: "NGN" as const, expiresAt: new Date("2026-01-01T00:00:00Z") })) };
    await expect(executeMojaloopP2PSequence({ partyRefHash, amountNetKobo: 45_000, payeeFspId: "partner-fsp", idempotencyKey: "payout:3" }, expired, new Date("2026-10-28T00:00:00Z"), liveEnv)).rejects.toThrow(/expired/);
  });

  it("enforces state transitions and scheme gates", () => {
    expect(() => assertMojaloopTransition("quoted", "settled")).toThrow(/Invalid/);
    expect(() => assertMojaloopTransition("settled", "failed")).toThrow(/Invalid/);
    expect(() => assertMojaloopTransition("quoted", "transfer_pending")).not.toThrow();
    expect(mojaloopReadiness({}).liveEligible).toBe(false);
    expect(mojaloopReadiness({}).launchDependency).toBe(false);
  });

  it("uses domain-separated keyed hashes for low-entropy party references", () => {
    const secret = "test-only-keyed-hash-secret-with-32-plus-characters";
    const otherSecret = "different-keyed-hash-secret-with-32-plus-characters";
    const reference = mojaloopPartyReferenceHash("synthetic-party-reference", secret);
    expect(reference).toMatch(/^[a-f0-9]{64}$/);
    expect(reference).toBe(mojaloopPartyReferenceHash("synthetic-party-reference", secret));
    expect(reference).not.toBe(mojaloopPartyReferenceHash("synthetic-party-reference", otherSecret));
    expect(() => mojaloopPartyReferenceHash("synthetic-party-reference", "short")).toThrow(/at least 32/);
  });

  it("requires independent final settlement evidence and rejects preparation as settlement", () => {
    const evidence = { intentRef: "mojo_1", transferRef: "transfer-1", schemeEvidenceHash: "a".repeat(64), settlementReportHash: "b".repeat(64), independentlyReconciled: true };
    expect(validateMojaloopSettlementEvidence({ ...evidence, finalSchemeOutcome: "COMMITTED" }).settlementEligible).toBe(true);
    expect(() => validateMojaloopSettlementEvidence({ ...evidence, finalSchemeOutcome: "RESERVED" })).toThrow(/final committed/);
    expect(() => validateMojaloopSettlementEvidence({ ...evidence, finalSchemeOutcome: "COMMITTED", settlementReportHash: evidence.schemeEvidenceHash })).toThrow(/independent/);
    expect(() => validateMojaloopSettlementEvidence({ ...evidence, finalSchemeOutcome: "COMMITTED", independentlyReconciled: false })).toThrow(/reconciliation/);
  });
});
