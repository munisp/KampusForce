import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { detectDocumentType, openDocument, sealDocument } from "./identityDocuments";
import { manualChecks, requiredDocuments } from "./identityPolicy";
import { signedHeaders } from "../lib/objectStore";

describe("identity documents", () => {
  it("recognises only JPEG, PNG and PDF from the file's bytes", () => {
    expect(detectDocumentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(detectDocumentType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectDocumentType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(detectDocumentType(Buffer.from("MZ executable"))).toBeNull();
  });

  it("seals a file so it only opens with the same key and object name", () => {
    const key = randomBytes(32);
    const sealed = sealDocument(Buffer.from("passport"), "identity/1/a", key);
    expect(sealed.includes(Buffer.from("passport"))).toBe(false);
    expect(openDocument(sealed, "identity/1/a", key).toString()).toBe("passport");
    expect(() => openDocument(sealed, "identity/1/b", key)).toThrow();
    expect(() => openDocument(sealed, "identity/1/a", randomBytes(32))).toThrow();
  });

  it("asks people and businesses for the right documents and checks", () => {
    expect(requiredDocuments("representative_kyc")).toEqual(["government_id", "selfie"]);
    expect(requiredDocuments("vendor_kyb")).toEqual(["business_certificate", "owner_id"]);
    expect(manualChecks("representative_kyc")).toEqual(["manual_document_check", "manual_face_check"]);
    expect(manualChecks("vendor_kyb")).toEqual(["manual_document_check", "manual_business_check"]);
  });

  it("signs requests in the published signature v4 shape", () => {
    const headers = signedHeaders({ method: "GET", host: "minio:9000", path: "/b/k", bodyHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", accessKey: "AK", secretKey: "SK", now: new Date("2026-11-02T10:00:00.000Z") });
    expect(headers["x-amz-date"]).toBe("20261102T100000Z");
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/20261102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
  });
});
