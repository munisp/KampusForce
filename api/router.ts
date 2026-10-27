import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { repRouter } from "./repRouter";
import { vendorRouter } from "./vendorRouter";
import { opsRouter } from "./opsRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, service: "kampusforce-api", ts: Date.now() })),
  auth: authRouter,
  rep: repRouter,
  vendor: vendorRouter,
  ops: opsRouter,
});

export type AppRouter = typeof appRouter;
