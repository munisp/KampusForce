import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

const isProduction = process.env.NODE_ENV === "production";
const sandboxMode = process.env.KF_SANDBOX_MODE !== "false";

if (isProduction && !sandboxMode) {
  for (const name of ["APP_SECRET", "AUTH_SECRET", "ATTRIBUTION_SECRET", "PHONE_HASH_SALT", "KF_IDENTITY_TOKENIZATION_SECRET"]) {
    if ((process.env[name] || "").length < 32) {
      throw new Error(`${name} must be explicitly configured with at least 32 characters when sandbox mode is disabled`);
    }
  }
}

if (isProduction && process.env.KF_PROVIDER_MODE === "live") {
  if (sandboxMode) throw new Error("KF_SANDBOX_MODE=false is required before selecting live provider mode");
  if (process.env.KF_LIVE_CUTOVER_AUTHORIZED !== "true") throw new Error("Live provider mode requires explicit KF_LIVE_CUTOVER_AUTHORIZED=true");
  let validAppUrl = false;
  try {
    const appUrl = new URL(process.env.KF_APP_URL || "");
    validAppUrl = appUrl.protocol === "https:" && Boolean(appUrl.hostname) && !appUrl.username && !appUrl.password && !appUrl.hash;
  } catch {
    validAppUrl = false;
  }
  if (!validAppUrl) throw new Error("Live provider mode requires a valid credential-free HTTPS KF_APP_URL");
  if (!process.env.PAYSTACK_SECRET_KEY && !process.env.FLUTTERWAVE_SECRET_KEY) throw new Error("Live provider mode requires at least one payout provider credential");
  if (!process.env.PAYSTACK_SECRET_KEY && process.env.FLUTTERWAVE_SECRET_KEY && !process.env.FLUTTERWAVE_WEBHOOK_HASH) {
    throw new Error("Flutterwave-only live mode requires FLUTTERWAVE_WEBHOOK_HASH");
  }
  const encodedKey = (process.env.KF_PAYOUT_ENCRYPTION_KEY || "").trim();
  const keyBytes = /^[a-f0-9]{64}$/i.test(encodedKey) ? Buffer.from(encodedKey, "hex") : Buffer.from(encodedKey, "base64");
  if (!encodedKey || keyBytes.length !== 32) throw new Error("Live provider mode requires a 32-byte KF_PAYOUT_ENCRYPTION_KEY as hex or base64");
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction,
  sandboxMode,
  databaseUrl: required("POSTGRES_URL"),
};
