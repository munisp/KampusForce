import { describe, expect, it } from "vitest";
import { compareAccountNames, nameWords, resolveBankAccount, takeLookupAllowance } from "./bankAccounts";

describe("comparing the ID-checked name with the bank's name", () => {
  const cases: Array<[string, string, ReturnType<typeof compareAccountNames>]> = [
    ["Ada Okafor", "OKAFOR ADA CHIOMA", "match"],          // order and a middle name
    ["Ada Okafor", "OKAFOR, ADA C.", "match"],             // punctuation and an initial
    ["Ada Okafor", "ADA OKAFOR-NWOSU", "match"],           // hyphenated married name
    ["Ada Chioma Okafor", "OKAFOR ADA", "match"],          // the bank lacks the middle name
    ["Mrs Ada Okafor", "ADA OKAFOR", "match"],             // titles are ignored
    ["Adá Okafor", "ADA OKAFOR", "match"],                 // accents
    ["Oluwaseun Adeyemi", "SEUN ADEYEMI", "review"],       // short form of a first name
    ["Tobi Bello", "OLUWATOBI BELLO", "review"],
    ["Muhammad Bello", "MOHAMMED BELLO", "review"],        // spelling variant
    ["Ada Chioma Okafor", "OKAFOR ADA NGOZI", "review"],   // one word different
    ["Ada", "ADA OKAFOR", "review"],                       // a one-word name can't be confirmed automatically
    ["Ada Okafor", "OKAFOR EMEKA JOHN", "no_match"],       // a relative who shares the surname
    ["Tobi Bello", "TEST ACCOUNT 0000000000", "no_match"],
    ["Ada Okafor", "", "no_match"],
  ];
  it.each(cases)("%s vs %s → %s", (id, bank, expected) => {
    expect(compareAccountNames(id, bank)).toBe(expected);
  });

  it("reduces a name to plain words", () => {
    expect(nameWords("Dr. Ngozi  Okonjo-Iweala 2")).toEqual(["ngozi", "okonjo", "iweala"]);
  });
});

describe("account lookup", () => {
  const env = process.env;
  const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  process.env = { ...env, PAYSTACK_SECRET_KEY: "sk_test_x" };

  it("returns the bank's name for the account", async () => {
    await expect(resolveBankAccount("0000000000", "001", fake(200, { status: true, data: { account_name: "TEST  ACCOUNT 0000000000" } }))).resolves.toEqual({ accountName: "TEST ACCOUNT 0000000000" });
  });
  it("says plainly when the bank has no such account", async () => {
    await expect(resolveBankAccount("0001234567", "058", fake(422, { status: false, message: "Could not resolve account name" }))).rejects.toThrow(/doesn't have this account/);
  });
  it("never passes when the bank check can't be reached", async () => {
    const down = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    await expect(resolveBankAccount("0000000000", "001", down)).rejects.toThrow(/couldn't reach/);
    await expect(resolveBankAccount("0000000000", "001", fake(502, {}))).rejects.toThrow(/couldn't reach/);
  });
  it("refuses malformed input before calling the bank", async () => {
    const never = (async () => { throw new Error("should not be called"); }) as unknown as typeof fetch;
    await expect(resolveBankAccount("12345", "058", never)).rejects.toThrow(/10-digit/);
    await expect(resolveBankAccount("0000000000", "abc", never)).rejects.toThrow(/Choose your bank/);
  });
  it("limits each person to ten lookups an hour", () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) takeLookupAllowance(777, now + i);
    expect(() => takeLookupAllowance(777, now + 11)).toThrow(/a lot of accounts/);
    expect(() => takeLookupAllowance(778, now + 11)).not.toThrow();
    expect(() => takeLookupAllowance(777, now + 3_600_001)).not.toThrow();
  });
});
