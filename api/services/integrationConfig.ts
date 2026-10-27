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
  const appUrlHttps = (process.env.KF_APP_URL || "").startsWith("https://");
  const paystackSecretConfigured = present("PAYSTACK_SECRET_KEY");
  const flutterwaveSecretConfigured = present("FLUTTERWAVE_SECRET_KEY");
  const flutterwaveWebhookConfigured = present("FLUTTERWAVE_WEBHOOK_HASH");
  return {
    requestedMode: mode,
    effectiveMode: mode === "live" ? "live" as const : "sandbox" as const,
    cutoverAuthorized,
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
        liveExecutionEnabled: mode === "live" && cutoverAuthorized && paystackSecretConfigured && appUrlHttps,
      },
      {
        key: "flutterwave",
        name: "Flutterwave Transfers",
        role: "Attempt-three fallback adapter",
        credentialConfigured: flutterwaveSecretConfigured,
        webhookVerificationConfigured: flutterwaveWebhookConfigured,
        adapter: "single_transfer_v3",
        liveExecutionEnabled: mode === "live" && cutoverAuthorized && flutterwaveSecretConfigured && flutterwaveWebhookConfigured && appUrlHttps,
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
  if (!configuration.appUrlHttps) {
    throw new Error("Live provider execution requires an HTTPS KF_APP_URL");
  }
  return configuration;
}
