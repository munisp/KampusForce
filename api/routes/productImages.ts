import { Hono } from "hono";
import { readProductImage } from "../services/productCatalog";
import { log } from "../lib/logger";

// Product photos for the catalog. They're marketing material, so no sign-in is needed, but only stored photos are
// served, with their checked type and nosniff, so an upload can't be served as a page.
export const productImageRoutes = new Hono();

productImageRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.notFound();
  try {
    const image = await readProductImage(id);
    if (!image) return c.notFound();
    return new Response(new Uint8Array(image.data), { headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    } });
  } catch (error) {
    log.warn("product image read failed", { id, error: error instanceof Error ? error.message : String(error) });
    return c.text("Photo unavailable", 503);
  }
});
