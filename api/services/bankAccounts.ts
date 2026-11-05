import { TRPCError } from "@trpc/server";

// A rep's payout account is checked against the bank itself: Paystack's /bank/resolve returns the name the bank holds
// for an account, and that name is compared with the name Operations confirmed on the rep's ID check. Reps never
// type a bank code or an account name.
const PAYSTACK = "https://api.paystack.co";

export type Bank = { name: string; code: string };
export type NameCheck = "match" | "review" | "no_match";

function secretKey(env: NodeJS.ProcessEnv = process.env) {
  const key = (env.PAYSTACK_SECRET_KEY || "").trim();
  if (!key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Bank checks aren't set up yet. Ask Operations." });
  return key;
}

function testMode(env: NodeJS.ProcessEnv = process.env) {
  return (env.PAYSTACK_SECRET_KEY || "").trim().startsWith("sk_test");
}

async function paystackGet(path: string, request: typeof fetch = fetch) {
  let res: Response;
  try {
    res = await request(`${PAYSTACK}${path}`, { headers: { Authorization: `Bearer ${secretKey()}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "We couldn't reach the bank check. Try again in a minute." });
  }
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: unknown };
  return { ok: res.ok && body.status === true, status: res.status, data: body.data };
}

// ── Bank list ──────────────────────────────────────────────────────────────
let bankCache: { at: number; banks: Bank[] } | null = null;
const BANK_CACHE_MS = 24 * 60 * 60 * 1000;

export async function listBanks(request: typeof fetch = fetch): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < BANK_CACHE_MS) return bankCache.banks;
  const res = await paystackGet("/bank?country=nigeria&currency=NGN", request);
  if (!res.ok || !Array.isArray(res.data)) {
    if (bankCache) return bankCache.banks; // a stale list beats no list
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "We couldn't load the list of banks. Try again in a minute." });
  }
  const seen = new Set<string>();
  const banks: Bank[] = [];
  for (const row of res.data as Array<{ name?: string; code?: string; active?: boolean }>) {
    if (!row.code || !row.name || row.active === false || seen.has(row.code)) continue;
    seen.add(row.code);
    banks.push({ name: row.name.trim(), code: row.code.trim() });
  }
  // Paystack's test bank resolves account 0000000000 in test mode, so testers have an account that isn't a real person's.
  if (testMode() && !seen.has("001")) banks.push({ name: "Test Bank (test mode only)", code: "001" });
  banks.sort((a, b) => a.name.localeCompare(b.name, "en-NG"));
  bankCache = { at: Date.now(), banks };
  return banks;
}

// ── Account lookup ─────────────────────────────────────────────────────────
// Lookups reveal who owns an account number, so each person gets a small hourly allowance.
const LOOKUPS_PER_HOUR = 10;
const lookups = new Map<number, number[]>();

export function takeLookupAllowance(userId: number, now = Date.now()) {
  const recent = (lookups.get(userId) || []).filter((at) => now - at < 3_600_000);
  if (recent.length >= LOOKUPS_PER_HOUR) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "You've checked a lot of accounts in the last hour. Try again later." });
  }
  recent.push(now);
  lookups.set(userId, recent);
}

export async function resolveBankAccount(accountNumber: string, bankCode: string, request: typeof fetch = fetch) {
  if (!/^\d{10}$/.test(accountNumber)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter your 10-digit account number." });
  if (!/^\d{3,9}$/.test(bankCode)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose your bank from the list." });
  const res = await paystackGet(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`, request);
  const data = res.data as { account_name?: string } | undefined;
  if (res.ok && data?.account_name?.trim()) return { accountName: data.account_name.trim().replace(/\s+/g, " ") };
  if (res.status === 422 || res.status === 400 || res.status === 404) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "That bank doesn't have this account number. Check both and try again." });
  }
  if (res.status === 429) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "The bank check is busy. Try again in a few minutes." });
  throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "We couldn't reach the bank check. Try again in a minute." });
}

// ── Name comparison ────────────────────────────────────────────────────────
const TITLES = new Set(["mr", "mrs", "miss", "ms", "dr", "prof", "chief", "alhaji", "alhaja", "engr", "barr", "pastor", "rev", "hon", "sir", "mallam"]);

export function nameWords(name: string) {
  return name
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((word) => word && !TITLES.has(word));
}

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

type WordMatch = "exact" | "initial" | "close" | "none";

function compareWord(word: string, others: string[]): WordMatch {
  if (others.includes(word)) return "exact";
  if (word.length === 1 ? others.some((o) => o.startsWith(word)) : others.some((o) => o.length === 1 && word.startsWith(o))) return "initial";
  for (const other of others) {
    const shorter = Math.min(word.length, other.length);
    // Spelling variants (Muhammad / Mohammed) and short forms (Seun / Oluwaseun, Tobi / Oluwatobi).
    const allowed = shorter >= 6 ? 2 : shorter >= 4 ? 1 : 0;
    if (allowed && editDistance(word, other) <= allowed) return "close";
    if (shorter >= 3 && (word.endsWith(other) || other.endsWith(word))) return "close";
  }
  return "none";
}

/**
 * Compares the name on the rep's approved ID check with the name the bank holds.
 *  match    — every word of the shorter name is in the longer one, with at least two full words in common.
 *  review   — plausibly the same person (short form, spelling variant, one word different): a person decides.
 *  no_match — a different person, such as a relative who shares the surname.
 */
export function compareAccountNames(idName: string, bankName: string): NameCheck {
  const id = [...new Set(nameWords(idName))];
  const bank = [...new Set(nameWords(bankName))];
  if (!id.length || !bank.length) return "no_match";
  const [shorter, longer] = id.length <= bank.length ? [id, bank] : [bank, id];
  const results = shorter.map((word) => compareWord(word, longer));
  const exact = results.filter((r) => r === "exact").length;
  const missing = results.filter((r) => r === "none").length;
  if (missing) return exact >= 2 ? "review" : "no_match";
  if (exact >= 2 && results.every((r) => r === "exact" || r === "initial")) return "match";
  return exact >= 1 ? "review" : "no_match";
}
