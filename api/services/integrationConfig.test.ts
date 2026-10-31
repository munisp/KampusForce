import { afterEach, describe, expect, it } from "vitest";
import { integrationConfiguration, requireProviderModeLive } from "./integrationConfig";

const keys = ["KF_PROVIDER_MODE", "KF_LIVE_CUTOVER_AUTHORIZED", "KF_SANDBOX_MODE", "KF_APP_URL", "PAYSTACK_SECRET_KEY", "FLUTTERWAVE_SECRET_KEY", "FLUTTERWAVE_WEBHOOK_HASH", "KF_PAYOUT_ENCRYPTION_KEY"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureLive() {
  process.env.KF_PROVIDER_MODE = "live";
  process.env.KF_LIVE_CUTOVER_AUTHORIZED = "true";
  process.env.KF_SANDBOX_MODE = "false";
  process.env.KF_APP_URL = "https://app.example.invalid";
  process.env.PAYSTACK_SECRET_KEY = "test-only-not-a-live-credential";
  process.env.KF_PAYOUT_ENCRYPTION_KEY = "44".repeat(32);
}

describe("secret-free live integration configuration", () => {
  it("requires every live execution boundary and never exposes credentials", () => {
    configureLive();
    const configuration = integrationConfiguration();
    expect(configuration).toMatchObject({ requestedMode: "live", effectiveMode: "live", payoutEncryptionConfigured: true, appUrlHttps: true });
    expect(JSON.stringify(configuration)).not.toContain("test-only-not-a-live-credential");
    expect(requireProviderModeLive().effectiveMode).toBe("live");
  });

  it("fails closed for weak keys and credential-bearing or malformed app URLs", () => {
    configureLive();
    process.env.KF_PAYOUT_ENCRYPTION_KEY = "short";
    expect(integrationConfiguration().effectiveMode).toBe("sandbox");
    expect(() => requireProviderModeLive()).toThrow(/32-byte/);
    configureLive();
    process.env.KF_APP_URL = "https://user:password@app.example.invalid";
    expect(integrationConfiguration().appUrlHttps).toBe(false);
    expect(() => requireProviderModeLive()).toThrow(/HTTPS/);
    process.env.KF_APP_URL = "not-a-url";
    expect(integrationConfiguration().appUrlHttps).toBe(false);
  });
});
