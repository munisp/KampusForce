import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { auditLogs, enrollmentAttestations, identityCases, identityConsents, identityDocuments, type IdentityCase, users } from "@db/schema";
import { getDb } from "../queries/connection";
import { deleteObject, getObject, putObject } from "../lib/objectStore";
import { IDENTITY_DOCUMENT_RETENTION_DAYS, type IdentityDocumentKind, requiredDocuments } from "./identityPolicy";

const MAX_BYTES = 10 * 1024 * 1024;
const bucket = () => process.env.KF_IDENTITY_BUCKET?.trim() || "kampusforce-identity";

function encryptionKey() {
  const key = Buffer.from(process.env.KF_IDENTITY_DOCUMENT_KEY?.trim() || "", "base64");
  if (key.length !== 32) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Document uploads aren't set up yet. Please contact Operations." });
  return key;
}

/** The type comes from the file's own bytes, never from what the browser says. */
export function detectDocumentType(data: Uint8Array) {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (Buffer.from(data.subarray(0, 5)).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

// Each object is sealed with AES-256-GCM and bound to its own key name, so the bucket alone reveals nothing.
export function sealDocument(data: Uint8Array, objectKey: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(objectKey));
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openDocument(sealed: Buffer, objectKey: string, key: Buffer) {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12)).setAAD(Buffer.from(objectKey));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

export const ownsIdentityCase = (identityCase: IdentityCase, userId: number) => identityCase.subjectType === "user" ? identityCase.subjectId === userId : identityCase.requestedByUserId === userId;

async function storeDocument(input: { ownerUserId: number; caseId: number | null; kind: IdentityDocumentKind; contentBase64: string }) {
  const data = Buffer.from(input.contentBase64, "base64");
  if (!data.length) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is empty." });
  if (data.length > MAX_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "That file is too big. The limit is 10 MB." });
  const contentType = detectDocumentType(data);
  if (!contentType) throw new TRPCError({ code: "BAD_REQUEST", message: "Please upload a JPG, PNG or PDF file." });
  if (input.kind === "selfie" && contentType === "application/pdf") throw new TRPCError({ code: "BAD_REQUEST", message: "Your selfie must be a photo (JPG or PNG)." });
  const objectKey = `identity/${input.ownerUserId}/${randomUUID()}`;
  await putObject(bucket(), objectKey, sealDocument(data, objectKey, encryptionKey()));
  const sha256 = createHash("sha256").update(data).digest("hex");
  const [document] = await getDb().insert(identityDocuments).values({ ownerUserId: input.ownerUserId, caseId: input.caseId, kind: input.kind, contentType, sizeBytes: data.length, sha256, objectKey }).returning();
  await getDb().insert(auditLogs).values({ actorUserId: input.ownerUserId, action: "identity.document_uploaded", entityType: "identity_document", entityId: String(document.id), metadataJson: { kind: input.kind, caseId: input.caseId, sizeBytes: data.length } });
  return document;
}

async function purgeDocuments(documents: (typeof identityDocuments.$inferSelect)[]) {
  let purged = 0;
  for (const document of documents) {
    await deleteObject(bucket(), document.objectKey);
    await getDb().update(identityDocuments).set({ purgedAt: new Date() }).where(eq(identityDocuments.id, document.id));
    purged += 1;
  }
  return purged;
}

export async function uploadCaseDocument(input: { caseId: number; actorUserId: number; kind: IdentityDocumentKind; contentBase64: string }) {
  const [identityCase] = await getDb().select().from(identityCases).where(eq(identityCases.id, input.caseId)).limit(1);
  if (!identityCase || !ownsIdentityCase(identityCase, input.actorUserId)) throw new TRPCError({ code: "NOT_FOUND", message: "Check not found" });
  if (!["draft", "needs_more_info"].includes(identityCase.state)) throw new TRPCError({ code: "CONFLICT", message: "You can't change documents once they've been submitted." });
  if (!requiredDocuments(identityCase.caseType).includes(input.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: "This check doesn't need that document." });
  const consents = await getDb().select({ purpose: identityConsents.purpose }).from(identityConsents).where(and(eq(identityConsents.caseId, identityCase.id), isNull(identityConsents.withdrawnAt)));
  if (consents.length < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Please agree to the check before uploading." });
  const previous = await getDb().select().from(identityDocuments).where(and(eq(identityDocuments.caseId, identityCase.id), eq(identityDocuments.kind, input.kind), isNull(identityDocuments.purgedAt)));
  const document = await storeDocument({ ownerUserId: input.actorUserId, caseId: identityCase.id, kind: input.kind, contentBase64: input.contentBase64 });
  await purgeDocuments(previous);
  return { documentId: document.id, kind: document.kind };
}

export async function uploadStudentProof(input: { actorUserId: number; contentBase64: string }) {
  const document = await storeDocument({ ownerUserId: input.actorUserId, caseId: null, kind: "student_proof", contentBase64: input.contentBase64 });
  return document;
}

export async function viewIdentityDocument(input: { documentId: number; actor: typeof users.$inferSelect }) {
  const [document] = await getDb().select().from(identityDocuments).where(eq(identityDocuments.id, input.documentId)).limit(1);
  const reviewer = ["ops", "admin"].includes(input.actor.role);
  if (!document || (!reviewer && document.ownerUserId !== input.actor.id)) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  if (document.purgedAt) throw new TRPCError({ code: "CONFLICT", message: "This document has been deleted." });
  const data = openDocument(await getObject(bucket(), document.objectKey), document.objectKey, encryptionKey());
  await getDb().insert(auditLogs).values({ actorUserId: input.actor.id, action: "identity.document_viewed", entityType: "identity_document", entityId: String(document.id), metadataJson: { kind: document.kind, caseId: document.caseId } });
  return { kind: document.kind, contentType: document.contentType, contentBase64: data.toString("base64") };
}

export async function purgeCaseDocuments(caseId: number) {
  return purgeDocuments(await getDb().select().from(identityDocuments).where(and(eq(identityDocuments.caseId, caseId), isNull(identityDocuments.purgedAt))));
}

/** Deletes files once a decision is old enough, a check stopped, or an upload was abandoned. The record of the upload stays. */
export async function purgeExpiredIdentityDocuments(now = new Date()) {
  const db = getDb();
  const decidedBefore = new Date(now.getTime() - IDENTITY_DOCUMENT_RETENTION_DAYS * 86_400_000);
  const abandonedBefore = new Date(now.getTime() - 90 * 86_400_000);
  const orphanedBefore = new Date(now.getTime() - 86_400_000);
  const cases = await db.select({ id: identityCases.id }).from(identityCases).where(or(
    eq(identityCases.state, "revoked"),
    lt(identityCases.decidedAt, decidedBefore),
    and(eq(identityCases.state, "draft"), lt(identityCases.updatedAt, abandonedBefore)),
  ));
  const attestations = await db.select({ id: enrollmentAttestations.id }).from(enrollmentAttestations).where(lt(enrollmentAttestations.reviewedAt, decidedBefore));
  const due = await db.select().from(identityDocuments).where(and(isNull(identityDocuments.purgedAt), or(
    cases.length ? inArray(identityDocuments.caseId, cases.map((row) => row.id)) : undefined,
    attestations.length ? inArray(identityDocuments.attestationId, attestations.map((row) => row.id)) : undefined,
    and(isNull(identityDocuments.caseId), isNull(identityDocuments.attestationId), lt(identityDocuments.uploadedAt, orphanedBefore)),
  ))).limit(200);
  return { purged: await purgeDocuments(due) };
}
