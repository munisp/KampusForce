import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { repRouter } from "./repRouter";
import { vendorRouter } from "./vendorRouter";
import { opsRouter } from "./opsRouter";
import { recruitmentRouter } from "./recruitmentRouter";
import { registrationRouter } from "./registrationRouter";
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
import { phase19Router } from "./phase19Router";

export const appRouter = createRouter({
  registration: registrationRouter,
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
  phase19: phase19Router,
});

export type AppRouter = typeof appRouter;
