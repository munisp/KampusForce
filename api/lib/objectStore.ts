import { createHash, createHmac } from "node:crypto";

// A small S3 client for the cluster's MinIO (path-style, signature v4). api/lib/storage.ts is an external
// platform's service, so identity documents must never go through it.
function config() {
  const endpoint = process.env.MINIO_ENDPOINT?.trim();
  const accessKey = process.env.MINIO_USER?.trim();
  const secretKey = process.env.MINIO_PASSWORD?.trim();
  if (!endpoint || !accessKey || !secretKey) throw new Error("Document storage is not configured");
  return { url: new URL(endpoint), accessKey, secretKey };
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

export function signedHeaders(input: { method: string; host: string; path: string; bodyHash: string; accessKey: string; secretKey: string; now?: Date }) {
  const stamp = (input.now || new Date()).toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = stamp.slice(0, 8);
  const scope = `${day}/us-east-1/s3/aws4_request`;
  const canonicalHeaders = `host:${input.host}\nx-amz-content-sha256:${input.bodyHash}\nx-amz-date:${stamp}\n`;
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const request = [input.method, input.path, "", canonicalHeaders, signed, input.bodyHash].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(request)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), "us-east-1"), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    "x-amz-content-sha256": input.bodyHash,
    "x-amz-date": stamp,
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}

async function request(method: "PUT" | "GET" | "DELETE", path: string, body?: Uint8Array) {
  const { url, accessKey, secretKey } = config();
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const headers = signedHeaders({ method, host: url.host, path: encoded, bodyHash: sha256(body || ""), accessKey, secretKey });
  return fetch(new URL(encoded, url), { method, headers, body: body as NonNullable<Parameters<typeof fetch>[1]>["body"], signal: AbortSignal.timeout(60_000) });
}

export async function putObject(bucket: string, key: string, data: Uint8Array) {
  let response = await request("PUT", `/${bucket}/${key}`, data);
  if (response.status === 404) {
    const created = await request("PUT", `/${bucket}`);
    if (!created.ok && created.status !== 409) throw new Error(`Document storage returned ${created.status}`);
    response = await request("PUT", `/${bucket}/${key}`, data);
  }
  if (!response.ok) throw new Error(`Document storage returned ${response.status}`);
}

export async function getObject(bucket: string, key: string) {
  const response = await request("GET", `/${bucket}/${key}`);
  if (!response.ok) throw new Error(`Document storage returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(bucket: string, key: string) {
  const response = await request("DELETE", `/${bucket}/${key}`);
  if (!response.ok && response.status !== 404) throw new Error(`Document storage returned ${response.status}`);
}
