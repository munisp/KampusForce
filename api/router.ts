import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { repRouter } from "./repRouter";
import { vendorRouter } from "./vendorRouter";
import { opsRouter } from "./opsRouter";
import { recruitmentRouter } from "./recruitmentRouter";
import { notificationRouter } from "./notificationRouter";
import { salesRouter } from "./salesRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, service: "kampusforce-api", ts: Date.now() })),
  auth: authRouter,
  rep: repRouter,
  vendor: vendorRouter,
  ops: opsRouter,
  recruitment: recruitmentRouter,
  notification: notificationRouter,
  sales: salesRouter,
});

export type AppRouter = typeof appRouter;
