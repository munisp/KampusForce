import { createHash, createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { mojaloopRailIntents, payouts } from "@db/schema";
import { getDb } from "../queries/connection";

export type MojaloopState = "disabled" | "party_resolved" | "quoted" | "transfer_pending" | "settled" | "failed";

const allowedTransitions: Record<MojaloopState, MojaloopState[]> = {
  disabled: ["party_resolved", "failed"],
  party_resolved: ["quoted", "failed"],
  quoted: ["transfer_pending", "failed"],
  transfer_pending: ["settled", "failed"],
  settled: [],
  failed: [],
};

export function assertMojaloopTransition(from: MojaloopState, to: MojaloopState) {
  if (!allowedTransitions[from].includes(to)) throw new Error(`Invalid Mojaloop transition: ${from} -> ${to}`);
}

export function mojaloopReadiness(env: NodeJS.ProcessEnv = process.env) {
  const checks = [
    { key: "scheme_participation", ready: Boolean(env.KF_MOJALOOP_SCHEME_PARTICIPANT_ID?.trim()), detail: "Verified scheme participation through an approved partner" },
    { key: "partner_fsp", ready: Boolean(env.KF_MOJALOOP_FSP_ID?.trim()), detail: "Approved partner FSP identifier" },
    { key: "hub_endpoint", ready: Boolean(env.KF_MOJALOOP_HUB_ENDPOINT?.startsWith("https://")), detail: "HTTPS hub or partner orchestration endpoint" },
    { key: "mtls", ready: env.KF_MOJALOOP_MTLS_CONFIGURED === "true", detail: "Mutual TLS configured and certificate expiry monitored" },
    { key: "jws", ready: env.KF_MOJALOOP_JWS_CONFIGURED === "true", detail: "FSPIOP JWS signing and verification configured" },
    { key: "settlement_reconciliation", ready: env.KF_MOJALOOP_SETTLEMENT_RECONCILIATION === "true", detail: "Independent settlement report reconciliation enabled" },
    { key: "live_execution_authorized", ready: env.KF_ALLOW_LIVE_FINANCIAL_EXECUTION === "true", detail: "Separate live financial execution authorization" },
  ];
  return {
    configured: checks.slice(0, 6).every((check) => check.ready),
    liveEligible: checks.every((check) => check.ready),
    checks,
    launchDependency: false,
    boundary: "Mojaloop remains a post-MVP partner rail. Configuration presence is not connectivity, liquidity, scheme approval, clearing or settlement. Provider acceptance never marks a payout settled.",
  };
}

export function mojaloopPartyReferenceHash(partyReference: string, keyedHashSecret: string) {
  if (typeof partyReference !== "string" || !partyReference.length || partyReference.length > 128 || partyReference !== partyReference.trim()) {
    throw new Error("A bounded, unambiguous party reference is required");
  }
  if (typeof keyedHashSecret !== "string" || keyedHashSecret.length < 32) {
    throw new Error("A secret of at least 32 characters is required for keyed party-reference hashing");
  }
  return createHmac("sha256", keyedHashSecret)
    .update("kampusforce:mojaloop:party:v1:")
    .update(partyReference)
    .digest("hex");
}

export type MojaloopTransport = {
  lookupParty(input: { partyRefHash: string; idempotencyKey: string }): Promise<{ payeeFspId: string; partyRefHash: string }>;
  requestQuote(input: { amountNetKobo: number; currency: "NGN"; payeeFspId: string; idempotencyKey: string }): Promise<{ quoteId: string; payeeFspId: string; amountNetKobo: number; currency: "NGN"; expiresAt: Date }>;
  prepareTransfer(input: { quoteId: string; amountNetKobo: number; currency: "NGN"; idempotencyKey: string }): Promise<{ transferId: string; quoteId: string; state: "RESERVED" | "COMMITTED" }>;
};

export async function executeMojaloopP2PSequence(input: {
  partyRefHash: string;
  amountNetKobo: number;
  payeeFspId: string;
  idempotencyKey: string;
}, transport: MojaloopTransport, now = new Date(), env: NodeJS.ProcessEnv = process.env) {
  if (!mojaloopReadiness(env).liveEligible) {
    throw new Error("Mojaloop execution is disabled until scheme, partner, transport-security, reconciliation and live-authorization gates pass");
  }
  if (!/^[a-f0-9]{64}$/.test(input.partyRefHash)) throw new Error("Only a SHA-256 party reference hash is accepted; raw account or MSISDN data is prohibited");
  if (!Number.isSafeInteger(input.amountNetKobo) || input.amountNetKobo <= 0) throw new Error("A positive safe kobo amount is required");
  if (!/^[a-zA-Z0-9:_-]{8,100}$/.test(input.idempotencyKey)) throw new Error("A bounded idempotency key is required");
  if (!/^[a-zA-Z0-9._-]{2,64}$/.test(input.payeeFspId)) throw new Error("A valid partner FSP identifier is required");
  const party = await transport.lookupParty({ partyRefHash: input.partyRefHash, idempotencyKey: `${input.idempotencyKey}:party` });
  if (party.payeeFspId !== input.payeeFspId || party.partyRefHash !== input.partyRefHash) throw new Error("Party lookup result does not match the requested payee and party reference");
  const quote = await transport.requestQuote({ amountNetKobo: input.amountNetKobo, currency: "NGN", payeeFspId: party.payeeFspId, idempotencyKey: `${input.idempotencyKey}:quote` });
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(quote.quoteId)) throw new Error("Quote reference is missing, invalid or unbounded");
  if (quote.amountNetKobo !== input.amountNetKobo || quote.currency !== "NGN" || quote.payeeFspId !== party.payeeFspId) throw new Error("Quote economics or payee differ from the payout intent");
  if (!(quote.expiresAt instanceof Date) || Number.isNaN(quote.expiresAt.getTime()) || quote.expiresAt <= now) throw new Error("Quote is already expired or has an invalid expiry");
  const transfer = await transport.prepareTransfer({ quoteId: quote.quoteId, amountNetKobo: input.amountNetKobo, currency: "NGN", idempotencyKey: `${input.idempotencyKey}:transfer` });
  if (!/^[a-zA-Z0-9:_-]{1,100}$/.test(transfer.transferId)) throw new Error("Transfer reference is missing, invalid or unbounded");
  if (transfer.quoteId !== quote.quoteId) throw new Error("Transfer references a different quote");
  if (!["RESERVED", "COMMITTED"].includes(transfer.state)) throw new Error("Transfer preparation returned an unknown scheme state");
  return {
    state: "transfer_pending" as const,
    quote,
    transfer,
    settlementEligible: false,
    boundary: "Transfer preparation is not settlement. Only a verified final scheme/provider outcome plus independent reconciliation may settle the payout.",
  };
}

export async function createMojaloopPreflightIntent(input: { payoutId: number; partyRefHash: string; actorUserId: number }) {
  if (!/^[a-f0-9]{64}$/.test(input.partyRefHash)) throw new Error("Party reference must be a SHA-256 hash; never submit raw bank account, BVN, NIN or MSISDN");
  const [payout] = await getDb().select().from(payouts).where(eq(payouts.id, input.payoutId)).limit(1);
  if (!payout) throw new Error("Payout not found");
  if (!["queued", "processing"].includes(payout.state)) throw new Error("Only a queued or processing payout can receive a rail preflight");
  const readiness = mojaloopReadiness();
  const intentRef = `mojo_${randomUUID()}`;
  const idempotencyKey = `mojaloop:payout:${payout.id}`;
  const [intent] = await getDb().insert(mojaloopRailIntents).values({
    intentRef,
    payoutId: payout.id,
    idempotencyKey,
    partyRefHash: input.partyRefHash,
    amountNetKobo: payout.amountNetKobo,
    state: "disabled",
    lastErrorCode: readiness.liveEligible ? "external_transport_required" : "scheme_preflight_incomplete",
    createdByUserId: input.actorUserId,
  }).onConflictDoNothing().returning();
  const persisted = intent || await getDb().query.mojaloopRailIntents.findFirst({ where: eq(mojaloopRailIntents.idempotencyKey, idempotencyKey) });
  if (persisted && (persisted.partyRefHash !== input.partyRefHash || persisted.amountNetKobo !== payout.amountNetKobo)) {
    throw new Error("Mojaloop idempotency conflict: the existing payout intent has different party or amount evidence");
  }
  return {
    intent: persisted,
    readiness,
    externalExecution: false,
    settlementEligible: false,
  };
}

export function mojaloopEvidenceHash(parts: { intentRef: string; state: MojaloopState; transferRef?: string | null }) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function validateMojaloopSettlementEvidence(input: {
  intentRef: string;
  transferRef: string;
  finalSchemeOutcome: "COMMITTED" | "RESERVED" | "ABORTED";
  schemeEvidenceHash: string;
  settlementReportHash: string;
  independentlyReconciled: boolean;
}) {
  const hashShape = /^[a-f0-9]{64}$/;
  if (!input.intentRef || !input.transferRef) throw new Error("Settlement requires persisted intent and transfer references");
  if (input.finalSchemeOutcome !== "COMMITTED") throw new Error("Only a final committed scheme outcome is settlement-eligible");
  if (!hashShape.test(input.schemeEvidenceHash) || !hashShape.test(input.settlementReportHash)) throw new Error("Settlement requires separate scheme and report evidence hashes");
  if (input.schemeEvidenceHash === input.settlementReportHash) throw new Error("Settlement evidence must be independent, not the same attestation repeated");
  if (!input.independentlyReconciled) throw new Error("Independent settlement-report reconciliation is incomplete");
  return { settlementEligible: true as const, evidenceHash: mojaloopEvidenceHash({ intentRef: input.intentRef, state: "settled", transferRef: input.transferRef }) };
}
