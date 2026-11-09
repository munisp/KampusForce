import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { auditLogs, productImages, products, repProducts, vendors } from "@db/schema";
import { getDb } from "../queries/connection";
import { deleteObject, getObject, putObject } from "../lib/objectStore";
import { notifyUser } from "./notifications";

// Vendors manage what they list: details, price, stock, photos, and whether it's on sale. Reps pick the products
// they want to sell. Photos are kept in the private object store and served through /api/product-images/:id.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 6;
const bucket = () => process.env.KF_PRODUCT_BUCKET?.trim() || process.env.KF_IDENTITY_BUCKET?.trim() || "kampusforce-identity";

/** The type comes from the file's own bytes, never from what the browser says. */
export function detectImageType(data: Uint8Array) {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (Buffer.from(data.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(data.subarray(8, 12)).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** The product, if this vendor owns it. */
export async function ownedProduct(vendorId: number, productId: number) {
  const [product] = await getDb().select().from(products).where(and(eq(products.id, productId), eq(products.vendorId, vendorId))).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
  return product;
}

export async function updateProduct(input: {
  vendorId: number; actorUserId: number; productId: number;
  name: string; description: string; category: typeof products.$inferInsert.category; priceKobo: number; landingUrl: string | null; stockQuantity: number | null;
}) {
  const product = await ownedProduct(input.vendorId, input.productId);
  const [sameName] = await getDb().select({ id: products.id }).from(products)
    .where(and(eq(products.vendorId, input.vendorId), ne(products.id, product.id), sql`lower(${products.name}) = lower(${input.name})`)).limit(1);
  if (sameName) throw new TRPCError({ code: "CONFLICT", message: `You already have a product called "${input.name}". Use a different name.` });
  const [updated] = await getDb().update(products).set({
    name: input.name, description: input.description, pitchScript: input.description, category: input.category, priceKobo: input.priceKobo,
    landingUrl: input.landingUrl ?? "", stockQuantity: input.stockQuantity, updatedAt: new Date(),
  }).where(eq(products.id, product.id)).returning();
  await getDb().insert(auditLogs).values({ actorUserId: input.actorUserId, action: "vendor.product_updated", entityType: "product", entityId: String(product.id), metadataJson: {
    before: { name: product.name, priceKobo: product.priceKobo, stockQuantity: product.stockQuantity, category: product.category },
    after: { name: updated.name, priceKobo: updated.priceKobo, stockQuantity: updated.stockQuantity, category: updated.category },
  } });
  return updated;
}

export async function setProductStatus(input: { vendorId: number; actorUserId: number; productId: number; status: "active" | "paused" }) {
  const product = await ownedProduct(input.vendorId, input.productId);
  if (input.status === "active" && product.heldReason) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `KampusForce took this product down: ${product.heldReason} Contact Operations to have it put back.` });
  if (product.status === input.status) return product;
  const [updated] = await getDb().update(products).set({ status: input.status, updatedAt: new Date() }).where(eq(products.id, product.id)).returning();
  await getDb().insert(auditLogs).values({ actorUserId: input.actorUserId, action: input.status === "paused" ? "vendor.product_paused" : "vendor.product_resumed", entityType: "product", entityId: String(product.id), metadataJson: {} });
  return updated;
}

export async function addProductImage(input: { vendorId: number; actorUserId: number; productId: number; contentBase64: string }) {
  const product = await ownedProduct(input.vendorId, input.productId);
  const data = Buffer.from(input.contentBase64, "base64");
  if (!data.length) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is empty." });
  if (data.length > MAX_IMAGE_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "That photo is too big. The limit is 5 MB." });
  const contentType = detectImageType(data);
  if (!contentType) throw new TRPCError({ code: "BAD_REQUEST", message: "Please upload a JPG, PNG or WebP photo." });
  const [{ count }] = await getDb().select({ count: sql<number>`count(*)::int` }).from(productImages).where(eq(productImages.productId, product.id));
  if (count >= MAX_IMAGES_PER_PRODUCT) throw new TRPCError({ code: "BAD_REQUEST", message: `A product can have up to ${MAX_IMAGES_PER_PRODUCT} photos. Remove one first.` });
  const objectKey = `products/${product.id}/${randomUUID()}`;
  await putObject(bucket(), objectKey, data);
  const [image] = await getDb().insert(productImages).values({ productId: product.id, objectKey, contentType, sizeBytes: data.length, position: count }).returning();
  await getDb().insert(auditLogs).values({ actorUserId: input.actorUserId, action: "vendor.product_image_added", entityType: "product", entityId: String(product.id), metadataJson: { imageId: image.id, sizeBytes: data.length } });
  return { id: image.id, url: productImageUrl(image.id) };
}

export async function removeProductImage(input: { vendorId: number; actorUserId: number; imageId: number }) {
  const [image] = await getDb().select({ image: productImages, vendorId: products.vendorId }).from(productImages)
    .innerJoin(products, eq(products.id, productImages.productId)).where(eq(productImages.id, input.imageId)).limit(1);
  if (!image || image.vendorId !== input.vendorId) throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found." });
  await getDb().delete(productImages).where(eq(productImages.id, image.image.id));
  await deleteObject(bucket(), image.image.objectKey).catch(() => undefined);
  await getDb().insert(auditLogs).values({ actorUserId: input.actorUserId, action: "vendor.product_image_removed", entityType: "product", entityId: String(image.image.productId), metadataJson: { imageId: image.image.id } });
  return { removed: true };
}

export const productImageUrl = (imageId: number) => `/api/product-images/${imageId}`;

/** Photo addresses per product, in the order the vendor added them. */
export async function imagesForProducts(productIds: number[]) {
  const map = new Map<number, string[]>();
  if (!productIds.length) return map;
  const rows = await getDb().select({ id: productImages.id, productId: productImages.productId }).from(productImages)
    .where(inArray(productImages.productId, productIds)).orderBy(asc(productImages.position), asc(productImages.id));
  for (const row of rows) map.set(row.productId, [...(map.get(row.productId) || []), productImageUrl(row.id)]);
  return map;
}

/** A product photo for the public route. Product photos are marketing material, so anyone with the link can see them. */
export async function readProductImage(imageId: number) {
  const [image] = await getDb().select().from(productImages).where(eq(productImages.id, imageId)).limit(1);
  if (!image) return null;
  return { contentType: image.contentType, data: await getObject(bucket(), image.objectKey) };
}

export async function pickProduct(input: { repId: number; productId: number; picked: boolean }) {
  const [product] = await getDb().select({ id: products.id, status: products.status }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
  if (input.picked) {
    if (product.status !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This product isn't on sale right now." });
    await getDb().insert(repProducts).values({ repId: input.repId, productId: product.id }).onConflictDoNothing();
  } else {
    await getDb().delete(repProducts).where(and(eq(repProducts.repId, input.repId), eq(repProducts.productId, product.id)));
  }
  return { productId: product.id, picked: input.picked };
}

export async function pickedProductIds(repId: number) {
  const rows = await getDb().select({ productId: repProducts.productId }).from(repProducts).where(eq(repProducts.repId, repId));
  return new Set(rows.map((row) => row.productId));
}

/** Every product on the platform, for Operations to review and take down. */
export async function productsForOperations() {
  const rows = await getDb().select({ product: products, vendorName: vendors.companyName, vendorStatus: vendors.status }).from(products)
    .innerJoin(vendors, eq(vendors.id, products.vendorId)).orderBy(asc(products.status), asc(vendors.companyName), asc(products.name));
  const photos = await imagesForProducts(rows.map((row) => row.product.id));
  return rows.map((row) => ({ ...row, images: photos.get(row.product.id) || [] }));
}

/** Operations takes a product down: it leaves the reps' catalog at once and the vendor can't put it back on sale. */
export async function holdProduct(input: { actorUserId: number; productId: number; reason: string }) {
  const [product] = await getDb().select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
  if (product.heldReason) throw new TRPCError({ code: "CONFLICT", message: "This product is already taken down." });
  await getDb().update(products).set({ status: "paused", heldReason: input.reason, heldAt: new Date(), heldByUserId: input.actorUserId, updatedAt: new Date() }).where(eq(products.id, product.id));
  await getDb().insert(auditLogs).values({ actorUserId: input.actorUserId, action: "operations.product_held", entityType: "product", entityId: String(product.id), metadataJson: { reason: input.reason, previousStatus: product.status } });
  const [vendor] = await getDb().select({ userId: vendors.userId }).from(vendors).where(eq(vendors.id, product.vendorId)).limit(1);
  if (vendor?.userId) await notifyUser({ userId: vendor.userId, type: "product_held", title: `KampusForce took down ${product.name}`, body: `Reps can't see or sell it for now. Reason: ${input.reason}`, href: "/vendor", entityType: "product", entityId: product.id });
  return { productId: product.id, held: true };
}

/** Operations lifts a hold. The product stays paused; the vendor decides when to put it back on sale. */
export async function releaseProductHold(input: { actorUserId: number; productId: number; note: string }) {
  const [product] = await getDb().select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
  if (!product.heldReason) throw new TRPCError({ code: "CONFLICT", message: "This product isn't taken down." });
  await getDb().update(products).set({ heldReason: null, heldAt: null, heldByUserId: null, updatedAt: new Date() }).where(eq(products.id, product.id));
  await getDb().insert(auditLogs).values({ actorUserId: input.actorUserId, action: "operations.product_hold_released", entityType: "product", entityId: String(product.id), metadataJson: { note: input.note, heldReason: product.heldReason } });
  const [vendor] = await getDb().select({ userId: vendors.userId }).from(vendors).where(eq(vendors.id, product.vendorId)).limit(1);
  if (vendor?.userId) await notifyUser({ userId: vendor.userId, type: "product_hold_released", title: `${product.name} can go back on sale`, body: `KampusForce lifted its hold. Put it back on sale from Products when you're ready. ${input.note}`, href: "/vendor", entityType: "product", entityId: product.id });
  return { productId: product.id, held: false };
}
