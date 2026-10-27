import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { products, reps } from "@db/schema";
import { getDb } from "../queries/connection";
import { attributionToken, ensureAttribution } from "../services/attribution";

export const linkRoutes = new Hono();
linkRoutes.get("/:code", async (c) => {
  const code = c.req.param("code");
  const productRef = c.req.query("p");
  if (!productRef) return c.text("Missing product reference", 400);
  const [rep] = await getDb().select().from(reps).where(and(eq(reps.code, code), eq(reps.status, "active"))).limit(1);
  const [product] = await getDb().select().from(products).where(and(eq(products.vendorRef, productRef), eq(products.status, "active"))).limit(1);
  if (!rep || !product) return c.text("This KampusForce link is invalid or no longer active", 404);
  const phone = c.req.query("phone");
  if (phone) await ensureAttribution({ repId: rep.id, productId: product.id, customerPhone: phone, source: "link" });
  const token = attributionToken(rep.id, product.id, product.vendorId);
  const target = new URL(product.landingUrl);
  target.searchParams.set("kf_token", token);
  target.searchParams.set("kf_rep", rep.code);
  return c.redirect(target.toString(), 302);
});
