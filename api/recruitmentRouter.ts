import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { authedQuery, requireRole } from "./services/auth";
import { acceptRecruitment, inspectRecruitment } from "./services/recruiting";

export const recruitmentRouter = createRouter({
  inspect: publicQuery.input(z.object({ invitationToken: z.string().min(20).max(200) })).query(({ input }) => inspectRecruitment(input.invitationToken)),
  accept: authedQuery.input(z.object({ invitationToken: z.string().min(20).max(200), contractorAgreementAccepted: z.literal(true) })).mutation(({ ctx, input }) => {
    requireRole(ctx.user, ["rep"]);
    return acceptRecruitment(ctx.user.id, input.invitationToken, input.contractorAgreementAccepted);
  }),
});
