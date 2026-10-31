import { describe, expect, it } from "vitest";
import { encryptPayoutAccountNumber, validatePayoutDestination } from "./payoutDestinations";

const env = { KF_PAYOUT_ENCRYPTION_KEY: "22".repeat(32), KF_PAYOUT_ENCRYPTION_KEY_VERSION: "test-v1" } as NodeJS.ProcessEnv;

describe("encrypted payout destination contracts", () => {
  it("uses authenticated encryption with a fresh IV and stores only a keyed hash and last four separately", () => {
    const first = encryptPayoutAccountNumber(42, "0123456789", env);
    const second = encryptPayoutAccountNumber(42, "0123456789", env);
    expect(first.accountNumberIv).not.toBe(second.accountNumberIv);
    expect(first.accountNumberCiphertext).not.toBe(second.accountNumberCiphertext);
    expect(first.accountNumberHash).toBe(second.accountNumberHash);
    expect(first.accountNumberTag).toHaveLength(24);
    expect(JSON.stringify(first)).not.toContain("0123456789");
    expect(validatePayoutDestination({ accountNumber: "0123456789", bankCode: "058", accountName: "Sandbox Recipient" }).accountName).toBe("Sandbox Recipient");
  });

  it("rejects malformed account details and invalid key material", () => {
    expect(() => validatePayoutDestination({ accountNumber: "123", bankCode: "058", accountName: "Sandbox Recipient" })).toThrow(/ten-digit/);
    expect(() => validatePayoutDestination({ accountNumber: "0123456789", bankCode: "058", accountName: "x" })).toThrow(/account name/);
    expect(() => encryptPayoutAccountNumber(42, "0123456789", { KF_PAYOUT_ENCRYPTION_KEY: "short" })).toThrow(/exactly 32 bytes/);
  });
});
