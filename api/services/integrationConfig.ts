export type ProviderMode = "sandbox" | "live";

function requestedProviderMode(): ProviderMode | "invalid" {
  const value = (process.env.KF_PROVIDER_MODE || "sandbox").trim().toLowerCase();
  if (value === "sandbox" || value === "live") return value;
  return "invalid";
}

function present(name: string) {
  return Boolean(process.env[name]?.trim());
}

/**
 * Secret-free configuration metadata. Never return process.env values from this
 * module: the Operations browser receives this object verbatim.
 */
export function integrationConfiguration() {
  const mode = requestedProviderMode();
  const cutoverAuthorized = process.env.KF_LIVE_CUTOVER_AUTHORIZED === "true";
  const appUrlConfigured = present("KF_APP_URL");
  let appUrlHttps = false;
  try {
    const appUrl = new URL(process.env.KF_APP_URL || "");
    appUrlHttps = appUrl.protocol === "https:" && Boolean(appUrl.hostname) && !appUrl.username && !appUrl.password && !appUrl.hash;
  } catch {
    appUrlHttps = false;
  }
  const paystackSecretConfigured = present("PAYSTACK_SECRET_KEY");
  const flutterwaveSecretConfigured = present("FLUTTERWAVE_SECRET_KEY");
  const flutterwaveWebhookConfigured = present("FLUTTERWAVE_WEBHOOK_HASH");
  const sandboxAuthenticationDisabled = process.env.KF_SANDBOX_MODE === "false";
  const encodedEncryptionKey = (process.env.KF_PAYOUT_ENCRYPTION_KEY || "").trim();
  const encryptionKeyBytes = /^[a-f0-9]{64}$/i.test(encodedEncryptionKey) ? Buffer.from(encodedEncryptionKey, "hex") : Buffer.from(encodedEncryptionKey, "base64");
  const payoutEncryptionConfigured = Boolean(encodedEncryptionKey) && encryptionKeyBytes.length === 32;
  const paystackLiveEnabled = mode === "live" && cutoverAuthorized && sandboxAuthenticationDisabled && paystackSecretConfigured && appUrlHttps && payoutEncryptionConfigured;
  const flutterwaveLiveEnabled = mode === "live" && cutoverAuthorized && sandboxAuthenticationDisabled && flutterwaveSecretConfigured && flutterwaveWebhookConfigured && appUrlHttps && payoutEncryptionConfigured;
  return {
    requestedMode: mode,
    effectiveMode: paystackLiveEnabled || flutterwaveLiveEnabled ? "live" as const : "sandbox" as const,
    cutoverAuthorized,
    sandboxAuthenticationDisabled,
    payoutEncryptionConfigured,
    appUrlConfigured,
    appUrlHttps,
    providers: [
      {
        key: "paystack",
        name: "Paystack Transfers",
        role: "Primary payout adapter",
        credentialConfigured: paystackSecretConfigured,
        webhookVerificationConfigured: paystackSecretConfigured,
        adapter: "recipient_and_single_transfer",
        liveExecutionEnabled: paystackLiveEnabled,
      },
      {
        key: "flutterwave",
        name: "Flutterwave Transfers",
        role: "Attempt-three fallback adapter",
        credentialConfigured: flutterwaveSecretConfigured,
        webhookVerificationConfigured: flutterwaveWebhookConfigured,
        adapter: "single_transfer_v3",
        liveExecutionEnabled: flutterwaveLiveEnabled,
      },
    ],
    boundaries: [
      "Configuration presence is not a provider connectivity, account-funding or production approval check.",
      "Credentials are injected into the server environment and are never submitted through this console.",
      "No raw NIN, BVN or full bank-account number is persisted by the provider adapters.",
      "Provider acceptance is not settlement; only a verified success outcome can post paid entries.",
    ],
  };
}

export function requireProviderModeLive() {
  const configuration = integrationConfiguration();
  if (configuration.requestedMode !== "live" || !configuration.cutoverAuthorized) {
    throw new Error("Live provider execution is disabled; select live mode and record explicit cutover authorization");
  }
  if (!configuration.sandboxAuthenticationDisabled) {
    throw new Error("Live provider execution requires KF_SANDBOX_MODE=false");
  }
  if (!configuration.appUrlHttps) {
    throw new Error("Live provider execution requires an HTTPS KF_APP_URL");
  }
  if (!configuration.payoutEncryptionConfigured) {
    throw new Error("Live provider execution requires a 32-byte payout destination encryption key");
  }
  if (!configuration.providers.some((provider) => provider.liveExecutionEnabled)) {
    throw new Error("Live provider execution requires complete credentials and webhook verification for at least one adapter");
  }
  return configuration;
}
