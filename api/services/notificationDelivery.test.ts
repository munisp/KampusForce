import { describe, expect, it } from "vitest";
import { notificationDeliveryConfiguration, processDueNotificationDeliveries } from "./notificationDelivery";

describe("signed notification delivery configuration", () => {
  it("is disabled by default and reports partial or weak configuration without exposing secrets", async () => {
    expect(notificationDeliveryConfiguration({})).toMatchObject({ requested: false, enabled: false, misconfigured: false, mode: "sandbox" });
    const weak = notificationDeliveryConfiguration({ KF_NOTIFICATION_WEBHOOK_URL: "http://localhost:3000/hook", KF_NOTIFICATION_WEBHOOK_SECRET: "short" });
    expect(weak).toMatchObject({ requested: true, enabled: false, misconfigured: true });
    expect(JSON.stringify(weak)).not.toContain("short");
    const result = await processDueNotificationDeliveries(fetch, {});
    expect(result).toMatchObject({ claimed: 0, blocked: "disabled" });
  });

  it("requires HTTPS or loopback HTTP in sandbox and blocks credential-bearing endpoints before dispatch", async () => {
    const secret = "sandbox-signing-secret-that-is-at-least-32-characters";
    const external = await processDueNotificationDeliveries(fetch, { KF_NOTIFICATION_WEBHOOK_URL: "http://example.invalid/hook", KF_NOTIFICATION_WEBHOOK_SECRET: secret });
    expect(external).toMatchObject({ claimed: 0, blocked: "misconfigured" });
    const credentials = await processDueNotificationDeliveries(fetch, { KF_NOTIFICATION_WEBHOOK_URL: "http://user:password@localhost:3000/hook", KF_NOTIFICATION_WEBHOOK_SECRET: secret });
    expect(credentials).toMatchObject({ claimed: 0, blocked: "misconfigured" });
  });
});
