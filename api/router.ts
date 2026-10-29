import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { repRouter } from "./repRouter";
import { vendorRouter } from "./vendorRouter";
import { opsRouter } from "./opsRouter";
import { recruitmentRouter } from "./recruitmentRouter";
import { notificationRouter } from "./notificationRouter";
import { salesRouter } from "./salesRouter";
import { architectureRouter } from "./architectureRouter";
import { identityRouter } from "./identityRouter";
import { assuranceRouter } from "./assuranceRouter";
import { promotionRouter } from "./promotionRouter";
import { platformInnovationRouter } from "./platformInnovationRouter";
import { crmInnovationRouter } from "./crmInnovationRouter";
import { caseInnovationRouter } from "./caseInnovationRouter";
import { talentRouter } from "./talentRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, service: "kampusforce-api", ts: Date.now() })),
  auth: authRouter,
  rep: repRouter,
  vendor: vendorRouter,
  ops: opsRouter,
  recruitment: recruitmentRouter,
  notification: notificationRouter,
  sales: salesRouter,
  architecture: architectureRouter,
  identity: identityRouter,
  assurance: assuranceRouter,
  promotion: promotionRouter,
  intelligence: platformInnovationRouter,
  crm: crmInnovationRouter,
  caseInnovation: caseInnovationRouter,
  talent: talentRouter,
});

export type AppRouter = typeof appRouter;
