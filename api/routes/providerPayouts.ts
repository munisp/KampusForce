import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { assertLiveProviderExecutionAuthorized } from "../services/launchReadiness";
import { processProviderWebhook, ProviderWebhookError } from "../services/providerWebhooks";
import type { LiveProvider } from "../services/payoutProviders";

export const providerPayoutRoutes = new Hono();

for (const provider of ["paystack", "flutterwave"] as const) {
  providerPayoutRoutes.post(
    `/${provider}/payout`,
    bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.body(null, 413) }),
    async (c) => {
      // The endpoint fails closed in sandbox mode and until independent launch
      // evidence is complete. It is not a sandbox webhook simulator.
      try {
        await assertLiveProviderExecutionAuthorized();
      } catch {
        return c.json({ error: "Live provider webhooks are not authorized in this environment" }, 403);
      }
      try {
        const rawBody = await c.req.text();
        const signature = provider === "paystack"
          ? c.req.header("x-paystack-signature") || ""
          : c.req.header("verif-hash") || "";
        const result = await processProviderWebhook({ provider: provider as LiveProvider, rawBody, signature });
        return c.json(result, 200);
      } catch (error) {
        if (error instanceof ProviderWebhookError) return c.json({ error: error.message }, error.status);
        throw error;
      }
    },
  );
}
