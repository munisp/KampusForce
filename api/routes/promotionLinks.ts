import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { promotionLinks } from "@db/schema";
import { getDb } from "../queries/connection";
import { resolvePromotionLink } from "../services/promotions";

export const promotionLinkRoutes = new Hono();

promotionLinkRoutes.get("/:token", async (c) => {
  try {
    const token = c.req.param("token");
    const row = await resolvePromotionLink(token);
    const target = new URL(row.product.landingUrl);
    target.searchParams.set("kf_token", token);
    target.searchParams.set("kf_rep", row.rep.code);
    await getDb().update(promotionLinks).set({ lastUsedAt: new Date() }).where(eq(promotionLinks.id, row.link.id));
    return c.redirect(target.toString(), 302);
  } catch {
    return c.text("This vendor promotion link is invalid, expired, paused, or no longer accepting customers", 404);
  }
});
