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

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction,
  sandboxMode,
  databaseUrl: required("POSTGRES_URL"),
};
