import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import "../lib/env";

const PHONE_SALT = process.env.PHONE_HASH_SALT || "kampusforce-sandbox-phone-salt";

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\+234\d{10}$/.test(input)) return input;
  throw new Error("Enter a valid Nigerian phone number");
}

export function hashPhone(input: string): string {
  const phone = normalizePhone(input);
  return createHash("sha256").update(`${PHONE_SALT}:${phone}`).digest("hex");
}

export function hashCustomerRef(value: string): string {
  return createHash("sha256").update(`${PHONE_SALT}:ref:${value}`).digest("hex");
}

export function hmacSha256(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function safeSignatureEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received.replace(/^sha256=/, ""), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signedToken(payload: string, secret: string): string {
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

export function verifySignedToken(token: string, secret: string): string | null {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const receivedBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) return null;
  return Buffer.from(encoded, "base64url").toString("utf8");
}

export function randomReference(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
